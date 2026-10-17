// 主窗口公共工具：preload API、取元素、转义、提示、弹出菜单、说话人配色
export const api = window.mytypeless

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

let toastTimer: number | null = null
export function toast(msg: string, ms = 2200): void {
  const el = $('toast')
  el.textContent = msg
  el.classList.remove('hidden')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.classList.add('hidden'), ms)
}

export type PopoverItem = { label: string; color?: string; onClick: () => void } | { header: string } | 'sep'

/** 在元素下方弹出菜单；点别处或按 Esc 关闭 */
export function showPopover(anchor: HTMLElement, items: PopoverItem[]): void {
  const pop = $('popover')
  pop.innerHTML = ''
  for (const it of items) {
    if (it === 'sep') {
      pop.appendChild(Object.assign(document.createElement('div'), { className: 'sep' }))
    } else if ('header' in it) {
      pop.appendChild(Object.assign(document.createElement('div'), { className: 'label', textContent: it.header }))
    } else {
      const b = document.createElement('button')
      if (it.color) {
        const dot = document.createElement('i')
        dot.style.background = it.color
        b.appendChild(dot)
      }
      b.appendChild(document.createTextNode(it.label))
      b.addEventListener('click', () => {
        hidePopover()
        it.onClick()
      })
      pop.appendChild(b)
    }
  }
  pop.classList.remove('hidden')
  const r = anchor.getBoundingClientRect()
  const top = Math.min(r.bottom + 4, window.innerHeight - pop.offsetHeight - 8)
  const left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)
  pop.style.top = `${Math.max(8, top)}px`
  pop.style.left = `${Math.max(8, left)}px`
}

/** 在元素下方弹出自定义内容（改名表单等） */
export function showPopoverContent(anchor: HTMLElement, content: HTMLElement): void {
  const pop = $('popover')
  pop.innerHTML = ''
  pop.appendChild(content)
  pop.classList.remove('hidden')
  const r = anchor.getBoundingClientRect()
  const top = Math.min(r.bottom + 4, window.innerHeight - pop.offsetHeight - 8)
  const left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)
  pop.style.top = `${Math.max(8, top)}px`
  pop.style.left = `${Math.max(8, left)}px`
}

export function hidePopover(): void {
  $('popover').classList.add('hidden')
}

document.addEventListener('mousedown', (e) => {
  const pop = $('popover')
  if (!pop.classList.contains('hidden') && !pop.contains(e.target as Node)) hidePopover()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hidePopover()
})

/** 说话人配色（按编号循环） */
const SPEAKER_COLORS = ['#2f6bff', '#e5484d', '#2fa45f', '#d97706', '#8e4ec6', '#0891b2', '#db2777', '#65a30d']
export function speakerColor(label: number | null): string {
  if (label === null) return '#9a9aa1'
  return SPEAKER_COLORS[(label - 1) % SPEAKER_COLORS.length]
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} 分钟`
  return `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ''}`
}

export function fmtDate(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, today)) return '今天'
  if (same(d, yesterday)) return '昨天'
  return d.getFullYear() === today.getFullYear() ? `${d.getMonth() + 1} 月 ${d.getDate()} 日` : `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
