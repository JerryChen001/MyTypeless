import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Windows 原生助手（GAP-008）的协议测试：只在 Windows 且已 npm run native:win 时运行
const bin = (name: string) => join(import.meta.dirname, '..', 'native', 'bin', `${name}.exe`)
const skip = process.platform !== 'win32' || !existsSync(bin('mt-text')) ? '需要 Windows 与 npm run native:win' : false

function run(name: string, args: string[], input = '') {
  const r = spawnSync(bin(name), args, { input: Buffer.from(input, 'utf-8'), timeout: 5000 })
  return { code: r.status, out: r.stdout.toString('utf-8') }
}

test('mt-text：繁简互转，UTF-8 进出，换行原样保留', { skip }, () => {
  assert.deepEqual(run('mt-text', ['--to', 'hans'], '會議記錄\n第二行'), { code: 0, out: '会议记录\n第二行' })
  assert.deepEqual(run('mt-text', ['--to', 'hant'], '会议记录'), { code: 0, out: '會議記錄' })
  assert.deepEqual(run('mt-text', ['--to', 'hans'], 'Hello 123'), { code: 0, out: 'Hello 123' })
})

test('mt-text：参数错误退出码 2，空输入输出为空', { skip }, () => {
  assert.equal(run('mt-text', ['--to', 'xx']).code, 2)
  assert.equal(run('mt-text', []).code, 2)
  assert.deepEqual(run('mt-text', ['--to', 'hans'], ''), { code: 0, out: '' })
})

test('mt-focus：输出前台应用 JSON（没有前台窗口时为 {}）', { skip }, () => {
  const r = run('mt-focus', [])
  assert.equal(r.code, 0)
  const info = JSON.parse(r.out) as { bundleId?: string; name?: string; pid?: number }
  if (info.pid !== undefined) {
    assert.ok(info.pid > 0)
    assert.match(info.bundleId ?? '', /^[^A-Z]+$/) // 小写 exe 文件名
    assert.ok(info.name)
  }
})

test('mt-focus：激活不存在的进程退出码 2；参数错误 2；选区与光标上下文暂时读不到（5）', { skip }, () => {
  assert.equal(run('mt-focus', ['--activate', '4294967']).code, 2)
  assert.equal(run('mt-focus', ['--activate', 'abc']).code, 2)
  assert.equal(run('mt-focus', ['--bogus']).code, 2)
  assert.equal(run('mt-focus', ['--selected-text']).code, 5)
  assert.equal(run('mt-focus', ['--caret-context', '20', '20']).code, 5)
})
