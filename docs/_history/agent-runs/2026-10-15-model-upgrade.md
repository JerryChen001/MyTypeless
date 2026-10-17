# 2026-10-15 模型升级：中文识别 FireRedASR2、会议声纹 ERes2NetV2（D-026、D-027）

## 背景

用户要求检查各模型是否最新最强，并确认“有更好的肯定要用更好的，要保证中文识别和声纹识别的准确率，不用管已保存的声纹”。两路网络调研（ASR；声纹/说话人区分/VAD/降噪）后，在本机（Apple M2 Pro）用公开人工标注数据实测。

## 中文识别（D-027）

数据（各固定随机抽 200 句、20 秒以内）：WenetSpeech test_meeting（真实会议，TwinkStart/WenetSpeech）、AISHELL-1 test（朗读，carlot/AIShell）、ASCEND test（中英混说口语，CAiRE/ASCEND）。打分：去标点空格、英文小写、繁转简、阿拉伯数字逐位转中文；中文按字、英文按词。Whisper 用应用同款 mt-whisper（large-v3-turbo q5_0，language=zh）；其余用 sherpa-onnx v1.13.8 C API，CPU 4 线程。

| 模型 | 会议 | 朗读 | 中英混说 | 每句（会议） | 处理/音频时长 |
| --- | --- | --- | --- | --- | --- |
| Whisper large-v3-turbo（原默认） | 18.3% | 7.5% | 29.2% | 0.87 s | 0.14 |
| **FireRedASR2 AED int8（采用）** | **5.3%** | **1.1%** | **11.7%** | 2.1 s | 0.33 |
| Fun-ASR-Nano int8 | 7.3% | 2.0% | 27.6% | 0.85 s | 0.14 |
| Qwen3-ASR-0.6B int8 | 7.6% | 2.1% | 14.1% | 1.2 s | 0.19 |
| FireRedASR2 CTC int8 | 8.0% | 5.6% | 16.5% | 1.6 s | 0.26 |

- Whisper 会议 18.3% 与公开报告 18.87% 一致，说明打分方法可靠。
- FireRedASR2 线程 4/6/8 速度相同（每句约 2.5 s，40 句平均 6.8 s 长），CoreML 无加速。
- 标点：会议 200 句里带标点的 Whisper 22 句、FireRedASR2 0 句、Qwen3 200 句。FireRedASR2 接 sherpa-onnx 的 CT-Transformer int8 标点模型（官方发布包 SHA256 与 Hugging Face 副本一致），英文全大写由 `fixAsrCase` 恢复。
- Qwen3-ASR 支持按每次识别传热词与语言（`SetOption("hotwords")`），是更快、带标点的备选；准确率差于 FireRedASR2，未采用。

## 会议声纹（D-026）

数据：AliMeeting 测试集 3 场真实会议（argmaxinc/ali-meetings，远场麦克风，各 4 人约 34 分钟），取不与他人重叠的单人区间切成 1～3 秒短段（每人至多 120 段）；AISHELL-1 测试集 14 人整句与中间 1.5 秒。指标：同场短段等错误率（EER）、1.5 秒 EER、按人数分组（每场 4 人；两两 2 人）、认人（每人前一半段做声纹，后一半每 5 段一组认）。

| 模型 | 会议短段 EER | 1.5 秒 EER | 4 人分组 | 2 人分组（最差） | 认人 | 每段 |
| --- | --- | --- | --- | --- | --- | --- |
| CAM++ zh-cn（原） | 11.9% | 0.4% | 94.6% | 97.2%（90%） | 99.2% | 31 ms |
| CAM++ zh_en advanced | 10.8% | 0.5% | 94.8% | 97.4%（91%） | 99.2% | 32 ms |
| **ERes2NetV2 zh-cn（采用）** | **8.6%** | **0.3%** | **95.0%** | **97.7%（91%）** | 99.2% | 183 ms（单线程） |
| ERes2Net large | 9.1% | 1.0% | 95.1% | 97.5%（93%） | 99.2% | 275 ms |
| WeSpeaker ResNet34 CN-Celeb | 12.8% | 3.4% | 86.1% | 95.5%（71%） | 99.2% | 97 ms |
| NeMo TitaNet large | 19.1% | 9.8% | 93.9% | 96.4%（89%） | 98.5% | 77 ms |

ERes2Net（220MB）与 WeSpeaker ResNet293 单线程 20 分钟未算完，实际会议跟不上，排除。ERes2NetV2 两线程算一个 1.5 秒窗口约 80 ms（单线程 146 ms、四线程 56 ms），每秒录音约 2 个窗口，跟得上。

门槛重标定（同场平均链接，保持不同人误并率不变）：0.55 → 0.57、0.45 → 0.45、认人 0.65 → 0.70（同场 3 段一组误认 6.6% → 1.8%、漏认 0.9%）。回归数据改由 `scripts/gen-speaker-fixture.cjs` 从 sr-data 生成（5 人，完整段 + 1～2.5 秒短句，原声 / 模拟外放），合并原 speakers.json 与 short-turns.json；AliMeeting（CC-BY-SA）派生数据不入库。

## 改动

- `mt-diarize`：`--firered`/`--punct` 与 `asr <base64>` 命令（getline 读长行）；`--model` 可省略。
- `src/main/sherpa-helper.ts`：从 `meeting/diarizer.ts` 抽出 `SherpaHelper`（参数、闲置时长、优先级可配）；识别进程 4 线程、正常优先级、闲置 10 分钟。
- `whisper/catalog.ts`：多文件模型 `firered2-aed-int8`（编码器、解码器、词表、标点，约 1.3GB）；按识别语言推荐；`models.ts` 多文件下载 / 校验 / 删除；`whisper/index.ts` 按模型选择引擎。新安装默认按语言推荐，已保存的选择不变。
- 声纹：`SPEAKER_MODELS.embedding` 换 ERes2NetV2（71MB），旧 CAM++ 文件在新模型就绪后删除；`EMBED_MODEL` 标识；`meetings.embed_model`、`voiceprints.model` 增量补列，旧声纹删除；旧会议不认声纹、改名不保存声纹，异常中断的旧会议整理时用新模型重算。

## 验证

`npm run typecheck`、`npm run test`、`npm run build`、`npm run docs:check` 通过。端到端见下节。

## 端到端（打包版 20261015.2347，隔离实例，数据目录带空格，假麦克风）

- 真实会议识别：WenetSpeech test_meeting 12 句（80 秒，句间停 1.2 秒）经完整会议流程（降噪分句 → 识别 → 标点）。上一版 20261015.2035（Whisper）错字 29.6%、0/12 句带标点；本版 **6.3%、12/12 句带标点**。
- 快速接话（归对的时间）：偶尔停顿的原声 / 外放 / 远处三段 98.4% / 97.0% / 97.6%（CAM++ 97.4% / 97.0% / 97.6%）；一直不停顿 leijun+fangjun 92.1% / 90.8%（CAM++ 94.4% / 93.4%），换 leijun+liudehua 98.3% / 94.2%（CAM++ 98.1% / 94.2%）。离线 15 段对话两模型窗口切分持平（1.5 秒窗口、平滑 ±1 仍最好），单段差异属偶然。
- 跨会议认人：第一场（主讲 + 另一人 3 句短话）改名并记住，第二场原声、第三场模拟外放开会 30 秒时两人已标出名字，整理后各句名字全部正确。
- 升级迁移（用户数据库的拷贝，只看数量，测完删除）：声纹 2 → 0，会议中声纹引用 3 → 0；会议 6 场、说话人名字 3 个、逐句声纹 65 句保留，旧会议 embed_model 为空。
