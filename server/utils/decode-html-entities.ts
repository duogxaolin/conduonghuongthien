/**
 * Decode HTML named & numeric entities back to Unicode characters.
 *
 * TinyMCE emits Vietnamese diacritics as named entities in `editor.getContent()`
 * (e.g. `ấ` → `&acirc;`, `ề` → `&egrave;`). When that HTML is forwarded to the AI
 * gateway, the model echoes the literal entity strings into `original`/`suggested`
 * and the Vue text interpolation renders `&acirc;` instead of `ấ`. Decoding the
 * entities before they reach the gateway lets the AI see real characters and echo
 * them back identically.
 *
 * Only the named entities TinyMCE produced are covered (diacritics + common
 * punctuation). The fallback preserves unknown entity names verbatim to avoid
 * silently dropping content.
 */
const NAMED_ENTITY_MAP: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  acirc: 'â', aacute: 'á', agrave: 'à', atilde: 'ã', auml: 'ä', aring: 'å',
  ecirc: 'ê', eacute: 'é', egrave: 'è', euml: 'ë',
  icirc: 'î', iacute: 'í', igrave: 'ì', iuml: 'ï',
  ocirc: 'ô', oacute: 'ó', ograve: 'ò', otilde: 'õ', ouml: 'ö',
  ucirc: 'û', uacute: 'ú', ugrave: 'ù', uuml: 'ü',
  yacute: 'ý', yuml: 'ÿ',
  ccedil: 'ç',
  ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»',
  deg: '°', sect: '§', copy: '©', reg: '®', trade: '™',
  bull: '•', middot: '·',
  frac12: '½', frac14: '¼', frac34: '¾',
  sup2: '²', sup3: '³', times: '×', divide: '÷',
}

export function decodeHtmlEntities(value: unknown): string {
  return String(value ?? '')
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number(dec)
      return Number.isSafeInteger(code) && code > 0 ? String.fromCodePoint(code) : ''
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      const code = Number.parseInt(hex, 16)
      return Number.isSafeInteger(code) && code > 0 ? String.fromCodePoint(code) : ''
    })
    .replace(/&([a-zA-Z]+);/g, (_, name: string) => {
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITY_MAP, name)
        ? NAMED_ENTITY_MAP[name]!
        : `&${name};`
    })
}
