import type { HistoryRecord } from '../../shared/types'
import { $, api, escapeHtml, fmtDate, fmtTime } from './util'

// 历史页：按日期分组、搜索、复制、删除

const MODE_NAME: Record<HistoryRecord['mode'], string> = { dictation: '听写', translate: '翻译', rewrite: '改写', ask: '提问' }

let records: HistoryRecord[] = []

export async function loadHistory(): Promise<void> {
  records = await api.history.list(500)
  renderHistory()
}

function renderHistory(): void {
  const q = ($('history-search') as HTMLInputElement).value.trim().toLowerCase()
  const shown = q
    ? records.filter((r) => [r.polishedText, r.rawText, r.appName ?? '', r.sourceText ?? ''].some((t) => t.toLowerCase().includes(q)))
    : records
  const list = $('history-list')
  list.innerHTML = ''
  if (!shown.length) {
    list.innerHTML = `<div class="empty">${q ? '没有找到相关记录' : '还没有听写记录'}</div>`
    return
  }
  let day = ''
  for (const rec of shown) {
    const d = fmtDate(rec.createdAt)
    if (d !== day) {
      day = d
      list.appendChild(Object.assign(document.createElement('div'), { className: 'day-label', textContent: d }))
    }
    list.appendChild(renderRecord(rec))
  }
}

function renderRecord(rec: HistoryRecord): HTMLElement {
  const el = document.createElement('div')
  el.className = 'rec'
  const original =
    rec.mode === 'rewrite' && rec.sourceText
      ? `原文：${escapeHtml(rec.sourceText)}<br />指令：${escapeHtml(rec.rawText)}`
      : rec.polishedText && rec.polishedText !== rec.rawText
        ? `${rec.mode === 'ask' ? '问题' : '原话'}：${escapeHtml(rec.rawText)}`
        : ''
  el.innerHTML = `
    <div class="meta">
      <span>${rec.mode !== 'dictation' ? `<span class="mode-badge">${MODE_NAME[rec.mode] ?? rec.mode}</span>` : ''}${escapeHtml(fmtTime(rec.createdAt))} · ${Math.round(rec.durationMs / 100) / 10} 秒${rec.appName ? ` · ${escapeHtml(rec.appName)}` : ''}</span>
      <span>${rec.status === 'completed' ? '' : '⚠ ' + escapeHtml(rec.error ?? '')}</span>
    </div>
    <div class="text"></div>
    ${original ? `<div class="raw">${original}</div>` : ''}
    <div class="actions">
      <button class="btn mini act-copy">复制</button>
      <button class="btn mini act-del">删除</button>
    </div>`
  ;(el.querySelector('.text') as HTMLElement).textContent = rec.polishedText || rec.rawText
  const copyBtn = el.querySelector('.act-copy') as HTMLButtonElement
  copyBtn.addEventListener('click', async () => {
    if (await api.history.copy(rec.id)) {
      copyBtn.textContent = '已复制 ✓'
      setTimeout(() => (copyBtn.textContent = '复制'), 1200)
    }
  })
  el.querySelector('.act-del')!.addEventListener('click', async () => {
    await api.history.remove(rec.id)
    records = records.filter((r) => r.id !== rec.id)
    renderHistory()
  })
  return el
}

$('history-search').addEventListener('input', renderHistory)
$('btn-clear').addEventListener('click', async () => {
  if (!confirm('确定清空全部历史记录？此操作不可撤销。')) return
  await api.history.clear()
  void loadHistory()
})
