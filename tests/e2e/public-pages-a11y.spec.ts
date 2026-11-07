/**
 * axe-core trên mỗi TRANG CÔNG KHAI TĨNH của bản build thật (cùng danh sách `public-static-pages.ts`
 * với smoke 200/h1/console, nên trang mới vào danh sách đó tự vào đây).
 *
 * Quy tắc WCAG 2.0/2.1 A + AA. Lighthouse chấm trợ năng ra 100 nhưng bỏ sót nhiều thứ axe bắt được
 * (chạy trên production 2026-11-07: `label-content-name-mismatch` ở cả 16 trang, `color-contrast` ở
 * 3 trang, một `aria-allowed-attr` mức critical ở /media).
 *
 * Bỏ `iframe`: nội dung nhúng của bên thứ ba (trình phát YouTube ở /media tự báo `aria-allowed-attr` mức
 * critical và `aria-prohibited-attr` trong khung của nó) không phải mã của dự án và không sửa được ở đây;
 * trang chứa khung vẫn được quét.
 *
 * Chỉ MỘT CHIỀU, như các ratchet của repo: `KNOWN` ghi số nút vi phạm đang được chấp nhận theo từng
 * (trang, quy tắc), kèm lý do. Vi phạm mới, hoặc nhiều nút hơn mức ghi, làm test đỏ; vi phạm đã sửa
 * thì test cũng đỏ cho tới khi hạ mục (hoặc xoá hẳn) — để mức chấp nhận chỉ giảm. Mục `'*'` áp cho
 * mọi trang.
 */
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { SMOKE_PAGES } from './public-static-pages'

/** route (hoặc '*') → quy tắc → số nút tối đa được chấp nhận. Mặc định rỗng là trạng thái tốt nhất. */
const KNOWN: Record<string, Record<string, number>> = {}

const stamp = `${Date.now()}`

for (const route of SMOKE_PAGES) {
  test(`${route}: không vi phạm WCAG A/AA mới (axe)`, async ({ page }) => {
    await page.goto(`${route}?e2e=axe${stamp}`, { waitUntil: 'networkidle' })
    const results = await new AxeBuilder({ page }).exclude('iframe').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()

    const found: Record<string, number> = {}
    for (const violation of results.violations) found[violation.id] = violation.nodes.length
    const allowed = { ...KNOWN['*'], ...KNOWN[route] }

    const worse = Object.entries(found)
      .filter(([id, nodes]) => nodes > (allowed[id] ?? 0))
      .map(([id, nodes]) => `${id}: ${nodes} nút (chấp nhận ${allowed[id] ?? 0}) — ${results.violations.find(v => v.id === id)!.nodes.slice(0, 3).map(n => n.target.join(' ') + ' ' + n.html.replace(/\s+/g, ' ').slice(0, 260)).join(' | ')}`)
    expect(worse, `${route}: vi phạm axe mới hoặc nhiều hơn mức đã ghi`).toEqual([])

    const better = Object.entries(allowed)
      .filter(([id, nodes]) => (found[id] ?? 0) < nodes)
      .map(([id, nodes]) => `${id}: còn ${found[id] ?? 0} nút, mức ghi ${nodes} — hạ hoặc xoá mục trong KNOWN`)
    expect(better, `${route}: đã sửa được — hạ mức chấp nhận`).toEqual([])
  })
}
