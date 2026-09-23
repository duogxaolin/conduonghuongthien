/**
 * Lightweight, XSS-safe Markdown renderer for Chatbot messages.
 *
 * Security:
 * 1. All raw HTML characters (&, <, >, ", ') are escaped FIRST before parsing.
 * 2. Only safe tags (p, strong, em, code, pre, ul, ol, li, a, h2-h4, br) are produced.
 * 3. Links only accept safe http://, https://, or relative / URLs with target="_blank" rel="noopener noreferrer".
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderChatMarkdown(md: string): string {
  if (!md) return ''

  // 1. Escape all raw HTML entities first (strict anti-XSS)
  let text = escapeHtml(md)

  // 2. Code blocks (```lang ... ```)
  text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, _lang, code: string) => {
    return `<pre class="my-2 rounded-lg bg-[#111c12] p-3 text-xs text-white overflow-x-auto font-mono"><code>${code.trim()}</code></pre>`
  })

  // 3. Inline code (`code`)
  text = text.replace(/`([^`]+)`/g, '<code class="rounded bg-[#e8efe8] px-1.5 py-0.5 text-xs font-mono text-[#1e4620]">$1</code>')

  // 4. Bold + Italic (***text*** or ___text___)
  text = text.replace(/(\*\*\*|___)(.*?)\1/g, '<strong><em>$2</em></strong>')

  // 5. Bold (**text** or __text__)
  text = text.replace(/(\*\*|__)(.*?)\1/g, '<strong class="font-bold text-inherit">$2</strong>')

  // 6. Italic (*text* or _text_)
  text = text.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')

  // 7. Links [text](url) — must be safe https://, http:// or /
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)"']+|\/[^\s)"']*)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="font-semibold text-[#1e4620] underline hover:text-[#2c6e33]">$1</a>')

  // 8. Headers (###, ##, #)
  text = text.replace(/^### (.*$)/gim, '<h4 class="m-0 mt-2 mb-1 text-sm font-bold text-inherit">$1</h4>')
  text = text.replace(/^## (.*$)/gim, '<h3 class="m-0 mt-2.5 mb-1 text-base font-extrabold text-inherit">$1</h3>')
  text = text.replace(/^# (.*$)/gim, '<h2 class="m-0 mt-3 mb-1 text-lg font-extrabold text-inherit">$1</h2>')

  // 9. Process line-by-line for ordered and unordered lists
  const lines = text.split('\n')
  const out: string[] = []
  let inUl = false
  let inOl = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const ulMatch = line.match(/^(\s*)([-*])\s+(.*)/)
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/)

    if (ulMatch) {
      if (inOl) { out.push('</ol>'); inOl = false }
      if (!inUl) { out.push('<ul class="m-0 my-1 space-y-1 pl-5 list-disc text-inherit">'); inUl = true }
      const isSubItem = ulMatch[1] && ulMatch[1].length >= 2
      const indentClass = isSubItem ? 'pl-2 ' : ''
      out.push(`<li class="${indentClass}leading-relaxed">${ulMatch[3]}</li>`)
    } else if (olMatch) {
      if (inUl) { out.push('</ul>'); inUl = false }
      if (!inOl) { out.push('<ol class="m-0 my-1 space-y-1 pl-5 list-decimal text-inherit">'); inOl = true }
      out.push(`<li class="leading-relaxed">${olMatch[3]}</li>`)
    } else {
      if (inUl) { out.push('</ul>'); inUl = false }
      if (inOl) { out.push('</ol>'); inOl = false }
      if (line.trim()) {
        out.push(`<p class="m-0 my-1 leading-relaxed">${line}</p>`)
      } else {
        out.push('<div class="h-1"></div>')
      }
    }
  }
  if (inUl) out.push('</ul>')
  if (inOl) out.push('</ol>')

  return out.join('\n')
}
