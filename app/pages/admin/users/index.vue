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

const form = reactive({ username: '', email: '', password: '', roleId: 2 })
const editForm = reactive({ id: 0, username: '', email: '', password: '', roleId: 2, isActive: true })
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
    const res = await $fetch('/api/admin/users', { method: 'POST', body: form })
    if (res.ok) {
      toast.success(`Đã tạo tài khoản ${form.username} thành công!`)
      showModal.value = false
      form.username = ''; form.email = ''; form.password = ''
      await fetchUsers()
    }
  } catch (err: any) {
    errorMsg.value = err?.data?.statusMessage || 'Tạo người dùng thất bại'
    toast.error(errorMsg.value)
  }
}

const openEditModal = (user: any) => {
  editForm.id = user.id; editForm.username = user.username; editForm.email = user.email || ''
  editForm.roleId = user.roleId || 2; editForm.password = ''; editForm.isActive = user.isActive
  errorMsg.value = ''; showEditModal.value = true
}

const handleUpdateUser = async () => {
  errorMsg.value = ''
  try {
    const body: any = { email: editForm.email, roleId: editForm.roleId, isActive: editForm.isActive }
    if (editForm.password.trim()) {
      if (editForm.password.trim().length < 6) {
        toast.warning('Mật khẩu mới phải có ít nhất 6 ký tự'); return
      }
      body.password = editForm.password.trim()
    }
    const res = await $fetch(`/api/admin/users/${editForm.id}`, { method: 'PUT', body })
    if (res.ok) {
      toast.success(`Đã cập nhật tài khoản ${editForm.username} thành công!`)
      showEditModal.value = false; await fetchUsers()
    }
  } catch (err: any) {
    errorMsg.value = err?.data?.statusMessage || 'Cập nhật người dùng thất bại'
    toast.error(errorMsg.value)
  }
}

const toggleActive = async (user: any) => {
  try {
    await $fetch(`/api/admin/users/${user.id}`, { method: 'PUT', body: { isActive: !user.isActive } })
    user.isActive = !user.isActive
    toast.success(`Đã ${user.isActive ? 'kích hoạt' : 'khóa'} tài khoản ${user.username}!`)
  } catch (err: any) { toast.error(err?.data?.statusMessage || 'Không thể đổi trạng thái') }
}

const deleteUser = async (user: any) => {
  if (!confirm(`Bạn có chắc muốn xóa tài khoản ${user.username}?`)) return
  try {
    await $fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
    toast.success('Đã xóa người dùng thành công!'); await fetchUsers()
  } catch (err: any) { toast.error(err?.data?.statusMessage || 'Không thể xóa người dùng') }
}

onMounted(() => { fetchUsers() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Quản lý Người dùng Admin</h1>
        <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Danh sách các tài khoản được cấp quyền truy cập Admin Panel</p>
      </div>
      <button
        class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer transition-colors border-0 shrink-0"
        @click="showModal = true"
      >
        <i class="fa-solid fa-user-plus"></i> Thêm Người dùng Mới
      </button>
    </div>

    <!-- Table Card -->
    <div class="bg-white rounded-xl border border-[#e2ece3] overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-[0.88rem] text-left">
          <thead>
            <tr>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">ID</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Tên đăng nhập</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Email</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Vai trò</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Trạng thái</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Đăng nhập cuối</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id" class="hover:bg-[#fafcfa]">
              <td class="px-4 py-3.5 border-b border-[#eef2ee] text-[#667768]">#{{ u.id }}</td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee] font-bold text-[#122815]">{{ u.username }}</td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee] text-[#2c3e2e]">{{ u.email || '—' }}</td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee]">
                <span
                  class="px-2.5 py-1 rounded-xl text-[0.75rem] font-bold capitalize"
                  :class="u.roleName === 'superadmin' ? 'bg-[#ffebe9] text-[#d12420]' : u.roleName === 'editor' ? 'bg-[#e4f2e5] text-[#2c6e33]' : 'bg-[#eef2ee] text-[#556655]'"
                >
                  {{ u.roleName }}
                </span>
              </td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee]">
                <button
                  class="inline-flex items-center gap-1.5 border-0 px-3 py-1.5 rounded-md text-[0.78rem] font-bold cursor-pointer transition-colors"
                  :class="u.isActive ? 'bg-[#e4f2e5] text-[#2c6e33]' : 'bg-[#ffebe9] text-[#d12420]'"
                  @click="toggleActive(u)"
                  :title="u.isActive ? 'Bấm để khóa tài khoản' : 'Bấm để mở khóa tài khoản'"
                >
                  <i :class="u.isActive ? 'fa-solid fa-lock-open' : 'fa-solid fa-lock'"></i>
                  {{ u.isActive ? 'Hoạt động' : 'Đã khóa' }}
                </button>
              </td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee] text-[#667768] text-[0.82rem] whitespace-nowrap">
                {{ u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('vi-VN') : 'Chưa đăng nhập' }}
              </td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee]">
                <div class="flex items-center gap-2">
                  <button
                    class="w-8 h-8 flex items-center justify-center rounded-md bg-[#f4f6f4] border border-[#dce4dd] text-[#445544] cursor-pointer hover:bg-[#e4f2e5] hover:text-[#1e4620] hover:border-[#a8d5ab] transition-colors"
                    @click="openEditModal(u)"
                    title="Chỉnh sửa tài khoản"
                  ><i class="fa-solid fa-pen-to-square text-xs"></i></button>
                  <button
                    class="w-8 h-8 flex items-center justify-center rounded-md bg-[#f4f6f4] border border-[#dce4dd] text-[#445544] cursor-pointer hover:bg-[#ffebe9] hover:text-[#d12420] hover:border-[#f7b5b2] transition-colors"
                    @click="deleteUser(u)"
                    title="Xóa tài khoản"
                  ><i class="fa-solid fa-trash-can text-xs"></i></button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Create User Modal -->
    <div v-if="showModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4" @click.self="showModal = false">
      <div class="bg-white rounded-2xl p-7 w-full max-w-[460px] max-h-[90vh] overflow-y-auto">
        <h3 class="text-[1.15rem] font-extrabold text-[#122815] m-0 mb-1">Thêm Tài khoản Admin Mới</h3>
        <p class="text-[0.82rem] text-[#667768] m-0 mb-5">Cấp tài khoản và gán vai trò quản trị</p>
        <div v-if="errorMsg" class="bg-[#ffebe9] text-[#d12420] px-3 py-2 rounded-lg text-[0.82rem] mb-4">{{ errorMsg }}</div>
        <form @submit.prevent="handleCreateUser" class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Tên đăng nhập (*)</label>
            <input type="text" v-model="form.username" required placeholder="eg: nv_editor" class="w-full px-3 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Email</label>
            <input type="email" v-model="form.email" placeholder="eg: editor@conduonghuongthien.com.vn" class="w-full px-3 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Mật khẩu (*)</label>
            <input type="password" v-model="form.password" required minlength="6" placeholder="Tối thiểu 6 ký tự" class="w-full px-3 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Vai trò (*)</label>
            <select v-model="form.roleId" required class="w-full px-3 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] box-border">
              <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }} — {{ r.description }}</option>
            </select>
          </div>
          <div class="flex justify-end gap-3 mt-2">
            <button type="button" class="bg-[#f0f0f0] border-0 px-4 py-2.5 rounded-lg cursor-pointer font-medium" @click="showModal = false">Hủy</button>
            <button type="submit" class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer transition-colors border-0">Tạo Tài Khoản</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Edit User Modal -->
    <div v-if="showEditModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4" @click.self="showEditModal = false">
      <div class="bg-white rounded-2xl p-7 w-full max-w-[460px] max-h-[90vh] overflow-y-auto">
        <h3 class="text-[1.15rem] font-extrabold text-[#122815] m-0 mb-1">Chỉnh sửa Tài khoản: {{ editForm.username }}</h3>
        <p class="text-[0.82rem] text-[#667768] m-0 mb-5">Cập nhật Email, Vai trò, Trạng thái hoặc Đổi mật khẩu mới</p>
        <div v-if="errorMsg" class="bg-[#ffebe9] text-[#d12420] px-3 py-2 rounded-lg text-[0.82rem] mb-4">{{ errorMsg }}</div>
        <form @submit.prevent="handleUpdateUser" class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Tên đăng nhập</label>
            <input type="text" :value="editForm.username" disabled class="w-full px-3 py-2.5 border border-[#c8d6c9] rounded-lg text-sm bg-[#f5f7f5] text-[#778877] cursor-not-allowed box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Email</label>
            <input type="email" v-model="editForm.email" placeholder="eg: user@conduonghuongthien.com.vn" class="w-full px-3 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Vai trò (Role)</label>
            <select v-model="editForm.roleId" required class="w-full px-3 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] box-border">
              <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }} — {{ r.description }}</option>
            </select>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Đổi mật khẩu mới (Để trống nếu giữ nguyên)</label>
            <input type="password" v-model="editForm.password" minlength="6" placeholder="Nhập mật khẩu mới nếu muốn đổi" class="w-full px-3 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Trạng thái tài khoản</label>
            <select v-model="editForm.isActive" class="w-full px-3 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] box-border">
              <option :value="true">🟢 Hoạt động (Được phép đăng nhập)</option>
              <option :value="false">🔴 Đã khóa (Bị chặn đăng nhập)</option>
            </select>
          </div>
          <div class="flex justify-end gap-3 mt-2">
            <button type="button" class="bg-[#f0f0f0] border-0 px-4 py-2.5 rounded-lg cursor-pointer font-medium" @click="showEditModal = false">Hủy</button>
            <button type="submit" class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer transition-colors border-0">Cập Nhật Tài Khoản</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
