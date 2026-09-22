/**
 * Sinh short ID YouTube-style cho mục media — 11 ký tự base64url từ 8 random bytes.
 *
 * ## Vì sao tồn tại
 *
 * URL trang chi tiết video từng dùng slug dài (`ytsave-youtube-media-...-1080p-2`)
 * — dài, khó chia sẻ, khó đọc. Short ID 11 ký tự (`dQw4w9WgXcQ`) làm định danh URL
 * công khai chính, giống YouTube. Cột `slug` vẫn giữ cho redirect 301 (link cũ
 * không chết) và log, nhưng URL công khai dùng `short_id`.
 *
 * ## 64 bit entropy, 11 ký tự base64url
 *
 * `randomBytes(8)` = 64 bit. Base64url mã 6 bit/ký tự, nên 11 ký tự = 66 bit, dư
 * 2 bit — cùng cách YouTube làm (8 byte → 11 ký tự). 64 bit entropy nghĩa là cần
 * ~4 tỷ mục mới có 50% cơ hội trùng (paradox sinh nhật), nên trùng là sự kiện cực
 * hiếm nhưng vẫn kiểm (cột UNIQUE là thẩm quyền, không phải may rủi).
 *
 * ## Dùng `BigInt` vì 64 bit vượt `Number.MAX_SAFE_INTEGER`
 *
 * `Number` chỉ an toàn tới 2^53. 64 bit cần `BigInt` cho phép shift/and. An toàn
 * vì đây chỉ là tính toán bit, không I/O — `BigInt` chậm hơn `Number` nhưng không
 * đáng kể cho 11 phép shift.
 *
 * ## `uniqueShortMediaId` nhận transaction client, không phải `db`
 *
 * Cùng lý do `uniqueMediaSlug`: cả hai đường gọi đều trong một transaction
 * (`createMediaItem` tạo hàng `media_items` cùng dòng audit). Nhận `db` sẽ khiến
 * lượt `SELECT` kiểm trùng chạy trên **pool**, ngoài transaction: nó đọc một ảnh
 * chụp khác với ảnh chụp mà lượt `INSERT` sắp ghi vào, và hai lượt tạo cùng lúc có
 * thể cùng thấy "short_id còn trống". Cột `short_id` có UNIQUE nên lượt thứ hai
 * **ném ra**, transaction rollback.
 */
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'

import type { getDb } from './db'
import { mediaItems } from '../db/schema'

/** Chiều dài short ID — 11 ký tự, cùng YouTube. */
export const SHORT_ID_LENGTH = 11

/**
 * Bảng chữ base64url: `A-Z a-z 0-9 - _`. Không dùng `+`/`/` (base64 chuẩn) vì chúng
 * cần URL-encoding trong path — làm hỏng tính "gọn" của short ID. `-_` an toàn trong
 * URL path segment.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/**
 * Mã hoá 8 random bytes thành 11 ký tự base64url.
 *
 * Thuần, không I/O — kiểm được không cần DB. Export để `migrations-additive.ts`
 * dùng trong backfill (chỉ có raw mysql2 connection, không Drizzle).
 */
export function encodeShortId(): string {
  const bytes = randomBytes(8) // 64 bit
  let value = 0n
  for (const b of bytes) value = (value << 8n) | BigInt(b)

  // Đọc 6 bit mỗi ký tự, từ phải sang trái (LSB trước). 64 bit → 10 ký tự đầy +
  // 1 ký tự từ 4 bit còn lại + 2 bit zero padding → 11 ký tự.
  let out = ''
  for (let i = 0; i < SHORT_ID_LENGTH; i++) {
    out = ALPHABET[Number(value & 0x3Fn)] + out
    value >>= 6n
  }
  return out
}

/**
 * Client giao dịch, suy từ chính `db.transaction` — cùng shape với `MediaSlugClient`.
 */
export type ShortIdClient = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

/**
 * Sinh short_id duy nhất trong transaction client đã cho.
 *
 * Trùng là cực hiếm (64 bit) nhưng cột UNIQUE là thẩm quyền, nên kiểm. Tối đa 8
 * lần thử — 8 lần trùng liên tiếp là xác suất ~ (n/2^64)^8, với n là số hàng hiện
 * có; kể cả với 1 triệu hàng, đó là ~10^-45, gần như không bao giờ. Throw thay vì
 * loop vô hạn: nếu đến lần thứ 8 vẫn trùng, có gì đó sai (seed xác định?时钟 hỏng?),
 * và `throw` tốt hơn một vòng lặp không bao giờ dừng.
 */
export async function uniqueShortMediaId(client: ShortIdClient): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = encodeShortId()
    const [row] = await client
      .select({ id: mediaItems.id })
      .from(mediaItems)
      .where(eq(mediaItems.shortId, candidate))
      .limit(1)
    if (!row) return candidate
  }
  throw new Error('Không sinh được short_id duy nhất sau 8 lần thử.')
}
