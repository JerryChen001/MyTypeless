# 接口契约

本项目没有对外服务端接口，契约指进程之间与外部服务之间的约定。修改契约时先改本目录文档，再改代码，两边同一次提交。

| 契约 | 唯一事实来源（代码） | 文档 |
| --- | --- | --- |
| 主进程 ↔ 渲染端 IPC | `src/shared/types.ts`（`IPC` 通道名、`SessionProgress`、`Settings`）、`src/shared/api.ts`（`MyTypelessBridge`） | [ipc.md](ipc.md) |
| 主进程 ↔ Swift 原生助手 | `native/*.swift`（参数解析与退出码）、`src/main/native.ts`（调用方） | [native-helpers.md](native-helpers.md) |
| 主进程 ↔ ASR / LLM 服务 | `src/main/providers/asr.ts`、`src/main/polish.ts` | [external-services.md](external-services.md) |

## 通用约定

- 新增通道、参数或退出码只能追加；改变已有语义视为不兼容变更，需同步所有调用方并在本目录说明。
- 用户本地数据（`settings.json`、`keys.bin`、`mytypeless.db`）只允许向前兼容的增量变更（人工门禁，见 `AGENTS.md`）。
- 错误对用户展示前统一经 `src/main/session.ts` 的 `friendlyError` 转换，不直接展示原始错误码。
