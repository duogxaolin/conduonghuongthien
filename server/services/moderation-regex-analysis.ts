/**
 * Phép xét hình dạng nguy hiểm trên cây mẫu — tệp con của nhóm `moderation-regex`
 * (wave3-long-term 4.3, D-SPLIT; dời nguyên văn từ `moderation-regex.ts`, nơi gọi vẫn
 * import barrel đó). Cây do `moderation-regex-parser.ts` dựng.
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
 * (`SAMPLE_CHARS` ở `moderation-regex-parser.ts` — ASCII, khoảng trắng Unicode, chữ
 * Việt, vài ký tự đại diện): hai lớp ký tự được coi là rời nhau nếu không chung ký tự
 * mẫu nào. Ba khe hở cụ thể khác được ghim ở `tests/moderation-regex-seams-behavior.test.ts`
 * (`FINDING moderation-regex-1..3`).
 *
 * Trạng thái cấp module của tệp này (`charsetCache`, các `Finding` hằng) có một chủ: không
 * tệp nào khác ghi vào (`tests/service-split-boundaries.test.ts`, luật 4).
 */
import { MODERATION_REGEX_FLAGS, MODERATION_REGEX_WINDOW } from './moderation-regex-limits'
import { ALL_SAMPLES, Parser, SAMPLE_CHARS, type Node } from './moderation-regex-parser'

// ── Lớp 1: phân tích cấu trúc ─────────────────────────────────────────────

/** Giới hạn số cách khớp của một phần lặp CÓ giới hạn (lựa chọn mỗi vòng ^ số vòng). */
const BOUNDED_CHOICES_LIMIT = 1024
/** Giới hạn số bước lùi ước lượng của một cụm lượng từ nối nhau (≈ 10–40 ms trên V8). */
const SEQUENCE_COST_LIMIT = 1e7
const LITERAL_SET_MAX = 256

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

export function analyzePattern(src: string): Finding | null {
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
