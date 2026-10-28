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
 * mẫu nào — kể cả một chữ cố định với chính nó. k lượng từ nối nhau trên một chữ như vậy là
 * đa thức bậc k + 1, không có trần bậc (`日*日*$` bậc ba như `\s*\s*$`, ~1,2 s một cửa sổ
 * 2000 ký tự; `日*日*日*$` 15,6 s/401 ký tự ở lần chạy đầu; `.*日.*日.*日$` > 60 s — Node 26).
 * Không vá trọn được lúc lưu (mọi chữ ngoài bảng, mọi lớp `\p{…}`): lớp 2 ngắt cứng mỗi cửa
 * sổ ở 200 ms (`FINDING moderation-regex-4`, `tests/moderation-regex-seams-behavior.test.ts`).
 * Ba khe hở từng lọt đã sửa (wave3 4.3b, test `regression moderation-regex-1..3`): tên nhóm
 * không phải ASCII bị đọc thành chữ cố định, `{0}` cho độ rộng NaN (lặp 0 lần nay là chuỗi
 * rỗng, so với trần viết dạng đóng khi nghi ngờ), chữ mà `iu` gập về nhau được so bằng
 * `toLowerCase` (nay `foldCase`). Fuzz vi sai với engine: `tests/moderation-regex-fuzz.test.ts`.
 *
 * Trạng thái cấp module của tệp này (`charsetCache`, các `Finding` hằng) có một chủ: không
 * tệp nào khác ghi vào (`tests/service-split-boundaries.test.ts`, luật 4).
 */
import { MODERATION_REGEX_FLAGS, MODERATION_REGEX_WINDOW } from './moderation-regex-limits'
import { Parser, SAMPLE_CHARS, type Node } from './moderation-regex-parser'

// ── Lớp 1: phân tích cấu trúc ─────────────────────────────────────────────

/** Giới hạn số cách khớp của một phần lặp CÓ giới hạn (lựa chọn mỗi vòng ^ số vòng). */
const BOUNDED_CHOICES_LIMIT = 1024
/** Giới hạn số bước lùi ước lượng của một cụm lượng từ nối nhau (≈ 10–40 ms trên V8). */
const SEQUENCE_COST_LIMIT = 1e7
const LITERAL_SET_MAX = 256
/** Trần của số cách khớp ước lượng — vượt mức này mọi phép so đã quyết xong. */
const CHOICES_CAP = 1e12

// ── Phép tính trên cây ──────────────────────────────────────────────────────

/**
 * Bóc nhóm (bắt/không bắt) và nối các chuỗi lồng nhau — nhóm không ảnh hưởng cách lùi.
 * Lặp `{0}`/`{0,0}` thành chuỗi rỗng (độ rộng 0, một cách khớp, từ cố định `''`): engine
 * không bao giờ chạy phần đó, nên nó không khớp gì, không ngăn cách gì và không lùi trong
 * gì (`(?:\s+){0}\s*\s*$` là `\s*\s*$`).
 */
function normalize(node: Node): Node {
  switch (node.type) {
    case 'group': return normalize(node.child)
    case 'look': return { type: 'look', child: normalize(node.child) }
    case 'quant':
      if (node.max === 0) return { type: 'seq', items: [] }
      return { type: 'quant', child: normalize(node.child), min: node.min, max: node.max }
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

/** a·b với 0·∞ = 0 — `Infinity * 0` là NaN, và NaN so sánh nào cũng sai, nên lọt mọi trần. */
const times = (a: number, b: number) => (a === 0 || b === 0 ? 0 : a * b)

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
      return { min: times(w.min, node.min), max: times(w.max, node.max) }
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
      // Σ c^k với k = min…max. Một cách mỗi vòng thì là số vòng — cộng từng k thì
      // `a{0,999999999}` tốn cả tỉ bước ngay lúc lưu; c ≥ 2 thì vòng dưới vượt trần sau ≤ 40 bước.
      if (c === 1) return Math.min(node.max - node.min + 1, CHOICES_CAP)
      let total = 0
      for (let k = node.min; k <= node.max; k += 1) {
        total += c ** k
        if (!(total <= CHOICES_CAP)) return CHOICES_CAP
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
      const once = literalStrings(node.child)
      if (!once) return null
      // Một từ: lặp chuỗi, không dựng mảng `node.min` phần tử — `(?:a{999999999}|b)+` từng làm
      // tiến trình hết bộ nhớ ngay lúc lưu. Từ dài hơn cửa sổ không bao giờ khớp trọn trong
      // một cửa sổ: coi như không phải từ cố định (từ chối thận trọng nếu nó bị lặp).
      if (once.length === 1) return once[0]!.length * node.min > MODERATION_REGEX_WINDOW ? null : [once[0]!.repeat(node.min)]
      // Nhiều từ: mỗi vòng nhân số từ lên ≥ 2, nên sau ≤ 9 vòng đã vượt LITERAL_SET_MAX.
      let out = ['']
      for (let k = 0; k < node.min; k += 1) {
        out = out.flatMap(a => once.map(b => a + b))
        if (out.length > LITERAL_SET_MAX) return null
      }
      return out
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
    out = new Set(SAMPLE_CHARS)
  }
  charsetCache.set(src, out)
  return out
}

/** Mọi ký tự mẫu mà phần này có thể tiêu thụ. */
function alphabet(node: Node): Set<string> {
  switch (node.type) {
    case 'char': return charset(node.src)
    case 'backref': return new Set(SAMPLE_CHARS)
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

// Mọi phép so với trần viết dạng đóng khi nghi ngờ (`!(x <= trần)`, `!(min > 0)`): một số
// NaN bị coi là vượt trần / khớp được rỗng, không lọt như `NaN > trần` (luôn sai).

function checkQuant(node: Extract<Node, { type: 'quant' }>): Finding | null {
  if (node.max <= 1) return null
  const body = node.child
  const bodyWidth = width(body)
  if (node.max === Infinity) {
    if (!(bodyWidth.min > 0) && !(bodyWidth.max <= 0)) return EMPTY_LOOP
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
  if (!(perIteration ** node.max <= BOUNDED_CHOICES_LIMIT)) return BOUNDED_BLOWUP
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
  return clusterCosts(node).some(cost => !(cost <= SEQUENCE_COST_LIMIT)) ? ADJACENT : null
}

/** Chi phí ước lượng của từng cụm lượng từ nối nhau trong một chuỗi (xem `checkSeq`). */
function clusterCosts(node: Extract<Node, { type: 'seq' }>): number[] {
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
  return [...groups.values()].map(members => members.reduce((cost, i) => {
    const w = widths[i]!
    return cost * (w.max === Infinity ? MODERATION_REGEX_WINDOW : Math.max(choices(items[i]!), w.max - w.min + 1))
  }, MODERATION_REGEX_WINDOW))
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
  try {
    return walk(normalize(new Parser(src).parse()))
  } catch {
    // Không phân tích được (cú pháp lạ mà RegExp vẫn nhận, hay phép xét gặp lỗi) → từ chối
    // thận trọng, không để lỗi đi lên endpoint lưu luật hay lượt nạp luật.
    return { reason: 'không phân tích được cấu trúc mẫu', hint: 'Hãy viết mẫu đơn giản hơn.' }
  }
}

/**
 * Mọi số mà phép xét dựa vào — cận độ rộng và số cách khớp của từng nút, chi phí từng cụm
 * nối nhau — trên cả cây đã chuẩn hoá, không dừng ở phát hiện đầu tiên. Chỉ cho test bất
 * biến "không bao giờ NaN" (`tests/moderation-regex-parts.test.ts`, fuzz): NaN so sánh nào
 * cũng sai, nên một ước lượng NaN lọt mọi trần — `(?:\s+){0}\s*\s*$` từng lọt đúng như vậy.
 */
export function analysisNumbers(src: string): number[] {
  const out: number[] = []
  const visit = (node: Node): void => {
    const w = width(node)
    out.push(w.min, w.max, choices(node))
    if (node.type === 'seq') {
      out.push(...clusterCosts(node))
      node.items.forEach(visit)
    } else if (node.type === 'alt') node.branches.forEach(visit)
    else if (node.type === 'quant' || node.type === 'group' || node.type === 'look') visit(node.child)
  }
  visit(normalize(new Parser(src).parse()))
  return out
}

/**
 * Mô tả hình dạng nguy hiểm đầu tiên tìm thấy, hoặc `null`. Xem "Lớp 1" ở đầu tệp
 * cho đúng phạm vi những gì được và KHÔNG được phát hiện.
 */
export function findCatastrophicShape(src: string): string | null {
  return analyzePattern(src)?.reason ?? null
}
