<script setup lang="ts">
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

const fetchSettings = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch('/api/admin/settings')
    if (res.ok && res.settings) {
      Object.assign(settings, res.settings)
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
  saving.value = true
  try {
    const res = await $fetch('/api/admin/settings', { method: 'PUT', body: { settings } })
    if (res.ok) toast.success('Đã lưu cấu hình lưu trữ Media thành công!')
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
    const res = await $fetch('/api/admin/settings/test-r2', {
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

        <div v-if="testMessage" class="bg-[#e4f2e5] text-[#2c6e33] px-4 py-3 rounded-lg text-[0.9rem] font-bold mb-4">{{ testMessage }}</div>
        <div v-if="testError" class="bg-[#ffebe9] text-[#d12420] px-4 py-3 rounded-lg text-[0.85rem] mb-4">{{ testError }}</div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Cloudflare Account ID (*)</label>
            <input type="text" v-model="settings.r2_account_id" placeholder="eg: 4f8b9...c312" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Bucket Name (*)</label>
            <input type="text" v-model="settings.r2_bucket" placeholder="eg: cdkt-uploads" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Access Key ID (*)</label>
            <input type="text" v-model="settings.r2_access_key" placeholder="eg: a1b2c3d4e5f6..." class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Secret Access Key (*)</label>
            <input type="password" v-model="settings.r2_secret_key" placeholder="••••••••••••••••" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] box-border" />
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
