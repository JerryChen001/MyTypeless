# 2026-10-14 稳定性修复

## 范围

关联 GAP-001。对 M4 后的代码做全面审查并修复影响核心功能的缺陷；未新增产品功能。刻意没做：新提供方、词典自动学习、屏幕上下文。

## 改动

- 录音：浮动条 CSP 补 `script-src blob:`（之前 AudioWorklet 被拦截，从未采到音频）；热键发起的会话之前不显示浮动条、不采集，改为启动即预建并在会话开始时显示；停止时 `captureFlush`/`audioFinal` 握手补齐尾音；AudioContext 常驻；重采样改为窗口平均。
- 快捷键：Swift 键码表补全（之前 `opt+t/r/a` 无法识别）、修饰键精确匹配、tap 被系统禁用后自动重启用、单修饰键触发；无辅助功能权限时 hold 也注册为触发式兜底，并每 4 秒重试原生助手。
- 会话：显式阶段与 generation，忙时拒绝新会话、任意阶段可取消；润色失败回退本地清理、写入失败放剪贴板（B-005 待确认）；静音与 whisper 幻觉过滤；按住说话不再静音自动停止；错误码转中文提示。
- 润色：本地规则改为保守（之前会删掉改口标记前最多 60 字、删除所有“啊”）；口述包在 `<transcript>` 中防止被当指令；输出清理与“扩写”检测；词典作为 ASR 提示。
- 写入与选区：`--copy-selection` 原生抓选区并完整恢复剪贴板；粘贴备份全部剪贴板类型；`auto` 长文本/多行改粘贴（B-004 待确认）；权限检测改用 `systemPreferences`（之前会键入一个空格）。
- 界面：托盘模板图标（之前为 1×1 透明图）；首个提问回答丢失、“插入到光标”粘进浮卡自身的问题；Esc 全局取消；权限状态面板、开机自启、清空历史。
- 工程：`postinstall` 按 Electron ABI 重编译 better-sqlite3；`npm test`（Node 原生跑 TS）。

## 验证

- `npm run typecheck` 通过；`npm run test` 8/8 通过；`npm run build`、`npm run native`、`npm run dist` 成功。
- 以 `npx electron-vite dev --remoteDebuggingPort 9333` 启动，通过 CDP 驱动 `window.mytypeless`：录音 → 停止 → 冲刷 → 处理 → 未配置 Key 的中文报错 → idle 全链路正确；打包版同样可录音与取消。
- 未验证：授权环境下的快捷键与写入、真实 ASR/LLM 调用、界面视觉。

## 遗留

- GAP-001 真机验证；B-004、B-005 待确认。
