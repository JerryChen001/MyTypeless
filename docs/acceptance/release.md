# 打包发布验收场景

场景 ID 前缀 `RELE-`，全局唯一。规则来源见 [打包发布需求](../requirements/release.md)。

| ID | Given / When / Then |
| --- | --- |
| RELE-001 | Given 干净的仓库已 `npm install` / When 运行 `npm run dist` / Then `release/` 下生成 arm64 DMG 与 zip，且 `Contents/Resources/bin/` 含 `mt-hotkey`、`mt-inject`、`mt-focus`、`mt-text`、`mt-whisper` |
| RELE-002 | Given 安装打包版 / When 启动 / Then 不崩溃，用户数据目录下生成 `mytypeless.db` |
| RELE-003 | Given 运行 `npm run dist` / When 检查 `Contents/Resources/bin/mt-whisper` / Then `otool -L` 只列出系统框架与系统库，安装包不包含任何 `.bin` 模型文件 |
| RELE-004 | Given 已安装证书签名的打包版，发布地址上有更大版本号的版本说明 / When 在 设置 → 关于 点「检查更新」（或启动 1 分钟后自动检查） / Then 显示「有新版本 x（构建 y）」与更新内容；自动检查发现时弹一次系统通知，托盘与侧栏出现入口 |
| RELE-005 | Given RELE-004 / When 点「下载更新」 / Then 显示进度、可取消；下载完显示「重启并更新」，点击后应用退出并以新版本重新打开，设置、历史、模型、辅助功能与麦克风授权保留 |
| RELE-006 | Given 新版本已下载 / When 会议进行中、纪要整理中或正在听写时点「重启并更新」 / Then 不重启并提示原因 |
| RELE-007 | Given 发布地址已有 0.2.1 / When 用 0.2.1 或 adhoc 签名的构建运行 `npm run release -- --yes` / Then 拒绝发布并说明原因；不带 `--yes` 只打印计划不上传 |
