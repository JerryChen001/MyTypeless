#!/usr/bin/env node
/**
 * Windows 开发环境安装依赖（npm run setup:win，代替 npm install）。直接 npm install 在 Windows 上会失败：
 * - better-sqlite3 的安装脚本先按当前 Node 编译：没有 Node 24 的 Windows 预编译包，现场编译要 VS 的 ClangCL 组件。
 *   应用只用 Electron 版，所以跳过安装脚本，直接下载 Electron ABI 的预编译包（同 macOS 的 install-app-deps）。
 * - Electron 自带的安装脚本在 Node 24 下解压只解出第一个文件且报告成功：解压不完整时用系统 tar 重新解压。
 * 网络慢时可设 ELECTRON_MIRROR（如 https://npmmirror.com/mirrors/electron/）。
 */
const { execFileSync, execSync } = require('child_process')
const { existsSync, readdirSync, statSync, mkdirSync, rmSync, writeFileSync } = require('fs')
const { join } = require('path')
const os = require('os')

if (process.platform !== 'win32') {
  console.error('只用于 Windows；macOS 请直接 npm install')
  process.exit(1)
}

const root = join(__dirname, '..')
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit', env: process.env })

console.log('1/3 安装 npm 依赖（跳过安装脚本）')
run('npm install --ignore-scripts')

const electronDir = join(root, 'node_modules', 'electron')
const electronVersion = require(join(electronDir, 'package.json')).version
const electronExe = join(electronDir, 'dist', 'electron.exe')

console.log(`2/3 安装 Electron ${electronVersion}`)
if (!existsSync(electronExe)) {
  run('node install.js', electronDir)
  if (!existsSync(electronExe)) {
    const zipName = `electron-v${electronVersion}-win32-x64.zip`
    const zip = findFile(join(process.env.LOCALAPPDATA || join(os.homedir(), 'AppData', 'Local'), 'electron', 'Cache'), zipName)
    if (!zip) throw new Error(`没有找到下载好的 ${zipName}，请检查网络或设置 ELECTRON_MIRROR 后重试`)
    console.log(`  解压不完整，用 tar 重新解压 ${zip}`)
    const dist = join(electronDir, 'dist')
    rmSync(dist, { recursive: true, force: true })
    mkdirSync(dist)
    execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dist], { stdio: 'inherit' })
    writeFileSync(join(electronDir, 'path.txt'), 'electron.exe')
  }
}
console.log(`  ${execFileSync(electronExe, ['--version'], { encoding: 'utf-8' }).trim()}`)

console.log('3/3 下载 better-sqlite3 的 Electron 预编译包')
run(`node ../prebuild-install/bin.js --runtime electron --target ${electronVersion} --arch x64 --platform win32`, join(root, 'node_modules', 'better-sqlite3'))
console.log('完成：npm run dev 启动开发版')

function findFile(dir, name) {
  if (!existsSync(dir)) return null
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (entry === name) return p
    if (statSync(p).isDirectory()) {
      const found = findFile(p, name)
      if (found) return found
    }
  }
  return null
}
