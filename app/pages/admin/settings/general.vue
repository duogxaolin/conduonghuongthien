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
const message = ref('')

const fetchSettings = async () => {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/settings')
    if (res.ok && res.settings) {
      Object.assign(settings, res.settings)
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi tải cài đặt')
  } finally {
    loading.value = false
  }
}

const handleSave = async () => {
  saving.value = true
  message.value = ''
  try {
    const res = await $fetch('/api/admin/settings', {
      method: 'PUT',
      body: { settings }
    })
    if (res.ok) {
      toast.success('Đã lưu cài đặt website thành công!')
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi lưu cài đặt')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  fetchSettings()
})
</script>

<template>
  <div class="settings-page">
    <div class="page-header">
      <div>
        <h1>Cài Đặt Chung Website</h1>
        <p>Chỉnh sửa các thông tin hotline, địa chỉ, email và logo của website</p>
      </div>
      <button class="primary-btn" :disabled="saving" @click="handleSave">
        <span v-if="saving">Đang lưu...</span>
        <span v-else>💾 Lưu Cài Đặt</span>
      </button>
    </div>

    <div v-if="message" class="success-alert">{{ message }}</div>

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

      <div class="card full">
        <h3>Hình ảnh & Logo</h3>
        <div class="form-group">
          <label>Logo Website (URL)</label>
          <input type="text" v-model="settings.logo_url" />
        </div>
        <div class="form-group">
          <label>Ảnh Hero Banner Trang Chủ (URL)</label>
          <input type="text" v-model="settings.hero_banner_url" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.page-header h1 {
  font-size: 1.3rem;
  font-weight: 800;
  margin: 0;
  color: #122815;
}

.page-header p {
  font-size: 0.85rem;
  color: #667768;
  margin: 4px 0 0 0;
}

.primary-btn {
  background: #1e4620;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
}

.success-alert {
  background: #e4f2e5;
  color: #2c6e33;
  padding: 12px 16px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 0.9rem;
}

.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.card {
  background: white;
  padding: 24px;
  border-radius: 12px;
  border: 1px solid #e2ece3;
}

.card.full {
  grid-column: span 2;
}

.card h3 {
  margin: 0 0 16px 0;
  font-size: 1.05rem;
  color: #122815;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 0.82rem;
  font-weight: 700;
  margin-bottom: 6px;
}

.form-group input, .form-group textarea {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid #c8d6c9;
  border-radius: 8px;
  box-sizing: border-box;
}
</style>
