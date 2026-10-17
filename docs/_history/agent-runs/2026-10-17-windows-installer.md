# 2026-10-17 Windows 安装包与在线更新（D-036）

## 范围

GAP-008 最后一步：Windows 安装包、在线更新，以及让没有 Windows 电脑的发布者也能发 Windows 版。不做代码签名（没有证书）。

## 改动

- `electron-builder.yml`：Windows 目标 NSIS x64，一键安装到当前用户（`oneClick`、`perMachine: false`），卸载保留数据；原生助手按平台随包（Windows 只取 `mt-*.exe`、排除编译时挪开的 `*.old-*.exe`；macOS 排除 `.exe`）。
- `scripts/dist.cjs`：Windows 分支编译 `native:win`、`diarize:win`、`whisper:win` 后打包。
  - `prepareWinCodeSign`：electron-builder 的 winCodeSign 工具包含 macOS 符号链接，普通用户解压失败、打包中止，所以预先下载、校验 SHA256、跳过 darwin 目录解压到它的缓存。
  - Windows 不传 `buildVersion`：文件版本每段最大 65535，构建号放不下，实测会变成 `20261017.09`。
- 在线更新：
  - `updater.ts`：Windows 也检查更新，静默安装并重新打开（`quitAndInstall(true, true)`）；下载缓存在 `%LOCALAPPDATA%\mytypeless-updater`。
  - `index.ts`：设置 `AppUserModelId`，否则 Windows 系统通知不显示。
- 发布：
  - `scripts/publish.cjs`：Mac 文件传完后触发 `release-windows.yml`，按运行标题找到那次运行并等待，核对草稿里有安装包与 `latest.yml` 后才转正式。新增 `--no-windows`，发布后同时核对 `latest.yml` 的版本。
  - `scripts/publish-win.cjs`（CI 里运行）：生成绝对地址的 `latest.yml`（与 `latest-mac.yml` 同格式，带构建号与更新内容），上传到草稿。
  - `.github/workflows/release-windows.yml`：`workflow_dispatch`（sha / tag / notes），复用 CI 的编译缓存；不填标签时只生成构建产物。

## 验证

- 本机 `npm run dist`：生成约 90MB 的安装包；`resources\bin\` 含 7 个助手、不含 `.old` 文件；better-sqlite3 在 `app.asar.unpacked`。
- 本机更新端到端（隔离数据目录 + `MT_UPDATE_URL` 指向本机临时服务器）：
  - 0.3.0 → 0.3.1 → 0.3.2 两轮都是“检查 → 下载 → 重启并更新”，静默装上新版本。
  - 安装器带 `--force-run` 重新打开了应用；测试时开发版开着、共用单实例锁，所以新打开的实例把窗口交给开发版后退出。
  - 安装目录里有残留的 `mt-diarize.exe` 进程时，安装器仍正常完成。
- 发布流程演练（fork，草稿不转正式，演练后删除）：GitHub Windows 机器上从 `npm run setup:win` 到上传共 3 分 53 秒（编译缓存命中）。草稿得到安装包与 `latest.yml`，地址为绝对地址，构建号、更新内容正确；提交号不带 `-dirty`。
- `npm run test` 112 通过；typecheck、build、docs:check 通过。

## 遗留

- “触发工作流 → 找到运行 → 等待”这一段没有真跑：`workflow_dispatch` 的工作流必须在默认分支上才能触发，合并前无法演练。合并后可先在 Actions 页面手动运行一次测试构建。
- 无代码签名：首次安装 SmartScreen 提示“未知发布者”。之后的在线更新由应用自己下载，不经过 SmartScreen。
- 真机从正式发布的旧版本在线更新到新版本，要等下一个版本发布后验证。
