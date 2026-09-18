import { finitePositive, MAX_PAGE } from '../../utils/query-number'
import { getDb } from '../../utils/db'
import { articles, categories, chatbotKnowledge, pages } from '../../db/schema'
import { eq, like, desc, inArray, and, or, sql } from 'drizzle-orm'

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

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const q = String(query.q || query.search || '').trim()
    const filterType = String(query.type || 'all').trim().toLowerCase()
    const limit = finitePositive(query.limit, 10, 50)
    const page = finitePositive(query.page, 1, MAX_PAGE)
    const offset = (page - 1) * limit

    if (!q) {
      return {
        ok: true,
        items: [],
        total: 0,
        counts: {
          all: 0,
          news: 0,
          role_model: 0,
          reintegration_model: 0,
          document: 0,
          faq: 0,
          qa: 0,
          page: 0,
        },
        pagination: { page: 1, limit, total: 0, totalPages: 0 },
      }
    }

    const db = getDb()
    const searchPattern = `%${q}%`

    // 1. Query articles
    const articleConds = [
      eq(articles.status, 'published'),
      or(
        like(articles.title, searchPattern),
        like(articles.excerpt, searchPattern)
      ),
    ]

    if (filterType === 'news') {
      articleConds.push(eq(articles.type, 'news'))
    } else if (filterType === 'role_model') {
      articleConds.push(eq(articles.type, 'role_model'))
    } else if (filterType === 'reintegration_model' || filterType === 'reintegration') {
      articleConds.push(inArray(articles.type, ['reintegration', 'reintegration_model']))
    } else if (filterType === 'document') {
      articleConds.push(eq(articles.type, 'document'))
    } else if (filterType === 'faq') {
      articleConds.push(eq(articles.type, 'faq'))
    }

    const shouldQueryArticles = filterType === 'all' || [
      'news',
      'role_model',
      'reintegration_model',
      'reintegration',
      'document',
      'faq',
    ].includes(filterType)

    // 2. Query Chatbot Knowledge
    const shouldQueryQa = filterType === 'all' || filterType === 'qa'

    // 3. Query Pages
    const shouldQueryPages = filterType === 'all' || filterType === 'page'

    // Execute queries in parallel
    const [rawArticles, rawQa, rawPages] = await Promise.all([
      shouldQueryArticles
        ? db
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
            .where(and(...articleConds))
            .orderBy(desc(articles.publishedAt), desc(articles.id))
            .limit(shouldQueryQa || shouldQueryPages ? 100 : limit * 2 + offset)
        : Promise.resolve([]),

      shouldQueryQa
        ? db
            .select({
              id: chatbotKnowledge.id,
              canonicalQuestion: chatbotKnowledge.canonicalQuestion,
              approvedAnswer: chatbotKnowledge.approvedAnswer,
              topic: chatbotKnowledge.topic,
              publishedAt: chatbotKnowledge.publishedAt,
              createdAt: chatbotKnowledge.createdAt,
            })
            .from(chatbotKnowledge)
            .where(
              and(
                eq(chatbotKnowledge.status, 'published'),
                or(
                  like(chatbotKnowledge.canonicalQuestion, searchPattern),
                  like(chatbotKnowledge.approvedAnswer, searchPattern)
                )
              )
            )
            .orderBy(desc(chatbotKnowledge.id))
            .limit(50)
        : Promise.resolve([]),

      shouldQueryPages
        ? db
            .select({
              id: pages.id,
              title: pages.title,
              slug: pages.slug,
              seoDescription: pages.seoDescription,
            })
            .from(pages)
            .where(
              or(
                like(pages.title, searchPattern),
                like(pages.slug, searchPattern)
              )
            )
            .limit(20)
        : Promise.resolve([]),
    ])

    // Convert raw results to SearchItem[]
    const articleItems: SearchItem[] = rawArticles.map((a) => {
      const meta = resolveArticleType(a.type)
      const dateVal = a.publishedAt || a.createdAt
      return {
        id: a.id,
        kind: 'article',
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

    const qaItems: SearchItem[] = rawQa.map((qItem) => {
      const dateVal = qItem.publishedAt || qItem.createdAt
      return {
        id: `qa-${qItem.id}`,
        kind: 'qa',
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

    const pageItems: SearchItem[] = rawPages.map((p) => ({
      id: `page-${p.id}`,
      kind: 'page',
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

    // Combine all
    const allCombined = [...articleItems, ...qaItems, ...pageItems]

    // Compute counts across all types
    const counts = {
      all: allCombined.length,
      news: articleItems.filter((i) => i.type === 'news').length,
      role_model: articleItems.filter((i) => i.type === 'role_model').length,
      reintegration_model: articleItems.filter((i) =>
        ['reintegration', 'reintegration_model'].includes(i.type)
      ).length,
      document: articleItems.filter((i) => i.type === 'document').length,
      faq: articleItems.filter((i) => i.type === 'faq').length,
      qa: qaItems.length,
      page: pageItems.length,
    }

    const total = allCombined.length
    const totalPages = Math.ceil(total / limit) || 0
    const paginatedItems = allCombined.slice(offset, offset + limit)

    return {
      ok: true,
      items: paginatedItems,
      total,
      counts,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    }
  } catch (err: unknown) {
    return {
      ok: false,
      items: [],
      total: 0,
      counts: {
        all: 0,
        news: 0,
        role_model: 0,
        reintegration_model: 0,
        document: 0,
        faq: 0,
        qa: 0,
        page: 0,
      },
      pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
    }
  }
})
