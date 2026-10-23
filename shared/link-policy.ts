/**
 * Which URLs a block or navigation link may hold (spec page-builder-links,
 * design D3). ONE policy, used on write, on public read and on render:
 *  - write: `server/utils/page-versions.ts` (`normalizeBlocks`, via
 *    `assertSafeBlockLinks` in `sanitize-html.ts`) and
 *    `server/api/admin/settings/navigation.put.ts` — 400 naming the field;
 *  - public read: `server/api/public/pages/[slug].get.ts` blanks unsafe values in
 *    rows stored before the rule; `app/utils/nav-config.ts` drops nav items whose
 *    URL is unsafe;
 *  - render: `LinksBlock.vue` / `HeroBlock.vue` bind `href` through
 *    `safeLinkOrNull`.
 *
 * Allowed: a site path (`/x` — one slash; `//host` and `/\host` are other sites),
 * a fragment (`#…`), and absolute `http:`, `https:`, `mailto:`, `tel:` URLs.
 * Everything else — `javascript:`, `data:`, `vbscript:`, `file:`, a bare relative
 * path — is refused. An allowlist, so a scheme nobody thought of is refused too.
 *
 * The decision is made on a NORMALISED copy, the value itself is kept as typed:
 *  1. HTML entities decoded (`&#106;avascript:`, `javascript&colon;`), in case a
 *     consumer ever renders the value through HTML;
 *  2. every control character and every whitespace character removed — browsers
 *     drop tab/newline anywhere in a URL and C0/space at its ends, so
 *     `java\tscript:` IS `javascript:` to them;
 *  3. lower-cased (`JaVaScRiPt:`).
 * Stripping more than a browser does can only make a value look LESS like an
 * allowed form, never more, so the normalisation errs on the refusing side.
 *
 * Lives in `shared/` because it runs on both sides with one meaning. Like
 * `settings-credential-rules.ts`, this file imports nothing from `server/` or
 * `app/` — which is why it carries its own small entity decoder instead of
 * `server/utils/decode-html-entities.ts`. `tests/security-block-link-schemes.test.ts`
 * checks that the two agree on every form both know.
 */

/**
 * Named references that matter for hiding a scheme or a slash, plus the five
 * XML ones. Case-sensitive, as in HTML: `&Tab;`/`&NewLine;` are HTML5 names,
 * `&colon;` is lower case. `nbsp` maps to a plain space, as in the server decoder.
 */
const NAMED: Readonly<Record<string, string>> = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ',
  colon: ':', Tab: '\t', NewLine: '\n', sol: '/', bsol: '\\', period: '.', num: '#',
})

/**
 * Numeric references with or without the closing `;` (a browser decodes
 * `&#106avascript:` inside an attribute), and the named ones above with it.
 */
const ENTITY = /&(?:#(\d{1,8});?|#[xX]([0-9a-fA-F]{1,7});?|([A-Za-z][A-Za-z0-9]{1,8});)/g

function fromCodePoint(code: number): string | null {
  // Outside Unicode, NUL and lone surrogates are not characters — keep the text.
  if (!Number.isSafeInteger(code) || code <= 0 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) return null
  return String.fromCodePoint(code)
}

/** One pass of entity decoding, for link inspection only. Unknown names stay as written. */
export function decodeLinkEntities(value: string): string {
  return value.replace(ENTITY, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (dec !== undefined) return fromCodePoint(Number(dec)) ?? whole
    if (hex !== undefined) return fromCodePoint(Number.parseInt(hex, 16)) ?? whole
    return name !== undefined && Object.hasOwn(NAMED, name) ? NAMED[name]! : whole
  })
}

/**
 * C0/C1 controls, DEL, and all whitespace (including Unicode spaces).
 * Zero-width characters are left in place on purpose: a browser does not drop
 * them either, so "java<U+200B>script:" is no scheme at all — and the allowlist
 * refuses it anyway.
 */
// eslint-disable-next-line no-control-regex -- removing control characters is the point
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\s]/g

/** The form the decision is made on. Decoded until stable (bounded), so a double-encoded value cannot hide. */
function normalizeForCheck(value: string): string {
  let current = value
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decodeLinkEntities(current)
    if (next === current) break
    current = next
  }
  return current.replace(INVISIBLE, '').toLowerCase()
}

function isAllowedForm(normalized: string): boolean {
  if (normalized.startsWith('#')) return true
  // `//host` is protocol-relative; browsers read `\` as `/`, so `/\host` is too.
  if (normalized.startsWith('/')) return normalized[1] !== '/' && normalized[1] !== '\\'
  return /^(?:https?|mailto|tel):/.test(normalized)
}

/**
 * The link as typed (trimmed) when it is a non-empty string in an allowed form;
 * `null` otherwise — including for an empty value, which is "no link".
 */
export function safeLinkOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const normalized = normalizeForCheck(trimmed)
  if (!normalized) return null
  return isAllowedForm(normalized) ? trimmed : null
}

export function unsafeLinkMessage(field: string): string {
  return `Liên kết không an toàn ở trường "${field}": chỉ nhận đường dẫn trong trang (/…), neo (#…), http://, https://, mailto: hoặc tel:.`
}

/**
 * A plain domain error: this file cannot import h3. Server call sites turn it
 * into `createError({ statusCode: 400 })` — an uncaught plain Error would be a
 * 500 with its message hidden.
 */
export class UnsafeLinkError extends Error {
  readonly statusCode = 400
  readonly field: string
  constructor(field: string) {
    super(unsafeLinkMessage(field))
    this.name = 'UnsafeLinkError'
    this.field = field
  }
}

/**
 * Accept "no link" (absent, empty, blank) or an allowed link; anything else —
 * an unsafe string or a value that is not a string at all — throws
 * `UnsafeLinkError` naming `field`.
 */
export function assertSafeLink(value: unknown, field: string): void {
  if (value === undefined || value === null) return
  if (typeof value === 'string' && value.trim() === '') return
  if (safeLinkOrNull(value) === null) throw new UnsafeLinkError(field)
}
