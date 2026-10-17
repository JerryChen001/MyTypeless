# 2026-10-17 Windows 助手：mt-hotkey 与默认快捷键

## 范围

GAP-008 第四步：Windows 版 `mt-hotkey`（低级键盘钩子），Windows 默认快捷键改为右 Ctrl 系列（用户倾向，待维护者确认；Windows 键盘的 Fn 系统读不到）。没做：macOS 版对区分左右修饰键 `require` 的支持（不需要）。

## 改动

- `native/win/hotkey-helper.cpp`：`WH_KEYBOARD_LL` 钩子，状态机与 macOS 版语义一致（单修饰键触发不吞、abort、切换到组合、普通键触发吞键含自动重复、先松修饰键也算结束）；忽略模拟按键；`rctrl+shift` 的 Shift 成对吞掉（避免 Ctrl+Shift 切换键盘布局）；`require` 支持 `rctrl` 等；父进程退出即退出；`--replay` 测试模式。
- `src/main/bindings.ts`：从 `hotkeys.ts` 拆出的纯逻辑 `parseBinding`，支持区分左右的修饰键（不生成兜底加速键）。
- `src/shared/platform.ts` 的 `defaultBindings`：macOS Fn、Windows 右 Ctrl；`config.ts` 默认值按平台；`index.ts` 迁移：非 macOS 主键仍是 `fn` 时换成本平台默认，旧的 ⌥ 系列迁移只在 macOS 执行。
- 界面：首页副标题、最近记录为空提示、会议说明里的主键名（`.main-key`）在非 macOS 按实际主键显示；设置的快捷键占位符按平台默认；格式说明分 `mac-only` / `non-mac` 两版。

## 验证

- `--replay` 场景（`test/native-win.test.ts`）：按住说话、右 Ctrl+空格、右 Ctrl+Shift、右 Ctrl+C（abort 放行）、左 Ctrl+空格与单独 Shift 不触发、其他修饰键先按着不触发、配置错误与只有 fn 退出码 2。
- 真实钩子：安装后输出 ready；强制结束父进程后助手随即退出。
- `npm run dev`：快捷键引擎为原生（`mt-hotkey.exe` 运行中），旧设置里的 `fn` 自动迁移为右 Ctrl，首页显示「按住 右Ctrl 说话」。
- `npm run test` 93 通过 / 0 失败；typecheck、build、docs:check 通过。

## 遗留

- 物理按键无法由程序模拟（模拟按键被钩子忽略），按住 / 轻按 / 组合的手感需要真机验收。
- 管理员权限窗口在前台时收不到按键（UIPI）。
- 默认主键右 Ctrl 需维护者确认；部分笔记本没有右 Ctrl，可在设置里改为 `ralt` 等。
