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
  favicon_url: '/favicon-32.png',
})

const loading = ref(true)
const error = ref('')
const saving = ref(false)
const toast = useToast()
const { openPicker } = useImagePicker()
const { uploading, uploadFile } = useUpload()

const fetchSettings = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch('/api/admin/settings')
    if (res.ok && res.settings) {
      Object.assign(settings, res.settings)
    } else {
      error.value = 'Không tải được cài đặt website.'
    }
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không tải được cài đặt website.')
  } finally {
    loading.value = false
  }
}

const handleSave = async () => {
  saving.value = true
  try {
    const res = await $fetch('/api/admin/settings', { method: 'PUT', body: { settings } })
    if (res.ok) toast.success('Đã lưu cài đặt website thành công!')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi lưu cài đặt'))
  } finally {
    saving.value = false
  }
}

/**
 * Một alias, không phải hai danh sách giống nhau.
 *
 * `pickImage` và `uploadImage` đã nhận field làm tham số từ trước, nên thêm ô
 * favicon chỉ là thêm một tên vào đây. Viết rời ở cả hai chữ ký thì lần thêm ô
 * thứ tư sẽ sửa đúng một chỗ, và nút còn lại vẫn biên dịch được — nó chỉ đơn giản
 * là không bao giờ ghi vào đúng khoá.
 */
type ImageField = 'logo_url' | 'hero_banner_url' | 'favicon_url'

const pickImage = (field: ImageField) => {
  openPicker({ onSelect: (media) => { settings[field] = media.url } })
}

const uploadImage = async (event: Event, field: ImageField) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const media = await uploadFile(file)
  if (media) settings[field] = media.url
  ;(event.target as HTMLInputElement).value = ''
}

/**
 * Favicon đi qua endpoint RIÊNG, không qua `uploadImage`.
 *
 * `uploadImage` lưu **nguyên** tệp cán bộ chọn rồi dán URL vào ô. Với favicon thì
 * đó là lỗi: ảnh cán bộ có trong tay là logo cơ quan, thường 1200×800 và vài trăm
 * KB, nên nó sẽ tải trên **mọi** trang của cổng và bị trình duyệt bóp méo vì không
 * vuông. `/api/admin/settings/favicon` **sinh** bộ 32/180/ico đúng cỡ.
 *
 * Endpoint đó tự ghi CSDL, nên ô này **có hiệu lực ngay** mà không cần bấm "Lưu Cài
 * Đặt" — khác mọi ô khác trên trang. Sự bất đối xứng đó là hệ quả của việc nó phải
 * ghi tệp ra đĩa (không thể hoãn tới lượt lưu chung), nên nút phải nói ra: một thay
 * đổi đã có hiệu lực mà trông như đang chờ lưu là cách cán bộ bỏ trang đi mà tưởng
 * mình chưa đổi gì.
 */
const uploadingFavicon = ref(false)

const uploadFavicon = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  uploadingFavicon.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    const res = await $fetch('/api/admin/settings/favicon', { method: 'POST', body: form })

    settings.favicon_url = res.faviconUrl

    // Nói ra phần đã âm thầm xảy ra. JPEG không có kênh alpha nên nền trong suốt sẽ
    // thành nền đen; máy chủ chuyển sang PNG để tránh, và cán bộ cần biết vì tệp họ
    // chọn không còn là tệp cổng đang dùng.
    const converted = res.convertedToPng ? ' (đã chuyển sang PNG để giữ nền trong suốt)' : ''
    toast.success(`Đã đặt favicon mới và áp dụng ngay${converted}.`)
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể đặt favicon'))
  } finally {
    uploadingFavicon.value = false
    input.value = ''
  }
}

/**
 * Trả favicon về bộ mặc định.
 *
 * Xoá ô trống rồi bấm "Lưu Cài Đặt" **không** đủ: lượt lưu chung ghi một chuỗi rỗng
 * vào `favicon_url`, nhưng `favicon_ico_url` — bản `.ico` dẫn xuất — là một khoá
 * riêng mà biểu mẫu này không biết tới, nên tuyến `/favicon.ico` sẽ còn phục vụ icon
 * cũ. Endpoint `DELETE` xoá cả hai khoá trong một transaction.
 */
const resettingFavicon = ref(false)

const resetFavicon = async () => {
  resettingFavicon.value = true
  try {
    await $fetch('/api/admin/settings/favicon', { method: 'DELETE' })
    settings.favicon_url = ''
    toast.success('Đã trả favicon về mặc định của cổng.')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể trả favicon về mặc định'))
  } finally {
    resettingFavicon.value = false
  }
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

    <!-- Loading -->
    <div v-if="loading" role="status" aria-busy="true" class="grid grid-cols-1 md:grid-cols-2 gap-5">
      <span class="sr-only">Đang tải cài đặt chung website</span>
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

          <!-- Favicon.

               Nhãn nói rõ ba điều mà không có chúng thì cán bộ sẽ kết luận tính
               năng bị hỏng: định dạng nhận được, kích thước nên dùng, và **rằng
               trình duyệt giữ favicon rất lâu trong bộ nhớ đệm**. Điều thứ ba là
               phần dễ bỏ nhất và cũng là phần sinh ra nhiều báo lỗi giả nhất —
               đổi xong, tải lại trang, không thấy gì đổi. -->
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Favicon (icon trên tab trình duyệt)</label>
            <div class="flex gap-2 items-center flex-wrap">
              <input type="text" v-model="settings.favicon_url" placeholder="URL hoặc chọn từ thư viện" class="flex-1 min-w-0 px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
              <button type="button" class="inline-flex items-center gap-1.5 h-[38px] px-3 border border-[#c8d6c9] bg-[#f4f7f4] text-[#1e4620] rounded-lg text-[0.8rem] font-semibold cursor-pointer hover:bg-[#e6f2e6] hover:border-[#2c6e33] transition-colors shrink-0" @click="pickImage('favicon_url')">
                <i class="fa-regular fa-images"></i> Thư viện
              </button>
              <label class="inline-flex items-center gap-1.5 h-[38px] px-3 bg-[#1e4620] hover:bg-[#2c6e33] text-white rounded-lg text-[0.8rem] font-semibold cursor-pointer transition-colors shrink-0" :class="{ 'opacity-60 cursor-not-allowed pointer-events-none': uploadingFavicon }">
                <i class="fa-regular" :class="uploadingFavicon ? 'fa-spinner animate-spin' : 'fa-wand-magic-sparkles'"></i>
                {{ uploadingFavicon ? 'Đang xử lý...' : 'Tải ảnh & tự tạo' }}
                <input type="file" accept=".png,.jpg,.jpeg,.ico,image/png,image/jpeg,image/x-icon" class="sr-only" :disabled="uploadingFavicon" @change="uploadFavicon" />
              </label>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 h-[38px] px-3 border border-[#c8d6c9] bg-white text-[#667768] rounded-lg text-[0.8rem] font-semibold cursor-pointer hover:bg-[#f4f7f4] transition-colors shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
                :disabled="resettingFavicon"
                @click="resetFavicon"
              >
                <i class="fa-regular" :class="resettingFavicon ? 'fa-spinner animate-spin' : 'fa-rotate-left'"></i> Về mặc định
              </button>
            </div>
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">
              Nhận <strong>PNG</strong>, <strong>JPG</strong> hoặc <strong>ICO</strong>. Nút
              <strong>Tải ảnh &amp; tự tạo</strong> tự thu nhỏ và tạo đủ bộ icon (32×32 cho tab,
              180×180 cho iOS, và tệp <code>.ico</code>) — nên chọn ảnh vuông, không cần đúng kích thước sẵn.
              Ảnh JPG sẽ được chuyển sang PNG để giữ nền trong suốt.
            </p>
            <p class="text-[0.72rem] text-[#8a6d3b] m-0">
              <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>
              Nút <strong>Tải ảnh &amp; tự tạo</strong> và <strong>Về mặc định</strong> có hiệu lực
              <strong>ngay</strong>, không cần bấm "Lưu Cài Đặt". Trình duyệt giữ favicon trong bộ nhớ đệm
              rất lâu, nên nếu chưa thấy icon mới thì hãy mở tab mới hoặc tải lại trang bỏ qua bộ nhớ đệm
              (Ctrl/Cmd + Shift + R).
            </p>
            <div v-if="settings.favicon_url" class="mt-2 relative inline-block border border-[#e2ece3] rounded-lg overflow-hidden">
              <!-- `max-h-8`: favicon là ảnh nhỏ, hiện to 80px như logo sẽ vẽ nó
                   ở kích thước không ai thấy trên thực tế. -->
              <img :src="settings.favicon_url" alt="Favicon preview" class="block max-h-8 max-w-[64px] object-contain" />
              <button type="button" class="absolute top-0.5 right-0.5 bg-black/55 text-white border-0 rounded-full w-4 h-4 flex items-center justify-center text-[0.6rem] cursor-pointer" @click="settings.favicon_url = ''"><i class="fa-regular fa-xmark"></i></button>
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
