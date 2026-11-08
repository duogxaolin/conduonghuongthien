import { finitePositive, MAX_PAGE } from '../../utils/query-number'
import { reportPublicReadFailure } from '../../utils/public-read-failure'
import { plainTextField } from '../../utils/decode-html-entities'
import { containsPattern, MAX_LIKE_QUERY_CHARS } from '../../utils/sql-like'
import {
  buildSearchCounts,
  normalizeSearchFilter,
  planSearchSlices,
  searchSegments,
  type SearchCounts,
  type SearchSlice,
} from '../../utils/search-paging'
import {
  countSearchMatches,
  listSearchArticleRows,
  listSearchPageRows,
  listSearchQaRows,
} from '../../services/public-search-queries'

export interface SearchItem {
  id: string | number
  kind: 'article' | 'qa' | 'page'
  type: string
  typeLabel: string
  typeIcon: string
  typeBadgeClass: string
  title: string
  excerpt: string
  url: string
  thumbnailUrl: string | null
  publishedAt: string | null
  categoryName: string | null
}

const resolveArticleType = (type: string) => {
  switch (type) {
    case 'role_model':
      return {
        label: 'Tấm gương tiêu biểu',
        icon: 'fa-solid fa-award',
        badge: 'bg-[#FFF3E0] text-[#E65100]',
        basePath: '/role-models/',
      }
    case 'reintegration':
    case 'reintegration_model':
      return {
        label: 'Mô hình tái hòa nhập',
        icon: 'fa-solid fa-people-group',
        badge: 'bg-[#E3F2FD] text-[#1565C0]',
        basePath: '/reintegration-models/',
      }
    case 'document':
      return {
        label: 'Văn bản pháp luật',
        icon: 'fa-solid fa-file-lines',
        badge: 'bg-[#EDE7F6] text-[#5E35B1]',
        basePath: '/news/',
      }
    case 'faq':
      return {
        label: 'Giải đáp pháp luật',
        icon: 'fa-solid fa-circle-question',
        badge: 'bg-[#E0F2F1] text-[#00695C]',
        basePath: '/news/',
      }
    default:
      return {
        label: 'Bản tin',
        icon: 'fa-solid fa-newspaper',
        badge: 'bg-line text-[#2D5A27]',
        basePath: '/news/',
      }
  }
}

const zeroCounts = (): SearchCounts => ({
  all: 0,
  news: 0,
  role_model: 0,
  reintegration_model: 0,
  document: 0,
  faq: 0,
  qa: 0,
  page: 0,
})

/**
 * Tìm kiếm toàn cổng: bài viết → Hỏi–Đáp → trang, nối theo thứ tự đó.
 *
 * `total`/`totalPages`/`counts` là **số đếm thật** (`COUNT(*)` mỗi nguồn với
 * đúng điều kiện của lượt lấy hàng), và mỗi trang chỉ đọc phần giao của nó với
 * từng nguồn (`planSearchSlices`). Trước đây chúng là độ dài của một lượt lấy
 * hàng bị chặn trần, nên số trang sai và tăng dần khi khách bấm sang trang sau.
 *
 * `counts` nay luôn đếm **mọi** tab, kể cả khi đang lọc một tab — trước đây các
 * tab không được truy vấn hiện 0, nên nhãn "Tấm gương (0)" nói sai khi đang ở
 * tab "Bản tin". Cái giá là ba `COUNT(*)` mỗi lượt, cùng điều kiện với lượt lấy.
 *
 * Giới hạn công việc: chuỗi tìm cắt ở `MAX_LIKE_QUERY_CHARS`; `%`/`_`/`\` khách
 * gõ được escape (`containsPattern`) nên không còn là ký tự đại diện; trang vượt
 * tổng thì không truy vấn hàng nào. Còn lại: `LIKE '%q%'` không dùng được chỉ mục,
 * nên mỗi lượt vẫn quét các bảng nguồn — kể cả `approved_answer` (LONGTEXT) của
 * kho Hỏi–Đáp. Chấp nhận ở quy mô hiện tại (kho vài chục mục, ~1,1 nghìn bài);
 * nếu kho lớn lên, thay bằng chỉ mục FULLTEXT chứ không bằng cách cắt kết quả.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const q = String(query.q || query.search || '').trim().slice(0, MAX_LIKE_QUERY_CHARS)
  const filter = normalizeSearchFilter(query.type)
  const limit = finitePositive(query.limit, 10, 50)
  const page = finitePositive(query.page, 1, MAX_PAGE)
  const offset = (page - 1) * limit

  if (!q) {
    return {
      ok: true,
      items: [] as SearchItem[],
      total: 0,
      counts: zeroCounts(),
      pagination: { page: 1, limit, total: 0, totalPages: 0 },
    }
  }

  try {
    // Một mẫu duy nhất cho cả lượt đếm lẫn lượt lấy hàng — hai bên không thể
    // lệch điều kiện với nhau.
    const pattern = containsPattern(q)

    const { articleTypeRows, qaTotalRows, pageTotalRows } = await countSearchMatches(pattern)

    const counts = buildSearchCounts(articleTypeRows, Number(qaTotalRows[0]?.total ?? 0), Number(pageTotalRows[0]?.total ?? 0))
    const segments = searchSegments(filter, counts)
    const total = segments.reduce((sum, segment) => sum + segment.total, 0)
    const slices = planSearchSlices(segments, offset, limit)

    const readSlice = async (slice: SearchSlice): Promise<SearchItem[]> => {
      if (slice.source === 'articles') {
        const rows = await listSearchArticleRows(pattern, filter, slice.limit, slice.offset)
        return rows.map((a) => {
          const meta = resolveArticleType(a.type)
          const dateVal = a.publishedAt || a.createdAt
          return {
            id: a.id,
            kind: 'article' as const,
            type: a.type,
            typeLabel: meta.label,
            typeIcon: meta.icon,
            typeBadgeClass: meta.badge,
            title: plainTextField(a.title) ?? '',
            // Decode BEFORE cutting: slicing an encoded string could split `&agrave;`.
            excerpt: a.excerpt ? (plainTextField(String(a.excerpt).replace(/<[^>]*>/g, ' ')) ?? '').slice(0, 200) : '',
            url: `${meta.basePath}${a.slug}`,
            thumbnailUrl: a.thumbnailUrl || null,
            publishedAt: dateVal ? new Date(dateVal).toISOString() : null,
            categoryName: a.categoryName || null,
          }
        })
      }

      if (slice.source === 'qa') {
        const rows = await listSearchQaRows(pattern, slice.limit, slice.offset)
        return rows.map((qItem) => {
          const dateVal = qItem.publishedAt || qItem.createdAt
          return {
            id: `qa-${qItem.id}`,
            kind: 'qa' as const,
            type: 'qa',
            typeLabel: 'Tài liệu Hỏi – Đáp',
            typeIcon: 'fa-solid fa-comments',
            typeBadgeClass: 'bg-[#E8F5E9] text-[#2E7D32]',
            title: qItem.canonicalQuestion,
            excerpt: qItem.approvedAnswer ? (plainTextField(String(qItem.approvedAnswer).replace(/<[^>]*>/g, ' ')) ?? '').slice(0, 200) : '',
            url: `/qa-documents#qa-${qItem.id}`,
            thumbnailUrl: null,
            publishedAt: dateVal ? new Date(dateVal).toISOString() : null,
            categoryName: qItem.topic || 'Hỏi đáp',
          }
        })
      }

      const rows = await listSearchPageRows(pattern, slice.limit, slice.offset)
      return rows.map((p) => ({
        id: `page-${p.id}`,
        kind: 'page' as const,
        type: 'page',
        typeLabel: 'Trang thông tin',
        typeIcon: 'fa-solid fa-file-invoice',
        typeBadgeClass: 'bg-[#F1F5F9] text-[#475569]',
        title: p.title,
        excerpt: p.seoDescription || 'Trang chuyên mục trên cổng thông tin',
        url: `/${p.slug}`,
        thumbnailUrl: null,
        publishedAt: null,
        categoryName: null,
      }))
    }

    // `slices` đã theo đúng thứ tự nối, nên ghép theo thứ tự mảng là đủ.
    const items: SearchItem[] = (await Promise.all(slices.map(readSlice))).flat()

    return {
      ok: true,
      items,
      total,
      counts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  } catch (error) {
    reportPublicReadFailure(event, 'public.search_failed', error)
    return {
      ok: false,
      items: [] as SearchItem[],
      total: 0,
      counts: zeroCounts(),
      pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
    }
  }
})
