<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const route = useRoute()
const articles = ref<any[]>([])
const loading = ref(true)
const search = ref('')
const selectedType = ref('')
const selectedStatus = ref('')
const selectedParentCategoryId = ref<number | null>(null)
const selectedCategoryId = ref<number | null>(null)
const pagination = ref({ page: 1, totalPages: 1, total: 0 })

// Category state
const allCategories = ref<any[]>([])

const typeLabels: Record<string, string> = {
  news: 'Bản tin', role_model: 'Tấm gương', reintegration: 'Mô hình', document: 'Văn bản', faq: 'Giải đáp',
}

const typeColors: Record<string, string> = {
  news: 'bg-emerald-50 text-emerald-700',
  role_model: 'bg-purple-50 text-purple-700',
  reintegration: 'bg-orange-50 text-orange-700',
  document: 'bg-blue-50 text-blue-700',
  faq: 'bg-amber-50 text-amber-700',
}

const typeIcons: Record<string, string> = {
  news: 'fa-solid fa-newspaper',
  role_model: 'fa-solid fa-medal',
  reintegration: 'fa-solid fa-people-arrows',
  document: 'fa-solid fa-file-lines',
  faq: 'fa-solid fa-circle-question',
}

/** Build display string for category: "Parent > Child" or just "Name" */
const categoryDisplay = (a: any) => {
  if (!a.categoryName) return ''
  if (a.parentCategoryName) return `${a.parentCategoryName} › ${a.categoryName}`
  return a.categoryName
}

const toast = useToast()
const { confirm } = useConfirm()

// ─── Category helpers ─────────────────────────────────────────────────────────
// Root categories matching the current type filter
const parentCategoryOptions = computed(() => {
  return allCategories.value.filter(
    (c) => !c.parentId && (!selectedType.value || c.type === selectedType.value)
  )
})

// Children of the selected parent
const subCategoryOptions = computed(() => {
  if (!selectedParentCategoryId.value) return []
  return allCategories.value.filter((c) => c.parentId === selectedParentCategoryId.value)
})

const fetchCategories = async () => {
  try {
    const params: any = {}
    if (selectedType.value) params.type = selectedType.value
    const res = await $fetch('/api/admin/categories', { params })
    if (res.ok) allCategories.value = res.items
  } catch { /* non-critical */ }
}

// When type filter changes: reload categories, reset category filters
watch(selectedType, async () => {
  selectedParentCategoryId.value = null
  selectedCategoryId.value = null
  await fetchCategories()
})

// When parent category changes: reset sub-category selection
watch(selectedParentCategoryId, () => {
  selectedCategoryId.value = null
})

// ─── Articles fetch ───────────────────────────────────────────────────────────
const fetchArticles = async (page = 1) => {
  loading.value = true
  try {
    const params: any = {
      page,
      search: search.value,
      type: selectedType.value,
      status: selectedStatus.value,
      perPage: 15,
    }
    // Wire category filter: prefer sub-category if selected, else parent
    const effectiveCategoryId = selectedCategoryId.value ?? selectedParentCategoryId.value
    if (effectiveCategoryId) params.categoryId = effectiveCategoryId

    const res = await $fetch('/api/admin/articles', { params })
    if (res.ok) {
      articles.value = res.items
      pagination.value = res.pagination
      // Ids from the previous page/filter no longer refer to anything on screen.
      selection.keepOnly(visibleIds.value)
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi tải danh sách bài viết')
  } finally {
    loading.value = false
  }
}

// ─── Bulk selection ───────────────────────────────────────────────────────────
const selection = useBulkSelection()
const bulk = useBulkAction(selection)
const visibleIds = computed(() => articles.value.map((a: any) => Number(a.id)))

const bulkDelete = () => bulk.run({
  url: '/api/admin/articles/bulk-delete',
  noun: 'bài viết',
  confirm: {
    title: 'Xóa bài viết',
    message: `Xóa ${selection.count.value} bài viết đã chọn? Thao tác không thể hoàn tác.`,
    danger: true,
    confirmLabel: 'Xóa',
  },
  reload: () => fetchArticles(pagination.value.page),
})

/** Hiding an article means archiving it — that is what the public read path filters on. */
const bulkStatus = (status: 'published' | 'draft' | 'archived') => {
  const verb = status === 'published' ? 'Xuất bản' : status === 'draft' ? 'Chuyển về nháp' : 'Lưu trữ (ẩn)'
  return bulk.run({
    url: '/api/admin/articles/bulk-status',
    body: { status },
    noun: 'bài viết',
    confirm: { message: `${verb} ${selection.count.value} bài viết đã chọn?`, confirmLabel: verb },
    reload: () => fetchArticles(pagination.value.page),
  })
}

const deleteArticle = async (art: any) => {
  const ok = await confirm({ title: 'Xóa bài viết', message: `Bạn có chắc muốn xóa bài viết "${art.title}"?`, danger: true, confirmLabel: 'Xóa' })
  if (!ok) return
  try {
    await $fetch(`/api/admin/articles/${art.id}`, { method: 'DELETE' })
    toast.success('Đã xóa bài viết thành công!')
    await fetchArticles(pagination.value.page)
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi xóa bài viết')
  }
}

onMounted(async () => {
  // Pre-select categoryId from query param (coming from categories page "Xem bài")
  const qCategoryId = route.query.categoryId ? Number(route.query.categoryId) : null
  await fetchCategories()
  if (qCategoryId) {
    // Find the category to set up parent/child properly
    const cat = allCategories.value.find((c) => c.id === qCategoryId)
    if (cat) {
      if (cat.parentId) {
        selectedParentCategoryId.value = cat.parentId
        selectedCategoryId.value = cat.id
        if (cat.type) selectedType.value = cat.type
      } else {
        selectedParentCategoryId.value = cat.id
        if (cat.type) selectedType.value = cat.type
      }
    }
  }
  await fetchArticles()
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Quản lý Bài viết & Nội dung</h1>
        <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Danh sách bài viết tin tức, tấm gương tiêu biểu, mô hình kinh tế và văn bản</p>
      </div>
      <nuxt-link
        to="/admin/content/articles/new"
        class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-4 py-2.5 rounded-lg no-underline transition-colors shrink-0"
      >
        <i class="fa-solid fa-pen-to-square"></i> Viết Bài Mới
      </nuxt-link>
    </div>

    <!-- Filters -->
    <div class="bg-white rounded-xl border border-[#e2ece3] p-4 flex flex-col sm:flex-row flex-wrap gap-3">
      <input
        type="text"
        v-model="search"
        placeholder="Tìm theo tiêu đề bài viết..."
        @keyup.enter="fetchArticles(1)"
        class="flex-1 min-w-[180px] px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
      />
      <select v-model="selectedType" @change="fetchArticles(1)" class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]">
        <option value="">Tất cả Thể loại</option>
        <option value="news">Bản tin & Tin tức</option>
        <option value="role_model">Tấm gương tiêu biểu</option>
        <option value="reintegration">Mô hình tái hòa nhập</option>
        <option value="document">Văn bản pháp luật</option>
        <option value="faq">Giải đáp pháp luật</option>
      </select>
      <!-- Parent category filter -->
      <select
        v-model="selectedParentCategoryId"
        @change="fetchArticles(1)"
        class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]"
      >
        <option :value="null">Tất cả Danh mục</option>
        <option v-for="cat in parentCategoryOptions" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
      </select>
      <!-- Sub-category filter (only shown when parent is selected and has children) -->
      <select
        v-if="selectedParentCategoryId && subCategoryOptions.length > 0"
        v-model="selectedCategoryId"
        @change="fetchArticles(1)"
        class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]"
      >
        <option :value="null">Tất cả danh mục con</option>
        <option v-for="sub in subCategoryOptions" :key="sub.id" :value="sub.id">{{ sub.name }}</option>
      </select>
      <select v-model="selectedStatus" @change="fetchArticles(1)" class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]">
        <option value="">Tất cả Trạng thái</option>
        <option value="published">Đã Xuất Bản</option>
        <option value="draft">Bản Nháp (Draft)</option>
        <option value="archived">Lưu Trữ</option>
      </select>
      <button
        class="inline-flex items-center gap-2 bg-[#2c6e33] hover:bg-[#1e4620] text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer border-0 transition-colors"
        @click="fetchArticles(1)"
      >
        <i class="fa-regular fa-magnifying-glass"></i> Tìm kiếm
      </button>
    </div>

    <AdminBulkActionBar
      v-if="selection.count.value"
      :count="selection.count.value"
      :busy="bulk.busy.value"
      noun="bài viết"
      @clear="selection.clear()"
    >
      <button type="button" class="rounded-lg border border-[#2c6e33] bg-white px-3 py-2 text-sm font-bold text-[#2c6e33] hover:bg-white/70" @click="bulkStatus('published')">Xuất bản</button>
      <button type="button" class="rounded-lg border border-[#b78103] bg-white px-3 py-2 text-sm font-bold text-[#765b00] hover:bg-white/70" @click="bulkStatus('archived')">Lưu trữ (ẩn)</button>
      <button type="button" class="rounded-lg bg-[#d12420] px-3 py-2 text-sm font-bold text-white hover:bg-[#b01f1b]" @click="bulkDelete">Xóa</button>
    </AdminBulkActionBar>

    <!-- Table Card -->
    <div class="bg-white rounded-xl border border-[#e2ece3] overflow-hidden">
      <div v-if="loading" class="py-10 text-center text-[#667768]">Đang tải danh sách bài viết...</div>

      <!-- Mobile Card View -->
      <div v-else class="md:hidden divide-y divide-[#eef2ee]">
        <div v-for="a in articles" :key="'m-'+a.id" class="p-4 flex gap-3" :class="selection.isSelected(Number(a.id)) ? 'bg-[#f0f7f1]' : ''">
          <input
            type="checkbox"
            class="mt-1 h-4 w-4 flex-shrink-0 accent-[#2c6e33]"
            :checked="selection.isSelected(Number(a.id))"
            :aria-label="`Chọn bài viết: ${a.title}`"
            @change="selection.toggle(Number(a.id))"
          />
          <div class="w-14 h-10 rounded-lg overflow-hidden bg-[#f0f4f0] flex-shrink-0 border border-[#e2ece3]">
            <img v-if="a.thumbnailUrl" :src="a.thumbnailUrl" class="w-full h-full object-cover" />
            <div v-else class="w-full h-full flex items-center justify-center"><i class="fa-regular fa-image text-sm text-[#c8d6c9]"></i></div>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-[0.85rem] font-semibold text-[#122815] line-clamp-2 m-0">{{ a.title }}</p>
            <div class="flex flex-wrap items-center gap-2 mt-1.5">
              <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.68rem] font-bold" :class="typeColors[a.type] || 'bg-gray-100 text-gray-600'">
                <i :class="typeIcons[a.type]" class="text-[0.6rem]"></i>{{ typeLabels[a.type] || a.type }}
              </span>
              <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[0.68rem] font-bold" :class="a.status === 'published' ? 'bg-[#e4f2e5] text-[#2c6e33]' : a.status === 'draft' ? 'bg-[#fff8e1] text-[#b78103]' : 'bg-[#f5f5f5] text-[#888]'">
                {{ a.status === 'published' ? 'Đã đăng' : (a.status === 'draft' ? 'Nháp' : 'Lưu trữ') }}
              </span>
              <span v-if="categoryDisplay(a)" class="text-[0.7rem] text-[#667768]">{{ categoryDisplay(a) }}</span>
            </div>
            <div class="flex items-center gap-3 mt-2">
              <nuxt-link :to="`/admin/content/articles/${a.id}`" class="text-[#2c6e33] font-bold text-[0.8rem] no-underline"><i class="fa-solid fa-pen-to-square"></i> Sửa</nuxt-link>
              <button class="bg-none border-0 text-[#d12420] font-bold text-[0.8rem] cursor-pointer p-0" @click="deleteArticle(a)"><i class="fa-regular fa-trash"></i> Xóa</button>
            </div>
          </div>
        </div>
        <div v-if="articles.length === 0" class="p-8 text-center text-[#667768] text-sm">Không có bài viết nào.</div>
      </div>

      <!-- Desktop Table View -->
      <div v-if="!loading" class="hidden md:block overflow-x-auto">
        <table class="w-full border-collapse text-[0.88rem] text-left">
          <thead>
            <tr>
              <th class="bg-[#f8faf8] w-10 px-4 py-3 border-b border-[#e2ece3]">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-[#2c6e33]"
                  :checked="selection.allSelected(visibleIds)"
                  :indeterminate="selection.someSelected(visibleIds)"
                  aria-label="Chọn tất cả bài viết trên trang"
                  @change="selection.toggleAll(visibleIds)"
                />
              </th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3]">Bài viết</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Thể loại</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Danh mục</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Trạng thái</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Ngày tạo</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in articles"
              :key="a.id"
              class="hover:bg-[#fafcfa] group"
              :class="selection.isSelected(Number(a.id)) ? 'bg-[#f0f7f1]' : ''"
            >
              <td class="px-4 py-3 border-b border-[#eef2ee]">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-[#2c6e33]"
                  :checked="selection.isSelected(Number(a.id))"
                  :aria-label="`Chọn bài viết: ${a.title}`"
                  @change="selection.toggle(Number(a.id))"
                />
              </td>
              <!-- Thumbnail + Title combined -->
              <td class="px-4 py-3 border-b border-[#eef2ee]">
                <div class="flex items-center gap-3">
                  <div class="w-16 h-10 rounded-lg overflow-hidden bg-[#f0f4f0] flex-shrink-0 border border-[#e2ece3]">
                    <img v-if="a.thumbnailUrl" :src="a.thumbnailUrl" class="w-full h-full object-cover" />
                    <div v-else class="w-full h-full flex items-center justify-center">
                      <i class="fa-regular fa-image text-lg text-[#c8d6c9]"></i>
                    </div>
                  </div>
                  <div class="min-w-0">
                    <p class="text-[#122815] font-semibold line-clamp-1 m-0 text-[0.85rem]">{{ a.title }}</p>
                    <p class="text-[#8a9f8c] text-[0.75rem] m-0 mt-0.5">{{ a.authorName || 'Admin' }}</p>
                  </div>
                </div>
              </td>
              <!-- Type badge with icon + color -->
              <td class="px-4 py-3 border-b border-[#eef2ee]">
                <span
                  class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[0.75rem] font-bold whitespace-nowrap"
                  :class="typeColors[a.type] || 'bg-gray-100 text-gray-600'"
                >
                  <i :class="typeIcons[a.type] || 'fa-solid fa-file'" class="text-[0.65rem]"></i>
                  {{ typeLabels[a.type] || a.type }}
                </span>
              </td>
              <!-- Category with hierarchy -->
              <td class="px-4 py-3 border-b border-[#eef2ee]">
                <span v-if="categoryDisplay(a)" class="text-[0.82rem] text-[#445546]">
                  {{ categoryDisplay(a) }}
                </span>
                <span v-else class="text-[0.8rem] text-[#bbb] italic">Chưa phân loại</span>
              </td>
              <!-- Status -->
              <td class="px-4 py-3 border-b border-[#eef2ee]">
                <span
                  class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[0.72rem] font-bold whitespace-nowrap"
                  :class="a.status === 'published' ? 'bg-[#e4f2e5] text-[#2c6e33]' : a.status === 'draft' ? 'bg-[#fff8e1] text-[#b78103]' : 'bg-[#f5f5f5] text-[#888]'"
                >
                  <span class="w-1.5 h-1.5 rounded-full" :class="a.status === 'published' ? 'bg-[#2c6e33]' : a.status === 'draft' ? 'bg-[#b78103]' : 'bg-[#888]'"></span>
                  {{ a.status === 'published' ? 'Đã đăng' : (a.status === 'draft' ? 'Nháp' : 'Lưu trữ') }}
                </span>
              </td>
              <!-- Date -->
              <td class="px-4 py-3 border-b border-[#eef2ee] text-[#667768] text-[0.82rem] whitespace-nowrap">{{ new Date(a.createdAt).toLocaleDateString('vi-VN') }}</td>
              <!-- Actions -->
              <td class="px-4 py-3 border-b border-[#eef2ee]">
                <div class="flex items-center gap-2">
                  <nuxt-link
                    :to="`/admin/content/articles/${a.id}`"
                    class="inline-flex items-center gap-1 text-[#2c6e33] no-underline font-bold text-[0.82rem] hover:underline"
                  ><i class="fa-solid fa-pen-to-square"></i> Sửa</nuxt-link>
                  <button
                    class="inline-flex items-center gap-1 bg-none border-0 text-[#d12420] cursor-pointer font-bold text-[0.82rem] hover:underline"
                    @click="deleteArticle(a)"
                  ><i class="fa-regular fa-trash"></i> Xóa</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="pagination.totalPages > 1" class="flex justify-center items-center gap-4">
      <button
        :disabled="pagination.page <= 1"
        @click="fetchArticles(pagination.page - 1)"
        class="inline-flex items-center gap-2 bg-white border border-[#c8d6c9] px-4 py-2 rounded-lg cursor-pointer text-sm font-medium hover:bg-[#f0f7f1] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      ><i class="fa-regular fa-chevron-left"></i> Trang trước</button>
      <span class="text-sm text-[#667768] font-medium">Trang {{ pagination.page }} / {{ pagination.totalPages }}</span>
      <button
        :disabled="pagination.page >= pagination.totalPages"
        @click="fetchArticles(pagination.page + 1)"
        class="inline-flex items-center gap-2 bg-white border border-[#c8d6c9] px-4 py-2 rounded-lg cursor-pointer text-sm font-medium hover:bg-[#f0f7f1] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >Trang sau <i class="fa-regular fa-chevron-right"></i></button>
    </div>
  </div>
</template>
