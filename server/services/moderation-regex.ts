/**
 * Biên dịch, kiểm và CHẠY mẫu luật kiểm duyệt do cán bộ viết — MỘT chỗ cho cả ba
 * nơi dùng: `fastPreModerate`, `checkAndModerateContent` và hai endpoint tạo/sửa luật.
 *
 * Vì sao có tệp này:
 *
 *  1. Hai nơi khớp luật từng biên dịch KHÁC nhau. `checkAndModerateContent` gọi
 *     `pattern.toLowerCase()` trước `new RegExp(...)`, nên `\S \W \D \B` bị đổi
 *     thành `\s \w \d \b` — nghĩa ngược hẳn (`^\D+$` thành "toàn chữ số"). Không
 *     phân biệt hoa/thường thì đã có cờ `i`; mẫu KHÔNG bao giờ bị hạ chữ.
 *  2. Mẫu regex của cán bộ chạy trên MỌI tin nhắn công khai. Một mẫu lùi vô hạn
 *     (catastrophic backtracking) treo cả tiến trình Node — vòng sự kiện đứng lại
 *     cho mọi người dùng — chỉ với một câu bình luận vài chục ký tự.
 *
 * HAI LỚP PHÒNG VỆ — đọc kỹ phạm vi của từng lớp, đừng đọc thành "đã chặn ReDoS":
 *
 * Lớp 1 — phân tích cấu trúc lúc LƯU (và lúc nạp luật cũ). Mẫu được phân tích cú
 * pháp thành cây (nhóm, nhánh, lượng từ, lớp ký tự, escape); nhóm bọc thừa được bóc
 * trước khi xét, nên `((a|aa))+` không lách được. Từ chối:
 *   - lặp không giới hạn một phần có nhiều cách khớp: lượng từ lồng nhau (`(a+)+`,
 *     `(\w+\s?)+`, `(?:a+){2,}`), nhánh chọn lặp (`(a|ab)*`, `(a|a)*`, `(\s|,)+`);
 *   - lặp không giới hạn một phần khớp được chuỗi rỗng (`(a|)*`, `(a?)*`);
 *   - lặp CÓ giới hạn mà số cách khớp ước lượng (số lựa chọn mỗi vòng ^ số vòng)
 *     vượt `BOUNDED_CHOICES_LIMIT`, hoặc phần lặp chứa lượng từ không giới hạn
 *     (`(.*a){10}`);
 *   - chuỗi có các lượng từ "nối nhau" — cùng khớp được một ký tự, và mọi phần ở
 *     giữa hoặc khớp được rỗng, hoặc cũng khớp được ký tự đó (`\s*\s*$`, `.*.*=`,
 *     `(?:x|y)*(?:x|y)*`, `(\w+)\1+`, `.*a.*b`, `\w+.{0,20}x`, `a?a?…a?`) — khi số bước
 *     lùi ước lượng trên một cửa sổ (vị trí bắt đầu × Π số lựa chọn, phần không giới
 *     hạn tính bằng độ dài cửa sổ) vượt `SEQUENCE_COST_LIMIT`. Một `\s+` hay `.*` đứng
 *     một mình vẫn được; hai cái nối nhau thì không — gợi ý thay bằng `.{0,50}`.
 * Cho phép (đã chứng minh được là không lùi theo cấp số):
 *   - nhánh chọn lặp mà mọi nhánh là TỪ CỐ ĐỊNH và không nhánh nào là phần đầu của
 *     nhánh khác (`(đéo|địt|đụ)+`, `(fb88|w88)+`): mỗi vị trí chỉ một nhánh khớp trọn;
 *   - lặp có giới hạn với ít lựa chọn (`(\d[\s.]?){9,10}`, `(\d{3,4}[\s.-]?){2,3}`).
 * KHÔNG phát hiện (còn lọt — lớp 2 lo): backreference ngoài dạng kề nhau, cấu trúc
 * lồng trong nhánh chọn mà ước lượng trên bỏ qua (ước lượng là CẬN TRÊN thô, không
 * phải chứng minh), và chồng lấn chỉ xảy ra trên ký tự nằm ngoài bảng mẫu thử
 * (`SAMPLE_CHARS` — ASCII, khoảng trắng Unicode, chữ Việt, vài ký tự đại diện): hai
 * lớp ký tự được coi là rời nhau nếu không chung ký tự mẫu nào.
 *
 * Lớp 2 — giới hạn thiệt hại lúc CHẠY (`testModerationRegex`): mỗi lượt khớp chạy
 * trên cửa sổ tối đa `MODERATION_REGEX_WINDOW` ký tự (văn bản dài hơn được quét theo
 * cửa sổ chồng nhau `MODERATION_REGEX_WINDOW_OVERLAP` ký tự, nên không lách được bằng
 * cách đặt nội dung sau ký tự thứ N), và đo thời gian từng cửa sổ. Một luật mà MỘT
 * cửa sổ chạy quá `MODERATION_RULE_WINDOW_BUDGET_MS` bị TẮT
 * `MODERATION_RULE_COOLDOWN_MS` và ghi log `ai_moderation.rule_slow_disabled` một lần.
 * Đo theo cửa sổ chứ không cộng dồn, để một văn bản dài (tin chatbot không có trần độ
 * dài ở tầng ứng dụng) không biến thành công tắc tắt luật cho bất kỳ ai. Tổng thời
 * gian một luật dùng cho một văn bản bị chặn ở `MODERATION_RULE_CALL_BUDGET_MS`: vượt
 * thì phần còn lại của văn bản đó KHÔNG được quét bằng luật ấy (log
 * `ai_moderation.rule_scan_truncated`, tối đa một lần mỗi luật mỗi khoảng chờ) — phần
 * đó lọt luật regex; trần độ dài ở endpoint chatbot là cách sửa tận gốc. Giới hạn
 * của lớp này: regex JS chạy ĐỒNG BỘ, không ngắt được — cửa sổ chậm đầu tiên vẫn chặn
 * vòng sự kiện trọn thời gian của nó; cửa sổ giới hạn được mẫu đa thức, KHÔNG giới
 * hạn được mẫu cấp số (32 ký tự là đủ treo). Lớp 2 chỉ bảo đảm mẫu đã lọt không chạy
 * lại liên tục. Hệ quả của cửa sổ: `^`/`$` khớp cả ở đầu/cuối mỗi cửa sổ khi văn bản
 * dài hơn N, và một lần khớp dài hơn phần chồng nhau đúng ở ranh giới cửa sổ có thể
 * bị bỏ sót.
 * Loại bỏ hẳn cần engine không lùi (RE2) hoặc chạy regex ngoài luồng chính có hạn
 * giờ — chưa có trong dự án.
 */
import { logWarn } from '../utils/logger'

/** Trần độ dài mẫu (cả từ khoá lẫn regex). */
export const MODERATION_PATTERN_MAX_LENGTH = 200

/** Cờ dùng khi khớp — kiểm lúc lưu dùng ĐÚNG cờ này (cờ `u` khắt khe hơn không-`u`). */
export const MODERATION_REGEX_FLAGS = 'iu'

/** Mọi `ruleType` khác `keyword` đều được khớp như regex — cùng điều kiện ở mọi nơi. */
export function isRegexRuleType(ruleType: string | null | undefined): boolean {
  return ruleType !== 'keyword'
}

export type ModerationPatternCheck = { ok: true } | { ok: false; reason: string }

/**
 * Kiểm một mẫu trước khi lưu (và trước khi biên dịch lúc chạy). Trả lý do tiếng
 * Việt hiển thị thẳng cho cán bộ.
 */
export function checkModerationPattern(pattern: string, ruleType: string | null | undefined): ModerationPatternCheck {
  const value = String(pattern ?? '').trim()
  if (!value) return { ok: false, reason: 'Mẫu nhận diện không được để trống.' }
  if (value.length > MODERATION_PATTERN_MAX_LENGTH) {
    return { ok: false, reason: `Mẫu nhận diện quá dài (tối đa ${MODERATION_PATTERN_MAX_LENGTH} ký tự).` }
  }
  if (!isRegexRuleType(ruleType)) return { ok: true }

  try {
    new RegExp(value, MODERATION_REGEX_FLAGS)
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `Mẫu regex không hợp lệ: ${detail}` }
  }

  const shape = analyzePattern(value)
  if (shape) return { ok: false, reason: `Mẫu regex có nguy cơ treo máy chủ (${shape.reason}). ${shape.hint}` }
  return { ok: true }
}

// ── Biên dịch có bộ nhớ đệm ────────────────────────────────────────────────
// Khoá theo chuỗi mẫu. Xoá cùng lúc với cache luật (`invalidateModerationRulesCache`),
// nên một mẫu hỏng/nguy hiểm chỉ ghi log MỘT lần cho mỗi lượt nạp luật, không phải
// mỗi tin nhắn.
const compiled = new Map<string, RegExp | null>()
const COMPILED_CACHE_MAX = 1000

/**
 * Biên dịch một mẫu regex của luật, hoặc `null` khi mẫu không hợp lệ / quá dài /
 * có hình dạng nguy hiểm. Luật đã nằm trong CSDL từ trước khi có phép kiểm lúc lưu
 * cũng đi qua đây, nên mẫu nguy hiểm cũ bị BỎ QUA lúc chạy (ở cả hai đường khớp)
 * chứ không chạy trên tin nhắn công khai.
 */
export function compileModerationRegex(pattern: string): RegExp | null {
  const key = String(pattern ?? '')
  if (compiled.has(key)) return compiled.get(key) ?? null

  const check = checkModerationPattern(key, 'pattern')
  let regex: RegExp | null = null
  if (check.ok) {
    regex = new RegExp(key.trim(), MODERATION_REGEX_FLAGS)
  } else {
    logWarn({ event: 'ai_moderation.rule_pattern_skipped', pattern: key.slice(0, MODERATION_PATTERN_MAX_LENGTH), reason: check.reason })
  }
  if (compiled.size >= COMPILED_CACHE_MAX) compiled.clear()
  compiled.set(key, regex)
  return regex
}

export function clearCompiledModerationRegexCache(): void {
  compiled.clear()
}

// ── Lớp 2: chạy có giới hạn ────────────────────────────────────────────────

/** Cửa sổ văn bản mỗi lượt khớp — bằng trần độ dài bình luận (`COMMENT_MAX_LENGTH`). */
export const MODERATION_REGEX_WINDOW = 2000
/** Phần chồng nhau giữa hai cửa sổ liên tiếp khi văn bản dài hơn một cửa sổ. */
export const MODERATION_REGEX_WINDOW_OVERLAP = 400
/**
 * Một cửa sổ chạy lâu hơn mức này thì luật bị TẮT tạm. Đo theo TỪNG cửa sổ, không
 * cộng dồn: cộng dồn thì một tin chatbot dài (hàng trăm cửa sổ) làm cả một luật rẻ
 * vượt ngưỡng — tức là ai cũng tắt được luật bằng một tin dài. Mẫu đã qua lớp 1
 * tốn cỡ 10–40 ms một cửa sổ trên máy phát triển; ngưỡng chừa biên cho VPS yếu.
 */
export const MODERATION_RULE_WINDOW_BUDGET_MS = 200
/**
 * Tổng thời gian một luật được dùng cho MỘT văn bản. Vượt thì dừng quét phần còn lại
 * của văn bản đó (không tắt luật — văn bản dài không phải lỗi của luật), để một văn
 * bản rất dài không chặn vòng sự kiện quá lâu.
 */
export const MODERATION_RULE_CALL_BUDGET_MS = 1000
/** Thời gian một luật chậm bị tắt (và khoảng tối thiểu giữa hai dòng log cùng loại). */
export const MODERATION_RULE_COOLDOWN_MS = 10 * 60_000

interface RegexTiming {
  /** Đồng hồ đo khoảng (ms, đơn điệu). */
  elapsed: () => number
  /** Giờ thực (ms) — cho hạn tắt luật. */
  now: () => number
}
const defaultTiming: RegexTiming = { elapsed: () => performance.now(), now: () => Date.now() }
let timing: RegexTiming = defaultTiming
const disabledUntil = new Map<string, number>()
const truncationLoggedUntil = new Map<string, number>()

/** Chỉ cho test: thay đồng hồ để không phải đo thời gian thật. `null` = khôi phục. */
export function setModerationRegexTimingForTests(next: RegexTiming | null): void {
  timing = next ?? defaultTiming
}

/** Bật lại mọi luật đã bị tắt vì chậm (gọi cùng lúc với xoá cache luật). */
export function resetSlowModerationRules(): void {
  disabledUntil.clear()
  truncationLoggedUntil.clear()
}

/** Luật này có đang bị tắt vì chậm không. */
export function isModerationRuleDisabled(pattern: string): boolean {
  const until = disabledUntil.get(pattern)
  if (until === undefined) return false
  if (until > timing.now()) return true
  disabledUntil.delete(pattern)
  return false
}

/**
 * Khớp `regex` (đã qua `compileModerationRegex`) trên `text` có giới hạn — xem "Lớp
 * 2" ở đầu tệp. Trả `false` khi luật đang bị tắt vì chậm.
 */
export function testModerationRegex(pattern: string, regex: RegExp, text: string): boolean {
  if (isModerationRuleDisabled(pattern)) return false
  const step = MODERATION_REGEX_WINDOW - MODERATION_REGEX_WINDOW_OVERLAP
  const start = timing.elapsed()
  for (let from = 0; ; from += step) {
    const before = timing.elapsed()
    const matched = regex.test(text.slice(from, from + MODERATION_REGEX_WINDOW))
    const after = timing.elapsed()
    if (after - before > MODERATION_RULE_WINDOW_BUDGET_MS) {
      disabledUntil.set(pattern, timing.now() + MODERATION_RULE_COOLDOWN_MS)
      logWarn({
        event: 'ai_moderation.rule_slow_disabled',
        pattern: pattern.slice(0, MODERATION_PATTERN_MAX_LENGTH),
        elapsedMs: Math.round(after - before),
        inputLength: text.length,
        disabledForMs: MODERATION_RULE_COOLDOWN_MS,
      })
      return matched
    }
    if (matched) return true
    if (from + MODERATION_REGEX_WINDOW >= text.length) return false
    if (after - start > MODERATION_RULE_CALL_BUDGET_MS) {
      const now = timing.now()
      if ((truncationLoggedUntil.get(pattern) ?? 0) <= now) {
        truncationLoggedUntil.set(pattern, now + MODERATION_RULE_COOLDOWN_MS)
        logWarn({
          event: 'ai_moderation.rule_scan_truncated',
          pattern: pattern.slice(0, MODERATION_PATTERN_MAX_LENGTH),
          scannedChars: from + MODERATION_REGEX_WINDOW,
          inputLength: text.length,
        })
      }
      return false
    }
  }
}

// ── Lớp 1: phân tích cấu trúc ─────────────────────────────────────────────

/** Giới hạn số cách khớp của một phần lặp CÓ giới hạn (lựa chọn mỗi vòng ^ số vòng). */
const BOUNDED_CHOICES_LIMIT = 1024
/** Giới hạn số bước lùi ước lượng của một cụm lượng từ nối nhau (≈ 10–40 ms trên V8). */
const SEQUENCE_COST_LIMIT = 1e7
const LITERAL_SET_MAX = 256

/**
 * Bảng ký tự mẫu để quyết định hai lớp ký tự có chung ký tự nào không. Phủ: ASCII in
 * được, khoảng trắng và ký tự điều khiển hay gặp, khoảng trắng Unicode, Latin-1, chữ
 * tiếng Việt (dựng sẵn, hai kiểu chữ), dấu kết hợp, và vài đại diện khác (chữ số Ả
 * Rập, chữ Hán, emoji, Kelvin `K`).
 */
const SAMPLE_CHARS: readonly string[] = (() => {
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
const ALL_SAMPLES: ReadonlySet<string> = new Set(SAMPLE_CHARS)

type Node =
  | { type: 'char'; src: string; lit: string | null }
  | { type: 'assert' }
  | { type: 'look'; child: Node }
  | { type: 'backref' }
  | { type: 'group'; child: Node }
  | { type: 'alt'; branches: Node[] }
  | { type: 'seq'; items: Node[] }
  | { type: 'quant'; child: Node; min: number; max: number }

class Parser {
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

// ── Phép tính trên cây ──────────────────────────────────────────────────────

/** Bóc nhóm (bắt/không bắt) và nối các chuỗi lồng nhau — nhóm không ảnh hưởng cách lùi. */
function normalize(node: Node): Node {
  switch (node.type) {
    case 'group': return normalize(node.child)
    case 'look': return { type: 'look', child: normalize(node.child) }
    case 'quant': return { type: 'quant', child: normalize(node.child), min: node.min, max: node.max }
    case 'alt': {
      const branches = node.branches.map(normalize)
      return branches.length === 1 ? branches[0]! : { type: 'alt', branches }
    }
    case 'seq': {
      const items: Node[] = []
      for (const item of node.items.map(normalize)) {
        if (item.type === 'seq') items.push(...item.items)
        else items.push(item)
      }
      return items.length === 1 ? items[0]! : { type: 'seq', items }
    }
    default: return node
  }
}

interface Width { min: number; max: number }

function width(node: Node): Width {
  switch (node.type) {
    case 'char': return { min: 1, max: 1 }
    case 'assert':
    case 'look': return { min: 0, max: 0 }
    case 'backref': return { min: 0, max: Infinity }
    case 'group': return width(node.child)
    case 'alt': {
      const ws = node.branches.map(width)
      return { min: Math.min(...ws.map(w => w.min)), max: Math.max(...ws.map(w => w.max)) }
    }
    case 'seq': return node.items.map(width).reduce((a, w) => ({ min: a.min + w.min, max: a.max + w.max }), { min: 0, max: 0 })
    case 'quant': {
      const w = width(node.child)
      return { min: w.min * node.min, max: w.max === 0 ? 0 : w.max * node.max }
    }
  }
}

const isZeroWidth = (node: Node) => node.type === 'assert' || node.type === 'look'
const isVariable = (w: Width) => w.min !== w.max

/** Số cách một phần có thể khớp cùng một đoạn văn bản (ước lượng trên). */
function choices(node: Node): number {
  switch (node.type) {
    case 'char':
    case 'assert':
    case 'look':
    case 'backref': return 1
    case 'group': return choices(node.child)
    case 'alt': return node.branches.reduce((a, b) => a + choices(b), 0)
    case 'seq': return node.items.reduce((a, b) => a * choices(b), 1)
    case 'quant': {
      if (node.max === Infinity) return width(node.child).max === 0 ? 1 : Infinity
      const c = choices(node.child)
      let total = 0
      for (let k = node.min; k <= node.max; k += 1) {
        total += c ** k
        if (total > 1e12) return 1e12
      }
      return total
    }
  }
}

/** Phần này là một tập hữu hạn từ cố định (đã hạ chữ) — kể cả trùng lặp — hoặc `null`. */
function literalStrings(node: Node): string[] | null {
  switch (node.type) {
    case 'char': return node.lit === null ? null : [node.lit]
    case 'group': return literalStrings(node.child)
    case 'alt': {
      const out: string[] = []
      for (const b of node.branches) {
        const s = literalStrings(b)
        if (!s) return null
        out.push(...s)
        if (out.length > LITERAL_SET_MAX) return null
      }
      return out
    }
    case 'seq': {
      let out = ['']
      for (const item of node.items) {
        const s = literalStrings(item)
        if (!s) return null
        out = out.flatMap(a => s.map(b => a + b))
        if (out.length > LITERAL_SET_MAX) return null
      }
      return out
    }
    case 'quant': {
      if (node.max === Infinity || node.min !== node.max) return null
      return literalStrings({ type: 'seq', items: Array.from({ length: node.min }, () => node.child) })
    }
    default: return null
  }
}

/** Không chuỗi nào (kể cả chuỗi trùng, chuỗi rỗng) là phần đầu của chuỗi khác. */
function isPrefixFree(words: string[]): boolean {
  for (let a = 0; a < words.length; a += 1) {
    if (words[a] === '') return false
    for (let b = 0; b < words.length; b += 1) {
      if (a !== b && words[b]!.startsWith(words[a]!)) return false
    }
  }
  return true
}

const charsetCache = new Map<string, Set<string>>()
function charset(src: string): Set<string> {
  const cached = charsetCache.get(src)
  if (cached) return cached
  let out: Set<string>
  try {
    const re = new RegExp(`^(?:${src})$`, MODERATION_REGEX_FLAGS)
    out = new Set(SAMPLE_CHARS.filter(c => re.test(c)))
  } catch {
    out = new Set(ALL_SAMPLES)
  }
  charsetCache.set(src, out)
  return out
}

/** Mọi ký tự mẫu mà phần này có thể tiêu thụ. */
function alphabet(node: Node): Set<string> {
  switch (node.type) {
    case 'char': return charset(node.src)
    case 'backref': return new Set(ALL_SAMPLES)
    case 'assert':
    case 'look': return new Set()
    case 'group':
    case 'quant': return alphabet(node.child)
    case 'alt': return new Set(node.branches.flatMap(b => [...alphabet(b)]))
    case 'seq': return new Set(node.items.flatMap(b => [...alphabet(b)]))
  }
}

function overlaps(a: Set<string>, b: Set<string>): boolean {
  for (const c of a) if (b.has(c)) return true
  return false
}

const hasUnbounded = (node: Node): boolean => {
  switch (node.type) {
    case 'quant': return node.max === Infinity || hasUnbounded(node.child)
    case 'group':
    case 'look': return hasUnbounded(node.child)
    case 'alt': return node.branches.some(hasUnbounded)
    case 'seq': return node.items.some(hasUnbounded)
    case 'backref': return true
    default: return false
  }
}

interface Finding { reason: string; hint: string }

const NESTED: Finding = {
  reason: 'lượng từ lồng nhau, vd. (a+)+',
  hint: 'Hãy viết lại không lồng lượng từ, vd. \\w+ thay cho (\\w+)+.',
}
const OVERLAPPING_ALTERNATION: Finding = {
  reason: 'nhánh chọn bị lặp có thể khớp cùng một chỗ, vd. (a|ab)* hay (\\s|,)+',
  hint: 'Gộp các nhánh một ký tự vào một lớp ký tự như [\\s,]+, hoặc dùng các nhánh là từ cố định mà không từ nào là phần đầu của từ khác, như (đéo|địt|đụ)+.',
}
const EMPTY_LOOP: Finding = {
  reason: 'phần bị lặp có thể khớp chuỗi rỗng, vd. (a|)* hay (a?)*',
  hint: 'Bỏ nhánh rỗng / lượng từ ? bên trong phần lặp, vd. a* thay cho (a?)*.',
}
const BOUNDED_BLOWUP: Finding = {
  reason: 'phần lặp có giới hạn nhưng quá nhiều cách khớp, vd. (a?b?){20}',
  hint: 'Giảm số lần lặp hoặc bớt phần tuỳ chọn bên trong.',
}
const ADJACENT: Finding = {
  reason: 'các lượng từ nối nhau cùng khớp một loại ký tự, vd. \\s*\\s* hay .*a.*b',
  hint: 'Gộp lượng từ kề nhau thành một (\\s* thay cho \\s*\\s*), và giữa các từ dùng giới hạn cụ thể như .{0,30} thay cho .* / .+.',
}

function checkQuant(node: Extract<Node, { type: 'quant' }>): Finding | null {
  if (node.max <= 1) return null
  const body = node.child
  const bodyWidth = width(body)
  if (node.max === Infinity) {
    if (bodyWidth.min === 0 && bodyWidth.max > 0) return EMPTY_LOOP
    if (choices(body) <= 1) return null
    const words = literalStrings(body)
    if (words && isPrefixFree(words)) return null
    return hasUnbounded(body) ? NESTED : OVERLAPPING_ALTERNATION
  }
  const perIteration = choices(body)
  if (perIteration <= 1) return null
  const words = literalStrings(body)
  if (words && isPrefixFree(words)) return null
  if (perIteration === Infinity) return NESTED
  if (perIteration ** node.max > BOUNDED_CHOICES_LIMIT) return BOUNDED_BLOWUP
  return null
}

/**
 * Ước lượng số bước lùi xấu nhất của một chuỗi trên cửa sổ `MODERATION_REGEX_WINDOW`
 * ký tự. Hai phần độ dài thay đổi "nối nhau" khi chúng cùng khớp được một ký tự và
 * mọi phần ở giữa hoặc khớp được rỗng, hoặc cũng khớp được ký tự chung đó (`.*a.*`:
 * chữ `a` không phân tách hai `.*`, nên chỗ chia giữa chúng không cố định). Mỗi cụm
 * nối nhau tốn ≈ (số vị trí bắt đầu) × Π(số lựa chọn của từng phần), với phần không
 * giới hạn tính bằng độ dài cửa sổ. Cụm vượt `SEQUENCE_COST_LIMIT` bị từ chối:
 * `\s*\s*$` (n³), `.*a.*b` (n³), `\w+.{0,20}x` (21·n²), `a?a?…a?` (2^k·n).
 */
function checkSeq(node: Extract<Node, { type: 'seq' }>): Finding | null {
  const items = node.items.filter(item => !isZeroWidth(item))
  const widths = items.map(width)
  const parent = items.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  const alphabets = new Map<number, Set<string>>()
  const alpha = (i: number) => alphabets.get(i) ?? alphabets.set(i, alphabet(items[i]!)).get(i)!
  for (let a = 0; a < items.length; a += 1) {
    if (!isVariable(widths[a]!)) continue
    for (let b = a + 1; b < items.length; b += 1) {
      if (isVariable(widths[b]!) && overlaps(alpha(a), alpha(b))) parent[find(b)] = find(a)
      // Một phần không khớp được rỗng và không chung ký tự nào với phần `a` thì phân
      // tách hẳn: chỗ kết thúc của `a` bị nó cố định.
      if (widths[b]!.min > 0 && !overlaps(alpha(a), alpha(b))) break
    }
  }
  const groups = new Map<number, number[]>()
  for (let i = 0; i < items.length; i += 1) {
    if (!isVariable(widths[i]!)) continue
    const root = find(i)
    groups.set(root, [...(groups.get(root) ?? []), i])
  }
  for (const members of groups.values()) {
    let cost = MODERATION_REGEX_WINDOW
    for (const i of members) {
      const w = widths[i]!
      cost *= w.max === Infinity ? MODERATION_REGEX_WINDOW : Math.max(choices(items[i]!), w.max - w.min + 1)
      if (cost > SEQUENCE_COST_LIMIT) return ADJACENT
    }
  }
  return null
}

function walk(node: Node): Finding | null {
  switch (node.type) {
    case 'quant': return checkQuant(node) ?? walk(node.child)
    case 'seq': {
      const own = checkSeq(node)
      if (own) return own
      for (const item of node.items) {
        const found = walk(item)
        if (found) return found
      }
      return null
    }
    case 'alt': {
      for (const b of node.branches) {
        const found = walk(b)
        if (found) return found
      }
      return null
    }
    case 'group':
    case 'look': return walk(node.child)
    default: return null
  }
}

function analyzePattern(src: string): Finding | null {
  let tree: Node
  try {
    tree = normalize(new Parser(src).parse())
  } catch {
    // Không phân tích được (cú pháp lạ mà RegExp vẫn nhận) → từ chối thận trọng.
    return { reason: 'không phân tích được cấu trúc mẫu', hint: 'Hãy viết mẫu đơn giản hơn.' }
  }
  return walk(tree)
}

/**
 * Mô tả hình dạng nguy hiểm đầu tiên tìm thấy, hoặc `null`. Xem "Lớp 1" ở đầu tệp
 * cho đúng phạm vi những gì được và KHÔNG được phát hiện.
 */
export function findCatastrophicShape(src: string): string | null {
  return analyzePattern(src)?.reason ?? null
}
