<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const users = ref<any[]>([])
const roles = ref<any[]>([])
const loading = ref(true)
const showModal = ref(false)
const showEditModal = ref(false)

const form = reactive({
  username: '',
  email: '',
  password: '',
  roleId: 2,
})

const editForm = reactive({
  id: 0,
  username: '',
  email: '',
  password: '',
  roleId: 2,
  isActive: true
})

const errorMsg = ref('')
const toast = useToast()

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
    toast.error(errorMsg.value)
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
      toast.success(`Đã tạo tài khoản ${form.username} thành công!`)
      showModal.value = false
      form.username = ''
      form.email = ''
      form.password = ''
      await fetchUsers()
    }
  } catch (err: any) {
    errorMsg.value = err?.data?.statusMessage || 'Tạo người dùng thất bại'
    toast.error(errorMsg.value)
  }
}

const openEditModal = (user: any) => {
  editForm.id = user.id
  editForm.username = user.username
  editForm.email = user.email || ''
  editForm.roleId = user.roleId || 2
  editForm.password = ''
  editForm.isActive = user.isActive
  errorMsg.value = ''
  showEditModal.value = true
}

const handleUpdateUser = async () => {
  errorMsg.value = ''
  try {
    const body: any = {
      email: editForm.email,
      roleId: editForm.roleId,
      isActive: editForm.isActive
    }

    if (editForm.password.trim()) {
      if (editForm.password.trim().length < 6) {
        errorMsg.value = 'Mật khẩu mới phải có ít nhất 6 ký tự'
        toast.warning(errorMsg.value)
        return
      }
      body.password = editForm.password.trim()
    }

    const res = await $fetch(`/api/admin/users/${editForm.id}`, {
      method: 'PUT',
      body
    })

    if (res.ok) {
      toast.success(`Đã cập nhật tài khoản ${editForm.username} thành công!`)
      showEditModal.value = false
      await fetchUsers()
    }
  } catch (err: any) {
    errorMsg.value = err?.data?.statusMessage || 'Cập nhật người dùng thất bại'
    toast.error(errorMsg.value)
  }
}

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
        <i class="fa-solid fa-user-plus"></i> Thêm Người dùng Mới
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
                :title="u.isActive ? 'Bấm để khóa tài khoản' : 'Bấm để mở khóa tài khoản'"
              >
                <i :class="u.isActive ? 'fa-solid fa-lock-open' : 'fa-solid fa-lock'"></i>
                {{ u.isActive ? 'Hoạt động' : 'Đã khóa' }}
              </button>
            </td>
            <td>{{ u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('vi-VN') : 'Chưa đăng nhập' }}</td>
            <td>
              <div class="action-buttons">
                <button class="action-btn edit-btn" @click="openEditModal(u)" title="Chỉnh sửa tài khoản (Email, Mật khẩu, Vai trò)">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button class="action-btn delete-btn" @click="deleteUser(u)" title="Xóa tài khoản">
                  <i class="fa-solid fa-trash-can"></i>
                </button>
              </div>
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

    <!-- Edit User Modal -->
    <div v-if="showEditModal" class="modal-overlay">
      <div class="modal-card">
        <h3>Chỉnh sửa Tài khoản: {{ editForm.username }}</h3>
        <p class="modal-subtitle">Cập nhật Email, Vai trò, Trạng thái hoặc Đổi mật khẩu mới</p>

        <div v-if="errorMsg" class="error-alert">{{ errorMsg }}</div>

        <form @submit.prevent="handleUpdateUser" class="modal-form">
          <div class="form-group">
            <label>Tên đăng nhập</label>
            <input type="text" :value="editForm.username" disabled class="input-disabled" />
          </div>

          <div class="form-group">
            <label>Email</label>
            <input type="email" v-model="editForm.email" placeholder="eg: user@conduonghuongthien.com.vn" />
          </div>

          <div class="form-group">
            <label>Vai trò (Role)</label>
            <select v-model="editForm.roleId" required>
              <option v-for="r in roles" :key="r.id" :value="r.id">
                {{ r.name }} — {{ r.description }}
              </option>
            </select>
          </div>

          <div class="form-group">
            <label>Đổi mật khẩu mới (Để trống nếu giữ nguyên)</label>
            <input type="password" v-model="editForm.password" minlength="6" placeholder="Nhập mật khẩu mới nếu muốn đổi" />
          </div>

          <div class="form-group">
            <label>Trạng thái tài khoản</label>
            <select v-model="editForm.isActive">
              <option :value="true">🟢 Hoạt động (Được phép đăng nhập)</option>
              <option :value="false">🔴 Đã khóa (Bị chặn đăng nhập)</option>
            </select>
          </div>

          <div class="modal-actions">
            <button type="button" class="cancel-btn" @click="showEditModal = false">Hủy</button>
            <button type="submit" class="primary-btn">Cập Nhật Tài Khoản</button>
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
  display: inline-flex;
  align-items: center;
  gap: 8px;
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
  text-transform: capitalize;
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
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  background: #ffebe9;
  color: #d12420;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s ease;
}

.status-btn.active {
  background: #e4f2e5;
  color: #2c6e33;
}

.action-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-btn {
  background: #f4f6f4;
  border: 1px solid #dce4dd;
  border-radius: 6px;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #445544;
  transition: all 0.2s ease;
}

.edit-btn:hover {
  background: #e4f2e5;
  color: #1e4620;
  border-color: #a8d5ab;
}

.delete-btn:hover {
  background: #ffebe9;
  color: #d12420;
  border-color: #f7b5b2;
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
  max-width: 460px;
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

.input-disabled {
  background-color: #f5f7f5;
  color: #778877;
  cursor: not-allowed;
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
