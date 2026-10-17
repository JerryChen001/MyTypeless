# 2026-10-14 接入 ai-doc-kit 文档架构

## 范围

用 ai-doc-kit 的 `init` 生成骨架（领域：pipeline、native、ui、release），按 bootstrap 流程填写。人工确认了人工门禁（四项）与完成标准（只看自动检查）。

## 改动

- 根 `AGENTS.md`（规则、代码地图、命令、已知陷阱、门禁、完成标准）与 `CLAUDE.md` 桥接；模块说明 `src/main/`、`src/renderer/`、`native/`。
- 旧文档归位：早期计划中已确认的决策提取为 D-001～D-006、A-001～A-006，进度并入 `STATUS.md`。
- 新增契约：IPC、原生助手、外部服务；需求与验收各四份（需求均为 draft）；B-001～B-005；GAP-001～GAP-009；术语表。
- 代码对齐契约：`mt:navigate` 纳入 `IPC` 常量，删除未使用的 `hotkeyToggle` 通道。
- README 的状态表改为链接 `STATUS.md`（之前与计划文档的里程碑状态互相矛盾）。

## 验证

- `npm run docs:check`、`npm run typecheck`。

## 遗留

- 需求文档待负责人确认后改为 confirmed；A-002（原生能力用 CLI 子进程而非早期方案的 koffi）待确认。
