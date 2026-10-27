<script setup lang="ts">
/**
 * Quản lý danh mục Media Portal (bảng `media_categories`).
 *
 * Tách khỏi `/admin/content/categories` (bảng `categories` bài viết): media
 * phẳng (không cha-con, không `type`), nên UI đơn giản hơn — bảng list + modal
 * tạo/sửa, không tree, không parent selector.
 *
 * Hợp đồng tải / lỗi / rỗng theo pattern toàn admin: `v-if="loading"` (skeleton
 * inline) → `role="alert"` + nút thử lại gọi `fetchCategories` khai báo cùng tệp
 * → rỗng → dữ liệu. Đảo nhánh rỗng lên trước nhánh lỗi làm một lượt truy vấn hỏng
 * đọc ra "chưa có danh mục", và cán bộ đi tạo lại bản ghi đã có.
 */
import { errorMessage } from '~/utils/errorMessage'
import AdminModal from '~/components/admin/AdminModal.vue'
import { slugify } from '~~/shared/slugify'

definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth',
})

const toast = useToast()
const { confirm } = useConfirm()
const { hasPermission } = useAdminAuth()

const canCreate = hasPermission('media_portal', 'create')
const canUpdate = hasPermission('media_portal', 'update')
const canDelete = hasPermission('media_portal', 'delete')

interface MediaCategoryRow {
  id: number
  name: string
  slug: string
  description: string | null
  displayOrder: number
  createdAt: string | null
  usageCount: number
}

const categories = ref<MediaCategoryRow[]>([])
const loading = ref(true)
const error = ref('')

// ─── Modal state ──────────────────────────────────────────────────────────────
const showModal = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const editingId = ref<number | null>(null)
const saving = ref(false)

const form = reactive({
  name: '',
  slug: '',
  description: '',
  displayOrder: 0,
})

// Auto-fill slug from name (chỉ ở mode create) — `slugify` của `shared/`, cùng luật máy chủ lưu.
watch(() => form.name, (val) => {
  if (modalMode.value === 'create') {
    form.slug = slugify(val)
  }
})

// ─── Fetch ────────────────────────────────────────────────────────────────────
async function fetchCategories() {
  loading.value = true
  error.value = ''
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean, items: MediaCategoryRow[] }>)(`/api/admin/media-portal/categories`)
    if (res.ok) {
      categories.value = res.items
    } else {
      error.value = 'Không tải được danh sách danh mục.'
    }
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không tải được danh sách danh mục.')
  } finally {
    loading.value = false
  }
}

// ─── Open modal ───────────────────────────────────────────────────────────────
function openCreate() {
  modalMode.value = 'create'
  editingId.value = null
  form.name = ''
  form.slug = ''
  form.description = ''
  form.displayOrder = 0
  showModal.value = true
}

function openEdit(cat: MediaCategoryRow) {
  modalMode.value = 'edit'
  editingId.value = cat.id
  form.name = cat.name
  form.slug = cat.slug
  form.description = cat.description || ''
  form.displayOrder = cat.displayOrder ?? 0
  showModal.value = true
}

// ─── Save ─────────────────────────────────────────────────────────────────────
async function handleSave() {
  if (!form.name.trim()) { toast.warning('Tên danh mục không được để trống'); return }
  saving.value = true
  try {
    const payload = {
      name: form.name.trim(),
      slug: slugify(form.slug),
      description: form.description.trim() || null,
      displayOrder: form.displayOrder,
    }
    if (modalMode.value === 'create') {
      await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/media-portal/categories`, { method: 'POST', body: payload })
      toast.success('Đã tạo danh mục thành công!')
    } else {
      await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/media-portal/categories/${editingId.value}`, { method: 'PUT', body: payload })
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

// ─── Delete ───────────────────────────────────────────────────────────────────
async function deleteCategory(cat: MediaCategoryRow) {
  const ok = await confirm({
    title: 'Xóa danh mục',
    message: `Bạn có chắc muốn xóa danh mục "${cat.name}"?`,
    danger: true,
    confirmLabel: 'Xóa',
  })
  if (!ok) return
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/media-portal/categories/${cat.id}`, { method: 'DELETE' })
    toast.success('Đã xóa danh mục thành công!')
    await fetchCategories()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi xóa danh mục'))
  }
}

onMounted(() => { void fetchCategories() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-[1.3rem] font-extrabold text-brand-950 m-0">Danh mục Video</h1>
        <p class="text-[0.85rem] text-ink-muted mt-1 mb-0">Phân loại video của Media Portal — danh mục riêng, không liên quan danh mục bài viết.</p>
      </div>
      <button
        v-if="canCreate"
        class="inline-flex items-center gap-2 bg-brand-900 hover:bg-brand-700 text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer border-0 transition-colors shrink-0"
        @click="openCreate()"
      >
        <i class="fa-solid fa-folder-plus" aria-hidden="true"></i> Tạo Danh Mục
      </button>
    </div>

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
    <div v-else-if="categories.length === 0" class="bg-white rounded-xl border border-line py-14 flex flex-col items-center gap-3 text-center">
      <i class="fa-solid fa-folder-open text-4xl text-line-strong" aria-hidden="true"></i>
      <p class="text-ink-muted text-[0.9rem] m-0">Chưa có danh mục video nào. Hãy tạo danh mục đầu tiên!</p>
      <button
        v-if="canCreate"
        class="inline-flex items-center gap-2 bg-brand-900 text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer border-0 hover:bg-brand-700 transition-colors"
        @click="openCreate()"
      >
        <i class="fa-solid fa-folder-plus" aria-hidden="true"></i> Tạo Danh Mục
      </button>
    </div>

    <!-- Table -->
    <div v-else class="bg-white rounded-xl border border-line overflow-hidden">
      <!-- Mobile cards -->
      <div class="md:hidden divide-y divide-surface-tint">
        <div v-for="cat in categories" :key="'m-'+cat.id" class="p-4">
          <div class="flex items-center gap-2 mb-1">
            <i class="fa-solid fa-folder text-brand-700" aria-hidden="true"></i>
            <span class="font-bold text-brand-950 text-[0.9rem]">{{ cat.name }}</span>
            <span class="text-[0.68rem] bg-surface-tint text-brand-700 px-1.5 py-0.5 rounded font-semibold">{{ cat.usageCount }} video</span>
          </div>
          <code class="text-[0.72rem] text-ink-muted bg-surface px-1.5 py-0.5 rounded inline-block mb-2">{{ cat.slug }}</code>
          <div class="flex flex-wrap items-center gap-3">
            <button v-if="canUpdate" class="text-brand-700 font-bold text-[0.78rem] bg-none border-0 cursor-pointer p-0" :data-admin-modal-opener="`media-category-${cat.id}`" @click="openEdit(cat)"><i class="fa-solid fa-pen text-xs" aria-hidden="true"></i> Sửa</button>
            <button v-if="canDelete" class="text-danger font-bold text-[0.78rem] bg-none border-0 cursor-pointer p-0" @click="deleteCategory(cat)"><i class="fa-regular fa-trash text-xs" aria-hidden="true"></i> Xóa</button>
          </div>
        </div>
      </div>

      <!-- Desktop table -->
      <div class="hidden md:block overflow-x-auto">
        <table class="w-full border-collapse text-[0.88rem] text-left">
          <thead>
            <tr>
              <th class="bg-surface px-4 py-3 text-ink-muted font-bold border-b border-line">Tên danh mục</th>
              <th class="bg-surface px-4 py-3 text-ink-muted font-bold border-b border-line whitespace-nowrap">Slug</th>
              <th class="bg-surface px-4 py-3 text-ink-muted font-bold border-b border-line whitespace-nowrap">Số video</th>
              <th class="bg-surface px-4 py-3 text-ink-muted font-bold border-b border-line whitespace-nowrap">Thứ tự</th>
              <th class="bg-surface px-4 py-3 text-ink-muted font-bold border-b border-line whitespace-nowrap">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="cat in categories" :key="cat.id" class="hover:bg-surface">
              <td class="px-4 py-3 border-b border-surface-tint">
                <div class="flex items-center gap-2">
                  <i class="fa-solid fa-folder text-brand-700" aria-hidden="true"></i>
                  <span class="font-bold text-brand-950">{{ cat.name }}</span>
                </div>
                <p v-if="cat.description" class="text-xs text-[#8aa08c] mt-1 line-clamp-2">{{ cat.description }}</p>
              </td>
              <td class="px-4 py-3 border-b border-surface-tint">
                <code class="text-[0.78rem] text-ink-muted bg-surface px-1.5 py-0.5 rounded">{{ cat.slug }}</code>
              </td>
              <td class="px-4 py-3 border-b border-surface-tint">
                <span class="inline-block bg-surface-tint text-brand-700 px-2 py-1 rounded-md text-[0.75rem] font-bold whitespace-nowrap">{{ cat.usageCount }}</span>
              </td>
              <td class="px-4 py-3 border-b border-surface-tint text-ink-muted">{{ cat.displayOrder }}</td>
              <td class="px-4 py-3 border-b border-surface-tint">
                <div class="flex items-center gap-3 flex-wrap">
                  <button
                    v-if="canUpdate"
                    class="inline-flex items-center gap-1 bg-none border-0 text-brand-700 cursor-pointer font-bold text-[0.82rem] hover:underline"
                    :data-admin-modal-opener="`media-category-${cat.id}`" @click="openEdit(cat)"
                  ><i class="fa-solid fa-pen text-xs" aria-hidden="true"></i> Sửa</button>
                  <button
                    v-if="canDelete"
                    class="inline-flex items-center gap-1 bg-none border-0 text-danger cursor-pointer font-bold text-[0.82rem] hover:underline"
                    @click="deleteCategory(cat)"
                  ><i class="fa-regular fa-trash text-xs" aria-hidden="true"></i> Xóa</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Create / Edit Modal -->
  <AdminModal
    :open="showModal"
    :title="modalMode === 'create' ? 'Tạo Danh Mục Video' : 'Chỉnh Sửa Danh Mục'"
    icon="fa-solid fa-folder-plus"
    :busy="saving"
    @close="showModal = false"
  >
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-ink-admin" for="mcat-name">Tên danh mục (*)</label>
              <input
                id="mcat-name"
                v-model="form.name"
                type="text"
                placeholder="Vd: Video hoạt động"
                class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-ink-admin" for="mcat-slug">Slug (URL)</label>
              <input
                id="mcat-slug"
                v-model="form.slug"
                type="text"
                placeholder="video-hoat-dong"
                class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 font-mono"
              />
              <p class="text-[0.73rem] text-ink-muted m-0">Tự động điền từ tên. Có thể chỉnh lại thủ công.</p>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-ink-admin" for="mcat-desc">Mô tả (tùy chọn)</label>
              <textarea
                id="mcat-desc"
                v-model="form.description"
                rows="2"
                placeholder="Ghi chú ngắn về danh mục này..."
                class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 resize-none font-[inherit]"
              ></textarea>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-ink-admin" for="mcat-order">Thứ tự hiển thị</label>
              <input
                id="mcat-order"
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
              :disabled="saving"
              @click="handleSave"
            >
              <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
              {{ saving ? 'Đang lưu...' : (modalMode === 'create' ? 'Tạo Danh Mục' : 'Cập Nhật') }}
            </button>
    </template>
  </AdminModal>
</template>
