/**
 * Sinh slug duy nhất cho một mục media.
 *
 * **Tham số đầu tiên là client giao dịch (`tx`), không phải `db`.** Đó là ràng
 * buộc, không phải sở thích: cả hai đường gọi đều ở trong một transaction —
 * `server/services/media-portal.ts` tạo hàng `media_items` cùng dòng audit, và
 * đường "lưu buổi phát thành bản ghi" tạo mục media rồi ghi `saved_media_id` trở
 * lại phiên. Nhận `db` ở đây sẽ khiến lượt `SELECT` kiểm trùng chạy trên **pool**,
 * ngoài transaction: nó đọc một ảnh chụp khác với ảnh chụp mà lượt `INSERT` sắp
 * ghi vào, và hai lượt tạo cùng lúc có thể cùng thấy "slug còn trống". Cột `slug`
 * có UNIQUE nên lượt thứ hai **ném ra**, transaction rollback, và cán bộ nhận một
 * lỗi cơ sở dữ liệu cho một thao tác đúng.
 *
 * Đặt ở `server/utils/` chứ không `server/services/` theo cùng lối `slug.ts`:
 * đây là hàm thuần về mặt nghiệp vụ (một truy vấn, không ghi, không audit), và
 * tách khỏi `slug.ts` vì bảng `media_items` có một khác biệt so với ba bảng kia —
 * nó dùng chung cột `slug` cho **hai** nguồn (tệp tải lên và tham chiếu nền tảng
 * ngoài), nên tiền tố dự phòng và giới hạn độ dài ở đây phải khớp với cột
 * `VARCHAR(512)` của bảng đó.
 */
import { and, like, ne } from 'drizzle-orm'

import type { getDb } from './db'
import { mediaItems } from '../db/schema'
import { slugify } from './slug'

/**
 * Client giao dịch, suy từ chính `db.transaction` thay vì viết tay.
 *
 * Viết tay kiểu của drizzle (`MySqlTransaction<…>` với ba tham số generic) là một
 * dòng dài dễ sai và sẽ lệch ở mỗi lần nâng cấp thư viện. Suy ra từ nơi nó được
 * sinh thì không bao giờ lệch — và nó cũng tự khẳng định điều quan trọng: tham số
 * này là **cùng loại** với thứ callback của `db.transaction` nhận.
 */
export type MediaSlugClient = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

/** Tiền tố khi tiêu đề không còn ký tự nào dùng được (tiêu đề toàn emoji, toàn
 *  dấu câu). Không để slug rỗng: `media_items.slug` là NOT NULL và UNIQUE, nên
 *  một chuỗi rỗng sẽ chặn **mọi** mục thứ hai không có tiêu đề dùng được. */
const FALLBACK_SLUG = 'video'

/**
 * Trần độ dài phần gốc của slug.
 *
 * Cột là `VARCHAR(512)`, nhưng trần ở đây thấp hơn nhiều vì slug còn phải mang
 * hậu tố `-<n>` và vì một slug dài 500 ký tự trong một URL là thứ không ai đọc
 * được. Cắt theo **ký tự** chứ không theo byte: tiếng Việt có dấu đã bị `slugify`
 * chuyển hết sang ascii, nên ở đây hai đơn vị là một.
 */
const MAX_BASE_LENGTH = 200

/**
 * Slug duy nhất cho một mục media, tính trong client đã cho.
 *
 * `excludeId` bỏ qua chính hàng đang sửa — không có nó thì đổi tiêu đề của một
 * mục mà giữ nguyên slug sẽ đụng chính nó và sinh ra `-2` vô cớ, làm chết mọi
 * liên kết đã phát ra ngoài tới mục đó.
 *
 * Tìm theo **tiền tố** (`base%`) rồi lọc trong bộ nhớ, thay vì hỏi từng ứng viên
 * một: một lượt `SELECT` cho cả họ slug, không phải N lượt. Tiền tố không có ký
 * tự đại diện của `LIKE` (`%`, `_`) vì `slugify` đã lọc sạch chúng — nên không
 * có đường nào để một tiêu đề chứa `%` biến truy vấn này thành quét toàn bảng.
 */
export async function uniqueMediaSlug(
  client: MediaSlugClient,
  title: unknown,
  excludeId?: number,
): Promise<string> {
  const source = typeof title === 'string' ? title : ''
  const baseSlug = (slugify(source) || FALLBACK_SLUG).slice(0, MAX_BASE_LENGTH)

  const rows = await client
    .select({ slug: mediaItems.slug })
    .from(mediaItems)
    .where(
      excludeId
        ? and(like(mediaItems.slug, `${baseSlug}%`), ne(mediaItems.id, excludeId))
        : like(mediaItems.slug, `${baseSlug}%`),
    )

  const taken = new Set(rows.map(row => row.slug))
  if (!taken.has(baseSlug)) return baseSlug

  // Hậu tố nhỏ nhất còn trống. Bắt đầu từ 2 vì `-1` đọc ra như một phần của tiêu
  // đề chứ không như một lượt đánh số.
  let suffix = 2
  while (taken.has(`${baseSlug}-${suffix}`)) suffix++
  return `${baseSlug}-${suffix}`
}
