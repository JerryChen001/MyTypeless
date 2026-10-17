import { app } from 'electron'
import { existsSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { SherpaHelper } from '../sherpa-helper'
import { DownloadError, downloadFile } from '../whisper/download'
import { MODEL_SOURCES } from '../whisper/catalog'

/**
 * 说话人声纹（D-015）：模型管理 + mt-diarize 常驻进程。
 * 模型（首次开会或在设置里下载到 userData/models/，Apache-2.0 / MIT，经 sherpa-onnx 导出）：
 * - 声纹：3D-Speaker ERes2NetV2 中文模型（约 71MB，Apache-2.0）——每段话的声音特征，用于判断是谁。
 *   真实会议远场短段评测在 8 个候选里最好（区分错误率 8.6%，原 CAM++ 11.9%），专为短句设计（D-026）
 * - 分段：pyannote segmentation 3.0 量化版（约 1.5MB）——找出一句话内部换人的位置（真人对话常常不停顿就接话）
 * - 降噪：GTCRN（约 0.5MB，MIT）——会议录音边录边降噪，降噪后的声音用于分句与识别（D-024；声纹仍用原始录音）
 * mt-diarize 只在会议期间运行：声纹两线程、降噪单线程，低优先级（让位给用户的其他工作），会议结束 IDLE_STOP_MS 后退出。
 * 会议用两个进程：声纹（diarizer）与边录边降噪（denoiser），互不排队。
 */

interface ModelFile {
  file: string
  repo: string
  remote: string
  sizeBytes: number
  sha256: string
  urls?: string[] // 不在 Hugging Face 上的文件：直接给下载地址
}

export const SPEAKER_MODELS: { embedding: ModelFile; segmentation: ModelFile; denoiser: ModelFile } = {
  embedding: {
    file: '3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx',
    repo: 'csukuangfj/speaker-embedding-models',
    remote: '3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx',
    sizeBytes: 71_441_526,
    sha256: 'bf1a75b9930474cf3389ef415e6e5d38ca96fea4a3a00f7e301d080a58ee2239'
  },
  segmentation: {
    file: 'pyannote-segmentation-3.0.int8.onnx',
    repo: 'csukuangfj/sherpa-onnx-pyannote-segmentation-3-0',
    remote: 'model.int8.onnx',
    sizeBytes: 1_540_506,
    sha256: 'd582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d'
  },
  denoiser: {
    file: 'gtcrn_simple.onnx',
    repo: '',
    remote: '',
    urls: ['https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/gtcrn_simple.onnx'],
    sizeBytes: 535_638,
    sha256: 'e77603ac0c23dac3227dd2d7135b3a585cbee2679048aecfa886657d3ae1b534'
  }
}
// 区分说话人必需的文件；降噪是增强（缺少时会议照常，分句与识别用原始录音）
const REQUIRED = [SPEAKER_MODELS.embedding, SPEAKER_MODELS.segmentation]
// 换掉的旧模型文件：新模型就绪后删除（D-026）
const LEGACY_FILES = ['3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx']
const FILES = [...REQUIRED, SPEAKER_MODELS.denoiser]
const TOTAL_BYTES = FILES.reduce((n, f) => n + f.sizeBytes, 0)

const IDLE_STOP_MS = 2 * 60_000

export type SpeakerModelState = 'ready' | 'missing' | 'downloading' | 'error'

class SpeakerModel {
  private downloading: Promise<void> | null = null
  private ctrl: AbortController | null = null
  private lastError = false
  progress = 0
  onChange: () => void = () => {}

  pathOf(f: ModelFile): string {
    return join(app.getPath('userData'), 'models', f.file)
  }

  has(f: ModelFile): boolean {
    const p = this.pathOf(f)
    return existsSync(p) && statSync(p).size === f.sizeBytes
  }

  ready(): boolean {
    return REQUIRED.every((f) => this.has(f))
  }

  /** 删除换掉的旧模型文件（新模型就绪后才删，避免下载失败时什么都没有） */
  removeLegacy(): void {
    if (!this.ready()) return
    for (const name of LEGACY_FILES) {
      const p = join(app.getPath('userData'), 'models', name)
      if (existsSync(p)) unlinkSync(p)
    }
  }

  denoiserReady(): boolean {
    return this.has(SPEAKER_MODELS.denoiser)
  }

  state(): SpeakerModelState {
    if (this.ready()) return 'ready'
    if (this.downloading) return 'downloading'
    return this.lastError ? 'error' : 'missing'
  }

  /** 下载缺少的文件（已就绪或正在下载时复用）；失败不抛出，状态变为 error */
  ensure(): Promise<void> {
    if (FILES.every((f) => this.has(f))) return Promise.resolve()
    if (this.downloading) return this.downloading
    this.lastError = false
    this.progress = 0
    const ctrl = new AbortController()
    this.ctrl = ctrl
    this.downloading = (async () => {
      let done = 0
      for (const f of FILES) {
        if (this.has(f)) {
          done += f.sizeBytes
          continue
        }
        await downloadFile({
          urls: f.urls ?? MODEL_SOURCES.map((base) => `${base}/${f.repo}/resolve/main/${f.remote}`),
          dest: this.pathOf(f),
          sizeBytes: f.sizeBytes,
          sha256: f.sha256,
          signal: ctrl.signal,
          onProgress: (p) => {
            this.progress = (done + p.receivedBytes) / TOTAL_BYTES
            this.onChange()
          }
        })
        done += f.sizeBytes
      }
    })()
      .catch((err) => {
        this.lastError = !(err instanceof DownloadError && err.code === 'ABORTED')
        console.warn('[meeting] speaker model download failed:', err)
      })
      .finally(() => {
        this.downloading = null
        this.ctrl = null
        this.removeLegacy()
        this.onChange()
      })
    this.onChange()
    return this.downloading
  }

  /** 取消下载（保留已下载部分，下次从断点继续） */
  cancel(): void {
    this.ctrl?.abort()
  }

  /** 删除模型（含未完成的 .part）；调用方负责先停掉 mt-diarize */
  remove(): void {
    this.cancel()
    for (const f of FILES) {
      for (const p of [this.pathOf(f), `${this.pathOf(f)}.part`]) {
        if (existsSync(p)) unlinkSync(p)
      }
    }
    this.lastError = false
    this.onChange()
  }
}

export const speakerModel = new SpeakerModel()

export const diarizer = new SherpaHelper({
  // ERes2NetV2 单线程算一个 1.5 秒窗口约 150ms，两线程约 80ms（句内按窗口找换人时每秒录音约 2 个窗口）
  args: () =>
    speakerModel.ready()
      ? ['--model', speakerModel.pathOf(SPEAKER_MODELS.embedding), '--segmentation', speakerModel.pathOf(SPEAKER_MODELS.segmentation), '--threads', '2']
      : null,
  idleMs: IDLE_STOP_MS,
  nice: 15
})
export const denoiser = new SherpaHelper({
  args: () => (speakerModel.denoiserReady() ? ['--denoiser', speakerModel.pathOf(SPEAKER_MODELS.denoiser), '--threads', '1'] : null),
  idleMs: IDLE_STOP_MS,
  nice: 15
})
