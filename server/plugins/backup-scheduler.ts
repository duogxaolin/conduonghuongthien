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

  // Rác của một lượt sao lưu bị giết (SIGKILL, hết thời gian ân hạn): `.partial` và
  // tệp tên-app không có hàng — dọn một lần sau khi khởi động, dưới khoá chạy. Không
  // phụ thuộc công tắc scheduler: lượt sao lưu tay cũng có thể bị cắt ngang.
  scheduleStartupBackupSweep()

  if (!backupSchedulerEnabledByServer(process.env.BACKUP_SCHEDULER, process.env.NODE_ENV)) return
  startBackupScheduler()
})
