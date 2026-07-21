<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const users = ref<any[]>([])
const roles = ref<any[]>([])
const loading = ref(true)
const showModal = ref(false)

const form = reactive({
  username: '',
  email: '',
  password: '',
  roleId: 2,
})
const errorMsg = ref('')

const fetchUsers = async () => {
  loading.value = true
  try {
    const [uRes, rRes] = await Promise.all([
      $fetch('/api/admin/users'),
      $fetch('/api/admin/roles'),
    ])
    if (uRes.ok) users.value = uRes.users
    if (rRes.ok) roles.value = rRes.roles
  } catch (err: any) {
    errorMsg.value = err?.data?.statusMessage || 'Lỗi tải danh sách người dùng'
  } finally {
    loading.value = false
  }
}

const handleCreateUser = async () => {
  errorMsg.value = ''
  try {
    const res = await $fetch('/api/admin/users', {
      method: 'POST',
      body: form
    })
    if (res.ok) {
      showModal.value = false
      form.username = ''
      form.email = ''
      form.password = ''
      await fetchUsers()
    }
  } catch (err: any) {
    errorMsg.value = err?.data?.statusMessage || 'Tạo người dùng thất bại'
  }
}

const toast = useToast()

const toggleActive = async (user: any) => {
  try {
    await $fetch(`/api/admin/users/${user.id}`, {
      method: 'PUT',
      body: { isActive: !user.isActive }
    })
    user.isActive = !user.isActive
    toast.success(`Đã ${user.isActive ? 'kích hoạt' : 'khóa'} tài khoản ${user.username}!`)
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Không thể đổi trạng thái')
  }
}

const deleteUser = async (user: any) => {
  if (!confirm(`Bạn có chắc muốn xóa tài khoản ${user.username}?`)) return
  try {
    await $fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
    toast.success('Đã xóa người dùng thành công!')
    await fetchUsers()
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Không thể xóa người dùng')
  }
}

onMounted(() => {
  fetchUsers()
})
</script>

<template>
  <div class="users-page">
    <div class="page-header">
      <div>
        <h1>Quản lý Người dùng Admin</h1>
        <p>Danh sách các tài khoản được cấp quyền truy cập Admin Panel</p>
      </div>
      <button class="primary-btn" @click="showModal = true">
        ➕ Thêm Người dùng Mới
      </button>
    </div>

    <div class="table-card">
      <table class="admin-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Tên đăng nhập</th>
            <th>Email</th>
            <th>Vai trò (Role)</th>
            <th>Trạng thái</th>
            <th>Đăng nhập cuối</th>
            <th>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>#{{ u.id }}</td>
            <td><strong>{{ u.username }}</strong></td>
            <td>{{ u.email || '—' }}</td>
            <td>
              <span class="role-badge" :class="u.roleName">{{ u.roleName }}</span>
            </td>
            <td>
              <button
                class="status-btn"
                :class="{ active: u.isActive }"
                @click="toggleActive(u)"
              >
                {{ u.isActive ? 'Kích hoạt' : 'Khóa' }}
              </button>
            </td>
            <td>{{ u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('vi-VN') : 'Chưa đăng nhập' }}</td>
            <td>
              <button class="delete-icon-btn" @click="deleteUser(u)" title="Xóa tài khoản">🗑️</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Create User Modal -->
    <div v-if="showModal" class="modal-overlay">
      <div class="modal-card">
        <h3>Thêm Tài khoản Admin Mới</h3>
        <p class="modal-subtitle">Cấp tài khoản và gán vai trò quản trị</p>

        <div v-if="errorMsg" class="error-alert">{{ errorMsg }}</div>

        <form @submit.prevent="handleCreateUser" class="modal-form">
          <div class="form-group">
            <label>Tên đăng nhập (*)</label>
            <input type="text" v-model="form.username" required placeholder="eg: nv_editor" />
          </div>

          <div class="form-group">
            <label>Email</label>
            <input type="email" v-model="form.email" placeholder="eg: editor@conduonghuongthien.com.vn" />
          </div>

          <div class="form-group">
            <label>Mật khẩu (*)</label>
            <input type="password" v-model="form.password" required minlength="6" placeholder="Tối thiểu 6 ký tự" />
          </div>

          <div class="form-group">
            <label>Vai trò (*)</label>
            <select v-model="form.roleId" required>
              <option v-for="r in roles" :key="r.id" :value="r.id">
                {{ r.name }} — {{ r.description }}
              </option>
            </select>
          </div>

          <div class="modal-actions">
            <button type="button" class="cancel-btn" @click="showModal = false">Hủy</button>
            <button type="submit" class="primary-btn">Tạo Tài Khoản</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.users-page {
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
  padding: 10px 18px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
}

.primary-btn:hover {
  background: #2c6e33;
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
  text-align: left;
  font-size: 0.88rem;
}

.admin-table th {
  background: #f8faf8;
  padding: 12px 16px;
  color: #667768;
  font-weight: 700;
  border-bottom: 1px solid #e2ece3;
}

.admin-table td {
  padding: 14px 16px;
  border-bottom: 1px solid #eef2ee;
  color: #2c3e2e;
}

.role-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 700;
  background: #eef2ee;
  color: #556655;
}

.role-badge.superadmin {
  background: #ffebe9;
  color: #d12420;
}

.role-badge.editor {
  background: #e4f2e5;
  color: #2c6e33;
}

.status-btn {
  border: none;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  background: #f5f5f5;
  color: #888;
}

.status-btn.active {
  background: #e4f2e5;
  color: #2c6e33;
}

.delete-icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
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
  max-width: 440px;
}

.modal-card h3 {
  margin: 0 0 4px 0;
  font-size: 1.15rem;
  color: #122815;
}

.modal-subtitle {
  font-size: 0.82rem;
  color: #667768;
  margin: 0 0 20px 0;
}

.error-alert {
  background: #ffebe9;
  color: #d12420;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.82rem;
  margin-bottom: 16px;
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

.form-group input, .form-group select {
  width: 100%;
  padding: 10px;
  border: 1px solid #c8d6c9;
  border-radius: 6px;
  box-sizing: border-box;
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
</style>
