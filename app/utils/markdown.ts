/**
 * Lightweight, XSS-safe Markdown renderer for Chatbot messages.
 *
 * Security:
 * 1. All raw HTML characters (&, <, >, ", ') are escaped FIRST before parsing.
 * 2. Only safe tags (p, strong, em, code, pre, ul, ol, li, a, h2-h4, br) are produced.
 * 3. Links only accept safe http://, https://, or relative / URLs with target="_blank" rel="noopener noreferrer".
 */

export function cleanAiText(raw: string): string {
  if (!raw) return ''
  return raw
    .replace(/<\|channel>thought[\s\S]*?<channel\|>/gi, '')
    .replace(/<\|channel\|>thought[\s\S]*?<\|channel\|>/gi, '')
    .replace(/<\|thought\|>[\s\S]*?<\|\/thought\|>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\|channel>[\s\S]*?<channel\|>/gi, '')
    .replace(/thought\s*<channel\|>/gi, '')
    .replace(/<\|channel>|channel\|>|<channel\|>|<\|channel\|>/gi, '')
    .replace(/^thought\s*$/gim, '')
    .trim()
}

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

  // 1. Clean thinking tokens & escape all raw HTML entities first (strict anti-XSS)
  let text = escapeHtml(cleanAiText(md))

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

  // 7a. Media / Images ![alt](url) — must be safe https://, http:// or /
  text = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)"']+|\/[^\s)"']*)\)/g, (_, alt, rawUrl) => {
    const safeUrl = rawUrl.trim()
    const safeAlt = (alt || '').trim()
    const isVideo = safeUrl.includes('/media/') || safeAlt.toLowerCase().includes('video')

    if (isVideo) {
      return `<div class="chat-media-card chat-video-card my-2.5 overflow-hidden rounded-xl border border-[#c8d6c9] bg-[#f0f7f1] shadow-xs max-w-sm"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="relative block group overflow-hidden"><img src="${safeUrl}" alt="${safeAlt || 'Video thumbnail'}" class="w-full aspect-video object-cover block bg-[#122815]" loading="lazy" onerror="this.style.display='none'" /><div class="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/40 transition-colors"><span class="w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform"><i class="fa-solid fa-play text-sm ml-0.5" aria-hidden="true"></i></span></div></a><div class="p-2.5 flex items-center justify-between gap-2 bg-white"><span class="text-xs font-bold text-[#122815] truncate">${safeAlt || 'Xem Video'}</span><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-[0.72rem] font-bold text-[#2c6e33] underline hover:text-[#1e4620] shrink-0">Xem ngay &rarr;</a></div></div>`
    }

    return `<div class="chat-media-card chat-image-card my-2.5 overflow-hidden rounded-xl border border-[#e2ece3] bg-white shadow-xs max-w-sm"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="block group overflow-hidden"><img src="${safeUrl}" alt="${safeAlt || 'Hình ảnh'}" class="w-full max-h-56 object-cover block group-hover:scale-[1.02] transition-transform duration-300" loading="lazy" /></a>${safeAlt ? `<div class="p-2 text-center text-[0.72rem] font-medium text-[#667768] bg-[#fcfdfc] border-t border-[#f0f4f0]">${safeAlt}</div>` : ''}</div>`
  })

  // 7b. Links [text](url) — must be safe https://, http:// or /
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
