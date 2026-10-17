import { countLearned } from './history'
import { CORRECTION_PROMOTE_CJK, FREQUENT_PROMOTE, diffCorrections, extractTerms, learnableFromCorrection } from './learn'
import { getCaretContext } from './native'

/**
 * 自动词典的编排（D-012）：
 * - 写入后追踪修改：写入后第 8 秒、第 25 秒各读一次光标附近与插入长度相当的一段（原生助手只返回这一段），
 *   比对出被改正的词并计数；前台应用已切换就停止；读到的文字用完即弃，不保存
 * - 常用专有名词：每次听写结果里的英文专有名词计数
 * 新的一次听写开始追踪时，上一次的追踪作废。
 */

const CHECK_AT_MS = [8_000, 25_000]
const CONTEXT_MARGIN = 40

let trackGen = 0

/** 通知调用方有新词收录（例如刷新主窗口词典） */
export type LearnedListener = (terms: string[]) => void

export function learnFrequentTerms(text: string): string[] {
  const learned: string[] = []
  for (const term of extractTerms(text)) {
    if (countLearned(term, 'frequent', FREQUENT_PROMOTE)) learned.push(term)
  }
  return learned
}

export function trackEdits(inserted: string, frontPid: number | undefined, onLearned: LearnedListener): void {
  const gen = ++trackGen
  if (!inserted.trim() || inserted.length > 2000) return
  const seen = new Set<string>()
  let stopped = false
  for (const delay of CHECK_AT_MS) {
    setTimeout(async () => {
      if (stopped || gen !== trackGen) return
      const ctx = await getCaretContext(inserted.length + CONTEXT_MARGIN, CONTEXT_MARGIN)
      if (!ctx || (frontPid && ctx.pid !== frontPid)) {
        stopped = true // 读不到或已切到别的应用：不再追踪
        return
      }
      const learned: string[] = []
      for (const c of diffCorrections(inserted, ctx.text)) {
        const cand = learnableFromCorrection(c)
        if (!cand || seen.has(cand.term)) continue
        seen.add(cand.term)
        if (countLearned(cand.term, 'correction', cand.immediate ? 1 : CORRECTION_PROMOTE_CJK)) learned.push(cand.term)
      }
      if (learned.length) onLearned(learned)
    }, delay)
  }
}

/** 取消正在进行的追踪（例如用户关闭了该功能） */
export function stopTracking(): void {
  trackGen++
}
