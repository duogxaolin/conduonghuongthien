import { finitePositive, MAX_PAGE } from '../../utils/query-number'
import { reportPublicReadFailure } from '../../utils/public-read-failure'
import { withPlainTextFields } from '../../utils/decode-html-entities'
import { MAX_LIKE_QUERY_CHARS } from '../../utils/sql-like'
import { queryPublicArticleList } from '../../services/public-articles-queries'

/**
 * Trần số trang của `sort=views`. "Đọc nhiều" là một khối top-N (6 bài, trang 1 —
 * `buildMostReadQuery`); không trang nào lật nó. Với trần chung `MAX_PAGE` (100 000)
 * một yêu cầu ẩn danh `?type=reintegration&sort=views&limit=50&page=100000` bắt mỗi
 * lượt đọc theo tên lưu (`LIMIT offset + limit`) chở MỌI bài đã xuất bản của thể loại
 * về Node để trộn. 10 trang × 50 = tối đa 500 hàng mỗi lượt đọc — gấp ~80 lần nhu cầu
 * thật, vẫn nhỏ. Vượt trần thì kẹp về trang 10 như `finitePositive` vẫn kẹp ở
 * `MAX_PAGE`; `pagination.page` báo đúng trang đã phục vụ.
 */
const MOST_READ_MAX_PAGE = 10

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    // `sort=views` — xếp theo tổng lượt xem hiển thị (thật + ảo), cho khối "Đọc
    // nhiều" của trang danh mục. Giá trị lạ đọc thành "mới nhất" thay vì đoán hộ.
    const sortByViews = String(query.sort || '').trim() === 'views'
    const page = finitePositive(query.page, 1, sortByViews ? MOST_READ_MAX_PAGE : MAX_PAGE)
    const limit = finitePositive(query.limit, 10, 50)
    const offset = (page - 1) * limit
    const search = String(query.search || '').trim().slice(0, MAX_LIKE_QUERY_CHARS)
    const type = String(query.type || '').trim()
    const categorySlug = String(query.categorySlug || '').trim()
    const categoryIdParam = Number(query.categoryId || 0)
    const cookieLang = getCookie(event, 'cdkt_lang')?.trim().toLowerCase() || ''
    const lang = (typeof query.lang === 'string' ? query.lang.trim().toLowerCase() : '') || cookieLang

    // The category lookup, the filters and the list (+ its COUNT, except for `sort=views`).
    const result = await queryPublicArticleList({ sortByViews, limit, offset, search, type, categorySlug, categoryIdParam, lang })

    if (result.kind === 'unknown-category') {
      // Unknown category → empty result, not an error.
      return {
        ok: true,
        articles: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      }
    }

    if (result.kind === 'ranked') {
      /**
       * "Đọc nhiều" là một bảng xếp hạng top-N (khối 6 bài), không phải danh sách
       * phân trang: không chạy `COUNT(*)` (wave2 design D6). `total` vì thế đếm
       * số bài TỚI HẾT trang này (`offset + số bài trả về`) — đúng khi đã hết bảng
       * xếp hạng, là CẬN DƯỚI khi trang đầy. Ai cần tổng thật thì gọi không kèm
       * `sort=views`. Khoá bằng tests/most-read-ranking.test.ts.
       */
      const seen = offset + result.items.length
      return {
        ok: true,
        articles: result.items.map(withPlainTextFields),
        pagination: { page, limit, total: seen, totalPages: Math.ceil(seen / limit) },
      }
    }

    const { items, total } = result

    return {
      ok: true,
      articles: items.map(withPlainTextFields),
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limit)
      }
    }
  } catch (error) {
    reportPublicReadFailure(event, 'public.articles_list_failed', error)
    return { ok: false, articles: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } }
  }
})
