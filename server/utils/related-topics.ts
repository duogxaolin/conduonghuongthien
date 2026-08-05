/**
 * Gộp số bài của danh mục con vào danh mục gốc, rồi xếp thứ tự chủ đề liên quan.
 *
 * Tách ra khỏi handler vì đây là phần **có thể sai trong im lặng**: một con số
 * lệch vẫn là một con số trông hợp lý. Hàm thuần (danh mục + số đếm → danh sách
 * đã xếp) nên kiểm được mà không cần CSDL hay máy chủ HTTP — cùng lý do
 * `resolveClientIp` và `computeBoostDue` là hàm thuần.
 *
 * Quy tắc gộp **phải khớp** với cách `/api/public/articles` phân giải
 * `categorySlug`: danh mục gốc gộp cả con vào, danh mục con chỉ tính chính nó.
 * Lệch một chút là chip báo một con số rồi mở ra một danh sách dài khác — và cái
 * sai đó chỉ lộ ra khi có người đếm tay.
 */

export interface TopicCategoryInput {
  id: number
  name: string
  slug: string
  parentId: number | null
  displayOrder?: number | null
}

export interface RelatedTopic {
  name: string
  slug: string
  total: number
  isCurrent: boolean
}

/**
 * @param categories Danh mục cùng thể loại với bài đang đọc.
 * @param directCounts Số bài đã xuất bản gán **trực tiếp** cho từng categoryId.
 * @param currentCategoryId Danh mục của bài đang đọc (`null` nếu bài không có).
 * @param limit Số chip tối đa.
 */
export function rollUpRelatedTopics(
  categories: readonly TopicCategoryInput[],
  directCounts: ReadonlyMap<number, number>,
  currentCategoryId: number | null,
  limit: number,
): RelatedTopic[] {
  const childrenOf = new Map<number, number[]>()
  for (const category of categories) {
    if (category.parentId === null) continue
    // Một danh mục con trỏ tới cha không cùng thể loại (hoặc đã bị xoá) không có
    // mục nào trong `childrenOf` để cộng vào — nó vẫn tự đứng thành một chip với
    // số của chính nó, chứ không biến mất.
    const siblings = childrenOf.get(category.parentId) ?? []
    siblings.push(category.id)
    childrenOf.set(category.parentId, siblings)
  }

  return categories
    .map((category) => {
      const own = directCounts.get(category.id) ?? 0
      const total = category.parentId === null
        ? own + (childrenOf.get(category.id) ?? []).reduce((sum, id) => sum + (directCounts.get(id) ?? 0), 0)
        : own
      return {
        name: category.name,
        slug: category.slug,
        total,
        isCurrent: category.id === currentCategoryId,
        displayOrder: Number(category.displayOrder ?? 0),
        id: category.id,
      }
    })
    // Chủ đề không có bài nào bị loại: một chip mở ra danh sách trống là một ngõ
    // cụt, và nó chiếm đúng chỗ mà một chủ đề có nội dung đáng được đứng.
    .filter((topic) => topic.total > 0)
    .sort((a, b) => {
      // Chủ đề của bài đang đọc lên đầu — đó là chỗ người đọc đang đứng, nên
      // cũng là cú bấm tiếp theo có khả năng nhất.
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
      if (a.total !== b.total) return b.total - a.total
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
      return a.id - b.id
    })
    .slice(0, limit)
    .map(({ name, slug, total, isCurrent }) => ({ name, slug, total, isCurrent }))
}
