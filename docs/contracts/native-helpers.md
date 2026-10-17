# 原生助手契约（主进程 ↔ `mt-*`）

助手是独立 CLI 进程，源码在 `native/`（`mt-whisper` 来自第三方 whisper.cpp，见下文），编译到 `native/bin/`，打包后位于 `MyTypeless.app/Contents/Resources/bin/`。路径解析：`src/main/native.ts` 的 `helperPath`。辅助功能权限归属于启动它们的 app。

## 通用退出码

| 码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 2 | 参数/配置错误 |
| 3 | 未授予辅助功能权限 |
| 4 | 操作失败 |
| 5 | 没有选中文本（仅 `mt-inject --copy-selection`） |

## mt-hotkey（常驻）

调用：`mt-hotkey '<json>'`，`json = {"matches":[{"name":"dictation","key":"space","require":["opt"]}]}`。

- `key`：字母、数字、标点、`space`/`return`/`tab`/`escape`/`delete`、`f1`～`f20`、方向键与翻页键；单修饰键 `fn`、`ropt`/`lopt`、`rcmd`/`lcmd`、`rshift`/`lshift`、`rctrl`/`lctrl`；`shift` 只用于 `fn+shift`（左右 Shift 都算）。未知键写 stderr `unknown key: <key>` 并跳过。
- `require`：`opt`、`cmd`、`ctrl`、`shift`、`fn`。四个主修饰键**精确匹配**（多按了其他修饰键不触发）。
- stdout 每行一个 JSON 事件：`{"name":"system","phase":"ready"}`（tap 就绪）；`{"name":<绑定名>,"phase":"down"|"up"|"abort"}`。
- `abort` 只用于单修饰键触发（如 `fn`）：按住期间按了其他键。若该键与 fn 组成另一条注册组合（`fn+space` 的空格、`fn+shift` 的 Shift），先发当前绑定的 `abort`、再发那条组合的 `down`，组合键被吞掉；否则只发 `abort`，按键照常传给系统（如 Fn+方向键）。
- 命中的触发键被吞掉（包括按住时的自动重复）；单修饰键事件不吞。
- 父进程退出后 0.4 秒内自行退出。主进程侧：异常退出时退避重启至多 5 次；退出码 3 时转为 `globalShortcut` 兜底，并每 4 秒重试。

## mt-inject（一次性）

| 调用 | 行为 |
| --- | --- |
| `mt-inject <base64>` | 以 Unicode 键盘事件键入文本（16 字符一块，修饰键标志清空） |
| `mt-inject --paste <base64>` | 备份剪贴板全部类型 → 写入文本 → ⌘V → 约 0.45 秒后恢复（期间剪贴板被他人改过则不恢复） |
| `mt-inject --combo cmd+c` | 发送组合键（字母、`return`、`space`） |
| `mt-inject --copy-selection` | ⌘C 后等待剪贴板变化（≤600ms），stdout 输出选中文本的 base64，并完整恢复剪贴板；没有选中时退出码 5 |

`base64` 为 UTF-8 文本。主进程降级链（`src/main/inject.ts`）：`auto` 模式下 ≤160 字且无换行时先键入，否则直接粘贴；原生粘贴失败再退 osascript 粘贴。

## mt-text（一次性）

`echo <文本> | mt-text --to hans|hant`：用系统 ICU（`Hant-Hans` / `Hans-Hant`）做繁简转换，UTF-8 进出。调用方 `convertChineseScript`（`src/main/native.ts`）在失败时原样返回文本。

## mt-whisper（常驻，内置识别引擎）

whisper.cpp（MIT）`whisper-server` 的静态编译版，由 `scripts/build-whisper.sh` 从固定版本源码构建（Metal 着色器内嵌，只依赖系统框架）。由 `src/main/whisper/engine.ts` 管理：

- 启动：`mt-whisper -m <模型路径> --host 127.0.0.1 --port <随机空闲端口> -t <线程数> -l auto`
- 就绪：`GET /health` 返回 200（加载模型期间 503）；启动超时 60 秒
- 识别：`POST /inference`，multipart：`file`（WAV 16kHz 单声道）、`response_format=json`、`language`（`auto` 或 ISO-639-1）、可选 `prompt`；返回 `{"text": ...}`，分段之间带换行
- 生命周期：开始录音时预热；闲置 10 分钟退出；意外退出后下次调用自动重启；应用退出时结束
- 已知限制：`language=auto` 会额外跑一次编码器做语言检测（耗时约翻倍）；按请求缩小 `audio_ctx` 会让 turbo 模型输出乱码，不要使用

## mt-diarize（常驻，会议声纹与边录边降噪，D-015、D-024）

`native/diarize-helper.c`（原创）静态链接 sherpa-onnx（Apache-2.0）与 ONNX Runtime（MIT），由 `scripts/build-diarize.sh` 构建。由 `src/main/meeting/diarizer.ts` 管理：

- 启动：会议用两个进程——声纹 `mt-diarize --model <声纹模型.onnx> --segmentation <分段模型.onnx> --threads 2 [--turn-threshold 0.7]`，降噪 `mt-diarize --denoiser <gtcrn_simple.onnx> --threads 1`；内置中文识别另一个进程 `mt-diarize --firered <模型目录> --punct <标点模型.onnx> --threads 4`（D-027，正常优先级、闲置 10 分钟退出）；至少给一个模型；就绪时 stdout 输出 `{"ready":true,"dim":<维度，无声纹模型为 0>,"turns":<bool>,"denoise":<bool>,"asr":<bool>}`（启动超时 20 秒）；调度优先级 nice 15
- 命令（stdin 每行一条；**文件路径放最后、取到行尾**——真实路径含空格，如 `Application Support`）：`embed <起始样本> <样本数> <pcm 文件>`，从会议临时录音（16kHz 单声道 s16le）读取该段（最长 60 秒）
- 命令 `turns <起始样本> <样本数> <pcm 文件>`：对该段做 sherpa-onnx 离线说话人区分（分段 + 句内聚类），返回 `{"ok":true,"turns":[[起,止,说话人],...]}`（相对该段的样本下标；说话人标签只在该段内有意义，仅用来找换人位置）。主进程对每句话带上前面 8 秒录音调用
- 命令 `dnfeed <起始样本> <样本数> <pcm 文件>`：把该段接着送入流式降噪（GTCRN），返回已能输出的部分 `{"ok":true,"at":<首个输出样本在录音时间线上的位置>,"pcm":"<base64 s16le>"}`；输出与输入按样本对齐（实测无额外延迟），可能比输入少（缓冲到下次输出）；起始样本与上次结尾不连续时先重置。`dnflush`（单独一行）输出剩余部分并重置（输出可能比输入略长，调用方截到录音结尾）。`denoise <起始样本> <样本数> <pcm 文件>`：整段降噪，返回 `{"ok":true,"pcm":"..."}`
- 命令 `asr <base64 16kHz s16le>`：识别随命令传入的音频（听写录音不落盘，所以不传文件路径；一行可能很长），返回 `{"ok":true,"text":"..."}`；有 `--punct` 时结果已加标点（FireRedASR2 本身不出标点、英文全大写，大小写由主进程 `fixAsrCase` 处理）
- 结果（stdout 每行一条，与命令按顺序一一对应）：`{"ok":true,"v":[...]}` 或 `{"ok":false,"error":"..."}`（`too short` / `no audio` / `bad range` 等）
- 生命周期：会议中按需启动；闲置 2 分钟退出；stdin 关闭即退出；退出码 2 参数错误、4 模型加载失败
- 只读取传入的录音文件，不写任何文件、不联网

## mt-focus（一次性）

| 调用 | 行为 |
| --- | --- |
| `mt-focus` | stdout：`{"bundleId","name","pid"}`，取不到时为 `{}` |
| `mt-focus --activate <pid>` | 把该进程的应用切到前台；进程不存在退出码 2 |
| `mt-focus --caret-context <前> <后>` | 光标前后各若干字符：`{"text","caret","pid"}`；优先按范围读取（`AXStringForRange`），不支持时读出后只截这一段输出；读不到退出码 5；需要辅助功能权限（D-012） |
| `mt-focus --selected-text` | 焦点元素的 `AXSelectedText`（base64）；没有选中或应用不支持时退出码 5；需要辅助功能权限（否则退出码 3）；单次辅助功能调用超时 0.3 秒 |

两个读文字的用法找焦点元素时先问系统焦点；问不到（Electron / Chromium 应用默认不公开辅助功能树，返回 -25204）时改问前台应用自己的焦点元素，仍问不到则对该应用设置 `AXManualAccessibility = true`（Electron 提供的开关，让它建立辅助功能树）后再问一次。读到的仍只是光标附近这一段 / 选中的文字。

前两个用法不需要辅助功能权限。
