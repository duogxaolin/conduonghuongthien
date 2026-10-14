/**
 * Lightweight, XSS-safe Markdown renderer for Chatbot messages.
 *
 * Security:
 * 1. All raw HTML characters (&, <, >, ", ') are escaped FIRST before parsing.
 * 2. Only safe tags (p, strong, em, code, pre, ul, ol, li, a, h2-h4, br) are produced.
 * 3. Links only accept https:// or single-slash site paths (never `//host`) with target="_blank" rel="noopener noreferrer".
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

/**
 * The URLs a chat link or image may point at: an absolute `https://` URL, or a
 * path on this site — ONE leading slash. `//evil.example/x` is not a path: the
 * browser resolves it as a protocol-relative URL to another host, and so is
 * `/\evil.example` (a backslash is read as a slash in http(s) URLs). Whitespace
 * is excluded throughout, so a tab or newline (stripped by the URL parser) cannot
 * smuggle a second slash in either.
 */
const SAFE_URL = String.raw`https:\/\/[^\s)"']+|\/(?![\/\\])[^\s)"']*`
const IMAGE_PATTERN = new RegExp(String.raw`!\[([^\]]*)\]\((${SAFE_URL})\)`, 'g')
const LINK_PATTERN = new RegExp(String.raw`\[([^\]]+)\]\((${SAFE_URL})\)`, 'g')

export function renderChatMarkdown(md: string): string {
  return renderChatMarkdownBlocks(md).join('\n')
}

/**
 * Same output as `renderChatMarkdown`, split into its top-level blocks.
 *
 * A streamed answer is re-rendered on every chunk. One `v-html` for the whole
 * answer replaces every node on every chunk, so an article cover image that
 * arrived early was destroyed and rebuilt each time more text came in: it
 * collapsed to zero height until decoded again, and the transcript jumped. When
 * each block is bound separately, Vue rewrites only a block whose HTML actually
 * changed — while text is appended that is only the last one — and the blocks
 * above it, images included, stay the same DOM nodes.
 */
export function renderChatMarkdownBlocks(md: string): string[] {
  if (!md) return []

  // 1. Clean thinking tokens & escape all raw HTML entities first (strict anti-XSS).
  //    U+E000 (private use) is reserved for the code-block placeholders below.
  let text = escapeHtml(cleanAiText(md.replace(/\uE000/g, '')))

  // 2. Code blocks (```lang ... ```) are lifted out onto their own line before
  //    any inline rule runs. Left in place, the line pass below split them at
  //    every newline and the inline rules rewrote `**`/`_` inside the code.
  const codeBlocks: string[] = []
  text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, _lang, code: string) => {
    codeBlocks.push(`<pre class="my-2 rounded-lg bg-[#111c12] p-3 text-xs text-white overflow-x-auto font-mono"><code>${code.trim()}</code></pre>`)
    return `\n\uE000${codeBlocks.length - 1}\uE000\n`
  })

  // 3. Inline code (`code`)
  text = text.replace(/`([^`]+)`/g, '<code class="rounded bg-[#e8efe8] px-1.5 py-0.5 text-xs font-mono text-[#1e4620]">$1</code>')

  // 4. Bold + Italic (***text*** or ___text___)
  text = text.replace(/(\*\*\*|___)(.*?)\1/g, '<strong><em>$2</em></strong>')

  // 5. Bold (**text** or __text__)
  text = text.replace(/(\*\*|__)(.*?)\1/g, '<strong class="font-bold text-inherit">$2</strong>')

  // 6. Italic (*text* or _text_)
  text = text.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')

  // 7a. Media / Images ![alt](url) — https:// or a single-slash site path (SAFE_URL)
  //     Both cards reserve their height up front (`aspect-video` + intrinsic
  //     width/height). Without it the image is 0px tall until it decodes, then
  //     pushes everything below it down by ~200px — that shift is what dropped
  //     the transcript out of "follow the newest text" mid-answer.
  text = text.replace(IMAGE_PATTERN, (_, alt, rawUrl) => {
    const safeUrl = rawUrl.trim()
    const safeAlt = (alt || '').trim()
    const isVideo = safeUrl.includes('/media/') || safeAlt.toLowerCase().includes('video')

    if (isVideo) {
      return `<div class="chat-media-card chat-video-card my-2.5 overflow-hidden rounded-xl border border-[#c8d6c9] bg-[#f0f7f1] shadow-xs max-w-sm"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="relative block group overflow-hidden"><img src="${safeUrl}" alt="${safeAlt || 'Video thumbnail'}" width="640" height="360" class="w-full aspect-video object-cover block bg-[#122815]" loading="lazy" decoding="async" onerror="this.style.display='none'" /><div class="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/40 transition-colors"><span class="w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform"><i class="fa-solid fa-play text-sm ml-0.5" aria-hidden="true"></i></span></div></a><div class="p-2.5 flex items-center justify-between gap-2 bg-white"><span class="text-xs font-bold text-[#122815] truncate">${safeAlt || 'Xem Video'}</span><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-[0.72rem] font-bold text-[#2c6e33] underline hover:text-[#1e4620] shrink-0">Xem ngay &rarr;</a></div></div>`
    }

    return `<div class="chat-media-card chat-image-card my-2.5 overflow-hidden rounded-xl border border-[#e2ece3] bg-white shadow-xs max-w-sm"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="block group overflow-hidden"><img src="${safeUrl}" alt="${safeAlt || 'Hình ảnh'}" width="640" height="360" class="w-full aspect-video object-cover block bg-[#f0f4ef] group-hover:scale-[1.02] transition-transform duration-300" loading="lazy" decoding="async" /></a>${safeAlt ? `<div class="p-2 text-center text-[0.72rem] font-medium text-[#667768] bg-[#fcfdfc] border-t border-[#f0f4f0]">${safeAlt}</div>` : ''}</div>`
  })

  // 7b. Links [text](url) — https:// or a single-slash site path (SAFE_URL)
  text = text.replace(LINK_PATTERN, '<a href="$2" target="_blank" rel="noopener noreferrer" class="font-semibold text-[#1e4620] underline hover:text-[#2c6e33]">$1</a>')

  // 8. Headers (###, ##, #)
  text = text.replace(/^### (.*$)/gim, '<h4 class="m-0 mt-2 mb-1 text-sm font-bold text-inherit">$1</h4>')
  text = text.replace(/^## (.*$)/gim, '<h3 class="m-0 mt-2.5 mb-1 text-base font-extrabold text-inherit">$1</h3>')
  text = text.replace(/^# (.*$)/gim, '<h2 class="m-0 mt-3 mb-1 text-lg font-extrabold text-inherit">$1</h2>')

  // 9. Process line-by-line into blocks: paragraphs, lists, and the lines that
  //    are blocks on their own (headings, media cards, code).
  //    Consecutive non-empty, non-list lines are grouped into a single <p> so
  //    soft line breaks don't each get their own vertical margin — that was the
  //    source of the "khoảng cách rộng" the user reported. Blank lines separate
  //    paragraphs; we don't emit extra spacer divs because the paragraph margin
  //    already gives breathing room.
  const lines = text.split('\n')
  const blocks: string[] = []
  let list: { tag: 'ul' | 'ol', items: string[] } | null = null
  let paraBuffer: string[] = []

  const flushPara = () => {
    if (paraBuffer.length) {
      blocks.push(`<p class="m-0 my-0.5 leading-relaxed break-words [overflow-wrap:anywhere] whitespace-pre-wrap">${paraBuffer.join('\n')}</p>`)
      paraBuffer = []
    }
  }
  const flushList = () => {
    if (!list) return
    const open = list.tag === 'ul'
      ? '<ul class="m-0 my-1 space-y-1 pl-5 list-disc text-inherit">'
      : '<ol class="m-0 my-1 space-y-1 pl-5 list-decimal text-inherit">'
    blocks.push(`${open}\n${list.items.join('\n')}\n</${list.tag}>`)
    list = null
  }
  const addItem = (tag: 'ul' | 'ol', item: string) => {
    flushPara()
    if (list && list.tag !== tag) flushList()
    if (!list) list = { tag, items: [] }
    list.items.push(item)
  }

  for (const line of lines) {
    const ulMatch = line.match(/^(\s*)([-*])\s+(.*)/)
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/)
    const code = line.match(/^\uE000(\d+)\uE000$/)

    if (ulMatch) {
      const isSubItem = ulMatch[1] && ulMatch[1].length >= 2
      const indentClass = isSubItem ? 'pl-2 ' : ''
      addItem('ul', `<li class="${indentClass}leading-relaxed">${ulMatch[3]}</li>`)
    } else if (olMatch) {
      addItem('ol', `<li class="leading-relaxed">${olMatch[3]}</li>`)
    } else {
      flushList()
      if (code) {
        flushPara()
        blocks.push(codeBlocks[Number(code[1])] ?? '')
      } else if (/^<(h[2-4]|div class="chat-media-card)/.test(line)) {
        // A heading or media card is a block element; inside a <p> the browser
        // closes the paragraph early and leaves an empty one behind.
        flushPara()
        blocks.push(line)
      } else if (line.trim()) {
        paraBuffer.push(line)
      } else {
        flushPara()
      }
    }
  }
  flushPara()
  flushList()

  return blocks.filter(Boolean)
}
