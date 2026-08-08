import type { BlockData } from '../../app/utils/blocks/types'
/**
 * Dependency-free, allowlist HTML sanitizer for admin-authored rich text
 * (article bodies, richtext / content_aside blocks). Rendered on the public site
 * with v-html, so untrusted markup from a low-privilege editor must never carry
 * executable content.
 *
 * Defense strategy (tokenizer, not naive regex):
 *  - Elements whose whole subtree is dangerous (script/style/svg/iframe/…) are
 *    dropped WITH their content.
 *  - Only an allowlist of formatting/structural tags survives; unknown tags are
 *    unwrapped (markup dropped, text kept).
 *  - Every attribute is filtered against a per-tag allowlist; all on* handlers
 *    are removed; href/src schemes are restricted; style is scrubbed.
 *
 * NOTE: this is a strong, pragmatic reduction of stored-XSS risk for admin-only
 * input. For public/untrusted input, pair with a battle-tested library
 * (DOMPurify / sanitize-html) once it can be installed.
 */

// Elements dropped together with everything inside them.
const DROP_TREE = new Set([
  'script', 'style', 'svg', 'math', 'iframe', 'object', 'embed', 'noscript',
  'template', 'textarea', 'title', 'head', 'frame', 'frameset', 'applet', 'xmp',
  'noembed', 'noframes', 'link', 'meta', 'base', 'form', 'button', 'input',
  'select', 'option', 'canvas', 'audio', 'video', 'source', 'track', 'portal',
])

// Void (self-closing) allowed elements.
const VOID_TAGS = new Set(['br', 'hr', 'img', 'col', 'wbr'])

// Allowed formatting / structural tags.
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'span', 'div', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
  'del', 'ins', 'mark', 'small', 'sub', 'sup', 'blockquote', 'q', 'cite', 'abbr',
  'code', 'pre', 'kbd', 'samp', 'var', 'time', 'address',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'section', 'article', 'header', 'footer', 'nav', 'aside', 'main',
])

const GLOBAL_ATTRS = new Set(['class', 'title', 'dir', 'lang', 'id', 'style'])
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel', 'name']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  td: new Set(['colspan', 'rowspan', 'headers', 'scope']),
  th: new Set(['colspan', 'rowspan', 'headers', 'scope', 'abbr']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  ol: new Set(['start', 'type', 'reversed']),
  table: new Set(['summary']),
  time: new Set(['datetime']),
}

const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);/i

/** True when a URL uses a safe scheme (or is relative / an anchor). */
function isSafeUrl(raw: string): boolean {
  // Strip control chars / whitespace that are used to smuggle "java\tscript:".
  const cleaned = raw.replace(/[\u0000-\u0020]+/g, '').toLowerCase()
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(cleaned)
  if (!scheme) return true // relative URL, anchor (#…), query, path
  const proto = scheme[1]
  if (proto === 'http' || proto === 'https' || proto === 'mailto' || proto === 'tel') return true
  if (proto === 'data') return SAFE_DATA_IMAGE.test(cleaned) // images only, never data:image/svg+xml
  return false
}

/** Scrub an inline style value; drop it entirely if it looks dangerous. */
function sanitizeStyle(value: string): string | null {
  const stripped = value.replace(/url\s*\([^)]*\)/gi, '') // remove url(...) refs
  if (/expression|javascript:|vbscript:|behavior|@import|-moz-binding|<|url\s*\(/i.test(stripped)) return null
  const cleaned = stripped.trim()
  return cleaned && cleaned.length <= 500 ? cleaned : null
}

function decodeEntitiesForCheck(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => codePoint(parseInt(d, 10)))
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n')
}
function codePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return ''
  try { return String.fromCodePoint(n) } catch { return '' }
}

/** Parse a raw attribute string into filtered `name="value"` pairs for a tag. */
function filterAttributes(tag: string, attrString: string): string {
  const allowed = TAG_ATTRS[tag]
  const out: string[] = []
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(attrString))) {
    const name = (m[1] ?? '').toLowerCase()
    let value = m[2] || ''
    if (value.startsWith('"') || value.startsWith("'")) value = value.slice(1, -1)
    if (name.startsWith('on')) continue // event handlers
    if (name === 'srcset' || name === 'xlink:href' || name === 'formaction' || name === 'xmlns') continue
    if (!GLOBAL_ATTRS.has(name) && !(allowed && allowed.has(name))) continue
    if (name === 'href' || name === 'src') {
      if (!isSafeUrl(decodeEntitiesForCheck(value))) continue
    }
    if (name === 'style') {
      const safe = sanitizeStyle(value)
      if (!safe) continue
      out.push(`style="${safe.replace(/"/g, '&quot;')}"`)
      continue
    }
    if (name === 'target') { out.push('target="_blank"'); continue }
    // Escape the value for safe re-emission.
    const escaped = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    out.push(value === '' ? name : `${name}="${escaped}"`)
  }
  // Force rel=noopener noreferrer on links that open a new tab.
  if (tag === 'a' && out.some(a => a === 'target="_blank"')) {
    if (!out.some(a => a.startsWith('rel='))) out.push('rel="noopener noreferrer"')
  }
  return out.length ? ' ' + out.join(' ') : ''
}

/**
 * Sanitize an HTML string. Returns markup safe to render with v-html.
 */
export function sanitizeHtml(input: unknown): string {
  if (typeof input !== 'string' || !input) return ''
  let html = input
  // Remove comments/CDATA outright (comment tricks are an XSS vector).
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, '')

  let out = ''
  let i = 0
  const n = html.length
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt === -1) { out += html.slice(i); break }
    out += html.slice(i, lt) // preceding text (already entity-encoded by the editor)

    const gt = html.indexOf('>', lt + 1)
    if (gt === -1) { break } // dangling '<' — drop the rest
    const rawTag = html.slice(lt + 1, gt)
    i = gt + 1

    const closeMatch = /^\/\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(rawTag)
    const openMatch = /^([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)\/?$/.exec(rawTag)

    if (closeMatch) {
      const tag = (closeMatch[1] ?? '').toLowerCase()
      if (ALLOWED_TAGS.has(tag) && !VOID_TAGS.has(tag)) out += `</${tag}>`
      continue
    }
    if (!openMatch) continue
    const tag = (openMatch[1] ?? '').toLowerCase()

    if (DROP_TREE.has(tag)) {
      // Skip the element's entire content up to its matching close tag.
      const close = new RegExp(`</\\s*${tag}\\s*>`, 'i')
      const rest = html.slice(i)
      const cm = close.exec(rest)
      i = cm ? i + cm.index + cm[0].length : n
      continue
    }
    if (!ALLOWED_TAGS.has(tag)) continue // unknown tag → unwrap (drop markup, keep text)

    const attrs = filterAttributes(tag, openMatch[2] || '')
    out += VOID_TAGS.has(tag) ? `<${tag}${attrs}>` : `<${tag}${attrs}>`
  }
  return out
}

// HTML-field names inside block `data` that hold rich text and must be sanitized.
const HTML_BLOCK_FIELDS = ['html', 'bodyHtml', 'content', 'body', 'richtext', 'text_html']

/** Sanitize the known rich-text fields of a block's `data` object (shallow). */
export function sanitizeBlockData(data: unknown): BlockData {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const obj = data as BlockData
  for (const field of HTML_BLOCK_FIELDS) {
    const value = obj[field]
    if (typeof value === 'string') obj[field] = sanitizeHtml(value)
  }
  return obj
}
