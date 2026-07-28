// ─── Automatic table of contents for admin-authored article bodies ───────────
//
// Derived at render time from the stored HTML rather than from a separate field:
// every article already in the database gets a table of contents without an
// editor touching it, and an author who restructures a body cannot leave a stale
// outline behind.
//
// The anchor ids are added here too, in the same pass that collects the entries,
// so a list item and its heading can never disagree about the target.

/** One entry of the outline. `level` is the heading's own level (2, 3 or 4). */
export interface TocHeading {
  id: string
  text: string
  level: number
}

export interface TocResult {
  /** The body HTML with an `id` on every collected heading. */
  html: string
  headings: TocHeading[]
}

/**
 * h1 is the page title, rendered outside the body, so an h1 inside the content
 * is treated as prose rather than structure. h5/h6 are too fine-grained to
 * navigate by and would make the outline longer than the article.
 */
const HEADING_RE = /<h([2-4])\b([^>]*)>([\s\S]*?)<\/h\1\s*>/gi

/**
 * Below this, an outline is noise: the reader can see the whole article without
 * it, and the card would push the actual content below the fold.
 */
export const TOC_MIN_HEADINGS = 3

const ID_ATTR_RE = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i

/** Reuse an author-supplied id only when it is already a safe fragment name. */
const SAFE_ID_RE = /^[A-Za-z][A-Za-z0-9._:-]*$/

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
}

/** Plain text of a heading: markup dropped, entities resolved, spaces collapsed. */
export function headingText(inner: string): string {
  return inner
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => codePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, ' ')
    .trim()
}

function codePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return ''
  try { return String.fromCodePoint(n) } catch { return '' }
}

/**
 * ASCII fragment id from Vietnamese heading text. Diacritics are stripped rather
 * than percent-encoded so the URL stays readable and shareable — `#chinh-sach`
 * instead of `#ch%C3%ADnh-s%C3%A1ch`.
 */
export function slugifyHeading(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
}

/**
 * Collect the outline of a body and stamp an anchor id on each heading.
 *
 * Attribute values in stored bodies are escaped by sanitizeHtml() on write, so
 * `[^>]*` cannot run past the end of a tag. A pre-sanitizer body with a raw `>`
 * inside an attribute would simply not be recognised as a heading — it stays in
 * the output untouched and is left out of the outline, which degrades to "no
 * entry" rather than to a link that points nowhere.
 */
export function buildToc(content: string | null | undefined): TocResult {
  if (!content) return { html: '', headings: [] }

  const headings: TocHeading[] = []
  const used = new Set<string>()

  const html = content.replace(HEADING_RE, (whole, rawLevel: string, attrs: string, inner: string) => {
    const text = headingText(inner)
    if (!text) return whole // decorative or empty heading: nothing to link to

    const existing = ID_ATTR_RE.exec(attrs)
    const authored = existing ? (existing[1] ?? existing[2] ?? existing[3] ?? '') : ''

    let id: string
    if (authored && SAFE_ID_RE.test(authored) && !used.has(authored)) {
      id = authored
    } else {
      const base = slugifyHeading(text) || 'muc'
      id = base
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    }
    used.add(id)

    headings.push({ id, text, level: Number(rawLevel) })

    // Keep the author's own attributes; only replace the id when we generated one.
    const nextAttrs = existing
      ? attrs.replace(ID_ATTR_RE, `id="${id}"`)
      : `${attrs} id="${id}"`
    return `<h${rawLevel}${nextAttrs}>${inner}</h${rawLevel}>`
  })

  return { html, headings }
}
