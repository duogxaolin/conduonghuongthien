/**
 * Lượt điền MỘT LẦN cho cột `reader_accounts.display_name_reserved` (spec
 * reader-display-names-google, design D-NAMES). Gọi từ `applyAdditiveMigrations`
 * CHỈ khi cột vừa được thêm — lượt chuyển theo trạng thái lược đồ, khai báo cho bộ
 * test nâng cấp; khởi động lần hai cột đã có nên không chạy.
 *
 * Không có nó, người đọc đang mang tên Google "Admin" tiếp tục hiện "Admin" trên
 * bình luận công khai cho tới lần đăng nhập Google kế tiếp — vé reader sống 30 ngày.
 *
 * Phép gấp là CỦA ỨNG DỤNG (`isReservedDisplayName`, NFKC + bỏ dấu + `đ`→`d`), không
 * diễn đạt được bằng SQL, nên đọc tên ra rồi chỉ ghi cờ cho hàng khớp. Không đụng
 * `display_name` (tên Google giữ nguyên) và không đụng cột nào khác.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { isReservedDisplayName } from '../utils/display-name'
import { logInfo } from '../utils/logger'

const BATCH = 500

export async function backfillReservedReaderNames(db: Pick<Connection, 'execute'>): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT `id`, `display_name` FROM `reader_accounts` WHERE `display_name` IS NOT NULL',
  )
  const ids = rows
    .filter(row => typeof row.display_name === 'string' && isReservedDisplayName(row.display_name))
    .map(row => Number(row.id))
    .filter(id => Number.isSafeInteger(id) && id > 0)

  for (let start = 0; start < ids.length; start += BATCH) {
    const chunk = ids.slice(start, start + BATCH)
    await db.execute(
      `UPDATE \`reader_accounts\` SET \`display_name_reserved\` = 1 WHERE \`id\` IN (${chunk.map(() => '?').join(', ')})`,
      chunk,
    )
  }
  if (ids.length) logInfo({ event: 'db.migration.reader_reserved_names_flagged', rows: ids.length })
  return ids.length
}
