import { getDb } from '../../../utils/db'
import { articles, users } from '../../../db/schema'
import { eq, count, desc, asc, isNull, and } from 'drizzle-orm'
import { articleReadScope } from '../../../services/articles'

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

  const db = getDb()

  const items = await db
    .select({
      id:           users.id,
      username:     users.username,
      articleCount: count(articles.id),
    })
    .from(articles)
    .innerJoin(users, eq(articles.authorId, users.id))
    .where(scope)
    .groupBy(users.id, users.username)
    // Người đăng nhiều lên trước, vì đó là lựa chọn hay được dùng nhất; tên là
    // mốc phụ để thứ tự ổn định giữa hai lượt tải khi số bài bằng nhau.
    .orderBy(desc(count(articles.id)), asc(users.username))

  /**
   * Số bài đã mất tác giả. `articles.author_id` là `INT NULL` với
   * `ON DELETE SET NULL`, nên xoá một tài khoản là để lại đúng nhóm này. Trả về
   * đếm riêng để giao diện chỉ hiện tuỳ chọn "Không rõ tác giả" khi nhóm đó thật
   * sự có bài — một lựa chọn luôn cho ra danh sách rỗng thì không nên có mặt.
   */
  const [{ orphanCount } = { orphanCount: 0 }] = await db
    .select({ orphanCount: count() })
    .from(articles)
    .where(and(scope, isNull(articles.authorId)))

  return {
    ok: true,
    items: items.map(row => ({ ...row, articleCount: Number(row.articleCount) })),
    orphanCount: Number(orphanCount),
  }
})
