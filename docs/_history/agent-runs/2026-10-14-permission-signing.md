# 2026-10-14 辅助功能“已授权仍显示未授权”与整包签名

## 范围

用户反馈授予辅助功能后状态面板仍显示未授权。同时按负责人确认关闭 B-004（→ D-007）、B-005（→ D-008），四份需求改为 confirmed。

## 原因

- 用户运行的是 `npm run dev`（由 iTerm 启动）。开发模式下 TCC 把权限记在“负责进程”iTerm 上，给 MyTypeless 授权对它无效。
- 打包版：`identity: null` 让 electron-builder 跳过签名，`/Applications/MyTypeless.app` 只有 Electron 自带的链接器签名（`Identifier=Electron`、资源未封装），系统权限对它的识别不可靠。

## 改动

- 主窗口状态面板在开发模式下沿父进程链找到持有权限的应用（`permissionHost`），提示给它授权。
- 新增 `scripts/adhoc-sign.cjs`（`afterPack`），打包后对整个 .app 做 adhoc 签名；配置 Developer ID 时跳过。
- 文档：D-007、D-008，需求 confirmed，AGENTS 已知陷阱、README、发布需求、GAP-009 备注。

## 验证

- 在用户正在运行的开发进程链上识别结果为 “iTerm”。
- `npm run dist` 后 `codesign -dv` 为 `Identifier=com.mytypeless.desktop`、`Signature=adhoc`，`codesign --verify --deep --strict` 通过。
- `npm run typecheck`、`npm run build` 通过。

## 遗留

- 需用户在授权后真机确认（GAP-001）。
