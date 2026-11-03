/**
 * Ghi một hàng vào sổ `backups` — MỘT nơi cho mọi lối ghi: đăng ký một lượt sao lưu
 * (kể cả bản `pre-restore` của lượt khôi phục), hàng `failed`, và gắn lại danh sách
 * sau khôi phục (thành công lẫn thất bại).
 *
 * Vì sao cần: một lượt khôi phục CSDL hỏng giữa chừng có thể để `backups` ở hình dạng
 * CŨ hơn `schema.ts` (dump của bản trước, mà bước cấu trúc chưa chạy tới), trong khi
 * Drizzle luôn nêu MỌI cột khai trong `schema.ts`. Trước bản vá, đúng lúc đó — khi
 * thông báo lỗi bảo "khôi phục lại bản an toàn" — chính bản sao lưu an toàn của lượt
 * khôi phục mới không đăng ký được (`Unknown column 'offsite_status'`): đường lui chết.
 *
 * `insertBackupRow`: thử câu Drizzle thường; bảng thiếu cột (`ER_BAD_FIELD_ERROR`) →
 * ghi lại chỉ với những cột bảng thật đang có. Tên cột lấy từ `schema.ts` (không bao
 * giờ từ dữ liệu); giá trị mã hoá bằng chính bộ chuyển của cột Drizzle (`sql.param`),
 * nên ngày giờ ghi y như câu Drizzle thường — `pool.query` trần với `Date` lệch 7 giờ.
 */
import { getTableColumns, sql } from 'drizzle-orm'

import { backups } from '../db/schema'
import type { getDb } from '../utils/db'
import { logWarn } from '../utils/logger'

type BackupInsert = typeof backups.$inferInsert

/** `db` hoặc `tx` của Drizzle — chỉ cần hai phương thức này. */
export type BackupRegistryExecutor = Pick<ReturnType<typeof getDb>, 'insert' | 'execute'>

/** Lỗi "bảng không có cột này" — Drizzle bọc lỗi mysql2 trong `cause`. */
export function isUnknownColumnError(err: unknown): boolean {
  let current: unknown = err
  for (let depth = 0; current && depth < 4; depth += 1) {
    if ((current as { code?: unknown }).code === 'ER_BAD_FIELD_ERROR') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/** Tên các cột `backups` đang có thật trong CSDL đang nối. */
export async function liveBackupColumns(executor: Pick<BackupRegistryExecutor, 'execute'>): Promise<Set<string>> {
  const result: unknown = await executor.execute(
    sql`SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'backups'`,
  )
  // Kiểu của `execute` (mysql2) luôn khai `ResultSetHeader`; câu SELECT trả mảng hàng —
  // thu hẹp bằng kiểm thật, không ép kiểu (cùng cách `readRows` ở media-sync-rewrite.ts).
  const rows: unknown = Array.isArray(result) ? result[0] : result
  const names = new Set<string>()
  if (!Array.isArray(rows)) return names
  for (const row of rows) {
    if (row && typeof row === 'object' && 'name' in row && typeof row.name === 'string') names.add(row.name)
  }
  return names
}

/**
 * Ghi một hàng chỉ với những cột bảng thật đang có. Trả tên các cột đã bỏ qua (có giá
 * trị nhưng bảng chưa có). Bảng không dùng được (không có `filename`) → ném.
 */
export async function insertBackupRowAdaptive(executor: BackupRegistryExecutor, values: BackupInsert): Promise<string[]> {
  const present = await liveBackupColumns(executor)
  if (!present.has('filename')) throw new Error('Bảng `backups` không dùng được (thiếu cột filename).')
  const given = Object.entries(getTableColumns(backups))
    .filter(([key]) => values[key as keyof BackupInsert] !== undefined)
  const kept = given.filter(([, column]) => present.has(column.name))
  await executor.execute(sql`INSERT INTO ${backups} (${sql.join(kept.map(([, column]) => sql.identifier(column.name)), sql`, `)}) VALUES (${sql.join(kept.map(([key, column]) => sql.param(values[key as keyof BackupInsert], column)), sql`, `)})`)
  return given.filter(([, column]) => !present.has(column.name)).map(([, column]) => column.name)
}

/** Ghi một hàng vào sổ: câu Drizzle thường, bảng hình dạng cũ → chỉ các cột đang có. */
export async function insertBackupRow(executor: BackupRegistryExecutor, values: BackupInsert): Promise<void> {
  try {
    await executor.insert(backups).values(values)
  } catch (err: unknown) {
    if (!isUnknownColumnError(err)) throw err
    const dropped = await insertBackupRowAdaptive(executor, values)
    logWarn({ event: 'backup.registry_old_shape', filename: values.filename, droppedColumns: dropped })
  }
}
