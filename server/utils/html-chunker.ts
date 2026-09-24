/**
 * Split HTML content into chunks at semantic boundaries for translation.
 *
 * Splits at `<h2>`, `<h3>`, `<hr>` tags, or accumulates until ~8k chars at
 * `<p>`/`<div>`/`<li>` edges. Never splits inside an HTML tag.
 *
 * (design.md D2)
 */

const MAX_CHUNK_CHARS = 8000

/** Regex to match top-level HTML block tags. */
const BLOCK_TAG_RE = /<(h2|h3|h4|hr|p|div|ul|ol|table|blockquote|section|article|figure)\b[^>]*>[\s\S]*?<\/\1>|<(hr)\b[^>]*\/?>/gi

export interface HtmlChunk {
  index: number
  html: string
}

/**
 * Parse HTML into chunks at semantic boundaries.
 * Each chunk is valid HTML (no broken tags).
 */
export function chunkHtml(html: string, maxChunkChars: number = MAX_CHUNK_CHARS): HtmlChunk[] {
  if (!html || html.trim().length === 0) return [{ index: 0, html: '' }]

  // If total length is under the limit, return as single chunk
  if (html.length <= maxChunkChars) return [{ index: 0, html }]

  // Find all top-level block boundaries
  // We split the HTML at major structural breaks (h2, h3, hr)
  // and accumulate smaller blocks into chunks under the size limit.
  const majorBreakRe = /<(h2|h3|hr)\b[^>]*>|<\/(section|article|figure)\b[^>]*>/gi

  const segments: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = majorBreakRe.exec(html)) !== null) {
    if (match.index > lastIndex) {
      segments.push(html.slice(lastIndex, match.index))
    }
    // Include the break tag itself with the following segment
    lastIndex = match.index
  }
  if (lastIndex < html.length) {
    segments.push(html.slice(lastIndex))
  }

  if (segments.length <= 1) {
    // No major breaks found — split by smaller blocks (p, div, li)
    return chunkBySmallBlocks(html, maxChunkChars)
  }

  // Accumulate segments into chunks
  const chunks: string[] = []
  let current = ''

  for (const seg of segments) {
    if ((current + seg).length > maxChunkChars && current.length > 0) {
      chunks.push(current)
      current = seg
    } else {
      current += seg
    }
  }
  if (current.length > 0) chunks.push(current)

  return chunks.map((html, index) => ({ index, html }))
}

function chunkBySmallBlocks(html: string, maxChunkChars: number): HtmlChunk[] {
  // Split at <p>, <div>, <li>, <table> boundaries
  const smallBlockRe = /<(p|div|li|table)\b[^>]*>[\s\S]*?<\/\1>/gi
  const segments: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = smallBlockRe.exec(html)) !== null) {
    if (match.index > lastIndex) {
      segments.push(html.slice(lastIndex, match.index))
    }
    segments.push(match[0])
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < html.length) {
    segments.push(html.slice(lastIndex))
  }

  if (segments.length === 0) {
    // Can't parse — return whole thing as one chunk
    return [{ index: 0, html }]
  }

  const chunks: string[] = []
  let current = ''

  for (const seg of segments) {
    if ((current + seg).length > maxChunkChars && current.length > 0) {
      chunks.push(current)
      current = seg
    } else {
      current += seg
    }

    // If a single segment exceeds max, include it anyway (can't split further safely)
    if (seg.length > maxChunkChars && current === seg) {
      chunks.push(current)
      current = ''
    }
  }
  if (current.length > 0) chunks.push(current)

  return chunks.map((html, index) => ({ index, html }))
}
