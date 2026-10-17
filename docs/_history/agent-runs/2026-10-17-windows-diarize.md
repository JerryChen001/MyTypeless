# 2026-10-17 Windows 助手：mt-diarize

## 范围

GAP-008 第五步：Windows 版 `mt-diarize`（内置中文 / 英文识别 FireRedASR2、会议声纹、降噪），与 macOS 共用 `native/diarize-helper.c`。没做：`mt-whisper`（其他语言）。

## 改动

- `native/diarize-helper.c`：只加 `_WIN32` 分支——自带 `getline`（识别命令整段音频 base64 在一行，支持任意长度）、`_fseeki64`（`long` 在 Windows 只有 32 位）、`_wfopen` + UTF-8 路径、从 UTF-16 命令行重新取参数并转 UTF-8、stdout 二进制模式。macOS 编译结果不变。
- `native/win/CMakeLists.txt`：传入 `SHERPA_DIR` 时编译 `mt-diarize`，链接 sherpa-onnx `win-x64-static-MT-Release-no-tts-lib` 的全部静态库（与其他助手同为静态运行库 /MT）。
- `scripts/build-native-win.cjs --diarize`（`npm run diarize:win`）：首次下载静态库到 `.vendor/sherpa-onnx-win/`；该包不带头文件，`c-api.h`（只依赖 `stdint.h`）按同一版本标签从源码取；应用开着导致产物被占用时提示并跳过，不再中断。
- CI `check-windows` 改为 `diarize:win`，缓存 `.vendor/sherpa-onnx-win`。
- 主进程不用改（`SherpaHelper` 与平台无关，`helperPath` 已处理 `.exe`）。

## 验证

- 编译、链接零警告，产物 18.9MB。
- 降噪冒烟（模型与录音放在带空格和中文的目录）：ready；整段降噪；两段流式降噪 + 冲刷输出位置连续、总样本数等于输入；文件不存在 / 范围越界 / 未知命令分别报错；关闭 stdin 退出码 0；输出没有 `\r`。sherpa-onnx 报错信息里的中文路径完整，说明参数按 UTF-8 传入。
- `npm run test` 94 通过 / 0 失败；typecheck、build、docs:check 通过。

## 遗留

- FireRedASR2 识别（`asr` 命令）与声纹（`embed` / `turns`）需要下载约 1.3GB / 73MB 模型，待模型下载完成后真机验证。
- 模型下载先连 huggingface.co，国内可能很慢（实测约 75KB/s）；是否调整下载源顺序属于产品决定，未改。
