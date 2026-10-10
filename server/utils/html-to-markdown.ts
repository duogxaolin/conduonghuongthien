/**
 * Converter HTML → Markdown thuần, không phụ thuộc ngoài.
 *
 * Phục vụ `server/api/admin/articles/[id]/export.get.ts?format=md` — cán bộ
 * tải bài về dạng Markdown để chỉnh sửa lại trong trình soạn thảo nhẹ, không
 * phải để dựng lại đầy đủ TinyMCE. Nội dung TinyMCE phức tạp (table, embed)
 * được giữ nguyên HTML trong, vì Markdown không có ngữ nghĩa tương đương.
 *
 * Đây là **bộ chuyển có tổn thất**: một số cấu trúc (table, iframe, script,
 * style, class) không có tương đương Markdown và được giữ nguyên HTML. Mục
 * tiêu là ra một file .md đọc được, không phải ra Markdown sạch 100%.
 */

/**
 * Escape ký tự đặc biệt Markdown trong text thuần (không phải HTML).
 * Chỉ escape khi text sẽ ra thành markdown thô — không escape HTML đã giữ nguyên.
 */
function escapeMd(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/^#{1,6}\s/gm, '\\#$&')
    .replace(/^(\s*)[-*+]\s/gm, '$1\\$&')
    .replace(/^(\s*)\d+\.\s/gm, '$1\\$&')
}

/** Lấy text thuần của một node HTML (bỏ tag). */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/g, '')
    .trim()
}

/** Mức tiêu đề từ tag h1-h6. */
function headingLevel(tag: string): number {
  const m = tag.match(/^h([1-6])$/i)
  return m ? Number(m[1]) : 0
}

/**
 * Chuyển một đoạn HTML con sang Markdown.
 * Đệ quy xử lý từng tag theo thứ tự xuất hiện. Đây là walk thủ công chứ không
 * dùng DOM parser — server không có jsdom. Nội dung lồng nhau được xử lý qua
 * regex greedy cho từng tag cụ thể.
 */
function convertBlock(html: string): string {
  let out = ''
  let rest = html
  while (rest.length) {
    // Tag mở kế tiếp
    const openMatch = rest.match(/<([a-zA-Z0-9]+)(\s[^>]*)?(\s*\/?)>/)
    if (!openMatch) {
      // Text thuần đến hết
      out += escapeMd(rest)
      break
    }
    const before = rest.slice(0, openMatch.index)
    out += escapeMd(before)
    const tag = (openMatch[1] ?? '').toLowerCase()
    const selfClosing = openMatch[3]?.includes('/')
    const tagEnd = (openMatch.index ?? 0) + openMatch[0].length
    rest = rest.slice(tagEnd)

    if (selfClosing) {
      // br → newline, img → ![]()
      if (tag === 'br') out += '\n'
      else if (tag === 'img') {
        // tag khớp trước đó (img self-close) → lấy thuộc tính từ openMatch toàn
        const m = openMatch[0]
        const src = m.match(/\ssrc=["']([^"']*)["']/i)?.[1] ?? ''
        const alt = m.match(/\salt=["']([^"']*)["']/i)?.[1] ?? ''
        out += `![${alt}](${src})`
      }
      continue
    }

    // Tìm tag đóng tương ứng (không xử lý lồng cùng tag sâu — greedy tới close đầu)
    const closeRe = new RegExp(`</${tag}\\s*>`, 'i')
    const closeMatch = rest.search(closeRe)
    if (closeMatch === -1) {
      // Tag không đóng — giữ nguyên text còn lại
      out += escapeMd(rest)
      break
    }
    const inner = rest.slice(0, closeMatch)
    const closeLen = rest.slice(closeMatch).match(closeRe)?.[0]?.length ?? 0
    rest = rest.slice(closeMatch + closeLen)

    out += convertTag(tag, inner)
  }
  return out
}

/** Chuyển nội dung của một tag cụ thể sang Markdown. */
function convertTag(tag: string, inner: string): string {
  const text = stripTags(inner)
  switch (tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const level = headingLevel(tag)
      return `\n${'#'.repeat(level)} ${text}\n`
    }
    case 'p':
      return `\n${convertInline(inner)}\n`
    case 'br':
      return '\n'
    case 'hr':
      return '\n---\n'
    case 'strong': case 'b':
      return `**${convertInline(inner)}**`
    case 'em': case 'i':
      return `*${convertInline(inner)}*`
    case 'u': case 'ins':
      return convertInline(inner)
    case 's': case 'del': case 'strike':
      return `~~${convertInline(inner)}~~`
    case 'a': {
      const href = inner.match(/<a\s[^>]*href=["']([^"']*)["']/i)?.[1] ?? ''
      return `[${convertInline(inner)}](${href})`
    }
    case 'img': {
      const src = inner.match(/src=["']([^"']*)["']/i)?.[1] ?? ''
      const alt = inner.match(/alt=["']([^"']*)["']/i)?.[1] ?? ''
      return `![${alt}](${src})`
    }
    case 'ul':
      return convertList(inner, false)
    case 'ol':
      return convertList(inner, true)
    case 'li':
      return convertInline(inner)
    case 'blockquote':
      return `\n${convertBlock(inner).trim().split('\n').map(l => `> ${l}`).join('\n')}\n`
    case 'pre': {
      const code = stripTags(inner)
      return `\n\`\`\`\n${code}\n\`\`\`\n`
    }
    case 'code':
      return `\`${stripTags(inner)}\``
    case 'table': case 'thead': case 'tbody': case 'tr': case 'td': case 'th':
      // Table giữ nguyên HTML — Markdown không có ngữ nghĩa tương đương.
      return `\n${inner}\n`
    case 'iframe': case 'script': case 'style': case 'div': case 'span': case 'figure': case 'figcaption':
    default:
      // Wrapper/inknown → giữ nội dung bên trong, không giấu HTML phức tạp.
      return convertBlock(inner)
  }
}

/** Chuyển nội dung inline (không block) — p/strong/em/a/img. */
function convertInline(html: string): string {
  return convertBlock(html).replace(/\n{2,}/g, ' ').trim()
}

/** Chuyển danh sách <ul>/<ol> — đệ quy cho lồng nhau. */
function convertList(html: string, ordered: boolean, depth = 0): string {
  const items: string[] = []
  const itemRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi
  let m: RegExpExecArray | null
  let idx = 1
  while ((m = itemRe.exec(html)) !== null) {
    const marker = ordered ? `${idx}. ` : '- '
    const content = m[1] ?? ''
    // Phát hiện danh sách con.
    const subUl = content.match(/<ul\b[\s\S]*?<\/ul>/i)
    const subOl = content.match(/<ol\b[\s\S]*?<\/ol>/i)
    const subMatch = subUl ?? subOl
    let body = convertInline(content)
    if (subMatch) {
      const subOrdered = !!subOl
      const subHtml = subMatch[0] ?? ''
      const beforeSub = content.slice(0, content.indexOf(subHtml))
      body = convertInline(beforeSub)
      const subMd = convertList(subHtml, subOrdered, depth + 1)
      items.push(`${'  '.repeat(depth)}${marker}${body}\n${subMd}`)
    } else {
      items.push(`${'  '.repeat(depth)}${marker}${body}`)
    }
    idx++
  }
  return `\n${items.join('\n')}\n`
}

/**
 * Chuyển một chuỗi HTML đầy đủ sang Markdown.
 * Tiêu đề bài viết (title) được đặt ở ngoài — hàm này chỉ chuyển `content`.
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return ''
  // Loại script/style hoàn toàn trước khi walk.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  const body = convertBlock(cleaned)
  // Dọn newline thừa (≤2) + trim khoảng trắng cuối dòng.
  return body
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim() + '\n'
}
