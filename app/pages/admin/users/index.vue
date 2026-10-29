<script setup lang="ts">
import type { AdminUserRow, AdminRoleRow } from '~/types/admin-api'
import type { AdminRolesResponse, AdminUserCreateResponse, AdminUserDeleteResponse, AdminUsersResponse, AdminUserUpdateResponse } from '~/types/admin-users-api'
import AdminModal from '~/components/admin/AdminModal.vue'
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const users = ref<AdminUserRow[]>([])
const roles = ref<AdminRoleRow[]>([])
const loading = ref(true)
const loadError = ref('')
const showModal = ref(false)
const showEditModal = ref(false)

const form = reactive({ username: '', email: '', password: '', roleId: 2 })
const editForm = reactive({ id: 0, username: '', email: '', password: '', roleId: null as number | null, isActive: true })
const errorMsg = ref('')
// One request at a time: a double click used to send the create/update twice.
const saving = ref(false)
// Mirrors PASSWORD_MIN_LENGTH in server/utils/password-policy.ts (server code is not
// importable into the client bundle). The server stays the authority: its full
// rule — groups, common passwords, the username — arrives in its error message.
const PASSWORD_MIN_LENGTH = 12
const toast = useToast()
const { confirm } = useConfirm()

const fetchUsers = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const [uRes, rRes] = await Promise.all([adminFetch<AdminUsersResponse>(`/api/admin/users`), adminFetch<AdminRolesResponse>(`/api/admin/roles`)])
    if (uRes.ok) users.value = uRes.users
    if (rRes.ok) roles.value = rRes.roles
    // Ids from the previous load are meaningless once the list changes.
    selection.keepOnly(visibleIds.value)
  } catch (err: unknown) {
    loadError.value = errorMessage(err, 'Lỗi tải danh sách người dùng')
    toast.error(loadError.value)
  } finally {
    loading.value = false
  }
}

const handleCreateUser = async () => {
  if (saving.value) return
  errorMsg.value = ''
  saving.value = true
  try {
    const res = await adminFetch<AdminUserCreateResponse>(`/api/admin/users`, { method: 'POST', body: form })
    if (res.ok) {
      toast.success(`Đã tạo tài khoản ${form.username} thành công!`)
      showModal.value = false
      form.username = ''; form.email = ''; form.password = ''
      await fetchUsers()
    }
  } catch (err: unknown) {
    errorMsg.value = errorMessage(err, 'Tạo người dùng thất bại')
    toast.error(errorMsg.value)
  } finally {
    saving.value = false
  }
}

const openEditModal = (user: AdminUserRow) => {
  editForm.id = user.id; editForm.username = user.username; editForm.email = user.email || ''
  // `is_active` NULL = ĐÃ KHOÁ (đọc "bật" thì lưu email cũng mở khoá); `role_id` NULL giữ NULL — `|| 2` từng gán vai trò 2 khi lưu email.
  editForm.roleId = user.roleId; editForm.password = ''; editForm.isActive = user.isActive === true
  errorMsg.value = ''; showEditModal.value = true
}

const handleUpdateUser = async () => {
  if (saving.value) return
  errorMsg.value = ''
  const body: Record<string, string | number | boolean> = { email: editForm.email, ...(editForm.roleId === null ? {} : { roleId: editForm.roleId }), isActive: editForm.isActive }
  if (editForm.password.trim()) {
    if (editForm.password.trim().length < PASSWORD_MIN_LENGTH) {
      toast.warning(`Mật khẩu mới phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự`); return
    }
    body.password = editForm.password.trim()
  }
  saving.value = true
  try {
    const res = await adminFetch<AdminUserUpdateResponse>(`/api/admin/users/${editForm.id}`, { method: 'PUT', body })
    if (res.ok) {
      toast.success(`Đã cập nhật tài khoản ${editForm.username} thành công!`)
      showEditModal.value = false; await fetchUsers()
    }
  } catch (err: unknown) {
    errorMsg.value = errorMessage(err, 'Cập nhật người dùng thất bại')
    toast.error(errorMsg.value)
  } finally {
    saving.value = false
  }
}

const toggleActive = async (user: AdminUserRow) => {
  try {
    await adminFetch<AdminUserUpdateResponse>(`/api/admin/users/${user.id}`, { method: 'PUT', body: { isActive: !user.isActive } })
    user.isActive = !user.isActive
    toast.success(`Đã ${user.isActive ? 'kích hoạt' : 'khóa'} tài khoản ${user.username}!`)
  } catch (err: unknown) { toast.error(errorMessage(err, 'Không thể đổi trạng thái')) }
}

const deleteUser = async (user: AdminUserRow) => {
  const ok = await confirm({ title: 'Xóa tài khoản', message: `Bạn có chắc muốn xóa tài khoản ${user.username}?`, danger: true, confirmLabel: 'Xóa' })
  if (!ok) return
  try {
    await adminFetch<AdminUserDeleteResponse>(`/api/admin/users/${user.id}`, { method: 'DELETE' })
    toast.success('Đã xóa người dùng thành công!'); await fetchUsers()
  } catch (err: unknown) { toast.error(errorMessage(err, 'Không thể xóa người dùng')) }
}

// ─── Bulk selection ───────────────────────────────────────────────────────────
const selection = useBulkSelection()
const bulk = useBulkAction(selection)
const { user: currentUser } = useAdminAuth()

/** Role ids the server refuses to touch, derived from the roles list already fetched. */
const systemRoleIds = computed(() => new Set(roles.value.filter((r) => r.isSystem).map((r) => Number(r.id))))

/**
 * A row is selectable only if the server would actually act on it: not the
 * SuperAdmin account, and not the operator's own. Offering a checkbox on a row
 * that is guaranteed to come back as a failure is just a trap.
 */
const canSelect = (u: AdminUserRow) => !systemRoleIds.value.has(Number(u.roleId)) && Number(u.id) !== Number(currentUser.value?.id)
const visibleIds = computed(() => users.value.filter(canSelect).map((u) => Number(u.id)))

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
        <h1 class="text-[1.3rem] font-extrabold text-brand-950 m-0">Quản lý Người dùng Admin</h1>
        <p class="text-[0.85rem] text-ink-muted mt-1 mb-0">Danh sách các tài khoản được cấp quyền truy cập Admin Panel</p>
      </div>
      <button
        class="inline-flex items-center gap-2 bg-brand-900 hover:bg-brand-700 text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer transition-colors border-0 shrink-0"
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
      <button type="button" class="rounded-lg border border-brand-700 bg-white px-3 py-2 text-sm font-bold text-brand-700 hover:bg-white/70" @click="bulkActive(true)">Mở khóa</button>
      <button type="button" class="rounded-lg bg-danger px-3 py-2 text-sm font-bold text-white hover:bg-[#b01f1b]" @click="bulkDelete">Xóa</button>
    </AdminBulkActionBar>

    <!-- Table Card -->
    <div class="bg-white rounded-xl border border-line overflow-hidden">
      <!-- Loading: two placeholders at the SAME breakpoints as the two real
           layouts below, so the shape does not change when the rows arrive. -->
      <template v-if="loading">
        <!-- Mobile card list (matches the md:hidden branch) -->
        <div class="md:hidden divide-y divide-surface-tint" role="status" aria-busy="true">
          <span class="sr-only">Đang tải danh sách người dùng</span>
          <div v-for="n in 5" :key="'ml-' + n" class="p-4 flex flex-col gap-2.5" aria-hidden="true">
            <div class="flex items-center justify-between">
              <div class="h-4 w-40 rounded bg-line animate-pulse motion-reduce:animate-none"></div>
              <div class="h-4 w-20 rounded-md bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
            </div>
            <div class="h-3 w-52 rounded bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
            <div class="h-3 w-44 rounded bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
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
      <div v-else-if="loadError" role="alert" class="px-6 py-10 text-center text-danger-soft text-[0.95rem]">
        <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
        {{ loadError }} Vui lòng <button type="button" class="text-brand-600 font-bold underline" @click="fetchUsers()">thử lại</button>.
      </div>

      <div v-else-if="users.length === 0" class="py-14 flex flex-col items-center gap-3 text-center">
        <i class="fa-solid fa-users text-3xl text-line-strong" aria-hidden="true"></i>
        <p class="text-ink-muted text-[0.9rem] m-0">Chưa có tài khoản nào. Hãy thêm người dùng đầu tiên!</p>
      </div>

      <!-- Content — both layouts under one branch, so neither can paint next to
           its own placeholder or next to the empty state. -->
      <template v-else>
      <!-- Mobile Card View -->
      <div class="md:hidden divide-y divide-surface-tint">
        <div v-for="u in users" :key="'m-'+u.id" class="p-4" :class="selection.isSelected(Number(u.id)) ? 'bg-surface-tint' : ''">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <!-- No checkbox on a row the server would refuse: the SuperAdmin
                   account and the operator's own. -->
              <input
                v-if="canSelect(u)"
                type="checkbox"
                class="h-4 w-4 shrink-0 accent-brand-700"
                :checked="selection.isSelected(Number(u.id))"
                :aria-label="`Chọn tài khoản ${u.username}`"
                @change="selection.toggle(Number(u.id))"
              />
              <span class="font-bold text-brand-950 text-[0.9rem]">{{ u.username }}</span>
              <span class="px-2 py-0.5 rounded-xl text-[0.68rem] font-bold capitalize" :class="u.roleName === 'superadmin' ? 'bg-[#ffebe9] text-danger' : u.roleName === 'editor' ? 'bg-[#e4f2e5] text-[#2c6e33]' : 'bg-[#eef2ee] text-[#556655]'">{{ u.roleName }}</span>
            </div>
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[0.7rem] font-bold" :class="u.isActive ? 'bg-[#e4f2e5] text-brand-700' : 'bg-danger-bg text-danger'">
              <i :class="u.isActive ? 'fa-solid fa-lock-open' : 'fa-solid fa-lock'" class="text-[0.6rem]"></i>
              {{ u.isActive ? 'Hoạt động' : 'Đã khóa' }}
            </span>
          </div>
          <p class="text-[0.8rem] text-ink-muted m-0">{{ u.email || 'Chưa có email' }}</p>
          <div class="flex items-center gap-3 mt-2.5">
            <button class="inline-flex items-center gap-1 text-brand-700 font-bold text-[0.8rem] bg-none border-0 cursor-pointer p-0" :data-admin-modal-opener="`user-${u.id}`" @click="openEditModal(u)"><i class="fa-solid fa-pen-to-square"></i> Sửa</button>
            <button class="inline-flex items-center gap-1 text-danger font-bold text-[0.8rem] bg-none border-0 cursor-pointer p-0" @click="deleteUser(u)"><i class="fa-solid fa-trash-can"></i> Xóa</button>
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
              <th class="bg-surface w-10 px-4 py-3 border-b border-line">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-brand-700"
                  :checked="selection.allSelected(visibleIds)"
                  :indeterminate="selection.someSelected(visibleIds)"
                  aria-label="Chọn tất cả tài khoản có thể xử lý"
                  @change="selection.toggleAll(visibleIds)"
                />
              </th>
              <th class="bg-surface px-4 py-3 text-ink-muted font-bold border-b border-line whitespace-nowrap">ID</th>
              <th class="bg-surface px-4 py-3 text-ink-muted font-bold border-b border-line whitespace-nowrap">Tên đăng nhập</th>
              <th class="bg-surface px-4 py-3 text-ink-muted font-bold border-b border-line whitespace-nowrap">Email</th>
              <th class="bg-surface px-4 py-3 text-ink-muted font-bold border-b border-line whitespace-nowrap">Vai trò</th>
              <th class="bg-surface px-4 py-3 text-ink-muted font-bold border-b border-line whitespace-nowrap">Trạng thái</th>
              <th class="bg-surface px-4 py-3 text-ink-muted font-bold border-b border-line whitespace-nowrap">Đăng nhập cuối</th>
              <th class="bg-surface px-4 py-3 text-ink-muted font-bold border-b border-line whitespace-nowrap">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="u in users"
              :key="u.id"
              class="hover:bg-surface"
              :class="selection.isSelected(Number(u.id)) ? 'bg-surface-tint' : ''"
            >
              <td class="px-4 py-3.5 border-b border-surface-tint">
                <input
                  v-if="canSelect(u)"
                  type="checkbox"
                  class="h-4 w-4 accent-brand-700"
                  :checked="selection.isSelected(Number(u.id))"
                  :aria-label="`Chọn tài khoản ${u.username}`"
                  @change="selection.toggle(Number(u.id))"
                />
              </td>
              <td class="px-4 py-3.5 border-b border-surface-tint text-ink-muted">#{{ u.id }}</td>
              <td class="px-4 py-3.5 border-b border-surface-tint font-bold text-brand-950">{{ u.username }}</td>
              <td class="px-4 py-3.5 border-b border-surface-tint text-ink-admin">{{ u.email || '—' }}</td>
              <td class="px-4 py-3.5 border-b border-surface-tint">
                <span
                  class="px-2.5 py-1 rounded-xl text-[0.75rem] font-bold capitalize"
                  :class="u.roleName === 'superadmin' ? 'bg-[#ffebe9] text-danger' : u.roleName === 'editor' ? 'bg-[#e4f2e5] text-[#2c6e33]' : 'bg-[#eef2ee] text-[#556655]'"
                >
                  {{ u.roleName }}
                </span>
              </td>
              <td class="px-4 py-3.5 border-b border-surface-tint">
                <button
                  class="inline-flex items-center gap-1.5 border-0 px-3 py-1.5 rounded-md text-[0.78rem] font-bold cursor-pointer transition-colors"
                  :class="u.isActive ? 'bg-[#e4f2e5] text-brand-700' : 'bg-danger-bg text-danger'"
                  @click="toggleActive(u)"
                  :title="u.isActive ? 'Bấm để khóa tài khoản' : 'Bấm để mở khóa tài khoản'"
                >
                  <i :class="u.isActive ? 'fa-solid fa-lock-open' : 'fa-solid fa-lock'"></i>
                  {{ u.isActive ? 'Hoạt động' : 'Đã khóa' }}
                </button>
              </td>
              <td class="px-4 py-3.5 border-b border-surface-tint text-ink-muted text-[0.82rem] whitespace-nowrap">
                {{ u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('vi-VN') : 'Chưa đăng nhập' }}
              </td>
              <td class="px-4 py-3.5 border-b border-surface-tint">
                <div class="flex items-center gap-2">
                  <button
                    class="w-8 h-8 flex items-center justify-center rounded-md bg-surface border border-[#dce4dd] text-[#445544] cursor-pointer hover:bg-[#e4f2e5] hover:text-brand-900 hover:border-[#a8d5ab] transition-colors"
                    :data-admin-modal-opener="`user-${u.id}`" @click="openEditModal(u)"
                    title="Chỉnh sửa tài khoản"
                  ><i class="fa-solid fa-pen-to-square text-xs"></i></button>
                  <button
                    class="w-8 h-8 flex items-center justify-center rounded-md bg-surface border border-[#dce4dd] text-[#445544] cursor-pointer hover:bg-danger-bg hover:text-danger hover:border-[#f7b5b2] transition-colors"
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
    <AdminModal :open="showModal" title="Thêm Tài khoản Admin Mới" size="sm" :busy="saving" @close="showModal = false">
        <p class="text-[0.82rem] text-ink-muted m-0 mb-5">Cấp tài khoản và gán vai trò quản trị</p>
        <div v-if="errorMsg" class="bg-danger-bg text-danger px-3 py-2 rounded-lg text-[0.82rem] mb-4">{{ errorMsg }}</div>
        <form @submit.prevent="handleCreateUser" class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-ink-admin">Tên đăng nhập (*)</label>
            <input type="text" v-model="form.username" required placeholder="eg: nv_editor" class="w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-ink-admin">Email</label>
            <input type="email" v-model="form.email" placeholder="eg: editor@conduonghuongthien.com.vn" class="w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-ink-admin">Mật khẩu (*)</label>
            <input type="password" v-model="form.password" required :minlength="PASSWORD_MIN_LENGTH" :placeholder="`Tối thiểu ${PASSWORD_MIN_LENGTH} ký tự, có 3 trong 4 loại: hoa, thường, số, ký hiệu`" class="w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-ink-admin">Vai trò (*)</label>
            <select v-model="form.roleId" required class="w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 box-border">
              <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }} — {{ r.description }}</option>
            </select>
          </div>
          <div class="flex justify-end gap-3 mt-2">
            <button type="button" class="bg-[#f0f0f0] border-0 px-4 py-2.5 rounded-lg cursor-pointer font-medium" @click="showModal = false">Hủy</button>
            <button type="submit" :disabled="saving" class="inline-flex items-center gap-2 bg-brand-900 hover:bg-brand-700 text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer transition-colors border-0 disabled:opacity-60 disabled:cursor-not-allowed">{{ saving ? 'Đang tạo…' : 'Tạo Tài Khoản' }}</button>
          </div>
        </form>
    </AdminModal>

    <!-- Edit User Modal -->
    <AdminModal :open="showEditModal" :title="`Chỉnh sửa Tài khoản: ${editForm.username}`" size="sm" :busy="saving" @close="showEditModal = false">
        <p class="text-[0.82rem] text-ink-muted m-0 mb-5">Cập nhật Email, Vai trò, Trạng thái hoặc Đổi mật khẩu mới</p>
        <div v-if="errorMsg" class="bg-danger-bg text-danger px-3 py-2 rounded-lg text-[0.82rem] mb-4">{{ errorMsg }}</div>
        <form @submit.prevent="handleUpdateUser" class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-ink-admin">Tên đăng nhập</label>
            <input type="text" :value="editForm.username" disabled class="w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm bg-surface text-[#778877] cursor-not-allowed box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-ink-admin">Email</label>
            <input type="email" v-model="editForm.email" placeholder="eg: user@conduonghuongthien.com.vn" class="w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-ink-admin">Vai trò (Role)</label>
            <select v-model="editForm.roleId" required class="w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 box-border">
              <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }} — {{ r.description }}</option>
            </select>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-ink-admin">Đổi mật khẩu mới (Để trống nếu giữ nguyên)</label>
            <input type="password" v-model="editForm.password" :minlength="PASSWORD_MIN_LENGTH" :placeholder="`Mật khẩu mới (tối thiểu ${PASSWORD_MIN_LENGTH} ký tự) nếu muốn đổi`" class="w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-ink-admin">Trạng thái tài khoản</label>
            <select v-model="editForm.isActive" class="w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 box-border">
              <option :value="true">🟢 Hoạt động (Được phép đăng nhập)</option>
              <option :value="false">🔴 Đã khóa (Bị chặn đăng nhập)</option>
            </select>
          </div>
          <div class="flex justify-end gap-3 mt-2">
            <button type="button" class="bg-[#f0f0f0] border-0 px-4 py-2.5 rounded-lg cursor-pointer font-medium" @click="showEditModal = false">Hủy</button>
            <button type="submit" :disabled="saving" class="inline-flex items-center gap-2 bg-brand-900 hover:bg-brand-700 text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer transition-colors border-0 disabled:opacity-60 disabled:cursor-not-allowed">{{ saving ? 'Đang lưu…' : 'Cập Nhật Tài Khoản' }}</button>
          </div>
        </form>
    </AdminModal>
  </div>
</template>
