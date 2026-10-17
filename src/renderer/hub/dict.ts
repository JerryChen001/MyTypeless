import { $, api } from './util'

// 词典页：手动词条与自动学到的词（D-012）

export async function loadDict(): Promise<void> {
  renderDict(await api.dict.list())
}

function renderDict(words: Array<{ word: string; source: string }>): void {
  const list = $('dict-list')
  list.innerHTML = ''
  if (!words.length) {
    list.innerHTML = '<span class="hint">还没有词条</span>'
    return
  }
  for (const { word, source } of words) {
    const el = document.createElement('span')
    el.className = 'dict-item'
    const label = document.createElement('span')
    label.textContent = word
    el.appendChild(label)
    if (source === 'auto') {
      const mark = document.createElement('span')
      mark.className = 'auto'
      mark.textContent = '✦'
      mark.title = '自动学到的'
      el.appendChild(mark)
    }
    const del = document.createElement('button')
    del.textContent = '✕'
    del.title = '删除'
    del.addEventListener('click', async () => renderDict(await api.dict.remove(word)))
    el.appendChild(del)
    list.appendChild(el)
  }
}

$('btn-dict-add').addEventListener('click', async () => {
  const input = $('dict-input') as HTMLInputElement
  const w = input.value.trim()
  if (!w) return
  const next = await api.dict.add(w)
  input.value = ''
  renderDict(next)
})
$('dict-input').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') ($('btn-dict-add') as HTMLButtonElement).click()
})

// 自动学习收录了新词：刷新词典
api.dict.onChanged(() => void loadDict())
