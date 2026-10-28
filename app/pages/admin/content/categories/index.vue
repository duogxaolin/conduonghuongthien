<script setup lang="ts">
import type { AdminCategoryRow, AdminContentTypeRow } from '~/types/admin-api'
import type { AdminCategoriesResponse, AdminCategoryDeleteResponse, AdminCategorySaveResponse, AdminContentTypesResponse } from '~/types/admin-taxonomy-api'
import AdminModal from '~/components/admin/AdminModal.vue'
import { slugify, slugifyDraft } from '~~/shared/slugify'
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const toast = useToast()
const { confirm } = useConfirm()
const route = useRoute()

// ─── State ────────────────────────────────────────────────────────────────────
const categories = ref<AdminCategoryRow[]>([])
const contentTypes = ref<AdminContentTypeRow[]>([])
const loading = ref(true)
const error = ref('')

// Type filter from ?type= query (set by the Thể loại → Danh mục link)
const typeFilter = ref(String(route.query.type || '').trim())

// Options + labels derived from the content_types table (dynamic)
const typeOptions = computed(() =>
  contentTypes.value.map((t) => ({ value: t.slug, label: t.name }))
)
const typeLabels = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  for (const t of contentTypes.value) map[t.slug] = t.name
  return map
})
const defaultType = computed(() => typeFilter.value || contentTypes.value[0]?.slug || '')

// ─── Modal state ──────────────────────────────────────────────────────────────
const showModal = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const editingId = ref<number | null>(null)
const saving = ref(false)

const form = reactive({
  name: '',
  slug: '',
  type: 'news',
  description: '',
  parentId: null as number | null,
  displayOrder: 0,
})

// Slug (`shared/slugify.ts`, cùng luật máy chủ lưu): sinh từ tên, rời ô và lúc lưu
// dùng bản chuẩn `slugify`; đang gõ dùng `slugifyDraft` — giữ gạch cuối để gõ tiếp.
watch(() => form.name, (val) => {
  if (modalMode.value === 'create') {
    form.slug = slugify(val)
  }
})

/**
 * Validate slug real-time: nếu admin nhập tay ký tự không hợp lệ → slug sau slugify
 * khác input → báo lỗi + auto-clean. Nút Lưu disabled khi slugError truthy. Đo bằng
 * bản "đang gõ": gạch cuối chưa gõ xong không phải lỗi (rời ô/lưu sẽ cắt nó).
 */
const slugError = computed(() => {
  if (!form.slug) return ''
  const cleaned = slugifyDraft(form.slug)
  if (cleaned !== form.slug) {
    return 'Định danh chỉ chứa chữ thường, số, gạch ngang. Không dấu, không khoảng trắng, không ký tự lạ.'
  }
  return ''
})

// Auto-clean slug khi admin paste ký tự sai — slug tự đổi + lỗi biến mất.
watch(() => form.slug, (val) => {
  if (val && slugifyDraft(val) !== val) {
    form.slug = slugifyDraft(val)
  }
})

const onSlugBlur = () => { form.slug = slugify(form.slug) }

// ─── Computed tree ────────────────────────────────────────────────────────────
const tree = computed(() => {
  const scoped = typeFilter.value
    ? categories.value.filter((c) => c.type === typeFilter.value)
    : categories.value
  const roots = scoped.filter((c) => !c.parentId)
  return roots.map((root) => ({
    ...root,
    children: scoped.filter((c) => c.parentId === root.id),
  }))
})

// Roots of same type for parent dropdown (only when editing a childless cat or creating)
const parentOptions = computed(() => {
  return categories.value.filter(
    (c) => c.type === form.type && !c.parentId && c.id !== editingId.value
  )
})

// ─── Fetch ────────────────────────────────────────────────────────────────────
// Mỗi lượt tải một mã: "Tạo Danh Mục Mới" bấm được khi lượt tải lại đang chạy — chỉ lượt mới
// nhất ghi hàng/lỗi/đang tải, lượt cũ về sau không xoá hàng vừa tạo (fetch-rollout-d-fetch.md).
let listRequest = 0
const fetchCategories = async () => {
  const ticket = ++listRequest
  loading.value = true
  error.value = ''
  try {
    const { items } = await adminFetch<AdminCategoriesResponse>(`/api/admin/categories`)
    if (ticket === listRequest) { categories.value = items; selection.keepOnly(visibleIds.value) }
  } catch (err: unknown) {
    if (ticket === listRequest) error.value = errorMessage(err, 'Không tải được danh sách danh mục.')
  } finally {
    if (ticket === listRequest) loading.value = false
  }
}

const fetchContentTypes = async () => {
  try {
    contentTypes.value = (await adminFetch<AdminContentTypesResponse>(`/api/admin/content-types`)).items
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi tải thể loại'))
  }
}

// ─── Open modal ───────────────────────────────────────────────────────────────
const openCreate = (presetParentId?: number) => {
  modalMode.value = 'create'
  editingId.value = null
  form.name = ''
  form.slug = ''
  form.type = defaultType.value || contentTypes.value[0]?.slug || ''
  form.description = ''
  form.parentId = presetParentId ?? null
  form.displayOrder = 0
  showModal.value = true
}

const openEdit = (cat: AdminCategoryRow) => {
  modalMode.value = 'edit'
  editingId.value = cat.id
  form.name = cat.name
  form.slug = cat.slug
  form.type = cat.type
  form.description = cat.description || ''
  form.parentId = cat.parentId ?? null
  form.displayOrder = cat.displayOrder ?? 0
  showModal.value = true
}

// ─── Save ─────────────────────────────────────────────────────────────────────
const handleSave = async () => {
  if (!form.name.trim()) { toast.warning('Tên danh mục không được để trống'); return }
  saving.value = true
  try {
    const payload = {
      name: form.name.trim(),
      slug: slugify(form.slug),
      type: form.type,
      description: form.description.trim() || null,
      parentId: form.parentId || null,
      displayOrder: form.displayOrder,
    }
    if (modalMode.value === 'create') {
      await adminFetch<AdminCategorySaveResponse>(`/api/admin/categories`, { method: 'POST', body: payload })
      toast.success('Đã tạo danh mục thành công!')
    } else {
      await adminFetch<AdminCategorySaveResponse>(`/api/admin/categories/${editingId.value}`, { method: 'PUT', body: payload })
      toast.success('Đã cập nhật danh mục thành công!')
    }
    showModal.value = false
    await fetchCategories()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi lưu danh mục'))
  } finally {
    saving.value = false
  }
}

// ─── Bulk selection ───────────────────────────────────────────────────────────
const selection = useBulkSelection()
const bulk = useBulkAction(selection)
/**
 * Flattened over BOTH levels: the table renders a root row followed by its child
 * rows, so a header checkbox that only covered roots would look like "select all"
 * while leaving every child untouched.
 */
const visibleIds = computed(() => tree.value.flatMap(root => [Number(root.id), ...root.children.map((c) => Number(c.id))]))

/**
 * A parent is refused while it still has children, so selecting a parent and its
 * children together works only because runBulk is sequential: the children are
 * deleted first when they sort earlier, and otherwise the parent is reported as
 * blocked and stays ticked for a second pass.
 */
const bulkDelete = () => bulk.run({
  url: '/api/admin/categories/bulk-delete',
  noun: 'danh mục',
  confirm: {
    title: 'Xóa danh mục',
    message: `Xóa ${selection.count.value} danh mục đã chọn? Danh mục còn danh mục con hoặc còn bài viết sẽ bị bỏ qua.`,
    danger: true,
    confirmLabel: 'Xóa',
  },
  reload: () => fetchCategories(),
})

// ─── Delete ───────────────────────────────────────────────────────────────────
const deleteCategory = async (cat: AdminCategoryRow) => {
  const ok = await confirm({ title: 'Xóa danh mục', message: `Bạn có chắc muốn xóa danh mục "${cat.name}"?`, danger: true, confirmLabel: 'Xóa' })
  if (!ok) return
  try {
    await adminFetch<AdminCategoryDeleteResponse>(`/api/admin/categories/${cat.id}`, { method: 'DELETE' })
    toast.success('Đã xóa danh mục thành công!')
    await fetchCategories()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi xóa danh mục'))
  }
}

onMounted(() => {
  fetchContentTypes()
  fetchCategories()
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-[1.3rem] font-extrabold text-brand-950 m-0">Quản lý Danh mục</h1>
        <p class="text-[0.85rem] text-ink-muted mt-1 mb-0">Phân loại bài viết theo danh mục cha — con (tối đa 2 cấp)</p>
      </div>
      <button
        class="inline-flex items-center gap-2 bg-brand-900 hover:bg-brand-700 text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer border-0 transition-colors shrink-0"
        @click="openCreate()"
      >
        <i class="fa-solid fa-folder-plus"></i> Tạo Danh Mục Mới
      </button>
    </div>

    <AdminBulkActionBar
      v-if="selection.count.value"
      :count="selection.count.value"
      :busy="bulk.busy.value"
      noun="danh mục"
      @clear="selection.clear()"
    >
      <button type="button" class="rounded-lg bg-danger px-3 py-2 text-sm font-bold text-white hover:bg-[#b01f1b]" @click="bulkDelete">Xóa</button>
    </AdminBulkActionBar>

    <!-- Loading -->
    <div v-if="loading" role="status" aria-busy="true" class="bg-white rounded-xl border border-line p-6">
      <span class="sr-only">Đang tải danh sách danh mục</span>
      <div class="flex flex-col gap-3 animate-pulse motion-reduce:animate-none">
        <div v-for="n in 6" :key="n" class="flex gap-3">
          <div v-for="c in 6" :key="c" class="h-10 bg-surface-tint rounded flex-1" aria-hidden="true"></div>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" role="alert" class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-danger-soft text-[0.95rem]">
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ error }} Vui lòng <button type="button" class="text-brand-600 font-bold underline" @click="fetchCategories()">thử lại</button>.
    </div>

    <!-- Empty state -->
    <div v-else-if="tree.length === 0" class="bg-white rounded-xl border border-line py-14 flex flex-col items-center gap-3 text-center">
      <i class="fa-solid fa-folder-open text-4xl text-line-strong"></i>
      <p class="text-ink-muted text-[0.9rem] m-0">Chưa có danh mục nào. Hãy tạo danh mục đầu tiên!</p>
      <button
        class="inline-flex items-center gap-2 bg-brand-900 text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer border-0 hover:bg-brand-700 transition-colors"
        @click="openCreate()"
      >
        <i class="fa-solid fa-folder-plus"></i> Tạo Danh Mục
      </button>
    </div>

    <!-- Tree table -->
    <div v-else class="bg-white rounded-xl border border-line overflow-hidden">
      <!-- Mobile Card View -->
      <div class="md:hidden divide-y divide-surface-tint">
        <template v-for="root in tree" :key="'m-'+root.id">
          <div class="p-4" :class="selection.isSelected(Number(root.id)) ? 'bg-surface-tint' : ''">
            <div class="flex items-center gap-2 mb-1">
              <input
                type="checkbox"
                class="h-4 w-4 shrink-0 accent-brand-700"
                :checked="selection.isSelected(Number(root.id))"
                :aria-label="`Chọn danh mục ${root.name}`"
                @change="selection.toggle(Number(root.id))"
              />
              <i class="fa-solid fa-folder text-brand-700"></i>
              <span class="font-bold text-brand-950 text-[0.9rem]">{{ root.name }}</span>
              <span class="text-[0.68rem] bg-surface-tint text-brand-700 px-1.5 py-0.5 rounded font-semibold">{{ root.children.length }} con</span>
            </div>
            <div class="flex flex-wrap items-center gap-2 mb-2">
              <span class="inline-block bg-surface-tint text-brand-700 px-1.5 py-0.5 rounded text-[0.7rem] font-bold">{{ typeLabels[root.type] || root.type }}</span>
              <code class="text-[0.72rem] text-ink-muted bg-surface px-1.5 py-0.5 rounded">{{ root.slug }}</code>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <button class="text-brand-700 font-bold text-[0.78rem] bg-none border-0 cursor-pointer p-0" :data-admin-modal-opener="`category-add-child-${root.id}`" @click="openCreate(root.id)"><i class="fa-solid fa-folder-plus text-xs"></i> Thêm con</button>
              <button class="text-brand-700 font-bold text-[0.78rem] bg-none border-0 cursor-pointer p-0" :data-admin-modal-opener="`category-${root.id}`" @click="openEdit(root)"><i class="fa-solid fa-pen text-xs"></i> Sửa</button>
              <button class="text-danger font-bold text-[0.78rem] bg-none border-0 cursor-pointer p-0" @click="deleteCategory(root)"><i class="fa-regular fa-trash text-xs"></i> Xóa</button>
            </div>
            <!-- Children inline -->
            <div v-if="root.children.length" class="mt-3 ml-4 border-l-2 border-line pl-3 space-y-2">
              <div v-for="child in root.children" :key="'mc-'+child.id" class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    class="h-4 w-4 shrink-0 accent-brand-700"
                    :checked="selection.isSelected(Number(child.id))"
                    :aria-label="`Chọn danh mục ${child.name}`"
                    @change="selection.toggle(Number(child.id))"
                  />
                  <i class="fa-regular fa-folder text-brand-300 text-xs"></i>
                  <span class="text-[0.82rem] text-ink-admin">{{ child.name }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <button class="text-brand-700 text-[0.72rem] font-bold bg-none border-0 cursor-pointer p-0" :data-admin-modal-opener="`category-${child.id}`" @click="openEdit(child)"><i class="fa-solid fa-pen"></i></button>
                  <button class="text-danger text-[0.72rem] font-bold bg-none border-0 cursor-pointer p-0" @click="deleteCategory(child)"><i class="fa-regular fa-trash"></i></button>
                </div>
              </div>
            </div>
          </div>
        </template>
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
                  aria-label="Chọn tất cả danh mục"
                  @change="selection.toggleAll(visibleIds)"
                />
              </th>
              <th class="bg-surface px-4 py-3 text-ink-muted font-bold border-b border-line">Tên danh mục</th>
              <th class="bg-surface px-4 py-3 text-ink-muted font-bold border-b border-line whitespace-nowrap">Slug</th>
              <th class="bg-surface px-4 py-3 text-ink-muted font-bold border-b border-line whitespace-nowrap">Loại</th>
              <th class="bg-surface px-4 py-3 text-ink-muted font-bold border-b border-line whitespace-nowrap">Thứ tự</th>
              <th class="bg-surface px-4 py-3 text-ink-muted font-bold border-b border-line whitespace-nowrap">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="root in tree" :key="root.id">
              <!-- Root row -->
              <tr class="hover:bg-surface" :class="selection.isSelected(Number(root.id)) ? 'bg-surface-tint' : 'bg-surface/60'">
                <td class="px-4 py-3 border-b border-surface-tint">
                  <input
                    type="checkbox"
                    class="h-4 w-4 accent-brand-700"
                    :checked="selection.isSelected(Number(root.id))"
                    :aria-label="`Chọn danh mục ${root.name}`"
                    @change="selection.toggle(Number(root.id))"
                  />
                </td>
                <td class="px-4 py-3 border-b border-surface-tint">
                  <div class="flex items-center gap-2">
                    <i class="fa-solid fa-folder text-brand-700"></i>
                    <span class="font-bold text-brand-950">{{ root.name }}</span>
                    <span class="text-[0.72rem] bg-surface-tint text-brand-700 px-1.5 py-0.5 rounded font-semibold">{{ root.children.length }} con</span>
                  </div>
                </td>
                <td class="px-4 py-3 border-b border-surface-tint">
                  <code class="text-[0.78rem] text-ink-muted bg-surface px-1.5 py-0.5 rounded">{{ root.slug }}</code>
                </td>
                <td class="px-4 py-3 border-b border-surface-tint">
                  <span class="inline-block bg-surface-tint text-brand-700 px-2 py-1 rounded-md text-[0.75rem] font-bold whitespace-nowrap">
                    {{ typeLabels[root.type] || root.type }}
                  </span>
                </td>
                <td class="px-4 py-3 border-b border-surface-tint text-ink-muted">{{ root.displayOrder }}</td>
                <td class="px-4 py-3 border-b border-surface-tint">
                  <div class="flex items-center gap-3 flex-wrap">
                    <button
                      class="inline-flex items-center gap-1 bg-none border-0 text-brand-700 cursor-pointer font-bold text-[0.82rem] hover:underline"
                      :data-admin-modal-opener="`category-add-child-${root.id}`" @click="openCreate(root.id)"
                    ><i class="fa-solid fa-folder-plus text-xs"></i> Thêm con</button>
                    <nuxt-link
                      :to="`/admin/content/articles?categoryId=${root.id}`"
                      class="inline-flex items-center gap-1 text-ink-muted no-underline font-bold text-[0.82rem] hover:underline"
                    ><i class="fa-regular fa-newspaper text-xs"></i> Xem bài</nuxt-link>
                    <button
                      class="inline-flex items-center gap-1 bg-none border-0 text-brand-700 cursor-pointer font-bold text-[0.82rem] hover:underline"
                      :data-admin-modal-opener="`category-${root.id}`" @click="openEdit(root)"
                    ><i class="fa-solid fa-pen text-xs"></i> Sửa</button>
                    <button
                      class="inline-flex items-center gap-1 bg-none border-0 text-danger cursor-pointer font-bold text-[0.82rem] hover:underline"
                      @click="deleteCategory(root)"
                    ><i class="fa-regular fa-trash text-xs"></i> Xóa</button>
                  </div>
                </td>
              </tr>
              <!-- Child rows -->
              <tr
                v-for="child in root.children"
                :key="child.id"
                class="hover:bg-surface"
                :class="selection.isSelected(Number(child.id)) ? 'bg-surface-tint' : ''"
              >
                <td class="px-4 py-3 border-b border-surface-tint">
                  <input
                    type="checkbox"
                    class="h-4 w-4 accent-brand-700"
                    :checked="selection.isSelected(Number(child.id))"
                    :aria-label="`Chọn danh mục ${child.name}`"
                    @change="selection.toggle(Number(child.id))"
                  />
                </td>
                <td class="px-4 py-3 border-b border-surface-tint">
                  <div class="flex items-center gap-2 pl-8">
                    <i class="fa-regular fa-folder text-brand-300"></i>
                    <span class="text-ink-admin">{{ child.name }}</span>
                  </div>
                </td>
                <td class="px-4 py-3 border-b border-surface-tint">
                  <code class="text-[0.78rem] text-ink-muted bg-surface px-1.5 py-0.5 rounded">{{ child.slug }}</code>
                </td>
                <td class="px-4 py-3 border-b border-surface-tint">
                  <span class="inline-block bg-surface-tint text-brand-700 px-2 py-1 rounded-md text-[0.75rem] font-bold whitespace-nowrap">
                    {{ typeLabels[child.type] || child.type }}
                  </span>
                </td>
                <td class="px-4 py-3 border-b border-surface-tint text-ink-muted">{{ child.displayOrder }}</td>
                <td class="px-4 py-3 border-b border-surface-tint">
                  <div class="flex items-center gap-3 flex-wrap">
                    <nuxt-link
                      :to="`/admin/content/articles?categoryId=${child.id}`"
                      class="inline-flex items-center gap-1 text-ink-muted no-underline font-bold text-[0.82rem] hover:underline"
                    ><i class="fa-regular fa-newspaper text-xs"></i> Xem bài</nuxt-link>
                    <button
                      class="inline-flex items-center gap-1 bg-none border-0 text-brand-700 cursor-pointer font-bold text-[0.82rem] hover:underline"
                      :data-admin-modal-opener="`category-${child.id}`" @click="openEdit(child)"
                    ><i class="fa-solid fa-pen text-xs"></i> Sửa</button>
                    <button
                      class="inline-flex items-center gap-1 bg-none border-0 text-danger cursor-pointer font-bold text-[0.82rem] hover:underline"
                      @click="deleteCategory(child)"
                    ><i class="fa-regular fa-trash text-xs"></i> Xóa</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Create / Edit Modal -->
  <AdminModal
    :open="showModal"
    :title="modalMode === 'create' ? 'Tạo Danh Mục Mới' : 'Chỉnh Sửa Danh Mục'"
    icon="fa-solid fa-folder-plus"
    :busy="saving"
    @close="showModal = false"
  >
          <div class="flex flex-col gap-4">
            <!-- Tên -->
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-ink-admin">Tên danh mục (*)</label>
              <input
                v-model="form.name"
                type="text"
                placeholder="Vd: Tin hoạt động C11"
                class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15"
              />
            </div>
            <!-- Slug -->
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-ink-admin">Slug (URL)</label>
              <input
                v-model="form.slug"
                type="text"
                placeholder="tin-hoat-dong-c11"
                class="w-full px-3.5 py-2.5 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-700/15 font-mono"
                :class="slugError ? 'border-[#d12420] focus:border-danger' : 'border-[#c8d6c9] focus:border-brand-700'"
                :aria-invalid="!!slugError"
                @blur="onSlugBlur"
              />
              <p v-if="slugError" role="alert" class="text-[0.73rem] text-danger m-0 font-semibold flex items-center gap-1.5">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                {{ slugError }}
              </p>
              <p v-else class="text-[0.73rem] text-ink-muted m-0">Tự động điền từ tên. Có thể chỉnh lại thủ công.</p>
            </div>
            <!-- Loại -->
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-ink-admin">Loại nội dung (*)</label>
              <select v-model="form.type" @change="form.parentId = null" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700">
                <option v-for="t in typeOptions" :key="t.value" :value="t.value">{{ t.label }}</option>
              </select>
            </div>
            <!-- Danh mục cha -->
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-ink-admin">Danh mục cha</label>
              <select v-model="form.parentId" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700">
                <option :value="null">— Không có (Danh mục gốc) —</option>
                <option v-for="p in parentOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
              <p class="text-[0.73rem] text-ink-muted m-0">Chỉ hiển thị các danh mục gốc cùng loại.</p>
            </div>
            <!-- Mô tả -->
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-ink-admin">Mô tả (tùy chọn)</label>
              <textarea
                v-model="form.description"
                rows="2"
                placeholder="Ghi chú ngắn về danh mục này..."
                class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 resize-none font-[inherit]"
              ></textarea>
            </div>
            <!-- Thứ tự -->
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-ink-admin">Thứ tự hiển thị</label>
              <input
                v-model.number="form.displayOrder"
                type="number"
                min="0"
                class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700"
              />
            </div>
          </div>
    <template #footer>
            <button
              type="button"
              class="px-4 py-2 rounded-lg border border-line-strong bg-white text-ink-muted font-semibold text-sm cursor-pointer hover:bg-surface transition-colors"
              @click="showModal = false"
            >Hủy</button>
            <button
              type="button"
              class="inline-flex items-center gap-2 bg-brand-900 hover:bg-brand-700 text-white font-bold px-5 py-2 rounded-lg cursor-pointer border-0 transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-sm"
              :disabled="saving || !!slugError"
              @click="handleSave"
            >
              <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
              {{ saving ? 'Đang lưu...' : (modalMode === 'create' ? 'Tạo Danh Mục' : 'Cập Nhật') }}
            </button>
    </template>
  </AdminModal>
</template>
