<script setup lang="ts">
import {
  MASKED_SECRET,
  SMTP_ALLOWED_PORTS,
  SMTP_PORT_NOT_ALLOWED_MESSAGE,
  credentialRetargetViolation,
  effectiveSmtpPort,
  isAllowedSmtpPort,
  sameSmtpTarget,
  smtpTargetOf,
} from '~~/shared/settings-credential-rules'

definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

// SMTP config lives in the shared `settings` key/value table. smtp_pass is
// returned masked ('********') by the API. What the save endpoint does with the
// password field (server/api/admin/settings/index.put.ts):
//   - mask unchanged  → keeps the saved password;
//   - empty           → SAVES an empty password, i.e. deletes it;
//   - anything else   → the new password.
// Changing host/port/user/secure without typing the password is refused (400) —
// the rule lives in shared/settings-credential-rules.ts and runs here too, so the
// officer sees it next to the field before the request is sent.
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

// Values as last loaded from the server (absent key = ''), the password as the
// server shows it (mask = a password is saved). The guard compares against this,
// exactly as the server compares against the stored rows.
const saved = ref<Map<string, string>>(new Map())
/** Mật khẩu đã lưu không giải mã được bằng khoá mã hoá hiện tại — phải nhập lại. */
const passwordNeedsReentry = ref(false)

const passwordSaved = computed(() => (saved.value.get('smtp_pass') ?? '') !== '')
const passwordRetyped = computed(() => settings.smtp_pass !== '' && settings.smtp_pass !== MASKED_SECRET)
const targetChanged = computed(() => {
  const stored = Object.fromEntries(saved.value)
  return !sameSmtpTarget(smtpTargetOf(stored), smtpTargetOf(settings))
})
const portInvalid = computed(() => !isAllowedSmtpPort(effectiveSmtpPort(settings.smtp_port)))
/** The server's verdict on this form, computed locally; `null` = the save is allowed. */
const formViolation = computed(() => credentialRetargetViolation({ ...settings }, saved.value))
const portError = computed(() => (formViolation.value === SMTP_PORT_NOT_ALLOWED_MESSAGE ? formViolation.value : ''))
const passwordError = computed(() => (formViolation.value && !portError.value ? formViolation.value : ''))
/** Saving now would store an empty password over the saved one. */
const passwordWillBeDeleted = computed(() => passwordSaved.value && settings.smtp_pass === '')

const fetchSettings = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; settings: Record<string, string | null>; needsReentry?: string[] }>)(`/api/admin/settings`)
    if (res.ok && res.settings) {
      for (const k of Object.keys(settings) as Array<keyof typeof settings>) {
        if (res.settings[k] != null) settings[k] = String(res.settings[k])
      }
      saved.value = new Map((Object.keys(settings) as Array<keyof typeof settings>).map((k): [string, string] => [k, res.settings[k] == null ? '' : String(res.settings[k])]))
      passwordNeedsReentry.value = (res.needsReentry ?? []).includes('smtp_pass')
    } else {
      error.value = 'Không tải được cài đặt email.'
    }
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không tải được cài đặt email.')
  } finally {
    loading.value = false
  }
}

const handleSave = async () => {
  // Same rule the server applies; refusing here only saves a round trip.
  if (formViolation.value) {
    toast.error(formViolation.value)
    return
  }
  saving.value = true
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean }>)(`/api/admin/settings`, { method: 'PUT', body: { settings } })
    if (res.ok) {
      toast.success('Đã lưu cấu hình email SMTP!')
      // Re-fetch so the password field shows the mask again after saving.
      await fetchSettings()
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi lưu cài đặt'))
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
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; message?: string }>)(`/api/admin/settings/test-email`, {
      method: 'POST',
      body: { ...settings, to: testEmail.value.trim() },
    })
    if (res.ok) toast.success(res.message || 'Đã gửi email thử.')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Gửi email thử thất bại.'))
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
        <h1 class="text-[1.3rem] font-extrabold text-brand-950 m-0">Cấu Hình Email (SMTP)</h1>
        <p class="text-[0.85rem] text-ink-muted mt-1 mb-0">Thiết lập máy chủ gửi email để nhận thông báo khi có đơn đăng ký mới từ biểu mẫu liên hệ</p>
      </div>
      <button
        class="inline-flex items-center gap-2 bg-brand-900 hover:bg-brand-700 text-white font-bold px-5 py-2.5 rounded-lg cursor-pointer transition-colors border-0 disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
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
      <div v-for="n in 2" :key="n" class="bg-white rounded-xl border border-line p-6">
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
      {{ error }} Vui lòng <button type="button" class="text-brand-600 font-bold underline" @click="fetchSettings()">thử lại</button>.
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-5">
      <!-- SMTP Server -->
      <div class="bg-white rounded-xl border border-line p-6">
        <h3 class="text-[1.05rem] font-bold text-brand-950 m-0 mb-4">Máy chủ SMTP</h3>
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">SMTP Host (*)</label>
            <input type="text" v-model="settings.smtp_host" placeholder="smtp.gmail.com" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-1.5">
              <label for="smtp-port" class="text-[0.82rem] font-bold text-[#2c3e2e]">Cổng (Port)</label>
              <input id="smtp-port" type="text" inputmode="numeric" v-model="settings.smtp_port" placeholder="587" :aria-invalid="portInvalid" aria-describedby="smtp-port-hint" class="w-full px-3.5 py-2.5 border rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" :class="portInvalid ? 'border-[#B04A4A]' : 'border-line-strong'" />
              <p id="smtp-port-hint" class="text-[0.72rem] m-0" :class="portInvalid ? 'text-[#B04A4A]' : 'text-[#667768]'">
                <template v-if="portError">{{ portError }}</template>
                <template v-else-if="portInvalid">Cổng đang lưu không được phép — gửi email sẽ bị từ chối. Hãy đổi sang {{ SMTP_ALLOWED_PORTS.join(', ') }}.</template>
                <template v-else>Chỉ nhận cổng {{ SMTP_ALLOWED_PORTS.join(', ') }}.</template>
              </p>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Bảo mật (SSL/TLS)</label>
              <select v-model="settings.smtp_secure" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border bg-white">
                <option value="false">Không / STARTTLS (587)</option>
                <option value="true">SSL/TLS (465)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Credentials -->
      <div class="bg-white rounded-xl border border-line p-6">
        <h3 class="text-[1.05rem] font-bold text-brand-950 m-0 mb-4">Thông tin đăng nhập</h3>
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Tài khoản (User) (*)</label>
            <input type="text" v-model="settings.smtp_user" placeholder="you@gmail.com" autocomplete="off" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="smtp-pass" class="text-[0.82rem] font-bold text-[#2c3e2e]">Mật khẩu (Password)</label>
            <input id="smtp-pass" type="password" v-model="settings.smtp_pass" placeholder="••••••••" autocomplete="new-password" :aria-invalid="Boolean(passwordError)" aria-describedby="smtp-pass-hint smtp-pass-status" class="w-full px-3.5 py-2.5 border rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" :class="passwordError ? 'border-[#B04A4A]' : 'border-line-strong'" />
            <p id="smtp-pass-hint" class="text-[0.72rem] text-ink-muted m-0">Giữ nguyên dấu ******** để dùng mật khẩu đã lưu. Xoá trắng ô này rồi lưu sẽ XOÁ mật khẩu đã lưu. Đổi host, cổng, tài khoản hoặc chế độ bảo mật thì phải nhập lại mật khẩu trong cùng lần lưu.</p>
            <p id="smtp-pass-status" class="text-[0.72rem] m-0" :class="passwordError || passwordWillBeDeleted || (passwordNeedsReentry && !passwordRetyped) ? 'text-[#B04A4A] font-semibold' : 'text-[#667768]'">
              <template v-if="passwordError">{{ passwordError }}</template>
              <template v-else-if="passwordNeedsReentry && !passwordRetyped">Mật khẩu đã lưu không giải mã được (khoá mã hoá của máy chủ đã đổi) — email sẽ không gửi được cho tới khi bạn nhập lại mật khẩu và lưu.</template>
              <template v-else-if="passwordWillBeDeleted">Ô mật khẩu đang trống: bấm Lưu sẽ xoá mật khẩu SMTP đã lưu.</template>
              <template v-else-if="targetChanged && passwordRetyped">Đã nhập mật khẩu mới cho máy chủ đã đổi.</template>
            </p>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Email người gửi (From)</label>
            <input type="text" v-model="settings.smtp_from" placeholder="Con Đường Hướng Thiện <no-reply@domain.vn>" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">Để trống sẽ dùng chính tài khoản đăng nhập làm địa chỉ gửi.</p>
          </div>
        </div>
      </div>

      <!-- Test send (full width) -->
      <div class="bg-white rounded-xl border border-line p-6 md:col-span-2">
        <h3 class="text-[1.05rem] font-bold text-brand-950 m-0 mb-1">Gửi email thử</h3>
        <p class="text-[0.8rem] text-ink-muted mt-0 mb-4">Nhập một địa chỉ email để kiểm tra cấu hình. Nếu ô mật khẩu để trống hoặc giữ dấu ********, hệ thống thử bằng cấu hình ĐÃ LƯU; muốn thử máy chủ khác trước khi lưu, hãy nhập mật khẩu của máy chủ đó.</p>
        <div class="flex gap-2 items-end flex-wrap">
          <div class="flex flex-col gap-1.5 flex-1 min-w-[220px]">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Địa chỉ nhận thử</label>
            <input type="email" v-model="testEmail" placeholder="test@example.com" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
          </div>
          <button
            type="button"
            class="inline-flex items-center gap-2 h-[42px] px-5 border border-line-strong bg-[#f4f7f4] text-brand-900 rounded-lg font-bold cursor-pointer hover:bg-[#e6f2e6] hover:border-brand-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
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
