/**
 * Ai được chạy lúc này — một phần của `backup.ts` (tệp đó giờ là barrel, xem đầu tệp).
 *
 *  - Khoá MySQL `cdkt:backup:run` (`LOCK_RUN`, timeout 0): hai lượt sao lưu không chạy
 *    chồng; lượt dọn rác lúc khởi động cũng lấy nó.
 *  - Khoá `cdkt:backup:restore` (`LOCK_RESTORE`): lượt khôi phục giữ nó; lượt sao lưu,
 *    xoay vòng và lượt dọn hỏi nó (`restoreLockHeldOnServer`).
 *  - Sổ tên tệp đang được khôi phục trong tiến trình này (`holdRestoreTarget`).
 *  - Hai lỗi "bận" mà nơi gọi phân biệt bằng kiểu.
 *
 * Sổ tên tệp nằm ở đây chứ không ở `backup-restore.ts`: tệp đó import barrel
 * `backup.ts` (`runBackup` cho bản `pre-restore`), mà barrel kéo theo xoay vòng — đặt
 * sổ ở `backup-restore.ts` thì xoay vòng phải import ngược lại, thành vòng import.
 */
import type { RowDataPacket } from 'mysql2/promise'

import { getPool } from '../utils/db'

/** Khoá MySQL của lượt sao lưu (và lượt dọn rác) — không chờ: bận thì từ chối ngay. */
export const LOCK_RUN = 'cdkt:backup:run'
export const LOCK_TIMEOUT = 0

/** Khoá MySQL của lượt khôi phục — một nguồn cho `backup-restore.ts` và cho xoay vòng. */
export const LOCK_RESTORE = 'cdkt:backup:restore'

/** Một lượt backup khác giữ khoá — phân biệt bằng kiểu, không so chuỗi. */
export class BackupLockBusyError extends Error {
  constructor(message = 'Một lượt backup khác đang chạy. Thử lại sau.') {
    super(message)
    this.name = 'BackupLockBusyError'
  }
}

/**
 * Một lượt khôi phục CSDL đang giữ khoá (hoặc không hỏi được MySQL): không bắt đầu lượt
 * sao lưu nào. Lượt khôi phục thay cả bảng `backups` bằng bản trong dump; một bản sao
 * lưu xong GIỮA lúc đó không nằm trong danh sách mà lượt khôi phục đã đọc để gắn lại, và
 * mang mã thời điểm SAU bản `pre-restore` — hàng của nó mất, rồi lượt dọn xoá tệp.
 * Là một dạng "bận" (kế thừa `BackupLockBusyError`): endpoint trả 409, scheduler không
 * tính là một lượt thử (lỗi ném trước `onStarted`). Riêng bản `pre-restore` của chính
 * lượt khôi phục đi qua (`allowDuringRestore`).
 */
export class BackupRestoreInProgressError extends BackupLockBusyError {
  constructor() {
    super('Đang khôi phục cơ sở dữ liệu — chưa thể sao lưu lúc này. Thử lại sau khi khôi phục xong.')
    this.name = 'BackupRestoreInProgressError'
  }
}

const activeRestoreTargets = new Map<string, number>()

/**
 * Đánh dấu `filename` (tên trong thư mục backups) là đang được khôi phục cho tới
 * khi gọi hàm trả về. Đếm tham chiếu: `restoreUploaded` và `runRestore` cùng giữ
 * một file mà không nhả sớm cho nhau. Gọi nhả nhiều lần vô hại.
 */
export function holdRestoreTarget(filename: string): () => void {
  activeRestoreTargets.set(filename, (activeRestoreTargets.get(filename) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const left = (activeRestoreTargets.get(filename) ?? 1) - 1
    if (left <= 0) activeRestoreTargets.delete(filename)
    else activeRestoreTargets.set(filename, left)
  }
}

export function restoreTargetsInProgress(): ReadonlySet<string> {
  return new Set(activeRestoreTargets.keys())
}

/**
 * Khoá `cdkt:backup:restore` có đang bị giữ không — bởi bất kỳ tiến trình/container nào
 * (`IS_USED_LOCK` hỏi MySQL, không chờ). Ném khi không hỏi được; mỗi nơi gọi tự quyết
 * "không biết" nghĩa là gì (đều theo hướng không làm gì).
 */
export async function restoreLockHeldOnServer(): Promise<boolean> {
  const pool = getPool()
  if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')
  const [rows] = await pool.query<RowDataPacket[]>('SELECT IS_USED_LOCK(?) AS holder', [LOCK_RESTORE])
  const holder = rows[0]?.holder
  return holder !== null && holder !== undefined
}
