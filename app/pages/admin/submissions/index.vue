<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const submissions = ref<any[]>([])
const loading = ref(true)
const search = ref('')
const typeFilter = ref('')
const selectedSub = ref<any>(null)

const toast = useToast()

const fetchSubmissions = async () => {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/submissions')
    if (res.ok) {
      submissions.value = res.submissions
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi tải danh sách đơn đăng ký')
  } finally {
    loading.value = false
  }
}

const filteredSubmissions = computed(() => {
  return submissions.value.filter(s => {
    const matchSearch = !search.value ||
      s.name?.toLowerCase().includes(search.value.toLowerCase()) ||
      s.phone?.includes(search.value) ||
      s.city?.toLowerCase().includes(search.value.toLowerCase())

    const matchType = !typeFilter.value || s.type === typeFilter.value
    return matchSearch && matchType
  })
})

onMounted(() => {
  fetchSubmissions()
})
</script>

<template>
  <div class="submissions-page">
    <div class="page-header">
      <div>
        <h1>Danh sách Đơn đăng ký Hỗ trợ</h1>
        <p>Tiếp nhận và xử lý thông tin từ người dân đăng ký tư vấn tái hòa nhập cộng đồng</p>
      </div>
    </div>

    <!-- Filters -->
    <div class="filter-card">
      <input
        type="text"
        v-model="search"
        placeholder="Tìm theo họ tên, số điện thoại, tỉnh thành..."
      />

      <select v-model="typeFilter">
        <option value="">Tất cả loại yêu cầu</option>
        <option value="support">Tư vấn Hỗ trợ (Tái hòa nhập)</option>
        <option value="contact">Liên hệ thông thường</option>
      </select>
    </div>

    <!-- Table -->
    <div class="table-card">
      <div v-if="loading" class="loading-state">Đang tải danh sách...</div>

      <table v-else class="admin-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Họ và tên</th>
            <th>Số điện thoại</th>
            <th>Tỉnh / Thành</th>
            <th>Loại yêu cầu</th>
            <th>Ngày gửi</th>
            <th>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in filteredSubmissions" :key="s.id">
            <td>#{{ s.id }}</td>
            <td><strong>{{ s.name }}</strong></td>
            <td><code>{{ s.phone }}</code></td>
            <td>{{ s.city || '—' }}</td>
            <td>
              <span class="type-badge" :class="s.type">
                {{ s.type === 'support' ? 'Hỗ trợ tái hòa nhập' : 'Liên hệ' }}
              </span>
            </td>
            <td>{{ new Date(s.submittedAt).toLocaleString('vi-VN') }}</td>
            <td>
              <button class="view-btn" @click="selectedSub = s">👁️ Xem chi tiết</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Detail Modal -->
    <div v-if="selectedSub" class="modal-overlay" @click.self="selectedSub = null">
      <div class="modal-card">
        <h3>📋 Chi tiết Đơn đăng ký #{{ selectedSub.id }}</h3>
        <p class="modal-subtitle">Gửi lúc: {{ new Date(selectedSub.submittedAt).toLocaleString('vi-VN') }}</p>

        <div class="detail-grid">
          <div class="detail-item">
            <span class="label">Họ và tên:</span>
            <strong>{{ selectedSub.name }}</strong>
          </div>
          <div class="detail-item">
            <span class="label">Số điện thoại:</span>
            <code>{{ selectedSub.phone }}</code>
          </div>
          <div class="detail-item" v-if="selectedSub.email">
            <span class="label">Email:</span>
            <span>{{ selectedSub.email }}</span>
          </div>
          <div class="detail-item" v-if="selectedSub.city">
            <span class="label">Tỉnh / Thành phố:</span>
            <span>{{ selectedSub.city }}</span>
          </div>
          <div class="detail-item full" v-if="selectedSub.address">
            <span class="label">Địa chỉ chi tiết:</span>
            <span>{{ selectedSub.address }}</span>
          </div>
          <div class="detail-item full">
            <span class="label">Nội dung yêu cầu / Hoàn cảnh:</span>
            <div class="message-box">{{ selectedSub.message }}</div>
          </div>
        </div>

        <div class="modal-actions">
          <button class="cancel-btn" @click="selectedSub = null">Đóng</button>
          <a :href="`tel:${selectedSub.phone}`" class="primary-btn">📞 Gọi Điện Tư Vấn</a>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.submissions-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
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

.filter-card {
  background: white;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid #e2ece3;
  display: flex;
  gap: 12px;
}

.filter-card input, .filter-card select {
  padding: 10px 14px;
  border: 1px solid #c8d6c9;
  border-radius: 8px;
}

.filter-card input {
  flex: 1;
}

.table-card {
  background: white;
  border-radius: 12px;
  border: 1px solid #e2ece3;
  overflow: hidden;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
  text-align: left;
}

.admin-table th {
  background: #f8faf8;
  padding: 12px 16px;
  color: #667768;
  border-bottom: 1px solid #e2ece3;
}

.admin-table td {
  padding: 14px 16px;
  border-bottom: 1px solid #eef2ee;
}

.type-badge {
  padding: 4px 8px;
  border-radius: 6px;
  font-weight: 700;
  font-size: 0.75rem;
}

.type-badge.support {
  background: #e4f2e5;
  color: #2c6e33;
}

.type-badge.contact {
  background: #eef2f8;
  color: #1a4f8b;
}

.view-btn {
  background: #f0f7f1;
  color: #2c6e33;
  border: 1px solid #8ed694;
  padding: 4px 10px;
  border-radius: 6px;
  font-weight: 700;
  cursor: pointer;
  font-size: 0.78rem;
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal-card {
  background: white;
  padding: 28px;
  border-radius: 14px;
  width: 100%;
  max-width: 520px;
}

.modal-card h3 {
  margin: 0 0 4px 0;
  font-size: 1.15rem;
}

.modal-subtitle {
  font-size: 0.82rem;
  color: #667768;
  margin: 0 0 20px 0;
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-item.full {
  grid-column: span 2;
}

.detail-item .label {
  font-size: 0.78rem;
  color: #667768;
  font-weight: 700;
}

.message-box {
  background: #f8faf8;
  border: 1px solid #e2ece3;
  padding: 12px;
  border-radius: 8px;
  font-size: 0.9rem;
  line-height: 1.5;
  white-space: pre-wrap;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
}

.cancel-btn {
  background: #f0f0f0;
  border: none;
  padding: 10px 16px;
  border-radius: 6px;
  cursor: pointer;
}

.primary-btn {
  background: #1e4620;
  color: white;
  text-decoration: none;
  padding: 10px 18px;
  border-radius: 6px;
  font-weight: 700;
}
</style>
