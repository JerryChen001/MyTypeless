import { test } from 'node:test'
import assert from 'node:assert/strict'
import { comboKeys, micPermissionHint, pasteShortcut } from '../src/shared/platform.ts'

test('comboKeys：macOS 保持原有符号', () => {
  assert.deepEqual(comboKeys('fn', 'darwin'), ['fn'])
  assert.deepEqual(comboKeys('fn+space', 'darwin'), ['fn', '空格'])
  assert.deepEqual(comboKeys('opt+shift+t', 'darwin'), ['⌥', '⇧', 'T'])
  assert.deepEqual(comboKeys('ropt', 'darwin'), ['右⌥'])
})

test('comboKeys：Windows 用 Ctrl / Alt / Win 文字键名', () => {
  assert.deepEqual(comboKeys('rctrl', 'win32'), ['右Ctrl'])
  assert.deepEqual(comboKeys('rctrl+space', 'win32'), ['右Ctrl', '空格'])
  assert.deepEqual(comboKeys('opt+space', 'win32'), ['Alt', '空格'])
  assert.deepEqual(comboKeys('cmd+shift+a', 'win32'), ['Win', 'Shift', 'A'])
})

test('comboKeys：大小写与空格不影响，空段忽略', () => {
  assert.deepEqual(comboKeys(' Fn + Shift ', 'darwin'), ['fn', '⇧'])
  assert.deepEqual(comboKeys('', 'win32'), [])
})

test('粘贴快捷键与麦克风提示按平台区分', () => {
  assert.equal(pasteShortcut('darwin'), '⌘V')
  assert.equal(pasteShortcut('win32'), 'Ctrl+V')
  assert.match(micPermissionHint('darwin'), /隐私与安全性/)
  assert.match(micPermissionHint('win32'), /允许桌面应用访问麦克风/)
})
