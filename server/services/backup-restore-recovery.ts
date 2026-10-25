/**
 * Phần "giữ trạng thái của hệ thống đang chạy" của một lượt khôi phục CSDL — tách khỏi
 * `backup-restore.ts` (đã quá 400 dòng) theo đường nối tự nhiên: luồng khôi phục ở đó
 * gọi các hàm dưới đây ở đúng ba điểm.
 *  - TRƯỚC bản sao lưu an toàn: `assertOneDatabase`, `convergeBackupsRegistry`.
 *  - SAU dump, trên MỌI lối (thành công, dump chết giữa chừng, bước cấu trúc hỏng):
 *    `convergeSchemaAfterRestore` (bước cấu trúc lúc khởi động) RỒI
 *    `sealRestoredCredentials` (mã hoá bí mật nguyên văn bản dump mang về — 2A).
 *  - Gắn lại sổ `backups` (+ trạng thái scheduler): lối thành công trong transaction
 *    audit (`reattachBackupRows`), lối thất bại ở `restoreLiveStateAfterFailedRestore`.
 *
 * Vì sao cả khối này tồn tại: dump của app mang `DROP TABLE` + `CREATE TABLE`, nên khôi
 * phục THAY cả sổ sao lưu (và hàng `backup_scheduler_state`) bằng bản trong dump — có
 * thể ở hình dạng cũ hơn `schema.ts`. Thiếu các bước này: khôi phục báo hỏng dù dữ liệu
 * đã thay, sổ thiếu bản `pre-restore` và các bản mới hơn, lượt dọn xoá chúng, và lời
 * khuyên "khôi phục bản an toàn" thành ngõ cụt. → docs/CHANGELOG.md § 36, § 38.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { inArray } from 'drizzle-orm'
import type { RowDataPacket } from 'mysql2/promise'

import { getDb } from '../utils/db'
import { convertPlaintextSettingsSecrets } from '../db/settings-secret-conversion'
import { backups, users } from '../db/schema'
import { logError, logInfo, logWarn } from '../utils/logger'
import { backupsDir } from './backup'
import { createBackupConnection } from './backup-sql'
import { insertBackupRow } from './backup-registry'
import { keepSchedulerStateAcrossRestore } from './backup-scheduler'
import { BackupRestoreError } from './backup-restore-guards'
import type { RestoreActor } from './backup-restore'

const messageOf = (err: unknown) => err instanceof Error ? err.message : String(err)

export type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]
export type BackupRow = typeof backups.$inferSelect

/**
 * `activity_logs.user_id` và `backups.created_by` là khoá ngoại vào `users`.
 * Sau khi khôi phục một dump cũ, tài khoản đang thao tác có thể không còn trong
 * bảng `users` — ghi `null` thay vì làm hỏng cả transaction audit; tên và id
 * người thao tác vẫn nằm trong `meta`.
 */
export async function existingUserIds(tx: Tx, ids: Array<number | null | undefined>): Promise<Set<number>> {
  const wanted = [...new Set(ids.filter((id): id is number => typeof id === 'number'))]
  if (wanted.length === 0) return new Set()
  const rows = await tx.select({ id: users.id }).from(users).where(inArray(users.id, wanted))
  return new Set(rows.map(row => row.id))
}

/**
 * Dump vừa chạy đã thay bảng `backups` bằng bản trong file, nên hàng của bản
 * `pre-restore` (và của file vừa tải lên, và mọi bản tạo sau thời điểm dump)
 * biến mất dù file vẫn nằm trên đĩa. Thêm lại các hàng `done` có file còn trên
 * đĩa mà bảng sau khôi phục chưa có — danh sách khớp với thư mục backups.
 * `bestEffort`: lỗi một hàng chỉ được log (lối thất bại), không ném.
 */
export async function reattachBackupRows(tx: Tx, before: BackupRow[], bestEffort = false): Promise<string[]> {
  if (before.length === 0) return []
  // Chỉ chọn `filename`: đọc được cả bảng hình dạng cũ.
  const present = new Set((await tx.select({ filename: backups.filename }).from(backups)).map(row => row.filename))
  const missing = await rowsToReattach(before, present)
  if (missing.length === 0) return []
  const known = await existingUserIds(tx, missing.map(row => row.createdBy))
  const reattached: string[] = []
  for (const row of missing) {
    try {
      // `insertBackupRow`: bảng hình dạng cũ → chỉ các cột đang có, giá trị qua bộ chuyển của Drizzle.
      await insertBackupRow(tx, {
        filename: row.filename, type: row.type, bytes: row.bytes, stamp: row.stamp, trigger: row.trigger,
        status: row.status, driveUploaded: row.driveUploaded, driveFileId: row.driveFileId, offsiteStatus: row.offsiteStatus, error: row.error,
        createdBy: row.createdBy !== null && known.has(row.createdBy) ? row.createdBy : null,
        createdAt: row.createdAt ?? undefined,
      })
      reattached.push(row.filename)
    } catch (err: unknown) {
      if (!bestEffort) throw err
      logError({ event: 'backup.restore_failed_row_not_reattached', filename: row.filename, error: messageOf(err) })
    }
  }
  return reattached
}

/** Hàng `done` của hệ thống đang chạy mà bảng sau khôi phục chưa có, và tệp còn trên đĩa. */
async function rowsToReattach(before: BackupRow[], present: ReadonlySet<string>): Promise<BackupRow[]> {
  const missing: BackupRow[] = []
  for (const row of before) {
    if (row.status !== 'done' || present.has(row.filename)) continue
    try { await fs.stat(path.resolve(backupsDir(), row.filename)) } catch { continue }
    missing.push(row)
  }
  return missing
}

/**
 * Lối THẤT BẠI của một lượt khôi phục CSDL mà dump đã chạy (chết giữa chừng, bước cấu
 * trúc hỏng, transaction audit hỏng): đặt lại danh sách backup của hệ thống đang chạy —
 * gồm bản `pre-restore` vừa tạo, là đường lui DUY NHẤT. Trước bản vá, các lối này ném
 * trước chỗ gắn lại duy nhất (trong transaction audit của lối thành công), để lại
 * `backups` như dump ghi; lượt dọn kế tiếp (mỗi `runBackup`, và 1 phút sau khởi động)
 * xoá bản `pre-restore` và các bản mới hơn như "mồ côi".
 *
 * Được tới đâu hay tới đó, không bao giờ ném (lỗi gốc của lượt khôi phục mới là thứ
 * được báo). Thứ tự: đưa riêng `backups` về hình dạng hiện tại trước
 * (`convergeBackupsRegistry`); rồi gắn lại từng hàng qua `insertBackupRow` — vẫn ghi
 * được nếu bảng còn hình dạng CŨ (chỉ các cột đang có, giá trị qua bộ chuyển của cột
 * Drizzle); rồi đặt lại trạng thái scheduler sao lưu của hệ thống đang chạy (dump cũng
 * đã thay hàng `backup_scheduler_state`).
 */
export async function restoreLiveStateAfterFailedRestore(
  before: BackupRow[], schedulerStateBefore: string | null | undefined, filename: string, actor: RestoreActor,
): Promise<void> {
  const db = getDb()
  await convergeBackupsRegistry(filename, actor)
  if (before.length > 0) {
    try {
      // Thân khối viết có ngoặc: `tests/transaction-tdz.test.ts` tìm thân bằng `{` đầu tiên
      // sau `transaction(` — với arrow một biểu thức nó đọc nhầm sang dòng log bên dưới.
      const reattached = await db.transaction(async (tx) => {
        return reattachBackupRows(tx, before, true)
      })
      logWarn({ event: 'backup.restore_failed_rows_reattached', filename, userId: actor.id, reattached })
    } catch (err: unknown) {
      logError({ event: 'backup.restore_failed_rows_not_reattached', filename, userId: actor.id, error: messageOf(err) })
    }
  }
  if (schedulerStateBefore !== undefined) {
    try {
      await db.transaction(tx => keepSchedulerStateAcrossRestore(tx, schedulerStateBefore))
    } catch (err: unknown) {
      logError({ event: 'backup.restore_failed_scheduler_state_unwritten', filename, userId: actor.id, error: messageOf(err) })
    }
  }
}

/**
 * Đưa RIÊNG bảng `backups` về hình dạng hiện tại (`convergeBackupsTable` — cùng bước
 * lúc khởi động), trên cùng CSDL với `restoreSql`. Gọi ở đầu mỗi lượt khôi phục CSDL
 * (để làm theo lời khuyên "khôi phục bản an toàn" sau một lượt hỏng luôn chạy được) và
 * ở lối thất bại (để danh sách, lượt sao lưu kế dùng được ngay). Không bao giờ ném.
 */
export async function convergeBackupsRegistry(filename: string, actor: RestoreActor): Promise<boolean> {
  try {
    const { convergeBackupsTable } = await import('../db/migrations-additive')
    const conn = await createBackupConnection()
    try {
      const [rows] = await conn.query<RowDataPacket[]>('SELECT DATABASE() AS name')
      await convergeBackupsTable(conn, String(rows[0]?.name ?? ''))
    } finally {
      await conn.end().catch(() => {})
    }
    return true
  } catch (err: unknown) {
    logError({ event: 'backup.restore_registry_shape_failed', filename, userId: actor.id, error: messageOf(err) })
    return false
  }
}

/**
 * `initDb` nối theo `DB_NAME` (trống → `cdkt_admin`), còn `restoreSql`
 * (`createBackupConnection`) theo `DB_NAME`, trống thì `MYSQL_DATABASE`. Trong container
 * compose luôn đặt `DB_NAME` (= `MYSQL_DATABASE`) nên hai bên trùng; ở nơi khác mà hai
 * tên lệch thì từ chối TRƯỚC bản sao lưu an toàn và dump — chạy bước cấu trúc trên một
 * CSDL KHÁC là tệ hơn không khôi phục.
 */
export function assertOneDatabase(): void {
  const restoredInto = process.env.DB_NAME || process.env.MYSQL_DATABASE || 'cdkt_admin'
  const initDbTarget = process.env.DB_NAME || 'cdkt_admin'
  if (restoredInto !== initDbTarget) {
    throw new BackupRestoreError(
      `Cấu hình CSDL không nhất quán: DB_NAME trống mà MYSQL_DATABASE=${restoredInto} — bước cấu trúc sau khôi phục sẽ chạy trên ${initDbTarget}. Đặt DB_NAME rồi thử lại.`,
      500,
      'db_name_mismatch',
    )
  }
}

/**
 * Đưa cấu trúc CSDL về phiên bản hiện tại ngay sau khi chạy một bản dump — đúng các
 * bước lúc khởi động (`initDb`: `CREATE TABLE IF NOT EXISTS` theo thứ tự FK +
 * `applyAdditiveMigrations`), không chép lại DDL nào.
 *
 * Vì sao: dump của app mang `DROP TABLE` + `CREATE TABLE`, nên khôi phục một bản lấy
 * TRƯỚC khi có một cột mới (wave2: `backups.offsite_status`; các đợt khác cũng thêm
 * cột) trả bảng về hình dạng cũ, trong khi Drizzle luôn nêu mọi cột của `schema.ts`.
 * Trước bản này, lượt gắn lại hàng `backups` trong transaction audit chết với
 * `Unknown column` → khôi phục báo "thất bại" dù dữ liệu ĐÃ bị thay, `backups` rỗng,
 * và lượt dọn kế tiếp xoá bản `pre-restore` cùng các bản mới hơn như "mồ côi"; danh
 * sách và lượt sao lưu kế cũng hỏng tới khi khởi động lại.
 *
 * Chạy lại an toàn (cùng tính idempotent của lúc khởi động). Chỉ THÊM — một cột đã bỏ
 * khỏi `schema.ts` mà dump cũ còn mang (NOT NULL, không mặc định) không được gỡ ở đây,
 * như lúc khởi động.
 *
 * Cùng CSDL với `restoreSql`: kiểm ở `assertOneDatabase`, trước bản sao lưu an toàn.
 */
export async function convergeSchemaAfterRestore(filename: string, actor: RestoreActor): Promise<void> {
  const startedAt = Date.now()
  try {
    // Nạp động: toàn bộ DDL + di trú chỉ vào bộ nhớ khi thật sự khôi phục CSDL, và
    // module khôi phục không kéo `migrations-additive` theo mọi nơi import nó.
    const { initDb } = await import('../db/init')
    await initDb()
  } catch (err: unknown) {
    logError({ event: 'backup.restore_schema_convergence_failed', filename, userId: actor.id, error: messageOf(err) })
    throw err
  }
  logInfo({ event: 'backup.restore_schema_converged', filename, userId: actor.id, ms: Date.now() - startedAt })
}

/**
 * Mã hoá `smtp_pass` / `r2_secret_key` / `backup_drive_service_account` còn nguyên văn
 * sau một lượt khôi phục CSDL (wave2 2A, spec settings-secret-storage, kiểm chứng W3/W4):
 * bản dump trước 2A mang chúng NGUYÊN VĂN về `settings`. Gọi trên MỌI lối mà dump đã
 * chạy, ngay SAU `convergeSchemaAfterRestore` — kể cả khi bước đó hỏng (nó dừng ở bước
 * khởi động hỏng, trước lượt chuyển của chính nó) — và TRƯỚC gắn lại/audit (có thể ném).
 * Không đợi lần khởi động sau. Khi bước cấu trúc chạy trọn thì `initDb` đã chuyển rồi và
 * lượt này không ghi gì (lượt chuyển idempotent).
 *
 * Không bao giờ ném: hỏng chỉ log, kết quả khôi phục giữ nguyên nghĩa của nó (lần khởi
 * động sau vẫn chuyển).
 */
export async function sealRestoredCredentials(
  pool: Parameters<typeof convertPlaintextSettingsSecrets>[0], filename: string, actor: RestoreActor,
): Promise<void> {
  try {
    const report = await convertPlaintextSettingsSecrets(pool)
    if (report.converted.length) {
      logInfo({ event: 'backup.restore_secrets_encrypted', userId: actor.id, filename, keys: report.converted })
    }
    if (report.needsReentry.length || report.skippedNoKey.length) {
      logWarn({ event: 'backup.restore_secrets_not_converted', userId: actor.id, filename, needsReentry: report.needsReentry, skippedNoKey: report.skippedNoKey })
    }
  } catch (err: unknown) {
    logWarn({ event: 'backup.restore_secret_conversion_failed', userId: actor.id, filename, error: messageOf(err) })
  }
}
