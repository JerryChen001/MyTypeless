import { $, api, escapeHtml, fmtTime } from './util'
import { currentSettings } from './settings'
import { comboKeys, defaultBindings } from '../../shared/platform'

// 首页（D-017）：问候、使用概览、快捷键速查、最近记录

/** 打字速度的估算（字/分钟），用来算“节省的时间” */
const TYPING_CPM = 40

function keys(combo: string): string {
  return comboKeys(combo, api.platform)
    .map((k) => `<kbd>${escapeHtml(k)}</kbd>`)
    .join('')
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 13) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

export function renderShortcuts(): void {
  const s = currentSettings()
  const defaults = defaultBindings(api.platform)
  const b = s?.bindings ?? defaults.bindings
  const main = b.dictation || defaults.hotkeyKey
  // 页面里写死的 Fn：macOS 保持原文，其他平台换成实际的主键
  if (api.platform !== 'darwin') for (const el of document.querySelectorAll('.main-key')) el.innerHTML = keys(main)
  const rows: Array<[string, string]> = [
    [keys(main), '按住说话，松开写入'],
    [keys(main), '轻按一下：免手持，说完再按一下'],
    [`选中文字 + ${keys(main)}`, '用语音改写选中的内容']
  ]
  if (b.ask) rows.push([keys(b.ask), '语音提问'])
  if (b.translate) rows.push([keys(b.translate), `说母语，写入${escapeHtml(s?.translateTarget ?? 'English')}`])
  rows.push([keys('esc'), '取消'])
  $('shortcut-list').innerHTML = rows.map(([k, d]) => `<span class="keys">${k}</span><span class="desc">${d}</span>`).join('')
}

export async function loadHome(): Promise<void> {
  $('home-greeting').textContent = greeting()
  renderShortcuts()
  const [stats, recent] = await Promise.all([api.history.stats(), api.history.list(6)])
  $('stat-chars').textContent = stats.totalChars.toLocaleString('zh-CN')
  $('stat-today').textContent = stats.todayChars.toLocaleString('zh-CN')
  const savedMin = Math.max(0, stats.totalChars / TYPING_CPM - stats.totalDurationMs / 60_000)
  if (savedMin >= 120) {
    $('stat-saved').textContent = (savedMin / 60).toFixed(1)
    $('stat-saved-unit').textContent = '小时'
  } else {
    $('stat-saved').textContent = String(Math.round(savedMin))
    $('stat-saved-unit').textContent = '分钟'
  }
  $('stat-speed').textContent = stats.totalDurationMs > 30_000 ? String(Math.round(stats.totalChars / (stats.totalDurationMs / 60_000))) : '—'

  const list = $('recent-list')
  list.innerHTML = ''
  if (!recent.length) {
    const main = currentSettings()?.bindings?.dictation || defaultBindings(api.platform).hotkeyKey
    list.innerHTML = `<div class="empty">还没有听写记录。在任意输入框按住 ${escapeHtml(comboKeys(main, api.platform).join('+'))} 试试</div>`
    return
  }
  for (const rec of recent) {
    const row = document.createElement('div')
    row.className = 'recent-item'
    const t = document.createElement('span')
    t.className = 'time'
    t.textContent = fmtTime(rec.createdAt)
    const text = document.createElement('span')
    text.className = 'text'
    text.textContent = rec.polishedText || rec.rawText
    row.append(t, text)
    list.appendChild(row)
  }
}
