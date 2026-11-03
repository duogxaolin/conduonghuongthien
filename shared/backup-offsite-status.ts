/**
 * Trạng thái "bản sao ngoài máy chủ" (off-site) của một tệp sao lưu — cột
 * `backups.offsite_status` — và quy tắc DUY NHẤT trả lời "đã cấu hình nơi lưu ngoài
 * máy chủ chưa". Máy chủ (`server/services/backup-offsite.ts`, lúc chạy sao lưu) và
 * trang quản trị (cảnh báo "bản sao lưu chỉ nằm trên máy chủ") cùng gọi hàm này, nên
 * trang không thể nói "đã có Drive" trong khi lượt chạy coi là "chưa cấu hình".
 *
 *   - `uploaded` — tệp NÀY đã lên Google Drive.
 *   - `failed`   — đã cấu hình Drive nên phải có bản ngoài, nhưng tệp này không có
 *                  (upload hỏng, liên kết/khoá không giải mã được, hoặc lượt sao lưu
 *                  chết trước bước Drive).
 *   - `none`     — chưa cấu hình nơi lưu ngoài máy chủ.
 *   - NULL       — hàng của lượt hỏng (không có tệp), hoặc hàng có từ trước khi có
 *                  cột (không suy ngược từ `drive_uploaded` — không ghi gì lúc khởi động).
 */
export const OFFSITE_STATUSES = ['uploaded', 'failed', 'none'] as const
export type OffsiteStatus = typeof OFFSITE_STATUSES[number]

export interface OffsiteDestinationInput {
  /** Công tắc "Upload lên Google Drive" (`backup_drive_enabled`). */
  driveEnabled: boolean
  /**
   * Đã có liên kết OAuth — KỂ CẢ liên kết có token không giải mã được: đó là cấu hình
   * hỏng (từng tệp sẽ `failed`), không phải "chưa cấu hình".
   */
  oauthLinked: boolean
  /** Đã lưu khoá service account (hoặc dấu che của nó). */
  serviceAccountConfigured: boolean
}

/** Có nơi lưu ngoài máy chủ ĐƯỢC CẤU HÌNH: Drive bật VÀ (liên kết OAuth HOẶC service account). */
export function offsiteDestinationConfigured(input: OffsiteDestinationInput): boolean {
  return input.driveEnabled && (input.oauthLinked || input.serviceAccountConfigured)
}

// ─── Hiển thị ở /admin/settings/backup ───────────────────────────────────────
// Ở đây (không ở app/utils) vì hai lẽ: quy tắc trên phải là MỘT bản cho máy chủ và
// trang; và app/ import `shared/` qua `~~/shared/…` (Nuxt để shared/ external ở bản
// SSR — import tương đối từ app/ in ra đường hỏng, Nitro build đỏ). Cùng tiền lệ
// `shared/submission-status.ts`: nhãn + lớp huy hiệu ở shared/, Tailwind quét shared/**.

export type DriveLinkStatus = 'linked' | 'secret_unreadable' | 'not_linked'

export interface BackupOffsiteForm {
  backup_auto_enabled: string
  backup_drive_enabled: string
  backup_drive_service_account: string
}

/**
 * Cảnh báo "bản sao lưu chỉ nằm trên máy chủ": backup tự động bật mà chưa có nơi lưu
 * ngoài máy chủ. `linkStatus` null = chưa tải được trạng thái liên kết — khi chỉ còn
 * liên kết OAuth quyết định được thì KHÔNG khẳng định (Drive tắt thì vẫn khẳng định
 * được, liên kết gì cũng vậy).
 */
export function isBackupLocalOnly(form: BackupOffsiteForm, linkStatus: DriveLinkStatus | null): boolean {
  if (form.backup_auto_enabled !== 'true') return false
  const driveEnabled = form.backup_drive_enabled === 'true'
  const serviceAccountConfigured = form.backup_drive_service_account.trim() !== ''
  if (driveEnabled && !serviceAccountConfigured && linkStatus === null) return false
  return !offsiteDestinationConfigured({
    driveEnabled,
    oauthLinked: linkStatus === 'linked' || linkStatus === 'secret_unreadable',
    serviceAccountConfigured,
  })
}

export interface OffsiteStatusDisplay {
  label: string
  icon: string
  className: string
}

const OFFSITE_STATUS_DISPLAY: Record<OffsiteStatus, OffsiteStatusDisplay> = {
  uploaded: { label: 'Đã lên Drive', icon: 'fa-solid fa-circle-check', className: 'border-[#cce5cd] bg-[#eef7ee] text-[#1e4620]' },
  failed: { label: 'Lỗi tải lên Drive', icon: 'fa-solid fa-triangle-exclamation', className: 'border-[#f3c2bf] bg-[#ffebe9] text-[#a32924]' },
  none: { label: 'Chỉ trên máy chủ', icon: 'fa-solid fa-server', className: 'border-[#e2ece3] bg-[#f4f7f4] text-[#4a5a4c]' },
}

/**
 * Nhãn của một hàng trong danh sách backup; `null` cho bản sao lưu không thành công
 * (không có tệp để nói). Hàng có từ trước cột (NULL) lùi về `driveUploaded`: không lên
 * Drive thì tệp đó thật sự chỉ nằm trên máy chủ, dù lý do là gì.
 */
export function offsiteStatusDisplay(item: { status: string, offsiteStatus: string | null, driveUploaded: boolean | null }): OffsiteStatusDisplay | null {
  if (item.status !== 'done') return null
  const status = item.offsiteStatus
  if (status === 'uploaded' || status === 'failed' || status === 'none') return OFFSITE_STATUS_DISPLAY[status]
  return OFFSITE_STATUS_DISPLAY[item.driveUploaded ? 'uploaded' : 'none']
}
