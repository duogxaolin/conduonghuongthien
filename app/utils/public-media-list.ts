/**
 * Phần thuần của thư viện Video công khai (`/media`): đọc trạng thái từ URL, dựng
 * query gửi `/api/public/media`, dựng địa chỉ của một trạng thái.
 *
 * Cùng hợp đồng với `public-article-list.ts`: URL là nguồn chân lý duy nhất, khoá
 * `useAsyncData` dẫn xuất từ query. Tách khỏi composable để kiểm không cần mount
 * (`tests/public-media-list.test.ts`).
 */
import { parsePageParam } from './pagination'
import { readQueryString } from './public-article-list'

export interface MediaRouteState {
  page: number
  search: string
  /** Slug chuyên mục video; `''` = mọi chuyên mục. */
  category: string
}

/** Query gửi `/api/public/media` — thứ tự thuộc tính cố định (khoá dựng bằng JSON). */
export interface MediaListQuery {
  page: number
  limit: number
  search?: string
  category?: string
}

export function readMediaRouteState(query: Record<string, unknown>): MediaRouteState {
  return {
    page: parsePageParam(query.page),
    search: readQueryString(query.q),
    category: readQueryString(query.category),
  }
}

export function buildMediaListQuery(state: MediaRouteState, perPage: number): MediaListQuery {
  const query: MediaListQuery = { page: state.page, limit: perPage }
  if (state.search) query.search = state.search
  if (state.category) query.category = state.category
  return query
}

/** Địa chỉ của một trạng thái: `?q`, `?category`, `?page` chỉ khi cần. */
export function mediaListLocation(state: MediaRouteState) {
  const query: { q?: string; category?: string; page?: number } = {}
  if (state.search) query.q = state.search
  if (state.category) query.category = state.category
  if (state.page > 1) query.page = state.page
  return { path: '/media', query }
}

export const sameMediaState = (a: MediaRouteState, b: MediaRouteState) =>
  a.page === b.page && a.search === b.search && a.category === b.category
