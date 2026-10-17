# 2026-10-17 Windows 助手：mt-hotkey 与默认快捷键

## 范围

GAP-008 第四步：Windows 版 `mt-hotkey`（低级键盘钩子）与 Windows 默认快捷键（Windows 键盘的 Fn 系统读不到）。默认键为右 Ctrl（待维护者确认）。真机试用时发现不少笔记本没有右 Ctrl，所以让右 Shift、右 Alt 也能顺畅地自定义为主键（默认值不变）。没做：macOS 版对区分左右修饰键 `require` 的支持（不需要）。

## 改动

- `native/win/hotkey-helper.cpp`：`WH_KEYBOARD_LL` 钩子，状态机与 macOS 版语义一致（单修饰键触发不吞、abort、切换到组合、普通键触发吞键含自动重复、先松修饰键也算结束）；忽略模拟按键；`require` 支持 `rshift` 等区分左右的修饰键，`key` 支持只用于组合的 `ctrl` / `alt`；修饰键组合的第二个修饰键成对吞掉（避免 Ctrl+Shift / Alt+Shift 切换布局）；父进程退出即退出；`--replay` 测试模式（`tick` 表示按住满 150ms）。
- 单修饰键触发按住满 150ms 才确认：右 Shift 用来打大写字母很常见，立即触发会让每次打大写都开一次录音再取消（胶囊闪烁、麦克风短暂打开）；150ms 内按了别的键就什么都不发，松开算轻按。macOS 的 Fn 不受影响。
- 右 Alt：按下后补发未分配的虚拟键 0xE8，避免单独松开 Alt 激活菜单栏；忽略 AltGr 布局插入的假左 Ctrl。
- `src/main/bindings.ts`：从 `hotkeys.ts` 拆出的纯逻辑 `parseBinding`，支持区分左右的修饰键（不生成兜底加速键）。
- `src/shared/platform.ts` 的 `defaultBindings`：macOS Fn 系列；Windows 右 Ctrl、右 Ctrl+空格（提问）、右 Ctrl+Shift（翻译）。改用右 Shift 时翻译写 `rshift+ctrl`（Shift+Shift 无法组合）。`config.ts` 默认值按平台；`index.ts` 迁移：非 macOS 主键仍是 `fn` 时换成本平台默认，旧的 ⌥ 系列迁移只在 macOS 执行。
- 界面：首页副标题、最近记录为空提示、会议说明里的主键名（`.main-key`）在非 macOS 按实际主键显示；设置的快捷键占位符按平台默认；格式说明分 `mac-only` / `non-mac` 两版。

## 验证

- `--replay` 场景（`test/native-win.test.ts`）：按住右 Shift 满 150ms 说话、轻按、右 Shift+字母不触发、确认后再按字母 abort、右 Shift+空格 / 右 Shift+Ctrl 直接进入组合且触发键被吞、左 Shift 与先按着其他修饰键不触发、右 Alt 补发菜单屏蔽键、右 Ctrl 作主键、配置错误与只有 fn 退出码 2。
- 真实钩子：安装后输出 ready；强制结束父进程后助手随即退出。
- `npm run dev`：快捷键引擎为原生；旧设置里的 `fn` 自动迁移；运行中改设置后助手以新绑定重启。
- `npm run test` 94 通过 / 0 失败；typecheck、build、docs:check 通过。

## 遗留

- 物理按键无法由程序模拟（模拟按键被钩子忽略），按住 / 轻按 / 组合的手感需要真机验收。
- 管理员权限窗口在前台时收不到按键（UIPI）。
- 默认主键右 Ctrl 需维护者确认；按住说话比 macOS 晚约 150ms 开始。
