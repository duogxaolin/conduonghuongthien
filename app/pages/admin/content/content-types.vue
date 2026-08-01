<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const toast = useToast()
const { confirm } = useConfirm()

// ─── State ────────────────────────────────────────────────────────────────────
const types = ref<any[]>([])
const allCategories = ref<any[]>([])
const loading = ref(true)
const showTree = ref(true)

// ─── Modal state ──────────────────────────────────────────────────────────────
const showModal = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const editingId = ref<number | null>(null)
const editingIsSystem = ref(false)
const saving = ref(false)

const form = reactive({
  name: '',
  slug: '',
  icon: '',
  description: '',
  displayOrder: 0,
})

// Auto-fill slug from name (underscore-separated to match system type keys)
const slugifyLocal = (text: string): string =>
  text.toString().toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/([^0-9a-z-\s])/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/-/g, '_')

watch(() => form.name, (val) => {
  if (modalMode.value === 'create') {
    form.slug = slugifyLocal(val)
  }
})

// ─── Fetch ────────────────────────────────────────────────────────────────────
const fetchTypes = async () => {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/content-types')
    if (res.ok) {
      types.value = res.items
      selection.keepOnly(visibleIds.value)
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi tải thể loại')
  } finally {
    loading.value = false
  }
}

const fetchCategories = async () => {
  try {
    const res = await $fetch('/api/admin/categories')
    if (res.ok) allCategories.value = res.items
  } catch (err: any) {
    // Non-blocking: tree preview just shows types without children
  }
}

// ─── Tree preview: Thể loại → Danh mục → Danh mục con ──────────────────────────
const tree = computed(() =>
  types.value.map((ct) => {
    const scoped = allCategories.value.filter((c) => c.type === ct.slug)
    const roots = scoped.filter((c) => !c.parentId)
    return {
      ...ct,
      children: roots.map((root) => ({
        ...root,
        children: scoped.filter((c) => c.parentId === root.id),
      })),
    }
  })
)

// ─── Open modal ───────────────────────────────────────────────────────────────
const openCreate = () => {
  modalMode.value = 'create'
  editingId.value = null
  editingIsSystem.value = false
  form.name = ''
  form.slug = ''
  form.icon = 'fa-solid fa-folder'
  form.description = ''
  form.displayOrder = 0
  showModal.value = true
}

const openEdit = (ct: any) => {
  modalMode.value = 'edit'
  editingId.value = ct.id
  editingIsSystem.value = !!ct.isSystem
  form.name = ct.name
  form.slug = ct.slug
  form.icon = ct.icon || ''
  form.description = ct.description || ''
  form.displayOrder = ct.displayOrder ?? 0
  showModal.value = true
}

// ─── Save ─────────────────────────────────────────────────────────────────────
const handleSave = async () => {
  if (!form.name.trim()) { toast.warning('Tên thể loại không được để trống'); return }
  saving.value = true
  try {
    const payload: any = {
      name: form.name.trim(),
      icon: form.icon.trim() || null,
      description: form.description.trim() || null,
      displayOrder: form.displayOrder,
    }
    // Only send slug when editable (create, or edit of a non-system type)
    if (modalMode.value === 'create' || !editingIsSystem.value) {
      payload.slug = form.slug.trim()
    }
    if (modalMode.value === 'create') {
      await $fetch('/api/admin/content-types', { method: 'POST', body: payload })
      toast.success('Đã tạo thể loại thành công!')
    } else {
      await $fetch(`/api/admin/content-types/${editingId.value}`, { method: 'PUT', body: payload })
      toast.success('Đã cập nhật thể loại thành công!')
    }
    showModal.value = false
    await fetchTypes()
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi lưu thể loại')
  } finally {
    saving.value = false
  }
}

// ─── Bulk selection ───────────────────────────────────────────────────────────
const selection = useBulkSelection()
const bulk = useBulkAction(selection)
/**
 * System types back fixed public pages and can never be deleted, so they get no
 * checkbox at all — offering one that always fails would be a worse UI than
 * offering none.
 */
const visibleIds = computed(() => types.value.filter((ct: any) => !ct.isSystem).map((ct: any) => Number(ct.id)))

const bulkDelete = () => bulk.run({
  url: '/api/admin/content-types/bulk-delete',
  noun: 'thể loại',
  confirm: {
    title: 'Xóa thể loại',
    message: `Xóa ${selection.count.value} thể loại đã chọn? Thể loại còn danh mục hoặc bài viết sẽ bị bỏ qua.`,
    danger: true,
    confirmLabel: 'Xóa',
  },
  reload: () => fetchTypes(),
})

// ─── Delete ───────────────────────────────────────────────────────────────────
const deleteType = async (ct: any) => {
  const ok = await confirm({ title: 'Xóa thể loại', message: `Bạn có chắc muốn xóa thể loại "${ct.name}"?`, danger: true, confirmLabel: 'Xóa' })
  if (!ok) return
  try {
    await $fetch(`/api/admin/content-types/${ct.id}`, { method: 'DELETE' })
    toast.success('Đã xóa thể loại thành công!')
    await fetchTypes()
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi xóa thể loại')
  }
}

onMounted(() => {
  fetchTypes()
  fetchCategories()
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Quản lý Thể loại</h1>
        <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Cấp phân loại cao nhất — mỗi thể loại chứa các danh mục và bài viết riêng</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button
          class="inline-flex items-center gap-2 bg-white border border-[#c8d6c9] text-[#2c6e33] font-bold px-3.5 py-2.5 rounded-lg cursor-pointer transition-colors hover:bg-[#f8faf8]"
          @click="showTree = !showTree"
        >
          <i :class="showTree ? 'fa-solid fa-list' : 'fa-solid fa-sitemap'"></i>
          {{ showTree ? 'Xem bảng' : 'Xem cây' }}
        </button>
        <button
          class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer border-0 transition-colors"
          @click="openCreate()"
        >
          <i class="fa-solid fa-plus"></i> Tạo Thể Loại Mới
        </button>
      </div>
    </div>

    <AdminBulkActionBar
      v-if="selection.count.value"
      :count="selection.count.value"
      :busy="bulk.busy.value"
      noun="thể loại"
      @clear="selection.clear()"
    >
      <button type="button" class="rounded-lg bg-[#d12420] px-3 py-2 text-sm font-bold text-white hover:bg-[#b01f1b]" @click="bulkDelete">Xóa</button>
    </AdminBulkActionBar>

    <!-- Loading -->
    <SkeletonTable v-if="loading" label="Đang tải thể loại" :rows="6" :cols="7" />

    <!-- Empty state -->
    <div v-else-if="types.length === 0" class="bg-white rounded-xl border border-[#e2ece3] py-14 flex flex-col items-center gap-3 text-center">
      <i class="fa-solid fa-layer-group text-4xl text-[#c8d6c9]"></i>
      <p class="text-[#667768] text-[0.9rem] m-0">Chưa có thể loại nào. Hãy tạo thể loại đầu tiên!</p>
      <button
        class="inline-flex items-center gap-2 bg-[#1e4620] text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer border-0 hover:bg-[#2c6e33] transition-colors"
        @click="openCreate()"
      >
        <i class="fa-solid fa-plus"></i> Tạo Thể Loại
      </button>
    </div>

    <!-- Tree preview: Thể loại → Danh mục → Danh mục con -->
    <div v-else-if="showTree" class="bg-white rounded-xl border border-[#e2ece3] p-4 sm:p-6">
      <div class="flex flex-col gap-4">
        <div v-for="ct in tree" :key="ct.id" class="rounded-xl border border-[#e2ece3] overflow-hidden">
          <!-- Level 1: Thể loại -->
          <div class="flex items-center gap-3 px-4 py-3 bg-[#f0f7f1] border-b border-[#e2ece3]">
            <span class="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg bg-[#1e4620] text-white">
              <i :class="ct.icon || 'fa-solid fa-folder'"></i>
            </span>
            <div class="flex flex-col min-w-0">
              <span class="font-extrabold text-[#122815] flex items-center gap-2 flex-wrap">
                {{ ct.name }}
                <span v-if="ct.isSystem" class="text-[0.68rem] bg-[#eef2ff] text-[#3050b0] px-1.5 py-0.5 rounded font-semibold">Hệ thống</span>
                <code class="text-[0.72rem] text-[#667768] bg-white/70 px-1.5 py-0.5 rounded font-normal">{{ ct.slug }}</code>
              </span>
              <span class="text-[0.75rem] text-[#667768]">{{ ct.categoryCount }} danh mục · {{ ct.articleCount }} bài viết</span>
            </div>
          </div>

          <!-- Levels 2 & 3: Danh mục → Danh mục con -->
          <div class="px-4 py-3">
            <p v-if="ct.children.length === 0" class="text-[0.82rem] text-[#8a9a8c] italic m-0">
              Chưa có danh mục nào trong thể loại này.
            </p>
            <ul v-else class="flex flex-col gap-2 m-0 p-0 list-none">
              <li v-for="cat in ct.children" :key="cat.id" class="flex flex-col gap-1.5">
                <!-- Level 2: Danh mục gốc -->
                <div class="flex items-center gap-2 text-[0.88rem]">
                  <i class="fa-solid fa-folder text-[#2c6e33]"></i>
                  <span class="font-bold text-[#2c3e2e]">{{ cat.name }}</span>
                  <code class="text-[0.72rem] text-[#667768] bg-[#f4f7f4] px-1.5 py-0.5 rounded">{{ cat.slug }}</code>
                  <span v-if="cat.children.length" class="text-[0.7rem] bg-[#f0f7f1] text-[#2c6e33] px-1.5 py-0.5 rounded font-semibold">{{ cat.children.length }} con</span>
                </div>
                <!-- Level 3: Danh mục con -->
                <ul v-if="cat.children.length" class="flex flex-col gap-1 m-0 p-0 list-none pl-6 border-l-2 border-[#e2ece3] ml-2">
                  <li v-for="sub in cat.children" :key="sub.id" class="flex items-center gap-2 text-[0.84rem] text-[#3a4a3c]">
                    <i class="fa-regular fa-folder text-[#8ed694]"></i>
                    <span>{{ sub.name }}</span>
                    <code class="text-[0.7rem] text-[#8a9a8c] bg-[#f4f7f4] px-1.5 py-0.5 rounded">{{ sub.slug }}</code>
                  </li>
                </ul>
              </li>
            </ul>
            <nuxt-link
              :to="`/admin/content/categories?type=${ct.slug}`"
              class="inline-flex items-center gap-1.5 mt-3 text-[#2c6e33] no-underline font-bold text-[0.8rem] hover:underline"
            >
              <i class="fa-solid fa-folder-plus text-xs"></i> Quản lý danh mục của thể loại này
            </nuxt-link>
          </div>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div v-else class="bg-white rounded-xl border border-[#e2ece3] overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-[0.88rem] text-left">
          <thead>
            <tr>
              <th class="bg-[#f8faf8] w-10 px-4 py-3 border-b border-[#e2ece3]">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-[#2c6e33]"
                  :checked="selection.allSelected(visibleIds)"
                  :indeterminate="selection.someSelected(visibleIds)"
                  aria-label="Chọn tất cả thể loại có thể xóa"
                  @change="selection.toggleAll(visibleIds)"
                />
              </th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3]">Thể loại</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Định danh (slug)</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Danh mục</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Bài viết</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Thứ tự</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="ct in types"
              :key="ct.id"
              class="hover:bg-[#fafcfa]"
              :class="selection.isSelected(Number(ct.id)) ? 'bg-[#f0f7f1]' : ''"
            >
              <td class="px-4 py-3 border-b border-[#eef2ee]">
                <!-- A system type can never be deleted, so it gets no checkbox: an
                     operator should not be able to tick a row that is certain to
                     come back as a failure. -->
                <input
                  v-if="!ct.isSystem"
                  type="checkbox"
                  class="h-4 w-4 accent-[#2c6e33]"
                  :checked="selection.isSelected(Number(ct.id))"
                  :aria-label="`Chọn thể loại ${ct.name}`"
                  @change="selection.toggle(Number(ct.id))"
                />
              </td>
              <td class="px-4 py-3 border-b border-[#eef2ee]">
                <div class="flex items-center gap-2.5">
                  <i :class="ct.icon || 'fa-solid fa-folder'" class="text-[#2c6e33] w-5 text-center"></i>
                  <div class="flex flex-col">
                    <span class="font-bold text-[#122815] flex items-center gap-2">
                      {{ ct.name }}
                      <span v-if="ct.isSystem" class="text-[0.68rem] bg-[#eef2ff] text-[#3050b0] px-1.5 py-0.5 rounded font-semibold">Hệ thống</span>
                    </span>
                    <span v-if="ct.description" class="text-[0.75rem] text-[#8a9a8c]">{{ ct.description }}</span>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 border-b border-[#eef2ee]">
                <code class="text-[0.78rem] text-[#667768] bg-[#f4f7f4] px-1.5 py-0.5 rounded">{{ ct.slug }}</code>
              </td>
              <td class="px-4 py-3 border-b border-[#eef2ee] text-[#667768]">{{ ct.categoryCount }}</td>
              <td class="px-4 py-3 border-b border-[#eef2ee] text-[#667768]">{{ ct.articleCount }}</td>
              <td class="px-4 py-3 border-b border-[#eef2ee] text-[#667768]">{{ ct.displayOrder }}</td>
              <td class="px-4 py-3 border-b border-[#eef2ee]">
                <div class="flex items-center gap-3 flex-wrap">
                  <nuxt-link
                    :to="`/admin/content/categories?type=${ct.slug}`"
                    class="inline-flex items-center gap-1 text-[#667768] no-underline font-bold text-[0.82rem] hover:underline"
                  ><i class="fa-regular fa-folder-open text-xs"></i> Danh mục</nuxt-link>
                  <button
                    class="inline-flex items-center gap-1 bg-none border-0 text-[#2c6e33] cursor-pointer font-bold text-[0.82rem] hover:underline"
                    @click="openEdit(ct)"
                  ><i class="fa-solid fa-pen text-xs"></i> Sửa</button>
                  <button
                    v-if="!ct.isSystem"
                    class="inline-flex items-center gap-1 bg-none border-0 text-[#d12420] cursor-pointer font-bold text-[0.82rem] hover:underline"
                    @click="deleteType(ct)"
                  ><i class="fa-regular fa-trash text-xs"></i> Xóa</button>
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
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/50" @click="showModal = false" />
        <!-- Dialog -->
        <div class="relative bg-white rounded-2xl shadow-2xl w-full max-w-[500px] overflow-hidden">
          <!-- Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-[#e2ece3] bg-[#f8faf8]">
            <h2 class="text-[1.05rem] font-extrabold text-[#122815] m-0">
              <i class="fa-solid fa-layer-group text-[#2c6e33] mr-2"></i>
              {{ modalMode === 'create' ? 'Tạo Thể Loại Mới' : 'Chỉnh Sửa Thể Loại' }}
            </h2>
            <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#e2ece3] cursor-pointer border-0 bg-transparent text-[#667768]" @click="showModal = false">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <!-- Body -->
          <div class="px-6 py-5 flex flex-col gap-4">
            <!-- Tên -->
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Tên thể loại (*)</label>
              <input
                v-model="form.name"
                type="text"
                placeholder="Vd: Video tuyên truyền"
                class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
              />
            </div>
            <!-- Slug -->
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Định danh — slug</label>
              <input
                v-model="form.slug"
                type="text"
                :disabled="editingIsSystem"
                placeholder="video_tuyen_truyen"
                class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 font-mono disabled:bg-[#f4f7f4] disabled:text-[#8a9a8c] disabled:cursor-not-allowed"
              />
              <p v-if="editingIsSystem" class="text-[0.73rem] text-[#b06a20] m-0">Thể loại hệ thống — không thể đổi định danh.</p>
              <p v-else class="text-[0.73rem] text-[#667768] m-0">Tự động điền từ tên. Đây là mã định danh dùng để liên kết danh mục và bài viết.</p>
            </div>
            <!-- Icon -->
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Icon (FontAwesome)</label>
              <div class="flex items-center gap-2.5">
                <span class="w-10 h-10 shrink-0 flex items-center justify-center rounded-lg border border-[#c8d6c9] bg-[#f8faf8]">
                  <i :class="form.icon || 'fa-solid fa-folder'" class="text-[#2c6e33]"></i>
                </span>
                <input
                  v-model="form.icon"
                  type="text"
                  placeholder="fa-solid fa-video"
                  class="flex-1 px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 font-mono"
                />
              </div>
              <p class="text-[0.73rem] text-[#667768] m-0">Vd: fa-solid fa-newspaper, fa-solid fa-award...</p>
            </div>
            <!-- Mô tả -->
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Mô tả (tùy chọn)</label>
              <textarea
                v-model="form.description"
                rows="2"
                placeholder="Ghi chú ngắn về thể loại này..."
                class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] resize-none font-[inherit]"
              ></textarea>
            </div>
            <!-- Thứ tự -->
            <div class="flex flex-col gap-1.5">
              <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Thứ tự hiển thị</label>
              <input
                v-model.number="form.displayOrder"
                type="number"
                min="0"
                class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]"
              />
            </div>
          </div>
          <!-- Footer -->
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
              <i class="fa-solid fa-floppy-disk"></i>
              {{ saving ? 'Đang lưu...' : (modalMode === 'create' ? 'Tạo Thể Loại' : 'Cập Nhật') }}
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
