import { globalShortcut } from 'electron'
import { loadSettings } from './config'
import { HotkeyWatcher, type HotkeyMatchConfig } from './native'
import type { FeatureMode } from '../shared/types'
import { createKeyHandlers } from './key-press'
import { parseBinding } from './bindings'

/**
 * 热键控制器（按住 Fn 说话的交互，D-010）
 * - 主键（听写，默认 macOS Fn、Windows 右 Ctrl）：按住 = 按住说话，松开写入；轻按（TAP_MS 内松开）= 免手持，再按一下结束；
 *   开始时若有选中文字，会话自动转为改写
 * - 提问 / 翻译 / 改写（如单独绑定）：按一下开始（免手持），再按一下或按主键结束
 * - 按住 Fn 时又按了空格 / Shift：原生助手先 abort 听写，再触发对应组合
 * - 原生助手优先（macOS CGEventTap / Windows 低级键盘钩子；吞触发键、可感知抬起）；绑定解析见 bindings.ts；
 *   不可用时（典型：尚未授予辅助功能）回退 globalShortcut —— 感知不到抬起，hold 退化为触发式，
 *   并定期重试原生助手，授权后自动切回。
 */

const NATIVE_RETRY_MS = 4000
/** 主键无法用 globalShortcut 表达（如 Fn）时，兜底模式下的替代键 */
const FALLBACK_MAIN_ACCELERATOR = 'Alt+Space'

interface Binding {
  mode: FeatureMode
  combo: string
}

export class HotkeyController {
  private watcher: HotkeyWatcher | null = null
  private fallbackRegistered = new Set<string>()
  private nativeReady = false
  private retryTimer: NodeJS.Timeout | null = null
  private bindings: Binding[] = []
  private lastFailure = ''
  private readonly keys: ReturnType<typeof createKeyHandlers>

  constructor(
    private readonly sessionHandler: {
      isActive(): boolean
      isBusy(): boolean
      activeMode(): FeatureMode | null
      start(mode: FeatureMode): Promise<void>
      stop(): Promise<void>
      cancel(): void
      enterHandsFree(): void
    }
  ) {
    this.keys = createKeyHandlers(sessionHandler)
  }

  registerAll(): void {
    this.unregisterAll()
    const settings = loadSettings()
    this.bindings = [
      { mode: 'dictation', combo: settings.bindings?.dictation || settings.hotkeyKey },
      { mode: 'translate', combo: settings.bindings?.translate ?? '' },
      { mode: 'rewrite', combo: settings.bindings?.rewrite ?? '' },
      { mode: 'ask', combo: settings.bindings?.ask ?? '' }
    ]
    this.registerFallback() // 兜底先行；原生 ready 后自动卸载
    this.startNative()
  }

  private startNative(): void {
    const matches: HotkeyMatchConfig[] = []
    for (const b of this.bindings) {
      const parsed = parseBinding(b.mode, b.combo)
      if (parsed) matches.push(parsed.match)
    }
    if (!matches.length) return

    this.watcher = new HotkeyWatcher(
      matches,
      (ev) => {
        if (ev.phase === 'ready') {
          this.nativeReady = true
          this.lastFailure = ''
          this.unregisterFallback()
          return
        }
        const binding = this.bindings.find((b) => b.mode === ev.name)
        if (!binding) return
        if (binding.mode === 'dictation') this.keys.onMainKey(ev.phase)
        else if (ev.phase === 'down') this.keys.onModeKey(binding.mode)
      },
      (reason) => {
        if (reason !== this.lastFailure) console.warn('[hotkey] native unavailable:', reason)
        this.lastFailure = reason
        this.nativeReady = false
        this.watcher = null
        this.registerFallback()
        // 无权限 / 崩溃：定期重试，用户在系统设置里授权后无需重启 app
        if (reason !== 'helper-missing') this.scheduleNativeRetry()
      }
    )
    this.watcher.start()
  }

  private scheduleNativeRetry(): void {
    if (this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (!this.nativeReady && !this.watcher) this.startNative()
    }, NATIVE_RETRY_MS)
  }

  private registerFallback(): void {
    for (const b of this.bindings) {
      // globalShortcut 感知不了抬起：一律按“按一下开始、再按一下结束”处理；Fn 这类主键换成替代键
      const parsed = parseBinding(b.mode, b.combo)
      const accelerator = parsed?.accelerator ?? (b.mode === 'dictation' ? FALLBACK_MAIN_ACCELERATOR : null)
      if (!accelerator || this.fallbackRegistered.has(accelerator)) continue
      try {
        if (globalShortcut.register(accelerator, () => this.keys.onModeKey(b.mode))) {
          this.fallbackRegistered.add(accelerator)
        }
      } catch {
        /* 非法加速键忽略 */
      }
    }
  }

  private unregisterFallback(): void {
    for (const accel of this.fallbackRegistered) {
      try {
        globalShortcut.unregister(accel)
      } catch {
        /* noop */
      }
    }
    this.fallbackRegistered.clear()
  }

  isNativeReady(): boolean {
    return this.nativeReady
  }

  unregisterAll(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.watcher?.stop()
    this.watcher = null
    this.nativeReady = false
    this.unregisterFallback()
  }
}
