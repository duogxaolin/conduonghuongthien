/**
 * Phân trang cho `/api/public/search` — hàm thuần, kiểm được không cần CSDL.
 *
 * Kết quả tìm kiếm là **một danh sách nối** của ba nguồn theo thứ tự cố định:
 * bài viết → mục Hỏi–Đáp → trang. Trước đây endpoint lấy một lượng hàng bị chặn
 * trần (100 bài / 50 mục / 20 trang, hoặc `limit*2+offset`) rồi đếm **số hàng đã
 * lấy về** làm `total`: tổng số trang sai, và nó **tăng dần khi khách bấm sang
 * trang sau** (vì `offset` lớn hơn thì lấy nhiều hơn). Nay mỗi nguồn có một
 * `COUNT(*)` thật, và mỗi trang chỉ lấy đúng phần giao của khoảng
 * `[offset, offset+limit)` với từng nguồn.
 */

export type SearchSource = 'articles' | 'qa' | 'pages'

export interface SearchSegment {
  source: SearchSource
  total: number
}

export interface SearchSlice {
  source: SearchSource
  /** OFFSET bên trong nguồn đó. */
  offset: number
  /** LIMIT bên trong nguồn đó — luôn ≥ 1. */
  limit: number
}

/**
 * Cắt khoảng `[offset, offset + limit)` của danh sách nối thành các lượt đọc
 * theo từng nguồn. Nguồn không giao với khoảng thì không có lượt đọc nào — trang
 * vượt quá tổng (`offset >= total`) cho ra mảng rỗng, tức **không truy vấn gì**.
 */
export function planSearchSlices(segments: readonly SearchSegment[], offset: number, limit: number): SearchSlice[] {
  const slices: SearchSlice[] = []
  if (!(limit > 0) || offset < 0) return slices
  const end = offset + limit
  let start = 0
  for (const segment of segments) {
    const total = Math.max(0, Math.floor(segment.total))
    const localStart = Math.max(0, offset - start)
    const localEnd = Math.min(total, end - start)
    if (localEnd > localStart) {
      slices.push({ source: segment.source, offset: localStart, limit: localEnd - localStart })
    }
    start += total
    if (start >= end) break
  }
  return slices
}

/** Bộ đếm cho các tab của trang `/search` — khoá khớp `filterTabs` phía client. */
export interface SearchCounts {
  all: number
  news: number
  role_model: number
  reintegration_model: number
  document: number
  faq: number
  qa: number
  page: number
}

/** Bộ lọc `type` nhận được; giá trị lạ không khớp nguồn nào → 0 kết quả. */
export type SearchFilter = 'all' | 'news' | 'role_model' | 'reintegration_model' | 'document' | 'faq' | 'qa' | 'page' | 'unknown'

export function normalizeSearchFilter(raw: unknown): SearchFilter {
  const value = String(raw ?? 'all').trim().toLowerCase() || 'all'
  if (value === 'reintegration') return 'reintegration_model'
  const known: readonly SearchFilter[] = ['all', 'news', 'role_model', 'reintegration_model', 'document', 'faq', 'qa', 'page']
  return (known as readonly string[]).includes(value) ? (value as SearchFilter) : 'unknown'
}

/** Hai giá trị `articles.type` cùng nghĩa "mô hình tái hoà nhập" (dữ liệu cũ + mới). */
export const REINTEGRATION_TYPES = ['reintegration', 'reintegration_model'] as const

/**
 * Gộp `SELECT type, COUNT(*) … GROUP BY type` của bài viết với hai bộ đếm còn
 * lại thành bộ đếm của tab. `all` gồm **mọi** loại bài (kể cả loại tuỳ biến
 * không có tab riêng), đúng như danh sách "Tất cả" trả về.
 */
export function buildSearchCounts(
  articleTypeRows: ReadonlyArray<{ type: string; total: number | string }>,
  qaTotal: number,
  pageTotal: number,
): SearchCounts {
  const counts: SearchCounts = { all: 0, news: 0, role_model: 0, reintegration_model: 0, document: 0, faq: 0, qa: 0, page: 0 }
  let articleTotal = 0
  for (const row of articleTypeRows) {
    const n = Number(row.total) || 0
    articleTotal += n
    if ((REINTEGRATION_TYPES as readonly string[]).includes(row.type)) counts.reintegration_model += n
    else if (row.type === 'news' || row.type === 'role_model' || row.type === 'document' || row.type === 'faq') counts[row.type] += n
  }
  counts.qa = Math.max(0, Number(qaTotal) || 0)
  counts.page = Math.max(0, Number(pageTotal) || 0)
  counts.all = articleTotal + counts.qa + counts.page
  return counts
}

/** Thứ tự nối và độ dài từng đoạn cho một bộ lọc. */
export function searchSegments(filter: SearchFilter, counts: SearchCounts): SearchSegment[] {
  switch (filter) {
    case 'all':
      return [
        { source: 'articles', total: counts.all - counts.qa - counts.page },
        { source: 'qa', total: counts.qa },
        { source: 'pages', total: counts.page },
      ]
    case 'news':
    case 'role_model':
    case 'reintegration_model':
    case 'document':
    case 'faq':
      return [{ source: 'articles', total: counts[filter] }]
    case 'qa':
      return [{ source: 'qa', total: counts.qa }]
    case 'page':
      return [{ source: 'pages', total: counts.page }]
    default:
      return []
  }
}
