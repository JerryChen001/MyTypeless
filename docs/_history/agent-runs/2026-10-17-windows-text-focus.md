# 2026-10-17 Windows 助手：mt-text、mt-focus

## 范围

GAP-008 第二步：Windows 版 `mt-text`（繁简转换）与 `mt-focus`（前台应用、按 pid 激活），以及 Windows 助手的编译脚本与 CI。刻意没做：`mt-focus --selected-text` / `--caret-context`（UI Automation，之后单独做；目前退出码 5，调用方按“读不到”处理）。

## 改动

- `native/win/`：`common.h`（UTF-8 / UTF-16 转换、二进制 stdin/stdout、JSON 转义）、`text-helper.cpp`（`LCMapStringEx`）、`focus-helper.cpp`（前台窗口 → 进程 exe 路径 → 文件描述；UWP 跳过 `ApplicationFrameHost.exe`；`--activate` 用 `AttachThreadInput` 绕过前台锁）、`CMakeLists.txt`（静态链接运行库、`/W4`）。
- `scripts/build-native-win.cjs` + `npm run native:win`：找 PATH 或 Visual Studio 自带的 CMake，编译后复制到 `native/bin/`。
- `test/native-win.test.ts`：协议与退出码（只在 Windows 且已编译时运行）；CI `check-windows` 先编译助手再跑测试。
- 主进程不用改：`helperPath` 已在平台层处理 `.exe`。

## 验证

- Windows 11（本机，VS 2022 生成工具）：`npm run native:win` 零警告；`npm run test` 82 通过 / 0 失败（含 4 个助手测试）；typecheck、build、docs:check 通过。
- 手测：`mt-text` 繁简互转、空输入、参数错误；`mt-focus` 输出 `{"bundleId":"chrome.exe","name":"Google Chrome",...}`；打开记事本抢走前台后 `--activate <Chrome pid>` 退出码 0，前台切回 Chrome。

## 遗留

- `mt-text` 逐字转换（“軟體”→“软体”），与 macOS 的 ICU `Hant-Hans` 一致，不做词语转换。
- `--activate` 在某些全屏 / 提权窗口上可能失败（返回 4），留待真机验收观察。
