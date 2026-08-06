<script setup lang="ts">
import type { AdminRoleRow } from '~/types/admin-api'
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
  error.value = ''
  try {
    const res = await $fetch('/api/admin/roles')
    if (res.ok) {
      roles.value = res.roles
      const first = roles.value[0]
      if (first && !selectedRole.value) selectRole(first)
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
  resourcesList.forEach(r => {
    const existingPerm = role.permissions?.find((p) => p.resource === r.key)
    permissionMatrix[r.key] = {
      canCreate: existingPerm ? Boolean(existingPerm.canCreate) : false,
      canRead:   existingPerm ? Boolean(existingPerm.canRead)   : false,
      canUpdate: existingPerm ? Boolean(existingPerm.canUpdate) : false,
      canDelete: existingPerm ? Boolean(existingPerm.canDelete) : false,
    }
  })
}

// One row per resource paired with its (always-present) matrix entry: selectRole
// seeds every key before the table renders, and pairing here gives v-model a
// non-optional target.
const matrixRows = computed(() => resourcesList.flatMap((res) => {
  const perm = permissionMatrix[res.key]
  return perm ? [{ res, perm }] : []
}))

const handleSavePermissions = async () => {
  if (!selectedRole.value) return
  saving.value = true
  const permsPayload = Object.entries(permissionMatrix).map(([resource, perm]) => ({ resource, ...perm }))
  try {
    const res = await $fetch(`/api/admin/roles/${selectedRole.value.id}`, {
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

onMounted(() => { fetchRoles() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div>
      <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Quản lý Vai trò & Phân quyền Rules</h1>
      <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Thiết lập chi tiết quyền Xem, Thêm, Sửa, Xóa cho từng vai trò trong hệ thống</p>
    </div>

    <!-- Two-column layout: sidebar + matrix -->
    <div class="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
      <!-- Roles Sidebar -->
      <div class="bg-white rounded-xl border border-[#e2ece3] p-4">
        <h3 class="text-[0.95rem] font-extrabold text-[#122815] m-0 mb-3">Danh sách Vai trò</h3>
        <div v-if="loading" class="flex flex-col gap-2" role="status" aria-busy="true">
          <span class="sr-only">Đang tải danh sách vai trò</span>
          <div
            v-for="n in 4"
            :key="'rs-' + n"
            class="rounded-lg border border-[#e2ece3] bg-[#f8faf8] p-3 flex flex-col gap-2"
            aria-hidden="true"
          >
            <div class="h-4 w-32 rounded bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
            <div class="h-3 w-44 rounded bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
          </div>
        </div>
        <div v-else class="flex flex-col gap-2">
          <button
            v-for="r in roles"
            :key="r.id"
            class="text-left border rounded-lg p-3 cursor-pointer transition-all"
            :class="selectedRole?.id === r.id ? 'bg-[#e4f2e5] border-[#2c6e33]' : 'bg-[#f8faf8] border-[#e2ece3] hover:border-[#8ed694]'"
            @click="selectRole(r)"
          >
            <div class="flex items-center justify-between mb-1">
              <strong class="text-[0.88rem] text-[#122815]">{{ r.name }}</strong>
              <span v-if="r.isSystem" class="text-[0.65rem] bg-[#2c6e33] text-white px-1.5 py-0.5 rounded font-bold">Hệ thống</span>
            </div>
            <span class="text-[0.75rem] text-[#667768]">{{ r.description }}</span>
          </button>
        </div>
      </div>

      <!-- Permission Matrix — loading. Stays inline: the matrix is a one-off
           shape (a label column plus four narrow checkbox columns), not the
           generic table SkeletonTable draws. -->
      <div v-if="loading" class="bg-white rounded-xl border border-[#e2ece3] p-6" role="status" aria-busy="true">
        <span class="sr-only">Đang tải ma trận phân quyền</span>
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4" aria-hidden="true">
          <div class="flex flex-col gap-2">
            <div class="h-5 w-64 rounded bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
            <div class="h-3 w-48 rounded bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
          </div>
          <div class="h-10 w-40 rounded-lg bg-[#dfe9e0] animate-pulse motion-reduce:animate-none shrink-0"></div>
        </div>
        <div class="overflow-x-auto" aria-hidden="true">
          <div class="flex items-center gap-3 bg-[#f8faf8] border-b border-[#e2ece3] px-3 py-3">
            <div class="h-3 flex-1 rounded bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
            <div v-for="c in 4" :key="'mh-' + c" class="h-3 w-24 rounded bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
          </div>
          <div v-for="n in 11" :key="'mr-' + n" class="flex items-center gap-3 border-b border-[#eef2ee] px-3 py-3">
            <div class="h-4 flex-1 rounded bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
            <div v-for="c in 4" :key="'mc-' + c" class="h-4 w-24 flex justify-center">
              <div class="h-4 w-4 rounded bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="error" role="alert" class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]">
        <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
        {{ error }} Vui lòng <button type="button" class="text-[#4A6741] font-bold underline" @click="fetchRoles()">thử lại</button>.
      </div>
      <div v-else-if="selectedRole" class="bg-white rounded-xl border border-[#e2ece3] p-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h2 class="text-[1.1rem] font-extrabold text-[#122815] m-0">Ma trận Phân quyền: {{ selectedRole.name }}</h2>
            <p class="text-[0.82rem] text-[#667768] mt-1 mb-0">{{ selectedRole.description }}</p>
          </div>
          <button
            class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer transition-colors border-0 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            @click="handleSavePermissions"
            :disabled="saving || selectedRoleLocked"
          >
            <i class="fa-solid fa-floppy-disk"></i>
            {{ saving ? 'Đang lưu...' : 'Lưu Phân Quyền' }}
          </button>
        </div>

        <div v-if="selectedRoleLocked" class="bg-[#eef7ee] border border-[#cce5cd] text-[#1e4620] px-4 py-3 rounded-lg text-[0.85rem] mb-4">
          🔒 Vai trò hệ thống <strong>(SuperAdmin)</strong> mặc định có toàn bộ quyền trên website.
        </div>

        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-[0.88rem]">
            <thead>
              <tr>
                <th class="bg-[#f8faf8] px-3 py-3 text-left text-[#667768] font-bold border-b border-[#e2ece3]">Tài nguyên / Tính năng</th>
                <th class="bg-[#f8faf8] px-3 py-3 text-center text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Thêm (Create)</th>
                <th class="bg-[#f8faf8] px-3 py-3 text-center text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Xem (Read)</th>
                <th class="bg-[#f8faf8] px-3 py-3 text-center text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Sửa (Update)</th>
                <th class="bg-[#f8faf8] px-3 py-3 text-center text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Xóa (Delete)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="{ res, perm } in matrixRows" :key="res.key" class="hover:bg-[#fafcfa]">
                <td class="px-3 py-3 border-b border-[#eef2ee]">
                  <strong>{{ res.label }}</strong>
                  <code class="ml-1.5 text-[0.72rem] text-[#888]">({{ res.key }})</code>
                </td>
                <td class="px-3 py-3 border-b border-[#eef2ee] text-center">
                  <input type="checkbox" v-model="perm.canCreate" :disabled="selectedRoleLocked" class="w-4 h-4 accent-[#2c6e33]" />
                </td>
                <td class="px-3 py-3 border-b border-[#eef2ee] text-center">
                  <input type="checkbox" v-model="perm.canRead" :disabled="selectedRoleLocked" class="w-4 h-4 accent-[#2c6e33]" />
                </td>
                <td class="px-3 py-3 border-b border-[#eef2ee] text-center">
                  <input type="checkbox" v-model="perm.canUpdate" :disabled="selectedRoleLocked" class="w-4 h-4 accent-[#2c6e33]" />
                </td>
                <td class="px-3 py-3 border-b border-[#eef2ee] text-center">
                  <input type="checkbox" v-model="perm.canDelete" :disabled="selectedRoleLocked" class="w-4 h-4 accent-[#2c6e33]" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
