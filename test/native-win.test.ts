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

// --selected-text / --caret-context 会真的读当前焦点输入框（可能是用户正在用的编辑器），这里只测参数；
// 读取本身用自建窗口端到端验证（见运行记录）
test('mt-focus：激活不存在的进程、参数错误退出码 2', { skip }, () => {
  assert.equal(run('mt-focus', ['--activate', '4294967']).code, 2)
  assert.equal(run('mt-focus', ['--activate', 'abc']).code, 2)
  assert.equal(run('mt-focus', ['--bogus']).code, 2)
  assert.equal(run('mt-focus', ['--caret-context', '-1', '5']).code, 2)
  assert.equal(run('mt-focus', ['--caret-context', '0', '0']).code, 2)
})

// mt-inject 只测不会发出按键的路径；真实键入 / 粘贴 / 抓选区需要桌面，见运行记录里的隔离窗口端到端测试
test('mt-inject：参数错误、非法 base64、不支持的组合键退出码 2（不发送任何按键）', { skip }, () => {
  assert.equal(run('mt-inject', []).code, 2)
  assert.equal(run('mt-inject', ['@@@']).code, 2)
  assert.equal(run('mt-inject', ['--paste']).code, 2)
  assert.equal(run('mt-inject', ['--combo', 'ctrl+f13']).code, 2)
  assert.equal(run('mt-inject', ['--combo', 'hyper+c']).code, 2)
})

// mt-hotkey 的状态机用 --replay 测（不安装钩子）：物理按键无法由程序模拟，钩子本身需要真机验收。
// "tick" = 单修饰键按住满 HOLD_MS（150ms）
const HOTKEY_CFG = JSON.stringify({
  matches: [
    { name: 'dictation', key: 'rshift' },
    { name: 'ask', key: 'space', require: ['rshift'] },
    { name: 'translate', key: 'ctrl', require: ['rshift'] }
  ]
})
const replay = (keys: string, cfg = HOTKEY_CFG) =>
  run('mt-hotkey', [cfg, '--replay'], keys)
    .out.trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const j = JSON.parse(l) as { name?: string; phase?: string; swallowed?: string; masked?: string }
      return j.swallowed ? `吞:${j.swallowed}` : j.masked ? `屏蔽菜单:${j.masked}` : `${j.name}:${j.phase}`
    })

test('mt-hotkey：按住右 Shift 满 150ms 才开始说话；自动重复不重复触发；轻按补发 down + up', { skip }, () => {
  assert.deepEqual(replay('rshift down\ntick\nrshift down\nrshift up\n'), ['dictation:down', 'dictation:up'])
  assert.deepEqual(replay('rshift down\nrshift up\n'), ['dictation:down', 'dictation:up'])
})

test('mt-hotkey：右 Shift+字母打大写（150ms 内）什么都不发；之后再按字母才 abort', { skip }, () => {
  assert.deepEqual(replay('rshift down\na down\na up\nrshift up\n'), [])
  assert.deepEqual(replay('rshift down\ntick\na down\na up\nrshift up\n'), ['dictation:down', 'dictation:abort'])
})

test('mt-hotkey：右 Shift+空格 提问、右 Shift+Ctrl 翻译，触发键被吞（Ctrl 成对吞，避免切换键盘布局）', { skip }, () => {
  assert.deepEqual(replay('rshift down\nspace down\nspace down\nspace up\nrshift up\n'), [
    'ask:down', '吞:space down', '吞:space down', 'ask:up', '吞:space up'
  ])
  assert.deepEqual(replay('rshift down\nlctrl down\nlctrl up\nrshift up\n'), ['translate:down', '吞:lctrl down', 'translate:up', '吞:lctrl up'])
  // 已开始说话后再组合：先 abort 听写再切过去
  assert.deepEqual(replay('rshift down\ntick\nspace down\nspace up\nrshift up\n'), [
    'dictation:down', 'dictation:abort', 'ask:down', '吞:space down', 'ask:up', '吞:space up'
  ])
})

test('mt-hotkey：左 Shift、先按着别的修饰键再按右 Shift 都不触发', { skip }, () => {
  assert.deepEqual(replay('lshift down\nlshift up\nspace down\nspace up\n'), [])
  assert.deepEqual(replay('lctrl down\nrshift down\ntick\nrshift up\nlctrl up\n'), [])
})

test('mt-hotkey：右 Alt / 右 Ctrl 作主键；右 Alt 按下时补发菜单屏蔽键', { skip }, () => {
  const ralt = JSON.stringify({ matches: [{ name: 'dictation', key: 'ralt' }] })
  assert.deepEqual(replay('ralt down\ntick\nralt up\n', ralt), ['屏蔽菜单:ralt down', 'dictation:down', 'dictation:up'])
  const rctrl = JSON.stringify({ matches: [{ name: 'dictation', key: 'rctrl' }, { name: 'ask', key: 'space', require: ['rctrl'] }] })
  assert.deepEqual(replay('rctrl down\nc down\nc up\nrctrl up\n', rctrl), [])
  assert.deepEqual(replay('rctrl down\ntick\nrctrl up\n', rctrl), ['dictation:down', 'dictation:up'])
})

test('mt-hotkey：配置错误或只有 fn 时退出码 2', { skip }, () => {
  assert.equal(run('mt-hotkey', ['not json', '--replay']).code, 2)
  assert.equal(run('mt-hotkey', [JSON.stringify({ matches: [{ name: 'dictation', key: 'fn' }] }), '--replay']).code, 2)
})

// mt-diarize（npm run diarize:win）：不带模型只测参数与模型加载失败；降噪 / 识别需要下载模型，见运行记录
const skipDiarize = process.platform !== 'win32' || !existsSync(bin('mt-diarize')) ? '需要 Windows 与 npm run diarize:win' : false

test('mt-diarize：没有任何模型参数退出码 2；模型文件不存在退出码 4', { skip: skipDiarize }, () => {
  assert.equal(run('mt-diarize', []).code, 2)
  assert.equal(run('mt-diarize', ['--denoiser', join(import.meta.dirname, '不存在 的模型.onnx')]).code, 4)
})
