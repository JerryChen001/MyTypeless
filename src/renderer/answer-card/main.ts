import type { AnswerPayload } from '../../shared/api'

const api = window.mytypeless
const questionEl = document.getElementById('question')!
const answerEl = document.getElementById('answer')!
const btnCopy = document.getElementById('btn-copy') as HTMLButtonElement
const btnInsert = document.getElementById('btn-insert') as HTMLButtonElement

let answer = ''

api.session.onAnswer((a: AnswerPayload) => {
  if (a.question) questionEl.textContent = `Q：${a.question}`
  answerEl.classList.toggle('error', !!a.error)
  if (a.error) {
    answer = ''
    answerEl.textContent = a.error
  } else if (a.pending) {
    answer = ''
    answerEl.textContent = '思考中…'
  } else {
    answer = a.answer
    answerEl.textContent = a.answer
  }
  btnCopy.disabled = btnInsert.disabled = !answer
})

btnCopy.addEventListener('click', async () => {
  if (!answer) return
  await navigator.clipboard.writeText(answer)
  btnCopy.textContent = '已复制 ✓'
  setTimeout(() => (btnCopy.textContent = '复制'), 1200)
})

btnInsert.addEventListener('click', async () => {
  if (!answer) return
  // 主进程会先隐藏浮卡、把焦点还给提问时的应用再粘贴
  const ok = await api.system.answerInsert(answer)
  if (!ok) {
    btnInsert.textContent = '插入失败'
    setTimeout(() => (btnInsert.textContent = '插入到光标'), 1500)
  }
})

document.getElementById('btn-close')!.addEventListener('click', () => api.system.closeWindow())
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.system.closeWindow()
})
