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

// Chữ Kirin / Hy Lạp nhìn như chữ Latin ("Нoàng" — Н Kirin, "Paraсel" — с Kirin, "Ηoàng" — Η Hy Lạp). Chỉ thay
// trong một từ CÓ cả chữ Latin: một từ toàn Kirin (tiếng Nga — "Парасельские") giữ nguyên cho mẫu tiếng Nga.
const CONFUSABLES: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X', І: 'I', Ј: 'J', Ѕ: 'S',
  а: 'a', е: 'e', к: 'k', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', һ: 'h', ԁ: 'd',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
  α: 'a', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u',
}
const CONFUSABLE_CHARS = new RegExp(`[${Object.keys(CONFUSABLES).join('')}]`, 'gu')
const LATIN_LETTER = /\p{Script=Latin}/u
const LOOKALIKE_SCRIPT = /[\p{Script=Cyrillic}\p{Script=Greek}]/u

/**
 * NFKC (chữ toàn độ → thường), bỏ ký tự định dạng vô hình (zero-width — NFKC không bỏ), gộp chữ Hán,
 * "Ð"/"Ɖ" (hay lẫn vào chữ Việt thay cho "Đ") → "Đ", chữ Kirin/Hy Lạp giả Latin trong một từ Latin → chữ Latin.
 * Giữ hoa/thường: "Trường Sa" viết hoa là tên riêng.
 *
 * Bỏ ký tự vô hình làm DÍNH hai từ ("Biển<U+200B>Đông" → "BiểnĐông"): mẫu nhiều từ ở guard nhận nối rỗng (`JOIN`).
 */
export function sovereigntyFold(value: string): string {
  const folded = value.normalize('NFKC').replace(/\p{Cf}/gu, '')
    .replace(HAN_FOLD_CHARS, char => HAN_FOLD[char]!)
    .replace(/[ÐƉ]/g, 'Đ').replace(/[ðɖ]/g, 'đ')
  // Lớp đầu ra gọi hàm này mỗi chunk: chỉ duyệt từng từ khi văn bản có chữ Kirin/Hy Lạp.
  if (!LOOKALIKE_SCRIPT.test(folded)) return folded
  return folded.replace(/[\p{L}\p{M}]+/gu, word => LATIN_LETTER.test(word) && LOOKALIKE_SCRIPT.test(word)
    ? word.replace(CONFUSABLE_CHARS, char => CONFUSABLES[char]!)
    : word)
}

// Số thay chữ ("H0àng", "Spr4tly"): chỉ trong một từ ASCII đã có ít nhất hai chữ cái, và không 5→s
// ("trường 5A" không được thành "trường sa"; "C11" giữ nguyên).
const LEET: Record<string, string> = { 0: 'o', 1: 'i', 3: 'e', 4: 'a' }
// Gõ sai đúng một chữ trong tên Latin dài ("Parasel", "Spratlei"): chỉ THAY chữ, cùng độ dài, tên ≥ 7 chữ —
// xoá một chữ thì "parcel" (bưu kiện) đã thành "paracel".
const NEAR_MISS_NAMES = ['paracel', 'paracels', 'spratly', 'spratlys', 'spratley', 'spratleys', 'scarborough']

function readableWord(word: string): string {
  const letters = word.match(/[a-z]/g)?.length ?? 0
  const deLeet = /^[a-z0-9]+$/.test(word) && letters >= 2 && /[0134]/.test(word) ? word.replace(/[0134]/g, digit => LEET[digit]!) : word
  if (deLeet.length < 7) return deLeet
  for (const name of NEAR_MISS_NAMES) {
    if (name.length !== deLeet.length || name === deLeet) continue
    let differences = 0
    for (let index = 0; index < name.length && differences < 2; index += 1) if (name[index] !== deLeet[index]) differences += 1
    if (differences === 1) return name
  }
  return deLeet
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

/** Chỉ giữ chữ Hán, để "西 沙" hay "西<zero-width>沙" vẫn là "西沙". */
export function sovereigntyHanKey(folded: string): string {
  return folded.replace(/[^\p{Script=Han}]/gu, '')
}
