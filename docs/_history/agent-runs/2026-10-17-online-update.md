# 2026-10-17 在线更新（D-028）

## 背景

用户问“怎么能做到检测是否有最新版本、实现在线更新”。最初确认发布地址用自托管 Git 服务上的公开项目（后改为 GitHub，见下文）；“发现新版本后提示，确认下载时使用内置下载，完成后提示重启更新”。

## 改动

- `src/main/updater.ts`：electron-updater 6.3.9（与 electron-builder 25 同一套 builder-util-runtime）generic 源，`autoDownload=false`、关闭差分下载、`autoInstallOnAppQuit`；启动 1 分钟后与每 6 小时检查（设置 `autoCheckUpdates`）；状态 `UpdateState` 推送到各窗口与托盘；录音、会议、整理中拒绝重启；日志 `~/Library/Logs/MyTypeless/update.log`。
- `src/main/update-info.ts`：发布地址（`MT_UPDATE_URL` 只用于本机测试）、错误提示（纯逻辑，单测）。
- 主窗口：设置 → 关于 的状态、按钮、更新内容、进度与「自动检查更新」开关；侧栏版本号下方入口；路由 `#settings/about`。
- `scripts/publish.cjs`（`npm run release`）：取当前版本最新构建，检查 `release/mac-arm64` 是这次构建且为证书签名、版本号比已发布的大，生成 `latest-mac.yml`（zip 绝对地址、sha512、构建号、DMG 地址、更新内容），先传 zip、DMG，最后传版本说明，再匿名读回确认；不带 `--yes` 只打印计划。
- 版本升到 0.2.1（第一个带在线更新的版本，需手动安装一次）。
- 顺手修正：设置 → 声纹 的模型大小 30 MB → 74 MB（换 ERes2NetV2 后未改）。

## 验证

`npm run typecheck`、`npm run test`、`npm run build`、`npm run docs:check` 通过。端到端见下节。
- 端到端中发现：只调用 `setFeedURL` 时下载会因缺少包内 `Contents/Resources/app-update.yml` 失败（electron-updater 要读其中的缓存目录名）→ `electron-builder.yml` 加 generic `publish`（地址与 `DEFAULT_UPDATE_URL` 一致由单测校验），`dist.cjs` 加 `--publish never`。
- 更新完成后 electron-updater 不删缓存里的安装包（约 110MB，要等下一次下载）→ 启动时删掉版本不比当前新的那份。

## 端到端（打包版，隔离实例，数据目录带空格，本机临时发布地址 `MT_UPDATE_URL`）

旧版 0.2.1（构建 20261017.1024，提交后打包）复制到 `/tmp/mt smoke/upd/`；新版为临时把 package.json 改成 0.2.2 打的包（未提交），`npm run release -- --dry-run --feed http://127.0.0.1:8788/latest` 生成版本说明；本机服务器对 zip 限速 3 MB/s。

- 检查：设置 → 关于 显示「有新版本 0.2.2（构建 20261017.1023）」、更新内容两行、「下载更新」；侧栏出现「有新版本 0.2.2」。
- 下载：进度 5% → 10% → 19%、2.8 MB/s，进度条同步；「取消」后回到「有新版本」；再次下载 38 秒完成，显示「重启并更新」，侧栏「重启更新到 0.2.2」。
- 重启并更新（前一轮）：Squirrel 校验签名通过并替换应用，ShipIt 重新打开应用（未带测试参数，按正式数据目录启动，遇到正在运行的正式实例后按单实例规则退出）；隔离目录再打开为 0.2.2、设置保留。
- 下载完不重启直接退出：退出时安装成功（不重新打开）。
- 新版本打开后：版本 0.2.2；辅助功能、麦克风授权仍有效（同一证书）；`codesign --verify --deep --strict` 通过；缓存里已装上的安装包被删除。
- 失败提示：发布地址没有版本说明 →「发布地址上还没有版本信息」；服务器停掉 →「连不上发布地址，请检查网络后重试」。
- 发布脚本：真实地址目前返回 401（项目未建或未公开）→ 拒绝发布并提示「发布项目需要设为公开」。
- 未测：录音 / 会议中拒绝重启（RELE-006，测试实例开会会打开真实麦克风）；系统通知（自动检查才弹，测试用的是手动检查）；真实发布（项目未建）。

## 改用 GitHub（D-029）

用户要求“换成 github 吧”，选新建公开仓库 `cjx157791216/mytypeless-releases`（只放 Releases）。

- 应用侧仍用 generic 源，地址改为 `https://github.com/cjx157791216/mytypeless-releases/releases/latest/download`：GitHub 跳转两次（→ `releases/download/v<版本>/` → `release-assets.githubusercontent.com` 签名地址）。
- `npm run release` 改为 GitHub REST API：删同版本旧草稿 → 建 `v<版本>` 草稿 → 传 zip、DMG、`latest-mac.yml` → 转正式并设为最新 → 匿名读回确认。令牌用环境变量 `GH_TOKEN`。

端到端（打包版 0.2.1 构建 20261017.1035，隔离实例）：

- 本机模拟 GitHub 两次跳转（版本说明与 zip 都经 302 → 302，zip 限速 3 MB/s）：检查到 0.2.2，下载进度 13% → 94%，34 秒完成；退出时安装成功，新版本签名校验通过。
- 真实 GitHub：`MT_UPDATE_URL` 指向公开项目 laurent22/joplin 的 `releases/latest/download`，检查成功读到 3.7.21（真实跳转链可用；未下载）。
- 默认地址（仓库未建）：「发布地址上还没有版本信息」；`npm run release`（不带 `--yes`）打印 v0.2.1 的三个文件地址后退出，未上传。

## 首次发布（v0.2.1）

- 用户在本机用 `gh auth login` 登录 GitHub（cjx157791216）后，建公开仓库 `cjx157791216/mytypeless-releases`（带 README）。
- `GH_TOKEN=$(gh auth token) npm run release -- --yes` 发布 v0.2.1：取当前版本最新构建 20261017.1043（由另一会话“应用图标替换”在未提交改动上打包，提交显示 `4e35516-dirty`，含新的托盘与主窗口标志；用户确认保留）。zip、DMG、`latest-mac.yml` 三个文件已上传，匿名读回版本说明为 0.2.1、zip 可下载。
