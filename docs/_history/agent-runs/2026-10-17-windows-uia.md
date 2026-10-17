# 2026-10-17 Windows：读选区与光标上下文（UI Automation）

## 范围

GAP-008：Windows 版 `mt-focus --selected-text` / `--caret-context`。有了它，Windows 上“听写时选中即改写”和自动词典（D-012，写入后追踪修改）才生效；此前这两个用法一律返回 5。隐私与 macOS 相同：只读选中的文字或光标附近一段，密码框不读（D-002）。

## 改动

- `native/win/focus-helper.cpp`：UI Automation `TextPattern`（选区；光标前后按字符移动取一段，`caret` 按 UTF-16 计）；标准编辑框后备（`EM_GETSEL` / `WM_GETTEXT`，WinForms 文本框经系统代理声称支持文本模式却读出空串）；密码框不读；Chromium 唤醒（`WM_GETOBJECT` / `OBJID_CLIENT`，新版发给顶层 `Chrome_WidgetWin_*`）与递增重试；去掉 Chromium 在文本末尾附加的空格；单独线程 + 超时。
- `scripts/build-native-win.cjs`：清理旧文件时被占用的跳过（之前抛 EPERM 中断，导致新编译的助手没复制到位）。
- `test/native-win.test.ts`：`mt-focus` 单测不再调用读取（会读到用户当前焦点输入框），只测参数。

## 验证

- 端到端（只对自建窗口，发按键前核对前台进程与窗口标题）：WPF 文本框、WinForms 文本框、密码框、Electron textarea 四类，键入 → 光标在末尾 / 中间的上下文 → 没有选中 → 选中 5 个字符 → 全选，23 项全部通过（含中文、caret 位置、pid）。
- 真实调用顺序在 Electron 上验证：听写开始查选区（唤醒，落空）→ 键入 → 读上下文成功 → 再查选区成功。
- 单次调用耗时：普通应用约 150～220ms；Chromium 第一次约 0.4～0.5 秒。
- `npm run test` 95 通过 / 0 失败；typecheck、build、docs:check 通过。

## 遗留

- 每个 Chromium / Electron 应用第一次读选区会落空（唤醒前已获得焦点的输入框，要等光标动一次 Chromium 才报告焦点）。
- Notepad++（Scintilla）两种方式都读不到：听写时选中即改写不可用，单独绑定的改写键（Ctrl+C 抓选区）可用。
- 端到端测试脚本在本地（需要桌面环境），未入库。
