import { scheduleStartupBackupSweep, startBackupScheduler, stopBackupScheduler } from '../services/backup-scheduler'
import { backupSchedulerEnabledByServer } from '../utils/backup-scheduler-switch'

/**
 * Boot scheduler backup tự động. Cùng mặc định với RETENTION_SCHEDULER /
 * ANALYTICS_SCHEDULER: production bật, môi trường khác tắt; `BACKUP_SCHEDULER`
 * `0`/`false`/`off`/`no` tắt, `1`/`true`/`on`/`yes` bật.
 *
 * Bật scheduler KHÔNG có nghĩa là có bản sao lưu: mỗi tick đọc công tắc admin
 * `backup_auto_enabled` (mặc định tắt) — đó là lựa chọn có ý thức. Bản cũ chỉ boot
 * khi `BACKUP_SCHEDULER=1`, nên ở production công tắc admin bật mà không bao giờ
 * có bản sao lưu nào. Trang cài đặt báo khi máy chủ tắt scheduler
 * (`schedulerDisabledByServer`, cùng hàm `backupSchedulerEnabledByServer`).
 */
export default defineNitroPlugin((nitroApp) => {
  // Lúc tắt (docker stop → SIGTERM → Nitro chạy hook `close` trong thời gian ân hạn
  // `stop_grace_period`): dừng scheduler để không một lượt sao lưu theo lịch nào bắt
  // đầu khi tiến trình đang thoát. Đăng ký trước mọi nhánh return — gọi khi chưa
  // từng start là no-op.
  nitroApp.hooks.hook('close', stopBackupScheduler)

  // Máy chủ tắt scheduler (dev, E2E, `BACKUP_SCHEDULER=0`) → không đụng gì vào thư
  // mục backup lúc khởi động. E2E/dev chạy với cwd = bản checkout và CSDL mới (bảng
  // `backups` rỗng): lượt dọn lúc khởi động sẽ coi mọi bản sao lưu cục bộ là mồ côi.
  if (!backupSchedulerEnabledByServer(process.env.BACKUP_SCHEDULER, process.env.NODE_ENV)) return

  // Rác của một lượt sao lưu bị giết (SIGKILL, hết thời gian ân hạn): `.partial` và
  // tệp tên-app không có hàng — dọn một lần sau khi khởi động, dưới khoá chạy. Lượt
  // sao lưu nào cũng tự dọn ở đầu lượt (`runBackup`), kể cả khi scheduler tắt.
  scheduleStartupBackupSweep()
  startBackupScheduler()
})
