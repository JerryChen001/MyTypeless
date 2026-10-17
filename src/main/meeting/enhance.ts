/**
 * 识别前的声音处理（D-024）。纯逻辑，不依赖 electron。
 * 只做音量归一：远处的人声音量小，放大到正常说话的水平再识别。
 * 模拟远处说话的识别实验（近讲/稍远/很远 × 安静/偏吵）：音量归一 6 组中 5 组错字变少；
 * 神经网络降噪（GTCRN）后的声音错字反而翻倍（弱的人声被一起削掉），所以降噪只用于分句，识别用原始录音；
 * 简单谱减降噪与上一句做提示词都没有稳定收益，不采用。声纹用原始录音。
 */

const LOUDNESS_TARGET = 3000 // 识别前把一句话的音量拉到正常说话的水平（RMS）
const LOUDNESS_MAX_GAIN = 31.6 // 最多放大 30 dB
const LOUDNESS_PEAK = 30000

/** 音量归一：远处的人声音量小，放大到正常水平再识别；只放大不缩小，峰值不削顶 */
export function normalizeLoudness(pcm: Int16Array): Int16Array {
  if (!pcm.length) return pcm
  let sum = 0
  let peak = 0
  for (let i = 0; i < pcm.length; i++) {
    sum += pcm[i] * pcm[i]
    const a = Math.abs(pcm[i])
    if (a > peak) peak = a
  }
  const rms = Math.sqrt(sum / pcm.length)
  if (!rms || !peak) return pcm
  const gain = Math.min(LOUDNESS_TARGET / rms, LOUDNESS_MAX_GAIN, LOUDNESS_PEAK / peak)
  if (gain <= 1.05) return pcm
  const out = new Int16Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = Math.round(pcm[i] * gain)
  return out
}
