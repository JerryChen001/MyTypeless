import type { FeatureMode } from '../shared/types'

/**
 * 按键时序（D-010）。纯逻辑，不依赖 electron，便于测试：
 * - 主键：按住 = 按住说话（松开结束）；轻按（TAP_MS 内松开）= 免手持；免手持或其他模式录音中再按 = 结束
 * - abort：按住主键时被当成组合键用了（或切到 Fn+空格 等组合）→ 取消本次
 * - 模式键（提问 / 翻译 / 单独绑定的改写）：按一下开始并进入免手持，再按一下结束
 */

export const TAP_MS = 300

export interface PressSession {
  isActive(): boolean
  isBusy(): boolean
  start(mode: FeatureMode): Promise<void>
  stop(): Promise<void>
  cancel(): void
  enterHandsFree(): void
}

export function createKeyHandlers(session: PressSession, now: () => number = Date.now) {
  let pressAt = 0
  /** 本次主键按下开始了会话：松开时据按住时长决定结束还是进入免手持 */
  let pressStarted = false

  function onMainKey(phase: 'down' | 'up' | 'abort'): void {
    if (phase === 'down') {
      pressStarted = false
      if (session.isActive()) {
        void session.stop()
        return
      }
      if (session.isBusy()) return
      pressAt = now()
      pressStarted = true
      void session.start('dictation')
    } else if (phase === 'up') {
      if (!pressStarted) return
      pressStarted = false
      if (!session.isActive()) return
      if (now() - pressAt < TAP_MS) session.enterHandsFree()
      else void session.stop()
    } else if (pressStarted) {
      pressStarted = false
      session.cancel()
    }
  }

  function onModeKey(mode: FeatureMode): void {
    if (session.isActive()) {
      void session.stop()
      return
    }
    if (session.isBusy()) return
    void session.start(mode).then(() => session.enterHandsFree())
  }

  return { onMainKey, onModeKey }
}
