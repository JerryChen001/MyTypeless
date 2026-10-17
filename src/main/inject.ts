import { execFile } from 'child_process'
import { clipboard, systemPreferences } from 'electron'
import { injectWithHelper, helperPath } from './native'

/**
 * M2 文字注入：原生三级降级链（原创实现）
 * 1) CGEvent 键入（不污染剪贴板，原生 helper）
 * 2) 原生粘贴（写剪贴板 + Cmd+V + 完整恢复剪贴板）
 * 3) osascript 粘贴（历史兜底）
 * M3: captureSelectedText —— 原生 helper 模拟 Cmd+C 抓取选中文本（剪贴板完整恢复）
 */

export interface InjectResult {
  ok: boolean
  method: 'type' | 'paste-native' | 'paste-osascript'
  error?: string
}

/** 键入超过这个长度或含换行时 auto 模式改走粘贴：逐字键入慢，且换行在聊天类 app 里会直接发送 */
const TYPE_MAX_CHARS = 160

/** 辅助功能权限（mt-* 助手由本 app 派生，TCC 归属同一个 app） */
export async function checkAccessibility(prompt = false): Promise<boolean> {
  return systemPreferences.isTrustedAccessibilityClient(prompt)
}

export async function openAccessibilitySettings(): Promise<void> {
  execFile('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'])
}

/** 抓取当前选中文本；没有选中内容时返回 null */
export async function captureSelectedText(): Promise<string | null> {
  const bin = helperPath('mt-inject')
  if (bin) {
    return new Promise((resolve) => {
      execFile(bin, ['--copy-selection'], { timeout: 4000 }, (err, stdout) => {
        if (err) return resolve(null)
        const text = Buffer.from(stdout.trim(), 'base64').toString('utf-8')
        resolve(text || null)
      })
    })
  }
  return captureSelectedTextViaOsascript()
}

/** helper 缺失时的兜底：哨兵剪贴板 → osascript Cmd+C → 读回 → 恢复（仅纯文本） */
async function captureSelectedTextViaOsascript(): Promise<string | null> {
  const backup = clipboard.readText()
  const sentinel = `__mt_sentinel_${Date.now()}__`
  clipboard.writeText(sentinel)
  const ok = await new Promise<boolean>((resolve) => {
    execFile(
      'osascript',
      ['-e', 'tell application "System Events" to keystroke "c" using command down'],
      { timeout: 3000 },
      (err) => resolve(!err)
    )
  })
  let text = ''
  if (ok) {
    for (let i = 0; i < 15; i++) {
      await delay(40)
      text = clipboard.readText()
      if (text !== sentinel) break
    }
  }
  clipboard.writeText(backup)
  if (!text || text === sentinel) return null
  return text
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function injectText(text: string, method: 'auto' | 'type' | 'paste' = 'auto'): Promise<InjectResult> {
  const preferType = method === 'type' || (method === 'auto' && text.length <= TYPE_MAX_CHARS && !/[\r\n]/.test(text))
  if (preferType) {
    const r = await injectWithHelper(text, 'type')
    if (r.ok) return { ok: true, method: 'type' }
    if (method === 'type') return { ok: false, method: 'type', error: r.error }
  }
  // 粘贴路径
  const r = await injectWithHelper(text, 'paste')
  if (r.ok) return { ok: true, method: 'paste-native' }
  if (r.code === 3) return { ok: false, method: 'paste-native', error: '未授予辅助功能权限' }
  return injectTextViaPasteOsascript(text)
}

/** osascript 粘贴兜底（剪贴板备份/恢复） */
async function injectTextViaPasteOsascript(text: string): Promise<InjectResult> {
  const backup = clipboard.readText()
  const backupHtml = clipboard.readHTML()
  clipboard.writeText(text)
  try {
    await runKeystrokePaste()
    setTimeout(() => {
      try {
        if (clipboard.readText() !== text) return // 期间用户复制了别的内容，不覆盖
        clipboard.writeText(backup)
        if (backupHtml) clipboard.writeHTML(backupHtml)
      } catch {
        /* 忽略恢复失败 */
      }
    }, 600)
    return { ok: true, method: 'paste-osascript' }
  } catch (err) {
    return {
      ok: false,
      method: 'paste-osascript',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

function runKeystrokePaste(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-e', 'tell application "System Events" to keystroke "v" using command down'],
      { timeout: 4000 },
      (err) => (err ? reject(err) : resolve())
    )
  })
}
