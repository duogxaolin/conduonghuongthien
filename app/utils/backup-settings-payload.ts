/**
 * Thân `PUT /api/admin/settings/backup` mà khối "Cài đặt backup" gửi lên.
 *
 * Máy chủ (`server/api/admin/settings/backup.put.ts`, `SUPERADMIN_ONLY_KEYS`) chỉ
 * cho SuperAdmin ĐỔI bốn khoá dưới đây — đích của bản sao (Google Drive) và số bản
 * bị xoay vòng xoá. Người khác gửi giá trị khác giá trị đang lưu → 403 cho CẢ lượt
 * lưu, kể cả phần lịch họ được phép đổi.
 *
 * Vì vậy với người không phải SuperAdmin, trang KHÔNG GỬI bốn khoá đó (máy chủ bỏ
 * qua khoá vắng mặt), thay vì gửi lại giá trị đang hiển thị và trông vào việc máy
 * chủ thấy "không đổi": một lượt tải cài đặt hỏng để lại giá trị mặc định trong
 * biểu mẫu, và gửi mặc định đó là 403 (hoặc, với SuperAdmin, là ghi đè cấu hình
 * thật — xem `settingsLoadError` trong `useBackupSettings`).
 *
 * `tests/backup-settings-ui.test.ts` chạy thân này qua handler thật để giữ danh
 * sách khoá khớp với máy chủ.
 */
export const BACKUP_SUPERADMIN_ONLY_KEYS = [
  'backup_keep_count',
  'backup_drive_enabled',
  'backup_drive_service_account',
  'backup_drive_folder_id',
] as const

export interface BackupSettingsForm {
  backup_auto_enabled: string
  backup_auto_hour: string
  backup_auto_days: string
  backup_keep_count: string
  backup_drive_enabled: string
  backup_drive_service_account: string
  backup_drive_folder_id: string
}

export function backupSettingsPayload(form: BackupSettingsForm, selectedDays: readonly number[], isSuperAdmin: boolean): Record<string, string> {
  const payload: Record<string, string> = { ...form, backup_auto_days: JSON.stringify(selectedDays) }
  if (!isSuperAdmin) {
    for (const key of BACKUP_SUPERADMIN_ONLY_KEYS) delete payload[key]
  }
  return payload
}
