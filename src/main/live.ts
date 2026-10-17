/**
 * 实时转写调度（D-013）。纯逻辑，不依赖 electron：识别函数由调用方注入，便于测试。
 *
 * 背景（实测，M2 Pro + large-v3-turbo）：whisper 每次识别按固定 30 秒窗口计算，
 * 1.5 秒和 6 秒的音频都约 0.9 秒、且几乎全在 GPU 上 —— 成本取决于“识别次数”，与长度无关。
 * 因此：
 * - 窗口（自上次定稿以来的音频）≤ FREEZE_AT_MS 时整段识别（上下文完整、成本相同）
 * - 停顿即识别（pause candidate）：说完一句立刻识别；松手时若之后没有新的语音，直接用它，几乎不用等
 * - 说话不停时限频预览：同一时刻最多一个请求，两次之间至少间隔 PREVIEW_GAP_MS
 * - 窗口超过 FREEZE_AT_MS：在最近的停顿处定稿，之后不再重复识别已定稿的部分
 */

export const SAMPLE_RATE = 16000
const FRAME = 1600 // 100ms
const PAUSE_FRAMES = 3 // 300ms 静音视为一句说完（多数人说完 0.2～0.5 秒后松手，要赶在松手前识别好）
const MIN_SPEECH_FRAMES = 3 // 窗口里至少 300ms 语音才值得识别
export const FREEZE_AT_MS = 24_000
const FORCE_FREEZE_MS = 28_000

export interface LiveOptions {
  /** 识别一段 16k 单声道 PCM，返回已规整的文本 */
  transcribe: (pcm: Int16Array) => Promise<string>
  /** 文本更新（定稿部分 + 当前窗口） */
  onText?: (text: string) => void
  /** 说话不停时的预览间隔；0 = 关闭预览（停顿识别与定稿照常） */
  previewGapMs?: number
  /** 拼接定稿文本与窗口文本 */
  join?: (a: string, b: string) => string
}

interface Result {
  start: number // 样本下标（含）
  end: number // 样本下标（不含）
  text: string
}

/** 语音阈值下限（16 位采样的 RMS）：会议里离麦克风远、经外放的人声可能只有 300 左右（真人录音模拟外放实测），450 会漏掉整句 */
const VAD_FLOOR = 250

/**
 * 自适应能量 VAD：语音阈值 = max(下限, 底噪 × 3)。
 * 底噪贴着最安静的帧走：更安静就快速下调；略高（< 2 倍）只缓慢上调；明显更响不更新。
 * （早先“非语音帧都参与平均”会被说话中较轻的部分一路抬高，导致下一句正常音量的话被当成静音。）
 */
export interface VadOptions {
  floor?: number // 阈值下限
  ratio?: number // 高出底噪的倍数
  preEmphasis?: boolean // 先滤掉低频（风扇、空调多在低频，远处人声主要在中频）再算能量
}

export class Vad {
  private noise = 200
  speechFrames = 0
  silentRun = 0
  private readonly floor: number
  private readonly ratio: number
  private readonly preEmphasis: boolean
  private last = 0

  /** 默认是听写的参数；会议另设（见 meeting/segmenter.ts） */
  constructor(opts: VadOptions = {}) {
    this.floor = opts.floor ?? VAD_FLOOR
    this.ratio = opts.ratio ?? 3
    this.preEmphasis = opts.preEmphasis ?? false
  }

  isSpeech(frame: Int16Array): boolean {
    let sum = 0
    if (this.preEmphasis) {
      let prev = this.last
      for (let i = 0; i < frame.length; i++) {
        const y = frame[i] - 0.95 * prev
        prev = frame[i]
        sum += y * y
      }
      this.last = prev
    } else for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
    const rms = Math.sqrt(sum / Math.max(1, frame.length))
    const speech = rms > Math.max(this.floor, this.noise * this.ratio)
    if (!speech) {
      if (rms < this.noise) this.noise = this.noise * 0.8 + rms * 0.2
      else if (rms < this.noise * 2) this.noise = this.noise * 0.995 + rms * 0.005
    }
    if (speech) {
      this.speechFrames++
      this.silentRun = 0
    } else {
      this.silentRun++
    }
    return speech
  }
}

export class LiveTranscriber {
  private readonly opts: Required<LiveOptions>
  private chunks: Int16Array[] = []
  private chunksBase = 0 // chunks[0] 的起始样本下标（定稿部分的音频会释放，长录音内存不随时长增长）
  private total = 0 // 已接收样本数
  private pending = new Int16Array(0) // 不足一帧的余量
  private framed = 0 // 已过 VAD 的样本数
  private readonly vad = new Vad()

  private frozenText = ''
  private windowStart = 0
  private windowSpeechFrames = 0
  private lastSpeechEnd = 0 // 最近一帧语音的结束位置
  private lastPauseAt = 0 // 窗口内最近一次停顿的起点（定稿切点）
  private pauseFired = false

  private inFlight: Promise<void> | null = null
  private lastRequestDoneAt = 0
  private windowResult: Result | null = null
  private finished = false
  private now: () => number

  constructor(opts: LiveOptions, now: () => number = Date.now) {
    this.opts = {
      onText: () => {},
      previewGapMs: 2500,
      join: (a, b) => (a && b ? `${a}${b}` : a || b),
      ...opts
    }
    this.now = now
  }

  push(pcm: Int16Array): void {
    if (this.finished || !pcm.length) return
    this.chunks.push(pcm)
    this.total += pcm.length
    const merged = new Int16Array(this.pending.length + pcm.length)
    merged.set(this.pending)
    merged.set(pcm, this.pending.length)
    let off = 0
    for (; off + FRAME <= merged.length; off += FRAME) this.onFrame(merged.subarray(off, off + FRAME))
    this.pending = merged.slice(off)
    this.schedule()
  }

  private onFrame(frame: Int16Array): void {
    const start = this.framed
    this.framed += frame.length
    if (this.vad.isSpeech(frame)) {
      this.windowSpeechFrames++
      this.lastSpeechEnd = this.framed
      this.pauseFired = false
    } else if (this.vad.silentRun === PAUSE_FRAMES && this.windowSpeechFrames > 0) {
      this.lastPauseAt = start - (PAUSE_FRAMES - 1) * FRAME
    }
  }

  private windowMs(): number {
    return ((this.total - this.windowStart) / SAMPLE_RATE) * 1000
  }

  /** 决定是否发起下一次识别（同一时刻最多一个） */
  private schedule(): void {
    if (this.inFlight || this.finished) return
    // 1) 长段落：在最近停顿处定稿（没有停顿则在 FORCE_FREEZE 强制切）
    if (this.windowMs() >= FREEZE_AT_MS) {
      const cut = this.lastPauseAt > this.windowStart ? this.lastPauseAt : this.windowMs() >= FORCE_FREEZE_MS ? this.total : 0
      if (cut > this.windowStart) {
        this.run(this.windowStart, cut, true)
        return
      }
    }
    if (this.windowSpeechFrames < MIN_SPEECH_FRAMES) return
    // 2) 停顿即识别：说完一句、且这句还没识别过
    const paused = this.vad.silentRun >= PAUSE_FRAMES
    const covered = this.windowResult && this.windowResult.end >= this.lastSpeechEnd
    if (paused && !this.pauseFired && !covered) {
      this.pauseFired = true
      this.run(this.windowStart, this.total, false)
      return
    }
    // 3) 说话不停：限频预览
    const gap = this.opts.previewGapMs
    if (gap > 0 && !paused && this.now() - this.lastRequestDoneAt >= gap && this.windowMs() >= 1000) {
      this.run(this.windowStart, this.total, false)
    }
  }

  private slice(start: number, end: number): Int16Array {
    const out = new Int16Array(end - start)
    let pos = this.chunksBase
    let written = 0
    for (const c of this.chunks) {
      const cStart = pos
      const cEnd = pos + c.length
      pos = cEnd
      if (cEnd <= start || cStart >= end) continue
      const from = Math.max(start, cStart) - cStart
      const to = Math.min(end, cEnd) - cStart
      out.set(c.subarray(from, to), written)
      written += to - from
    }
    return out
  }

  private run(start: number, end: number, freeze: boolean): void {
    const pcm = this.slice(start, end)
    this.inFlight = this.opts
      .transcribe(pcm)
      .then((text) => {
        if (freeze) {
          this.frozenText = this.opts.join(this.frozenText, text)
          this.windowStart = end
          this.releaseBefore(end)
          this.windowSpeechFrames = 0
          this.windowResult = null
          this.lastPauseAt = 0
        } else if (start === this.windowStart) {
          this.windowResult = { start, end, text }
        }
        this.opts.onText(this.currentText())
      })
      .catch(() => undefined)
      .finally(() => {
        this.inFlight = null
        this.lastRequestDoneAt = this.now()
        if (!this.finished) this.schedule()
      })
  }

  /** 释放已定稿部分的音频（之后不再需要） */
  private releaseBefore(sample: number): void {
    while (this.chunks.length && this.chunksBase + this.chunks[0].length <= sample) {
      this.chunksBase += this.chunks[0].length
      this.chunks.shift()
    }
  }

  /** 当前保留在内存里的样本数（测试用） */
  retainedSamples(): number {
    return this.total - this.chunksBase
  }

  currentText(): string {
    return this.opts.join(this.frozenText, this.windowResult?.text ?? '')
  }

  /** 是否收到过语音 */
  hasSpeech(): boolean {
    return this.vad.speechFrames >= MIN_SPEECH_FRAMES
  }

  /**
   * 结束：等在途请求；若最近一次窗口结果已覆盖最后一段语音（之后只有静音）就直接用，
   * 否则只对当前窗口再识别一次。
   */
  async finish(): Promise<string> {
    this.finished = true
    if (this.pending.length) {
      this.onFrame(this.pending)
      this.pending = new Int16Array(0)
    }
    while (this.inFlight) await this.inFlight
    const covered = this.windowResult && this.windowResult.start === this.windowStart && this.windowResult.end >= this.lastSpeechEnd
    if (!covered && this.windowSpeechFrames > 0 && this.total > this.windowStart) {
      const text = await this.opts.transcribe(this.slice(this.windowStart, this.total))
      this.windowResult = { start: this.windowStart, end: this.total, text }
    }
    return this.currentText()
  }

  /** 结束时是否还需要等一次识别（用于界面提示） */
  finalRequestNeeded(): boolean {
    return !(this.windowResult && this.windowResult.start === this.windowStart && this.windowResult.end >= this.lastSpeechEnd)
  }
}

/** 整段识别时每段的上限：云端上传限制约 25MB（5 分钟 16k 单声道 WAV 约 9.6MB），本地引擎单次请求也不会超时 */
export const SEGMENT_MAX_MS = 5 * 60_000
const SEGMENT_SEARCH_MS = 10_000

/**
 * 把长音频切成不超过 maxMs 的若干段：在每段末尾 searchMs 范围内找最安静的 100ms 处下刀，尽量不切断词语。
 * 返回各段的 [start, end) 样本下标。
 */
export function splitForTranscription(pcm: Int16Array, maxMs = SEGMENT_MAX_MS, searchMs = SEGMENT_SEARCH_MS): Array<[number, number]> {
  const maxLen = Math.floor((maxMs / 1000) * SAMPLE_RATE)
  const search = Math.min(Math.floor((searchMs / 1000) * SAMPLE_RATE), Math.floor(maxLen / 2))
  const out: Array<[number, number]> = []
  let start = 0
  while (pcm.length - start > maxLen) {
    let cut = start + maxLen
    let best = Infinity
    for (let f = start + maxLen - FRAME; f >= start + maxLen - search; f -= FRAME) {
      let sum = 0
      for (let i = f; i < f + FRAME; i++) sum += pcm[i] * pcm[i]
      if (sum < best) {
        best = sum
        cut = f + FRAME / 2
      }
    }
    out.push([start, cut])
    start = cut
  }
  if (pcm.length > start) out.push([start, pcm.length])
  return out
}
