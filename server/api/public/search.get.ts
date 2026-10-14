import { finitePositive, MAX_PAGE } from '../../utils/query-number'
import { getDb } from '../../utils/db'
import { reportPublicReadFailure } from '../../utils/public-read-failure'
import { containsPattern, MAX_LIKE_QUERY_CHARS } from '../../utils/sql-like'
import {
  buildSearchCounts,
  normalizeSearchFilter,
  planSearchSlices,
  REINTEGRATION_TYPES,
  searchSegments,
  type SearchCounts,
  type SearchFilter,
  type SearchSlice,
} from '../../utils/search-paging'
import { articles, categories, chatbotKnowledge, pages } from '../../db/schema'
import { eq, like, desc, asc, inArray, and, or, count, type SQL } from 'drizzle-orm'

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
        badge: 'bg-[#EBF3E8] text-[#2D5A27]',
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

/** Lọc loại bài khi tab là một loại bài cụ thể; `all` không lọc loại. */
function articleTypeCondition(filter: SearchFilter): SQL | undefined {
  if (filter === 'reintegration_model') return inArray(articles.type, [...REINTEGRATION_TYPES])
  if (filter === 'news' || filter === 'role_model' || filter === 'document' || filter === 'faq') return eq(articles.type, filter)
  return undefined
}

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
    const db = getDb()
    // Một mẫu duy nhất cho cả lượt đếm lẫn lượt lấy hàng — hai bên không thể
    // lệch điều kiện với nhau.
    const pattern = containsPattern(q)

    const articleMatch = and(
      eq(articles.status, 'published'),
      or(like(articles.title, pattern), like(articles.excerpt, pattern)),
    )
    const qaMatch = and(
      eq(chatbotKnowledge.status, 'published'),
      or(like(chatbotKnowledge.canonicalQuestion, pattern), like(chatbotKnowledge.approvedAnswer, pattern)),
    )
    const pageMatch = or(like(pages.title, pattern), like(pages.slug, pattern))

    const [articleTypeRows, qaTotalRows, pageTotalRows] = await Promise.all([
      db.select({ type: articles.type, total: count() }).from(articles).where(articleMatch).groupBy(articles.type),
      db.select({ total: count() }).from(chatbotKnowledge).where(qaMatch),
      db.select({ total: count() }).from(pages).where(pageMatch),
    ])

    const counts = buildSearchCounts(articleTypeRows, Number(qaTotalRows[0]?.total ?? 0), Number(pageTotalRows[0]?.total ?? 0))
    const segments = searchSegments(filter, counts)
    const total = segments.reduce((sum, segment) => sum + segment.total, 0)
    const slices = planSearchSlices(segments, offset, limit)
    const typeCondition = articleTypeCondition(filter)

    const readSlice = async (slice: SearchSlice): Promise<SearchItem[]> => {
      if (slice.source === 'articles') {
        const rows = await db
          .select({
            id: articles.id,
            type: articles.type,
            title: articles.title,
            slug: articles.slug,
            excerpt: articles.excerpt,
            thumbnailUrl: articles.thumbnailUrl,
            publishedAt: articles.publishedAt,
            createdAt: articles.createdAt,
            categoryName: categories.name,
          })
          .from(articles)
          .leftJoin(categories, eq(articles.categoryId, categories.id))
          .where(typeCondition ? and(articleMatch, typeCondition) : articleMatch)
          .orderBy(desc(articles.publishedAt), desc(articles.id))
          .limit(slice.limit)
          .offset(slice.offset)
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
            title: a.title,
            excerpt: a.excerpt ? String(a.excerpt).replace(/<[^>]*>/g, ' ').slice(0, 200) : '',
            url: `${meta.basePath}${a.slug}`,
            thumbnailUrl: a.thumbnailUrl || null,
            publishedAt: dateVal ? new Date(dateVal).toISOString() : null,
            categoryName: a.categoryName || null,
          }
        })
      }

      if (slice.source === 'qa') {
        const rows = await db
          .select({
            id: chatbotKnowledge.id,
            canonicalQuestion: chatbotKnowledge.canonicalQuestion,
            approvedAnswer: chatbotKnowledge.approvedAnswer,
            topic: chatbotKnowledge.topic,
            publishedAt: chatbotKnowledge.publishedAt,
            createdAt: chatbotKnowledge.createdAt,
          })
          .from(chatbotKnowledge)
          .where(qaMatch)
          .orderBy(desc(chatbotKnowledge.id))
          .limit(slice.limit)
          .offset(slice.offset)
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
            excerpt: qItem.approvedAnswer ? String(qItem.approvedAnswer).replace(/<[^>]*>/g, ' ').slice(0, 200) : '',
            url: `/qa-documents#qa-${qItem.id}`,
            thumbnailUrl: null,
            publishedAt: dateVal ? new Date(dateVal).toISOString() : null,
            categoryName: qItem.topic || 'Hỏi đáp',
          }
        })
      }

      const rows = await db
        .select({
          id: pages.id,
          title: pages.title,
          slug: pages.slug,
          seoDescription: pages.seoDescription,
        })
        .from(pages)
        .where(pageMatch)
        // Thứ tự xác định — không có ORDER BY thì OFFSET trả hàng tuỳ ý giữa hai lượt.
        .orderBy(asc(pages.id))
        .limit(slice.limit)
        .offset(slice.offset)
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
