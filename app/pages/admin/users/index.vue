<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const users = ref<any[]>([])
const roles = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const showModal = ref(false)
const showEditModal = ref(false)

const form = reactive({ username: '', email: '', password: '', roleId: 2 })
const editForm = reactive({ id: 0, username: '', email: '', password: '', roleId: 2, isActive: true })
const errorMsg = ref('')
const toast = useToast()
const { confirm } = useConfirm()

const fetchUsers = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const [uRes, rRes] = await Promise.all([
      $fetch('/api/admin/users'),
      $fetch('/api/admin/roles'),
    ])
    if (uRes.ok) users.value = uRes.users
    if (rRes.ok) roles.value = rRes.roles
    // Ids from the previous load are meaningless once the list changes.
    selection.keepOnly(visibleIds.value)
  } catch (err: any) {
    loadError.value = err?.data?.statusMessage || 'Lỗi tải danh sách người dùng'
    toast.error(loadError.value)
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
  const ok = await confirm({ title: 'Xóa tài khoản', message: `Bạn có chắc muốn xóa tài khoản ${user.username}?`, danger: true, confirmLabel: 'Xóa' })
  if (!ok) return
  try {
    await $fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
    toast.success('Đã xóa người dùng thành công!'); await fetchUsers()
  } catch (err: any) { toast.error(err?.data?.statusMessage || 'Không thể xóa người dùng') }
}

// ─── Bulk selection ───────────────────────────────────────────────────────────
const selection = useBulkSelection()
const bulk = useBulkAction(selection)
const { user: currentUser } = useAdminAuth()

/** Role ids the server refuses to touch, derived from the roles list already fetched. */
const systemRoleIds = computed(() => new Set(roles.value.filter((r: any) => r.isSystem).map((r: any) => Number(r.id))))

/**
 * A row is selectable only if the server would actually act on it: not the
 * SuperAdmin account, and not the operator's own. Offering a checkbox on a row
 * that is guaranteed to come back as a failure is just a trap.
 */
const canSelect = (u: any) => !systemRoleIds.value.has(Number(u.roleId)) && Number(u.id) !== Number(currentUser.value?.id)
const visibleIds = computed(() => users.value.filter(canSelect).map((u: any) => Number(u.id)))

const bulkDelete = () => bulk.run({
  url: '/api/admin/users/bulk-delete',
  noun: 'tài khoản',
  confirm: {
    title: 'Xóa tài khoản',
    message: `Xóa ${selection.count.value} tài khoản đã chọn? Thao tác không thể hoàn tác.`,
    danger: true,
    confirmLabel: 'Xóa',
  },
  reload: fetchUsers,
})

/** Locking is what "hide" means for an account: admin-auth re-reads isActive per request. */
const bulkActive = (isActive: boolean) => bulk.run({
  url: '/api/admin/users/bulk-active',
  body: { isActive },
  noun: 'tài khoản',
  confirm: {
    message: `${isActive ? 'Mở khóa' : 'Khóa'} ${selection.count.value} tài khoản đã chọn?`,
    confirmLabel: isActive ? 'Mở khóa' : 'Khóa',
    danger: !isActive,
  },
  reload: fetchUsers,
})

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

    <!-- Bulk action bar -->
    <AdminBulkActionBar
      v-if="selection.count.value"
      :count="selection.count.value"
      :busy="bulk.busy.value"
      noun="tài khoản"
      @clear="selection.clear()"
    >
      <button type="button" class="rounded-lg border border-[#b78103] bg-white px-3 py-2 text-sm font-bold text-[#765b00] hover:bg-white/70" @click="bulkActive(false)">Khóa (ẩn)</button>
      <button type="button" class="rounded-lg border border-[#2c6e33] bg-white px-3 py-2 text-sm font-bold text-[#2c6e33] hover:bg-white/70" @click="bulkActive(true)">Mở khóa</button>
      <button type="button" class="rounded-lg bg-[#d12420] px-3 py-2 text-sm font-bold text-white hover:bg-[#b01f1b]" @click="bulkDelete">Xóa</button>
    </AdminBulkActionBar>

    <!-- Table Card -->
    <div class="bg-white rounded-xl border border-[#e2ece3] overflow-hidden">
      <!-- Loading: two placeholders at the SAME breakpoints as the two real
           layouts below, so the shape does not change when the rows arrive. -->
      <template v-if="loading">
        <!-- Mobile card list (matches the md:hidden branch) -->
        <div class="md:hidden divide-y divide-[#eef2ee]" role="status" aria-busy="true">
          <span class="sr-only">Đang tải danh sách người dùng</span>
          <div v-for="n in 5" :key="'ml-' + n" class="p-4 flex flex-col gap-2.5" aria-hidden="true">
            <div class="flex items-center justify-between">
              <div class="h-4 w-40 rounded bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
              <div class="h-4 w-20 rounded-md bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
            </div>
            <div class="h-3 w-52 rounded bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
            <div class="h-3 w-44 rounded bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
          </div>
        </div>
        <!-- Desktop table, 8 columns matching the real header (matches the
             hidden md:block branch) -->
        <div class="hidden md:block">
          <SkeletonTable label="Đang tải danh sách người dùng" :rows="5" :cols="8" />
        </div>
      </template>

      <!-- Empty — one branch for both layouts, so an empty list never reads as a
           bare table header. -->
      <div v-else-if="loadError" role="alert" class="px-6 py-10 text-center text-[#B04A4A] text-[0.95rem]">
        <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
        {{ loadError }} Vui lòng <button type="button" class="text-[#4A6741] font-bold underline" @click="fetchUsers()">thử lại</button>.
      </div>

      <div v-else-if="users.length === 0" class="py-14 flex flex-col items-center gap-3 text-center">
        <i class="fa-solid fa-users text-3xl text-[#c8d6c9]" aria-hidden="true"></i>
        <p class="text-[#667768] text-[0.9rem] m-0">Chưa có tài khoản nào. Hãy thêm người dùng đầu tiên!</p>
      </div>

      <!-- Content — both layouts under one branch, so neither can paint next to
           its own placeholder or next to the empty state. -->
      <template v-else>
      <!-- Mobile Card View -->
      <div class="md:hidden divide-y divide-[#eef2ee]">
        <div v-for="u in users" :key="'m-'+u.id" class="p-4" :class="selection.isSelected(Number(u.id)) ? 'bg-[#f0f7f1]' : ''">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <!-- No checkbox on a row the server would refuse: the SuperAdmin
                   account and the operator's own. -->
              <input
                v-if="canSelect(u)"
                type="checkbox"
                class="h-4 w-4 shrink-0 accent-[#2c6e33]"
                :checked="selection.isSelected(Number(u.id))"
                :aria-label="`Chọn tài khoản ${u.username}`"
                @change="selection.toggle(Number(u.id))"
              />
              <span class="font-bold text-[#122815] text-[0.9rem]">{{ u.username }}</span>
              <span class="px-2 py-0.5 rounded-xl text-[0.68rem] font-bold capitalize" :class="u.roleName === 'superadmin' ? 'bg-[#ffebe9] text-[#d12420]' : u.roleName === 'editor' ? 'bg-[#e4f2e5] text-[#2c6e33]' : 'bg-[#eef2ee] text-[#556655]'">{{ u.roleName }}</span>
            </div>
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[0.7rem] font-bold" :class="u.isActive ? 'bg-[#e4f2e5] text-[#2c6e33]' : 'bg-[#ffebe9] text-[#d12420]'">
              <i :class="u.isActive ? 'fa-solid fa-lock-open' : 'fa-solid fa-lock'" class="text-[0.6rem]"></i>
              {{ u.isActive ? 'Hoạt động' : 'Đã khóa' }}
            </span>
          </div>
          <p class="text-[0.8rem] text-[#667768] m-0">{{ u.email || 'Chưa có email' }}</p>
          <div class="flex items-center gap-3 mt-2.5">
            <button class="inline-flex items-center gap-1 text-[#2c6e33] font-bold text-[0.8rem] bg-none border-0 cursor-pointer p-0" @click="openEditModal(u)"><i class="fa-solid fa-pen-to-square"></i> Sửa</button>
            <button class="inline-flex items-center gap-1 text-[#d12420] font-bold text-[0.8rem] bg-none border-0 cursor-pointer p-0" @click="deleteUser(u)"><i class="fa-solid fa-trash-can"></i> Xóa</button>
            <button class="inline-flex items-center gap-1 font-bold text-[0.8rem] bg-none border-0 cursor-pointer p-0" :class="u.isActive ? 'text-[#b78103]' : 'text-[#2c6e33]'" @click="toggleActive(u)">
              <i :class="u.isActive ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'"></i> {{ u.isActive ? 'Khóa' : 'Mở khóa' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Desktop Table View -->
      <div class="hidden md:block overflow-x-auto">
        <table class="w-full border-collapse text-[0.88rem] text-left">
          <thead>
            <tr>
              <th class="bg-[#f8faf8] w-10 px-4 py-3 border-b border-[#e2ece3]">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-[#2c6e33]"
                  :checked="selection.allSelected(visibleIds)"
                  :indeterminate="selection.someSelected(visibleIds)"
                  aria-label="Chọn tất cả tài khoản có thể xử lý"
                  @change="selection.toggleAll(visibleIds)"
                />
              </th>
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
            <tr
              v-for="u in users"
              :key="u.id"
              class="hover:bg-[#fafcfa]"
              :class="selection.isSelected(Number(u.id)) ? 'bg-[#f0f7f1]' : ''"
            >
              <td class="px-4 py-3.5 border-b border-[#eef2ee]">
                <input
                  v-if="canSelect(u)"
                  type="checkbox"
                  class="h-4 w-4 accent-[#2c6e33]"
                  :checked="selection.isSelected(Number(u.id))"
                  :aria-label="`Chọn tài khoản ${u.username}`"
                  @change="selection.toggle(Number(u.id))"
                />
              </td>
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
      </template>
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
