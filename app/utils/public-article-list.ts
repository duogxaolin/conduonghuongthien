/**
 * Phần thuần của danh sách bài viết công khai: đọc trạng thái từ URL, dựng query
 * gửi `/api/public/articles`, và dựng **khoá** cho `useAsyncData`.
 *
 * Vì sao khoá phải chứa đủ mọi tham số: `/news`, `/documents`, `/role-models`,
 * `/reintegration-models` từng gọi `useAsyncData('news-articles-list', …)` với một
 * chuỗi cố định và không `watch`. Bấm trang 2 chỉ `navigateTo('?page=2')`; Nuxt giữ
 * nguyên component (khoá trang theo path), nên lượt fetch **không bao giờ chạy
 * lại**: thanh địa chỉ báo trang 2, danh sách vẫn là trang 1 (F5 thì đúng). Tìm
 * kiếm hỏng y hệt. Khoá dẫn xuất từ query làm Nuxt tự fetch lại khi query đổi.
 *
 * Tách khỏi composable để kiểm không cần mount (`tests/public-article-list.test.ts`).
 */
import { parsePageParam } from './pagination'
import type { PublicArticleListItem, PublicPagination } from './public-types'

/** Giá trị đặc biệt của bộ lọc chuyên mục: không lọc. */
export const ALL_CATEGORIES = 'all'

/** Trạng thái danh sách đọc từ URL — URL là nguồn chân lý duy nhất. */
export interface ListRouteState {
  page: number
  search: string
  category: string
}

/** Query gửi `/api/public/articles` cho danh sách chính. */
export interface ArticleListQuery {
  type: string
  limit: number
  page: number
  lang: string
  search?: string
  categorySlug?: string
}

/** Query gửi `/api/public/articles` cho khối "Đọc nhiều". */
export interface MostReadQuery {
  type: string
  limit: number
  sort: 'views'
  lang: string
}

export interface ArticleListResponse {
  ok: boolean
  articles: PublicArticleListItem[]
  pagination: PublicPagination
}

/** Một tham số query của vue-router: chuỗi, null, hoặc mảng khi lặp tham số. */
export function readQueryString(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * Đọc trạng thái danh sách từ `route.query`.
 *
 * `withCategory: false` (mặc định) bỏ qua `?cat=` — chỉ `/news` nhận bộ lọc
 * chuyên mục qua query (link cũ); các trang khác không có bộ lọc đó và không nên
 * vô tình lọc theo một tham số lạ trong URL.
 */
export function readListRouteState(
  query: Record<string, unknown>,
  options: { withCategory?: boolean } = {},
): ListRouteState {
  const category = options.withCategory ? readQueryString(query.cat) : ''
  return {
    page: parsePageParam(query.page),
    search: readQueryString(query.q),
    category: category || ALL_CATEGORIES,
  }
}

export function buildArticleListQuery(input: {
  type: string
  perPage: number
  page: number
  search: string
  category: string
  lang: string
}): ArticleListQuery {
  // Thứ tự thuộc tính cố định — khoá dựng bằng JSON.stringify phụ thuộc vào nó.
  const query: ArticleListQuery = {
    type: input.type,
    limit: input.perPage,
    page: input.page,
    lang: input.lang,
  }
  if (input.search) query.search = input.search
  if (input.category && input.category !== ALL_CATEGORIES) query.categorySlug = input.category
  return query
}

export function buildMostReadQuery(type: string, lang: string): MostReadQuery {
  return { type, limit: 6, sort: 'views', lang }
}

/**
 * Khoá `useAsyncData` cho một query.
 *
 * JSON chứ không nối bằng gạch: `news-1-all-${search}` thì tìm "1-all" ở trang
 * khác có thể ra **cùng** khoá với một tổ hợp khác, và Nuxt trả nhầm danh sách
 * đã nạp. JSON của một object có thứ tự thuộc tính cố định là đơn ánh — nơi gọi
 * dựng query với thứ tự thuộc tính cố định (`buildArticleListQuery`, `listQuery`
 * của `/media`).
 */
export function listDataKey(prefix: string, query: object): string {
  return `${prefix}:${JSON.stringify(query)}`
}

/**
 * Địa chỉ của một trạng thái danh sách: `?q=` khi có từ khoá, `?page=` khi > 1.
 * `path` do trang quyết định (`/news/<chuyên mục>` khác `/news`).
 */
export function listLocation(path: string, state: { search: string; page: number }) {
  const query: { q?: string; page?: number } = {}
  if (state.search) query.q = state.search
  if (state.page > 1) query.page = state.page
  return { path, query }
}

/**
 * Trang trong URL nằm QUÁ trang cuối của một danh sách CÓ dữ liệu (`?page=999999`,
 * link cũ sau khi bài bị gỡ). Khi đó danh sách rỗng nhưng không phải "chưa có bài":
 * giao diện phải đưa người đọc về trang đầu thay vì để họ kẹt ở một trang trắng.
 * Danh sách thật sự rỗng (`total = 0`) thì không — đó là trạng thái rỗng bình thường.
 */
export function isPageOutOfRange(page: number, pagination: { total: number; totalPages: number }): boolean {
  return pagination.total > 0 && page > Math.max(1, pagination.totalPages)
}

export function emptyArticleList(perPage: number): ArticleListResponse {
  return { ok: true, articles: [], pagination: { page: 1, limit: perPage, total: 0, totalPages: 1 } }
}
