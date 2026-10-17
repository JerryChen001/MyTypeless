import { app, powerMonitor } from 'electron'
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync, unlinkSync, writeSync } from 'fs'
import { join } from 'path'
import type { MeetingLive, MeetingStartOptions } from '../../shared/types'
import { getKey, hasKey, loadSettings, saveSettings } from '../config'
import { listWords } from '../history'
import { SAMPLE_RATE } from '../live'
import { LlmPolisher } from '../polish'
import { createAsrProvider, type AsrProvider } from '../providers/asr'
import { isHallucination } from '../text'
import { pcm16ToWav } from '../wav'
import { builtinReady, createBuiltinAsr, prewarmBuiltin } from '../whisper'
import {
  MIN_EMBED_MS,
  OnlineClusterer,
  WINDOW_HOP_MS,
  WINDOW_MIN_PART_MS,
  WINDOW_MS,
  blendVoiceprint,
  identifySpeakers,
  mergeAdjacentParts,
  regroup,
  splitByWindows,
  type ClusterItem,
  type VoicedPart
} from './cluster'
import { denoiser, diarizer, speakerModel } from './diarizer'
import { normalizeLoudness } from './enhance'
import {
  buildTranscript,
  chunkNotesSystemPrompt,
  chunkTranscript,
  cleanMinutesBody,
  minutesHeader,
  minutesSystemPrompt,
  wrapChunkNotes,
  wrapMeetingTranscript
} from './minutes'
import { MEETING_VAD, MEETING_VAD_DENOISED, UtteranceSegmenter, planFeed, samplesToMs, splitByTurns, turnsInUtterance, type Part, type Utterance } from './segmenter'
import * as store from './store'

/**
 * 会议编排（D-015、D-016）：
 * 录音（浮动条采集）→ 写入临时文件 + 边录边降噪（D-024）→ 按停顿分句 → 每句：本地识别（降噪后的声音，音量归一；串行，与听写共用引擎）
 * + 声纹（原始录音，mt-diarize，串行）
 * → 在线归类说话人 → 定稿即落库 → 结束时整场重新归类 → LLM 生成纪要 → 删除临时录音。
 * 识别与声纹各自同一时刻只有一个请求；声纹进程低优先级，不影响其他工作。
 */

const MAX_MEETING_MS = 4 * 3600_000
const WARN_BEFORE_MS = 5 * 60_000
const NOTICE_TTL_MS = 6000
/** 短于此的句子不做句内换人检测（容不下两个各 1 秒以上的发言） */
const MIN_SPLIT_MS = 2000
const DENOISE_BATCH = SAMPLE_RATE / 2 // 每攒够 0.5 秒送去降噪一次
const KNOWN_MIN_SEGMENTS = 2 // 每人至少说过这么多句，才按窗口与各人比较找换人位置
/** 会议进行中整体重新区分说话人的间隔 */
const REGROUP_EVERY_MS = 20_000
const MAX_SPEAKERS = 10 // 参会人数选项的上限（与主窗口的选择框一致）
/** 句内换人检测带上的参考录音长度（8 秒：真人录音实测与 10、15 秒结果相同，更省 CPU） */
const TURN_CONTEXT_SAMPLES = SAMPLE_RATE * 8

interface Active {
  id: string
  title: string
  audioPath: string
  fd: number
  written: number // 已写入的样本数（= 会议时间线位置）
  segmenter: UtteranceSegmenter
  clusterer: OnlineClusterer
  denoise: boolean // 本场是否边录边降噪（开会时降噪模型已就绪）
  dnChain: Promise<void> // 降噪与分句（按录音顺序串行）
  dnSent: number // 已送去降噪的样本数
  segFed: number // 已送入分句的样本数（降噪输出或原始录音）
  expected: number // 参会人数：会中最多分出这么多人（D-021）
  prints: Array<{ id: number; name: string; samples: number; vector: Float32Array }>
  embeddings: Map<number, Float32Array> // 句子 id → 声音特征（只在内存，整理完丢弃）
  asr: AsrProvider
  words: string[]
  asrChain: Promise<void>
  diarChain: Promise<unknown>
  failed: Array<[number, number]> // 识别失败的句子（结束时重试）
  lastSpeaker: number | null
  paused: boolean
  elapsedBefore: number // 之前各段的录音时长
  runningSince: number // 本段开始的时间（暂停时为 0）
  warned: boolean
  ticker: NodeJS.Timeout
  newSegments: number // 上次整体重新归类之后新增的段数
  lastRegroupAt: number
  embedOk: number // 声纹计算成功 / 失败次数：一直失败时提示，不再悄悄全部“未区分”
  embedFailed: number
}

export interface MeetingHooks {
  /** 实时状态（浮动条、主窗口） */
  onLive(live: MeetingLive): void
  /** 某场会议内容有变化（主窗口刷新） */
  onChanged(meetingId: string): void
  /** 开/关浮动条的会议采集 */
  setCapture(on: boolean, micDeviceId: string): void
}

export class MeetingManager {
  private active: Active | null = null
  private processing: { id: string; stage: string } | null = null
  private notice: { text: string; until: number } | null = null
  private hooks: MeetingHooks

  constructor(hooks: MeetingHooks) {
    this.hooks = hooks
    speakerModel.onChange = () => this.emit()
    powerMonitor.on('on-battery', () => {
      if (this.active) this.flash('正在使用电池：长时间会议建议接上电源')
    })
  }

  /** 会议录音中（含暂停）：期间 Fn 听写暂停 */
  isActive(): boolean {
    return !!this.active
  }

  live(): MeetingLive {
    const model = speakerModel.state()
    const base = { speakerModel: model, speakerModelProgress: model === 'downloading' ? speakerModel.progress : undefined }
    const notice = this.notice && this.notice.until > Date.now() ? this.notice.text : undefined
    const a = this.active
    if (a) {
      return {
        ...base,
        state: a.paused ? 'paused' : 'recording',
        meetingId: a.id,
        title: a.title,
        elapsedMs: this.elapsed(a),
        running: !a.paused,
        notice
      }
    }
    if (this.processing) return { ...base, state: 'processing', meetingId: this.processing.id, stage: this.processing.stage, notice }
    return { ...base, state: 'idle', notice }
  }

  private starting = false

  async start(opts: MeetingStartOptions = {}): Promise<{ ok: boolean; error?: string; meetingId?: string }> {
    if (this.active || this.starting) return { ok: false, error: '已有会议在进行中' }
    this.starting = true
    try {
      return await this.startNow(opts)
    } finally {
      this.starting = false
    }
  }

  private async startNow(opts: MeetingStartOptions): Promise<{ ok: boolean; error?: string; meetingId?: string }> {
    if (this.processing) return { ok: false, error: '上一场会议还在整理中，请稍候' }
    const settings = loadSettings()
    let asr: AsrProvider
    if (settings.asr.provider === 'builtin') {
      if (!builtinReady(settings)) return { ok: false, error: '还没有下载语音识别模型：请先在设置 → 语音识别里下载' }
      asr = createBuiltinAsr(settings)
      prewarmBuiltin(settings)
    } else {
      asr = createAsrProvider(settings, getKey('asr'))
    }
    const models = speakerModel.ensure() // 首次开会时下载声纹模型；下载完成前的句子之后补做
    // 已有声纹模型、只缺降噪模型（约 0.5MB，D-024）：等一会儿，下好了本场就能边录边降噪
    if (speakerModel.ready() && !speakerModel.denoiserReady()) await Promise.race([models, new Promise((r) => setTimeout(r, 5000))])

    const dir = join(app.getPath('userData'), 'meetings')
    mkdirSync(dir, { recursive: true })
    const startedAt = Date.now()
    const title = opts.title?.trim() || defaultTitle(startedAt)
    const audioPath = join(dir, `${startedAt}.pcm`)
    const expected = speakerCount(opts.expectedSpeakers ?? settings.meetingSpeakers)
    const denoise = speakerModel.denoiserReady()
    if (expected !== settings.meetingSpeakers) saveSettings({ meetingSpeakers: expected })
    const id = store.createMeeting({ title, startedAt, expectedSpeakers: expected, audioPath })
    const a: Active = {
      id,
      title,
      audioPath,
      fd: openSync(audioPath, 'a'),
      written: 0,
      segmenter: new UtteranceSegmenter(denoise ? MEETING_VAD_DENOISED : MEETING_VAD),
      clusterer: new OnlineClusterer(),
      denoise,
      dnChain: Promise.resolve(),
      dnSent: 0,
      segFed: 0,
      expected,
      prints: store.voiceprintVectors(),
      embeddings: new Map(),
      asr,
      words: listWords().map((w) => w.word),
      asrChain: Promise.resolve(),
      diarChain: Promise.resolve(),
      failed: [],
      lastSpeaker: null,
      paused: false,
      elapsedBefore: 0,
      runningSince: Date.now(),
      warned: false,
      ticker: setInterval(() => this.tick(), 1000),
      newSegments: 0,
      lastRegroupAt: Date.now(),
      embedOk: 0,
      embedFailed: 0
    }
    this.active = a
    this.hooks.setCapture(true, settings.micDeviceId ?? '')
    if (powerMonitor.isOnBatteryPower()) this.flash('正在使用电池：长时间会议建议接上电源')
    this.emit()
    this.hooks.onChanged(id)
    return { ok: true, meetingId: id }
  }

  /** 浮动条送来的录音分片 */
  pushAudio(pcm: Int16Array): void {
    const a = this.active
    if (!a || a.paused || !pcm.length) return
    try {
      writeSync(a.fd, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength))
    } catch (err) {
      console.warn('[meeting] write audio failed:', err)
    }
    a.written += pcm.length
    if (!a.denoise) {
      for (const u of a.segmenter.push(pcm)) this.onUtterance(a, u)
      a.segFed = a.written
      return
    }
    if (a.written - a.dnSent >= DENOISE_BATCH) this.sendToDenoiser(a)
  }

  /** 把还没送出的录音送去降噪，结果按顺序送入分句（D-024） */
  private sendToDenoiser(a: Active): void {
    const start = a.dnSent
    const count = a.written - start
    if (count <= 0) return
    a.dnSent = a.written
    a.dnChain = a.dnChain.then(async () => this.feedSegmenter(a, await denoiser.denoiseFeed(a.audioPath, start, count).catch(() => null), start + count))
  }

  /** 暂停、结束：送出剩余录音、取回降噪器里剩下的部分、结束正在说的一句；返回分出的句子都已交给 onUtterance 的 Promise */
  private drainSegmenter(a: Active): Promise<void> {
    if (a.denoise) {
      this.sendToDenoiser(a)
      a.dnChain = a.dnChain.then(async () => this.feedSegmenter(a, await denoiser.denoiseFlush().catch(() => null), a.dnSent))
    }
    a.dnChain = a.dnChain.then(() => {
      for (const u of a.segmenter.flush()) this.onUtterance(a, u)
    })
    return a.dnChain
  }

  /** 降噪输出按录音时间线接入分句；失败或有缺口时用临时文件里的原始录音补上（planFeed） */
  private feedSegmenter(a: Active, r: { at: number; pcm: Int16Array } | null, upTo: number): void {
    const push = (pcm: Int16Array) => {
      for (const u of a.segmenter.push(pcm)) this.onUtterance(a, u)
      a.segFed += pcm.length
    }
    for (const step of planFeed(a.segFed, r, upTo)) {
      if ('pcm' in step) push(step.pcm)
      else readPcm(a.audioPath, step.raw[0], step.raw[1] - step.raw[0], push)
    }
  }


  pause(): void {
    const a = this.active
    if (!a || a.paused) return
    this.hooks.setCapture(false, '')
    void this.drainSegmenter(a)
    a.elapsedBefore = this.elapsed(a)
    a.runningSince = 0
    a.paused = true
    store.updateMeeting(a.id, { status: 'paused', durationMs: a.elapsedBefore })
    this.emit()
  }

  resume(): void {
    const a = this.active
    if (!a || !a.paused) return
    a.paused = false
    a.runningSince = Date.now()
    store.updateMeeting(a.id, { status: 'recording' })
    this.hooks.setCapture(true, loadSettings().micDeviceId ?? '')
    this.emit()
  }

  /** 结束会议：停止录音 → 等待识别与声纹完成 → 整理；minutes = false 时只保存记录，不生成纪要 */
  async stop(opts: { minutes?: boolean } = {}): Promise<void> {
    const a = this.active
    if (!a) return
    this.hooks.setCapture(false, '')
    clearInterval(a.ticker)
    const drained = this.drainSegmenter(a)
    const durationMs = this.elapsed(a)
    this.active = null
    this.processing = { id: a.id, stage: '正在完成转写…' }
    store.updateMeeting(a.id, { status: 'processing', durationMs, endedAt: Date.now() })
    this.emit()
    await drained
    await a.asrChain
    await a.diarChain
    try {
      closeSync(a.fd)
    } catch {
      /* noop */
    }
    // 识别失败过的句子再试一次（录音在临时文件里）
    for (const [s, e] of a.failed) await this.transcribeRange(a.id, a.audioPath, s, e, a.asr, a.words, null)
    await this.organize(a.id, a.embeddings, a.prints, opts.minutes !== false)
  }

  /** 整理异常中断的会议：补转写临时录音里还没转写的尾部，然后照常整理 */
  async finish(meetingId: string, opts: { minutes?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
    if (this.active?.id === meetingId || this.processing) return { ok: false, error: '正在处理其他会议' }
    const row = store.getMeetingRow(meetingId)
    if (!row) return { ok: false, error: '会议不存在' }
    this.processing = { id: meetingId, stage: '正在恢复会议录音…' }
    store.updateMeeting(meetingId, { status: 'processing' })
    this.emit()
    const settings = loadSettings()
    if (row.audio_path && existsSync(row.audio_path)) {
      try {
        const asr = settings.asr.provider === 'builtin' ? createBuiltinAsr(settings) : createAsrProvider(settings, getKey('asr'))
        const words = listWords().map((w) => w.word)
        const last = store.listSegments(meetingId).reduce((m, s) => Math.max(m, s.endSample), 0)
        const total = Math.floor(statSync(row.audio_path).size / 2)
        store.updateMeeting(meetingId, { durationMs: samplesToMs(total) }) // 录音时间线即会议时长（暂停不计）
        const seg = new UtteranceSegmenter()
        const offset = last
        const utterances: Utterance[] = []
        readPcm(row.audio_path, last, total - last, (chunk) => utterances.push(...seg.push(chunk)))
        utterances.push(...seg.flush())
        for (const u of utterances) await this.transcribeRange(meetingId, row.audio_path, u.start + offset, u.end + offset, asr, words, null)
      } catch (err) {
        console.warn('[meeting] recover tail failed:', err)
      }
    }
    if (!row.ended_at) store.updateMeeting(meetingId, { endedAt: Date.now() })
    await this.organize(meetingId, new Map(), store.voiceprintVectors(), opts.minutes !== false)
    return { ok: true }
  }

  /** 重新生成纪要（改名、改归属后） */
  async regenerate(meetingId: string): Promise<{ ok: boolean; error?: string }> {
    if (this.processing) return { ok: false, error: '正在整理其他会议，请稍候' }
    this.processing = { id: meetingId, stage: '正在生成会议纪要…' }
    this.emit()
    try {
      return await this.generateMinutes(meetingId)
    } finally {
      this.processing = null
      this.emit()
      this.hooks.onChanged(meetingId)
    }
  }

  /** 改名（可选“记住这个声音”）；返回是否保存了声纹（没有声音特征时无法保存） */
  renameSpeaker(meetingId: string, speakerId: number, name: string, remember: boolean): { remembered: boolean } {
    const sp = store.getSpeaker(speakerId)
    if (!sp || sp.meeting_id !== meetingId) return { remembered: false }
    let remembered = false
    const clean = name.trim() || null
    store.updateSpeaker(speakerId, { name: clean })
    // 旧声纹模型的会议：声纹与当前声纹库不可比，只改名不保存声纹（D-026）
    if (clean && remember && store.usesCurrentModel(meetingId)) {
      const v = this.speakerVector(meetingId, speakerId)
      if (v) {
        const n = Math.max(1, store.listSegments(meetingId).filter((s) => s.speakerId === speakerId).length)
        const existing = store.voiceprintVectors().find((p) => p.id === sp.voiceprint_id) ?? store.voiceprintVectors().find((p) => p.name === clean)
        const vector = existing ? blendVoiceprint(existing.vector, existing.samples, v, n) : v
        const id = store.saveVoiceprint({ id: existing?.id, name: clean, vector, samples: (existing?.samples ?? 0) + n })
        store.updateSpeaker(speakerId, { voiceprintId: id })
        if (this.active) this.active.prints = store.voiceprintVectors()
        remembered = true
      }
    } else if (!remember && sp.voiceprint_id && clean !== sp.name) {
      store.updateSpeaker(speakerId, { voiceprintId: null })
    }
    this.hooks.onChanged(meetingId)
    return { remembered }
  }

  assignSegment(meetingId: string, segmentId: number, speakerId: number | 'new'): void {
    const target = speakerId === 'new' ? store.addSpeaker(meetingId) : speakerId
    store.setSegmentSpeaker(segmentId, target, true)
    store.pruneSpeakers(meetingId)
    this.hooks.onChanged(meetingId)
  }

  mergeSpeakers(meetingId: string, from: number, into: number): void {
    if (from === into) return
    store.mergeSpeakers(from, into)
    if (this.active?.id === meetingId) this.active.clusterer.merge(from, into)
    this.hooks.onChanged(meetingId)
  }

  /** 设置页管理声纹模型：download / cancel / remove（会议进行或整理中不能删除） */
  speakerModelAction(action: 'download' | 'cancel' | 'remove'): { ok: boolean; error?: string } {
    if (action === 'download') void speakerModel.ensure()
    else if (action === 'cancel') speakerModel.cancel()
    else {
      if (this.active || this.processing) return { ok: false, error: '会议进行或整理中，不能删除声纹模型' }
      diarizer.stop()
      denoiser.stop()
      speakerModel.remove()
    }
    this.emit()
    return { ok: true }
  }

  /** 改参会人数（null = 自动）：会议中或会后都立即按新人数重新区分说话人（D-020） */
  setExpected(meetingId: string, count: number): { ok: boolean; error?: string } {
    const n = speakerCount(count)
    store.setExpectedSpeakers(meetingId, n)
    saveSettings({ meetingSpeakers: n })
    const live = this.active?.id === meetingId ? this.active : null
    if (live) live.expected = n
    const embeddings = live ? live.embeddings : store.segmentEmbeddings(meetingId)
    if (!embeddings.size) {
      this.hooks.onChanged(meetingId)
      return { ok: false, error: '这场会议没有保存逐句声纹（较早的会议），无法自动重新区分；可以手动合并说话人' }
    }
    const prints = live ? live.prints : store.voiceprintVectors()
    this.applyRegroup(meetingId, embeddings, prints, n, live)
    if (!live) store.relabelSpeakers(meetingId)
    this.hooks.onChanged(meetingId)
    return { ok: true }
  }

  /** 删除会议（进行中的会议不能删） */
  delete(meetingId: string): boolean {
    if (this.active?.id === meetingId || this.processing?.id === meetingId) return false
    const audio = store.deleteMeeting(meetingId)
    removeFile(audio)
    return true
  }

  /** 启动时：上次异常退出留下的会议标为“异常中断”，等用户点“继续整理” */
  markInterrupted(): void {
    for (const row of store.unfinishedMeetings()) store.updateMeeting(row.id, { status: 'interrupted' })
  }

  // —— 内部 ——

  private elapsed(a: Active): number {
    return a.elapsedBefore + (a.runningSince ? Date.now() - a.runningSince : 0)
  }

  private tick(): void {
    const a = this.active
    if (!a || a.paused) return
    const e = this.elapsed(a)
    if (!a.warned && e >= MAX_MEETING_MS - WARN_BEFORE_MS) {
      a.warned = true
      this.flash('会议还有 5 分钟到达 4 小时上限，到时自动结束并整理')
    }
    if (e >= MAX_MEETING_MS) void this.stop()
    // 会议进行中定期整体重新区分说话人：纠正早期在线归类的错误（不必等到会议结束）
    if (a.newSegments > 0 && Date.now() - a.lastRegroupAt >= REGROUP_EVERY_MS) {
      a.lastRegroupAt = Date.now()
      a.newSegments = 0
      try {
        if (this.applyRegroup(a.id, a.embeddings, a.prints, a.expected, a).changed) this.hooks.onChanged(a.id)
      } catch (err) {
        console.warn('[meeting] live regroup failed:', err)
      }
    }
  }

  private flash(text: string): void {
    this.notice = { text, until: Date.now() + NOTICE_TTL_MS }
    this.emit()
  }

  private emit(): void {
    this.hooks.onLive(this.live())
  }

  /**
   * 一句话：先找句内换人的位置（真人对话常常不停顿就接话），按人切成几段；
   * 每段的声纹（mt-diarize，串行）与识别（串行）并行进行，两者都完成后落库。
   */
  private onUtterance(a: Active, u: Utterance): void {
    const whole: Part[] = [{ start: u.start, end: u.end }]
    const canSplit = a.expected > 1 && speakerModel.ready() && samplesToMs(u.end - u.start) >= MIN_SPLIT_MS
    // 已经区分出几个人（各至少说过 KNOWN_MIN_SEGMENTS 句）：按窗口与各人比较找换人位置（D-025）；
    // 会议刚开始还不知道各人的声音：用分段模型，带上句子前面一段录音做参考（分段模型在几秒的短片段里分不清人）
    const byWindows = canSplit && a.clusterer.countWith(KNOWN_MIN_SEGMENTS) >= 2
    const ctxStart = Math.max(0, u.start - TURN_CONTEXT_SAMPLES)
    const partsReady: Promise<Part[]> = !canSplit
      ? Promise.resolve(whole)
      : byWindows
        ? (a.diarChain = a.diarChain.then(() => this.splitWithWindows(a, u)).catch(() => whole)) as Promise<Part[]>
        : (a.diarChain = a.diarChain
            .then(() => diarizer.turns(a.audioPath, ctxStart, u.end - ctxStart))
            .then((t) => (t ? splitByTurns(u.start, u.end, turnsInUtterance(ctxStart, u.start, u.end, t)) : whole))
            .catch(() => whole)) as Promise<Part[]>
    // 切好后立刻排队算每段声纹；分段模型切出的同一人相邻段合回一段再识别（按窗口切的已按人分好，不再合）
    const planned: Promise<VoicedPart[]> = partsReady.then(async (parts) => {
      const voiced = await Promise.all(
        parts.map(async (p) => ({
          ...p,
          v:
            samplesToMs(p.end - p.start) >= MIN_EMBED_MS
              ? ((await (a.diarChain = a.diarChain.then(() => diarizer.embed(a.audioPath, p.start, p.end - p.start)).catch(() => null))) as Float32Array | null)
              : null
        }))
      )
      return parts.length > 1 && !byWindows ? mergeAdjacentParts(voiced) : voiced
    })
    a.asrChain = a.asrChain.then(async () => {
      for (const p of await planned) {
        // 识别用原始录音（降噪后的声音只用于分句：弱的人声会被一起削掉，D-024），音量归一后识别
        const pcm = normalizeLoudness(a.denoise ? readRange(a.audioPath, p.start, p.end) : u.pcm.subarray(p.start - u.start, p.end - u.start))
        let text: string
        try {
          text = (await a.asr.transcribe(pcm16ToWav(pcm, SAMPLE_RATE, 1), { vocabulary: a.words })).text.trim()
        } catch (err) {
          console.warn('[meeting] transcribe failed:', err)
          a.failed.push([p.start, p.end])
          continue
        }
        if (!text || isHallucination(text)) continue
        const v = p.v
        if (v) a.embedOk++
        else if (speakerModel.ready() && samplesToMs(p.end - p.start) >= MIN_EMBED_MS && ++a.embedFailed === 3 && !a.embedOk) {
          this.flash('说话人区分暂时不可用（声纹计算失败），本场会议先只转写；结束后可手动标注说话人')
        }
        const speakerId = v ? this.assignSpeaker(a, v) : a.lastSpeaker
        const id = store.addSegment(a.id, { speakerId, startSample: p.start, endSample: p.end, text, embedding: v })
        if (v) a.embeddings.set(id, v)
        a.lastSpeaker = speakerId
        a.newSegments++
        this.hooks.onChanged(a.id)
      }
    })
    // 声纹模型在会议中途下载完成：补做之前没有说话人的句子
    if (speakerModel.ready()) void a.asrChain.then(() => this.backfillIfNeeded(a))
  }

  private backfilling = false
  private async backfillIfNeeded(a: Active): Promise<void> {
    if (this.backfilling) return
    const pending = store.listSegments(a.id).filter((s) => s.speakerId === null && !a.embeddings.has(s.id))
    if (!pending.length) return
    this.backfilling = true
    try {
      for (const s of pending) {
        if (samplesToMs(s.endSample - s.startSample) < MIN_EMBED_MS) continue
        const v = await (a.diarChain = a.diarChain.then(() => diarizer.embed(a.audioPath, s.startSample, s.endSample - s.startSample)).catch(() => null))
        if (!(v instanceof Float32Array)) continue
        a.embeddings.set(s.id, v)
        store.setSegmentEmbedding(s.id, v)
        store.setSegmentSpeaker(s.id, this.assignSpeaker(a, v))
      }
      this.hooks.onChanged(a.id)
    } finally {
      this.backfilling = false
    }
  }

  /** 按窗口找句内换人位置（在 diarChain 内调用）：每 0.5 秒取 1.5 秒算声纹，与已区分出的各人比较（splitByWindows） */
  private async splitWithWindows(a: Active, u: Utterance): Promise<Part[]> {
    const w = (SAMPLE_RATE * WINDOW_MS) / 1000
    const hop = (SAMPLE_RATE * WINDOW_HOP_MS) / 1000
    const vecs: Array<{ center: number; v: Float32Array }> = []
    for (let s = u.start; s + w <= u.end + hop / 2; s += hop) {
      const st = Math.min(s, u.end - w)
      const v = await diarizer.embed(a.audioPath, st, w)
      if (v) vecs.push({ center: st + w / 2, v })
    }
    const keys = vecs.length ? a.clusterer.scores(vecs[0].v, KNOWN_MIN_SEGMENTS).map((x) => x.key) : []
    if (keys.length < 2) return [{ start: u.start, end: u.end }]
    const wins = vecs.map(({ center, v }) => {
      const sc = new Map(a.clusterer.scores(v, KNOWN_MIN_SEGMENTS).map((x) => [x.key, x.sim]))
      return { center, scores: keys.map((k) => sc.get(k) ?? -1) }
    })
    return splitByWindows(u.start, u.end, wins, (SAMPLE_RATE * WINDOW_MIN_PART_MS) / 1000)
  }

  /** 在线归类（名字由定期整体归类时按声纹库认出，见 applyRegroup） */
  private assignSpeaker(a: Active, v: Float32Array): number {
    return a.clusterer.assign(v, () => store.addSpeaker(a.id), a.expected).key
  }

  private async transcribeRange(meetingId: string, audioPath: string, start: number, end: number, asr: AsrProvider, words: string[], speakerId: number | null): Promise<void> {
    try {
      const pcm = normalizeLoudness(readRange(audioPath, start, end))
      const text = (await asr.transcribe(pcm16ToWav(pcm, SAMPLE_RATE, 1), { vocabulary: words })).text.trim()
      if (text && !isHallucination(text)) store.addSegment(meetingId, { speakerId, startSample: start, endSample: end, text })
    } catch (err) {
      console.warn('[meeting] retry transcribe failed:', err)
    }
  }

  /** 整理：整场重新归类说话人 →（可选）生成纪要 → 删除临时录音 */
  private async organize(meetingId: string, embeddings: Map<number, Float32Array>, prints: Active['prints'], withMinutes: boolean): Promise<void> {
    this.processing = { id: meetingId, stage: '正在整理说话人…' }
    this.emit()
    try {
      await this.reclusterMeeting(meetingId, embeddings, prints)
    } catch (err) {
      console.warn('[meeting] recluster failed:', err)
    }
    this.hooks.onChanged(meetingId)
    if (withMinutes) {
      this.processing = { id: meetingId, stage: '正在生成会议纪要…' }
      this.emit()
      await this.generateMinutes(meetingId)
    }
    const row = store.getMeetingRow(meetingId)
    removeFile(row?.audio_path ?? null)
    store.updateMeeting(meetingId, { status: 'done', audioPath: null })
    this.processing = null
    this.emit()
    this.hooks.onChanged(meetingId)
  }

  private async reclusterMeeting(meetingId: string, embeddings: Map<number, Float32Array>, prints: Active['prints']): Promise<void> {
    let row = store.getMeetingRow(meetingId)
    // 旧声纹模型录的会议（升级前异常中断）：临时录音还在就用当前模型重算全部声纹，否则不与声纹库比较（D-026）
    if (row && !store.usesCurrentModel(meetingId)) {
      if (row.audio_path && existsSync(row.audio_path) && speakerModel.ready()) {
        store.resetEmbeddings(meetingId)
        embeddings.clear()
        row = store.getMeetingRow(meetingId)
      } else prints = []
    }
    for (const [id, v] of store.segmentEmbeddings(meetingId)) if (!embeddings.has(id)) embeddings.set(id, v)
    const segments = store.listSegments(meetingId)
    // 缺声纹的句子（异常恢复、模型下载较晚）从临时录音补算
    if (row?.audio_path && existsSync(row.audio_path) && speakerModel.ready()) {
      for (const s of segments) {
        if (embeddings.has(s.id) || samplesToMs(s.endSample - s.startSample) < MIN_EMBED_MS) continue
        const v = await diarizer.embed(row.audio_path, s.startSample, s.endSample - s.startSample)
        if (v) {
          embeddings.set(s.id, v)
          store.setSegmentEmbedding(s.id, v)
        }
      }
    }
    if (!embeddings.size) return
    // 还没有说话人的句子先在线归类，再整体重新归类
    const online = new OnlineClusterer()
    const speakers = store.listSpeakers(meetingId)
    for (const s of segments) {
      const v = embeddings.get(s.id)
      if (v && s.speakerId !== null) online.seed(s.speakerId, v)
    }
    for (const s of segments) {
      const v = embeddings.get(s.id)
      if (v && s.speakerId === null) {
        const { key } = online.assign(v, () => store.addSpeaker(meetingId), row?.expected_speakers ?? Infinity)
        store.setSegmentSpeaker(s.id, key)
        s.speakerId = key
      }
    }
    // 同一声纹被认出两次：先合并
    const byPrint = new Map<number, number>()
    for (const sp of speakers) {
      if (!sp.voiceprint_id) continue
      const first = byPrint.get(sp.voiceprint_id)
      if (first) store.mergeSpeakers(sp.id, first)
      else byPrint.set(sp.voiceprint_id, sp.id)
    }
    const means = this.applyRegroup(meetingId, embeddings, prints, row?.expected_speakers ?? null, null)
    // 保存每人的声音特征（D-016：用于会后“记住这个声音”）；已关联声纹的人顺带更新声纹
    const counts = new Map<number, number>()
    for (const s of store.listSegments(meetingId)) if (s.speakerId !== null && embeddings.has(s.id)) counts.set(s.speakerId, (counts.get(s.speakerId) ?? 0) + 1)
    for (const sp of store.listSpeakers(meetingId)) {
      const c = means.get(sp.id)
      if (!c) continue
      store.updateSpeaker(sp.id, { centroid: c })
      if (sp.voiceprint_id && sp.name) {
        const vp = prints.find((p) => p.id === sp.voiceprint_id)
        const n = counts.get(sp.id) ?? 0
        if (vp && n) store.saveVoiceprint({ id: vp.id, name: vp.name, vector: blendVoiceprint(vp.vector, vp.samples, c, n), samples: vp.samples + n })
      }
    }
    store.relabelSpeakers(meetingId) // 「说话人 N」按出场顺序重新编号
  }

  /**
   * 整体重新区分说话人并写回：段的归属、被合并的说话人、按声纹库认名字；live 时同步重建在线归类器。
   * 返回每个说话人的平均向量；有改动时返回值的 changed 标记见调用方（live 用于决定是否刷新界面）。
   */
  private applyRegroup(meetingId: string, embeddings: Map<number, Float32Array>, prints: Active['prints'], expected: number | null, live: Active | null): Map<number, Float32Array> & { changed?: boolean } {
    const segs = store.listSegments(meetingId)
    const named = new Set(store.listSpeakers(meetingId).filter((s) => s.name).map((s) => s.id))
    const items: ClusterItem[] = segs.map((s) => ({
      id: s.id,
      speaker: s.speakerId,
      v: embeddings.get(s.id) ?? null,
      durMs: samplesToMs(s.endSample - s.startSample),
      locked: s.locked
    }))
    const result = regroup(items, { expected, named, create: () => store.addSpeaker(meetingId) })
    let changed = false
    for (const s of segs) {
      const target = result.assign.get(s.id)
      if (target !== undefined && target !== s.speakerId) {
        store.setSegmentSpeaker(s.id, target)
        changed = true
      }
    }
    store.pruneSpeakers(meetingId)
    // 还没有名字的人：用整组声音按声纹库认（D-022；本场已用过的声纹不再给别人；旧声纹模型的会议不认，D-026）
    if (!store.usesCurrentModel(meetingId)) prints = []
    const speakers = store.listSpeakers(meetingId)
    const taken = new Set(speakers.flatMap((sp) => (sp.voiceprint_id ? [sp.voiceprint_id] : [])))
    const groups = speakers.flatMap((sp) => {
      const mean = result.means.get(sp.id)
      return !sp.name && mean ? [{ key: sp.id, mean, n: result.sizes.get(sp.id) ?? 0 }] : []
    })
    for (const [key, id] of identifySpeakers(groups, prints, taken)) {
      const vp = prints.find((p) => p.id === id)
      if (!vp) continue
      store.updateSpeaker(key, { name: vp.name, voiceprintId: vp.id })
      changed = true
    }
    if (live) {
      live.clusterer.clear()
      for (const s of segs) {
        const v = embeddings.get(s.id)
        const sp = result.assign.get(s.id)
        if (v && sp !== undefined) live.clusterer.seed(sp, v)
      }
      const last = segs.at(-1)
      if (last) live.lastSpeaker = result.assign.get(last.id) ?? live.lastSpeaker
    }
    return Object.assign(result.means, { changed })
  }

  private speakerVector(meetingId: string, speakerId: number): Float32Array | null {
    if (this.active?.id === meetingId) {
      const c = this.active.clusterer.centroid(speakerId)
      if (c) return c
    }
    return store.getSpeaker(speakerId)?.centroid ?? null
  }

  private async generateMinutes(meetingId: string): Promise<{ ok: boolean; error?: string }> {
    const detail = store.getMeetingDetail(meetingId)
    if (!detail) return { ok: false, error: '会议不存在' }
    const settings = loadSettings()
    const key = hasKey('llm') ? getKey('llm') : ''
    if (!key) {
      const error = '未配置 LLM：在设置 → 润色 LLM 里填写 API Key 后，点「生成纪要」'
      store.updateMeeting(meetingId, { minutesError: error })
      return { ok: false, error }
    }
    const names = new Map(detail.speakerList.map((s) => [s.id, s.displayName]))
    const lines = buildTranscript(detail.segments.map((s) => ({ startMs: s.startMs, speaker: (s.speakerId !== null && names.get(s.speakerId)) || '未区分', text: s.text })))
    if (!lines.length) {
      const error = '没有转写内容，无法生成纪要'
      store.updateMeeting(meetingId, { minutesError: error })
      return { ok: false, error }
    }
    try {
      const llm = new LlmPolisher(settings, key, 180_000)
      const speakers = detail.speakerList.map((s) => s.displayName)
      const chunks = chunkTranscript(lines)
      let body: string
      if (chunks.length === 1) body = await llm.complete(minutesSystemPrompt(speakers), wrapMeetingTranscript(chunks[0]))
      else {
        const notes: string[] = []
        for (let i = 0; i < chunks.length; i++) {
          this.processing = { id: meetingId, stage: `正在整理第 ${i + 1}/${chunks.length} 段…` }
          this.emit()
          notes.push(await llm.complete(chunkNotesSystemPrompt(), wrapMeetingTranscript(chunks[i], { index: i + 1, total: chunks.length })))
        }
        this.processing = { id: meetingId, stage: '正在生成会议纪要…' }
        this.emit()
        body = await llm.complete(minutesSystemPrompt(speakers), wrapChunkNotes(notes))
      }
      const minutes = `${minutesHeader({ title: detail.title, startedAt: detail.startedAt, durationMs: detail.durationMs, speakers })}\n${cleanMinutesBody(body)}\n`
      store.updateMeeting(meetingId, { minutes, minutesError: null })
      return { ok: true }
    } catch (err) {
      // 转写稿已完整保存（D-008 的会议版），只记录纪要失败的原因
      const error = `纪要生成失败：${err instanceof Error ? err.message.slice(0, 200) : String(err)}`
      store.updateMeeting(meetingId, { minutesError: error })
      return { ok: false, error }
    }
  }
}

/** 参会人数：1～MAX_SPEAKERS，无效时取 2 */
function speakerCount(n: number | null | undefined): number {
  return n && Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_SPEAKERS) : 2
}

function defaultTitle(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 的会议`
}

/** 按块读取 pcm 文件中的一段（样本） */
/** 读出临时录音 [start, end) 这段（文件比 end 短时只返回已有部分） */
function readRange(path: string, start: number, end: number): Int16Array {
  const pcm = new Int16Array(Math.max(0, end - start))
  let off = 0
  readPcm(path, start, end - start, (c) => {
    pcm.set(c, off)
    off += c.length
  })
  return pcm.subarray(0, off)
}

function readPcm(path: string, start: number, count: number, onChunk: (pcm: Int16Array) => void): void {
  if (count <= 0) return
  const fd = openSync(path, 'r')
  try {
    const CHUNK = SAMPLE_RATE * 10
    let pos = start
    const end = start + count
    while (pos < end) {
      const n = Math.min(CHUNK, end - pos)
      const buf = Buffer.alloc(n * 2)
      const got = readSync(fd, buf, 0, buf.length, pos * 2)
      if (got <= 0) break
      onChunk(new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + (got - (got % 2)))))
      pos += Math.floor(got / 2)
    }
  } finally {
    closeSync(fd)
  }
}

function removeFile(path: string | null): void {
  if (!path) return
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch (err) {
    console.warn('[meeting] remove audio failed:', err)
  }
}

export { store as meetingStore }
