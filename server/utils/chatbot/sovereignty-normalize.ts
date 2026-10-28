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

/**
 * NFKC (chữ toàn độ → thường), bỏ ký tự định dạng vô hình (zero-width — NFKC không bỏ), gộp chữ Hán,
 * "Ð"/"ð" (hay lẫn vào chữ Việt thay cho "Đ"/"đ") → "Đ"/"đ". Giữ hoa/thường: "Trường Sa" viết hoa là tên riêng.
 */
export function sovereigntyFold(value: string): string {
  return value.normalize('NFKC').replace(/\p{Cf}/gu, '')
    .replace(HAN_FOLD_CHARS, char => HAN_FOLD[char]!)
    .replace(/Ð/g, 'Đ').replace(/ð/g, 'đ')
}

/** Chữ thường bỏ dấu, đ → d, mọi thứ không phải chữ/số thành một khoảng trắng, có khoảng trắng hai đầu để khớp trọn từ. */
export function sovereigntyLatinKey(lower: string): string {
  return ` ${lower.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `
}

/** Chỉ giữ chữ Hán, để "西 沙" hay "西<zero-width>沙" vẫn là "西沙". */
export function sovereigntyHanKey(folded: string): string {
  return folded.replace(/[^\p{Script=Han}]/gu, '')
}
