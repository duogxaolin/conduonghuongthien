/**
 * Decode HTML named & numeric entities back to Unicode characters — for PLAIN-TEXT
 * fields only (titles, excerpts, prompts). Never run it over HTML that is rendered
 * with `v-html`: decoding `&lt;` there turns text into markup.
 *
 * The old CMS (and TinyMCE's `entity_encoding: named`) stored every Latin-1
 * letter as a named entity — `Ng&agrave;y`, `nh&acirc;n d&acirc;n`, `C&Ocirc;NG` —
 * while leaving the rest of Vietnamese (ạ, ộ, Ủ) as real characters. Excerpts cut
 * from that HTML kept the entities, and Vue's text interpolation then showed
 * `&agrave;` on the public article page (rà soát 2026-10-23). The first version of
 * this file knew ~60 lowercase names; `&Ocirc;` went through untouched.
 *
 * Now: the full HTML 4.01 table (252 names, the set editors emit, generated from
 * Python's `html.entities.name2codepoint`) plus `&apos;` and the HTML5 names of ă/đ/ĩ/ũ,
 * decoded in ONE pass so
 * `&amp;agrave;` becomes the literal text `&agrave;` and is never decoded twice.
 * Unknown names are kept verbatim.
 */
const NAMED_CODEPOINTS: Record<string, number> = {
  quot: 0x22, amp: 0x26, lt: 0x3C, gt: 0x3E, nbsp: 0xA0, iexcl: 0xA1, cent: 0xA2, pound: 0xA3,
  curren: 0xA4, yen: 0xA5, brvbar: 0xA6, sect: 0xA7, uml: 0xA8, copy: 0xA9, ordf: 0xAA,
  laquo: 0xAB, not: 0xAC, shy: 0xAD, reg: 0xAE, macr: 0xAF, deg: 0xB0, plusmn: 0xB1, sup2: 0xB2,
  sup3: 0xB3, acute: 0xB4, micro: 0xB5, para: 0xB6, middot: 0xB7, cedil: 0xB8, sup1: 0xB9,
  ordm: 0xBA, raquo: 0xBB, frac14: 0xBC, frac12: 0xBD, frac34: 0xBE, iquest: 0xBF, Agrave: 0xC0,
  Aacute: 0xC1, Acirc: 0xC2, Atilde: 0xC3, Auml: 0xC4, Aring: 0xC5, AElig: 0xC6, Ccedil: 0xC7,
  Egrave: 0xC8, Eacute: 0xC9, Ecirc: 0xCA, Euml: 0xCB, Igrave: 0xCC, Iacute: 0xCD, Icirc: 0xCE,
  Iuml: 0xCF, ETH: 0xD0, Ntilde: 0xD1, Ograve: 0xD2, Oacute: 0xD3, Ocirc: 0xD4, Otilde: 0xD5,
  Ouml: 0xD6, times: 0xD7, Oslash: 0xD8, Ugrave: 0xD9, Uacute: 0xDA, Ucirc: 0xDB, Uuml: 0xDC,
  Yacute: 0xDD, THORN: 0xDE, szlig: 0xDF, agrave: 0xE0, aacute: 0xE1, acirc: 0xE2, atilde: 0xE3,
  auml: 0xE4, aring: 0xE5, aelig: 0xE6, ccedil: 0xE7, egrave: 0xE8, eacute: 0xE9, ecirc: 0xEA,
  euml: 0xEB, igrave: 0xEC, iacute: 0xED, icirc: 0xEE, iuml: 0xEF, eth: 0xF0, ntilde: 0xF1,
  ograve: 0xF2, oacute: 0xF3, ocirc: 0xF4, otilde: 0xF5, ouml: 0xF6, divide: 0xF7, oslash: 0xF8,
  ugrave: 0xF9, uacute: 0xFA, ucirc: 0xFB, uuml: 0xFC, yacute: 0xFD, thorn: 0xFE, yuml: 0xFF,
  OElig: 0x152, oelig: 0x153, Scaron: 0x160, scaron: 0x161, Yuml: 0x178, fnof: 0x192,
  circ: 0x2C6, tilde: 0x2DC, Alpha: 0x391, Beta: 0x392, Gamma: 0x393, Delta: 0x394,
  Epsilon: 0x395, Zeta: 0x396, Eta: 0x397, Theta: 0x398, Iota: 0x399, Kappa: 0x39A,
  Lambda: 0x39B, Mu: 0x39C, Nu: 0x39D, Xi: 0x39E, Omicron: 0x39F, Pi: 0x3A0, Rho: 0x3A1,
  Sigma: 0x3A3, Tau: 0x3A4, Upsilon: 0x3A5, Phi: 0x3A6, Chi: 0x3A7, Psi: 0x3A8, Omega: 0x3A9,
  alpha: 0x3B1, beta: 0x3B2, gamma: 0x3B3, delta: 0x3B4, epsilon: 0x3B5, zeta: 0x3B6, eta: 0x3B7,
  theta: 0x3B8, iota: 0x3B9, kappa: 0x3BA, lambda: 0x3BB, mu: 0x3BC, nu: 0x3BD, xi: 0x3BE,
  omicron: 0x3BF, pi: 0x3C0, rho: 0x3C1, sigmaf: 0x3C2, sigma: 0x3C3, tau: 0x3C4, upsilon: 0x3C5,
  phi: 0x3C6, chi: 0x3C7, psi: 0x3C8, omega: 0x3C9, thetasym: 0x3D1, upsih: 0x3D2, piv: 0x3D6,
  ensp: 0x2002, emsp: 0x2003, thinsp: 0x2009, zwnj: 0x200C, zwj: 0x200D, lrm: 0x200E,
  rlm: 0x200F, ndash: 0x2013, mdash: 0x2014, lsquo: 0x2018, rsquo: 0x2019, sbquo: 0x201A,
  ldquo: 0x201C, rdquo: 0x201D, bdquo: 0x201E, dagger: 0x2020, Dagger: 0x2021, bull: 0x2022,
  hellip: 0x2026, permil: 0x2030, prime: 0x2032, Prime: 0x2033, lsaquo: 0x2039, rsaquo: 0x203A,
  oline: 0x203E, frasl: 0x2044, euro: 0x20AC, image: 0x2111, weierp: 0x2118, real: 0x211C,
  trade: 0x2122, alefsym: 0x2135, larr: 0x2190, uarr: 0x2191, rarr: 0x2192, darr: 0x2193,
  harr: 0x2194, crarr: 0x21B5, lArr: 0x21D0, uArr: 0x21D1, rArr: 0x21D2, dArr: 0x21D3,
  hArr: 0x21D4, forall: 0x2200, part: 0x2202, exist: 0x2203, empty: 0x2205, nabla: 0x2207,
  isin: 0x2208, notin: 0x2209, ni: 0x220B, prod: 0x220F, sum: 0x2211, minus: 0x2212,
  lowast: 0x2217, radic: 0x221A, prop: 0x221D, infin: 0x221E, ang: 0x2220, and: 0x2227,
  or: 0x2228, cap: 0x2229, cup: 0x222A, int: 0x222B, there4: 0x2234, sim: 0x223C, cong: 0x2245,
  asymp: 0x2248, ne: 0x2260, equiv: 0x2261, le: 0x2264, ge: 0x2265, sub: 0x2282, sup: 0x2283,
  nsub: 0x2284, sube: 0x2286, supe: 0x2287, oplus: 0x2295, otimes: 0x2297, perp: 0x22A5,
  sdot: 0x22C5, lceil: 0x2308, rceil: 0x2309, lfloor: 0x230A, rfloor: 0x230B, lang: 0x2329,
  rang: 0x232A, loz: 0x25CA, spades: 0x2660, clubs: 0x2663, hearts: 0x2665, diams: 0x2666,
  apos: 0x27,
  // HTML5 names for the Vietnamese letters outside Latin-1 that editors also emit —
  // the same set `app/utils/article-excerpt.ts` decodes on the list pages.
  abreve: 0x103, Abreve: 0x102, dstrok: 0x111, Dstrok: 0x110,
  itilde: 0x129, Itilde: 0x128, utilde: 0x169, Utilde: 0x168,
}

/** A non-breaking space in a title or excerpt is a plain space to every reader. */
const PLAIN_TEXT_OVERRIDES: Record<string, string> = { nbsp: ' ' }

const ENTITY = /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,8});/g

function fromCodePoint(code: number): string | null {
  // Outside Unicode, NUL and lone surrogates are not characters — keep the entity text.
  if (!Number.isSafeInteger(code) || code <= 0 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) return null
  return String.fromCodePoint(code)
}

export function decodeHtmlEntities(value: unknown): string {
  return String(value ?? '').replace(ENTITY, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1))
      return fromCodePoint(code) ?? whole
    }
    if (Object.hasOwn(PLAIN_TEXT_OVERRIDES, body)) return PLAIN_TEXT_OVERRIDES[body]!
    return Object.hasOwn(NAMED_CODEPOINTS, body) ? String.fromCodePoint(NAMED_CODEPOINTS[body]!) : whole
  })
}

const ENTITY_NAMES = Object.keys(NAMED_CODEPOINTS)

/** `&name;` with a known name, or `&#…;` — a complete entity. */
const COMPLETE_ENTITY = /^&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,8});/

/**
 * Is `raw` entity-ENCODED text — the only kind an old-CMS cut can leave a half
 * entity in? Yes when it holds at least one complete known entity and every `&`
 * before the final one starts a complete entity (an encoder writes a real `&` as
 * `&amp;`). Plain text such as `Phòng R&D` or `Hỏi đáp Q&A` is not, so its last
 * word is never mistaken for a cut entity (rà soát 2026-10-23, bước verify).
 */
function isEntityEncoded(raw: string): boolean {
  const last = raw.lastIndexOf('&')
  let sawKnown = false
  for (let at = raw.indexOf('&'); at !== -1; at = raw.indexOf('&', at + 1)) {
    const match = COMPLETE_ENTITY.exec(raw.slice(at))
    if (match) {
      const body = match[1]!
      if (body[0] === '#' || Object.hasOwn(NAMED_CODEPOINTS, body)) { sawKnown = true; continue }
    }
    if (at !== last) return false
  }
  return sawKnown
}

/**
 * Repair an entity cut off at the very end of an entity-ENCODED field
 * (`… Ủy ban nh&ac`, `c&oacute; l&atild`, `l&agrave`): the old CMS cut excerpts at a
 * fixed length, mid-entity. A complete name missing only its `;` is decoded; a
 * partial one is dropped; either way the field ends with `…`. Text that is not
 * entity-encoded (see `isEntityEncoded`) is returned unchanged.
 */
export function dropTruncatedEntity(raw: string): string {
  if (!isEntityEncoded(raw)) return raw
  const match = /&(#[xX]?[0-9a-fA-F]*|[A-Za-z][A-Za-z0-9]{0,8})?$/.exec(raw)
  if (!match) return raw
  const tail = match[1] ?? ''
  const head = raw.slice(0, match.index)
  if (Object.hasOwn(PLAIN_TEXT_OVERRIDES, tail)) return `${head}${PLAIN_TEXT_OVERRIDES[tail]!}`.trimEnd() + '…'
  if (Object.hasOwn(NAMED_CODEPOINTS, tail)) return `${head}${String.fromCodePoint(NAMED_CODEPOINTS[tail]!)}…`
  const isPrefix = tail === '' || tail.startsWith('#') || ENTITY_NAMES.some(name => name.startsWith(tail))
  return isPrefix ? `${head.trimEnd()}…` : raw
}

/**
 * A stored plain-text field (title, excerpt) as a reader should see it: a cut
 * entity repaired on the RAW text (where a real `&` is still `&amp;`), then decoded.
 */
export function plainTextField(value: string | null | undefined): string | null {
  if (value == null) return value ?? null
  return decodeHtmlEntities(dropTruncatedEntity(value)).trim()
}

/**
 * Plain text a person (or a model) just submitted: decoded, never "repaired". Only
 * stored old-CMS text can carry a cut entity; a typed `R&D` at the end of a title
 * must survive as typed.
 */
export function decodePlainTextInput(value: string): string {
  return decodeHtmlEntities(value).trim()
}

/**
 * `row` with its `title`/`excerpt` decoded — for public serializers, so rows stored
 * before write-time decoding (imported excerpts) read correctly without a backfill.
 */
export function withPlainTextFields<T extends { title?: string | null; excerpt?: string | null }>(row: T): T {
  const out = { ...row }
  if (typeof row.title === 'string') out.title = plainTextField(row.title) as T['title']
  if (typeof row.excerpt === 'string') out.excerpt = plainTextField(row.excerpt) as T['excerpt']
  return out
}
