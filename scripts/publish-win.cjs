#!/usr/bin/env node
/**
 * Windows 安装包上传到草稿 Release（D-036）：只在 GitHub Actions 的 release-windows.yml 里运行（npm run dist 之后），
 * 由 Mac 上的 npm run release 触发，发布者不需要 Windows 电脑。
 * - 取 release/ 里当前版本最新的 MyTypeless-<版本>-<构建号>-x64.exe，写版本说明 release/latest.yml（安装包绝对地址，
 *   与 latest-mac.yml 同一格式；electron-builder 自带的 latest.yml 是相对地址，发布新版本的瞬间可能指错，覆盖掉）
 * - 连同解压即用版 MyTypeless-<版本>-<构建号>-x64.zip 上传到标签为 MT_TAG 的草稿（必须是草稿：转正式由 npm run release 在两个平台都传完后做）；重跑时先删掉同名文件
 * 环境变量：GITHUB_REPOSITORY（Actions 自带）、GH_TOKEN（工作流的 GITHUB_TOKEN，contents: write）、MT_TAG（如 v0.3.1）、MT_NOTES（更新内容）
 */
const { existsSync, openAsBlob, readdirSync, readFileSync, statSync, writeFileSync } = require('fs')
const { join } = require('path')
const { buildFeed, gh, githubAssetUrl, githubRepo, parseWinArtifact, parseWinZip, sha512 } = require('./publish.cjs')

const root = join(__dirname, '..')

async function main() {
  const token = process.env.GH_TOKEN
  const tag = process.env.MT_TAG
  if (!token || !tag) throw new Error('缺少 GH_TOKEN 或 MT_TAG')
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).version
  if (tag !== `v${version}`) throw new Error(`标签 ${tag} 与 package.json 的版本 ${version} 不一致`)
  const repo = process.env.GITHUB_REPOSITORY || githubRepo() // 工作流所在的仓库（在 fork 上测试时是 fork）

  const dir = join(root, 'release')
  const build = readdirSync(dir).map(parseWinArtifact).filter((a) => a && a.version === version).map((a) => a.build).sort().pop()
  if (!build) throw new Error(`release/ 里没有 ${version} 的 Windows 安装包，先运行 npm run dist`)
  const exeName = `MyTypeless-${version}-${build}-x64.exe`
  const exePath = join(dir, exeName)
  const feedFile = join(dir, 'latest.yml')
  writeFileSync(feedFile, buildFeed({
    version,
    build,
    zipUrl: githubAssetUrl(repo, version, exeName),
    sha512: await sha512(exePath),
    size: statSync(exePath).size,
    notes: (process.env.MT_NOTES || '').trim(),
    date: new Date().toISOString()
  }))
  console.log(`版本说明 → release/latest.yml（${exeName}）`)

  const rel = (await gh(token, 'GET', `/repos/${repo}/releases?per_page=30`)).find((r) => r.tag_name === tag)
  if (!rel) throw new Error(`${repo} 没有 ${tag} 的 Release：应由 npm run release 先建草稿`)
  if (!rel.draft) throw new Error(`${repo} 的 ${tag} 已经正式发布，不能再改`)
  const zipPath = join(dir, `MyTypeless-${version}-${build}-x64.zip`) // 解压即用版，与安装包同一次打包
  const files = [exePath, zipPath, feedFile]
  for (const a of await gh(token, 'GET', `/repos/${repo}/releases/${rel.id}/assets?per_page=100`)) {
    if (files.some((f) => f.endsWith(a.name)) || parseWinArtifact(a.name) || parseWinZip(a.name)) await gh(token, 'DELETE', `/repos/${repo}/releases/assets/${a.id}`)
  }
  const uploadBase = rel.upload_url.replace(/\{.*\}$/, '')
  for (const file of files) {
    if (!existsSync(file)) throw new Error(`缺少 ${file}`)
    const name = file.slice(dir.length + 1)
    console.log(`上传 ${name}…`)
    await gh(token, 'POST', `${uploadBase}?name=${encodeURIComponent(name)}`, await openAsBlob(file))
  }
  console.log(`已上传到 ${repo} 的草稿 ${tag}`)
}

main().catch((err) => {
  console.error(String(err?.message ?? err))
  process.exit(1)
})
