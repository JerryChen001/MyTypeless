import type { UpdateState } from '../../shared/types'
import { $, api, toast } from './util'

/**
 * 在线更新（D-028）：设置 → 关于 的状态与按钮、侧栏的“新版本”提示。
 * 发现新版本 → 点「下载更新」应用内下载 → 下载完点「重启并更新」。
 */
function fmtSpeed(bps?: number): string {
  if (!bps) return ''
  return bps >= 1 << 20 ? ` · ${(bps / (1 << 20)).toFixed(1)} MB/s` : ` · ${Math.round(bps / 1024)} KB/s`
}

function fmtTime(ms?: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function render(u: UpdateState): void {
  const status = $('update-status')
  const actions = $('update-actions')
  const bar = $('update-progress')
  const notes = $('update-notes')
  actions.innerHTML = ''
  const button = (text: string, onClick: () => void, cls = 'btn mini') => {
    const b = document.createElement('button')
    b.className = cls
    b.textContent = text
    b.addEventListener('click', onClick)
    actions.appendChild(b)
  }
  const checkButton = () => button('检查更新', () => void api.update.check())
  const named = u.version ? `${u.version}${u.build ? `（构建 ${u.build}）` : ''}` : ''
  status.className = ''
  bar.classList.toggle('hidden', u.state !== 'downloading')
  switch (u.state) {
    case 'unsupported':
      status.textContent = u.error ?? '不支持在线更新'
      status.className = 'hint'
      break
    case 'checking':
      status.textContent = '正在检查新版本…'
      break
    case 'latest':
      status.textContent = `已是最新版本${u.checkedAt ? `（${fmtTime(u.checkedAt)} 检查）` : ''}`
      checkButton()
      break
    case 'available':
      status.textContent = `有新版本 ${named}`
      // Windows 解压即用版：打开 Release 页面，下载新的 zip 解压覆盖（设置与模型在用户数据目录，不受影响）
      if (u.manual) button('前往下载', () => void api.update.openDownload(), 'btn mini primary')
      else button('下载更新', () => void api.update.download(), 'btn mini primary')
      break
    case 'downloading':
      status.textContent = `正在下载新版本 ${u.version} · ${u.percent ?? 0}%${fmtSpeed(u.bytesPerSec)}`
      ;(bar.firstElementChild as HTMLElement).style.width = `${u.percent ?? 0}%`
      button('取消', () => void api.update.cancel())
      break
    case 'downloaded':
      status.textContent = `新版本 ${named} 已下载`
      button('重启并更新', async () => {
        const r = await api.update.install()
        if (!r.ok && r.error) toast(r.error, 3500)
      }, 'btn mini primary')
      break
    case 'error':
      status.textContent = u.error ?? '更新失败'
      status.className = 'hint warn'
      if (u.dmgUrl) button('下载安装包', () => void api.update.openDownload())
      if (u.version) button('重试下载', () => void api.update.download(), 'btn mini primary')
      else checkButton()
      break
    default:
      status.textContent = '尚未检查新版本'
      checkButton()
  }
  const showNotes = !!u.notes && ['available', 'downloading', 'downloaded', 'error'].includes(u.state) && !!u.version
  notes.classList.toggle('hidden', !showNotes)
  notes.textContent = showNotes ? `更新内容：\n${u.notes}` : ''

  const badge = $('update-badge')
  const pending = u.state === 'available' || u.state === 'downloaded'
  badge.classList.toggle('hidden', !pending)
  badge.textContent = u.state === 'downloaded' ? `重启更新到 ${u.version}` : `有新版本 ${u.version}`
}

export function initUpdate(navigate: (hash: string) => void): void {
  $('update-badge').addEventListener('click', () => navigate('#settings/about'))
  api.update.onState(render)
  void api.update.getState().then(render)
}
