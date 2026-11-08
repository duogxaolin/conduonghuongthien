import { articleReadScope } from '../../../services/articles'
import { listArticleAuthors } from '../../../services/admin-articles-queries'

/**
 * Danh sách người đăng bài, để đổ vào ô lọc ở `/admin/content/articles`.
 *
 * Tồn tại như một endpoint riêng thay vì dùng `/api/admin/users` vì endpoint đó
 * gác bằng `users.read`, còn trang này suy ra quyền đọc từ loại bài viết.
 * Tên tác giả và số lượng chỉ được tính trên các bài người gọi được đọc,
 * dùng cùng điều kiện với danh sách bài viết; không lộ thống kê của loại bị cấm.
 *
 * Chỉ trả người **đã thực sự có bài** (inner join), không trả toàn bộ bảng
 * `users`: một ô lọc liệt kê cả người chưa đăng gì là một danh sách mà phần lớn
 * lựa chọn chắc chắn cho ra kết quả rỗng. Tập này suy ra từ nội dung được phép
 * đọc, không phải từ danh bạ.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  const scope = articleReadScope(adminUser)

  // Authors by article count, then the articles whose author was deleted (`ON DELETE SET NULL`) —
  // both inside the same scope (services/admin-articles-queries.ts).
  const { items, orphanCount } = await listArticleAuthors(scope)

  return {
    ok: true,
    items: items.map(row => ({ ...row, articleCount: Number(row.articleCount) })),
    orphanCount: Number(orphanCount),
  }
})
