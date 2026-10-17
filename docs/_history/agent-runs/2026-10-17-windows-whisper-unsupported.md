# 2026-10-17 Windows：Whisper 引擎暂不支持

## 范围

GAP-008：Windows 还没有 `mt-whisper`（whisper.cpp），多语种识别（中文、英文以外）暂不支持。用户决定先兜底、以后再做引擎。此前 Windows 上仍可下载 574MB 的 Whisper 模型，下载完一说话就报“内置识别引擎缺失，请重新安装”，属于误导。

## 改动

- `whisper/catalog.ts`：`engineUnsupported(engine, platform)`（纯函数），Whisper 只在 macOS 可用。
- `ModelInfo.unsupported`：模型列表标出原因；`ModelManager.download` 拒绝下载不支持的模型。
- 会话开始时所选模型的引擎不可用：报 `LOCAL_ENGINE_UNSUPPORTED`（引导改为中文 / 英文或云端识别）并打开主窗口，不再走“模型未下载”。
- 界面：模型行显示原因而不是“下载”；首页横幅显示“本平台暂不支持该语言的内置识别”，不引导下载。macOS 行为不变。

## 验证

- 单测 `test/whisper.test.ts` 新增 `engineUnsupported`；`npm run test` 96 通过 / 0 失败；typecheck、build、docs:check 通过。

## 遗留

- 做 Windows 版 `mt-whisper` 时一并处理 `whisper/engine.ts` 的 `killOrphanEngines`（目前依赖 `/bin/ps`，Windows 上静默跳过）。
