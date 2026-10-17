# 2026-10-17 开源准备（D-030）

## 背景

负责人希望把项目放到 GitHub 开源，方便他人贡献（尤其 Windows 版）。确认：以个人名义开源、名称保留 MyTypeless；同意清理方案与以清理后的快照建新仓库。

## 改动

- 删除：对其他产品安装包的分析图谱、早期复刻计划、原版行为规格（`docs/requirements/reference/`）及其任务路由；开发依赖 `rea-agents`。
- 改写：开发原则与 D-001 改为“全部原创、不引入其他产品的内容”；D-010、D-015、D-017、D-023 等决策、代码注释、STATUS、缺口账本中以其他产品为参照的表述改为直接描述行为；需求中指向早期计划的来源改为“项目初始方案”；过程记录中相关语句与自托管 Git 地址去掉；`2026-10-14-typeless-ux.md` 改名为 `2026-10-14-fn-interaction.md`。
- 新增：LICENSE（MIT）、README（中文，含与 Typeless 无关联的声明）与 README.en.md、CONTRIBUTING（开发环境、提交前检查、需先讨论的改动、Windows 版移植清单）、SECURITY、CODE_OF_CONDUCT、Issue / PR 模板、GitHub Actions CI（macOS：typecheck、test、build、docs:check、native）。
- 整理在单独的工作目录（分支 `open-source`）进行，不影响同时进行中的其他会话。

## 验证

`npm run typecheck`、`npm run test`、`npm run build`、`npm run docs:check` 通过；全部跟踪文件扫描不再出现其他产品名（README 声明除外）、逆向资料、公司域名与本机路径。
