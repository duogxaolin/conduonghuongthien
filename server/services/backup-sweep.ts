/**
 * Dọn rác của các lượt sao lưu đã chết — một phần của `backup.ts` (tệp đó giờ là
 * barrel, xem đầu tệp). `runBackup` (`backup-run.ts`) gọi `deleteStaleFiles` ở đầu mỗi
 * lượt, dưới khoá chạy; `sweepStaleBackupFiles` là lượt lúc khởi động (scheduler gọi).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { getDb, getPool } from '../utils/db'
import { backups } from '../db/schema'
import { withNamedLock } from '../utils/named-lock'
import { logInfo, logWarn } from '../utils/logger'
import { APP_FINAL, STALE_PARTIAL, backupsDir, isPreRestoreBackup, stampInName } from './backup-names'
import { LOCK_RUN, LOCK_TIMEOUT, restoreLockHeldOnServer } from './backup-locks'

/**
 * Tệp tên-app không có hàng chỉ bị coi là mồ côi khi đã cũ hơn mốc này: khôi phục từ
 * tệp tải lên (giữ khoá KHÔI PHỤC, không phải khoá chạy) đổi tên tệp về tên thật rồi
 * mới ghi hàng — tệp vừa đổi tên còn mới, không bị dọn giữa hai bước đó.
 */
const ORPHAN_MIN_AGE_MS = 10 * 60 * 1000

/**
 * Dọn rác của các lượt `runBackup` đã chết trong `dir`. Chỉ gọi khi đang giữ khoá chạy.
 *  - `.partial` mang tên của app (`STALE_PARTIAL`) — lượt bị giết khi đang ghi.
 *  - Tệp mang ĐÚNG tên cuối cùng của app nhưng không có hàng nào trong `backups` và
 *    cũ hơn `ORPHAN_MIN_AGE_MS` — lượt bị giết giữa lúc đổi tên và commit hàng `done`.
 *    Không đọc được bảng `backups` → không xoá tệp tên-thật nào.
 * Không bao giờ đụng tệp có hàng, tệp không mang tên của app (`scripts/backup*.sh`,
 * `.upload-*.partial`, bản tải lên đổi tên `-upload-…`).
 *
 * Khôi phục CSDL thay cả bảng `backups` bằng bản trong dump: một lượt khôi phục hỏng
 * trước khi gắn lại hàng (hoặc gắn lại hỏng) để lại một danh sách "đúng hình dạng" mà
 * thiếu mọi tệp đăng ký sau thời điểm dump — trước bản vá, lượt dọn kế xoá luôn bản
 * `pre-restore` và các bản mới hơn. Ba quy tắc, mỗi quy tắc tự đủ cho ca của nó:
 *  - bản `pre-restore` không bao giờ là mồ côi (cùng quy tắc với xoay vòng);
 *  - tệp có mã thời điểm KHÔNG SAU bản `pre-restore` mới nhất trên đĩa (= lượt khôi
 *    phục gần nhất) có từ trước lượt khôi phục đó, nên có thể mất hàng chỉ vì danh sách
 *    bị tua lại → giữ. Cái giá: tệp sót của lượt bị giết TRƯỚC lượt khôi phục đó nằm
 *    lại tới khi bản `pre-restore` ấy bị xoá tay (chỉ tốn đĩa — xoá nhầm thì mất bản sao lưu);
 *  - đang có lượt khôi phục giữ khoá (hoặc không hỏi được) → không xoá tệp tên-thật nào:
 *    giữa lúc dump thay bảng và lúc gắn lại hàng, danh sách tạm thời sai.
 */
export async function deleteStaleFiles(dir: string, db: ReturnType<typeof getDb>): Promise<number> {
  let names: string[]
  try { names = await fs.readdir(dir) } catch { return 0 }
  let registered: Set<string> | null = null
  let restoreAnchor: string | null = null
  if (names.some(name => APP_FINAL.test(name))) {
    restoreAnchor = names
      .filter(name => APP_FINAL.test(name) && isPreRestoreBackup({ filename: name }))
      .map(stampInName)
      .filter((stamp): stamp is string => stamp !== null)
      .sort()
      .pop() ?? null
    // Đang khôi phục (hoặc không biết) → danh sách có thể đang bị tua lại: không tin nó.
    let restoreActive = true
    try {
      restoreActive = await restoreLockHeldOnServer()
      if (restoreActive) logWarn({ event: 'backup.orphan_sweep_skipped', reason: 'restore_in_progress' })
    } catch (err: unknown) {
      logWarn({ event: 'backup.orphan_sweep_skipped', reason: 'restore_lock_unknown', error: err instanceof Error ? err.message : String(err) })
    }
    if (!restoreActive) {
      try {
        // MỌI cột, không chỉ `filename`: một bảng `backups` không đúng hình dạng app chờ
        // (vd. vừa khôi phục một dump cũ thiếu cột mới, lượt gắn lại hàng chưa chạy) thì
        // KHÔNG được tin để kết luận tệp nào mồ côi — câu chọn đủ cột ném và lượt dọn bỏ
        // qua tệp tên-thật (đóng an toàn). Chỉ chọn `filename` từng đọc trót lọt bảng cũ
        // rỗng đó và xoá bản `pre-restore` cùng các bản mới hơn.
        registered = new Set((await db.select().from(backups)).map(row => row.filename))
      } catch (err: unknown) {
        logWarn({ event: 'backup.orphan_sweep_skipped', error: err instanceof Error ? err.message : String(err) })
      }
    }
  }
  let partials = 0
  let orphans = 0
  let keptForRestore = 0
  for (const name of names) {
    const partial = STALE_PARTIAL.test(name)
    if (!partial && !(registered && APP_FINAL.test(name) && !registered.has(name))) continue
    // Bản an toàn của một lượt khôi phục: không bao giờ là mồ côi.
    if (!partial && isPreRestoreBackup({ filename: name })) continue
    const file = path.join(dir, name)
    try {
      const stats = await fs.lstat(file)
      if (!stats.isFile()) continue
      if (!partial && Date.now() - stats.mtimeMs < ORPHAN_MIN_AGE_MS) continue
      if (!partial && restoreAnchor !== null && (stampInName(name) ?? '') <= restoreAnchor) {
        keptForRestore += 1
        continue
      }
      await fs.unlink(file)
      if (partial) partials += 1
      else {
        orphans += 1
        logWarn({ event: 'backup.orphan_swept', filename: name })
      }
    } catch (err: unknown) {
      logWarn({ event: 'backup.partial_sweep_failed', filename: name, error: err instanceof Error ? err.message : String(err) })
    }
  }
  if (partials > 0) logInfo({ event: 'backup.partial_swept', count: partials })
  if (keptForRestore > 0) logInfo({ event: 'backup.orphan_kept_restore_window', count: keptForRestore, restoreAttempt: restoreAnchor })
  return partials + orphans
}

/**
 * Dọn rác của lượt sao lưu bị giết (gọi lúc khởi động — xem `deleteStaleFiles`). Lấy
 * khoá chạy (không chờ): giữ được khoá nghĩa là không lượt sao lưu nào trong app đang
 * ghi. Khoá bận → bỏ qua (lượt đang chạy sẽ tự dọn ở đầu lượt sau). Trả số tệp đã xoá.
 */
export async function sweepStaleBackupFiles(): Promise<number> {
  const pool = getPool()
  if (!pool) return 0
  const outcome = await withNamedLock(pool, LOCK_RUN, LOCK_TIMEOUT, () => deleteStaleFiles(backupsDir(), getDb()))
  return outcome.acquired ? outcome.value : 0
}
