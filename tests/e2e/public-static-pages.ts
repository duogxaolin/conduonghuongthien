/**
 * Danh sách TRANG CÔNG KHAI TĨNH (không `[param]`, không `/admin`) mà
 * `public-pages-smoke.spec.ts` mở trên bản build thật, cùng danh sách miễn có lý do.
 *
 * Tệp này không import Playwright để `tests/ratchets/e2e-static-pages.test.ts` (chạy trong
 * `npm test`) đọc được cùng một danh sách với spec: thêm một trang vào `app/pages/` mà không
 * khai ở đây thì ratchet đỏ — người thêm phải chọn: đưa vào `SMOKE_PAGES` (mặc định) hoặc ghi
 * vào `SMOKE_EXEMPT` kèm lý do.
 */

/** Route -> trang được mở: 200, đúng một `<h1>` (SSR lẫn sau hydrate), không lỗi console. */
export const SMOKE_PAGES = [
  '/',
  '/about',
  '/assistant',
  '/contact',
  '/documents',
  '/legal-qa',
  '/media',
  '/news',
  '/news/activity-news',
  '/news/featured-news',
  '/news/local-news',
  '/profile',
  '/qa-documents',
  '/reintegration-models',
  '/role-models',
  '/search',
] as const

/** Route -> lý do KHÔNG mở trong smoke (bắt buộc có lý do; danh sách rỗng là trạng thái tốt nhất). */
export const SMOKE_EXEMPT: Readonly<Record<string, string>> = {}
