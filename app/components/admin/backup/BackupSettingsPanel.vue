<script setup lang="ts">
// Khối "Cài đặt backup" tách từ pages/admin/settings/backup.vue. Mọi lời gọi mạng nằm trong
// useBackupSettings(); danh sách backup (error/retry/skeleton) vẫn ở trang cha.
const {
  isSuperAdmin, settingsLoaded, settingsLoadError, loadSettings,
  backupSettings, selectedDays, daysOptions, savingSettings, saveSettings,
  schedulerDisabledByServer, serviceAccountNeedsReentry, backupsLocalOnly,
  driveLink, driveRedirectUri, driveLinkLoading, disconnecting, driveToast,
  disconnectDrive, copyRedirectUri,
  driveConfig, driveConfigLoading, savingDriveConfig, clearingDriveSecret,
  driveClientId, driveClientSecret, driveEnabled, saveDriveConfig, clearDriveSecret,
  loadAll,
} = useBackupSettings()

onMounted(() => loadAll())
</script>

<template>
  <section class="rounded-xl border border-line bg-white p-5 flex flex-col gap-4">
    <div class="flex items-start gap-2">
      <i class="fa-solid fa-gear text-lg text-brand-700 mt-0.5" aria-hidden="true"></i>
      <div>
        <h2 class="m-0 text-base font-bold text-brand-950">Cài đặt backup</h2>
        <p class="m-0 mt-0.5 text-[0.82rem] text-ink-muted">Lịch backup tự động và cấu hình Google Drive.</p>
      </div>
    </div>

    <!-- Tải cài đặt hỏng: không cho lưu (biểu mẫu đang giữ giá trị mặc định, lưu là ghi đè cấu hình thật). -->
    <div v-if="settingsLoadError" role="alert" class="rounded-lg border border-dashed border-[#E2A0A0] bg-white px-4 py-3 text-sm text-danger-soft">
      <i class="fa-solid fa-triangle-exclamation mr-1.5" aria-hidden="true"></i>
      {{ settingsLoadError }} Vui lòng <button type="button" class="text-brand-600 font-bold underline bg-transparent border-0 p-0 cursor-pointer" @click="loadSettings()">thử lại</button>.
    </div>

    <p v-if="!isSuperAdmin" class="m-0 rounded-lg border border-[#f0dcae] bg-[#fdf6e7] px-3 py-2 text-[0.8rem] text-warn-ink">
      <i class="fa-solid fa-lock mr-1" aria-hidden="true"></i>
      Chỉ quản trị viên cấp cao (SuperAdmin) được đổi số bản giữ lại và cấu hình Google Drive (service account, thư mục, công tắc upload, liên kết OAuth). Bạn vẫn đổi được lịch backup tự động.
    </p>

    <!-- Tự động -->
    <div class="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <label class="flex items-center gap-3 text-sm font-bold text-brand-950">
        <input type="checkbox" v-model="backupSettings.backup_auto_enabled" true-value="true" false-value="false" class="h-4 w-4 accent-brand-700" />
        Backup tự động theo lịch
      </label>
      <p v-if="schedulerDisabledByServer" data-testid="backup-scheduler-disabled" class="m-0 rounded-lg border border-[#f0dcae] bg-[#fdf6e7] px-3 py-2 text-[0.8rem] text-warn-ink">
        <i class="fa-solid fa-circle-pause mr-1" aria-hidden="true"></i>
        Máy chủ đang tắt sao lưu tự động: lịch dưới đây vẫn lưu được nhưng sẽ không chạy cho tới khi máy chủ bật lại.
      </p>
      <p v-if="backupsLocalOnly" data-testid="backup-offsite-missing" class="m-0 rounded-lg border border-[#f0dcae] bg-[#fdf6e7] px-3 py-2 text-[0.8rem] text-warn-ink">
        <i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>
        Các bản sao lưu hiện chỉ nằm trên máy chủ này — chưa có nơi lưu bên ngoài (Google Drive). Máy chủ hỏng là mất luôn bản sao lưu.
        <span v-if="isSuperAdmin">Bật “Upload lên Google Drive” rồi liên kết tài khoản Google hoặc nhập service account bên dưới.</span>
        <span v-else>Nhờ quản trị viên cấp cao cấu hình Google Drive.</span>
      </p>
      <div class="grid grid-cols-2 gap-3">
        <label class="text-sm font-bold">Giờ chạy (0-23)
          <input type="number" v-model="backupSettings.backup_auto_hour" min="0" max="23" class="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 font-normal" />
        </label>
        <label class="text-sm font-bold">Số bản giữ
          <input type="number" v-model="backupSettings.backup_keep_count" min="1" max="365" :disabled="!isSuperAdmin" :title="isSuperAdmin ? undefined : 'Chỉ SuperAdmin được đổi'" class="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 font-normal disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-muted" />
        </label>
      </div>
      <div class="flex flex-col gap-2">
        <span class="text-sm font-bold">Ngày chạy</span>
        <div class="flex flex-wrap gap-1.5">
          <button v-for="day in daysOptions" :key="day.value" type="button" class="rounded-lg border px-3 py-1.5 text-sm font-semibold" :class="selectedDays.includes(day.value) ? 'border-brand-700 bg-brand-700 text-white' : 'border-line-strong bg-white text-brand-700 hover:bg-surface-tint'" @click="selectedDays.includes(day.value) ? selectedDays = selectedDays.filter(d => d !== day.value) : selectedDays.push(day.value)">{{ day.label }}</button>
          <button type="button" class="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-semibold text-ink-muted hover:bg-surface-tint" @click="selectedDays = []">Mỗi ngày</button>
        </div>
      </div>
    </div>

    <!-- Google Drive -->
    <div class="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
      <label class="flex items-center gap-3 text-sm font-bold text-brand-950">
        <input type="checkbox" v-model="backupSettings.backup_drive_enabled" true-value="true" false-value="false" :disabled="!isSuperAdmin" class="h-4 w-4 accent-brand-700 disabled:cursor-not-allowed" />
        Upload lên Google Drive
      </label>

      <!-- Sub-block A: Liên kết tài khoản Google (OAuth) — ưu tiên -->
      <div class="flex flex-col gap-3 rounded-lg border border-[#cce5cd] bg-white p-3">
        <h3 class="m-0 text-sm font-bold text-brand-900">Liên kết tài khoản Google (OAuth)</h3>
        <p class="m-0 text-[0.8rem] text-ink-muted">Liên kết tài khoản Google cá nhân — backup upload lên Drive của bạn, tự làm mới token. Được ưu tiên nếu đã liên kết.</p>
        <p class="m-0 text-[0.78rem] text-warn-ink">
          <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
          OAuth Drive dùng <strong>Client ID/Secret riêng</strong> (không dùng chung với đăng nhập người đọc). Tạo OAuth Client riêng trong Google Cloud Console, chọn "Web application", thêm Redirect URI bên dưới.
        </p>

        <!-- Form credentials Drive (tách khỏi reader) -->
        <div v-if="driveConfigLoading" class="text-[0.8rem] text-ink-muted">Đang tải cấu hình…</div>
        <div v-else-if="isSuperAdmin" class="flex flex-col gap-2.5">
          <label class="text-sm font-bold text-brand-950">Client ID (Drive)
            <input v-model="driveClientId" type="text" placeholder="xxxx.apps.googleusercontent.com" class="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 font-normal text-[0.82rem] outline-none focus:border-brand-700" />
          </label>
          <label class="text-sm font-bold text-brand-950">Client Secret (Drive)
            <input v-model="driveClientSecret" type="password" :placeholder="driveConfig?.hasClientSecret ? `••••${driveConfig.clientSecretMasked?.slice(-4) || ''}` : 'Nhập client secret'" class="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 font-normal text-[0.82rem] outline-none focus:border-brand-700" />
          </label>
          <div v-if="driveConfig?.hasClientSecret" class="flex items-center gap-2">
            <button type="button" class="inline-flex items-center gap-1 rounded-md bg-danger-bg px-2.5 py-1 text-[0.72rem] font-bold text-danger border-0 cursor-pointer hover:bg-red-200 disabled:opacity-50" :disabled="clearingDriveSecret" @click="clearDriveSecret">
              <i class="fa-solid fa-trash-can" :class="clearingDriveSecret ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i> Gỡ client secret
            </button>
            <span v-if="driveConfig?.clientSecretStatus === 'secret_unreadable'" class="text-[0.72rem] text-warn-ink">Secret không giải mã được — dịch khoá hoặc nhập lại.</span>
          </div>
          <label class="flex items-center gap-2 text-sm font-bold text-brand-950">
            <input type="checkbox" v-model="driveEnabled" class="h-4 w-4 accent-brand-700" /> Bật OAuth Drive
          </label>
          <button type="button" class="inline-flex w-fit items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white border-0 cursor-pointer hover:bg-brand-900 disabled:opacity-50" :disabled="savingDriveConfig" @click="saveDriveConfig">
            <i class="fa-solid fa-floppy-disk" :class="savingDriveConfig ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i> Lưu credentials
          </button>
        </div>

        <!-- Redirect URI để copy vào Google Console -->
        <div class="flex items-center gap-2 rounded border border-line bg-surface px-2.5 py-1.5">
          <span class="text-[0.72rem] font-bold text-ink-muted whitespace-nowrap">Redirect URI:</span>
          <code class="flex-1 overflow-x-auto text-[0.74rem] text-brand-950">{{ driveRedirectUri || '(chưa tải)' }}</code>
          <button type="button" class="rounded p-1 text-brand-700 border-0 bg-transparent cursor-pointer hover:bg-[#e4f2e5]" title="Copy" @click="copyRedirectUri"><i class="fa-regular fa-copy" aria-hidden="true"></i></button>
        </div>

        <!-- Nút liên kết (chỉ khi config đã bật) -->
        <div v-if="driveLinkLoading" class="text-[0.8rem] text-ink-muted">Đang tải trạng thái liên kết…</div>
        <div v-else-if="driveLink?.linked" class="flex flex-wrap items-center gap-2">
          <i class="fa-solid fa-circle-check text-brand-700" aria-hidden="true"></i>
          <span class="text-[0.84rem] text-brand-950">Đã liên kết: <strong>{{ driveLink.linkedEmail || '(không có email)' }}</strong> <span v-if="driveLink.linkedAt">— {{ formatWhen(driveLink.linkedAt) }}</span></span>
          <button v-if="isSuperAdmin" type="button" class="ml-auto inline-flex items-center gap-1.5 rounded-md bg-danger-bg px-2.5 py-1 text-[0.72rem] font-bold text-danger border-0 cursor-pointer hover:bg-red-200 disabled:opacity-50" :disabled="disconnecting" @click="disconnectDrive">
            <i class="fa-solid fa-link-slash" :class="disconnecting ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i> Hủy liên kết
          </button>
        </div>
        <div v-else-if="driveLink?.status === 'secret_unreadable'" class="flex flex-wrap items-center gap-2">
          <i class="fa-solid fa-triangle-exclamation text-warn-ink" aria-hidden="true"></i>
          <span class="text-[0.84rem] text-warn-ink">Refresh token không giải mã được — dịch khoá CHATBOT_ENCRYPTION_SECRET hoặc liên kết lại.</span>
          <button v-if="isSuperAdmin" type="button" class="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[#fdf6e7] px-2.5 py-1 text-[0.72rem] font-bold text-warn-ink border-0 cursor-pointer hover:bg-[#f5e8c8]" @click="disconnectDrive">Xoá liên kết hỏng</button>
        </div>
        <div v-else-if="!isSuperAdmin" class="text-[0.78rem] text-ink-muted">
          <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
          Chưa liên kết tài khoản Google Drive.
        </div>
        <div v-else-if="driveConfig?.isEnabled" class="flex flex-col gap-2">
          <a href="/api/admin/backup/drive/start" class="inline-flex w-fit items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white border-0 no-underline hover:bg-brand-900">
            <i class="fa-brands fa-google" aria-hidden="true"></i> Liên kết Google Drive
          </a>
          <p v-if="driveToast" class="m-0 text-[0.78rem] text-[#a32924]" role="alert">{{ driveToast }}</p>
        </div>
        <div v-else class="text-[0.78rem] text-warn-ink">
          <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
          Cần nhập Client ID + Client Secret + bật công tắc + Lưu credentials trước khi liên kết.
        </div>
      </div>

      <!-- Sub-block B: Service Account (fallback) -->
      <div class="flex flex-col gap-2 rounded-lg border border-line bg-white p-3">
        <h3 class="m-0 text-sm font-bold text-brand-950">Service Account (fallback cho scheduler)</h3>
        <p class="m-0 text-[0.8rem] text-ink-muted">Dùng khi không liên kết tài khoản cá nhân, hoặc cho backup tự động qua scheduler. Cần share folder Drive với email service account.</p>
        <p v-if="serviceAccountNeedsReentry" class="m-0 text-[0.8rem] font-semibold text-danger-soft">
          <i class="fa-solid fa-triangle-exclamation mr-1.5" aria-hidden="true"></i>Khoá JSON đã lưu không giải mã được (khoá mã hoá của máy chủ đã đổi) — bản sao lưu không lên Drive qua service account cho tới khi SuperAdmin dán lại khoá và lưu.
        </p>
        <template v-if="isSuperAdmin">
          <label class="text-sm font-bold">Service Account JSON key
            <textarea v-model="backupSettings.backup_drive_service_account" placeholder="{ &quot;type&quot;: &quot;service_account&quot;, ... }" rows="4" class="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 font-mono text-[0.78rem]" />
          </label>
          <label class="text-sm font-bold">Folder ID (tùy chọn — dùng chung cho cả 2 mode)
            <input type="text" v-model="backupSettings.backup_drive_folder_id" placeholder="1aBcDeFgHiJkLmNoPqRsTuVwXyZ" class="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 font-normal" />
          </label>
        </template>
        <p v-else class="m-0 text-[0.8rem] text-ink-muted">
          Service account: <strong class="text-brand-950">{{ backupSettings.backup_drive_service_account ? 'đã cấu hình' : 'chưa cấu hình' }}</strong>
        </p>
      </div>
    </div>

    <button type="button" class="inline-flex w-fit items-center gap-2 rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-bold text-white border-0 cursor-pointer hover:bg-brand-900 disabled:opacity-50 disabled:cursor-not-allowed" :disabled="savingSettings || !settingsLoaded" @click="saveSettings">
      <i class="fa-solid fa-floppy-disk" :class="savingSettings ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i> Lưu cấu hình
    </button>
  </section>
</template>
