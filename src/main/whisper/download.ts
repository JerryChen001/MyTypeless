import { createHash } from 'crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, statfsSync, unlinkSync } from 'fs'
import { once } from 'events'
import { dirname } from 'path'

/**
 * 大文件下载（模型用）：断点续传（.part + Range）、多源依次尝试（失败时保留已下载部分换源继续）、
 * 磁盘空间预检、连接/卡顿超时、SHA256 校验后原子改名。不依赖 electron，便于测试。
 */

export type DownloadErrorCode = 'DISK_FULL' | 'NETWORK' | 'CHECKSUM' | 'ABORTED'

export class DownloadError extends Error {
  readonly code: DownloadErrorCode
  constructor(code: DownloadErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export interface DownloadProgress {
  phase: 'downloading' | 'verifying'
  receivedBytes: number
  totalBytes: number
  bytesPerSec: number
}

export interface DownloadOptions {
  urls: string[]
  dest: string
  sizeBytes: number
  sha256: string
  signal?: AbortSignal
  onProgress?: (p: DownloadProgress) => void
  /** 收到响应头 / 两次数据之间允许的最长等待 */
  stallTimeoutMs?: number
}

const PROGRESS_INTERVAL_MS = 200
const DISK_MARGIN_BYTES = 50 * 1024 * 1024

export async function downloadFile(opts: DownloadOptions): Promise<void> {
  const part = `${opts.dest}.part`
  mkdirSync(dirname(opts.dest), { recursive: true })
  const partSize = () => (existsSync(part) ? statSync(part).size : 0)

  const { bavail, bsize } = statfsSync(dirname(opts.dest))
  if (bavail * bsize < opts.sizeBytes - partSize() + DISK_MARGIN_BYTES) {
    throw new DownloadError('DISK_FULL', '磁盘空间不足')
  }

  let lastError = ''
  // 每个源最多两轮；连接中断时保留 .part，从断点继续（可能换到下一个源）
  attempts: for (let round = 0; round < 2; round++) {
    for (const url of opts.urls) {
      if (partSize() >= opts.sizeBytes) break attempts
      try {
        await fetchInto(url, part, partSize(), opts)
        if (partSize() >= opts.sizeBytes) break attempts
        lastError = '连接中断'
      } catch (err) {
        if (opts.signal?.aborted) throw new DownloadError('ABORTED', '已取消')
        lastError = err instanceof Error ? err.message : String(err)
      }
    }
  }
  if (partSize() < opts.sizeBytes) throw new DownloadError('NETWORK', `下载失败：${lastError || '连接中断'}`)

  opts.onProgress?.({ phase: 'verifying', receivedBytes: opts.sizeBytes, totalBytes: opts.sizeBytes, bytesPerSec: 0 })
  const digest = await sha256File(part)
  if (partSize() !== opts.sizeBytes || digest !== opts.sha256) {
    unlinkSync(part)
    throw new DownloadError('CHECKSUM', '文件校验失败，已删除，请重新下载')
  }
  renameSync(part, opts.dest)
}

async function fetchInto(url: string, part: string, offset: number, opts: DownloadOptions): Promise<void> {
  const stallMs = opts.stallTimeoutMs ?? 20_000
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  opts.signal?.addEventListener('abort', onAbort)
  let stallTimer = setTimeout(() => ctrl.abort(), stallMs)
  const bump = () => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(() => ctrl.abort(), stallMs)
  }

  try {
    const res = await fetch(url, {
      headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
      signal: ctrl.signal,
      redirect: 'follow'
    })
    bump()
    if (res.status === 416) return // 已完整
    if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`)
    if (!res.body) throw new Error('空响应')
    // 服务器忽略 Range（返回 200）时从头开始
    const append = res.status === 206 && offset > 0
    let received = append ? offset : 0
    const out = createWriteStream(part, { flags: append ? 'a' : 'w' })

    let windowStart = Date.now()
    let windowBytes = 0
    let lastReport = 0
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        bump()
        if (!out.write(chunk)) await once(out, 'drain')
        received += chunk.length
        windowBytes += chunk.length
        const now = Date.now()
        if (now - lastReport >= PROGRESS_INTERVAL_MS) {
          const secs = Math.max(0.001, (now - windowStart) / 1000)
          opts.onProgress?.({ phase: 'downloading', receivedBytes: received, totalBytes: opts.sizeBytes, bytesPerSec: windowBytes / secs })
          lastReport = now
          if (now - windowStart > 2000) {
            windowStart = now
            windowBytes = 0
          }
        }
      }
    } finally {
      out.end()
      await once(out, 'close')
    }
  } catch (err) {
    if (ctrl.signal.aborted && !opts.signal?.aborted) throw new Error('连接超时')
    throw err
  } finally {
    clearTimeout(stallTimer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })) hash.update(chunk as Buffer)
  return hash.digest('hex')
}
