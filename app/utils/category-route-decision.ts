/**
 * Tuyến một đoạn `/news/<X>` ("dishwasher"): `X` là slug chuyên mục → danh sách theo
 * chuyên mục; còn lại → chi tiết bài. Quyết định dựa trên lượt đọc
 * `/api/public/categories?type=news`.
 *
 * Lỗi đã gặp (bộ kiểm chứng, bản build không có CSDL): lượt đọc chuyên mục HỎNG được
 * đọc thành "không phải chuyên mục" → trang rơi sang `ArticleDetail` và trả 200 cho
 * `/news/tin-tuc` — một chuyên mục có thật hiện như "bài không tải được" và trang lỗi
 * được đệm. Hỏng thì CHƯA BIẾT `X` là gì: không được kết luận "bài", không được 404 —
 * hiện nhánh lỗi + thử lại, và lượt SSR trả 503 (cùng cách `app/pages/[slug].vue` xử lý
 * `lookupFailed`).
 *
 * `{ ok: false }` (hình dạng thân lỗi của endpoint, kể cả khi một proxy/bản cũ trả nó
 * với mã 200) cũng là HỎNG, không phải "danh sách rỗng".
 *
 * Hàm thuần — kiểm không cần Nuxt (`tests/category-route-decision.test.ts`).
 */

export type CategoryRouteDecision = 'pending' | 'category' | 'article' | 'lookup-failed'

export interface CategoryLookupState {
  /** `status` của `useAsyncData`: 'idle' | 'pending' | 'success' | 'error'. */
  status: string
  data: { ok?: boolean; items?: ReadonlyArray<{ slug: string }> } | null | undefined
  slug: string
}

export function resolveCategoryRoute({ status, data, slug }: CategoryLookupState): CategoryRouteDecision {
  if (status === 'error') return 'lookup-failed'
  if (status !== 'success') return 'pending'
  if (!data || data.ok === false) return 'lookup-failed'
  return (data.items ?? []).some((category) => category.slug === slug) ? 'category' : 'article'
}
