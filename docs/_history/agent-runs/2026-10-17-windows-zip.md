# 2026-10-17 Windows 解压即用版（D-037）

## 范围

在 Windows 安装包（D-036）之外，再出一个解压即用的 zip。数据位置由使用者选定：仍在 `%APPDATA%\MyTypeless`，与安装版共用；不做数据放进程序文件夹的便携版。

## 改动

- `electron-builder.yml`：Windows 加 `zip` 目标（x64），与安装包同一次打包。
- 判断与更新：
  - `update-info.ts`：`isUnpackedWin`（程序旁没有 `Uninstall MyTypeless.exe` 即为解压即用版）、`releasePageUrl`。
  - `updater.ts`：解压即用版照常检查新版本，但不自动下载；`dmgUrl` 指向该版本的 Release 页面，并标记 `manual`。
  - 关于页：`manual` 时按钮为「前往下载」，打开 Release 页面。
- 发布：
  - `publish-win.cjs` 连同 zip 一起上传到草稿。
  - `publish.cjs` 核对草稿里有安装包、zip 与 `latest.yml` 三个文件才转正式。
  - 工作流的构建产物也带上 zip。

## 验证

- `npm run dist`：安装包 90MB、zip 123MB。zip 用的压缩不如安装包的 7z，所以更大。
- zip 解压到带空格的路径，用隔离数据目录启动，发布地址指向本机临时服务器上的 0.3.2：
  - 显示“有新版本 0.3.2”，按钮为「前往下载」，地址是 `releases/tag/v0.3.2`。
  - 调用下载不会取安装包（服务器日志里没有安装包请求）。
  - 数据库正常创建。
- `npm run test` 113 通过；typecheck、build、docs:check 通过。

## 遗留

- 解压即用版首次运行同样会有 SmartScreen 的“未知发布者”提示（没有代码签名）。
