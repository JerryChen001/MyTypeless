import { spawn, type ChildProcess } from 'child_process'
import { setPriority } from 'os'
import { createInterface } from 'readline'
import { helperPath } from './native'

/**
 * sherpa-onnx 助手 mt-diarize 的常驻进程（一行命令对应一行结果，按顺序配对）。
 * 同一个程序按启动参数承担不同工作，各开一个进程互不排队：会议声纹、会议边录边降噪（meeting/diarizer.ts）、
 * 内置中文识别（whisper/index.ts，D-027）。协议见 docs/contracts/native-helpers.md。
 */

const START_TIMEOUT_MS = 30_000 // 识别模型约 1.2GB，冷启动加载约 2 秒；磁盘慢时留足余量

type Reply = { ok?: boolean; v?: number[]; turns?: Array<[number, number, number]>; at?: number; pcm?: string; text?: string; error?: string } | null
type Waiter = { resolve: (r: Reply) => void }

export interface HelperOptions {
  /** 启动参数；模型未就绪时返回 null（不启动） */
  args: () => string[] | null
  /** 闲置多久后退出释放内存 */
  idleMs: number
  /** 调度优先级（nice）：会议后台工作 15，让位给用户；听写识别 0，要快 */
  nice: number
}

export class SherpaHelper {
  constructor(private readonly opts: HelperOptions) {}

  private child: ChildProcess | null = null
  private starting: Promise<boolean> | null = null
  private waiters: Waiter[] = []
  private idleTimer: NodeJS.Timeout | null = null

  /** 计算 pcm 文件中 [start, start+count) 这段的声音特征；不可用时返回 null */
  async embed(pcmFile: string, start: number, count: number): Promise<Float32Array | null> {
    const r = await this.send(`embed ${start} ${count} ${pcmFile}`)
    if (r && !r.ok) console.warn('[sherpa] mt-diarize embed failed:', r.error)
    return r?.ok && r.v ? Float32Array.from(r.v) : null
  }

  /** 一段话内部的说话人轮次（相对该段的样本下标，标签只在该段内有意义）；不可用时返回 null */
  async turns(pcmFile: string, start: number, count: number): Promise<Array<[number, number, number]> | null> {
    const r = await this.send(`turns ${start} ${count} ${pcmFile}`)
    return r?.ok && r.turns ? r.turns : null
  }

  /** 边录边降噪：把 [start, start+count) 接着送入，返回已能输出的降噪音频（at = 其起点，与录音时间线对齐） */
  async denoiseFeed(pcmFile: string, start: number, count: number): Promise<{ at: number; pcm: Int16Array } | null> {
    return decodePcm(await this.send(`dnfeed ${start} ${count} ${pcmFile}`))
  }

  /** 输出流式降噪剩余的部分并重置（暂停、结束时） */
  async denoiseFlush(): Promise<{ at: number; pcm: Int16Array } | null> {
    return decodePcm(await this.send('dnflush'))
  }

  /** 识别一段 16kHz 单声道音频（随命令传入，不写文件）；不可用或失败时返回 null */
  async transcribe(pcm: Int16Array): Promise<string | null> {
    const r = await this.send(`asr ${Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64')}`)
    if (r && !r.ok) console.warn('[sherpa] mt-diarize asr failed:', r.error)
    return r?.ok && typeof r.text === 'string' ? r.text : null
  }

  /** 预热：提前启动并加载模型（开口时调用，减少第一次识别的等待） */
  warm(): void {
    void this.ensure().then((ok) => ok && this.touch())
  }

  running(): boolean {
    return !!this.child
  }

  private async send(cmd: string): Promise<Reply> {
    if (!(await this.ensure())) return null
    this.touch()
    const child = this.child!
    return new Promise((resolve) => {
      this.waiters.push({ resolve })
      child.stdin!.write(`${cmd}\n`)
    })
  }

  stop(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    const child = this.child
    this.child = null
    this.starting = null
    for (const w of this.waiters.splice(0)) w.resolve(null)
    if (child && child.exitCode === null) child.kill('SIGTERM')
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.stop(), this.opts.idleMs)
  }

  private ensure(): Promise<boolean> {
    if (this.child && !this.starting) return Promise.resolve(true)
    if (this.starting) return this.starting
    const bin = helperPath('mt-diarize')
    const args = this.opts.args()
    if (!bin || !args) return Promise.resolve(false)
    this.starting = new Promise<boolean>((resolve) => {
      const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'] })
      try {
        if (child.pid && this.opts.nice) setPriority(child.pid, this.opts.nice)
      } catch {
        /* noop */
      }
      let ready = false
      const timer = setTimeout(() => {
        if (!ready) {
          child.kill('SIGTERM')
          resolve(false)
        }
      }, START_TIMEOUT_MS)
      createInterface({ input: child.stdout! }).on('line', (line) => {
        let msg: NonNullable<Reply> & { ready?: boolean }
        try {
          msg = JSON.parse(line)
        } catch {
          return
        }
        if (!ready) {
          if (msg.ready) {
            ready = true
            clearTimeout(timer)
            resolve(true)
          }
          return
        }
        this.waiters.shift()?.resolve(msg)
      })
      child.on('exit', () => {
        clearTimeout(timer)
        if (this.child === child) this.child = null
        for (const w of this.waiters.splice(0)) w.resolve(null)
        if (!ready) resolve(false)
      })
      child.on('error', () => undefined)
      child.stdin!.on('error', () => undefined)
      this.child = child
    }).finally(() => {
      this.starting = null
    })
    return this.starting
  }
}

function decodePcm(r: Reply): { at: number; pcm: Int16Array } | null {
  if (!r?.ok || r.at === undefined || r.pcm === undefined) return null
  const buf = Buffer.from(r.pcm, 'base64')
  return { at: r.at, pcm: new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + (buf.length & ~1))) }
}

