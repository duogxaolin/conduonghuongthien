<script setup lang="ts">
import {
  MASKED_SECRET,
  R2_ACCOUNT_ID_INVALID_MESSAGE,
  R2_BUCKET_INVALID_MESSAGE,
  R2_RETYPE_SECRET_MESSAGE,
  credentialRetargetViolation,
  isCloudflareAccountId,
  isR2BucketName,
} from '~~/shared/settings-credential-rules'

definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const settings = reactive({
  media_provider: 'local',
  r2_account_id: '',
  r2_access_key: '',
  r2_secret_key: '',
  r2_bucket: '',
  r2_public_url: '',
})

const loading = ref(true)
const error = ref('')
const saving = ref(false)
const testingR2 = ref(false)
const testMessage = ref('')
const testError = ref('')
const toast = useToast()

// Values as last loaded (secret as the server shows it: the mask, or the real value
// for a SuperAdmin). The save endpoint refuses a changed Account ID without the
// Secret Key typed in the same save (it is the endpoint host); the same rule from
// shared/settings-credential-rules.ts runs here so the officer sees it inline.
const saved = ref<Map<string, string>>(new Map())
const mediaSettings = () => ({
  media_provider: settings.media_provider,
  r2_account_id: settings.r2_account_id,
  r2_access_key: settings.r2_access_key,
  r2_secret_key: settings.r2_secret_key,
  r2_bucket: settings.r2_bucket,
  r2_public_url: settings.r2_public_url,
})
const formViolation = computed(() => credentialRetargetViolation(mediaSettings(), saved.value))
const accountIdError = computed(() => {
  const value = settings.r2_account_id.trim()
  return value !== '' && !isCloudflareAccountId(value) ? R2_ACCOUNT_ID_INVALID_MESSAGE : ''
})
const bucketError = computed(() => {
  const value = settings.r2_bucket.trim()
  return value !== '' && !isR2BucketName(value) ? R2_BUCKET_INVALID_MESSAGE : ''
})
const secretError = computed(() => (formViolation.value === R2_RETYPE_SECRET_MESSAGE ? formViolation.value : ''))
/** Secret Key đã lưu không giải mã được bằng khoá mã hoá hiện tại — phải nhập lại. */
const secretNeedsReentry = ref(false)
const secretRetyped = computed(() => settings.r2_secret_key !== '' && settings.r2_secret_key !== MASKED_SECRET)
const secretHint = computed(() => secretError.value
  || (secretNeedsReentry.value && !secretRetyped.value
    ? 'Secret Key đã lưu không giải mã được (khoá mã hoá của máy chủ đã đổi) — R2 không dùng được cho tới khi bạn nhập lại và lưu.'
    : 'Giữ nguyên dấu ******** để dùng Secret Key đã lưu. Không nhập lại thì nút kiểm tra dùng cấu hình ĐÃ LƯU.'))

const fetchSettings = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; settings: Record<string, string | null>; needsReentry?: string[] }>)(`/api/admin/settings`)
    if (res.ok && res.settings) {
      secretNeedsReentry.value = (res.needsReentry ?? []).includes('r2_secret_key')
      // Chỉ nhận các khóa thuộc trang này; endpoint trả về toàn bộ settings (gồm
      // nav_menu_*, smtp_*, tracking_*...) — gán toàn bộ sẽ làm state settings
      // lẫn các khóa ngoài phạm vi và sau đó bị gửi ngược lên khi lưu.
      const s = res.settings
      settings.media_provider = s.media_provider ?? 'local'
      settings.r2_account_id = s.r2_account_id ?? ''
      settings.r2_access_key = s.r2_access_key ?? ''
      settings.r2_secret_key = s.r2_secret_key ?? ''
      settings.r2_bucket = s.r2_bucket ?? ''
      settings.r2_public_url = s.r2_public_url ?? ''
      saved.value = new Map(Object.keys(mediaSettings()).map((k): [string, string] => [k, s[k] ?? '']))
    } else {
      error.value = 'Không tải được cấu hình lưu trữ.'
    }
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không tải được cấu hình lưu trữ.')
  } finally {
    loading.value = false
  }
}

const handleSave = async () => {
  // Same rule the server applies (account id format, bucket format, retype the
  // secret when the account id changes); refusing here only saves a round trip.
  if (formViolation.value) {
    toast.error(formViolation.value)
    return
  }
  saving.value = true
  try {
    // Chỉ gửi đúng các khóa thuộc nhóm media storage (`mediaSettings()`). Trang này
    // dùng chung endpoint /api/admin/settings với allow-list bảo mật ở server — gửi
    // nguyên object `settings` sẽ kéo theo các khóa không thuộc trang này
    // (nav_menu_*, smtp_*, tracking_*...) và bị server từ chối với "Khóa cài đặt
    // không hợp lệ".
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean }>)(`/api/admin/settings`, { method: 'PUT', body: { settings: mediaSettings() } })
    if (res.ok) {
      toast.success('Đã lưu cấu hình lưu trữ Media thành công!')
      // Re-fetch: the secret shows the mask again and the guard compares against what is now stored.
      await fetchSettings()
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi lưu cấu hình'))
  } finally {
    saving.value = false
  }
}

const handleTestR2 = async () => {
  testingR2.value = true
  testMessage.value = ''
  testError.value = ''
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; message?: string }>)(`/api/admin/settings/test-r2`, {
      method: 'POST',
      body: { accountId: settings.r2_account_id, accessKeyId: settings.r2_access_key, secretAccessKey: settings.r2_secret_key, bucket: settings.r2_bucket }
    })
    if (res.ok) {
      toast.success(res.message || 'Kết nối Cloudflare R2 thành công!')
      testMessage.value = '🎉 ' + res.message
    }
  } catch (err: unknown) {
    const msg = errorMessage(err, 'Kết nối R2 thất bại')
    toast.error(msg)
    testError.value = '❌ ' + msg
  } finally {
    testingR2.value = false
  }
}

onMounted(() => { fetchSettings() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Cấu Hình Lưu Trữ Media (Local vs Cloudflare R2)</h1>
        <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Tùy chọn lưu trữ file trực tiếp trên Server VPS hoặc Cloudflare R2 Cloud Storage</p>
      </div>
      <button
        class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-5 py-2.5 rounded-lg cursor-pointer transition-colors border-0 disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
        :disabled="saving"
        @click="handleSave"
      >
        <i class="fa-solid fa-floppy-disk"></i>
        {{ saving ? 'Đang lưu...' : 'Lưu Cấu Hình' }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" role="status" aria-busy="true" class="bg-white rounded-xl border border-[#e2ece3] p-6">
      <span class="sr-only">Đang tải cấu hình lưu trữ media</span>
      <div class="flex flex-col gap-4 animate-pulse motion-reduce:animate-none">
        <div v-for="n in 5" :key="n">
          <div class="h-4 bg-[#EEF2EC] rounded w-1/4 mb-2" aria-hidden="true"></div>
          <div class="h-10 bg-[#EEF2EC] rounded" aria-hidden="true"></div>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" role="alert" class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]">
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ error }} Vui lòng <button type="button" class="text-[#4A6741] font-bold underline" @click="fetchSettings()">thử lại</button>.
    </div>

    <div v-else class="flex flex-col gap-5">
      <!-- Provider Selector -->
      <div class="bg-white rounded-xl border border-[#e2ece3] p-6">
        <h3 class="text-[1.05rem] font-bold text-[#122815] m-0 mb-4">Chế độ lưu trữ hiện tại</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label
            class="flex gap-4 border-2 rounded-xl p-5 cursor-pointer transition-all"
            :class="settings.media_provider === 'local' ? 'border-[#2c6e33] bg-[#f8faf8]' : 'border-[#e2ece3] hover:border-[#8ed694]'"
          >
            <input type="radio" value="local" v-model="settings.media_provider" class="mt-1 accent-[#2c6e33] shrink-0" />
            <div>
              <strong class="block text-[0.95rem] text-[#122815] mb-1">📁 Máy chủ Local (VPS)</strong>
              <p class="m-0 text-[0.82rem] text-[#667768]">Lưu vào thư mục <code class="bg-[#f0f7f1] px-1 rounded text-xs">/public/uploads/</code> trên máy chủ. Nhẹ, tiện lợi, không cần tài khoản cloud.</p>
            </div>
          </label>

          <label
            class="flex gap-4 border-2 rounded-xl p-5 cursor-pointer transition-all"
            :class="settings.media_provider === 'r2' ? 'border-[#2c6e33] bg-[#f8faf8]' : 'border-[#e2ece3] hover:border-[#8ed694]'"
          >
            <input type="radio" value="r2" v-model="settings.media_provider" class="mt-1 accent-[#2c6e33] shrink-0" />
            <div>
              <strong class="block text-[0.95rem] text-[#122815] mb-1">☁️ Cloudflare R2 (Object Storage)</strong>
              <p class="m-0 text-[0.82rem] text-[#667768]">Lưu trực tiếp lên Cloudflare R2. Tải nhanh toàn cầu, băng thông miễn phí (10GB/tháng free).</p>
            </div>
          </label>
        </div>
      </div>

      <!-- R2 Credentials Form -->
      <div v-if="settings.media_provider === 'r2'" class="bg-white rounded-xl border border-[#e2ece3] p-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h3 class="text-[1.05rem] font-bold text-[#122815] m-0">Thông số kết nối Cloudflare R2</h3>
          <button
            class="inline-flex items-center gap-2 bg-[#f0f7f1] text-[#2c6e33] border border-[#8ed694] px-3.5 py-2 rounded-lg font-bold cursor-pointer text-[0.82rem] hover:bg-[#e4f2e5] transition-colors disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
            :disabled="testingR2"
            @click="handleTestR2"
          >
            <i class="fa-solid fa-plug"></i>
            {{ testingR2 ? 'Đang kiểm tra...' : 'Kiểm Tra Kết Nối R2' }}
          </button>
        </div>

        <div v-if="testMessage" role="status" class="bg-[#e4f2e5] text-[#2c6e33] px-4 py-3 rounded-lg text-[0.9rem] font-bold mb-4">{{ testMessage }}</div>
        <div v-if="testError" role="alert" class="bg-[#ffebe9] text-[#d12420] px-4 py-3 rounded-lg text-[0.85rem] mb-4">{{ testError }}</div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="flex flex-col gap-1.5">
            <label for="r2-account-id" class="text-[0.82rem] font-bold text-[#2c3e2e]">Cloudflare Account ID (*)</label>
            <input id="r2-account-id" type="text" v-model="settings.r2_account_id" placeholder="32 ký tự hex, vd: 4f8b9…c312" maxlength="32" spellcheck="false" autocomplete="off" :aria-invalid="Boolean(accountIdError)" aria-describedby="r2-account-id-hint" class="w-full px-3.5 py-2.5 border rounded-lg text-sm font-mono outline-none focus:border-[#2c6e33] box-border" :class="accountIdError ? 'border-[#B04A4A]' : 'border-[#c8d6c9]'" />
            <span id="r2-account-id-hint" class="text-[0.75rem]" :class="accountIdError ? 'text-[#B04A4A] font-semibold' : 'text-[#667768]'">{{ accountIdError || 'Đúng 32 ký tự hex (0-9, a-f). Đổi Account ID thì phải nhập lại Secret Access Key.' }}</span>
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="r2-bucket" class="text-[0.82rem] font-bold text-[#2c3e2e]">Bucket Name (*)</label>
            <input id="r2-bucket" type="text" v-model="settings.r2_bucket" placeholder="eg: cdkt-uploads" spellcheck="false" autocomplete="off" :aria-invalid="Boolean(bucketError)" :aria-describedby="bucketError ? 'r2-bucket-error' : undefined" class="w-full px-3.5 py-2.5 border rounded-lg text-sm outline-none focus:border-[#2c6e33] box-border" :class="bucketError ? 'border-[#B04A4A]' : 'border-[#c8d6c9]'" />
            <span v-if="bucketError" id="r2-bucket-error" class="text-[0.75rem] text-[#B04A4A] font-semibold">{{ bucketError }}</span>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Access Key ID (*)</label>
            <input type="text" v-model="settings.r2_access_key" placeholder="eg: a1b2c3d4e5f6..." class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="r2-secret" class="text-[0.82rem] font-bold text-[#2c3e2e]">Secret Access Key (*)</label>
            <input id="r2-secret" type="password" v-model="settings.r2_secret_key" placeholder="••••••••••••••••" autocomplete="new-password" :aria-invalid="Boolean(secretError)" aria-describedby="r2-secret-hint" class="w-full px-3.5 py-2.5 border rounded-lg text-sm outline-none focus:border-[#2c6e33] box-border" :class="secretError ? 'border-[#B04A4A]' : 'border-[#c8d6c9]'" />
            <span id="r2-secret-hint" class="text-[0.75rem]" :class="secretError || (secretNeedsReentry && !secretRetyped) ? 'text-[#B04A4A] font-semibold' : 'text-[#667768]'">{{ secretHint }}</span>
          </div>
          <div class="flex flex-col gap-1.5 sm:col-span-2">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Public Domain / R2 Public URL (*)</label>
            <input type="text" v-model="settings.r2_public_url" placeholder="eg: https://cdn.conduonghuongthien.com.vn" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] box-border" />
            <span class="text-[0.75rem] text-[#888]">Tên miền công khai được gắn vào R2 bucket (Custom Domain hoặc pub-xxx.r2.dev)</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
