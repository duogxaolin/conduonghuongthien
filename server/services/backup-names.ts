/**
 * Tên và chỗ của tệp sao lưu trong app — một phần của `backup.ts` (tệp đó giờ là
 * barrel, xem đầu tệp). Lượt chạy (`backup-run.ts`), xoay vòng (`backup-rotation.ts`),
 * lượt dọn (`backup-sweep.ts`) và trang quản trị (`backup-catalog.ts`) phải hiểu tên
 * tệp giống hệt nhau, nên mọi quy tắc tên nằm ở đây: giá trị `trigger`, mã thời điểm,
 * thư mục sao lưu, hậu tố `.partial`, họ của một tệp, và bản `pre-restore`.
 *
 * Tệp lá: không import gì khác trong nhóm sao lưu ngoài `backup-restore-guards.ts`
 * (phần thuần, không import ngược lại).
 */
import path from 'node:path'

import { backupKindOf, expectedArchiveTop } from './backup-restore-guards'

/**
 * Mọi giá trị ghi vào `backups.trigger` (và vào tên file). Cột là VARCHAR(32):
 * `pre-fix-thumbnails` (18 ký tự) từng vượt VARCHAR(16) cũ → dưới strict
 * sql_mode lượt sao lưu trước khi sửa thumbnail chết với ER_DATA_TOO_LONG, không
 * ghi hàng nào. `tests/backup-trigger-length.test.ts` so độ dài từng giá trị với
 * cột trong `schema.ts`; thêm trigger dài hơn thì nới cột trước.
 */
export const BACKUP_TRIGGERS = [
  'manual', 'scheduled', 'pre-sync', 'pre-repoint', 'pre-repair-urls', 'pre-self-heal', 'pre-fix-thumbnails', 'pre-restore',
] as const
export type BackupTrigger = typeof BACKUP_TRIGGERS[number]

export function timestampStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

/**
 * Thư mục backup của app — NƠI DUY NHẤT dựng đường dẫn này (tải về, khôi phục, khôi
 * phục từ tệp tải lên, xoay vòng, lượt dọn, xoá đều gọi hàm này;
 * tests/backup-dir-isolation.test.ts chặn chỗ tự dựng `…/backups`).
 *
 * `CDKT_BACKUPS_DIR` — CHỈ cho test/dev: E2E và `nuxt dev` chạy với cwd = bản checkout
 * và một CSDL mới tinh (bảng `backups` rỗng), nên mọi bản sao lưu cục bộ trong
 * `./backups` trông như tệp mồ côi và bị lượt dọn xoá. Production không đặt biến này
 * (không có trong compose): mặc định `<cwd>/backups` = `/app/backups` trong container.
 */
export function backupsDir(): string {
  const configured = (process.env.CDKT_BACKUPS_DIR || '').trim()
  return configured ? path.resolve(configured) : path.resolve(process.cwd(), 'backups')
}

/**
 * Hậu tố của tệp đang ghi. Dump/archive ghi dưới `<tên>.partial` và chỉ đổi sang tên
 * thật cùng lúc với hàng `done` (trong transaction), nên một lượt bị giết giữa chừng
 * (SIGKILL, hết `stop_grace_period`) chỉ để lại tệp `.partial` — dọn được an toàn.
 */
export const PARTIAL_SUFFIX = '.partial'
/**
 * Chỉ tệp `.partial` mang ĐÚNG tên mà `runBackup` ghi:
 * `cdkt-<stamp>-<trigger>.sql.gz.partial` và
 * `cdkt-(uploads|media)-<stamp>-<trigger>.tar.gz.partial`, `trigger` thuộc
 * `BACKUP_TRIGGERS`. Khoá chạy chỉ nói rằng không lượt sao lưu TRONG APP nào đang
 * ghi; `scripts/backup-db.sh` (cron hằng đêm qua `backup.sh`) ghi vào cùng `./backups`
 * dưới tên `cdkt-<db>-<stamp>-<pid>.sql.gz.partial` rồi mới đổi tên — tệp đó có thể
 * là một bản dump ĐANG chạy, nên mẫu không bao giờ khớp nó (`<db>`/`<pid>` không phải
 * dạng của app). Cũng không đụng `.upload-*.partial` (khôi phục từ tệp tải lên — giữ
 * khoá khôi phục, không phải khoá chạy) hay tệp đã đăng ký (không có hậu tố này).
 */
const APP_TRIGGERS = BACKUP_TRIGGERS.map(trigger => trigger.replace(/[^a-z0-9-]/g, '')).join('|')
/** Đúng tên cuối cùng mà `runBackup` đặt (dump hoặc archive), không hơn. */
const APP_BACKUP_NAME = `cdkt-(?:\\d{8}T\\d{6}Z-(?:${APP_TRIGGERS})\\.sql\\.gz|(?:uploads|media)-\\d{8}T\\d{6}Z-(?:${APP_TRIGGERS})\\.tar\\.gz)`
export const STALE_PARTIAL = new RegExp(`^${APP_BACKUP_NAME}\\.partial$`)
export const APP_FINAL = new RegExp(`^${APP_BACKUP_NAME}$`)

/** Mã thời điểm trong tên tệp của app (`…-YYYYMMDDTHHMMSSZ-…`) — so được theo chữ. */
export function stampInName(name: string): string | null {
  return /-(\d{8}T\d{6}Z)-/.exec(name)?.[1] ?? null
}

/** Họ file của một backup: SQL, archive `uploads/` hay archive `media/` (cùng quy tắc tên với `runBackup`). */
export function backupFamilyOf(filename: string): 'sql' | 'uploads' | 'media' | null {
  const kind = backupKindOf(filename)
  if (kind === 'sql') return 'sql'
  if (kind === 'media') return expectedArchiveTop(filename)
  return null
}

/** Bản an toàn trước khi khôi phục — không bao giờ bị xoay vòng xoá (chỉ xoá tay). */
export function isPreRestoreBackup(row: { filename: string, trigger?: string | null }): boolean {
  return row.trigger === 'pre-restore' || /-pre-restore\.(sql|tar)\.gz$/.test(row.filename)
}
