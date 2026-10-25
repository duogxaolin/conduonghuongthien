/**
 * Danh sách và xoá bản sao lưu cho trang quản trị — một phần của `backup.ts` (tệp đó
 * giờ là barrel, xem đầu tệp).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { eq, desc, sql } from 'drizzle-orm'

import { getDb } from '../utils/db'
import { backups, activityLogs } from '../db/schema'
import { backupsDir } from './backup-names'

/** Liệt kê backup cho trang admin. */
export async function listBackups(page: number, pageSize: number, typeFilter?: string) {
  const db = getDb()
  const where = typeFilter && typeFilter !== 'all' ? eq(backups.type, typeFilter) : undefined
  const [rows, totalRow] = await Promise.all([
    where
      ? db.select().from(backups).where(where).orderBy(desc(backups.id)).limit(pageSize).offset((page - 1) * pageSize)
      : db.select().from(backups).orderBy(desc(backups.id)).limit(pageSize).offset((page - 1) * pageSize),
    where
      ? db.select({ c: sql<number>`COUNT(*)` }).from(backups).where(where)
      : db.select({ c: sql<number>`COUNT(*)` }).from(backups),
  ])
  return { items: rows, total: totalRow[0]?.c ?? 0 }
}

/** Xoá backup bị từ chối: 404 (không có hàng đó), 409 (tên trùng nhiều hàng, cần id). */
export class BackupDeleteError extends Error {
  readonly statusCode: 400 | 404 | 409
  constructor(message: string, statusCode: 400 | 404 | 409) {
    super(message)
    this.name = 'BackupDeleteError'
    this.statusCode = statusCode
  }
}

/**
 * Xoá MỘT hàng backup — theo `rowId` (trang admin gửi kèm) — rồi xoá tệp chỉ khi không
 * còn hàng nào khác trỏ tới cùng tên. Xoá theo tên từng xoá mọi hàng cùng tên và tệp:
 * bấm "xoá" một hàng `failed` trùng tên với một bản `done` là mất luôn bản tốt.
 * Không có `rowId` (giao diện cũ còn trong bộ nhớ đệm): đúng một hàng mang tên đó thì
 * xoá hàng đó; nhiều hàng → 409.
 */
export async function deleteBackup(filename: string, adminUserId: number | null, rowId?: number): Promise<void> {
  const db = getDb()
  const filePath = path.resolve(backupsDir(), filename)
  if (!filePath.startsWith(backupsDir() + path.sep)) throw new BackupDeleteError('Đường dẫn không hợp lệ.', 400)
  const rows = (await db.select({ id: backups.id, filename: backups.filename }).from(backups).where(eq(backups.filename, filename)))
    .filter(row => row.filename === filename)
  const target = rowId !== undefined ? rows.find(row => row.id === rowId) : rows.length === 1 ? rows[0] : undefined
  if (!target) {
    if (rowId === undefined && rows.length > 1) {
      throw new BackupDeleteError('Có nhiều bản ghi cùng tên tệp này — tải lại trang rồi xoá từng bản.', 409)
    }
    throw new BackupDeleteError('Không tìm thấy bản backup này.', 404)
  }
  await db.transaction(async (tx) => {
    await tx.delete(backups).where(eq(backups.id, target.id))
    await tx.insert(activityLogs).values({
      userId: adminUserId, action: 'delete', resource: 'settings', resourceId: null,
      meta: { backup: filename, backupId: target.id },
    })
  })
  // Sau khi hàng đã đi: tệp còn hàng khác trỏ tới thì giữ. Xoá tệp hỏng thì tệp tên-app
  // không còn hàng sẽ được lượt dọn dưới khoá chạy xoá sau (`deleteStaleFiles`,
  // `backup-sweep.ts`).
  if (rows.every(row => row.id === target.id)) await fs.unlink(filePath).catch(() => {})
}
