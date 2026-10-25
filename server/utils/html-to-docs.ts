/**
 * Converter HTML TinyMCE → Google Docs API `batchUpdate` requests.
 *
 * Phục vụ `server/services/article-export-google.ts` — tạo Google Docs đầy đủ
 * nội dung bài viết (headings, bold/italic, link, ảnh inline, list, table).
 *
 * Tái use pattern walk HTML từ `html-to-markdown.ts` (cùng cách parse thủ công
 * regex vì server không có jsdom), nhưng thay vì ra chuỗi Markdown, ra mảng
 * `Request` cho Documents API `batchUpdate`. Mỗi request mang `location` index
 * tăng dần — Docs API chèn text/ảnh tuần tự theo index.
 *
 * **Đây là bộ chuyển có tổn thất**: `<iframe>`/`<video>`/`<script>`/`<style>`
 * không có tương đương Docs → chèn link text. Table giữ text (không format
 * border qua API). Mục tiêu: Doc đọc được, không phải cloness TinyMCE 100%.
 *
 * Google Docs API reference:
 *  - `InsertTextRequest` — chèn text tại index.
 *  - `UpdateTextStyleRequest` — bold/italic/underline/link trên range.
 *  - `UpdateParagraphStyleRequest` — heading level.
 *  - `CreateParagraphBulletsRequest` — bullet/numbering.
 *  - `InsertInlineImageRequest` — ảnh (cần objectId từ upload).
 *  - `InsertTableRequest` — bảng.
 *
 * Text: mọi đoạn text đi vào Doc đều ĐÃ GIẢI MÃ entity (`decodeHtmlEntities` cho
 * text inline, `htmlFragmentToText` cho ô bảng và khối code). Thân `batchUpdate` là
 * JSON chở text thuần — Docs không bao giờ hiểu markup hay entity — nên `<`/`&` sau
 * giải mã không cần escape gì; để nguyên entity thì Doc hiện đúng chữ `R&amp;D`.
 */
import { decodeHtmlEntities } from './decode-html-entities'
import { headingLevel, htmlFragmentToText } from './html-fragment-text'

/** Một ảnh cần upload lên Drive trước khi chèn vào Doc. */
export interface DocsImageToUpload {
  /** URL gốc từ `<img src>`. */
  src: string
  /** Placeholder insert vào text — sẽ thay bằng ảnh thật sau upload. */
  placeholder: string
  /** alt text. */
  alt: string
}

/** Kết quả converter: requests + danh sách ảnh cần upload. */
export interface DocsConversionResult {
  requests: unknown[]
  images: DocsImageToUpload[]
}

/** Tạo một Google Docs `batchUpdate` request InsertText. */
function insertText(index: number, text: string): unknown {
  return { insertText: { location: { index }, text } }
}

/** Tạo request UpdateTextStyle cho range [startIndex, endIndex). */
function updateTextStyle(index: number, length: number, style: Record<string, unknown>): unknown {
  return {
    updateTextStyle: {
      range: { startIndex: index, endIndex: index + length },
      textStyle: style,
      fields: Object.keys(style).join(','),
    },
  }
}

/** Tạo request UpdateParagraphStyle cho heading. */
function updateParagraphStyle(index: number, length: number, headingType: string): unknown {
  return {
    updateParagraphStyle: {
      range: { startIndex: index, endIndex: index + length },
      paragraphStyle: { headingType },
      fields: 'headingType',
    },
  }
}

/** Tạo request CreateParagraphBullets cho list. */
function createBullets(index: number, length: number, bulletPreset: string): unknown {
  return {
    createParagraphBullets: {
      range: { startIndex: index, endIndex: index + length },
      bulletPreset,
    },
  }
}

/**
 * Inline style ranges — thu thập (offset, length, style) cho từng tag inline
 * trong một đoạn text, để áp UpdateTextStyle sau khi insert.
 *
 * Walk HTML, strip tag nhưng ghi nhớ range text bị wrap bởi strong/em/u/s/a.
 * Trả text thuần + danh sách style ranges (offset tính từ đầu text thuần).
 */
interface InlineRange {
  offset: number
  length: number
  style: Record<string, unknown>
}

function convertInline(
  html: string,
  images: DocsImageToUpload[],
): { text: string; ranges: InlineRange[] } {
  let text = ''
  const ranges: InlineRange[] = []

  let rest = html
  while (rest.length) {
    const openMatch = rest.match(/<([a-zA-Z0-9]+)(\s[^>]*)?(\s*\/?)>/)
    // Giải mã từng đoạn text TRƯỚC khi nối: offset của style range và placeholder
    // ảnh đo trên `text.length`, nên phải đo trên chữ mà Doc thật sự nhận.
    if (!openMatch) {
      text += decodeHtmlEntities(rest)
      break
    }
    const before = rest.slice(0, openMatch.index)
    text += decodeHtmlEntities(before)
    const tag = (openMatch[1] || '').toLowerCase()
    const selfClosing = openMatch[3]?.includes('/')
    const tagEnd = (openMatch.index || 0) + openMatch[0].length
    rest = rest.slice(tagEnd)

    if (selfClosing) {
      if (tag === 'br') text += '\n'
      else if (tag === 'img') {
        const m = openMatch[0]
        const src = m.match(/\ssrc=["']([^"']*)["']/i)?.[1] ?? ''
        const alt = m.match(/\salt=["']([^"']*)["']/i)?.[1] ?? ''
        if (src) {
          const placeholder = `￼${images.length}￼`
          images.push({ src, placeholder, alt })
          text += placeholder
        }
      }
      continue
    }

    // Tag đóng?
    const closeRe = new RegExp(`</${tag}\\s*>`, 'i')
    const closeMatch = rest.search(closeRe)
    if (closeMatch === -1) {
      // Không đóng — treat rest as text.
      continue
    }

    const inner = rest.slice(0, closeMatch)
    const closeLen = rest.slice(closeMatch).match(closeRe)?.[0]?.length ?? 0
    rest = rest.slice(closeMatch + closeLen)

    const startOffset = text.length
    // Đệ quy inline cho inner.
    const child = convertInline(inner, images)
    text += child.text
    ranges.push(...child.ranges.map(r => ({ offset: startOffset + r.offset, length: r.length, style: r.style })))

    // Áp style cho range này.
    let style: Record<string, unknown> | null = null
    switch (tag) {
      case 'strong': case 'b':
        style = { bold: true }
        break
      case 'em': case 'i':
        style = { italic: true }
        break
      case 'u': case 'ins':
        style = { underline: true }
        break
      case 's': case 'del': case 'strike':
        style = { strikethrough: true }
        break
      case 'a': {
        const href = inner.match(/<a\s[^>]*href=["']([^"']*)["']/i)?.[1]
          ?? (openMatch[2] || '').match(/href=["']([^"']*)["']/i)?.[1] ?? ''
        if (href) style = { link: { url: href } }
        break
      }
      case 'span': case 'font': {
        // span có thể chứa style color/font-size — đọc style attr.
        const styleAttr = (openMatch[2] || '').match(/style=["']([^"']*?)["']/i)?.[1] ?? ''
        const color = styleAttr.match(/color:\s*(#[0-9a-fA-F]{3,6}|rgb\([^)]+\))/)?.[1]
        if (color) style = { foregroundColor: { color: { rgbColor: hexToRgb(color) } } }
        break
      }
    }
    if (style) {
      ranges.push({ offset: startOffset, length: child.text.length, style })
    }
  }
  return { text, ranges }
}

/** Chuyển hex/rgb CSS → Google Docs rgbColor fractions. */
function hexToRgb(color: string): { red?: number; green?: number; blue?: number } {
  const hex = color.match(/^#([0-9a-fA-F]{6})$/)
  if (hex?.[1]) {
    const h = hex[1]
    return {
      red: parseInt(h.slice(0, 2), 16) / 255,
      green: parseInt(h.slice(2, 4), 16) / 255,
      blue: parseInt(h.slice(4, 6), 16) / 255,
    }
  }
  const rgb = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (rgb?.[1] && rgb[2] && rgb[3]) {
    return {
      red: Number(rgb[1]) / 255,
      green: Number(rgb[2]) / 255,
      blue: Number(rgb[3]) / 255,
    }
  }
  return {}
}

/**
 * Convert một block HTML (heading/p/list/blockquote/table) → Docs requests.
 * `index` là vị trí chèn hiện tại trong Doc (tăng dần). Trả requests + số
 * index đã tiêu thụ.
 */
function convertBlock(
  html: string,
  index: number,
  images: DocsImageToUpload[],
): { requests: unknown[]; consumed: number } {
  const requests: unknown[] = []
  let idx = index
  let rest = html

  while (rest.length) {
    const openMatch = rest.match(/<([a-zA-Z0-9]+)(\s[^>]*)?(\s*\/?)>/)
    if (!openMatch) {
      // Text thuần còn lại — bỏ qua (nằm ngoài block).
      break
    }
    // before là whitespace giữa blocks — bỏ qua.
    rest = rest.slice((openMatch.index ?? 0) + openMatch[0].length)
    const tag = (openMatch[1] || '').toLowerCase()
    const selfClosing = openMatch[3]?.includes('/')

    if (selfClosing) {
      if (tag === 'br') {
        requests.push(insertText(idx, '\n'))
        idx += 1
      }
      continue
    }

    const closeRe = new RegExp(`</${tag}\\s*>`, 'i')
    const closeMatch = rest.search(closeRe)
    if (closeMatch === -1) continue
    const inner = rest.slice(0, closeMatch)
    const closeLen = rest.slice(closeMatch).match(closeRe)?.[0]?.length ?? 0
    rest = rest.slice(closeMatch + closeLen)

    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const level = headingLevel(tag)
        const { text, ranges } = convertInline(inner, images)
        const textWithNewline = text + '\n'
        requests.push(insertText(idx, textWithNewline))
        for (const r of ranges) {
          requests.push(updateTextStyle(idx + r.offset, r.length, r.style))
        }
        requests.push(updateParagraphStyle(idx, textWithNewline.length, `HEADING_${level}`))
        idx += textWithNewline.length
        break
      }
      case 'p': {
        const { text, ranges } = convertInline(inner, images)
        const textWithNewline = text + '\n'
        requests.push(insertText(idx, textWithNewline))
        for (const r of ranges) {
          requests.push(updateTextStyle(idx + r.offset, r.length, r.style))
        }
        idx += textWithNewline.length
        break
      }
      case 'ul': case 'ol': {
        // Parse <li> items.
        const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi
        let m: RegExpExecArray | null
        const listStart = idx
        while ((m = liRe.exec(inner)) !== null) {
          const li = m[1] || ''
          const { text, ranges } = convertInline(li, images)
          const textWithNewline = text + '\n'
          requests.push(insertText(idx, textWithNewline))
          for (const r of ranges) {
            requests.push(updateTextStyle(idx + r.offset, r.length, r.style))
          }
          idx += textWithNewline.length
        }
        // Áp bullet cho toàn list.
        const listLen = idx - listStart
        if (listLen > 0) {
          requests.push(createBullets(listStart, listLen, tag === 'ol' ? 'NUMBER_DECIMAL_ALPHA' : 'BULLET_DISC_CIRCLE_SQUARE'))
        }
        break
      }
      case 'blockquote': {
        const { text, ranges } = convertInline(inner, images)
        const textWithNewline = text + '\n'
        requests.push(insertText(idx, textWithNewline))
        for (const r of ranges) {
          requests.push(updateTextStyle(idx + r.offset, r.length, r.style))
        }
        // Indent blockquote.
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: idx, endIndex: idx + textWithNewline.length },
            paragraphStyle: { indentStart: { magnitude: 36, unit: 'PT' } },
            fields: 'indentStart',
          },
        })
        idx += textWithNewline.length
        break
      }
      case 'pre': {
        // Khối code: chữ nguyên văn, giữ xuống dòng (mỗi `\n` là một đoạn trong Doc).
        // Trước đây `pre` rơi vào nhánh wrapper, nhánh đó bỏ qua text trần — cả khối
        // code biến mất khỏi Doc.
        const code = htmlFragmentToText(inner)
        if (code) {
          const textWithNewline = code + '\n'
          requests.push(insertText(idx, textWithNewline))
          idx += textWithNewline.length
        }
        break
      }
      case 'table': {
        // Insert table đơn giản: tạo table rồi fill text cells.
        // Đếm rows + cols.
        const rowsMatch = inner.match(/<tr\b[\s\S]*?<\/tr>/gi) || []
        const rowCount = rowsMatch.length
        const firstRowCells = (rowsMatch[0] || '').match(/<t[dh]\b/gi) || []
        const colCount = firstRowCells.length
        if (rowCount > 0 && colCount > 0) {
          requests.push({ insertTable: { rows: rowCount, columns: colCount, location: { index: idx } } })
          // Docs API insert table: mỗi cell có text rỗng ban đầu (1 ký tự).
          // Fill text từng cell — tuần tự theo index tăng.
          let cellIdx = idx + 1
          for (const row of rowsMatch) {
            const cells = row.match(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi) || []
            for (const cell of cells) {
              const cellText = htmlFragmentToText(cell)
              if (cellText) {
                requests.push(insertText(cellIdx, cellText))
                cellIdx += cellText.length
              }
              cellIdx += 1 // newline kết thúc cell
            }
          }
          idx = cellIdx
        }
        break
      }
      case 'iframe': case 'video': case 'embed': {
        // Không embed được — chèn link text.
        const src = (openMatch[2] || '').match(/src=["']([^"']*)["']/i)?.[1]
          ?? inner.match(/src=["']([^"']*)["']/i)?.[1] ?? ''
        const label = tag === 'video' ? 'Video' : 'Media'
        const text = src ? `[${label}: ${src}]\n` : `[${label}]\n`
        requests.push(insertText(idx, text))
        requests.push(updateTextStyle(idx, text.length - 1, { link: { url: src || '' } }))
        idx += text.length
        break
      }
      case 'div': case 'section': case 'article': case 'figure': case 'figcaption':
      default: {
        // Wrapper — đệ quy convertBlock cho inner.
        const child = convertBlock(inner, idx, images)
        requests.push(...child.requests)
        idx = child.consumed
        break
      }
    }
  }
  return { requests, consumed: idx - index }
}

/**
 * Convert một chuỗi HTML đầy đủ → Docs API requests.
 * Bắt đầu tại index 1 (Doc luôn có 1 ký tự newline đầu).
 */
export function htmlToDocs(html: string): DocsConversionResult {
  const images: DocsImageToUpload[] = []
  if (!html) return { requests: [], images }
  // Loại script/style/comments.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  // Doc trống mới tạo có 1 newline ở index 0. Bắt đầu chèn tại index 1.
  const { requests } = convertBlock(cleaned, 1, images)
  return { requests, images }
}
