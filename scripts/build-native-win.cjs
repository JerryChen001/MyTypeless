#!/usr/bin/env node
/**
 * 编译 Windows 原生助手（npm run native:win，GAP-008）：native/win/*.cpp → native/bin/mt-*.exe。
 * --diarize（npm run diarize:win）：另外编译 mt-diarize.exe（native/diarize-helper.c，与 macOS 同一份源码），
 *   首次下载 sherpa-onnx 的 Windows 静态库（约 120MB，GitHub Releases）到 .vendor/sherpa-onnx-win/；
 *   网络慢时可手动下载 SHERPA_PKG 后解压到该目录（需含 include/ 与 lib/）。
 * 需要 Visual Studio 2022 生成工具（“使用 C++ 的桌面开发”，自带 CMake）；PATH 里有 cmake 时优先用它。
 */
const { execFileSync } = require('child_process')
const { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('fs')
const os = require('os')
const { join } = require('path')

if (process.platform !== 'win32') {
  console.error('只用于 Windows；macOS 用 npm run native')
  process.exit(1)
}

const root = join(__dirname, '..')
const src = join(root, 'native', 'win')
const build = join(root, '.vendor', 'native-win-build')
const out = join(root, 'native', 'bin')
const HELPERS = ['mt-text', 'mt-focus', 'mt-inject', 'mt-hotkey']
// 与 scripts/build-diarize.sh 的 SHERPA_VERSION 保持一致
const SHERPA_VERSION = 'v1.13.8'
const SHERPA_PKG = `sherpa-onnx-${SHERPA_VERSION}-win-x64-static-MT-Release-no-tts-lib`
const sherpaDir = join(root, '.vendor', 'sherpa-onnx-win')
const withDiarize = process.argv.includes('--diarize')
if (withDiarize) {
  ensureSherpa()
  HELPERS.push('mt-diarize')
}

const cmake = findCmake()
const run = (args) => execFileSync(cmake, args, { stdio: 'inherit' })
run(['-S', src, '-B', build, '-A', 'x64', `-DSHERPA_DIR=${withDiarize ? sherpaDir.replace(/\\/g, '/') : ''}`])
run(['--build', build, '--config', 'Release', '--parallel'])

mkdirSync(out, { recursive: true })
let busy = 0
for (const name of HELPERS) {
  try {
    copyFileSync(join(build, 'Release', `${name}.exe`), join(out, `${name}.exe`))
    console.log(`${name}.exe → ${join(out, `${name}.exe`)}`)
  } catch (err) {
    if (err.code !== 'EBUSY' && err.code !== 'EPERM') throw err
    busy++
    console.warn(`${name}.exe 正在运行（应用开着），没有替换；退出应用后重新运行本命令`)
  }
}
if (busy) process.exitCode = 1

function ensureSherpa() {
  const stamp = join(sherpaDir, 'VERSION')
  if (existsSync(stamp) && readFileSync(stamp, 'utf-8').trim() === SHERPA_VERSION) return
  const tmp = mkdtempSync(join(os.tmpdir(), 'mt-sherpa-'))
  const pkg = join(tmp, 'pkg.tar.bz2')
  console.log(`下载 ${SHERPA_PKG}（约 120MB）…`)
  execFileSync('curl', ['-fL', '--retry', '5', '-o', pkg, `https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_VERSION}/${SHERPA_PKG}.tar.bz2`], { stdio: 'inherit' })
  execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xjf', pkg, '-C', tmp], { stdio: 'inherit' })
  rmSync(sherpaDir, { recursive: true, force: true })
  mkdirSync(sherpaDir, { recursive: true })
  cpSync(join(tmp, SHERPA_PKG, 'lib'), join(sherpaDir, 'lib'), { recursive: true })
  // -lib 包不带头文件：C API 只有一个头文件（只依赖 stdint.h），按同一版本标签从源码取
  const header = join(sherpaDir, 'include', 'sherpa-onnx', 'c-api', 'c-api.h')
  mkdirSync(join(header, '..'), { recursive: true })
  execFileSync('curl', ['-fsSL', '--retry', '5', '-o', header, `https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/${SHERPA_VERSION}/sherpa-onnx/c-api/c-api.h`], { stdio: 'inherit' })
  writeFileSync(stamp, SHERPA_VERSION + '\n')
  rmSync(tmp, { recursive: true, force: true })
}

function findCmake() {
  try {
    execFileSync('cmake', ['--version'], { stdio: 'ignore' })
    return 'cmake'
  } catch {
    /* 不在 PATH 里：找 Visual Studio 自带的 */
  }
  const vswhere = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (existsSync(vswhere)) {
    const found = execFileSync(vswhere, ['-latest', '-products', '*', '-find', 'Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe'], { encoding: 'utf-8' })
      .split(/\r?\n/)
      .find(Boolean)
    if (found) return found
  }
  console.error('找不到 cmake：请安装 Visual Studio 2022 生成工具（使用 C++ 的桌面开发），或把 cmake 加入 PATH')
  process.exit(1)
}
