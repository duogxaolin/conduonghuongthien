/**
 * Vòng focus (`focus-visible:ring-[#…]`) trên nền trắng/sáng phải đạt ≥ 3:1 (WCAG
 * 1.4.11 — thành phần giao diện không phải chữ).
 *
 * Lỗi đã gặp (bộ kiểm chứng): `#7CB342` (xanh phụ của DNA giao diện) chỉ đạt 2.50:1
 * trên trắng — người dùng bàn phím gần như không thấy mình đang ở đâu. Các tệp dưới
 * đây đặt nút/liên kết trên nền trắng hoặc `#F8FAF7`, nên vòng focus dùng xanh chủ
 * đạo `#4A6741`. Chỉ xét vòng KHÔNG có độ trong suốt (`ring-[#hex]/30` là quầng phụ
 * đi kèm viền đậm, không phải chỉ báo duy nhất).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const FILES = [
  'components/layout/DefaultHeader.vue',
  // Mục con của menu thả xuống (nền trắng) — sót lại sau lượt sửa đầu.
  'components/layout/DefaultDesktopNav.vue',
  'components/blocks/BlockLoadError.vue',
  'components/ContentTypeListSection.vue',
  'pages/media/index.vue',
]

function luminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

test('#7CB342 trên trắng thật sự dưới 3:1 (lý do của test này), #4A6741 đạt', () => {
  assert.ok(contrast('7CB342', 'FFFFFF') < 3)
  assert.ok(contrast('4A6741', 'FFFFFF') >= 3)
  assert.ok(contrast('4A6741', 'F8FAF7') >= 3)
})

for (const file of FILES) {
  test(`${file}: mọi vòng focus đặc đạt ≥ 3:1 trên trắng`, () => {
    const source = readFileSync(new URL(`../app/${file}`, import.meta.url), 'utf8')
    const rings = [...source.matchAll(/focus-visible:ring-\[#([0-9A-Fa-f]{6})\](?!\/)/g)].map((m) => m[1]!)
    for (const hex of rings) {
      const ratio = contrast(hex, 'FFFFFF')
      assert.ok(ratio >= 3, `#${hex} chỉ đạt ${ratio.toFixed(2)}:1 trên trắng`)
    }
  })
}
