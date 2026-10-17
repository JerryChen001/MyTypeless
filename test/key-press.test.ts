// 按键时序（D-010）：按住说话 / 轻按免手持 / 组合键撤销 / 模式键
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createKeyHandlers, TAP_MS, type PressSession } from '../src/main/key-press.ts'
import type { FeatureMode } from '../src/shared/types.ts'

/** 模拟会话：记录调用，phase 同步变化（与 DictationSessionManager 一致：start 同步进入录音） */
function fakeSession() {
  const calls: string[] = []
  let phase: 'idle' | 'recording' | 'processing' = 'idle'
  let handsFree = false
  const s: PressSession & { calls: string[]; handsFree(): boolean; finishProcessing(): void } = {
    calls,
    handsFree: () => handsFree,
    finishProcessing: () => (phase = 'idle'),
    isActive: () => phase === 'recording',
    isBusy: () => phase !== 'idle',
    start: async (mode: FeatureMode) => {
      calls.push(`start:${mode}`)
      phase = 'recording'
      handsFree = false
    },
    stop: async () => {
      calls.push('stop')
      phase = 'processing'
    },
    cancel: () => {
      calls.push('cancel')
      phase = 'idle'
    },
    enterHandsFree: () => {
      calls.push('handsFree')
      handsFree = true
    }
  }
  return s
}

function clock() {
  let t = 1000
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

test('按住说话：按住超过阈值后松开 → 结束并写入', () => {
  const s = fakeSession()
  const c = clock()
  const k = createKeyHandlers(s, c.now)
  k.onMainKey('down')
  c.advance(TAP_MS + 500)
  k.onMainKey('up')
  assert.deepEqual(s.calls, ['start:dictation', 'stop'])
})

test('轻按：阈值内松开 → 进入免手持，继续录音；再按一下 → 结束，随后的松开被忽略', () => {
  const s = fakeSession()
  const c = clock()
  const k = createKeyHandlers(s, c.now)
  k.onMainKey('down')
  c.advance(120)
  k.onMainKey('up')
  assert.deepEqual(s.calls, ['start:dictation', 'handsFree'])
  assert.equal(s.isActive(), true)
  c.advance(5000)
  k.onMainKey('down')
  c.advance(80)
  k.onMainKey('up')
  assert.deepEqual(s.calls, ['start:dictation', 'handsFree', 'stop'])
})

test('按住主键时被当成组合键（abort）→ 取消，不写入', () => {
  const s = fakeSession()
  const k = createKeyHandlers(s, clock().now)
  k.onMainKey('down')
  k.onMainKey('abort')
  assert.deepEqual(s.calls, ['start:dictation', 'cancel'])
})

test('Fn+空格：先撤销听写，再开始提问（免手持）；按主键结束提问', async () => {
  const s = fakeSession()
  const c = clock()
  const k = createKeyHandlers(s, c.now)
  k.onMainKey('down')
  k.onMainKey('abort') // 原生助手：abort 听写
  k.onModeKey('ask') // 原生助手：down 提问
  await Promise.resolve()
  c.advance(500)
  k.onMainKey('up') // 松开 Fn：本次按下已被 abort，不应结束提问
  assert.deepEqual(s.calls, ['start:dictation', 'cancel', 'start:ask', 'handsFree'])
  assert.equal(s.isActive(), true)
  k.onMainKey('down') // 再按 Fn：结束提问
  assert.deepEqual(s.calls.at(-1), 'stop')
})

test('处理中（识别/润色）按键不开始新会话', () => {
  const s = fakeSession()
  const c = clock()
  const k = createKeyHandlers(s, c.now)
  k.onMainKey('down')
  c.advance(800)
  k.onMainKey('up') // stop → processing
  k.onMainKey('down')
  k.onMainKey('up')
  k.onModeKey('translate')
  assert.deepEqual(s.calls, ['start:dictation', 'stop'])
  s.finishProcessing()
  k.onModeKey('translate')
  assert.equal(s.calls.at(-1), 'start:translate')
})

test('模式键：按一下开始，再按一下结束', async () => {
  const s = fakeSession()
  const k = createKeyHandlers(s, clock().now)
  k.onModeKey('translate')
  await Promise.resolve()
  k.onModeKey('translate')
  assert.deepEqual(s.calls, ['start:translate', 'handsFree', 'stop'])
})
