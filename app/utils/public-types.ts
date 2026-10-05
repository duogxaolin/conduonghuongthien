/**
 * Kiểu dùng chung cho response API công khai — thay `any` ở các trang đọc
 * danh sách bài viết / tài liệu hỏi-đáp.
 *
 * Kiểu ở đây suy từ handler (`server/api/public/articles.get.ts`,
 * `server/api/public/chatbot/knowledge.get.ts`) — không viết tay shape khác.
 * Trang nào cần thêm field thì mở rộng ở đây, không cast `any` lại.
 */

/** Mục bài viết trong danh sách công khai — lược từ `articles.get.ts`. */
export interface PublicArticleListItem {
  id: number
  type: string
  category: string | null
  categoryId: number | null
  categoryName: string | null
  categorySlug: string | null
  title: string
  slug: string
  excerpt: string | null
  thumbnailUrl: string | null
  publishedAt: string | null
  createdAt: string | null
  authorName: string | null
}

/** Dạng pagination chuẩn trả về từ các endpoint list công khai. */
export interface PublicPagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

/** Dạng pagination của `/api/public/chatbot/knowledge` (perPage thay limit). */
export interface PublicQaPagination {
  page: number
  perPage: number
  total: number
  totalPages: number
}

/** Mục tài liệu hỏi-đáp — lược từ `serializePublicKnowledge`. */
export interface PublicQaDocument {
  id: number
  question: string
  answer: string
  topic: string | null
  source: { label: string | null; reference: string | null; url: string | null } | null
}

/** Chủ đề facet trong `/api/public/chatbot/knowledge`. */
export interface PublicQaTopic {
  topic: string
  total: number
}
