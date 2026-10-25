/**
 * Xoay vòng: giữ N bản sao lưu gần nhất — một phần của `backup.ts` (tệp đó giờ là
 * barrel, xem đầu tệp). `runBackup` (`backup-run.ts`) gọi `rotateOldBackups` sau khi
 * lượt sao lưu + Drive xong; `selectRotationVictims` là phần thuần chọn bản bị xoá.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { eq, desc } from 'drizzle-orm'

import type { getDb } from '../utils/db'
import { backups } from '../db/schema'
import { logWarn } from '../utils/logger'
import { backupFamilyOf, backupsDir, isPreRestoreBackup } from './backup-names'
import { restoreLockHeldOnServer, restoreTargetsInProgress } from './backup-locks'

type RotationRow = { id: number, filename: string, stamp: string, trigger?: string | null, status?: string | null }

/**
 * Chọn bản bị xoá khi xoay vòng. Hai bất biến, đúng với MỌI `keepCount` (kể cả 1):
 *  - bản `pre-restore` không bao giờ là ứng viên, cũng không chiếm chỗ trong N bản
 *    giữ lại (nó là ảnh chụp trước một lần khôi phục, không phải lịch sử);
 *  - bản MỚI NHẤT của mỗi họ (`sql`, `uploads`, `media`) luôn được giữ. Một lượt
 *    "files" sinh hai archive cùng `type='media'` (`cdkt-uploads-…`, `cdkt-media-…`),
 *    nên họ đọc từ TÊN file chứ không từ cột `type` — đếm theo cột, `keepCount=1`
 *    sẽ giữ archive media và xoá archive uploads duy nhất.
 * Thuần, để kiểm thử không cần CSDL hay đĩa.
 */
export function selectRotationVictims<T extends RotationRow>(rows: readonly T[], keepCount: number): T[] {
  const candidates = rows
    .filter(row => (row.status ?? 'done') === 'done' && !isPreRestoreBackup(row))
    .slice()
    .sort((a, b) => (a.stamp === b.stamp ? b.id - a.id : a.stamp < b.stamp ? 1 : -1))
  const newestOfFamily = new Set<number>()
  const seenFamilies = new Set<string>()
  for (const row of candidates) {
    const family = backupFamilyOf(row.filename) ?? `other:${row.filename}`
    if (seenFamilies.has(family)) continue
    seenFamilies.add(family)
    newestOfFamily.add(row.id)
  }
  const keep = Math.max(1, Math.floor(keepCount))
  return candidates.slice(keep).filter(row => !newestOfFamily.has(row.id))
}

// ─── Xoay vòng không được xoá file đang được khôi phục ─────────────────────────
//
// Bản `pre-restore` đã bỏ xoay vòng, nhưng một lượt backup KHÁC (lịch chạy, bấm
// tay, pre-sync…) kết thúc đúng lúc đang khôi phục một bản CŨ vẫn xoay vòng — và
// bản cũ nhất chính là ứng viên đầu tiên. Hai lớp chặn:
//  1. Khoá `cdkt:backup:restore` đang bị giữ (bất kỳ tiến trình/container nào —
//     `IS_USED_LOCK` hỏi MySQL, không chờ) → bỏ cả lượt xoay vòng, log
//     `backup.rotate_skipped_restore_active`. Không đọc được trạng thái khoá →
//     cũng bỏ (bỏ một lượt xoay vòng vô hại; xoá file đang đọc thì không).
//  2. Tên file đang khôi phục trong tiến trình này (`holdRestoreTarget`, đăng ký
//     TRƯỚC khi `runRestore` kiểm file và lấy khoá — phủ khoảng hở trước khi khoá
//     được giữ) → không bao giờ là nạn nhân; kiểm lại ngay trước mỗi lần xoá.
// Khoá và sổ tên tệp nằm ở `backup-locks.ts` (đầu tệp đó nói vì sao không ở
// `backup-restore.ts`).
// Còn lại một khe đã biết, an toàn: lượt xoay vòng đã qua phép kiểm của một file
// rồi mới tới lượt khôi phục đăng ký file đó → khôi phục thất bại sạch (file
// biến mất trước khi được đọc: `runRestore` 404, hoặc `ENOENT` ở bước kiểm/giải
// nén trước khi ghi gì; khôi phục CSDL còn bị chặn 409 vì backup đang giữ khoá
// chạy), không có lượt khôi phục nửa chừng.

/** Hai câu hỏi xoay vòng phải hỏi trước khi xoá — thay được trong kiểm thử. */
export interface RotationGuards {
  /** Khoá `cdkt:backup:restore` có đang bị giữ không (ném = không biết → bỏ xoay vòng). */
  restoreLockHeld: () => Promise<boolean>
  /** Tên file đang được khôi phục trong tiến trình này. */
  restoreTargets: () => ReadonlySet<string>
}

const DEFAULT_ROTATION_GUARDS: RotationGuards = {
  restoreLockHeld: restoreLockHeldOnServer,
  restoreTargets: restoreTargetsInProgress,
}

/**
 * Xoá bản cũ vượt keepCount — chỉ đếm bản `done` để không xoá bản đang chạy, và
 * không xoá gì khi đang có lượt khôi phục (xem khối chú thích ở trên).
 */
export async function rotateOldBackups(
  db: ReturnType<typeof getDb>,
  keepCount: number,
  guardOverrides: Partial<RotationGuards> = {},
): Promise<number> {
  const guards: RotationGuards = { ...DEFAULT_ROTATION_GUARDS, ...guardOverrides }
  let restoreActive: boolean
  try {
    restoreActive = await guards.restoreLockHeld()
  } catch (err: unknown) {
    logWarn({ event: 'backup.rotate_skipped_restore_unknown', error: err instanceof Error ? err.message : String(err) })
    return 0
  }
  if (restoreActive) {
    logWarn({ event: 'backup.rotate_skipped_restore_active', reason: 'restore_lock_held' })
    return 0
  }

  const all = await db.select().from(backups).where(eq(backups.status, 'done')).orderBy(desc(backups.stamp))
  const toRemove = selectRotationVictims(all, keepCount)
  if (toRemove.length === 0) return 0
  let deleted = 0
  for (const row of toRemove) {
    if (guards.restoreTargets().has(row.filename)) {
      logWarn({ event: 'backup.rotate_skipped_restore_active', reason: 'restore_target', filename: row.filename })
      continue
    }
    try {
      const filePath = path.resolve(backupsDir(), row.filename)
      await fs.unlink(filePath).catch(() => {})
      await db.delete(backups).where(eq(backups.id, row.id))
      deleted += 1
    } catch (err) {
      logWarn({ event: 'backup.rotate_failed', filename: row.filename, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return deleted
}
