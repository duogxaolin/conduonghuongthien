<script setup lang="ts">
// Khối "Cài đặt backup" tách từ pages/admin/settings/backup.vue. Mọi lời gọi mạng nằm trong
// useBackupSettings(); danh sách backup (error/retry/skeleton) vẫn ở trang cha.
const {
  backupSettings, selectedDays, daysOptions, savingSettings, saveSettings,
  driveLink, driveRedirectUri, driveLinkLoading, disconnecting, driveToast,
  disconnectDrive, copyRedirectUri,
  driveConfig, driveConfigLoading, savingDriveConfig, clearingDriveSecret,
  driveClientId, driveClientSecret, driveEnabled, saveDriveConfig, clearDriveSecret,
  loadAll,
} = useBackupSettings()

onMounted(() => loadAll())
</script>

<template>
  <section class="rounded-xl border border-[#e2ece3] bg-white p-5 flex flex-col gap-4">
    <div class="flex items-start gap-2">
      <i class="fa-solid fa-gear text-lg text-[#2c6e33] mt-0.5" aria-hidden="true"></i>
      <div>
        <h2 class="m-0 text-base font-bold text-[#122815]">Cài đặt backup</h2>
        <p class="m-0 mt-0.5 text-[0.82rem] text-[#667768]">Lịch backup tự động và cấu hình Google Drive.</p>
      </div>
    </div>

    <!-- Tự động -->
    <div class="flex flex-col gap-3 rounded-lg border border-[#e2ece3] bg-[#f8faf8] p-4">
      <label class="flex items-center gap-3 text-sm font-bold text-[#122815]">
        <input type="checkbox" v-model="backupSettings.backup_auto_enabled" true-value="true" false-value="false" class="h-4 w-4 accent-[#2c6e33]" />
        Backup tự động theo lịch
      </label>
      <div class="grid grid-cols-2 gap-3">
        <label class="text-sm font-bold">Giờ chạy (0-23)
          <input type="number" v-model="backupSettings.backup_auto_hour" min="0" max="23" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal" />
        </label>
        <label class="text-sm font-bold">Số bản giữ
          <input type="number" v-model="backupSettings.backup_keep_count" min="1" max="365" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal" />
        </label>
      </div>
      <div class="flex flex-col gap-2">
        <span class="text-sm font-bold">Ngày chạy</span>
        <div class="flex flex-wrap gap-1.5">
          <button v-for="day in daysOptions" :key="day.value" type="button" class="rounded-lg border px-3 py-1.5 text-sm font-semibold" :class="selectedDays.includes(day.value) ? 'border-[#2c6e33] bg-[#2c6e33] text-white' : 'border-[#c8d6c9] bg-white text-[#2c6e33] hover:bg-[#f0f7f1]'" @click="selectedDays.includes(day.value) ? selectedDays = selectedDays.filter(d => d !== day.value) : selectedDays.push(day.value)">{{ day.label }}</button>
          <button type="button" class="rounded-lg border border-[#c8d6c9] px-3 py-1.5 text-sm font-semibold text-[#667768] hover:bg-[#f0f7f1]" @click="selectedDays = []">Mỗi ngày</button>
        </div>
      </div>
    </div>

    <!-- Google Drive -->
    <div class="flex flex-col gap-4 rounded-lg border border-[#e2ece3] bg-[#f8faf8] p-4">
      <label class="flex items-center gap-3 text-sm font-bold text-[#122815]">
        <input type="checkbox" v-model="backupSettings.backup_drive_enabled" true-value="true" false-value="false" class="h-4 w-4 accent-[#2c6e33]" />
        Upload lên Google Drive
      </label>

      <!-- Sub-block A: Liên kết tài khoản Google (OAuth) — ưu tiên -->
      <div class="flex flex-col gap-3 rounded-lg border border-[#cce5cd] bg-white p-3">
        <h3 class="m-0 text-sm font-bold text-[#1e4620]">Liên kết tài khoản Google (OAuth)</h3>
        <p class="m-0 text-[0.8rem] text-[#667768]">Liên kết tài khoản Google cá nhân — backup upload lên Drive của bạn, tự làm mới token. Được ưu tiên nếu đã liên kết.</p>
        <p class="m-0 text-[0.78rem] text-[#8a6412]">
          <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
          OAuth Drive dùng <strong>Client ID/Secret riêng</strong> (không dùng chung với đăng nhập người đọc). Tạo OAuth Client riêng trong Google Cloud Console, chọn "Web application", thêm Redirect URI bên dưới.
        </p>

        <!-- Form credentials Drive (tách khỏi reader) -->
        <div v-if="driveConfigLoading" class="text-[0.8rem] text-[#667768]">Đang tải cấu hình…</div>
        <div v-else class="flex flex-col gap-2.5">
          <label class="text-sm font-bold text-[#122815]">Client ID (Drive)
            <input v-model="driveClientId" type="text" placeholder="xxxx.apps.googleusercontent.com" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal text-[0.82rem] outline-none focus:border-[#2c6e33]" />
          </label>
          <label class="text-sm font-bold text-[#122815]">Client Secret (Drive)
            <input v-model="driveClientSecret" type="password" :placeholder="driveConfig?.hasClientSecret ? `••••${driveConfig.clientSecretMasked?.slice(-4) || ''}` : 'Nhập client secret'" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal text-[0.82rem] outline-none focus:border-[#2c6e33]" />
          </label>
          <div v-if="driveConfig?.hasClientSecret" class="flex items-center gap-2">
            <button type="button" class="inline-flex items-center gap-1 rounded-md bg-[#ffebe9] px-2.5 py-1 text-[0.72rem] font-bold text-[#d12420] border-0 cursor-pointer hover:bg-red-200 disabled:opacity-50" :disabled="clearingDriveSecret" @click="clearDriveSecret">
              <i class="fa-solid fa-trash-can" :class="clearingDriveSecret ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i> Gỡ client secret
            </button>
            <span v-if="driveConfig?.clientSecretStatus === 'secret_unreadable'" class="text-[0.72rem] text-[#8a6412]">Secret không giải mã được — dịch khoá hoặc nhập lại.</span>
          </div>
          <label class="flex items-center gap-2 text-sm font-bold text-[#122815]">
            <input type="checkbox" v-model="driveEnabled" class="h-4 w-4 accent-[#2c6e33]" /> Bật OAuth Drive
          </label>
          <button type="button" class="inline-flex w-fit items-center gap-2 rounded-lg bg-[#2c6e33] px-4 py-2 text-sm font-bold text-white border-0 cursor-pointer hover:bg-[#1e4620] disabled:opacity-50" :disabled="savingDriveConfig" @click="saveDriveConfig">
            <i class="fa-solid fa-floppy-disk" :class="savingDriveConfig ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i> Lưu credentials
          </button>
        </div>

        <!-- Redirect URI để copy vào Google Console -->
        <div class="flex items-center gap-2 rounded border border-[#e2ece3] bg-[#f8faf8] px-2.5 py-1.5">
          <span class="text-[0.72rem] font-bold text-[#667768] whitespace-nowrap">Redirect URI:</span>
          <code class="flex-1 overflow-x-auto text-[0.74rem] text-[#122815]">{{ driveRedirectUri || '(chưa tải)' }}</code>
          <button type="button" class="rounded p-1 text-[#2c6e33] border-0 bg-transparent cursor-pointer hover:bg-[#e4f2e5]" title="Copy" @click="copyRedirectUri"><i class="fa-regular fa-copy" aria-hidden="true"></i></button>
        </div>

        <!-- Nút liên kết (chỉ khi config đã bật) -->
        <div v-if="driveLinkLoading" class="text-[0.8rem] text-[#667768]">Đang tải trạng thái liên kết…</div>
        <div v-else-if="driveLink?.linked" class="flex flex-wrap items-center gap-2">
          <i class="fa-solid fa-circle-check text-[#2c6e33]" aria-hidden="true"></i>
          <span class="text-[0.84rem] text-[#122815]">Đã liên kết: <strong>{{ driveLink.linkedEmail || '(không có email)' }}</strong> <span v-if="driveLink.linkedAt">— {{ formatWhen(driveLink.linkedAt) }}</span></span>
          <button type="button" class="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[#ffebe9] px-2.5 py-1 text-[0.72rem] font-bold text-[#d12420] border-0 cursor-pointer hover:bg-red-200 disabled:opacity-50" :disabled="disconnecting" @click="disconnectDrive">
            <i class="fa-solid fa-link-slash" :class="disconnecting ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i> Hủy liên kết
          </button>
        </div>
        <div v-else-if="driveLink?.status === 'secret_unreadable'" class="flex flex-wrap items-center gap-2">
          <i class="fa-solid fa-triangle-exclamation text-[#8a6412]" aria-hidden="true"></i>
          <span class="text-[0.84rem] text-[#8a6412]">Refresh token không giải mã được — dịch khoá CHATBOT_ENCRYPTION_SECRET hoặc liên kết lại.</span>
          <button type="button" class="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[#fdf6e7] px-2.5 py-1 text-[0.72rem] font-bold text-[#8a6412] border-0 cursor-pointer hover:bg-[#f5e8c8]" @click="disconnectDrive">Xoá liên kết hỏng</button>
        </div>
        <div v-else-if="driveConfig?.isEnabled" class="flex flex-col gap-2">
          <a href="/api/admin/backup/drive/start" class="inline-flex w-fit items-center gap-2 rounded-lg bg-[#2c6e33] px-4 py-2 text-sm font-bold text-white border-0 no-underline hover:bg-[#1e4620]">
            <i class="fa-brands fa-google" aria-hidden="true"></i> Liên kết Google Drive
          </a>
          <p v-if="driveToast" class="m-0 text-[0.78rem] text-[#a32924]" role="alert">{{ driveToast }}</p>
        </div>
        <div v-else class="text-[0.78rem] text-[#8a6412]">
          <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
          Cần nhập Client ID + Client Secret + bật công tắc + Lưu credentials trước khi liên kết.
        </div>
      </div>

      <!-- Sub-block B: Service Account (fallback) -->
      <div class="flex flex-col gap-2 rounded-lg border border-[#e2ece3] bg-white p-3">
        <h3 class="m-0 text-sm font-bold text-[#122815]">Service Account (fallback cho scheduler)</h3>
        <p class="m-0 text-[0.8rem] text-[#667768]">Dùng khi không liên kết tài khoản cá nhân, hoặc cho backup tự động qua scheduler. Cần share folder Drive với email service account.</p>
        <label class="text-sm font-bold">Service Account JSON key
          <textarea v-model="backupSettings.backup_drive_service_account" placeholder="{ &quot;type&quot;: &quot;service_account&quot;, ... }" rows="4" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2 font-mono text-[0.78rem]" />
        </label>
        <label class="text-sm font-bold">Folder ID (tùy chọn — dùng chung cho cả 2 mode)
          <input type="text" v-model="backupSettings.backup_drive_folder_id" placeholder="1aBcDeFgHiJkLmNoPqRsTuVwXyZ" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal" />
        </label>
      </div>
    </div>

    <button type="button" class="inline-flex w-fit items-center gap-2 rounded-lg bg-[#2c6e33] px-5 py-2.5 text-sm font-bold text-white border-0 cursor-pointer hover:bg-[#1e4620] disabled:opacity-50" :disabled="savingSettings" @click="saveSettings">
      <i class="fa-solid fa-floppy-disk" :class="savingSettings ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i> Lưu cấu hình
    </button>
  </section>
</template>
