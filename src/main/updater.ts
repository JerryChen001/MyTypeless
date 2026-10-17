import { app, Notification } from 'electron'
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { autoUpdater, CancellationToken, type UpdateInfo } from 'electron-updater'
import type { UpdateState } from '../shared/types'
import { friendlyUpdateError, pendingIsInstalled, UPDATE_FIRST_CHECK_MS, UPDATE_INTERVAL_MS, UPDATER_CACHE_DIR, updateUrl } from './update-info'

/**
 * 在线更新（D-028）：定时检查发布地址的 latest-mac.yml → 发现新版本时提示 → 用户确认后应用内下载 →
 * 下载完提示重启更新（Squirrel.Mac 替换应用，要求新版本与当前应用签名证书相同）。
 * 只读取发布地址的版本说明和安装包，不发送任何用户数据。
 */
export interface UpdaterOptions {
  /** 自动检查开关（设置 autoCheckUpdates） */
  enabled: () => boolean
  /** 正在录音、会议或整理中时返回原因，拒绝重启 */
  busyReason: () => string | null
  onState: (s: UpdateState) => void
  /** 点击系统通知：打开主窗口的「关于」 */
  showAbout: () => void
}

let opts: UpdaterOptions | null = null
let state: UpdateState = { state: 'idle' }
let cancelToken: CancellationToken | null = null
let timer: NodeJS.Timeout | null = null
let notified = '' // 已通知过的版本（每个版本只弹一次系统通知）
let manualCheck = false

function log(...parts: unknown[]): void {
  try {
    const dir = app.getPath('logs')
    mkdirSync(dir, { recursive: true })
    const line = parts.map((p) => (typeof p === 'string' ? p : p instanceof Error ? p.message : JSON.stringify(p))).join(' ')
    appendFileSync(join(dir, 'update.log'), `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    /* noop */
  }
}

function set(next: UpdateState): void {
  state = next
  opts?.onState(state)
}

function infoFields(info: UpdateInfo): Pick<UpdateState, 'version' | 'build' | 'notes' | 'dmgUrl'> {
  const extra = info as UpdateInfo & { build?: string; dmgUrl?: string }
  const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes : (info.releaseNotes ?? []).map((n) => n.note ?? '').join('\n')
  return { version: info.version, build: extra.build, notes: notes.trim() || undefined, dmgUrl: extra.dmgUrl }
}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body })
  n.on('click', () => opts?.showAbout())
  n.show()
}

/** 更新完成后删掉缓存里已装上的安装包（electron-updater 要等下一次下载才清理） */
function cleanInstalledDownload(): void {
  const dir = join(app.getPath('home'), 'Library/Caches', UPDATER_CACHE_DIR, 'pending')
  try {
    const info = JSON.parse(readFileSync(join(dir, 'update-info.json'), 'utf-8')) as { fileName?: string }
    if (pendingIsInstalled(info.fileName ?? '', app.getVersion())) {
      rmSync(dir, { recursive: true, force: true })
      log('removed installed download', info.fileName)
    }
  } catch {
    /* 没有缓存 */
  }
}

/** 开发运行（未打包）不检查：Squirrel 只能替换打包好的应用；MT_UPDATE_URL 只用于打包版本机测试 */
export function updateSupported(): boolean {
  return app.isPackaged
}

export function initUpdater(o: UpdaterOptions): void {
  opts = o
  if (!updateSupported()) {
    state = { state: 'unsupported', error: '开发版不检查更新' }
    return
  }
  cleanInstalledDownload()
  autoUpdater.autoDownload = false // 发现新版本先提示，用户确认后才下载
  autoUpdater.autoInstallOnAppQuit = true // 下载完没点重启：下次退出时安装
  autoUpdater.allowDowngrade = false
  autoUpdater.disableDifferentialDownload = true // 安装包按版本放在不同目录，旧版本的分块信息找不到
  autoUpdater.logger = { info: (m) => log('info', m), warn: (m) => log('warn', m), error: (m) => log('error', m), debug: () => undefined }
  autoUpdater.setFeedURL({ provider: 'generic', url: updateUrl() })

  autoUpdater.on('checking-for-update', () => set({ ...state, state: 'checking', error: undefined }))
  autoUpdater.on('update-not-available', () => set({ state: 'latest', checkedAt: Date.now() }))
  autoUpdater.on('update-available', (info) => {
    set({ state: 'available', ...infoFields(info), checkedAt: Date.now() })
    if (!manualCheck && notified !== info.version) {
      notified = info.version
      notify(`MyTypeless 有新版本 ${info.version}`, '点击查看更新内容并下载')
    }
  })
  autoUpdater.on('download-progress', (p) => {
    if (state.state !== 'downloading') return
    set({ ...state, percent: Math.floor(p.percent), bytesPerSec: p.bytesPerSecond })
  })
  autoUpdater.on('update-downloaded', (info) => {
    cancelToken = null
    set({ state: 'downloaded', ...infoFields(info), checkedAt: state.checkedAt })
    notify(`新版本 ${info.version} 已下载`, '重启 MyTypeless 即可完成更新')
  })
  autoUpdater.on('error', (err) => {
    log('error event', err)
    // 下载被取消：回到“有新版本”
    if (cancelToken?.cancelled) return
    cancelToken = null
    // 自动检查失败（没网、地址暂不可达）不打扰：保留上次的结果
    if (state.state === 'checking' && !manualCheck) {
      set({ ...state, state: state.version ? 'available' : 'idle' })
      return
    }
    set({ ...state, state: 'error', error: friendlyUpdateError(err?.message ?? String(err)) })
  })

  schedule()
}

/** 按设置开 / 关定时检查（设置保存后调用） */
export function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (!opts || !updateSupported() || !opts.enabled()) return
  const tick = (): void => {
    timer = setTimeout(tick, UPDATE_INTERVAL_MS)
    if (opts?.enabled()) void check(false)
  }
  timer = setTimeout(tick, state.checkedAt ? UPDATE_INTERVAL_MS : UPDATE_FIRST_CHECK_MS)
}

export function updateState(): UpdateState {
  return state
}

/** 检查新版本；下载中或已下载时不重复检查 */
export async function check(manual = true): Promise<UpdateState> {
  if (!updateSupported() || ['checking', 'downloading', 'downloaded'].includes(state.state)) return state
  manualCheck = manual
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    log('check failed', err)
    // error 事件已更新状态；这里兜底没有触发事件的情况
    if (state.state === 'checking') {
      if (manual) set({ ...state, state: 'error', error: friendlyUpdateError((err as Error)?.message ?? String(err)) })
      else set({ ...state, state: state.version ? 'available' : 'idle' })
    }
  }
  return state
}

/** 用户确认后下载（进度经 onState 推送） */
export function download(): UpdateState {
  if (state.state !== 'available' && !(state.state === 'error' && state.version)) return state
  cancelToken = new CancellationToken()
  const token = cancelToken
  set({ ...state, state: 'downloading', percent: 0, bytesPerSec: undefined, error: undefined })
  autoUpdater.downloadUpdate(token).catch((err) => {
    if (token.cancelled) set({ ...state, state: 'available', percent: undefined, bytesPerSec: undefined })
    else log('download failed', err)
  })
  return state
}

export function cancelDownload(): UpdateState {
  if (state.state === 'downloading') cancelToken?.cancel()
  return state
}

/** 重启并安装；录音、会议或整理中时拒绝 */
export function install(): { ok: boolean; error?: string } {
  if (state.state !== 'downloaded') return { ok: false, error: '新版本还没有下载完成' }
  const busy = opts?.busyReason()
  if (busy) return { ok: false, error: busy }
  log('quitAndInstall', state.version)
  setImmediate(() => autoUpdater.quitAndInstall())
  return { ok: true }
}
