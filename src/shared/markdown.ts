/**
 * 极简 Markdown → HTML（会议纪要展示用）。纯函数，先转义再处理语法，不支持原始 HTML。
 * 支持：#～### 标题、无序/有序列表、任务列表（- [ ] / - [x]）、**粗体**、`代码`、段落。
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

export function renderMarkdown(md: string): string {
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  let para: string[] = []
  const closeList = () => {
    if (list) out.push(`</${list}>`)
    list = null
  }
  const closePara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`)
    para = []
  }
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    const task = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/)
    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (!line.trim()) {
      closePara()
      closeList()
    } else if (h) {
      closePara()
      closeList()
      const level = h[1].length
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
    } else if (task || ul || ol) {
      closePara()
      const kind = ol && !ul ? 'ol' : 'ul'
      if (list !== kind) {
        closeList()
        out.push(`<${kind}>`)
        list = kind
      }
      if (task) out.push(`<li class="task${task[1].trim() ? ' done' : ''}">${inline(task[2])}</li>`)
      else out.push(`<li>${inline((ul ?? ol)![1])}</li>`)
    } else {
      closeList()
      para.push(line.trim())
    }
  }
  closePara()
  closeList()
  return out.join('\n')
}
