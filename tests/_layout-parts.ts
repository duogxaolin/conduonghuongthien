/**
 * Helper cho các test guard đọc source layout sau khi tách template ra 7 component con.
 *
 * Trước tách, default.vue chứa toàn bộ markup inline; các test guard grep chuỗi
 * (`v-for="item in navMenu"`, `@click="readerSignIn()"`, `:src="siteMainLogo"`...)
 * trong `default.vue` để chặn hồi quy cấu trúc (đã từng mất khối danh tính mobile,
 * mất mục /media khi gộp nav). Sau tách, markup chuyển sang `app/components/layout/*.vue`.
 *
 * Test guard giờ đọc **nhiều file** và đếm gộp, giữ nguyên ý nghĩa: một khối đúng
 * nhưng bị nhân bản ở sai chỗ vẫn khớp phép tìm đơn lẻ, nên test đếm số lần xuất
 * hiện trên cặp file (header + drawer).
 *
 * `layoutSource` = default.vue + 7 component ghép. `readPart(name)` đọc riêng
 * một component cho test cần phân biệt desktop vs mobile.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const PARTS = [
  'app/layouts/default.vue',
  'app/components/layout/DefaultTopBar.vue',
  'app/components/layout/DefaultHeader.vue',
  'app/components/layout/DefaultMobileDrawer.vue',
  'app/components/layout/DefaultDesktopNav.vue',
  'app/components/layout/DefaultSearchDropdown.vue',
  'app/components/layout/DefaultFooter.vue',
  'app/components/layout/DefaultBottomNav.vue',
]

export const layoutSource = PARTS
  .map(p => readFileSync(path.join(root, p), 'utf8'))
  .join('\n')
  .replace(/\r\n/g, '\n')

export function readPart(name: string): string {
  return readFileSync(path.join(root, 'app/components/layout', name), 'utf8').replace(/\r\n/g, '\n')
}
