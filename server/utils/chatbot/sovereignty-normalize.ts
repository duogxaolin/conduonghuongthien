/**
 * Chuẩn hoá chữ cho bộ khớp chủ quyền biển, đảo (`sovereignty-guard.ts`) — hàm thuần, không trạng thái,
 * không import guard. Tên xuất có tiền tố `sovereignty`: Nitro tự import mọi export của `server/utils/**`
 * (`tests/server-utils-unique-exports.test.ts`), nên `fold`/`latinKey` trần sẽ thành tên toàn cục dễ trùng.
 */

// Phồn thể cần dùng → giản thể; "⻄" (bộ thủ U+2EC4, NFKC không gộp) → "西".
const HAN_FOLD: Record<string, string> = {
  黃: '黄', 長: '长', 東: '东', 羣: '群', 島: '岛', 諸: '诸', 線: '线', 國: '国', 興: '兴', 濟: '济',
  門: '门', 華: '华', 陽: '阳', 雲: '云', 廣: '广', 陝: '陕', 閩: '闽', 嶺: '岭', '⻄': '西',
}
const HAN_FOLD_CHARS = new RegExp(`[${Object.keys(HAN_FOLD).join('')}]`, 'g')

// Chữ Kirin / Hy Lạp nhìn như chữ Latin ("Нoàng" — Н Kirin, "Paraсel" — с Kirin, "Ηoàng" — Η Hy Lạp). Thay theo
// từng từ (`unmask`): từ tiếng Nga thật giữ nguyên cho mẫu tiếng Nga.
const CONFUSABLES: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X', І: 'I', Ј: 'J', Ѕ: 'S',
  а: 'a', е: 'e', к: 'k', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', һ: 'h', ԁ: 'd',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
  α: 'a', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u',
}
const CONFUSABLE_CHARS = new RegExp(`[${Object.keys(CONFUSABLES).join('')}]`, 'gu')
const LATIN_LETTER = /\p{Script=Latin}/u
const LOOKALIKE_SCRIPT = /[\p{Script=Cyrillic}\p{Script=Greek}]/u

// Ký tự không hiện: định dạng (`\p{Cf}` — zero-width, BOM, thẻ Unicode, đảo chiều) và mọi ký tự Unicode coi là "bỏ qua
// được khi hiển thị" (`\p{Default_Ignorable_Code_Point}` — gồm cả những ký tự KHÔNG thuộc `\p{Cf}`: CGJ U+034F, ô trống
// Hangul U+115F/U+1160/U+3164/U+FFA0, Khmer U+17B4–17B5, Mông Cổ U+180B–180F, dấu chọn biến thể U+FE00–FE0F và
// U+E0100–E01EF), cộng ô chữ nổi trống U+2800 (không thuộc nhóm đó nhưng cũng không hiện).
const INVISIBLE = new RegExp('[\\p{Cf}\\p{Default_Ignorable_Code_Point}\\u2800]', 'gu')

/**
 * NFKC (chữ toàn độ → thường), bỏ ký tự không hiện (`INVISIBLE` — NFKC không bỏ), gộp chữ Hán,
 * "Ð"/"Ɖ" (hay lẫn vào chữ Việt thay cho "Đ") → "Đ", chữ Kirin/Hy Lạp giả Latin → chữ Latin (`unmask`).
 * Giữ hoa/thường: "Trường Sa" viết hoa là tên riêng.
 *
 * Bỏ ký tự không hiện làm DÍNH hai từ ("Biển<U+200B>Đông" → "BiểnĐông"): mẫu nhiều từ ở guard nhận nối rỗng (`JOIN`).
 * Bỏ chúng TRƯỚC khi thay chữ giả: "Н<U+200B>oàng" phải thành một từ mới thấy là từ lẫn chữ.
 */
export function sovereigntyFold(value: string): string {
  const folded = value.normalize('NFKC').replace(INVISIBLE, '')
    .replace(HAN_FOLD_CHARS, char => HAN_FOLD[char]!)
    .replace(/[ÐƉ]/g, 'Đ').replace(/[ðɖ]/g, 'đ')
  // Lớp đầu ra gọi hàm này mỗi chunk: chỉ duyệt từng từ khi văn bản có chữ Kirin/Hy Lạp.
  return LOOKALIKE_SCRIPT.test(folded) ? unmask(folded) : folded
}

/**
 * Thay chữ Kirin/Hy Lạp giả Latin, theo TỪNG TỪ: một từ lẫn chữ Latin ("Нoàng", "Ηοàng"), hoặc một từ chỉ gồm chữ
 * giả ("Hoàng Ѕа", "ТАУ ЅА", "ιτυ ΑΒΑ" — kể cả khi cả văn bản không có chữ Latin nào). Từ tiếng Nga/Hy Lạp thật
 * chỉ gồm chữ giả ("Как", "СОК", "ΚΑΙ") thành chữ Latin vô nghĩa, không thành tên nào trong danh sách; mẫu tiếng
 * Nga ("парасел", "спратли", "южно китаиск") có chữ không giả được (п, л, и, ж) nên từ của nó giữ nguyên:
 * "Чьи Парасельские острова?" vẫn khớp.
 */
function unmask(folded: string): string {
  return folded.replace(/[\p{L}\p{M}]+/gu, (word) => {
    if (!LOOKALIKE_SCRIPT.test(word)) return word
    const mixed = LATIN_LETTER.test(word)
    const allLookalike = [...word].every(char => Object.hasOwn(CONFUSABLES, char) || /\p{M}/u.test(char))
    return mixed || allLookalike ? word.replace(CONFUSABLE_CHARS, char => CONFUSABLES[char]!) : word
  })
}

// Số thay chữ ("H0àng", "Spr4tly"): chỉ trong một từ ASCII đã có ít nhất hai chữ cái, và không 5→s
// ("trường 5A" không được thành "trường sa"; "trường S4", "C11" giữ nguyên).
const LEET: Record<string, string> = { 0: 'o', 1: 'i', 3: 'e', 4: 'a' }
// Gõ sai trong tên Latin dài (≥ 7 chữ): THAY đúng một chữ bất kỳ, cùng độ dài ("Parasel", "Spretly", "paracal",
// "Paraxel", "Spratky", "Paraϲel", "5pratly"); hoặc chữ lặp ("Spratlly", "Paraccel"). Không: từ thật nằm trong
// `COMMON_WORDS` ("Paracet" — thuốc, "sprawly"), hai chữ khác ("parasol", "caramel"), thiếu/thừa chữ ("parcel",
// "Paracetamol", "paraselene").
const NEAR_MISS_NAMES = ['paracel', 'paracels', 'spratly', 'spratlys', 'spratley', 'spratleys', 'scarborough']
const COMMON_WORDS = new Set(['paracet', 'sprawly', 'sprattly'])
const undoubled = (word: string) => word.replace(/(.)\1+/gu, '$1')
const UNDOUBLED_NAMES = new Map(NEAR_MISS_NAMES.map(name => [name, undoubled(name)]))
// Chữ lặp nhiều nhất bằng độ dài tên: từ dài hơn gấp đôi tên dài nhất (một "từ" chữ Hán không dấu cách) không thể khớp.
const NEAR_MISS_MAX = 2 * Math.max(...NEAR_MISS_NAMES.map(name => name.length))

function nearMissName(word: string): string | null {
  if (word.length < 7 || word.length > NEAR_MISS_MAX || COMMON_WORDS.has(word)) return null
  const single = undoubled(word)
  for (const name of NEAR_MISS_NAMES) {
    if (name === word || single === UNDOUBLED_NAMES.get(name)) return name
    if (name.length !== word.length) continue
    let differences = 0
    for (let index = 0; index < name.length && differences < 2; index += 1) if (name[index] !== word[index]) differences += 1
    if (differences === 1) return name
  }
  return null
}

function readableWord(word: string): string {
  // Đường tắt (lớp đầu ra gọi hàm này cho mọi từ, mỗi chunk): từ ngắn không có chữ số thì không đổi.
  if (word.length < 7 && !/\d/.test(word)) return word
  const letters = word.match(/[a-z]/g)?.length ?? 0
  const deLeet = /^[a-z0-9]+$/.test(word) && letters >= 2 && /[0134]/.test(word) ? word.replace(/[0134]/g, digit => LEET[digit]!) : word
  return nearMissName(deLeet) ?? deLeet
}

/**
 * Chữ thường bỏ dấu, đ → d, mọi thứ không phải chữ/số thành một khoảng trắng, có khoảng trắng hai đầu để khớp
 * trọn từ. Một dãy ≥ 2 chữ cái đứng rời ("h o a n g", "H.o.à.n.g", "P a r a c e l") được nối lại thành một từ;
 * mỗi từ qua `readableWord` (số thay chữ, gõ sai một chữ).
 */
export function sovereigntyLatinKey(lower: string): string {
  const words = lower.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const out: string[] = []
  for (let index = 0; index < words.length;) {
    let end = index
    while (end < words.length && /^\p{L}$/u.test(words[end]!)) end += 1
    if (end - index >= 2) {
      out.push(readableWord(words.slice(index, end).join('')))
      index = end
    } else {
      out.push(readableWord(words[index]!))
      index += 1
    }
  }
  return ` ${out.join(' ')} `
}

// Dấu câu ngắt mệnh đề (sau NFKC: 、 。 , . ! ? ; : …) thành "|": chữ trước dấu câu không phải "chữ đứng trước" của
// chữ sau nó — "我来自广州，南沙群岛…", "我刚爬完山。南海是谁的？" (州/山 là chữ loại trừ của 南海/南沙).
const HAN_CLAUSE_BREAK = /[、。,.!?;:…]+/gu

/**
 * Chỉ giữ chữ Hán, để "西 沙", "西-沙" hay "西<zero-width>沙" vẫn là "西沙" — nhưng dấu câu ngắt mệnh đề thành "|"
 * ("越南。沙坝" là "越南|沙坝", không phải "越南沙坝").
 */
export function sovereigntyHanKey(folded: string): string {
  return folded.replace(HAN_CLAUSE_BREAK, '|').replace(/[^\p{Script=Han}|]/gu, '').replace(/\|{2,}/g, '|')
}
