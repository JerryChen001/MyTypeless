# docs/ — 文档维护约定

## 目录职责

| 目录/文件 | 职责 | 何时修改 |
| --- | --- | --- |
| `STATUS.md` | 项目当前状态的唯一来源 | 功能合并、门禁关闭、发布步骤推进 |
| `open-questions.md` | 会改变业务结果的未决事项（`B-xxx`），只在此一处登记 | 发现规则缺口；裁决后移入“已关闭” |
| `decisions/decision-register.md` | 决策索引（每条一行）与默认架构（`A-xxx`） | 新决策追加一行 |
| `decisions/domains/*.md` | 按领域的决策完整原文（`D-xxx`） | 新决策追加原文 |
| `decisions/NNNN-*.md` | ADR：重大技术或架构决策 | 技术方向改变 |
| `glossary.md` | 术语、代码标识对照、易混淆对照与废弃说法（全表唯一） | 新概念、改名或发现混用 |
| `requirements/` | 已确认的业务规则，每个领域一份 | 规则经确认后 |
| `acceptance/` | 验收场景（ID 全局唯一） | 规则或交互变化 |
| `contracts/` | 接口契约与规范 | 接口变化（先于代码） |
| `implementation/gap-ledger.md` | 功能缺口与验收证据（`GAP-xxx`） | 缺口状态变化 |
| `development/recipes.md` | 常见改动的标准步骤与可复制范例 | 开发约定变化 |
| `governance/task-routing.json` | 任务 → 必读文档、搜索范围、验证命令 | 新增领域或文档重组 |
| `governance/playbooks/` | 初始化、任务收尾等固定流程 | 流程变化 |
| `templates/` | 新文档模板 | 很少 |
| `_history/` | 过程记录（运行日志、计划、报告） | 只追加；不作为规则来源，不进入路由 |

## 规则

- 状态只写在 `STATUS.md`；其他文档提及进度时链接它，不复述。
- 同一事实只在一处维护，其他地方链接。发现两处冲突时按 `AGENTS.md` 的事实优先级修正低优先级一方。
- 编号（`D-`、`B-`、`GAP-`、验收 ID）只追加，不复用、不重排、不重新编号。
- 一个表格单元格超过约 600 字时，改为“索引一行 + 独立文件”，不要继续堆叠。
- 过程性内容（某次实现做了什么、计划、复盘）写入 `_history/`，不写进需求、决策或模块说明。
- 文件以换行结尾；本地链接必须存在；新增 `AGENTS.md` 时同目录加 `CLAUDE.md`（内容 `@AGENTS.md`）。

## 验证

`npm run docs:check`
