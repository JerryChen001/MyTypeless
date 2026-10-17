import type { MeetingDetail, MeetingLive, MeetingSegment, MeetingSummary } from '../../shared/types'
import { renderMarkdown } from '../../shared/markdown'
import { $, api, escapeHtml, fmtClock, fmtDate, fmtDuration, fmtTime, hidePopover, showPopover, showPopoverContent, speakerColor, toast, type PopoverItem } from './util'

// 会议页（D-015）：会议列表 / 开始会议 / 会议详情（实时转写、说话人纠正、纪要）

type Tab = 'minutes' | 'transcript' | 'speakers'

let live: MeetingLive = { state: 'idle' }
let liveAt = 0
let currentId: string | null = null
let detail: MeetingDetail | null = null
let tab: Tab = 'transcript'
let tabChosen = false
let editing = false
let navigate: (hash: string) => void = () => {}
let reloadTimer: number | null = null

const content = () => document.querySelector('.content') as HTMLElement

export function initMeeting(nav: (hash: string) => void): void {
  navigate = nav
}

export function currentLive(): MeetingLive {
  return live
}

export function liveElapsed(): number {
  return (live.elapsedMs ?? 0) + (live.running ? Date.now() - liveAt : 0)
}

/** 路由进入会议页：有 id 显示详情，否则显示列表 */
export async function showMeetingPage(id?: string): Promise<void> {
  if (id !== currentId) {
    tabChosen = false
    editing = false
  }
  currentId = id ?? null
  $('meeting-list-view').classList.toggle('hidden', !!id)
  $('meeting-detail-view').classList.toggle('hidden', !id)
  if (id) await loadDetail()
  else await loadList()
}

// —— 列表 ——

const STATUS_TEXT: Record<MeetingSummary['status'], string> = {
  recording: '进行中',
  paused: '已暂停',
  processing: '整理中',
  done: '',
  interrupted: '待整理'
}

/** 参会人数选项（D-021：只按人数区分说话人，不自动判断人数） */
const SPEAKER_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 10]

async function loadList(): Promise<void> {
  const meetings = await api.meeting.list()
  const sel = $('meeting-speakers') as HTMLSelectElement
  if (!sel.options.length) {
    for (const n of SPEAKER_COUNTS) sel.add(new Option(`参会 ${n} 人`, String(n)))
    sel.value = String((await api.settings.get()).meetingSpeakers || 2)
  }
  renderStartCard()
  const box = $('meeting-interrupted')
  box.innerHTML = ''
  for (const m of meetings.filter((x) => x.status === 'interrupted')) {
    const card = document.createElement('div')
    card.className = 'card interrupted'
    const text = document.createElement('span')
    text.textContent = `「${m.title}」上次意外中断，录音还在本机，可以继续整理`
    const btn = document.createElement('button')
    btn.className = 'btn primary'
    btn.textContent = '继续整理'
    btn.addEventListener('click', () => endChoice(btn, (minutes) => void finishMeeting(m.id, minutes), '整理'))
    card.append(text, btn)
    box.appendChild(card)
  }

  const list = $('meeting-list')
  list.innerHTML = ''
  if (!meetings.length) {
    list.innerHTML = '<div class="empty">还没有会议记录</div>'
    return
  }
  for (const m of meetings) {
    const el = document.createElement('div')
    el.className = 'meeting-item'
    const status = m.status === 'done' && !m.hasMinutes ? '无纪要' : STATUS_TEXT[m.status]
    const badgeCls = m.status === 'recording' || m.status === 'paused' ? 'live' : m.status === 'interrupted' || status === '无纪要' ? 'warn' : ''
    el.innerHTML = `
      <div class="main">
        <span class="title"></span>
        <span class="meta"></span>
      </div>
      ${status ? `<span class="status-badge ${badgeCls}">${status}</span>` : ''}`
    ;(el.querySelector('.title') as HTMLElement).textContent = m.title
    ;(el.querySelector('.meta') as HTMLElement).textContent = [
      `${fmtDate(m.startedAt)} ${fmtTime(m.startedAt)}`,
      m.durationMs ? fmtDuration(m.durationMs) : '',
      m.speakers.length ? m.speakers.join('、') : ''
    ]
      .filter(Boolean)
      .join(' · ')
    el.addEventListener('click', () => navigate(`#meeting/${m.id}`))
    list.appendChild(el)
  }
}

function renderStartCard(): void {
  const busy = live.state !== 'idle'
  const btn = $('btn-meeting-start') as HTMLButtonElement
  btn.disabled = busy
  const state = $('meeting-start-state')
  if (busy && live.meetingId) {
    state.innerHTML = live.state === 'processing' ? '上一场会议正在整理中…' : '有会议正在进行：<a class="link" href="#meeting/' + escapeHtml(live.meetingId) + '">查看</a>'
  } else if (live.speakerModel === 'downloading') {
    state.textContent = `正在下载声纹模型 ${Math.round((live.speakerModelProgress ?? 0) * 100)}%（首次使用，约 31MB）`
  } else if (live.speakerModel === 'error') {
    state.textContent = '声纹模型下载失败：会议照常转写，下次开会时会重试下载'
  } else state.textContent = ''
}

$('btn-meeting-start').addEventListener('click', async () => {
  const title = ($('meeting-title') as HTMLInputElement).value.trim()
  const n = Number(($('meeting-speakers') as HTMLSelectElement).value) || 2
  const r = await api.meeting.start({ title, expectedSpeakers: n })
  if (!r.ok) {
    $('meeting-start-state').textContent = r.error ?? '无法开始会议'
    return
  }
  ;($('meeting-title') as HTMLInputElement).value = ''
  toast('会议已开始：请告知参会者正在录音转写')
  navigate(`#meeting/${r.meetingId}`)
})

/** 结束/整理时选择：生成纪要，或只保存记录 */
function endChoice(anchor: HTMLElement, go: (minutes: boolean) => void, verb = '结束'): void {
  showPopover(anchor, [
    { label: `${verb}并生成纪要`, onClick: () => go(true) },
    { label: `${verb}，只保存记录`, onClick: () => go(false) }
  ])
}

async function finishMeeting(id: string, minutes: boolean): Promise<void> {
  const r = await api.meeting.finish(id, { minutes })
  if (!r.ok) toast(r.error ?? '无法整理')
  else navigate(`#meeting/${id}`)
}

// —— 详情 ——

async function loadDetail(): Promise<void> {
  if (!currentId) return
  const d = await api.meeting.get(currentId)
  if (!d) {
    navigate('#meeting')
    return
  }
  detail = d
  if (!tabChosen) tab = d.status === 'done' && (d.minutes || d.minutesError) ? 'minutes' : 'transcript'
  renderDetail()
}

function isLiveHere(): boolean {
  return !!detail && live.meetingId === detail.id && (live.state === 'recording' || live.state === 'paused')
}

function renderDetail(): void {
  const d = detail
  if (!d) return
  const titleInput = $('meeting-detail-title') as HTMLInputElement
  if (document.activeElement !== titleInput) titleInput.value = d.title
  $('meeting-detail-meta').textContent = [
    `${fmtDate(d.startedAt)} ${fmtTime(d.startedAt)}`,
    d.durationMs ? fmtDuration(d.durationMs) : '',
    d.speakerList.length ? `${d.speakerList.length} 位说话人` : '',
    STATUS_TEXT[d.status]
  ]
    .filter(Boolean)
    .join(' · ')
  renderBars()
  for (const b of document.querySelectorAll<HTMLButtonElement>('#meeting-tabs button')) b.classList.toggle('active', b.dataset.tab === tab)
  for (const p of document.querySelectorAll<HTMLElement>('#meeting-detail-view .tab-panel')) p.classList.toggle('active', p.dataset.tab === tab)
  ;($('btn-meeting-delete') as HTMLButtonElement).disabled = isLiveHere() || (live.state === 'processing' && live.meetingId === d.id)
  renderSpeakerBar()
  renderTranscript()
  renderSpeakers()
  renderMinutes()
}

/** 说话人栏：按声音自动区分出的每个人，点击改名 */
function renderSpeakerBar(): void {
  const bar = $('speaker-bar')
  const d = detail!
  bar.innerHTML = ''
  for (const sp of d.speakerList) {
    const chip = speakerChip(sp.id)
    const count = document.createElement('span')
    count.className = 'count'
    count.textContent = ` · ${sp.segmentCount}`
    chip.appendChild(count)
    bar.appendChild(chip)
  }
  // 参会人数：随时改，立即按新人数重新区分（D-020）
  const count = document.createElement('select')
  count.className = 'count-select'
  count.title = '改参会人数后立即按新人数重新区分说话人'
  if (!d.expectedSpeakers) {
    const unset = new Option('人数：未设置', '')
    unset.disabled = true
    count.add(unset)
  }
  for (const n of SPEAKER_COUNTS) count.add(new Option(`${n} 人`, String(n)))
  count.value = d.expectedSpeakers ? String(d.expectedSpeakers) : ''
  count.addEventListener('change', async () => {
    const n = Number(count.value)
    if (!n) return
    const r = await api.meeting.setExpected(d.id, n)
    toast(r.ok ? `已按 ${n} 人重新区分说话人` : r.error ?? '无法重新区分', r.ok ? 2200 : 4000)
  })
  bar.appendChild(count)
  const hint = document.createElement('span')
  hint.className = 'hint'
  const model = live.speakerModel
  hint.textContent =
    isLiveHere() && model === 'downloading'
      ? `声纹模型下载中 ${Math.round((live.speakerModelProgress ?? 0) * 100)}%，完成后自动区分说话人`
      : model === 'error' || model === 'missing'
        ? '声纹模型未就绪，暂时无法区分说话人（可在 设置 → 声纹 下载）'
        : d.speakerList.length
          ? '按参会人数和声音区分 · 点名字改名'
          : isLiveHere()
            ? '有人说话后自动区分说话人'
            : ''
  bar.appendChild(hint)
}

/** 说话人标签（点击改名或合并） */
function speakerChip(speakerId: number | null): HTMLButtonElement {
  const color = speakerColor(speakerLabel(speakerId))
  const chip = document.createElement('button')
  chip.className = 'speaker-chip'
  chip.style.color = color
  chip.style.background = `${color}1f`
  chip.innerHTML = '<i></i>'
  chip.appendChild(document.createTextNode(speakerName(speakerId)))
  if (speakerId !== null) {
    chip.title = '点击改名'
    chip.addEventListener('click', () => renamePopover(chip, speakerId))
  }
  return chip
}

/** 改名小窗：名字 + 记住这个声音（默认勾选，D-018）+ 合并到其他人 */
function renamePopover(anchor: HTMLElement, speakerId: number): void {
  const d = detail!
  const sp = d.speakerList.find((s) => s.id === speakerId)
  if (!sp) return
  const form = document.createElement('div')
  form.className = 'rename-form'
  const title = document.createElement('div')
  title.className = 'title'
  title.textContent = `「${sp.displayName}」叫什么名字？`
  const input = document.createElement('input')
  input.type = 'text'
  input.placeholder = `说话人 ${sp.label}`
  input.value = sp.name ?? ''
  const remember = document.createElement('label')
  remember.className = 'check'
  const cb = document.createElement('input')
  cb.type = 'checkbox'
  cb.checked = rememberDefault(sp)
  remember.append(cb, document.createTextNode('记住这个声音（下次会议自动认出）'))
  const actions = document.createElement('div')
  actions.className = 'row-actions'
  const ok = document.createElement('button')
  ok.className = 'btn mini primary'
  ok.textContent = '确定'
  actions.appendChild(ok)
  const submit = async () => {
    hidePopover()
    await saveSpeaker(sp.id, input.value, cb.checked)
  }
  ok.addEventListener('click', () => void submit())
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void submit()
  })
  form.append(title, input, remember, actions)
  const others = d.speakerList.filter((s) => s.id !== sp.id)
  if (others.length) {
    form.appendChild(Object.assign(document.createElement('div'), { className: 'sep' }))
    form.appendChild(Object.assign(document.createElement('div'), { className: 'title', textContent: '其实是同一个人？合并到' }))
    for (const o of others) {
      const b = document.createElement('button')
      const dot = document.createElement('i')
      dot.style.background = speakerColor(o.label)
      b.append(dot, document.createTextNode(o.displayName))
      b.addEventListener('click', () => {
        hidePopover()
        void merge(sp.id, o.id)
      })
      form.appendChild(b)
    }
  }
  showPopoverContent(anchor, form)
  input.focus()
  input.select()
}

/** “记住这个声音”默认勾选；只有用户之前命名时明确取消过（有名字但没有声纹）才默认不勾 */
function rememberDefault(sp: { name: string | null; voiceprintId: number | null }): boolean {
  return sp.voiceprintId !== null || !sp.name
}

async function saveSpeaker(speakerId: number, name: string, remember: boolean): Promise<void> {
  const r = await api.meeting.renameSpeaker(detail!.id, speakerId, name, remember)
  if (remember && name.trim() && !r.remembered) toast('已改名；这个人说的话还太少（或声纹模型未就绪），暂时记不住声音')
  else toast(name.trim() ? '已改名' : '已恢复默认名')
}

function renderBars(): void {
  const d = detail!
  const liveBar = $('meeting-live-bar')
  const procBar = $('meeting-processing-bar')
  const here = isLiveHere()
  liveBar.classList.toggle('hidden', !here)
  liveBar.classList.toggle('paused', here && live.state === 'paused')
  if (here) {
    $('meeting-live-time').textContent = fmtClock(liveElapsed())
    $('btn-meeting-pause').textContent = live.state === 'paused' ? '继续' : '暂停'
    $('meeting-live-hint').textContent =
      live.state === 'paused'
        ? '已暂停，不录音'
        : live.speakerModel === 'downloading'
          ? `正在下载声纹模型 ${Math.round((live.speakerModelProgress ?? 0) * 100)}%，下载完成后补做说话人区分`
          : '每句话说完 1～3 秒出现'
  }
  const processingHere = live.state === 'processing' && live.meetingId === d.id
  const interrupted = d.status === 'interrupted'
  procBar.classList.toggle('hidden', !processingHere && !interrupted)
  procBar.querySelector('.spinner')!.classList.toggle('hidden', !processingHere)
  procBar.querySelector('button')?.remove()
  if (processingHere) $('meeting-processing-text').textContent = live.stage ?? '正在整理…'
  else if (interrupted) {
    $('meeting-processing-text').textContent = '这场会议上次意外中断，录音还在本机'
    const btn = document.createElement('button')
    btn.className = 'btn primary'
    btn.textContent = '继续整理'
    btn.style.marginLeft = 'auto'
    btn.addEventListener('click', () => endChoice(btn, (minutes) => void finishMeeting(d.id, minutes), '整理'))
    procBar.appendChild(btn)
  }
}

function speakerName(id: number | null): string {
  if (id === null) return '未区分'
  return detail?.speakerList.find((s) => s.id === id)?.displayName ?? '未区分'
}

function speakerLabel(id: number | null): number | null {
  if (id === null) return null
  return detail?.speakerList.find((s) => s.id === id)?.label ?? null
}

function renderTranscript(): void {
  const box = $('transcript')
  const scroller = content()
  const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
  box.innerHTML = ''
  const d = detail!
  if (!d.segments.length) {
    box.innerHTML = `<div class="empty">${isLiveHere() ? '等待发言…说完一句话后会出现在这里' : '没有转写内容'}</div>`
    return
  }
  // 同一人连续的句子合并成一段
  const turns: Array<{ speakerId: number | null; segs: MeetingSegment[] }> = []
  for (const s of d.segments) {
    const last = turns.at(-1)
    if (last && last.speakerId === s.speakerId) last.segs.push(s)
    else turns.push({ speakerId: s.speakerId, segs: [s] })
  }
  for (const t of turns) {
    const row = document.createElement('div')
    row.className = 'turn'
    const time = document.createElement('span')
    time.className = 't'
    time.textContent = fmtClock(t.segs[0].startMs)
    const body = document.createElement('div')
    body.className = 'body'
    const chip = speakerChip(t.speakerId)
    const line = document.createElement('div')
    line.className = 'line'
    for (const s of t.segs) {
      const span = document.createElement('span')
      span.className = 'seg'
      span.textContent = s.text
      span.title = '点击：改为其他说话人'
      span.addEventListener('click', () => segmentMenu(span, s))
      line.appendChild(span)
      line.appendChild(document.createTextNode(/[\p{Script=Han}，。！？]$/u.test(s.text) ? '' : ' '))
    }
    body.append(chip, line)
    row.append(time, body)
    box.appendChild(row)
  }
  if (isLiveHere() && tab === 'transcript' && nearBottom) scroller.scrollTop = scroller.scrollHeight
}

function segmentMenu(anchor: HTMLElement, seg: MeetingSegment): void {
  const d = detail!
  const items: PopoverItem[] = [{ header: '这句话是谁说的' }]
  for (const s of d.speakerList) {
    if (s.id === seg.speakerId) continue
    items.push({ label: s.displayName, color: speakerColor(s.label), onClick: () => void api.meeting.assignSegment(d.id, seg.id, s.id) })
  }
  items.push('sep', { label: '新的说话人', onClick: () => void api.meeting.assignSegment(d.id, seg.id, 'new') })
  showPopover(anchor, items)
}

async function merge(from: number, into: number): Promise<void> {
  if (!confirm(`把「${speakerName(from)}」的所有发言合并到「${speakerName(into)}」？`)) return
  await api.meeting.mergeSpeakers(detail!.id, from, into)
}

function renderSpeakers(): void {
  const box = $('speaker-list')
  const d = detail!
  // 正在编辑的输入框不打断
  if (box.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT') return
  box.innerHTML = ''
  if (!d.speakerList.length) {
    box.innerHTML = '<div class="empty">还没有区分出说话人</div>'
    return
  }
  for (const sp of d.speakerList) {
    const row = document.createElement('div')
    row.className = 'speaker-row'
    const dot = document.createElement('i')
    dot.className = 'dot'
    dot.style.background = speakerColor(sp.label)
    const input = document.createElement('input')
    input.type = 'text'
    input.placeholder = `说话人 ${sp.label}`
    input.value = sp.name ?? ''
    input.dataset.speakerInput = String(sp.id)
    const remember = document.createElement('label')
    remember.className = 'check'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = rememberDefault(sp)
    remember.append(cb, document.createTextNode('记住这个声音'))
    const count = document.createElement('span')
    count.className = 'count'
    count.textContent = `${sp.segmentCount} 句`
    const save = document.createElement('button')
    save.className = 'btn mini'
    save.textContent = '保存'
    const doSave = async () => {
      input.blur()
      await saveSpeaker(sp.id, input.value, cb.checked)
    }
    save.addEventListener('click', () => void doSave())
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void doSave()
    })
    const mergeSel = document.createElement('select')
    mergeSel.innerHTML = '<option value="">合并到…</option>'
    for (const o of d.speakerList) if (o.id !== sp.id) mergeSel.add(new Option(o.displayName, String(o.id)))
    mergeSel.disabled = d.speakerList.length < 2
    mergeSel.addEventListener('change', () => {
      const into = Number(mergeSel.value)
      mergeSel.value = ''
      if (into) void merge(sp.id, into)
    })
    row.append(dot, input, remember, count, save, mergeSel)
    box.appendChild(row)
  }
}

function renderMinutes(): void {
  const d = detail!
  const view = $('minutes-view')
  const editor = $('minutes-editor') as HTMLTextAreaElement
  const state = $('minutes-state')
  const processingHere = live.state === 'processing' && live.meetingId === d.id
  $('minutes-edit-actions').classList.toggle('hidden', !editing)
  editor.classList.toggle('hidden', !editing)
  view.classList.toggle('hidden', editing)
  ;($('btn-minutes-edit') as HTMLButtonElement).disabled = !d.minutes || editing
  ;($('btn-minutes-copy') as HTMLButtonElement).disabled = !d.minutes
  const regen = $('btn-minutes-regen') as HTMLButtonElement
  regen.textContent = d.minutes ? '重新生成' : '生成纪要'
  regen.disabled = isLiveHere() || processingHere || d.status === 'interrupted' || !d.segments.length
  if (editing) return
  if (d.minutes) {
    view.innerHTML = renderMarkdown(d.minutes)
    state.textContent = ''
  } else {
    view.innerHTML = ''
    state.textContent = processingHere
      ? live.stage ?? '正在生成…'
      : isLiveHere()
        ? '会议结束后自动生成纪要'
        : d.minutesError ?? '这场会议只保存了记录，需要时点「生成纪要」'
  }
}

function selectTab(t: Tab): void {
  tab = t
  tabChosen = true
  renderDetail()
}

for (const b of document.querySelectorAll<HTMLButtonElement>('#meeting-tabs button')) b.addEventListener('click', () => selectTab(b.dataset.tab as Tab))

$('btn-meeting-back').addEventListener('click', () => navigate('#meeting'))
$('meeting-detail-title').addEventListener('change', () => {
  const v = ($('meeting-detail-title') as HTMLInputElement).value.trim()
  if (detail && v) void api.meeting.setTitle(detail.id, v)
})
$('btn-meeting-pause').addEventListener('click', () => void (live.state === 'paused' ? api.meeting.resume() : api.meeting.pause()))
$('btn-meeting-stop').addEventListener('click', () => endChoice($('btn-meeting-stop'), (minutes) => void api.meeting.stop({ minutes })))
$('btn-meeting-export').addEventListener('click', async () => {
  if (detail && (await api.meeting.exportMarkdown(detail.id))) toast('已导出')
})
$('btn-meeting-delete').addEventListener('click', async () => {
  if (!detail || !confirm(`删除会议「${detail.title}」？文字、说话人和临时录音都会删除，不可恢复。`)) return
  if (await api.meeting.remove(detail.id)) navigate('#meeting')
  else toast('会议进行中或整理中，不能删除')
})
$('btn-minutes-edit').addEventListener('click', () => {
  if (!detail?.minutes) return
  editing = true
  ;($('minutes-editor') as HTMLTextAreaElement).value = detail.minutes
  renderMinutes()
  $('minutes-editor').focus()
})
$('btn-minutes-cancel').addEventListener('click', () => {
  editing = false
  renderMinutes()
})
$('btn-minutes-save').addEventListener('click', async () => {
  if (!detail) return
  await api.meeting.saveMinutes(detail.id, ($('minutes-editor') as HTMLTextAreaElement).value)
  editing = false
  toast('纪要已保存')
})
$('btn-minutes-copy').addEventListener('click', async () => {
  if (!detail?.minutes) return
  await navigator.clipboard.writeText(detail.minutes)
  toast('已复制 Markdown')
})
$('btn-minutes-regen').addEventListener('click', async () => {
  if (!detail) return
  if (detail.minutes && !confirm('重新生成会覆盖当前纪要（包括你的编辑），继续？')) return
  tab = 'minutes'
  tabChosen = true
  const r = await api.meeting.regenerate(detail.id)
  if (!r.ok && r.error) toast(r.error, 4000)
})

// —— 实时更新 ——

api.meeting.onChanged((id) => {
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = window.setTimeout(() => {
    if (!$('page-meeting').classList.contains('active')) return
    if (currentId === id) void loadDetail()
    else if (!currentId) void loadList()
  }, 200)
})

export function onMeetingLive(next: MeetingLive): void {
  const prev = live
  live = next
  liveAt = Date.now()
  if (!$('page-meeting').classList.contains('active')) return
  if (currentId && detail) {
    // 会议刚结束：切到纪要页
    if (prev.meetingId === currentId && prev.state !== 'idle' && next.state === 'idle') {
      tab = 'minutes'
      tabChosen = true
      void loadDetail()
      return
    }
    renderDetail()
  } else if (!currentId) renderStartCard()
}

window.setInterval(() => {
  if (live.state === 'recording' && detail && isLiveHere()) $('meeting-live-time').textContent = fmtClock(liveElapsed())
}, 1000)
