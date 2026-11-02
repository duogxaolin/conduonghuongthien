/**
 * Sửa một mục media.
 *
 * ## Toàn bộ logic nghiệp vụ sống trong `updateMediaItem`
 *
 * Endpoint này chỉ đọc body, kiểm quyền, truyền xuống service. Không tự kiểm
 * `not_found` ở đây: service trả `{ ok: false, reason: 'not_found' }` cho đúng
 * trường hợp đó, và lặp lại kiểm ở đây là một chỗ thứ hai để một ngày nào đó đọc
 * "đã xoá" như "vẫn còn". Service cũng đã bọc cặp ghi-hàng-kèm-audit trong
 * `db.transaction` — `tests/reader-audit-atomicity.test.ts` quét `server/services/**`,
 * nên endpoint này không có `activity_logs` nào để lo.
 *
 * ## `status` có thể đổi qua hai trường
 *
 * `updateMediaItem` nhận `status` trong body. Đây là đường chính để xuất bản
 * (`draft` → `published`) hoặc gỡ (`published` → `archived`), và service tự gắn
 * nhãn audit là `'publish'` khi lượt đó là xuất bản lần đầu, `'update'` cho các
 * lượt sửa khác — cùng cách phân biệt mà `articles/[id].put.ts` đã theo.
 *
 * `commentsEnabled` và `isFeatured` cũng đi qua body. `commentsEnabled` mặc định
 * TẮT khi tạo mục (xem `createMediaItem`), nên chỉ bật khi cán bộ quyết định mở
 * bình luận cho một video cụ thể — chính sách mở-từng-bài như đường bài viết.
 */
import { defineEventHandler, readBody, createError } from 'h3'

import { requireResourcePermission } from '../../../utils/permissions'
import { updateMediaItem, MediaValidationError } from '../../../services/media-portal'
import { purgePublicPageCacheAfterWrite } from '../../../utils/public-page-cache'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'update')

  const id = Number(event.context.params?.id)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mục media không hợp lệ.' })
  }

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const result = await updateMediaItem({
    id,
    actorId: adminUser.id,
    title: body.title,
    description: body.description,
    categoryId: body.categoryId,
    status: body.status,
    commentsEnabled: body.commentsEnabled,
    isFeatured: body.isFeatured,
    youtubeVideoId: body.youtubeVideoId,
  }).catch((error: unknown) => {
    if (error instanceof MediaValidationError) throw createError({ statusCode: 400, statusMessage: error.message })
    throw error
  })

  if (!result.ok) {
    throw createError({ statusCode: 404, statusMessage: 'Mục media không tồn tại.' })
  }

  // Xoá bộ đệm trang công khai sau commit, nuốt lỗi (chỉ log) — để khách thấy ngay video
  // vừa xuất bản, VÀ thấy ngay một video vừa gỡ xuất bản (bản cũ chỉ xoá khi kết quả là
  // `published`, nên gỡ xuất bản không làm mới gì). Bản cũ (`purgeMediaListCache`) lọc
  // khoá dạng `nitro/routes:/media:GET.json` mà Nitro không bao giờ sinh ra (khoá thật:
  // `nitro:routes:_:media.<hash>.json`), nên chưa từng xoá được gì. `/media/**` vẫn
  // `swr: 60`: xoá một bản đệm không đụng gì tới việc danh tính người đọc chỉ nạp sau mount.
  await purgePublicPageCacheAfterWrite('media_portal.update')

  return { ok: true, slug: result.slug, status: result.status }
})
