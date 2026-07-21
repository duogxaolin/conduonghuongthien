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
const saving = ref(false)
const testingR2 = ref(false)
const testMessage = ref('')
const testError = ref('')
const saveMessage = ref('')

const fetchSettings = async () => {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/settings')
    if (res.ok && res.settings) {
      Object.assign(settings, res.settings)
    }
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Lỗi tải cài đặt lưu trữ')
  } finally {
    loading.value = false
  }
}

const handleSave = async () => {
  saving.value = true
  saveMessage.value = ''
  try {
    const res = await $fetch('/api/admin/settings', {
      method: 'PUT',
      body: { settings }
    })
    if (res.ok) {
      saveMessage.value = '✅ Đã lưu cấu hình lưu trữ Media thành công!'
    }
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Lỗi lưu cấu hình')
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
      body: {
        accountId: settings.r2_account_id,
        accessKeyId: settings.r2_access_key,
        secretAccessKey: settings.r2_secret_key,
        bucket: settings.r2_bucket,
      }
    })
    if (res.ok) {
      testMessage.value = '🎉 ' + res.message
    }
  } catch (err: any) {
    testError.value = err?.data?.statusMessage || 'Kết nối R2 thất bại'
  } finally {
    testingR2.value = false
  }
}

onMounted(() => {
  fetchSettings()
})
</script>

<template>
  <div class="media-settings-page">
    <div class="page-header">
      <div>
        <h1>Cấu Hình Lưu Trữ Media (Local vs Cloudflare R2)</h1>
        <p>Tùy chọn lưu trữ file trực tiếp trên Server VPS hoặc Cloudflare R2 Cloud Storage</p>
      </div>
      <button class="primary-btn" :disabled="saving" @click="handleSave">
        <span v-if="saving">Đang lưu...</span>
        <span v-else>💾 Lưu Cấu Hình</span>
      </button>
    </div>

    <div v-if="saveMessage" class="success-alert">{{ saveMessage }}</div>

    <div v-if="loading" class="loading-state">Đang tải cấu hình...</div>

    <div v-else class="settings-container">
      <!-- Provider Selector -->
      <div class="card">
        <h3>Chế độ lưu trữ hiện tại</h3>
        <div class="provider-options">
          <label class="option-card" :class="{ active: settings.media_provider === 'local' }">
            <input type="radio" value="local" v-model="settings.media_provider" />
            <div class="option-info">
              <strong>📁 Máy chủ Local (VPS)</strong>
              <p>Lưu vào thư mục <code>/public/uploads/</code> trên máy chủ. Nhẹ, tiện lợi, không cần tài khoản cloud.</p>
            </div>
          </label>

          <label class="option-card" :class="{ active: settings.media_provider === 'r2' }">
            <input type="radio" value="r2" v-model="settings.media_provider" />
            <div class="option-info">
              <strong>☁️ Cloudflare R2 (Object Storage)</strong>
              <p>Lưu trực tiếp lên Cloudflare R2. Tải nhanh toàn cầu, băng thông miễn phí (10GB/tháng free).</p>
            </div>
          </label>
        </div>
      </div>

      <!-- R2 Credentials Form -->
      <div class="card" v-if="settings.media_provider === 'r2'">
        <div class="card-title-row">
          <h3>Thông số kết nối Cloudflare R2</h3>
          <button class="test-btn" :disabled="testingR2" @click="handleTestR2">
            <span v-if="testingR2">Đang kiểm tra...</span>
            <span v-else>🔌 Kiểm Tra Kết Nối R2</span>
          </button>
        </div>

        <div v-if="testMessage" class="success-alert">{{ testMessage }}</div>
        <div v-if="testError" class="error-alert">⚠️ {{ testError }}</div>

        <div class="form-grid">
          <div class="form-group">
            <label>Cloudflare Account ID (*)</label>
            <input type="text" v-model="settings.r2_account_id" placeholder="eg: 4f8b9...c312" />
          </div>

          <div class="form-group">
            <label>Bucket Name (*)</label>
            <input type="text" v-model="settings.r2_bucket" placeholder="eg: cdkt-uploads" />
          </div>

          <div class="form-group">
            <label>Access Key ID (*)</label>
            <input type="text" v-model="settings.r2_access_key" placeholder="eg: a1b2c3d4e5f6..." />
          </div>

          <div class="form-group">
            <label>Secret Access Key (*)</label>
            <input type="password" v-model="settings.r2_secret_key" placeholder="••••••••••••••••" />
          </div>

          <div class="form-group full">
            <label>Public Domain / R2 Public URL (*)</label>
            <input type="text" v-model="settings.r2_public_url" placeholder="eg: https://cdn.conduonghuongthien.com.vn" />
            <span class="field-hint">Tên miền công khai được gắn vào R2 bucket (Custom Domain hoặc pub-xxx.r2.dev)</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.media-settings-page {
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

.error-alert {
  background: #ffebe9;
  color: #d12420;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 0.85rem;
}

.settings-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.card {
  background: white;
  padding: 24px;
  border-radius: 12px;
  border: 1px solid #e2ece3;
}

.card h3 {
  margin: 0 0 16px 0;
  font-size: 1.05rem;
  color: #122815;
}

.card-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.test-btn {
  background: #f0f7f1;
  color: #2c6e33;
  border: 1px solid #8ed694;
  padding: 8px 14px;
  border-radius: 6px;
  font-weight: 700;
  cursor: pointer;
  font-size: 0.82rem;
}

.provider-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.option-card {
  border: 2px solid #e2ece3;
  padding: 20px;
  border-radius: 12px;
  cursor: pointer;
  display: flex;
  gap: 16px;
  transition: all 0.2s;
}

.option-card.active {
  border-color: #2c6e33;
  background: #f8faf8;
}

.option-info strong {
  display: block;
  font-size: 0.95rem;
  margin-bottom: 4px;
}

.option-info p {
  margin: 0;
  font-size: 0.82rem;
  color: #667768;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 16px;
}

.form-group.full {
  grid-column: span 2;
}

.form-group label {
  display: block;
  font-size: 0.82rem;
  font-weight: 700;
  margin-bottom: 6px;
}

.form-group input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid #c8d6c9;
  border-radius: 8px;
  box-sizing: border-box;
}

.field-hint {
  font-size: 0.75rem;
  color: #888;
  margin-top: 4px;
  display: block;
}
</style>
