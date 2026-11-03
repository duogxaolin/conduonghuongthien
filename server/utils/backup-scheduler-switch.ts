/**
 * Công tắc phía máy chủ của scheduler sao lưu — MỘT luật cho plugin khởi động
 * (`server/plugins/backup-scheduler.ts`) và cho trang cài đặt
 * (`GET /api/admin/settings/backup` → `schedulerDisabledByServer`), để trang không
 * bao giờ nói khác với điều máy chủ thật sự làm.
 *
 * `BACKUP_SCHEDULER`: `0`/`false`/`off`/`no` → tắt; `1`/`true`/`on`/`yes` → bật;
 * trống → bật ở production, tắt ở môi trường khác (cùng mặc định với
 * `RETENTION_SCHEDULER`/`ANALYTICS_SCHEDULER`). Scheduler chạy KHÔNG có nghĩa là
 * có bản sao lưu: công tắc "Backup tự động theo lịch" trong admin (mặc định tắt)
 * mới quyết định.
 *
 * Tệp không import gì: route admin nạp nó mà không kéo theo `services/backup.ts`.
 */
export function backupSchedulerEnabledByServer(override: string | undefined, nodeEnv: string | undefined): boolean {
  const value = (override || '').trim().toLowerCase()
  if (['0', 'false', 'off', 'no'].includes(value)) return false
  if (['1', 'true', 'on', 'yes'].includes(value)) return true
  return nodeEnv === 'production'
}
