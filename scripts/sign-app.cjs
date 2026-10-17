// electron-builder afterPack 钩子：对整个 .app 签名。
// identity: null 时 electron-builder 完全跳过签名，主程序只剩 Electron 自带的链接器签名（标识 "Electron"），
// 系统隐私权限无法稳定识别本应用。这里：
// - 有本地证书（scripts/setup-signing.sh 生成，predist 会自动执行）→ 用它签名：指定要求为“标识 + 证书”，
//   重新打包后辅助功能/麦克风授权仍然有效
// - 没有 → adhoc 签名（每次打包都要重新授权）
// 配置了 Developer ID（CSC_NAME/CSC_LINK）时跳过，交给 electron-builder。
const { execFileSync } = require('child_process')
const { existsSync } = require('fs')
const path = require('path')

const IDENTITY = 'MyTypeless Local Signing'
const KEYCHAIN = path.join(__dirname, '..', '.vendor', 'signing', 'mytypeless-signing.keychain-db')
const KEYCHAIN_PASS = 'mytypeless-local'

exports.default = async function signApp(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_NAME || process.env.CSC_LINK) return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  let args = ['--force', '--deep', '--sign', '-']
  if (existsSync(KEYCHAIN)) {
    execFileSync('security', ['unlock-keychain', '-p', KEYCHAIN_PASS, KEYCHAIN])
    args = ['--force', '--deep', '--sign', IDENTITY, '--keychain', KEYCHAIN]
  } else {
    console.warn('  • 未找到本地签名证书，使用 adhoc 签名（运行 scripts/setup-signing.sh 可让授权在重新打包后保留）')
  }
  execFileSync('codesign', [...args, appPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
}
