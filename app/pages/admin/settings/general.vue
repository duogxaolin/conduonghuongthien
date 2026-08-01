<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const settings = reactive({
  site_name: 'Con Đường Hướng Thiện',
  site_description: 'Cổng thông tin điện tử hỗ trợ người hoàn lương tái hòa nhập cộng đồng',
  hotline: '0903.480.985',
  email: 'contact@conduonghuongthien.com.vn',
  address: 'Thôn Phượng Mỹ, xã Tam Hưng, thành phố Hà Nội',
  facebook_url: 'https://facebook.com',
  logo_url: '/Logo.png',
  hero_banner_url: '/assets/hero_banner.jpg',
})

const loading = ref(true)
const saving = ref(false)
const toast = useToast()
const { openPicker } = useImagePicker()
const { uploading, uploadFile } = useUpload()

const fetchSettings = async () => {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/settings')
    if (res.ok && res.settings) Object.assign(settings, res.settings)
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi tải cài đặt')
  } finally {
    loading.value = false
  }
}

const handleSave = async () => {
  saving.value = true
  try {
    const res = await $fetch('/api/admin/settings', { method: 'PUT', body: { settings } })
    if (res.ok) toast.success('Đã lưu cài đặt website thành công!')
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi lưu cài đặt')
  } finally {
    saving.value = false
  }
}

const pickImage = (field: 'logo_url' | 'hero_banner_url') => {
  openPicker({ onSelect: (media) => { settings[field] = media.url } })
}

const uploadImage = async (event: Event, field: 'logo_url' | 'hero_banner_url') => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const media = await uploadFile(file)
  if (media) settings[field] = media.url
  ;(event.target as HTMLInputElement).value = ''
}

onMounted(() => { fetchSettings() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Cài Đặt Chung Website</h1>
        <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Chỉnh sửa các thông tin hotline, địa chỉ, email và logo của website</p>
      </div>
      <button
        class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-5 py-2.5 rounded-lg cursor-pointer transition-colors border-0 disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
        :disabled="saving"
        @click="handleSave"
      >
        <i class="fa-regular" :class="saving ? 'fa-spinner animate-spin' : 'fa-floppy-disk'"></i>
        {{ saving ? 'Đang lưu...' : 'Lưu Cài Đặt' }}
      </button>
    </div>

    <div v-if="loading" class="grid grid-cols-1 md:grid-cols-2 gap-5">
      <SkeletonForm label="Đang tải cài đặt chung" :fields="4" />
      <SkeletonForm label="Đang tải cài đặt chung" :fields="4" :has-action="false" />
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-5">
      <!-- Basic Info -->
      <div class="bg-white rounded-xl border border-[#e2ece3] p-6">
        <h3 class="text-[1.05rem] font-bold text-[#122815] m-0 mb-4">Thông tin cơ bản</h3>
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Tên Website</label>
            <input type="text" v-model="settings.site_name" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Mô tả Website (SEO Meta)</label>
            <textarea rows="3" v-model="settings.site_description" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border resize-none"></textarea>
          </div>
        </div>
      </div>

      <!-- Contact Info -->
      <div class="bg-white rounded-xl border border-[#e2ece3] p-6">
        <h3 class="text-[1.05rem] font-bold text-[#122815] m-0 mb-4">Thông tin liên hệ</h3>
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Hotline Hỗ Trợ (*)</label>
            <input type="text" v-model="settings.hotline" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Email Liên Hệ</label>
            <input type="email" v-model="settings.email" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Địa Chỉ Cơ Quan</label>
            <input type="text" v-model="settings.address" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Đường dẫn Trang Fanpage / Facebook</label>
            <input type="text" v-model="settings.facebook_url" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
          </div>
        </div>
      </div>

      <!-- Images & Logo (full width) -->
      <div class="bg-white rounded-xl border border-[#e2ece3] p-6 md:col-span-2">
        <h3 class="text-[1.05rem] font-bold text-[#122815] m-0 mb-4">Hình ảnh & Logo</h3>
        <div class="flex flex-col gap-5">
          <!-- Logo -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Logo Website</label>
            <div class="flex gap-2 items-center flex-wrap">
              <input type="text" v-model="settings.logo_url" placeholder="URL hoặc chọn từ thư viện" class="flex-1 min-w-0 px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
              <button type="button" class="inline-flex items-center gap-1.5 h-[38px] px-3 border border-[#c8d6c9] bg-[#f4f7f4] text-[#1e4620] rounded-lg text-[0.8rem] font-semibold cursor-pointer hover:bg-[#e6f2e6] hover:border-[#2c6e33] transition-colors shrink-0" @click="pickImage('logo_url')">
                <i class="fa-regular fa-images"></i> Thư viện
              </button>
              <label class="inline-flex items-center gap-1.5 h-[38px] px-3 bg-[#1e4620] hover:bg-[#2c6e33] text-white rounded-lg text-[0.8rem] font-semibold cursor-pointer transition-colors shrink-0" :class="{ 'opacity-60 cursor-not-allowed pointer-events-none': uploading }">
                <i class="fa-regular" :class="uploading ? 'fa-spinner animate-spin' : 'fa-cloud-arrow-up'"></i> Upload
                <input type="file" accept="image/*" class="sr-only" :disabled="uploading" @change="(e) => uploadImage(e, 'logo_url')" />
              </label>
            </div>
            <div v-if="settings.logo_url" class="mt-2 relative inline-block border border-[#e2ece3] rounded-lg overflow-hidden">
              <img :src="settings.logo_url" alt="Logo preview" class="block max-h-20 max-w-[200px] object-contain" />
              <button type="button" class="absolute top-1 right-1 bg-black/55 text-white border-0 rounded-full w-5 h-5 flex items-center justify-center text-xs cursor-pointer" @click="settings.logo_url = ''"><i class="fa-regular fa-xmark"></i></button>
            </div>
          </div>

          <!-- Hero Banner -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Ảnh Hero Banner Trang Chủ</label>
            <div class="flex gap-2 items-center flex-wrap">
              <input type="text" v-model="settings.hero_banner_url" placeholder="URL hoặc chọn từ thư viện" class="flex-1 min-w-0 px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
              <button type="button" class="inline-flex items-center gap-1.5 h-[38px] px-3 border border-[#c8d6c9] bg-[#f4f7f4] text-[#1e4620] rounded-lg text-[0.8rem] font-semibold cursor-pointer hover:bg-[#e6f2e6] hover:border-[#2c6e33] transition-colors shrink-0" @click="pickImage('hero_banner_url')">
                <i class="fa-regular fa-images"></i> Thư viện
              </button>
              <label class="inline-flex items-center gap-1.5 h-[38px] px-3 bg-[#1e4620] hover:bg-[#2c6e33] text-white rounded-lg text-[0.8rem] font-semibold cursor-pointer transition-colors shrink-0" :class="{ 'opacity-60 cursor-not-allowed pointer-events-none': uploading }">
                <i class="fa-regular" :class="uploading ? 'fa-spinner animate-spin' : 'fa-cloud-arrow-up'"></i> Upload
                <input type="file" accept="image/*" class="sr-only" :disabled="uploading" @change="(e) => uploadImage(e, 'hero_banner_url')" />
              </label>
            </div>
            <div v-if="settings.hero_banner_url" class="mt-2 relative inline-block border border-[#e2ece3] rounded-lg overflow-hidden">
              <img :src="settings.hero_banner_url" alt="Banner preview" class="block max-h-[120px] max-w-[400px] object-contain" />
              <button type="button" class="absolute top-1 right-1 bg-black/55 text-white border-0 rounded-full w-5 h-5 flex items-center justify-center text-xs cursor-pointer" @click="settings.hero_banner_url = ''"><i class="fa-regular fa-xmark"></i></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
