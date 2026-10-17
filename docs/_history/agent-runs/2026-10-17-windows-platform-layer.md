# 2026-10-17 Windows 平台层

## 范围

GAP-008（D-006 预留的 Windows 移植）第一步：让应用在 Windows 上能安装依赖、启动、显示正确的界面，macOS 行为不变。刻意没做：Windows 原生助手（`mt-*.exe`）、Windows 默认快捷键（Fn 读不到，待维护者确认）、打包与在线更新（发布属于人工门禁）。

## 改动

- 主进程：`helperPath` 在 Windows 加 `.exe`；辅助功能检查、`tccutil`、`defaults`（Fn 冲突）、`ps`（开发模式权限归属）、`askForMediaAccess`、osascript 兜底只在 macOS 执行（此前 Windows 上 `isTrustedAccessibilityClient` 不存在，启动流程直接抛错）；主窗口在 Windows 用系统标题栏按钮（`titleBarOverlay`，随深浅色切换）；托盘模板图在 Windows 着色为强调色、单击打开主窗口；浮动条只在 macOS 用 `type: 'panel'`；在线更新只在 macOS 检查；开发日志在 Windows 写到系统临时目录。
- 共用：`src/shared/platform.ts`（按平台的键名、粘贴快捷键、麦克风权限提示），preload 暴露 `platform`；首页快捷键、写入失败提示、浮动条麦克风提示按平台显示；设置的「辅助功能」行加 `mac-only`。
- 开发环境：`npm run setup:win`（`scripts/setup-win.cjs`）；`electron.vite.config.ts` 开发服务器固定 127.0.0.1。
- CI：新增 `check-windows`（windows-latest：`npm ci --ignore-scripts`、typecheck、test、build）。

## 验证

- Windows 11（本机）：`npm run typecheck`、`npm run test`（78 通过 / 0 失败）、`npm run build`、`npm run docs:check` 通过。
- `npm run setup:win`：删除 Electron 与 better-sqlite3 二进制后重跑，自动发现解压不完整并用 tar 修复，Electron 33.4.11 可运行。
- `npm run dev`（Windows）：主窗口、浮动条正常加载；首页按 Windows 键名显示、隐藏辅助功能；标题栏按钮与深色主题一致；快捷键引擎显示兜底模式（原生助手未实现，符合预期）。
- macOS 未在本机验证，依赖 CI 的 macOS job。

## 遗留

- Windows 原生助手：`mt-text`、`mt-focus`、`mt-inject`、`mt-hotkey`、`mt-diarize`、`mt-whisper`（之后的 PR）。
- Windows 默认主键（建议右 Ctrl）、首页与设置里提到 Fn / 右 Option 的文案，等默认键确定后一起改。
- 兜底模式下首页仍显示配置的主键而不是实际可用的 `Alt+空格`（macOS 未授权时同样如此）。
- `killOrphanEngines` 依赖 `/bin/ps`，在 Windows 上静默跳过；做 `mt-whisper.exe` 时一并处理。
