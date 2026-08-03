<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

// All tracking/marketing tags live as string rows in the shared `settings`
// key/value table (no schema change). tracking_enabled is a '1'/'0' master
// switch — when '0', the Nitro plugin injects nothing.
const settings = reactive({
  tracking_enabled: '0',
  ga4_measurement_id: '',
  gtm_container_id: '',
  google_ads_id: '',
  google_ads_conversion_label: '',
  google_site_verification: '',
  facebook_pixel_id: '',
  tiktok_pixel_id: '',
  clarity_project_id: '',
  tracking_custom_head: '',
  tracking_custom_body: '',
})

const loading = ref(true)
const error = ref('')
const saving = ref(false)
const toast = useToast()

const enabled = computed({
  get: () => settings.tracking_enabled === '1',
  set: (v: boolean) => { settings.tracking_enabled = v ? '1' : '0' },
})

// ─── Client-side format validation (mirrors server anchored regexes) ─────────
// A malformed id is silently skipped by the server plugin, so we validate here
// to give the admin feedback BEFORE saving. Empty value = valid (optional).
const ID_RULES: Array<{ key: keyof typeof settings; re: RegExp }> = [
  { key: 'ga4_measurement_id', re: /^G-[A-Z0-9]+$/ },
  { key: 'gtm_container_id', re: /^GTM-[A-Z0-9]+$/ },
  { key: 'google_ads_id', re: /^AW-[A-Z0-9]+$/ },
  { key: 'google_ads_conversion_label', re: /^[A-Za-z0-9_-]+$/ },
  { key: 'google_site_verification', re: /^[A-Za-z0-9_-]+$/ },
  { key: 'facebook_pixel_id', re: /^[A-Za-z0-9_-]+$/ },
  { key: 'tiktok_pixel_id', re: /^[A-Za-z0-9_-]+$/ },
  { key: 'clarity_project_id', re: /^[A-Za-z0-9_-]+$/ },
]

// Reactive map of field key → true when the current non-empty value is malformed.
const fieldErrors = computed(() => {
  const errs = {} as Record<keyof typeof settings, boolean>
  for (const { key, re } of ID_RULES) {
    const v = (settings[key] || '').trim()
    errs[key] = v.length > 0 && !re.test(v)
  }
  return errs
})

const hasErrors = computed(() => Object.values(fieldErrors.value).some(Boolean))

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
      error.value = 'Không tải được cấu hình theo dõi.'
    }
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Không tải được cấu hình theo dõi.'
  } finally {
    loading.value = false
  }
}

const handleSave = async () => {
  if (hasErrors.value) {
    toast.error('Một số mã theo dõi sai định dạng, vui lòng kiểm tra lại.')
    return
  }
  saving.value = true
  try {
    const res = await $fetch('/api/admin/settings', { method: 'PUT', body: { settings } })
    if (res.ok) toast.success('Đã lưu cấu hình Tracking & Marketing!')
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi lưu cài đặt')
  } finally {
    saving.value = false
  }
}

onMounted(() => { fetchSettings() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Tracking &amp; Marketing</h1>
        <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Cấu hình các mã theo dõi &amp; tiếp thị (GA4, GTM, Google Ads, Facebook/TikTok Pixel, Clarity...) — chèn tự động vào toàn bộ trang public phía máy chủ.</p>
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
    <div v-if="loading" role="status" aria-busy="true" class="bg-white rounded-xl border border-[#e2ece3] p-6">
      <span class="sr-only">Đang tải cấu hình theo dõi và marketing</span>
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

    <template v-else>
      <!-- Master switch -->
      <div class="bg-white rounded-xl border border-[#e2ece3] p-6">
        <label class="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" v-model="enabled" class="mt-1 w-5 h-5 accent-[#1e4620] cursor-pointer shrink-0" />
          <span>
            <span class="block text-[1.05rem] font-bold text-[#122815]">Kích hoạt Tracking toàn site</span>
            <span class="block text-[0.82rem] text-[#667768] mt-0.5">Khi tắt, hệ thống sẽ KHÔNG chèn bất kỳ mã theo dõi nào (kể cả mã tùy chỉnh) vào trang public. Trang admin và API luôn không bị chèn mã.</span>
          </span>
        </label>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <!-- Google -->
        <div class="bg-white rounded-xl border border-[#e2ece3] p-6 md:col-span-2">
          <h3 class="text-[1.05rem] font-bold text-[#122815] m-0 mb-4">Google (GA4 / GTM / Ads / Search Console)</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">GA4 Measurement ID</label>
              <input type="text" v-model="settings.ga4_measurement_id" placeholder="G-XXXXXXX" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
              <p class="text-[0.72rem] text-[#8a9a8c] m-0">Google Analytics 4 — dạng <code>G-XXXXXXX</code>.</p>
              <p v-if="fieldErrors.ga4_measurement_id" class="text-[0.72rem] font-bold text-red-600 m-0">Sai định dạng — cần dạng <code>G-XXXXXXX</code> (chữ IN HOA & số).</p>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Google Tag Manager ID</label>
              <input type="text" v-model="settings.gtm_container_id" placeholder="GTM-XXXXXX" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
              <p class="text-[0.72rem] text-[#8a9a8c] m-0">Container ID — dạng <code>GTM-XXXXXX</code>.</p>
              <p v-if="fieldErrors.gtm_container_id" class="text-[0.72rem] font-bold text-red-600 m-0">Sai định dạng — cần dạng <code>GTM-XXXXXX</code> (chữ IN HOA & số).</p>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Google Ads ID</label>
              <input type="text" v-model="settings.google_ads_id" placeholder="AW-XXXXXXXXX" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
              <p class="text-[0.72rem] text-[#8a9a8c] m-0">Global site tag — dạng <code>AW-XXXXXXXXX</code>.</p>
              <p v-if="fieldErrors.google_ads_id" class="text-[0.72rem] font-bold text-red-600 m-0">Sai định dạng — cần dạng <code>AW-XXXXXXXXX</code> (chữ IN HOA & số).</p>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Google Ads Conversion Label (tùy chọn)</label>
              <input type="text" v-model="settings.google_ads_conversion_label" placeholder="abcDEFghi" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
              <p class="text-[0.72rem] text-[#8a9a8c] m-0">Nhãn chuyển đổi đi kèm Google Ads ID (nếu có).</p>
              <p v-if="fieldErrors.google_ads_conversion_label" class="text-[0.72rem] font-bold text-red-600 m-0">Sai định dạng — chỉ gồm chữ, số, gạch ngang & gạch dưới.</p>
            </div>
            <div class="flex flex-col gap-1.5 md:col-span-2">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Google Search Console — Meta verification</label>
              <input type="text" v-model="settings.google_site_verification" placeholder="Chuỗi token xác minh" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
              <p class="text-[0.72rem] text-[#8a9a8c] m-0">Chỉ dán phần <code>content</code> của thẻ <code>&lt;meta name="google-site-verification"&gt;</code>.</p>
              <p v-if="fieldErrors.google_site_verification" class="text-[0.72rem] font-bold text-red-600 m-0">Sai định dạng — chỉ dán chuỗi token, không dán cả thẻ <code>&lt;meta&gt;</code>.</p>
            </div>
          </div>
        </div>

        <!-- Social -->
        <div class="bg-white rounded-xl border border-[#e2ece3] p-6">
          <h3 class="text-[1.05rem] font-bold text-[#122815] m-0 mb-4">Mạng xã hội (Facebook / TikTok)</h3>
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Meta / Facebook Pixel ID</label>
              <input type="text" v-model="settings.facebook_pixel_id" placeholder="1234567890" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
              <p class="text-[0.72rem] text-[#8a9a8c] m-0">Chuỗi số Pixel ID từ Meta Events Manager.</p>
              <p v-if="fieldErrors.facebook_pixel_id" class="text-[0.72rem] font-bold text-red-600 m-0">Sai định dạng — chỉ gồm chữ, số, gạch ngang & gạch dưới.</p>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">TikTok Pixel ID</label>
              <input type="text" v-model="settings.tiktok_pixel_id" placeholder="CXXXXXXXXXXXXXXXXX" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
              <p class="text-[0.72rem] text-[#8a9a8c] m-0">Pixel ID từ TikTok Events Manager.</p>
              <p v-if="fieldErrors.tiktok_pixel_id" class="text-[0.72rem] font-bold text-red-600 m-0">Sai định dạng — chỉ gồm chữ, số, gạch ngang & gạch dưới.</p>
            </div>
          </div>
        </div>

        <!-- Other -->
        <div class="bg-white rounded-xl border border-[#e2ece3] p-6">
          <h3 class="text-[1.05rem] font-bold text-[#122815] m-0 mb-4">Khác (Clarity)</h3>
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Microsoft Clarity Project ID</label>
              <input type="text" v-model="settings.clarity_project_id" placeholder="abcdef1234" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
              <p class="text-[0.72rem] text-[#8a9a8c] m-0">Project ID từ clarity.microsoft.com.</p>
              <p v-if="fieldErrors.clarity_project_id" class="text-[0.72rem] font-bold text-red-600 m-0">Sai định dạng — chỉ gồm chữ, số, gạch ngang & gạch dưới.</p>
            </div>
          </div>
        </div>

        <!-- Custom code -->
        <div class="bg-white rounded-xl border border-[#e2ece3] p-6 md:col-span-2">
          <h3 class="text-[1.05rem] font-bold text-[#122815] m-0 mb-1">Mã tùy chỉnh (Custom code)</h3>
          <div class="flex items-start gap-2 rounded-lg bg-[#fff7e6] border border-[#f0d9a8] px-3.5 py-2.5 mb-4">
            <i class="fa-solid fa-triangle-exclamation text-[#b8860b] mt-0.5"></i>
            <p class="text-[0.78rem] text-[#7a5b12] m-0">Chỉ dán mã từ nguồn tin cậy. Mã này chạy trên toàn bộ trang public và không được lọc/kiểm duyệt.</p>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Mã trong &lt;head&gt;</label>
              <textarea rows="6" v-model="settings.tracking_custom_head" placeholder="<!-- Mã tùy chỉnh chèn cuối <head> -->" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-[0.8rem] font-mono outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border resize-y"></textarea>
              <p class="text-[0.72rem] text-[#8a9a8c] m-0">Chèn ngay trước khi đóng thẻ <code>&lt;/head&gt;</code>.</p>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Mã đầu &lt;body&gt;</label>
              <textarea rows="6" v-model="settings.tracking_custom_body" placeholder="<!-- Mã tùy chỉnh chèn ngay sau <body> -->" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-[0.8rem] font-mono outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border resize-y"></textarea>
              <p class="text-[0.72rem] text-[#8a9a8c] m-0">Chèn ngay sau khi mở thẻ <code>&lt;body&gt;</code>.</p>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
