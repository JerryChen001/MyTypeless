# 2026-10-17 Windows 助手：mt-inject

## 范围

GAP-008 第三步：Windows 版 `mt-inject`（键入、粘贴、组合键、抓选区），协议与 macOS 版一致。没做：UI Automation 直接设值 / 读选区（GAP-005 与之后的 `mt-focus --selected-text`）。

## 改动

- `native/win/inject-helper.cpp`：`SendInput` Unicode 键入（代理项对不拆块、换行发回车）；先松开仍按着的修饰键（Alt / Win 前插未分配键 0xE8，避免激活菜单栏 / 开始菜单）；剪贴板备份全部内存格式与增强图元文件、序列号判断后恢复；临时内容不进剪贴板历史与云剪贴板。
- `common.h`：base64 编解码。
- 修复 `mt-focus --activate`：去掉多余的 `SetFocus(主窗口)`，否则窗口里的输入框失去焦点、键入落空。
- `test/native-win.test.ts`：只测不发按键的路径（参数、非法 base64、不支持的组合键）。

## 验证

- 本机端到端（Windows 11，微软拼音输入法开启）：脚本自建的 WinForms 文本框窗口，确认它在前台后才发按键；键入中英文与 emoji、粘贴多行与 Tab、键入换行、Ctrl+A 后抓选区，读回内容逐字一致；粘贴与抓选区后剪贴板恢复为原内容。15 项全部通过。
- `npm run test` 83 通过 / 0 失败；typecheck、build、docs:check 通过。
- 教训：第一次端到端用记事本，Windows 11 记事本恢复了用户的未关闭标签页，测试文字写进了用户文档；之后一律只对自建窗口操作。

## 遗留

- `--copy-selection` 的那次复制由目标应用写剪贴板，会进入 Windows 剪贴板历史（Win+V），无法标记排除；需维护者确认是否符合 D-002，或在有 UI Automation 读选区后只作兜底。
- 未在 Electron 应用（VS Code、Slack）、浏览器、管理员权限窗口里真机验证；UIPI 拦截时键入静默丢失。
