import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Windows 原生助手（GAP-008）的协议测试：只在 Windows 且已 npm run native:win 时运行
const bin = (name: string) => join(import.meta.dirname, '..', 'native', 'bin', `${name}.exe`)
const skip = process.platform !== 'win32' || !existsSync(bin('mt-inject')) ? '需要 Windows 与 npm run native:win' : false

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

// mt-inject 只测不会发出按键的路径；真实键入 / 粘贴 / 抓选区需要桌面，见运行记录里的隔离窗口端到端测试
test('mt-inject：参数错误、非法 base64、不支持的组合键退出码 2（不发送任何按键）', { skip }, () => {
  assert.equal(run('mt-inject', []).code, 2)
  assert.equal(run('mt-inject', ['@@@']).code, 2)
  assert.equal(run('mt-inject', ['--paste']).code, 2)
  assert.equal(run('mt-inject', ['--combo', 'ctrl+f13']).code, 2)
  assert.equal(run('mt-inject', ['--combo', 'hyper+c']).code, 2)
})

// mt-hotkey 的状态机用 --replay 测（不安装钩子）：物理按键无法由程序模拟，钩子本身需要真机验收
const HOTKEY_CFG = JSON.stringify({
  matches: [
    { name: 'dictation', key: 'rctrl' },
    { name: 'ask', key: 'space', require: ['rctrl'] },
    { name: 'translate', key: 'shift', require: ['rctrl'] }
  ]
})
const replay = (keys: string) =>
  run('mt-hotkey', [HOTKEY_CFG, '--replay'], keys)
    .out.trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const j = JSON.parse(l) as { name?: string; phase?: string; swallowed?: string }
      return j.swallowed ? `吞:${j.swallowed}` : `${j.name}:${j.phase}`
    })

test('mt-hotkey：按住右 Ctrl 说话，自动重复不重复触发，右 Ctrl 本身不吞', { skip }, () => {
  assert.deepEqual(replay('rctrl down\nrctrl down\nrctrl up\n'), ['dictation:down', 'dictation:up'])
})

test('mt-hotkey：右 Ctrl+空格 切到提问，空格（含重复）被吞', { skip }, () => {
  assert.deepEqual(replay('rctrl down\nspace down\nspace down\nspace up\nrctrl up\n'), [
    'dictation:down', 'dictation:abort', 'ask:down', '吞:space down', '吞:space down', 'ask:up', '吞:space up'
  ])
})

test('mt-hotkey：右 Ctrl+Shift 切到翻译，Shift 按下与抬起成对被吞（避免切换键盘布局）', { skip }, () => {
  assert.deepEqual(replay('rctrl down\nrshift down\nrshift up\nrctrl up\n'), [
    'dictation:down', 'dictation:abort', 'translate:down', '吞:rshift down', 'translate:up', '吞:rshift up'
  ])
})

test('mt-hotkey：右 Ctrl+其他键 = 普通组合键，abort 并放行；左 Ctrl+空格、单独 Shift 不触发', { skip }, () => {
  assert.deepEqual(replay('rctrl down\nc down\nc up\nrctrl up\n'), ['dictation:down', 'dictation:abort'])
  assert.deepEqual(replay('lctrl down\nspace down\nspace up\nlctrl up\nlshift down\nlshift up\n'), [])
})

test('mt-hotkey：先按着别的修饰键再按右 Ctrl 不触发；配置错误或只有 fn 时退出码 2', { skip }, () => {
  assert.deepEqual(replay('lshift down\nrctrl down\nrctrl up\nlshift up\n'), [])
  assert.equal(run('mt-hotkey', ['not json', '--replay']).code, 2)
  assert.equal(run('mt-hotkey', [JSON.stringify({ matches: [{ name: 'dictation', key: 'fn' }] }), '--replay']).code, 2)
})
