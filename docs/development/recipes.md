# 开发配方（Recipes）

状态：`active`。本文给出常见改动的标准步骤和**可复制的真实范例**，适用于任何 AI 编码工具和人工开发。范例引用文件和函数名，不引用行号；与代码不一致时以代码为准并回改本文。

## 通用前置

1. 读 [STATUS.md](../STATUS.md) 和任务路由输出；确认相关 B 项已关闭（[open-questions.md](../open-questions.md)）。
2. 产品规则只来自需求、决策和验收文档；缺失时按下一节处理，不猜。
3. 能脱离 `electron` 的逻辑先写失败测试（`test/*.test.ts`），再实现。

## 需求未定义时

文档中找不到规则，且该规则会影响用户可见结果（写入什么、何时写入、采集哪些数据、保存多久、如何降级）时，不实现：

1. 在 [open-questions.md](../open-questions.md) 新增下一个 `B-xxx`：写明当前已知边界，并列出会导致不同结果的几种解释。
2. 需要跟踪交付时，在 [gap-ledger.md](../implementation/gap-ledger.md) 新增 `GAP-xxx`，状态 `INPUT_BLOCKED`。
3. 人工确认后新增 `D-xxx`：在 `docs/decisions/domains/` 对应领域文件追加原文，在[决策索引](../decisions/decision-register.md)追加一行；回写需求和验收文档；关闭 B 项；再按下文实现。

## 新增 IPC 通道

契约见 [IPC 契约](../contracts/ipc.md)，先改契约再改代码。

1. `src/shared/types.ts`：在 `IPC` 常量加通道名（前缀 `mt:`）。
2. `src/preload/index.ts`：在 `api` 对应分组加方法（`ipcRenderer.invoke` 或订阅函数，订阅要返回取消函数）。
3. `src/shared/api.ts`：在 `MyTypelessBridge` 加同名方法签名。
4. `src/main/index.ts`：在 `registerIpc` 加 handler，范例 `IPC.historyClear`。
5. `npm run typecheck`。

## 新增 ASR 或 LLM 提供方

1. ASR：在 `src/main/providers/asr.ts` 新建类实现 `AsrProvider`，范例 `LocalWhisperAsr`；支持 `vocabulary`（词典提示）并用 `withTimeout` 包装请求；在 `createAsrProvider` 加分支。
2. `src/shared/types.ts` 的 `AsrProviderConfig.provider` 加取值；主窗口 `src/renderer/hub/index.html` 的 `asr-provider` 下拉加选项，`hub/main.ts` 的 `applyAsrProviderUi` 处理显隐。
3. 错误码沿用 `<PREFIX>_HTTP_<status>` 形式，并在 `src/main/session.ts` 的 `friendlyError` 加中文提示。
4. 更新 [外部服务契约](../contracts/external-services.md)。

## 新增或调整模式、快捷键

1. 模式：`FeatureMode`（`src/shared/types.ts`）→ `Settings.bindings` 与 `DEFAULT_SETTINGS`（`src/main/config.ts`）→ `HotkeyController.registerAll` 的绑定表（`src/main/hotkeys.ts`；主键以外的绑定走 `key-press.ts` 的 `onModeKey`）→ `DictationSessionManager.process` 分支（`src/main/session.ts`）→ 浮动条 `MODE_LABEL`、主窗口历史 `MODE_NAME`。
2. 改按键时序（按住 / 轻按 / 组合撤销）：先改 `test/key-press.test.ts`，再改 `src/main/key-press.ts`；与 Fn 组合相关的切换在 `native/hotkey-helper.swift` 的事件回调里。
3. 新的按键名：先在 `native/hotkey-helper.swift` 的 `keyTable` 支持，再在 `hotkeys.ts` 的 `ACCEL_KEY` 补 `globalShortcut` 写法（单修饰键加入 `MODIFIER_ONLY_KEYS`）。
4. `npm run native && npm run typecheck`；更新 [原生助手契约](../contracts/native-helpers.md) 的按键列表。

## 内置识别引擎：升级 whisper.cpp 或新增模型

1. 升级引擎：改 `scripts/build-whisper.sh` 的 `WHISPER_VERSION`，运行 `npm run whisper -- --force`；用 `otool -L native/bin/mt-whisper` 确认只依赖系统框架；按 [原生助手契约](../contracts/native-helpers.md) 回归 `/health`、`/inference`。同步 A-007。
2. 新增模型：在 `src/main/whisper/catalog.ts` 的 `MODELS` 加一项；大小与 SHA256 从 `https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/main` 的 `size` 与 `lfs.oid` 取。先用 `mt-whisper` 实测中文与中英混说效果和耗时，再写进 `description`。
3. 改模型下载逻辑：先在 `test/whisper.test.ts` 加用例（本地 Range 服务器模拟断网、换源、校验失败）。

## 修改原生助手

1. 先改 [原生助手契约](../contracts/native-helpers.md)（参数、输出、退出码）。
2. 改 `native/*.swift`，范例 `inject-helper.swift` 的 `--copy-selection`；调用方 `src/main/native.ts`。
3. `npm run native` 编译；`native/bin/mt-focus` 冒烟。需要辅助功能权限的行为只能真机验证，在缺口账本标 `DONE_PENDING_REVIEW`。

## 新增设置项

1. `Settings` 类型（`src/shared/types.ts`）与 `DEFAULT_SETTINGS`（`src/main/config.ts`）同时加字段；老用户的 `settings.json` 靠 `deepMerge` 自动补默认值，不要改已有字段的含义（人工门禁）。
2. 主窗口：`hub/index.html` 加控件，`hub/main.ts` 的 `loadSettingsIntoUi` 读、`btn-save` 处理写。
3. 需要立即生效的副作用写在 `index.ts` 的 `IPC.settingsSet` handler，范例 `applyLoginItem`。

## 修改 sqlite 表结构

1. 只做向前兼容的增量变更：新列加在 `src/main/history.ts` 的 `migrateColumns`（`PRAGMA table_info` 判断后 `ALTER TABLE ADD COLUMN`），新表用 `CREATE TABLE IF NOT EXISTS`。
2. 同步 `rowToRecord`、`appendHistory` 与 `HistoryRecord` 类型。
3. 删列、改列含义、改主键属于人工门禁。

## 新增渲染窗口

1. `src/renderer/<name>/` 下建 `index.html`（带 CSP meta，范例 `answer-card/index.html`）、`main.ts`、`style.css`。
2. `electron.vite.config.ts` 的 `renderer.build.rollupOptions.input` 注册入口。
3. `src/main/index.ts` 照 `createAnswerCard` 建窗口（`loadRenderer`、`attachRendererDiagnostics`、preload）；首次推送数据前等 `did-finish-load`，范例 `updateAnswerCard`。

## 测试分层

| 层 | 范例 | 命令 |
| --- | --- | --- |
| 纯逻辑单元测试（不 import `electron`） | `test/polish.test.ts` | `npm run test` |
| 类型检查（主进程 + 渲染端） | `tsconfig.node.json`、`tsconfig.web.json` | `npm run typecheck` |
| 构建 | `electron.vite.config.ts` | `npm run build` |
| 原生助手编译 | `scripts/build-native.sh` | `npm run native` |
| 端到端（手动 / CDP） | `npm run dev` 或 `npx electron-vite dev --remoteDebuggingPort 9333` 后用 CDP 调 `window.mytypeless` | — |
| 文档结构 | `scripts/doc-kit/check.mjs` | `npm run docs:check` |
