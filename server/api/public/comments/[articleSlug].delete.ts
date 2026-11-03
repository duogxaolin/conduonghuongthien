/**
 * A reader deletes their own comment.
 *
 * The ownership rule and the "an administrator reply is not reader-deletable"
 * rule both live in `deleteComment` (design.md D8), which is the single deletion
 * path shared by self-delete, admin delete, bulk delete, ban, account deletion
 * and the retention purge. Re-implementing either check here would put the
 * reader path one refactor away from disagreeing with the other five.
 *
 * There is no PUT or PATCH beside this file, and there never should be: a public
 * comment that can be rewritten after the fact is a record of nothing, and an
 * official reply could end up under a question that no longer resembles the one
 * it answered. Correcting a comment means deleting it and posting again.
 */
/**
 * Tên tệp là `[articleSlug]` dù ở đây giá trị là id bình luận — CÓ CHỦ ĐÍCH.
 *
 * Bộ định tuyến (radix3) giữ MỘT tên tham số cho mỗi vị trí đường dẫn, của tệp được đăng ký
 * trước, bất kể phương thức. `[articleSlug].get.ts` đứng cạnh đây; khi tệp này còn tên
 * `[id]`, trên bản build tham số tên `id` luôn là `undefined` → mọi lượt xoá
 * bình luận trả 400 "Bình luận không hợp lệ" (2026-11-03, chỉ lộ ở production vì thử bằng
 * tay mới đi tới đây). `tests/api-route-param-names.test.ts` chặn hai tên khác nhau ở cùng
 * một vị trí trong `server/api`.
 */
import { requireReader } from '../../../utils/reader-auth'
import { deleteComment } from '../../../services/comments'

export default defineEventHandler(async (event) => {
  const reader = await requireReader(event)

  const raw = getRouterParam(event, 'articleSlug')
  const id = Number(raw)
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bình luận không hợp lệ.' })
  }

  const result = await deleteComment({ id: Math.floor(id), actor: { kind: 'reader', readerId: reader.id } })
  if (!result.ok) throw createError({ statusCode: result.statusCode, statusMessage: result.message })

  return { ok: true }
})
