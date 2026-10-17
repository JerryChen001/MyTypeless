#!/usr/bin/env node
/**
 * 编译 Windows 原生助手（npm run native:win，GAP-008）：native/win/*.cpp → native/bin/mt-*.exe。
 * 需要 Visual Studio 2022 生成工具（“使用 C++ 的桌面开发”，自带 CMake）；PATH 里有 cmake 时优先用它。
 */
const { execFileSync } = require('child_process')
const { copyFileSync, existsSync, mkdirSync } = require('fs')
const { join } = require('path')

if (process.platform !== 'win32') {
  console.error('只用于 Windows；macOS 用 npm run native')
  process.exit(1)
}

const root = join(__dirname, '..')
const src = join(root, 'native', 'win')
const build = join(root, '.vendor', 'native-win-build')
const out = join(root, 'native', 'bin')
const HELPERS = ['mt-text', 'mt-focus', 'mt-inject']

const cmake = findCmake()
const run = (args) => execFileSync(cmake, args, { stdio: 'inherit' })
run(['-S', src, '-B', build, '-A', 'x64'])
run(['--build', build, '--config', 'Release', '--parallel'])

mkdirSync(out, { recursive: true })
for (const name of HELPERS) {
  copyFileSync(join(build, 'Release', `${name}.exe`), join(out, `${name}.exe`))
  console.log(`${name}.exe → ${join(out, `${name}.exe`)}`)
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
