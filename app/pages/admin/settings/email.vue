<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

// SMTP config lives in the shared `settings` key/value table. smtp_pass is
// returned masked ('********') by the API; we only send it back when the admin
// actually changes it (mirrors the r2_secret_key convention).
const settings = reactive({
  smtp_host: '',
  smtp_port: '587',
  smtp_secure: 'false',
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',
})

const loading = ref(true)
const error = ref('')
const saving = ref(false)
const testing = ref(false)
const testEmail = ref('')
const toast = useToast()

const fetchSettings = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch('/api/admin/settings')
    if (res.ok && res.settings) {
      for (const k of Object.keys(settings) as Array<keyof typeof settings>) {
        if (res.settings[k] != null) settings[k] = String(res.settings[k])
      }
    } else {
      error.value = 'Không tải được cài đặt email.'
    }
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Không tải được cài đặt email.'
  } finally {
    loading.value = false
  }
}

const handleSave = async () => {
  saving.value = true
  try {
    const res = await $fetch('/api/admin/settings', { method: 'PUT', body: { settings } })
    if (res.ok) {
      toast.success('Đã lưu cấu hình email SMTP!')
      // Re-fetch so the password field shows the mask again after saving.
      await fetchSettings()
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi lưu cài đặt')
  } finally {
    saving.value = false
  }
}

const handleTest = async () => {
  if (!testEmail.value.trim()) {
    toast.error('Vui lòng nhập địa chỉ email để gửi thử.')
    return
  }
  testing.value = true
  try {
    const res = await $fetch('/api/admin/settings/test-email', {
      method: 'POST',
      body: { ...settings, to: testEmail.value.trim() },
    })
    if (res.ok) toast.success(res.message || 'Đã gửi email thử.')
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Gửi email thử thất bại.')
  } finally {
    testing.value = false
  }
}

onMounted(() => { fetchSettings() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Cấu Hình Email (SMTP)</h1>
        <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Thiết lập máy chủ gửi email để nhận thông báo khi có đơn đăng ký mới từ biểu mẫu liên hệ</p>
      </div>
      <button
        class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-5 py-2.5 rounded-lg cursor-pointer transition-colors border-0 disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
        :disabled="saving"
        @click="handleSave"
      >
        <i class="fa-regular" :class="saving ? 'fa-spinner animate-spin' : 'fa-floppy-disk'"></i>
        {{ saving ? 'Đang lưu...' : 'Lưu Cấu Hình' }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" role="status" aria-busy="true" class="grid grid-cols-1 md:grid-cols-2 gap-5">
      <span class="sr-only">Đang tải cấu hình email</span>
      <div v-for="n in 2" :key="n" class="bg-white rounded-xl border border-[#e2ece3] p-6">
        <div class="flex flex-col gap-4 animate-pulse motion-reduce:animate-none">
          <div v-for="i in 4" :key="i">
            <div class="h-4 bg-[#EEF2EC] rounded w-1/4 mb-2" aria-hidden="true"></div>
            <div class="h-10 bg-[#EEF2EC] rounded" aria-hidden="true"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" role="alert" class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]">
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ error }} Vui lòng <button type="button" class="text-[#4A6741] font-bold underline" @click="fetchSettings()">thử lại</button>.
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-5">
      <!-- SMTP Server -->
      <div class="bg-white rounded-xl border border-[#e2ece3] p-6">
        <h3 class="text-[1.05rem] font-bold text-[#122815] m-0 mb-4">Máy chủ SMTP</h3>
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">SMTP Host (*)</label>
            <input type="text" v-model="settings.smtp_host" placeholder="smtp.gmail.com" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Cổng (Port)</label>
              <input type="text" v-model="settings.smtp_port" placeholder="587" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Bảo mật (SSL/TLS)</label>
              <select v-model="settings.smtp_secure" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border bg-white">
                <option value="false">Không / STARTTLS (587)</option>
                <option value="true">SSL/TLS (465)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Credentials -->
      <div class="bg-white rounded-xl border border-[#e2ece3] p-6">
        <h3 class="text-[1.05rem] font-bold text-[#122815] m-0 mb-4">Thông tin đăng nhập</h3>
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Tài khoản (User) (*)</label>
            <input type="text" v-model="settings.smtp_user" placeholder="you@gmail.com" autocomplete="off" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Mật khẩu (Password)</label>
            <input type="password" v-model="settings.smtp_pass" placeholder="••••••••" autocomplete="new-password" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">Để trống hoặc giữ nguyên dấu ******** nếu không muốn thay đổi mật khẩu đã lưu.</p>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Email người gửi (From)</label>
            <input type="text" v-model="settings.smtp_from" placeholder="Con Đường Hướng Thiện <no-reply@domain.vn>" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">Để trống sẽ dùng chính tài khoản đăng nhập làm địa chỉ gửi.</p>
          </div>
        </div>
      </div>

      <!-- Test send (full width) -->
      <div class="bg-white rounded-xl border border-[#e2ece3] p-6 md:col-span-2">
        <h3 class="text-[1.05rem] font-bold text-[#122815] m-0 mb-1">Gửi email thử</h3>
        <p class="text-[0.8rem] text-[#667768] mt-0 mb-4">Nhập một địa chỉ email để kiểm tra cấu hình. Hệ thống sẽ dùng thông tin đang nhập ở trên (kể cả khi chưa lưu).</p>
        <div class="flex gap-2 items-end flex-wrap">
          <div class="flex flex-col gap-1.5 flex-1 min-w-[220px]">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Địa chỉ nhận thử</label>
            <input type="email" v-model="testEmail" placeholder="test@example.com" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
          </div>
          <button
            type="button"
            class="inline-flex items-center gap-2 h-[42px] px-5 border border-[#c8d6c9] bg-[#f4f7f4] text-[#1e4620] rounded-lg font-bold cursor-pointer hover:bg-[#e6f2e6] hover:border-[#2c6e33] transition-colors disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
            :disabled="testing"
            @click="handleTest"
          >
            <i class="fa-regular" :class="testing ? 'fa-spinner animate-spin' : 'fa-paper-plane'"></i>
            {{ testing ? 'Đang gửi...' : 'Gửi thử' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
