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

// Auto-fill slug from name (chỉ ở mode create).
const slugifyLocal = (text: string): string =>
  text.toString().toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/([^0-9a-z-\s])/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

watch(() => form.name, (val) => {
  if (modalMode.value === 'create') {
    form.slug = slugifyLocal(val)
  }
})

// ─── Fetch ────────────────────────────────────────────────────────────────────
async function fetchCategories() {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<{ ok: boolean, items: MediaCategoryRow[] }>('/api/admin/media-portal/categories')
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
      slug: form.slug.trim(),
      description: form.description.trim() || null,
      displayOrder: form.displayOrder,
    }
    if (modalMode.value === 'create') {
      await $fetch('/api/admin/media-portal/categories', { method: 'POST', body: payload })
      toast.success('Đã tạo danh mục thành công!')
    } else {
      await $fetch(`/api/admin/media-portal/categories/${editingId.value}`, { method: 'PUT', body: payload })
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
    await $fetch(`/api/admin/media-portal/categories/${cat.id}`, { method: 'DELETE' })
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
        <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Danh mục Video</h1>
        <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Phân loại video của Media Portal — danh mục riêng, không liên quan danh mục bài viết.</p>
      </div>
      <button
        v-if="canCreate"
        class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer border-0 transition-colors shrink-0"
        @click="openCreate()"
      >
        <i class="fa-solid fa-folder-plus" aria-hidden="true"></i> Tạo Danh Mục
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" role="status" aria-busy="true" class="bg-white rounded-xl border border-[#e2ece3] p-6">
      <span class="sr-only">Đang tải danh sách danh mục</span>
      <div class="flex flex-col gap-3 animate-pulse motion-reduce:animate-none">
        <div v-for="n in 6" :key="n" class="flex gap-3">
          <div v-for="c in 6" :key="c" class="h-10 bg-[#EEF2EC] rounded flex-1" aria-hidden="true"></div>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" role="alert" class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]">
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ error }} Vui lòng <button type="button" class="text-[#4A6741] font-bold underline" @click="fetchCategories()">thử lại</button>.
    </div>

    <!-- Empty state -->
    <div v-else-if="categories.length === 0" class="bg-white rounded-xl border border-[#e2ece3] py-14 flex flex-col items-center gap-3 text-center">
      <i class="fa-solid fa-folder-open text-4xl text-[#c8d6c9]" aria-hidden="true"></i>
      <p class="text-[#667768] text-[0.9rem] m-0">Chưa có danh mục video nào. Hãy tạo danh mục đầu tiên!</p>
      <button
        v-if="canCreate"
        class="inline-flex items-center gap-2 bg-[#1e4620] text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer border-0 hover:bg-[#2c6e33] transition-colors"
        @click="openCreate()"
      >
        <i class="fa-solid fa-folder-plus" aria-hidden="true"></i> Tạo Danh Mục
      </button>
    </div>

    <!-- Table -->
    <div v-else class="bg-white rounded-xl border border-[#e2ece3] overflow-hidden">
      <!-- Mobile cards -->
      <div class="md:hidden divide-y divide-[#eef2ee]">
        <div v-for="cat in categories" :key="'m-'+cat.id" class="p-4">
          <div class="flex items-center gap-2 mb-1">
            <i class="fa-solid fa-folder text-[#2c6e33]" aria-hidden="true"></i>
            <span class="font-bold text-[#122815] text-[0.9rem]">{{ cat.name }}</span>
            <span class="text-[0.68rem] bg-[#f0f7f1] text-[#2c6e33] px-1.5 py-0.5 rounded font-semibold">{{ cat.usageCount }} video</span>
          </div>
          <code class="text-[0.72rem] text-[#667768] bg-[#f4f7f4] px-1.5 py-0.5 rounded inline-block mb-2">{{ cat.slug }}</code>
          <div class="flex flex-wrap items-center gap-3">
            <button v-if="canUpdate" class="text-[#2c6e33] font-bold text-[0.78rem] bg-none border-0 cursor-pointer p-0" @click="openEdit(cat)"><i class="fa-solid fa-pen text-xs" aria-hidden="true"></i> Sửa</button>
            <button v-if="canDelete" class="text-[#d12420] font-bold text-[0.78rem] bg-none border-0 cursor-pointer p-0" @click="deleteCategory(cat)"><i class="fa-regular fa-trash text-xs" aria-hidden="true"></i> Xóa</button>
          </div>
        </div>
      </div>

      <!-- Desktop table -->
      <div class="hidden md:block overflow-x-auto">
        <table class="w-full border-collapse text-[0.88rem] text-left">
          <thead>
            <tr>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3]">Tên danh mục</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Slug</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Số video</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Thứ tự</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="cat in categories" :key="cat.id" class="hover:bg-[#fafcfa]">
              <td class="px-4 py-3 border-b border-[#eef2ee]">
                <div class="flex items-center gap-2">
                  <i class="fa-solid fa-folder text-[#2c6e33]" aria-hidden="true"></i>
                  <span class="font-bold text-[#122815]">{{ cat.name }}</span>
                </div>
                <p v-if="cat.description" class="text-xs text-[#8aa08c] mt-1 line-clamp-2">{{ cat.description }}</p>
              </td>
              <td class="px-4 py-3 border-b border-[#eef2ee]">
                <code class="text-[0.78rem] text-[#667768] bg-[#f4f7f4] px-1.5 py-0.5 rounded">{{ cat.slug }}</code>
              </td>
              <td class="px-4 py-3 border-b border-[#eef2ee]">
                <span class="inline-block bg-[#f0f7f1] text-[#2c6e33] px-2 py-1 rounded-md text-[0.75rem] font-bold whitespace-nowrap">{{ cat.usageCount }}</span>
              </td>
              <td class="px-4 py-3 border-b border-[#eef2ee] text-[#667768]">{{ cat.displayOrder }}</td>
              <td class="px-4 py-3 border-b border-[#eef2ee]">
                <div class="flex items-center gap-3 flex-wrap">
                  <button
                    v-if="canUpdate"
                    class="inline-flex items-center gap-1 bg-none border-0 text-[#2c6e33] cursor-pointer font-bold text-[0.82rem] hover:underline"
                    @click="openEdit(cat)"
                  ><i class="fa-solid fa-pen text-xs" aria-hidden="true"></i> Sửa</button>
                  <button
                    v-if="canDelete"
                    class="inline-flex items-center gap-1 bg-none border-0 text-[#d12420] cursor-pointer font-bold text-[0.82rem] hover:underline"
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
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="showModal" class="fixed inset-0 z-[200] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50" @click="showModal = false" />
        <div class="relative bg-white rounded-2xl shadow-2xl w-full max-w-[500px] overflow-hidden">
          <div class="flex items-center justify-between px-6 py-4 border-b border-[#e2ece3] bg-[#f8faf8]">
            <h2 class="text-[1.05rem] font-extrabold text-[#122815] m-0">
              <i class="fa-solid fa-folder-plus text-[#2c6e33] mr-2" aria-hidden="true"></i>
              {{ modalMode === 'create' ? 'Tạo Danh Mục Video' : 'Chỉnh Sửa Danh Mục' }}
            </h2>
            <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#e2ece3] cursor-pointer border-0 bg-transparent text-[#667768]" @click="showModal = false">
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </div>
          <div class="px-6 py-5 flex flex-col gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]" for="mcat-name">Tên danh mục (*)</label>
              <input
                id="mcat-name"
                v-model="form.name"
                type="text"
                placeholder="Vd: Video hoạt động"
                class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]" for="mcat-slug">Slug (URL)</label>
              <input
                id="mcat-slug"
                v-model="form.slug"
                type="text"
                placeholder="video-hoat-dong"
                class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 font-mono"
              />
              <p class="text-[0.73rem] text-[#667768] m-0">Tự động điền từ tên. Có thể chỉnh lại thủ công.</p>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]" for="mcat-desc">Mô tả (tùy chọn)</label>
              <textarea
                id="mcat-desc"
                v-model="form.description"
                rows="2"
                placeholder="Ghi chú ngắn về danh mục này..."
                class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] resize-none font-[inherit]"
              ></textarea>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]" for="mcat-order">Thứ tự hiển thị</label>
              <input
                id="mcat-order"
                v-model.number="form.displayOrder"
                type="number"
                min="0"
                class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]"
              />
            </div>
          </div>
          <div class="px-6 py-4 border-t border-[#e2ece3] flex justify-end gap-3">
            <button
              class="px-4 py-2 rounded-lg border border-[#c8d6c9] bg-white text-[#667768] font-semibold text-sm cursor-pointer hover:bg-[#f8faf8] transition-colors"
              @click="showModal = false"
            >Hủy</button>
            <button
              class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-5 py-2 rounded-lg cursor-pointer border-0 transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-sm"
              :disabled="saving"
              @click="handleSave"
            >
              <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
              {{ saving ? 'Đang lưu...' : (modalMode === 'create' ? 'Tạo Danh Mục' : 'Cập Nhật') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.2s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
</style>
