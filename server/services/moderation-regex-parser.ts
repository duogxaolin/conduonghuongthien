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
 * Bảng `SAMPLE_CHARS` chứa ký tự vô hình (khoảng trắng Unicode, BOM, dấu kết hợp, dấu
 * Kelvin): sửa tệp này bằng công cụ giữ nguyên byte, đừng gõ lại các chuỗi đó.
 *
 * Không có trạng thái đổi được: `SAMPLE_CHARS`/`ALL_SAMPLES` dựng một lần lúc nạp và chỉ
 * được đọc (`tests/service-split-boundaries.test.ts`, luật 4 — tệp khác ghi là đỏ).
 */

/**
 * Bảng ký tự mẫu để quyết định hai lớp ký tự có chung ký tự nào không. Phủ: ASCII in
 * được, khoảng trắng và ký tự điều khiển hay gặp, khoảng trắng Unicode, Latin-1, chữ
 * tiếng Việt (dựng sẵn, hai kiểu chữ), dấu kết hợp, và vài đại diện khác (chữ số Ả
 * Rập, chữ Hán, emoji, Kelvin `K`).
 */
export const SAMPLE_CHARS: readonly string[] = (() => {
  const out = new Set<string>()
  for (let c = 0x20; c < 0x7f; c += 1) out.add(String.fromCharCode(c))
  for (const c of '\t\n\r\v\f\u0000         　﻿') out.add(c)
  for (let c = 0xa1; c <= 0xff; c += 1) out.add(String.fromCharCode(c))
  const vi = 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ'
  for (const c of vi) { out.add(c); out.add(c.toUpperCase()) }
  for (const c of '̣̀́̃̉٠中K−–“ß') out.add(c)
  out.add('\u{1F600}')
  return [...out]
})()
export const ALL_SAMPLES: ReadonlySet<string> = new Set(SAMPLE_CHARS)

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
    return { type: 'char', src: lit, lit: lit.toLowerCase() }
  }

  private group(): Node {
    const s = this.src
    this.i += 1
    let look = false
    if (s[this.i] === '?') {
      const named = /^\?<[A-Za-z_$][\w$]*>/.exec(s.slice(this.i))
      if (named) this.i += named[0].length
      else if (s.startsWith('?<=', this.i) || s.startsWith('?<!', this.i)) { look = true; this.i += 3 }
      else if (s.startsWith('?=', this.i) || s.startsWith('?!', this.i)) { look = true; this.i += 2 }
      else {
        // `(?:` và nhóm cờ `(?i:` / `(?-i:` — đều là nhóm không bắt.
        const flags = /^\?[a-z-]*:/.exec(s.slice(this.i))
        this.i += flags ? flags[0].length : 2
      }
    }
    const child = this.alt()
    this.i += 1 // ')'
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
      this.i = s.indexOf('>', this.i) + 1
      return { type: 'backref' }
    }
    if ((next === 'p' || next === 'P' || next === 'u') && s[this.i + 2] === '{') {
      this.i = s.indexOf('}', this.i) + 1
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
    for (const sample of [...ALL_SAMPLES, ...'0123456789abcdefghijklmnopqrstuvwxyz']) if (m.test(sample)) return sample.toLowerCase()
  } catch { /* không biên dịch được riêng lẻ */ }
  return null
}
