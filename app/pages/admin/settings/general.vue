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
  <div class="settings-page">
    <div class="page-header">
      <div>
        <h1>Cài Đặt Chung Website</h1>
        <p>Chỉnh sửa các thông tin hotline, địa chỉ, email và logo của website</p>
      </div>
      <button class="primary-btn" :disabled="saving" @click="handleSave">
        <i class="fa-regular" :class="saving ? 'fa-spinner animate-spin' : 'fa-floppy-disk'"></i>
        {{ saving ? 'Đang lưu...' : 'Lưu Cài Đặt' }}
      </button>
    </div>

    <div v-if="loading" class="loading-state">Đang tải cài đặt...</div>

    <div v-else class="settings-grid">
      <div class="card">
        <h3>Thông tin cơ bản</h3>
        <div class="form-group">
          <label>Tên Website</label>
          <input type="text" v-model="settings.site_name" />
        </div>
        <div class="form-group">
          <label>Mô tả Website (SEO Meta)</label>
          <textarea rows="3" v-model="settings.site_description"></textarea>
        </div>
      </div>

      <div class="card">
        <h3>Thông tin liên hệ</h3>
        <div class="form-group">
          <label>Hotline Hỗ Trợ (*)</label>
          <input type="text" v-model="settings.hotline" />
        </div>
        <div class="form-group">
          <label>Email Liên Hệ</label>
          <input type="email" v-model="settings.email" />
        </div>
        <div class="form-group">
          <label>Địa Chỉ Cơ Quan</label>
          <input type="text" v-model="settings.address" />
        </div>
        <div class="form-group">
          <label>Đường dẫn Trang Fanpage / Facebook</label>
          <input type="text" v-model="settings.facebook_url" />
        </div>
      </div>

      <!-- Hình ảnh & Logo — giờ có picker + upload + preview -->
      <div class="card full">
        <h3>Hình ảnh & Logo</h3>

        <!-- Logo -->
        <div class="form-group">
          <label>Logo Website</label>
          <div class="img-field">
            <input type="text" v-model="settings.logo_url" placeholder="URL hoặc chọn từ thư viện" />
            <button type="button" class="img-btn" @click="pickImage('logo_url')">
              <i class="fa-regular fa-images"></i> Thư viện
            </button>
            <label class="img-btn upload" :class="{ disabled: uploading }">
              <i class="fa-regular" :class="uploading ? 'fa-spinner animate-spin' : 'fa-cloud-arrow-up'"></i>
              Upload
              <input type="file" accept="image/*" class="sr-only" :disabled="uploading" @change="(e) => uploadImage(e, 'logo_url')" />
            </label>
          </div>
          <div v-if="settings.logo_url" class="img-preview">
            <img :src="settings.logo_url" alt="Logo preview" />
            <button type="button" @click="settings.logo_url = ''"><i class="fa-regular fa-xmark"></i></button>
          </div>
        </div>

        <!-- Hero Banner -->
        <div class="form-group">
          <label>Ảnh Hero Banner Trang Chủ</label>
          <div class="img-field">
            <input type="text" v-model="settings.hero_banner_url" placeholder="URL hoặc chọn từ thư viện" />
            <button type="button" class="img-btn" @click="pickImage('hero_banner_url')">
              <i class="fa-regular fa-images"></i> Thư viện
            </button>
            <label class="img-btn upload" :class="{ disabled: uploading }">
              <i class="fa-regular" :class="uploading ? 'fa-spinner animate-spin' : 'fa-cloud-arrow-up'"></i>
              Upload
              <input type="file" accept="image/*" class="sr-only" :disabled="uploading" @change="(e) => uploadImage(e, 'hero_banner_url')" />
            </label>
          </div>
          <div v-if="settings.hero_banner_url" class="img-preview wide">
            <img :src="settings.hero_banner_url" alt="Banner preview" />
            <button type="button" @click="settings.hero_banner_url = ''"><i class="fa-regular fa-xmark"></i></button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page { display: flex; flex-direction: column; gap: 20px; }

.page-header { display: flex; justify-content: space-between; align-items: center; }
.page-header h1 { font-size: 1.3rem; font-weight: 800; margin: 0; color: #122815; }
.page-header p { font-size: 0.85rem; color: #667768; margin: 4px 0 0 0; }

.primary-btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: #1e4620; color: white; border: none;
  padding: 10px 20px; border-radius: 8px; font-weight: 700; cursor: pointer;
  transition: background 0.15s;
}
.primary-btn:hover:not(:disabled) { background: #2c6e33; }
.primary-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.card { background: white; padding: 24px; border-radius: 12px; border: 1px solid #e2ece3; }
.card.full { grid-column: span 2; }
.card h3 { margin: 0 0 16px 0; font-size: 1.05rem; color: #122815; }

.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-size: 0.82rem; font-weight: 700; margin-bottom: 6px; }
.form-group input, .form-group textarea {
  width: 100%; padding: 10px 14px; border: 1px solid #c8d6c9;
  border-radius: 8px; box-sizing: border-box; font-size: 0.875rem;
}
.form-group input:focus, .form-group textarea:focus {
  outline: none; border-color: #2c6e33; box-shadow: 0 0 0 3px rgba(44,110,51,.1);
}

/* Image field row */
.img-field { display: flex; gap: 6px; align-items: center; }
.img-field input { flex: 1; }
.img-btn {
  display: inline-flex; align-items: center; gap: 5px;
  height: 38px; padding: 0 12px; border-radius: 8px; font-size: 0.8rem;
  font-weight: 600; cursor: pointer; white-space: nowrap; border: 1px solid #c8d6c9;
  background: #f4f7f4; color: #1e4620; transition: background 0.15s;
  flex-shrink: 0;
}
.img-btn:hover:not(.disabled) { background: #e6f2e6; border-color: #2c6e33; }
.img-btn.upload { background: #1e4620; color: white; border-color: #1e4620; }
.img-btn.upload:hover:not(.disabled) { background: #2c6e33; }
.img-btn.disabled { opacity: 0.6; cursor: not-allowed; pointer-events: none; }

/* Preview */
.img-preview {
  margin-top: 8px; position: relative; display: inline-block;
  border: 1px solid #e2ece3; border-radius: 8px; overflow: hidden;
}
.img-preview img { display: block; max-height: 80px; max-width: 200px; object-fit: contain; }
.img-preview.wide img { max-height: 120px; max-width: 400px; }
.img-preview button {
  position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.55);
  color: white; border: none; border-radius: 50%; width: 22px; height: 22px;
  font-size: 0.75rem; cursor: pointer; display: flex; align-items: center; justify-content: center;
}

.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
.loading-state { text-align: center; padding: 40px; color: #667768; }
</style>
