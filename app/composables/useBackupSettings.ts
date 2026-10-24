/**
 * Trạng thái + thao tác của khối "Cài đặt backup" (lịch tự động, Google Drive OAuth,
 * Service Account). Tách nguyên văn từ pages/admin/settings/backup.vue. Composable không
 * nằm trong phạm vi quét `$fetch` của guard error/retry (chỉ pages/admin + components/admin);
 * khối danh sách backup — nơi có nhánh lỗi + nút thử lại — vẫn ở trang cha.
 */
import { isBackupLocalOnly } from '~~/shared/backup-offsite-status'

export function useBackupSettings() {
  const toast = useToast()
  const { confirm } = useConfirm()
  // Đích backup (Drive: service account, thư mục, công tắc, OAuth) và số bản giữ
  // chỉ SuperAdmin được đổi — máy chủ quyết định (403); giao diện không mời bấm
  // những gì sẽ bị từ chối và không gửi các khoá đó (xem `backupSettingsPayload`).
  const { user } = useAdminAuth()
  const isSuperAdmin = computed(() => user.value?.isSuperAdmin === true)

  // ─── Settings ────────────────────────────────────────────────────────────────
  const savingSettings = ref(false)
  // Lượt tải cài đặt hỏng để lại giá trị MẶC ĐỊNH trong biểu mẫu; lưu lúc đó là
  // ghi đè cấu hình thật bằng mặc định. Nên: báo lỗi, khoá nút lưu, cho thử lại.
  const settingsLoaded = ref(false)
  const settingsLoadError = ref('')
  // Máy chủ không chạy scheduler sao lưu → công tắc lịch lưu được nhưng không chạy.
  // Chỉ đọc, không nằm trong biểu mẫu (không bao giờ được PUT lại).
  const schedulerDisabledByServer = ref(false)
  const backupSettings = ref<BackupSettingsForm>({
    backup_auto_enabled: 'false',
    backup_auto_hour: '3',
    backup_auto_days: '[]',
    backup_keep_count: '14',
    backup_drive_enabled: 'false',
    backup_drive_service_account: '',
    backup_drive_folder_id: '',
  })

  // ─── Google Drive OAuth link ────────────────────────────────────────────────
  interface DriveLink {
    linked: boolean
    linkedEmail: string | null
    linkedSub: string | null
    linkedAt: string | null
    status: 'not_linked' | 'linked' | 'secret_unreadable'
  }
  const driveLink = ref<DriveLink | null>(null)
  const driveRedirectUri = ref('')
  const driveLinkLoading = ref(false)
  const disconnecting = ref(false)
  const driveToast = ref('')

  async function loadDriveStatus() {
    driveLinkLoading.value = true
    try {
      const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; link: DriveLink; redirectUri: string }>)(`/api/admin/backup/drive/status`)
      driveLink.value = res.link
      driveRedirectUri.value = res.redirectUri
    } catch (err: unknown) {
      driveToast.value = errorMessage(err, 'Không tải được trạng thái liên kết Drive.')
    } finally {
      driveLinkLoading.value = false
    }
  }

  async function disconnectDrive() {
    const ok = await confirm({
      title: 'Hủy liên kết Google Drive',
      message: 'Hủy liên kết? Backup tiếp theo sẽ dùng Service Account (nếu cấu hình) hoặc không upload Drive.',
      confirmLabel: 'Hủy liên kết',
    })
    if (!ok) return
    disconnecting.value = true
    try {
      await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/backup/drive/disconnect`, { method: 'POST' })
      toast.success('Đã hủy liên kết Google Drive.')
      await loadDriveStatus()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Lỗi hủy liên kết'))
    } finally {
      disconnecting.value = false
    }
  }

  function copyRedirectUri() {
    navigator.clipboard.writeText(driveRedirectUri.value).then(
      () => toast.success('Đã copy Redirect URI.'),
      () => toast.error('Không copy được — copy thủ công.'),
    )
  }

  // ─── Google Drive OAuth config (Client ID/Secret riêng cho Drive) ──────────
  interface DriveConfig {
    clientId: string
    hasClientSecret: boolean
    clientSecretMasked: string | null
    clientSecretStatus: 'not_configured' | 'configured' | 'secret_unreadable'
    isEnabled: boolean
    redirectUri: string
    missing: string[]
    updatedAt: string | null
  }
  const driveConfig = ref<DriveConfig | null>(null)
  const driveConfigLoading = ref(false)
  const savingDriveConfig = ref(false)
  const clearingDriveSecret = ref(false)
  const driveClientId = ref('')
  const driveClientSecret = ref('')
  const driveEnabled = ref(false)

  async function loadDriveConfig() {
    driveConfigLoading.value = true
    try {
      const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; config: DriveConfig }>)(`/api/admin/backup/drive/config`)
      driveConfig.value = res.config
      driveClientId.value = res.config.clientId
      driveEnabled.value = res.config.isEnabled
      driveClientSecret.value = ''
      // Redirect URI từ config endpoint (cùng source với status endpoint).
      if (res.config.redirectUri) driveRedirectUri.value = res.config.redirectUri
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không tải được cấu hình OAuth Drive.'))
    } finally {
      driveConfigLoading.value = false
    }
  }

  async function saveDriveConfig() {
    savingDriveConfig.value = true
    try {
      const body: Record<string, unknown> = {
        clientId: driveClientId.value.trim(),
        isEnabled: driveEnabled.value,
      }
      // Chỉ gửi clientSecret khi cán bộ nhập mới — bỏ trống = giữ cũ.
      if (driveClientSecret.value.trim()) body.clientSecret = driveClientSecret.value.trim()
      const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; config: DriveConfig }>)(`/api/admin/backup/drive/config`, {
        method: 'PUT',
        body,
      })
      driveConfig.value = res.config
      driveClientId.value = res.config.clientId
      driveEnabled.value = res.config.isEnabled
      driveClientSecret.value = ''
      toast.success('Đã lưu cấu hình OAuth Drive.')
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Lỗi lưu cấu hình OAuth Drive.'))
    } finally {
      savingDriveConfig.value = false
    }
  }

  async function clearDriveSecret() {
    const ok = await confirm({
      title: 'Gỡ client secret Drive',
      message: 'Gỡ client secret và tắt OAuth Drive? Cần nhập lại secret để liên kết lại. Client ID được giữ lại.',
      confirmLabel: 'Gỡ secret',
    })
    if (!ok) return
    clearingDriveSecret.value = true
    try {
      const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; config: DriveConfig }>)(`/api/admin/backup/drive/clear-secret`, { method: 'POST' })
      driveConfig.value = res.config
      driveEnabled.value = res.config.isEnabled
      driveClientSecret.value = ''
      toast.success('Đã gỡ client secret Drive.')
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Lỗi gỡ client secret.'))
    } finally {
      clearingDriveSecret.value = false
    }
  }
  const daysOptions = [
    { label: 'CN', value: 0 }, { label: 'T2', value: 1 }, { label: 'T3', value: 2 },
    { label: 'T4', value: 3 }, { label: 'T5', value: 4 }, { label: 'T6', value: 5 }, { label: 'T7', value: 6 },
  ]
  const selectedDays = ref<number[]>([])

  async function loadSettings() {
    settingsLoadError.value = ''
    try {
      const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; settings: Record<string, string | null>; schedulerDisabledByServer?: boolean }>)(`/api/admin/settings/backup`)
      const s = res.settings || {}
      schedulerDisabledByServer.value = res.schedulerDisabledByServer === true
      backupSettings.value = {
        backup_auto_enabled: s.backup_auto_enabled || 'false',
        backup_auto_hour: s.backup_auto_hour || '3',
        backup_auto_days: s.backup_auto_days || '[]',
        backup_keep_count: s.backup_keep_count || '14',
        backup_drive_enabled: s.backup_drive_enabled || 'false',
        backup_drive_service_account: s.backup_drive_service_account || '',
        backup_drive_folder_id: s.backup_drive_folder_id || '',
      }
      try { selectedDays.value = JSON.parse(backupSettings.value.backup_auto_days) } catch { selectedDays.value = [] }
      settingsLoaded.value = true
    } catch (err: unknown) {
      settingsLoadError.value = errorMessage(err, 'Không tải được cấu hình backup.')
    }
  }

  async function saveSettings() {
    // Chưa tải được giá trị thật thì biểu mẫu đang giữ mặc định — không gửi.
    if (!settingsLoaded.value) return
    savingSettings.value = true
    try {
      backupSettings.value.backup_auto_days = JSON.stringify(selectedDays.value)
      const body = backupSettingsPayload(backupSettings.value, selectedDays.value, isSuperAdmin.value)
      await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/settings/backup`, { method: 'PUT', body })
      toast.success('Đã lưu cấu hình backup.')
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Lỗi lưu cấu hình'))
    } finally {
      savingSettings.value = false
    }
  }

  /** Toast feedback từ lượt callback OAuth Drive (đọc query lúc mount). */
  function notifyDriveCallback() {
    const route = useRoute()
    if (route.query.drive_linked === '1') {
      toast.success('Đã liên kết Google Drive thành công.')
    } else if (typeof route.query.drive_error === 'string') {
      const reasonMap: Record<string, string> = {
        oauth_not_configured: 'Chưa cấu hình OAuth Drive (Client ID/Secret) ở trang này.',
        disabled: 'OAuth Drive đang tắt.',
        not_configured: 'Chưa cấu hình OAuth Drive (Client ID/Secret).',
        secret_unreadable: 'Client secret Drive không giải mã được — dịch khoá hoặc nhập lại.',
        state_failed: 'Xác thực state thất bại — thử lại.',
        declined: 'Bạn đã từ chối consent Google.',
        exchange_failed: 'Đổi mã Google token thất bại — thử lại.',
        aud_mismatch: 'Token Google không khớp ứng dụng — kiểm tra Client ID Drive.',
        store_failed: 'Lưu liên kết thất bại — thử lại.',
        failed: 'Liên kết thất bại — thử lại.',
      }
      toast.error(reasonMap[route.query.drive_error] || `Liên kết Drive thất bại (${route.query.drive_error}).`)
    }
  }

  // Backup tự động bật mà chưa có nơi lưu ngoài máy chủ (spec backup-restore, "Local
  // only"). Tính từ BIỂU MẪU (đổi công tắc là thấy ngay) + trạng thái liên kết đã tải;
  // chưa tải xong cài đặt hoặc trạng thái liên kết thì không khẳng định gì.
  const backupsLocalOnly = computed(() => settingsLoaded.value && !driveLinkLoading.value
    && isBackupLocalOnly(backupSettings.value, driveLink.value?.status ?? null))

  /** Nạp mọi thứ khối cài đặt cần khi vừa mount. */
  function loadAll() {
    loadSettings()
    loadDriveStatus()
    loadDriveConfig()
    notifyDriveCallback()
  }

  return {
    isSuperAdmin, settingsLoaded, settingsLoadError, loadSettings,
    backupSettings, selectedDays, daysOptions, savingSettings, saveSettings,
    schedulerDisabledByServer, backupsLocalOnly,
    driveLink, driveRedirectUri, driveLinkLoading, disconnecting, driveToast,
    disconnectDrive, copyRedirectUri,
    driveConfig, driveConfigLoading, savingDriveConfig, clearingDriveSecret,
    driveClientId, driveClientSecret, driveEnabled, saveDriveConfig, clearDriveSecret,
    loadAll,
  }
}
