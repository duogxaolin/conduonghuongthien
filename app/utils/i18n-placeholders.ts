/**
 * Chuỗi dịch có chỗ trống `{tên}` — "Tìm thấy {n} kết quả…", "Trang {page} trên tổng số
 * {total} trang". Mỗi ngôn ngữ đặt chỗ trống ở chỗ của nó, nên trang không được ghép
 * "tiền tố + số + hậu tố" theo thứ tự tiếng Việt.
 */

export type PlaceholderValues = Record<string, string | number>

/** Thay mọi `{tên}` có trong `values`; chỗ trống không có giá trị giữ nguyên. */
export function fillPlaceholders(text: string, values: PlaceholderValues): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole))
}

export interface PlaceholderPart {
  text: string
  /** Phần này là giá trị của một chỗ trống (trang in đậm nó). */
  value: boolean
}

/**
 * Cắt chuỗi thành đoạn chữ và đoạn giá trị, theo thứ tự của chính bản dịch — cho
 * `components/I18nStrong.vue`, nơi giá trị được in đậm. Đoạn chữ rỗng bị bỏ.
 */
export function splitPlaceholders(text: string, values: PlaceholderValues): PlaceholderPart[] {
  const parts: PlaceholderPart[] = []
  let last = 0
  for (const match of text.matchAll(/\{(\w+)\}/g)) {
    const name = match[1]!
    if (!(name in values)) continue
    if (match.index > last) parts.push({ text: text.slice(last, match.index), value: false })
    parts.push({ text: String(values[name]), value: true })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), value: false })
  return parts
}
