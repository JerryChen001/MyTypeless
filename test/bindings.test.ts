import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBinding } from '../src/main/bindings.ts'
import { defaultBindings } from '../src/shared/platform.ts'

test('parseBinding：单修饰键触发没有兜底加速键', () => {
  assert.deepEqual(parseBinding('dictation', 'fn'), { match: { name: 'dictation', key: 'fn', require: [] }, accelerator: null })
  assert.deepEqual(parseBinding('dictation', 'rctrl'), { match: { name: 'dictation', key: 'rctrl', require: [] }, accelerator: null })
})

test('parseBinding：通用修饰键组合有兜底加速键', () => {
  assert.deepEqual(parseBinding('ask', 'opt+space'), { match: { name: 'ask', key: 'space', require: ['opt'] }, accelerator: 'Alt+Space' })
  assert.deepEqual(parseBinding('translate', 'Ctrl + Shift + T'), { match: { name: 'translate', key: 't', require: ['ctrl', 'shift'] }, accelerator: 'Control+Shift+T' })
  assert.equal(parseBinding('x', 'cmd+f5')?.accelerator, 'Command+F5')
})

test('parseBinding：fn 与区分左右的修饰键只交给原生助手', () => {
  assert.deepEqual(parseBinding('ask', 'fn+space'), { match: { name: 'ask', key: 'space', require: ['fn'] }, accelerator: null })
  assert.deepEqual(parseBinding('ask', 'rctrl+space'), { match: { name: 'ask', key: 'space', require: ['rctrl'] }, accelerator: null })
  assert.deepEqual(parseBinding('translate', 'RightControl+shift'), { match: { name: 'translate', key: 'shift', require: ['rctrl'] }, accelerator: null })
  assert.deepEqual(parseBinding('x', 'ralt+k')?.match.require, ['ropt'])
})

test('parseBinding：空串与未知修饰键返回 null', () => {
  assert.equal(parseBinding('x', ''), null)
  assert.equal(parseBinding('x', 'hyper+k'), null)
})

test('默认快捷键：macOS 用 Fn，Windows 用右 Ctrl，且都能被解析；右 Shift 的翻译组合也能解析', () => {
  assert.deepEqual(defaultBindings('darwin'), { hotkeyKey: 'fn', bindings: { dictation: 'fn', translate: 'fn+shift', rewrite: '', ask: 'fn+space' } })
  const win = defaultBindings('win32')
  assert.deepEqual(win, { hotkeyKey: 'rctrl', bindings: { dictation: 'rctrl', translate: 'rctrl+shift', rewrite: '', ask: 'rctrl+space' } })
  assert.deepEqual(parseBinding('translate', 'rshift+ctrl')?.match, { name: 'translate', key: 'ctrl', require: ['rshift'] })
  for (const combo of [win.bindings.dictation, win.bindings.translate, win.bindings.ask]) assert.ok(parseBinding('m', combo))
})
