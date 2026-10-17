#!/usr/bin/env node
/**
 * 发布新版本（npm run release，D-028、D-029）：在 GitHub 公开仓库（src/main/update-info.ts 的 GITHUB_REPO）建 Release
 * v<版本号>，上传当前版本最新构建的 zip、DMG 与版本说明 latest-mac.yml，最后转为正式发布——
 * 已安装的应用读取 releases/latest/download/latest-mac.yml 发现新版本、下载 zip 自动安装。
 *
 *   GH_TOKEN=<令牌> npm run release -- --notes "更新内容" --yes
 *   npm run release -- --dry-run --feed http://127.0.0.1:8788/latest --assets http://127.0.0.1:8788 --notes "…"
 *     # 只生成 release/latest-mac.yml（本机测试；安装包地址为 <assets>/<版本号>/<文件>）
 *
 * 令牌：细粒度令牌，只授权该仓库的 Contents 读写。
 * 规则：版本号必须比已发布的大（package.json 的 version，发布前手动升级）；应用必须用本机证书签名（自签名证书相同才能自动安装）。
 * 先建草稿、传完全部文件再转正式：传到一半失败时，已安装的应用看不到不完整的新版本；重跑会删掉同版本的旧草稿。
 * 上传属于对外分发（人工门禁）：不带 --yes 只打印计划。
 */
const { execFileSync } = require('child_process')
const { createHash } = require('crypto')
const { createReadStream, existsSync, openAsBlob, readdirSync, readFileSync, statSync, writeFileSync } = require('fs')
const { basename, join } = require('path')

const root = join(__dirname, '..')
const API = 'https://api.github.com'

/** "0.2.10" > "0.2.9"：只比较数字部分 */
function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

/** MyTypeless-0.2.0-20261015.2347-arm64.zip → { version, build, ext } */
function parseArtifact(name) {
  const m = /^MyTypeless-(\d+\.\d+\.\d+)-(\d{8}\.\d{4})-arm64\.(zip|dmg)$/.exec(name)
  return m ? { version: m[1], build: m[2], ext: m[3] } : null
}

/** GitHub Release 里某个文件的下载地址 */
function githubAssetUrl(repo, version, file) {
  return `https://github.com/${repo}/releases/download/v${version}/${file}`
}

/** 版本说明（electron-updater generic 格式 + build、dmgUrl） */
function buildFeed({ version, build, zipUrl, dmgUrl, sha512, size, notes, date }) {
  const yaml = require('js-yaml')
  return yaml.dump({
    version,
    build,
    files: [{ url: zipUrl, sha512, size }],
    path: zipUrl,
    sha512,
    releaseDate: date,
    releaseNotes: notes || '',
    dmgUrl
  }, { lineWidth: -1 })
}

function githubRepo() {
  const src = readFileSync(join(root, 'src/main/update-info.ts'), 'utf-8')
  const m = /GITHUB_REPO = '([^']+)'/.exec(src)
  if (!m) throw new Error('src/main/update-info.ts 里找不到 GITHUB_REPO')
  return m[1]
}

function sha512(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha512')
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('base64'))).on('error', reject)
  })
}

/** 匿名读取已发布的版本说明（与已安装的应用读法相同）→ 版本号；还没有发布过为 null */
async function publishedVersion(feed) {
  const r = await fetch(`${feed}/latest-mac.yml`, { signal: AbortSignal.timeout(30_000) })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`读取已发布的版本说明失败：HTTP ${r.status}`)
  return require('js-yaml').load(await r.text())?.version ?? null
}

async function gh(token, method, url, body) {
  const r = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}),
      ...(body instanceof Blob ? { 'Content-Type': 'application/octet-stream' } : {})
    },
    body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(body instanceof Blob ? 30 * 60_000 : 30_000)
  })
  if (!r.ok) throw new Error(`GitHub ${method} ${url} 失败：HTTP ${r.status} ${(await r.text()).slice(0, 300)}`)
  return r.status === 204 ? null : r.json()
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const dry = process.argv.includes('--dry-run')
  const repo = githubRepo()
  const feed = (arg('--feed') || `https://github.com/${repo}/releases/latest/download`).replace(/\/+$/, '')
  const assets = arg('--assets')?.replace(/\/+$/, '')
  if (dry && arg('--feed') && !assets) throw new Error('本机测试需要同时给 --feed 与 --assets')
  const notes = arg('--notes-file') ? readFileSync(arg('--notes-file'), 'utf-8').trim() : (arg('--notes') || '').trim()
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).version
  const tag = `v${version}`

  // 当前版本最新的构建
  const dir = join(root, 'release')
  const builds = readdirSync(dir).map((n) => ({ n, a: parseArtifact(n) })).filter((x) => x.a && x.a.version === version)
  const build = builds.map((x) => x.a.build).sort().pop()
  if (!build) throw new Error(`release/ 里没有 ${version} 的安装包，先运行 npm run dist`)
  const zipName = `MyTypeless-${version}-${build}-arm64.zip`
  const dmgName = `MyTypeless-${version}-${build}-arm64.dmg`
  for (const n of [zipName, dmgName]) if (!existsSync(join(dir, n))) throw new Error(`缺少 release/${n}`)

  // 必须是本机证书签名的那次构建（自签名证书相同，已安装的应用才能自动替换）
  const app = join(dir, 'mac-arm64/MyTypeless.app')
  const plistBuild = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', join(app, 'Contents/Info.plist')], { encoding: 'utf-8' }).trim()
  if (plistBuild !== build) throw new Error(`release/mac-arm64 是构建 ${plistBuild}，不是 ${build}；请重新 npm run dist`)
  const req = execFileSync('codesign', ['-dr', '-', app], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (!/certificate leaf/.test(req)) throw new Error('应用不是证书签名（adhoc），已安装的版本无法自动更新到它：检查 .vendor/signing/ 后重新 npm run dist')

  if (!dry) {
    const current = await publishedVersion(feed)
    if (current && compareVersions(version, current) <= 0) {
      throw new Error(`已发布 ${current}，本次 ${version} 不比它新：先升级 package.json 的 version 再打包`)
    }
    console.log(`已发布：${current ?? '（无）'} → 本次：${version}（构建 ${build}）`)
  }

  const url = (file) => (assets ? `${assets}/${version}/${file}` : githubAssetUrl(repo, version, file))
  const zipPath = join(dir, zipName)
  const feedFile = join(dir, 'latest-mac.yml')
  writeFileSync(feedFile, buildFeed({
    version,
    build,
    zipUrl: url(zipName),
    dmgUrl: url(dmgName),
    sha512: await sha512(zipPath),
    size: statSync(zipPath).size,
    notes,
    date: new Date().toISOString()
  }))
  console.log(`版本说明 → release/latest-mac.yml\n  ${url(zipName)}\n  ${url(dmgName)}\n  ${feed}/latest-mac.yml`)
  if (dry) return

  if (!process.argv.includes('--yes')) {
    console.log(`\n将在 https://github.com/${repo} 发布 ${tag}，上传以上三个文件（对外可见）。确认后加 --yes 重新运行。`)
    process.exit(1)
  }
  const token = process.env.GH_TOKEN
  if (!token) throw new Error('缺少环境变量 GH_TOKEN（GitHub 令牌：只授权该仓库的 Contents 读写）')

  // 同版本的旧草稿（上次传到一半失败）先删掉；已正式发布的同版本不覆盖
  for (const r of await gh(token, 'GET', `/repos/${repo}/releases?per_page=30`)) {
    if (r.tag_name !== tag) continue
    if (!r.draft) throw new Error(`${tag} 已经发布过：先升级 package.json 的 version`)
    await gh(token, 'DELETE', `/repos/${repo}/releases/${r.id}`)
  }
  const rel = await gh(token, 'POST', `/repos/${repo}/releases`, { tag_name: tag, name: `MyTypeless ${version}`, body: `${notes}\n\n构建 ${build}`.trim(), draft: true })
  const uploadBase = rel.upload_url.replace(/\{.*\}$/, '')
  for (const file of [zipPath, join(dir, dmgName), feedFile]) {
    console.log(`上传 ${basename(file)}…`)
    await gh(token, 'POST', `${uploadBase}?name=${encodeURIComponent(basename(file))}`, await openAsBlob(file))
  }
  const pub = await gh(token, 'PATCH', `/repos/${repo}/releases/${rel.id}`, { draft: false, make_latest: 'true' })
  const now = await publishedVersion(feed)
  if (now !== version) throw new Error(`发布后读到的版本是 ${now}，不是 ${version}`)
  console.log(`已发布 ${version}（构建 ${build}）：${pub.html_url}`)
}

module.exports = { compareVersions, parseArtifact, buildFeed, githubAssetUrl }

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err?.message ?? err))
    process.exit(1)
  })
}
