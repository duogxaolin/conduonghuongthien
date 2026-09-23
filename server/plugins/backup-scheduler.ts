import { startBackupScheduler } from '../services/backup-scheduler'

/**
 * Boot scheduler backup tự động. Cùng gate 2 scheduler kia
 * (RETENTION_SCHEDULER / ANALYTICS_SCHEDULER).
 *
 * Mặc định **tắt** (`BACKUP_SCHEDULER=0`) — backup tự động phải bật cố ý, không
 * tự chạy silent. Bật qua env `BACKUP_SCHEDULER=1` hoặc công tắc trong settings
 * (scheduler đọc settings mỗi tick, nên bật trong admin đủ — env chỉ là gate boot).
 */
export default defineNitroPlugin(() => {
  const override = (process.env.BACKUP_SCHEDULER || '').trim().toLowerCase()
  if (['0', 'false', 'off', 'no'].includes(override)) return
  // Mặc định tắt — khác retention/analytics (bật production). Backup nặng + ghi
  // file lớn, chỉ bật khi anh ý thức.
  if (['1', 'true', 'on', 'yes'].includes(override)) {
    startBackupScheduler()
  }
  // Nếu không khai gì → scheduler không boot, chỉ backup thủ công. Scheduler
  // vẫn đọc settings mỗi tick khi đã boot, nên công tắt admin chỉ có hiệu lực
  // nếu env bật.
})
