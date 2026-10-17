import type { Settings } from '../../shared/types'

/**
 * ASR Provider 抽象（M1: OpenAI 兼容 transcription API；M2: 本地 whisper.cpp）
 * 输入：16kHz mono Int16 PCM 的 WAV 字节
 */

export interface AsrResult {
  text: string
  language?: string
  durationSec?: number
}

export interface AsrOptions {
  signal?: AbortSignal
  /** 专有名词提示（个人词典），提升人名/产品名识别率 */
  vocabulary?: string[]
}

export interface AsrProvider {
  transcribe(wav: Buffer, opts?: AsrOptions): Promise<AsrResult>
}

const ASR_TIMEOUT_MS = 45_000

/** whisper 系 prompt 只看末尾 ~224 token：控制长度，词典越靠前（最近添加）越优先 */
function vocabularyPrompt(words?: string[]): string {
  const list = (words ?? []).map((w) => w.trim()).filter(Boolean)
  let out = ''
  for (const w of list) {
    const next = out ? `${out}, ${w}` : w
    if (next.length > 400) break
    out = next
  }
  return out
}

function withTimeout(signal?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(ASR_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, t]) : t
}

export class OpenAiCompatAsr implements AsrProvider {
  private readonly baseUrl: string
  private readonly model: string
  private readonly apiKey: string

  constructor(baseUrl: string, model: string, apiKey: string) {
    this.baseUrl = baseUrl
    this.model = model
    this.apiKey = apiKey
  }

  async transcribe(wav: Buffer, opts?: AsrOptions): Promise<AsrResult> {
    if (!this.apiKey) throw new Error('ASR_API_KEY_MISSING')
    const url = joinUrl(this.baseUrl, '/audio/transcriptions')
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), `dictation-${Date.now()}.wav`)
    form.append('model', this.model)
    const prompt = vocabularyPrompt(opts?.vocabulary)
    if (prompt) form.append('prompt', prompt)
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: withTimeout(opts?.signal)
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`ASR_HTTP_${res.status}: ${detail.slice(0, 300)}`)
    }
    const json = (await res.json()) as { text?: string; language?: string; duration?: number }
    return {
      text: (json.text ?? '').trim(),
      language: json.language,
      durationSec: json.duration
    }
  }
}

/**
 * 本地 whisper.cpp server（离线隐私模式）
 * 协议: whisper.cpp examples/server 的 /inference（multipart: file + response_format）
 * 启动示例: whisper-server -m <model.ggml> --host 127.0.0.1 --port 8178
 * macOS 安装: brew install whisper-cpp（模型从 huggingface ggerganov/whisper.cpp 下载 ggml 文件）
 */
export class LocalWhisperAsr implements AsrProvider {
  /**
   * @param baseUrl 服务地址；内置引擎传异步函数（先确保进程已启动）
   * @param language 'auto' 或 ISO-639-1；显式语言可省掉一次语言检测（server 默认强制 en，不能不传）
   */
  private readonly baseUrl: string | (() => Promise<string>)
  private readonly language: string
  private readonly stylePrompt: string

  /** @param stylePrompt 书写风格引导（如中文用简体与中文标点），放在词典提示之前 */
  constructor(baseUrl: string | (() => Promise<string>), language = 'auto', stylePrompt = '') {
    this.baseUrl = baseUrl
    this.language = language
    this.stylePrompt = stylePrompt
  }

  async transcribe(wav: Buffer, opts?: AsrOptions): Promise<AsrResult> {
    const base = typeof this.baseUrl === 'string' ? this.baseUrl : await this.baseUrl()
    const url = joinUrl(base, '/inference')
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), `dictation-${Date.now()}.wav`)
    form.append('response_format', 'json')
    form.append('language', this.language)
    const prompt = [this.stylePrompt, vocabularyPrompt(opts?.vocabulary)].filter(Boolean).join(' ')
    if (prompt) form.append('prompt', prompt)
    const res = await fetch(url, {
      method: 'POST',
      body: form,
      signal: withTimeout(opts?.signal)
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`LOCAL_ASR_HTTP_${res.status}: ${detail.slice(0, 300)}`)
    }
    const json = (await res.json()) as { text?: string }
    return { text: joinSegments(json.text ?? '') }
  }
}

/** whisper 按分段输出、段间带换行：中文段直接相连，其余补一个空格 */
export function joinSegments(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  let out = ''
  for (const line of lines) {
    if (!out) out = line
    else if (/[\p{Script=Han}，。！？、；：,.!?]$/u.test(out) || /^\p{Script=Han}/u.test(line)) out += line
    else out += ` ${line}`
  }
  return out
}

export async function checkLocalAsrHealth(baseUrl: string): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch(joinUrl(baseUrl, '/health'), { signal: AbortSignal.timeout(2500) })
    if (res.ok) return { ok: true, detail: await res.text() }
    return { ok: false, detail: `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

export function createAsrProvider(settings: Settings, apiKey: string): AsrProvider {
  switch (settings.asr.provider) {
    case 'local-whisper':
      return new LocalWhisperAsr(settings.asr.baseUrl)
    case 'openai':
    default:
      return new OpenAiCompatAsr(settings.asr.baseUrl, settings.asr.model, apiKey)
  }
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path
}
