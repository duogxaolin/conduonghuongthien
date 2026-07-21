<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const roles = ref<any[]>([])
const selectedRole = ref<any>(null)
const loading = ref(true)
const saving = ref(false)

const resourcesList = [
  { key: 'news', label: 'Bản tin & Tin tức' },
  { key: 'role_models', label: 'Tấm gương tiêu biểu' },
  { key: 'reintegration', label: 'Mô hình tái hòa nhập' },
  { key: 'documents', label: 'Văn bản pháp luật' },
  { key: 'faq', label: 'Giải đáp pháp luật' },
  { key: 'home_sections', label: 'Trang chủ (Kéo-thả)' },
  { key: 'users', label: 'Quản lý Người dùng' },
  { key: 'roles', label: 'Quản lý Phân quyền Rules' },
  { key: 'media', label: 'Thư viện Media' },
  { key: 'settings', label: 'Cài đặt Website' },
  { key: 'submissions', label: 'Đơn đăng ký hỗ trợ' },
]

const permissionMatrix = reactive<Record<string, { canCreate: boolean; canRead: boolean; canUpdate: boolean; canDelete: boolean }>>({})

const toast = useToast()

const fetchRoles = async () => {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/roles')
    if (res.ok) {
      roles.value = res.roles
      if (roles.value.length > 0 && !selectedRole.value) {
        selectRole(roles.value[0])
      }
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi tải danh sách vai trò')
  } finally {
    loading.value = false
  }
}

const selectRole = (role: any) => {
  selectedRole.value = role
  // Reset matrix
  resourcesList.forEach(r => {
    const existingPerm = role.permissions?.find((p: any) => p.resource === r.key)
    permissionMatrix[r.key] = {
      canCreate: existingPerm ? Boolean(existingPerm.canCreate) : false,
      canRead:   existingPerm ? Boolean(existingPerm.canRead)   : false,
      canUpdate: existingPerm ? Boolean(existingPerm.canUpdate) : false,
      canDelete: existingPerm ? Boolean(existingPerm.canDelete) : false,
    }
  })
}

const handleSavePermissions = async () => {
  if (!selectedRole.value) return
  saving.value = true

  const permsPayload = Object.entries(permissionMatrix).map(([resource, perm]) => ({
    resource,
    ...perm
  }))

  try {
    const res = await $fetch(`/api/admin/roles/${selectedRole.value.id}`, {
      method: 'PUT',
      body: { permissions: permsPayload }
    })
    if (res.ok) {
      toast.success('Đã cập nhật phân quyền thành công!')
      await fetchRoles()
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi lưu phân quyền')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  fetchRoles()
})
</script>

<template>
  <div class="roles-page">
    <div class="page-header">
      <div>
        <h1>Quản lý Vai trò & Phân quyền Rules</h1>
        <p>Thiết lập chi tiết quyền Xem, Thêm, Sửa, Xóa cho từng vai trò trong hệ thống</p>
      </div>
    </div>

    <div class="roles-layout">
      <!-- Sidebar Roles list -->
      <div class="roles-sidebar">
        <h3>Danh sách Vai trò</h3>
        <div class="role-list">
          <button
            v-for="r in roles"
            :key="r.id"
            class="role-item"
            :class="{ active: selectedRole?.id === r.id }"
            @click="selectRole(r)"
          >
            <div class="role-item-title">
              <strong>{{ r.name }}</strong>
              <span v-if="r.isSystem" class="sys-badge">Hệ thống</span>
            </div>
            <span class="role-item-desc">{{ r.description }}</span>
          </button>
        </div>
      </div>

      <!-- Permission Matrix -->
      <div class="matrix-card" v-if="selectedRole">
        <div class="matrix-header">
          <div>
            <h2>Ma trận Phân quyền: {{ selectedRole.name }}</h2>
            <p>{{ selectedRole.description }}</p>
          </div>
          <button
            class="primary-btn"
            @click="handleSavePermissions"
            :disabled="saving || selectedRole.isSystem"
          >
            <span v-if="saving">Đang lưu...</span>
            <span v-else>💾 Lưu Phân Quyền</span>
          </button>
        </div>

        <div v-if="selectedRole.isSystem" class="info-banner">
          🔒 Vai trò hệ thống <strong>(SuperAdmin)</strong> mặc định có toàn bộ quyền trên website.
        </div>

        <table class="matrix-table">
          <thead>
            <tr>
              <th>Tài nguyên / Tính năng</th>
              <th>Thêm mới (Create)</th>
              <th>Xem dữ liệu (Read)</th>
              <th>Chỉnh sửa (Update)</th>
              <th>Xóa dữ liệu (Delete)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="res in resourcesList" :key="res.key">
              <td><strong>{{ res.label }}</strong> <code>({{ res.key }})</code></td>
              <td>
                <input type="checkbox" v-model="permissionMatrix[res.key].canCreate" :disabled="selectedRole.isSystem" />
              </td>
              <td>
                <input type="checkbox" v-model="permissionMatrix[res.key].canRead" :disabled="selectedRole.isSystem" />
              </td>
              <td>
                <input type="checkbox" v-model="permissionMatrix[res.key].canUpdate" :disabled="selectedRole.isSystem" />
              </td>
              <td>
                <input type="checkbox" v-model="permissionMatrix[res.key].canDelete" :disabled="selectedRole.isSystem" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.roles-page {
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

.roles-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 20px;
}

.roles-sidebar {
  background: white;
  border-radius: 12px;
  border: 1px solid #e2ece3;
  padding: 16px;
}

.roles-sidebar h3 {
  font-size: 0.95rem;
  font-weight: 800;
  margin: 0 0 12px 0;
  color: #122815;
}

.role-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.role-item {
  background: #f8faf8;
  border: 1px solid #e2ece3;
  padding: 12px;
  border-radius: 8px;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s;
}

.role-item.active {
  background: #e4f2e5;
  border-color: #2c6e33;
}

.role-item-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.sys-badge {
  font-size: 0.65rem;
  background: #2c6e33;
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
}

.role-item-desc {
  font-size: 0.75rem;
  color: #667768;
}

.matrix-card {
  background: white;
  border-radius: 12px;
  border: 1px solid #e2ece3;
  padding: 24px;
}

.matrix-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.matrix-header h2 {
  font-size: 1.1rem;
  font-weight: 800;
  margin: 0;
}

.matrix-header p {
  font-size: 0.82rem;
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

.info-banner {
  background: #eef7ee;
  border: 1px solid #cce5cd;
  color: #1e4620;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 0.85rem;
  margin-bottom: 20px;
}

.matrix-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.matrix-table th {
  background: #f8faf8;
  padding: 12px;
  text-align: center;
  border-bottom: 1px solid #e2ece3;
  color: #667768;
}

.matrix-table th:first-child {
  text-align: left;
}

.matrix-table td {
  padding: 12px;
  text-align: center;
  border-bottom: 1px solid #eef2ee;
}

.matrix-table td:first-child {
  text-align: left;
}

.matrix-table code {
  font-size: 0.75rem;
  color: #888;
}
</style>
