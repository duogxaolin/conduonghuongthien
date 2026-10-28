/**
 * Bộ phân tích cú pháp của lớp 1 — tệp con của nhóm `moderation-regex`
 * (wave3-long-term 4.3, D-SPLIT; dời nguyên văn từ `moderation-regex.ts`, nơi gọi vẫn
 * import barrel đó).
 *
 * Đọc một mẫu (đã được `new RegExp(…, 'iu')` nhận) thành cây: nhóm, nhánh, lượng từ,
 * lớp ký tự, escape, assertion, backreference. Phép xét hình dạng nguy hiểm trên cây
 * ở `moderation-regex-analysis.ts`; bảng ký tự mẫu ở đây vì escape một ký tự
 * (`literalOfEscape`) được giải bằng chính bảng đó.
 *
 * Gặp cú pháp không hiểu thì NÉM lỗi (`analyzePattern` từ chối thận trọng), không bao giờ
 * đoán: nhánh `(?…` lạ từng bị đọc như `(?:` và bỏ qua đúng hai ký tự, nên `(?<é>` — tên
 * nhóm không phải ASCII — thành chữ cố định `é>` ngăn giữa hai `\s*` (wave3 4.3b). Tên nhóm
 * theo đúng luật định danh của JS (`isRegExpGroupName`).
 *
 * Chữ cố định được so theo phép gập chữ của cờ `iu` (`foldCase`), không theo
 * `toLowerCase`: `ſ` gập về `s`, dấu Kelvin về `k`, `ς` về `σ` — `toLowerCase` giữ nguyên
 * cả ba, nên `(s|ſ)+x` từng trông như hai từ khác nhau (wave3 4.3b).
 *
 * Bảng `SAMPLE_CHARS` chứa ký tự vô hình (khoảng trắng Unicode, BOM, dấu kết hợp, dấu
 * Kelvin): sửa tệp này bằng công cụ giữ nguyên byte, đừng gõ lại các chuỗi đó.
 *
 * Bảng mẫu `SAMPLE_CHARS` dựng một lần lúc nạp và được canh ở HAI chỗ, mỗi chỗ một việc:
 *  - lúc chạy, `Object.freeze`: mọi lượt ghi — `.push()`, `[i] = …`, `.length = 0`, `.sort()`,
 *    `Object.assign` — ném `TypeError` (module ESM là strict mode), bất kể đi qua tên nào:
 *    import thẳng, namespace, bí danh, tham số, đối tượng do hàm trả về. Phần tử là chuỗi (bất
 *    biến), nên khoá một tầng là đủ. Chỉ chặn được mã CHẠY tới: mã không bao giờ chạy (nhánh
 *    chết, hàm không ai gọi) thì không ném gì;
 *  - lúc kiểm, guard tĩnh (`tests/service-split-boundaries.test.ts`, luật 4): tệp khác viết một
 *    lượt ghi qua tên đã nhập — thẳng, qua namespace, hay qua bí danh cục bộ/cấp module (`const
 *    a = SAMPLE_CHARS as string[]`, `const t = ns.SAMPLE_CHARS`, `const { SAMPLE_CHARS: s } =
 *    ns`) — là đỏ, kể cả trong mã không bao giờ chạy. Guard không lần qua lời gọi hàm, tham số
 *    hay biến gán sau khai báo (`let a; a = SAMPLE_CHARS`); với bảng này freeze vẫn chặn lúc chạy.
 * Không có bảng thứ hai: tập ký tự mẫu là `new Set(SAMPLE_CHARS)` dựng mới tại chỗ dùng (một Set
 * không đóng băng được — `Object.freeze` không chặn `.add()`). Nội dung bảng được ghim theo mã
 * điểm, đúng thứ tự, ở `tests/moderation-regex-parts.test.ts`.
 */
import { MODERATION_REGEX_FLAGS } from './moderation-regex-limits'

/**
 * Bảng ký tự mẫu để quyết định hai lớp ký tự có chung ký tự nào không. Phủ: ASCII in
 * được, khoảng trắng và ký tự điều khiển hay gặp, khoảng trắng Unicode, Latin-1, chữ
 * tiếng Việt (dựng sẵn, hai kiểu chữ), dấu kết hợp, và vài đại diện khác (chữ số Ả
 * Rập, chữ Hán, emoji, Kelvin `K`). Đóng băng — xem đầu tệp.
 */
export const SAMPLE_CHARS: readonly string[] = Object.freeze((() => {
  const out = new Set<string>()
  for (let c = 0x20; c < 0x7f; c += 1) out.add(String.fromCharCode(c))
  for (const c of '\t\n\r\v\f\u0000         　﻿') out.add(c)
  for (let c = 0xa1; c <= 0xff; c += 1) out.add(String.fromCharCode(c))
  const vi = 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ'
  for (const c of vi) { out.add(c); out.add(c.toUpperCase()) }
  for (const c of '̣̀́̃̉٠中K−–“ß') out.add(c)
  out.add('\u{1F600}')
  return [...out]
})())

// ── Gập chữ của cờ `iu` ─────────────────────────────────────────────────────

const isOneCodePoint = (s: string) => s !== '' && String.fromCodePoint(s.codePointAt(0)!) === s
const codePointEscape = (c: string) => `\\u{${c.codePointAt(0)!.toString(16)}}`

/**
 * Cặp mà cờ `iu` gập về nhau nhưng `toLowerCase`/`toUpperCase` không nối được: Unicode 15.1
 * thêm `ﬅ` (U+FB05) → `ﬆ` (U+FB06) vào CaseFolding.txt (dạng S), còn chữ hoa của cả hai là
 * chuỗi hai ký tự. Vẫn phải được engine xác nhận như mọi ứng viên khác, nên trên engine có
 * Unicode cũ hơn cặp này tự rơi.
 */
const FOLD_WITHOUT_CASE_MAPPING: ReadonlyMap<string, string> = new Map([['ﬅ', 'ﬆ']])

/**
 * Đại diện của lớp ký tự mà cờ `iu` coi là một (simple case folding — `Canonicalize` của
 * ECMAScript ở chế độ `u`): hai ký tự khớp nhau dưới `iu` khi và chỉ khi `foldCase` của
 * chúng bằng nhau. Ứng viên lần lượt là chữ thường của chữ hoa (`ſ`→`S`→`s`, `µ`→`Μ`→`μ`),
 * chữ thường, rồi `FOLD_WITHOUT_CASE_MAPPING`; mỗi ứng viên chỉ được nhận khi chính engine
 * xác nhận nó khớp ký tự gốc dưới `iu`, nên `foldCase` không bao giờ gộp hai ký tự mà engine
 * coi là khác (`ı` không gập về `i`). Đúng và đủ được kiểm vét cạn với engine trên mọi ký tự
 * có lớp gập không tầm thường (`tests/moderation-regex-parts.test.ts`).
 */
export function foldCase(c: string): string {
  const upper = c.toUpperCase()
  const viaUpper = isOneCodePoint(upper) ? upper.toLowerCase() : ''
  if (viaUpper === c) return c
  for (const candidate of [viaUpper, c.toLowerCase(), FOLD_WITHOUT_CASE_MAPPING.get(c) ?? '']) {
    if (candidate === c || !isOneCodePoint(candidate)) continue
    if (new RegExp(`^${codePointEscape(c)}$`, MODERATION_REGEX_FLAGS).test(candidate)) return candidate
  }
  return c
}

// ── Tên nhóm ────────────────────────────────────────────────────────────────

const ID_START = /^[\p{ID_Start}$_]$/u
const ID_PART = /^[\p{ID_Continue}$‌‍]$/u
/** Một đơn vị của tên nhóm: escape `\u{…}`, escape `\uXXXX`, một `\` khác, hay một điểm mã. */
const NAME_UNIT = /\\u\{([0-9A-Fa-f]+)\}|\\u([0-9A-Fa-f]{4})|\\|[^\\]/gu

/**
 * `name` có phải tên nhóm hợp lệ ở chế độ `u` không (`(?<name>…)`, ES `GroupName`): ký tự
 * đầu thuộc ID_Start hoặc `$`/`_`, các ký tự sau thuộc ID_Continue hoặc `$`/ZWNJ/ZWJ; mỗi
 * ký tự có thể viết bằng `\uXXXX` (hai escape thay thế liền nhau là một điểm mã) hay
 * `\u{…}`. Đối chiếu với engine trên mọi điểm mã BMP (`tests/moderation-regex-parts.test.ts`).
 */
export function isRegExpGroupName(name: string): boolean {
  const points: number[] = []
  let escapedLead = false
  for (const [unit, braced, hex] of name.matchAll(NAME_UNIT)) {
    if (braced === undefined && hex === undefined) {
      if (unit === '\\') return false
      points.push(unit.codePointAt(0)!)
      escapedLead = false
      continue
    }
    const value = Number.parseInt(braced ?? hex!, 16)
    if (value > 0x10ffff) return false
    if (hex !== undefined && escapedLead && value >= 0xdc00 && value <= 0xdfff) {
      points.push((points.pop()! - 0xd800) * 0x400 + (value - 0xdc00) + 0x10000)
      escapedLead = false
      continue
    }
    points.push(value)
    escapedLead = hex !== undefined && value >= 0xd800 && value <= 0xdbff
  }
  return points.length > 0 && points.every((point, i) => (i === 0 ? ID_START : ID_PART).test(String.fromCodePoint(point)))
}

/** Lỗi cú pháp mà bộ đọc không hiểu — `analyzePattern` bắt và từ chối thận trọng. */
const unreadable = (what: string, at: number) => new SyntaxError(`${what} ở vị trí ${at}`)

export type Node =
  | { type: 'char'; src: string; lit: string | null }
  | { type: 'assert' }
  | { type: 'look'; child: Node }
  | { type: 'backref' }
  | { type: 'group'; child: Node }
  | { type: 'alt'; branches: Node[] }
  | { type: 'seq'; items: Node[] }
  | { type: 'quant'; child: Node; min: number; max: number }

export class Parser {
  private i = 0
  private readonly src: string
  constructor(src: string) { this.src = src }

  parse(): Node {
    const node = this.alt()
    if (this.i !== this.src.length) throw unreadable('dư ")" hoặc ký tự chưa đọc', this.i)
    return node
  }

  private alt(): Node {
    const branches: Node[] = [this.seq()]
    while (this.src[this.i] === '|') {
      this.i += 1
      branches.push(this.seq())
    }
    return branches.length === 1 ? branches[0]! : { type: 'alt', branches }
  }

  private seq(): Node {
    const items: Node[] = []
    while (this.i < this.src.length && this.src[this.i] !== '|' && this.src[this.i] !== ')') {
      const atom = this.atom()
      items.push(this.quantifier(atom))
    }
    return items.length === 1 ? items[0]! : { type: 'seq', items }
  }

  private quantifier(atom: Node): Node {
    const s = this.src
    let min: number
    let max: number
    const ch = s[this.i]
    if (ch === '*') { min = 0; max = Infinity; this.i += 1 }
    else if (ch === '+') { min = 1; max = Infinity; this.i += 1 }
    else if (ch === '?') { min = 0; max = 1; this.i += 1 }
    else if (ch === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(s.slice(this.i))
      if (!m) return atom
      min = Number(m[1])
      max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3])
      this.i += m[0].length
    } else {
      return atom
    }
    if (s[this.i] === '?') this.i += 1 // lười — cùng tập cách khớp
    return this.quantifier({ type: 'quant', child: atom, min, max })
  }

  private atom(): Node {
    const s = this.src
    const ch = s[this.i]!
    if (ch === '(') return this.group()
    if (ch === '[') {
      const start = this.i
      this.i += 1
      // JS: `[]` là lớp rỗng, `[^]` là mọi ký tự — `]` ngay sau `[`/`[^` đóng lớp.
      if (s[this.i] === '^') this.i += 1
      while (this.i < s.length && s[this.i] !== ']') this.i += s[this.i] === '\\' ? 2 : 1
      this.i += 1
      return { type: 'char', src: s.slice(start, this.i), lit: null }
    }
    if (ch === '^' || ch === '$') { this.i += 1; return { type: 'assert' } }
    if (ch === '.') { this.i += 1; return { type: 'char', src: '.', lit: null } }
    if (ch === '\\') return this.escape()
    const cp = s.codePointAt(this.i)!
    const lit = String.fromCodePoint(cp)
    this.i += lit.length
    return { type: 'char', src: lit, lit: foldCase(lit) }
  }

  private group(): Node {
    const s = this.src
    const start = this.i
    this.i += 1
    let look = false
    if (s[this.i] === '?') {
      if (s.startsWith('?<=', this.i) || s.startsWith('?<!', this.i)) { look = true; this.i += 3 }
      else if (s.startsWith('?=', this.i) || s.startsWith('?!', this.i)) { look = true; this.i += 2 }
      else if (s.startsWith('?<', this.i)) {
        // Nhóm có tên: tên không chứa `>` (escape chỉ là `\u` + chữ số hex), nên `>` đầu tiên đóng nó.
        const end = s.indexOf('>', this.i)
        if (end < 0 || !isRegExpGroupName(s.slice(this.i + 2, end))) throw unreadable('tên nhóm không hợp lệ', start)
        this.i = end + 1
      } else {
        // `(?:` và nhóm cờ `(?i:` / `(?-i:` — đều là nhóm không bắt. Dạng `(?…` khác: không đoán.
        const flags = /^\?[a-z-]*:/.exec(s.slice(this.i))
        if (!flags) throw unreadable('nhóm "(?" không nhận ra', start)
        this.i += flags[0].length
      }
    }
    const child = this.alt()
    if (s[this.i] !== ')') throw unreadable('thiếu ")"', start)
    this.i += 1
    return look ? { type: 'look', child } : { type: 'group', child }
  }

  private escape(): Node {
    const s = this.src
    const next = s[this.i + 1] ?? ''
    const start = this.i
    if (next === 'b' || next === 'B') { this.i += 2; return { type: 'assert' } }
    if (/[1-9]/.test(next)) {
      this.i += 2
      while (/\d/.test(s[this.i] ?? '')) this.i += 1
      return { type: 'backref' }
    }
    if (next === 'k' && s[this.i + 2] === '<') {
      // Thiếu dấu đóng thì `indexOf` là -1 và chỉ số quay về 0 — vòng lặp không dừng.
      const end = s.indexOf('>', this.i)
      if (end < 0) throw unreadable('thiếu ">" của \\k<…>', start)
      this.i = end + 1
      return { type: 'backref' }
    }
    if ((next === 'p' || next === 'P' || next === 'u') && s[this.i + 2] === '{') {
      const end = s.indexOf('}', this.i)
      if (end < 0) throw unreadable('thiếu "}"', start)
      this.i = end + 1
    } else if (next === 'u') {
      this.i += 6
    } else if (next === 'x') {
      this.i += 4
    } else if (next === 'c') {
      this.i += 3
    } else {
      this.i += 2
    }
    const src = s.slice(start, this.i)
    return { type: 'char', src, lit: literalOfEscape(src) }
  }
}

/** Ký tự cố định của một escape, hoặc `null` khi escape là một lớp (`\d`, `\p{L}`…). */
function literalOfEscape(src: string): string | null {
  const c = src[1] ?? ''
  if ('dDwWsSpP'.includes(c)) return null
  try {
    const m = new RegExp(`^${src}$`, 'u')
    for (const sample of [...SAMPLE_CHARS, ...'0123456789abcdefghijklmnopqrstuvwxyz']) if (m.test(sample)) return foldCase(sample)
  } catch { /* không biên dịch được riêng lẻ */ }
  return null
}
