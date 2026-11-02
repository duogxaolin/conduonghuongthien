<script setup lang="ts">
import type { AdminRoleRow } from '~/types/admin-api'
import type { AdminRoleCreateResponse, AdminRoleDeleteResponse, AdminRolesResponse, AdminRoleUpdateResponse } from '~/types/admin-users-api'
import AdminModal from '~/components/admin/AdminModal.vue'
// `~~` resolves from the repository root for both Vite's client build and
// Nitro's server bundle. A relative traversal beyond `app/` stays verbatim in
// the generated SSR chunk, where it points at the wrong directory.
import { ROLE_MATRIX_RESOURCES, ROLE_MATRIX_ACTIONS, rolePermissionMatrix, type PermissionFlags } from '~~/shared/permissions'
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const roles = ref<AdminRoleRow[]>([])
const selectedRole = ref<AdminRoleRow | null>(null)

/**
 * `roles.is_system` là cột nullable (`TINYINT(1) DEFAULT 0` — DDL và schema.ts
 * khớp nhau, đây không phải lệch schema). Nhưng `:disabled` cần một boolean
 * thật: gán thẳng `boolean | null` thì `null` đọc thành **không khoá**, nên một
 * hàng có `is_system` chưa đặt sẽ để cán bộ sửa được ma trận quyền của một vai
 * trò hệ thống. `any` đang che đúng chỗ này — cổng typecheck chỉ nhìn thấy nó
 * sau khi kiểu thật được khai.
 *
 * Máy chủ vẫn là nơi quyết định cuối (`assertRoleAssignable`); cái này chỉ giữ
 * cho giao diện không mời người ta làm một việc sẽ bị từ chối.
 */
const selectedRoleLocked = computed(() => selectedRole.value?.isSystem === true)
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const deleting = ref(false)
/** A refused delete, kept beside the button until another role is picked (`selectRole`). */
const deleteError = ref('')

// The matrix SHOWS the catalog without its retired cells ("Trang chủ", "Kiểm thử" — no
// handler checks them), but `permissionMatrix` still holds every cell and the save sends
// them all back as stored: the PUT replaces the role's rows with the payload, so a cell
// left out of it would be wiped (`RETIRED_PERMISSION_*`, shared/permissions.ts).
const resourcesList = ROLE_MATRIX_RESOURCES

const permissionMatrix = ref<Record<string, PermissionFlags>>({})
const toast = useToast()
const { confirm } = useConfirm()
const { hasPermission } = useAdminAuth()
// The server decides (`roles.create` / `roles.delete` in the two handlers); these only keep
// the page from offering an action it is certain to refuse.
const canCreateRole = computed(() => hasPermission('roles', 'create'))
const canDeleteRole = computed(() => hasPermission('roles', 'delete'))
const canUpdateRole = computed(() => hasPermission('roles', 'update'))
/** Ticks cannot be saved: a system role, or no `roles.update` (`[id].put.ts` would 403). */
const matrixReadOnly = computed(() => selectedRoleLocked.value || !canUpdateRole.value)

/** `selectId`: the role to show after the reload (a role just created); default the one shown. */
const fetchRoles = async (selectId?: number) => {
  loading.value = true
  error.value = ''
  try {
    const res = await adminFetch<AdminRolesResponse>(`/api/admin/roles`)
    if (res.ok) {
      roles.value = res.roles
      const wanted = selectId ?? selectedRole.value?.id
      const current = roles.value.find(role => role.id === wanted) ?? roles.value[0]
      if (current) selectRole(current)
    } else {
      error.value = 'Không tải được danh sách vai trò.'
    }
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không tải được danh sách vai trò.')
  } finally {
    loading.value = false
  }
}

const selectRole = (role: AdminRoleRow) => {
  selectedRole.value = role
  permissionMatrix.value = rolePermissionMatrix(role.permissions ?? [])
  deleteError.value = ''
}

// One row per resource paired with its (always-present) matrix entry: selectRole
// seeds every key before the table renders, and pairing here gives v-model a
// non-optional target.
const matrixRows = computed(() => resourcesList.flatMap((res) => {
  const perm = permissionMatrix.value[res.key]
  return perm ? [{ res, perm }] : []
}))

const handleSavePermissions = async () => {
  if (!selectedRole.value || matrixReadOnly.value) return
  saving.value = true
  const permsPayload = Object.entries(permissionMatrix.value).map(([resource, perm]) => ({ resource, ...perm }))
  try {
    const res = await adminFetch<AdminRoleUpdateResponse>(`/api/admin/roles/${selectedRole.value.id}`, {
      method: 'PUT',
      body: { permissions: permsPayload }
    })
    if (res.ok) { toast.success('Đã cập nhật phân quyền thành công!'); await fetchRoles() }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi lưu phân quyền'))
  } finally {
    saving.value = false
  }
}

// ─── Thêm vai trò (`POST /api/admin/roles`) ──────────────────────────────────
// Name and description only: the new role starts with no permission, and its matrix is set
// in the editor below (the role is selected after the reload) — one place to tick rights.
const showCreate = ref(false)
const creating = ref(false)
const createError = ref('')
const createForm = reactive({ name: '', description: '' })

const openCreate = () => {
  createForm.name = ''
  createForm.description = ''
  createError.value = ''
  showCreate.value = true
}
const closeCreate = () => { if (!creating.value) showCreate.value = false }

const handleCreateRole = async () => {
  if (creating.value) return
  createError.value = ''
  creating.value = true
  try {
    const res = await adminFetch<AdminRoleCreateResponse>(`/api/admin/roles`, {
      method: 'POST',
      body: { name: createForm.name, description: createForm.description },
    })
    if (res.ok) {
      toast.success(`Đã tạo vai trò ${createForm.name.trim()}. ${canUpdateRole.value ? 'Hãy chọn quyền rồi bấm "Lưu Phân Quyền".' : 'Nhờ người có quyền sửa vai trò gán quyền cho vai trò này.'}`)
      showCreate.value = false
      await fetchRoles(res.id)
    }
  } catch (err: unknown) {
    // Kept in the dialog with what was typed: the server's sentence says what to fix
    // (a name already taken, too short, too long).
    createError.value = errorMessage(err, 'Không tạo được vai trò.')
  } finally {
    creating.value = false
  }
}

// ─── Xóa vai trò (`DELETE /api/admin/roles/:id`) ─────────────────────────────
/**
 * Why "Xóa vai trò" is greyed out: the two refusals of `roles/[id].delete.ts`, read from what
 * the list already says (`isSystem`; `userCount` = accounts holding the role, the rows that
 * handler checks). Not a guess at the rule — and not the last word: an account given the role
 * after the list loaded still comes back as the server's 400 sentence.
 */
const deleteBlockReason = computed(() => {
  const role = selectedRole.value
  if (!role) return ''
  if (role.isSystem === true) return 'Vai trò hệ thống không xóa được.'
  if (role.userCount > 0) return `Còn ${role.userCount} tài khoản đang dùng vai trò này — gán vai trò khác cho các tài khoản đó trước khi xóa.`
  return ''
})

const handleDeleteRole = async () => {
  const role = selectedRole.value
  if (!role || deleting.value || deleteBlockReason.value) return
  deleteError.value = ''
  const accepted = await confirm({
    title: 'Xóa vai trò',
    message: `Xóa vai trò "${role.name}"? Toàn bộ ma trận phân quyền của vai trò này bị xóa theo. Thao tác không thể hoàn tác.`,
    danger: true,
    confirmLabel: 'Xóa vai trò',
  })
  if (!accepted) return
  deleting.value = true
  try {
    const res = await adminFetch<AdminRoleDeleteResponse>(`/api/admin/roles/${role.id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success(`Đã xóa vai trò ${role.name}.`)
      await fetchRoles()
    }
  } catch (err: unknown) {
    deleteError.value = errorMessage(err, 'Không xóa được vai trò.')
  } finally {
    deleting.value = false
  }
}

onMounted(() => { fetchRoles() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div>
      <h1 class="text-[1.3rem] font-extrabold text-brand-950 m-0">Quản lý Vai trò & Phân quyền Rules</h1>
      <p class="text-[0.85rem] text-ink-muted mt-1 mb-0">Thiết lập quyền cho từng tài nguyên. Quyền Xuất bản và Lưu trữ áp dụng tại các chức năng có hỗ trợ.</p>
    </div>

    <!-- Two-column layout: sidebar + matrix -->
    <div class="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
      <!-- Roles Sidebar -->
      <div class="bg-white rounded-xl border border-line p-4">
        <div class="flex items-center justify-between gap-2 mb-3">
          <h3 class="text-[0.95rem] font-extrabold text-brand-950 m-0">Danh sách Vai trò</h3>
          <button
            v-if="canCreateRole"
            type="button"
            class="inline-flex items-center gap-1.5 bg-brand-900 hover:bg-brand-700 text-white font-bold text-[0.8rem] px-3 py-2 rounded-lg cursor-pointer border-0 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 shrink-0"
            @click="openCreate"
          >
            <i class="fa-solid fa-plus" aria-hidden="true"></i>
            Thêm vai trò
          </button>
        </div>
        <div v-if="loading" class="flex flex-col gap-2" role="status" aria-busy="true">
          <span class="sr-only">Đang tải danh sách vai trò</span>
          <div
            v-for="n in 4"
            :key="'rs-' + n"
            class="rounded-lg border border-line bg-surface p-3 flex flex-col gap-2"
            aria-hidden="true"
          >
            <div class="h-4 w-32 rounded bg-line animate-pulse motion-reduce:animate-none"></div>
            <div class="h-3 w-44 rounded bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
          </div>
        </div>
        <div v-else class="flex flex-col gap-2">
          <button
            v-for="r in roles"
            :key="r.id"
            class="text-left border rounded-lg p-3 cursor-pointer transition-all"
            :class="selectedRole?.id === r.id ? 'bg-[#e4f2e5] border-brand-700' : 'bg-surface border-line hover:border-brand-300'"
            @click="selectRole(r)"
          >
            <div class="flex items-center justify-between mb-1">
              <strong class="text-[0.88rem] text-brand-950">{{ r.name }}</strong>
              <span v-if="r.isSystem" class="text-[0.65rem] bg-brand-700 text-white px-1.5 py-0.5 rounded font-bold">Hệ thống</span>
            </div>
            <span class="text-[0.75rem] text-ink-muted">{{ r.description }}</span>
          </button>
        </div>
      </div>

      <!-- Permission Matrix — loading. Stays inline: the matrix is a one-off
           shape (a label column plus narrow checkbox columns), not the
           generic table SkeletonTable draws. -->
      <div v-if="loading" class="bg-white rounded-xl border border-line p-6" role="status" aria-busy="true">
        <span class="sr-only">Đang tải ma trận phân quyền</span>
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4" aria-hidden="true">
          <div class="flex flex-col gap-2">
            <div class="h-5 w-64 rounded bg-line animate-pulse motion-reduce:animate-none"></div>
            <div class="h-3 w-48 rounded bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
          </div>
          <div class="h-10 w-40 rounded-lg bg-line animate-pulse motion-reduce:animate-none shrink-0"></div>
        </div>
        <div class="overflow-x-auto" aria-hidden="true">
          <div class="flex items-center gap-3 bg-surface border-b border-line px-3 py-3">
            <div class="h-3 flex-1 rounded bg-line animate-pulse motion-reduce:animate-none"></div>
            <div v-for="c in 6" :key="'mh-' + c" class="h-3 w-24 rounded bg-line animate-pulse motion-reduce:animate-none"></div>
          </div>
          <div v-for="n in 11" :key="'mr-' + n" class="flex items-center gap-3 border-b border-surface-tint px-3 py-3">
            <div class="h-4 flex-1 rounded bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
            <div v-for="c in 6" :key="'mc-' + c" class="h-4 w-24 flex justify-center">
              <div class="h-4 w-4 rounded bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="error" role="alert" class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-danger-soft text-[0.95rem]">
        <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
        {{ error }} Vui lòng <button type="button" class="text-brand-600 font-bold underline" @click="fetchRoles()">thử lại</button>.
      </div>
      <div v-else-if="selectedRole" class="bg-white rounded-xl border border-line p-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h2 class="text-[1.1rem] font-extrabold text-brand-950 m-0">Ma trận Phân quyền: {{ selectedRole.name }}</h2>
            <p class="text-[0.82rem] text-ink-muted mt-1 mb-0">{{ selectedRole.description }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2 shrink-0">
            <button
              v-if="canDeleteRole"
              type="button"
              class="inline-flex items-center gap-2 bg-white border border-danger text-danger font-bold px-4 py-2.5 rounded-lg cursor-pointer transition-colors motion-reduce:transition-none hover:bg-danger-bg disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              :disabled="deleting || deleteBlockReason !== ''"
              :aria-describedby="deleteBlockReason ? 'role-delete-blocked' : undefined"
              @click="handleDeleteRole"
            >
              <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
              {{ deleting ? 'Đang xóa…' : 'Xóa vai trò' }}
            </button>
            <button
              class="inline-flex items-center gap-2 bg-brand-900 hover:bg-brand-700 text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer transition-colors border-0 disabled:opacity-50 disabled:cursor-not-allowed"
              @click="handleSavePermissions"
              :disabled="saving || matrixReadOnly"
              :aria-describedby="!selectedRoleLocked && !canUpdateRole ? 'role-save-blocked' : undefined"
            >
              <i class="fa-solid fa-floppy-disk"></i>
              {{ saving ? 'Đang lưu...' : 'Lưu Phân Quyền' }}
            </button>
          </div>
        </div>

        <p v-if="!selectedRoleLocked && !canUpdateRole" id="role-save-blocked" class="text-[0.8rem] text-ink-muted mt-0 mb-4">
          <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>Bạn chỉ xem được ma trận: cần quyền Sửa trên "Vai trò & Phân quyền" để lưu. Nhờ người có quyền sửa vai trò gán quyền.
        </p>
        <p v-if="canDeleteRole && deleteBlockReason" id="role-delete-blocked" class="text-[0.8rem] text-ink-muted mt-0 mb-4">
          <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>{{ deleteBlockReason }}
        </p>
        <p v-if="deleteError" role="alert" class="bg-danger-bg text-danger px-4 py-2.5 rounded-lg text-[0.85rem] mt-0 mb-4">
          <i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>{{ deleteError }}
        </p>

        <div v-if="selectedRoleLocked" class="bg-surface-tint border border-[#cce5cd] text-brand-900 px-4 py-3 rounded-lg text-[0.85rem] mb-4">
          🔒 Vai trò hệ thống <strong>(SuperAdmin)</strong> mặc định có toàn bộ quyền trên website.
        </div>

        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-[0.88rem]">
            <thead>
              <tr>
                <th class="bg-surface px-3 py-3 text-left text-ink-muted font-bold border-b border-line">Tài nguyên / Tính năng</th>
                <th v-for="action in ROLE_MATRIX_ACTIONS" :key="action.flag" class="bg-surface px-3 py-3 text-center text-ink-muted font-bold border-b border-line whitespace-nowrap">{{ action.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="{ res, perm } in matrixRows" :key="res.key" class="hover:bg-surface">
                <td class="px-3 py-3 border-b border-surface-tint">
                  <strong>{{ res.label }}</strong>
                  <code class="ml-1.5 text-[0.72rem] text-[#888]">({{ res.key }})</code>
                </td>
                <td v-for="action in ROLE_MATRIX_ACTIONS" :key="action.flag" class="px-3 py-3 border-b border-surface-tint text-center">
                  <input type="checkbox" v-model="perm[action.flag]" :aria-label="`${res.label}: ${action.label}`" :disabled="matrixReadOnly" class="w-4 h-4 accent-brand-700" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Thêm vai trò -->
    <AdminModal :open="showCreate" title="Thêm vai trò" size="sm" :busy="creating" @close="closeCreate">
      <form class="flex flex-col gap-4" @submit.prevent="handleCreateRole">
        <p class="text-[0.82rem] text-ink-muted m-0">Vai trò mới chưa có quyền nào. {{ canUpdateRole ? 'Sau khi tạo, đánh dấu quyền trong ma trận rồi bấm "Lưu Phân Quyền".' : 'Bạn không có quyền sửa vai trò: sau khi tạo, nhờ người có quyền sửa vai trò gán quyền.' }}</p>
        <p v-if="createError" id="role-create-error" role="alert" class="bg-danger-bg text-danger px-3 py-2 rounded-lg text-[0.82rem] m-0">{{ createError }}</p>
        <div class="flex flex-col gap-1.5">
          <label for="role-create-name" class="text-[0.82rem] font-bold text-ink-admin">Tên vai trò (*)</label>
          <input
            id="role-create-name"
            v-model="createForm.name"
            type="text"
            required
            minlength="2"
            maxlength="64"
            autocomplete="off"
            data-autofocus
            :aria-describedby="createError ? 'role-create-error' : undefined"
            class="w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="role-create-description" class="text-[0.82rem] font-bold text-ink-admin">Mô tả</label>
          <input
            id="role-create-description"
            v-model="createForm.description"
            type="text"
            maxlength="255"
            autocomplete="off"
            class="w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border"
          />
        </div>
        <div class="flex justify-end gap-3 mt-2">
          <button
            type="button"
            class="bg-surface-tint text-ink-admin border-0 px-4 py-2.5 rounded-lg cursor-pointer font-medium disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            :disabled="creating"
            @click="closeCreate"
          >Hủy</button>
          <button
            type="submit"
            :disabled="creating"
            class="inline-flex items-center gap-2 bg-brand-900 hover:bg-brand-700 text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer transition-colors motion-reduce:transition-none border-0 disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >{{ creating ? 'Đang tạo…' : 'Tạo vai trò' }}</button>
        </div>
      </form>
    </AdminModal>
  </div>
</template>
