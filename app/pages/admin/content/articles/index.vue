<script setup lang="ts">
import type { AdminArticleAuthorRow, AdminArticleBoost, AdminArticleStats, AdminArticleStatsResult, AdminCategoryRow } from '~/types/admin-api'
import type { AdminArticleRow } from '~/types/admin-api'
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const route = useRoute()
const articles = ref<AdminArticleRow[]>([])
const loading = ref(true)
const loadError = ref('')
const search = ref('')
const selectedType = ref('')
const selectedStatus = ref('')
const selectedParentCategoryId = ref<number | null>(null)
const selectedCategoryId = ref<number | null>(null)
/**
 * Người đăng bài. `''` là không lọc, `'none'` là nhóm bài đã mất tác giả, còn
 * lại là id dạng chuỗi. Dùng chuỗi thay vì `number | null` để ba trạng thái đó
 * cùng nằm trong một `<select>` mà không phải trộn kiểu trong `:value`.
 */
const selectedAuthorId = ref('')
const pagination = ref({ page: 1, totalPages: 1, total: 0 })

// Category state
const allCategories = ref<AdminCategoryRow[]>([])

// Người đăng bài — chỉ những ai đã thực sự có bài, kèm số bài mất tác giả.
const authorOptions = ref<AdminArticleAuthorRow[]>([])
const orphanAuthorCount = ref(0)

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
const categoryDisplay = (a: AdminArticleRow) => {
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
    const params: Record<string, string> = {}
    if (selectedType.value) params.type = selectedType.value
    const res = await $fetch('/api/admin/categories', { params })
    if (res.ok) allCategories.value = res.items
  } catch { /* non-critical */ }
}

/**
 * Danh sách người đăng bài đến từ endpoint riêng gác bằng `news.read`, không
 * phải `/api/admin/users` (endpoint đó cần `users.read`, biên tập viên chỉ có
 * quyền nội dung sẽ nhận 403 và ô lọc rỗng không lời giải thích).
 */
const fetchAuthors = async () => {
  try {
    const res = await $fetch('/api/admin/articles/authors')
    if (res.ok) {
      authorOptions.value = res.items
      orphanAuthorCount.value = res.orphanCount
    }
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
  loadError.value = ''
  try {
    const params: Record<string, string | number> = {
      page,
      search: search.value,
      type: selectedType.value,
      status: selectedStatus.value,
      perPage: 15,
    }
    // Wire category filter: prefer sub-category if selected, else parent
    const effectiveCategoryId = selectedCategoryId.value ?? selectedParentCategoryId.value
    if (effectiveCategoryId) params.categoryId = effectiveCategoryId
    // Chuỗi rỗng nghĩa là không lọc — gửi lên thì máy chủ cũng đọc thành không
    // lọc, nhưng để URL và params sạch thì chỉ gửi khi có chọn.
    if (selectedAuthorId.value) params.authorId = selectedAuthorId.value

    const res = await $fetch('/api/admin/articles', { params })
    if (res.ok) {
      articles.value = res.items
      pagination.value = res.pagination
      // Ids from the previous page/filter no longer refer to anything on screen.
      selection.keepOnly(visibleIds.value)
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi tải danh sách bài viết'))
    loadError.value = errorMessage(err, 'Lỗi tải danh sách bài viết')
  } finally {
    loading.value = false
  }
}

// ─── Bulk selection ───────────────────────────────────────────────────────────
const selection = useBulkSelection()
const bulk = useBulkAction(selection)
const visibleIds = computed(() => articles.value.map((a) => Number(a.id)))

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

/** Mở/đóng bình luận cho nhiều bài cùng lúc.
 *
 *  Tồn tại vì `comments_enabled` mặc định TẮT cho mọi bài đã có: mặc định ngược
 *  lại sẽ mở bình luận cho toàn bộ kho lưu trữ ngay lúc triển khai, một khối
 *  lượng kiểm duyệt không ai chọn. Không có hành động hàng loạt thì "mở những
 *  bài cần mở" là hàng trăm cú bấm, và chính loại ma sát đó dẫn tới việc ai đó
 *  đi đổi giá trị mặc định của cột. */
const bulkComments = (enabled: boolean) => {
  const verb = enabled ? 'Mở bình luận' : 'Đóng bình luận'
  return bulk.run({
    url: '/api/admin/articles/bulk-comments',
    body: { enabled },
    noun: 'bài viết',
    confirm: {
      message: enabled
        ? `${verb} cho ${selection.count.value} bài viết đã chọn? Khách đã đăng nhập Google sẽ bình luận được ngay.`
        : `${verb} của ${selection.count.value} bài viết đã chọn? Bình luận cũ không bị xoá, chỉ ẩn khỏi trang công khai.`,
      confirmLabel: verb,
    },
    reload: () => fetchArticles(pagination.value.page),
  })
}

/** Bật/tắt tại chỗ. Lỗi thì trả công tắc về giá trị đã lưu: một công tắc hiện
 *  "đang mở" trong khi máy chủ vẫn đóng là lời nói dối về trạng thái thật, và
 *  cán bộ sẽ đi tìm xem vì sao trang công khai không có khung bình luận. */
const togglingComments = ref<number | null>(null)
const toggleComments = async (art: AdminArticleRow) => {
  const next = !art.commentsEnabled
  togglingComments.value = Number(art.id)
  art.commentsEnabled = next
  try {
    await $fetch(`/api/admin/articles/${art.id}`, { method: 'PUT', body: { commentsEnabled: next } })
    toast.success(next ? 'Đã mở bình luận cho bài viết này.' : 'Đã đóng bình luận của bài viết này.')
  } catch (err: unknown) {
    art.commentsEnabled = !next
    toast.error(errorMessage(err, 'Không đổi được trạng thái bình luận.'))
  } finally {
    togglingComments.value = null
  }
}

const deleteArticle = async (art: AdminArticleRow) => {
  const ok = await confirm({ title: 'Xóa bài viết', message: `Bạn có chắc muốn xóa bài viết "${art.title}"?`, danger: true, confirmLabel: 'Xóa' })
  if (!ok) return
  try {
    await $fetch(`/api/admin/articles/${art.id}`, { method: 'DELETE' })
    toast.success('Đã xóa bài viết thành công!')
    await fetchArticles(pagination.value.page)
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi xóa bài viết'))
  }
}

// ─── Thống kê lượt xem ────────────────────────────────────────────────────────
/**
 * Con số hiển thị công khai là tổng của lượt xem thật và lượt xem ảo, nhưng
 * trong trang quản trị hai phần đó không bao giờ được gộp lại thành một số duy
 * nhất. Cán bộ mở modal này phải luôn đọc được bao nhiêu là thật — nếu không,
 * chính người trong cơ quan cũng không trả lời được câu hỏi "số đó có thật
 * không", và đó là câu hỏi bắt buộc phải trả lời được.
 */
const statsArticle = ref<AdminArticleRow | null>(null)
const statsLoading = ref(false)
const statsError = ref('')
const statsData = ref<AdminArticleStats | null>(null)
const runningBoost = ref<AdminArticleBoost>(null)

const boostMode = ref<'instant' | 'gradual'>('instant')
const boostAmount = ref<number | null>(null)
const boostMinutes = ref<number | null>(60)
const boostSubmitting = ref(false)

const formatViews = (value: unknown) => Number(value || 0).toLocaleString('vi-VN')

const sourceLabels: Record<string, string> = {
  direct: 'Truy cập trực tiếp',
  search: 'Từ công cụ tìm kiếm',
  social: 'Từ mạng xã hội',
  referral: 'Từ trang khác dẫn sang',
  email: 'Từ thư điện tử',
  other: 'Nguồn khác',
}

/** Phần trăm đã giao của lượt tăng dần đang chạy, để thanh tiến độ có ý nghĩa. */
const boostProgress = computed(() => {
  const job = runningBoost.value
  if (!job || !Number(job.totalAmount)) return 0
  return Math.min(100, Math.round((Number(job.appliedAmount) / Number(job.totalAmount)) * 100))
})

/** Cột cao nhất trong biểu đồ ngày, dùng làm mốc quy đổi chiều cao các cột còn lại. */
const dailyPeak = computed(() => {
  const rows = statsData.value?.daily || []
  return rows.reduce((max: number, row: { total?: number }) => Math.max(max, Number(row.total || 0)), 0)
})

const loadStats = async () => {
  if (!statsArticle.value) return
  statsLoading.value = true
  statsError.value = ''
  try {
    const res = await $fetch<AdminArticleStatsResult>(`/api/admin/articles/${statsArticle.value.id}/stats`)
    statsData.value = res.stats
    runningBoost.value = res.boost
  } catch (err: unknown) {
    // Giữ lại lỗi trên màn hình kèm nút thử lại: một modal trống không nói được
    // là "bài này chưa có lượt xem" hay "không tải được số liệu".
    statsError.value = errorMessage(err, 'Không tải được số liệu lượt xem.')
    statsData.value = null
    runningBoost.value = null
  } finally {
    statsLoading.value = false
  }
}

const openStats = async (art: AdminArticleRow) => {
  statsArticle.value = art
  statsData.value = null
  runningBoost.value = null
  statsError.value = ''
  boostMode.value = 'instant'
  boostAmount.value = null
  boostMinutes.value = 60
  await loadStats()
}

const closeStats = () => {
  statsArticle.value = null
  statsData.value = null
  runningBoost.value = null
  statsError.value = ''
}

const submitBoost = async () => {
  if (!statsArticle.value || boostSubmitting.value) return
  const amount = Number(boostAmount.value)
  if (!Number.isInteger(amount) || amount < 1) {
    toast.error('Vui lòng nhập số lượt xem là số nguyên lớn hơn 0.')
    return
  }
  const minutes = Number(boostMinutes.value)
  if (boostMode.value === 'gradual' && (!Number.isInteger(minutes) || minutes < 1)) {
    toast.error('Vui lòng nhập thời lượng là số nguyên phút lớn hơn 0.')
    return
  }

  const ok = await confirm({
    title: 'Tăng lượt xem ảo',
    message: boostMode.value === 'instant'
      ? `Cộng ngay ${amount.toLocaleString('vi-VN')} lượt xem ảo cho bài "${statsArticle.value.title}"? Thao tác này được ghi vào nhật ký hoạt động kèm tên tài khoản của bạn.`
      : `Cộng dần ${amount.toLocaleString('vi-VN')} lượt xem ảo trong ${minutes.toLocaleString('vi-VN')} phút cho bài "${statsArticle.value.title}"? Thao tác này được ghi vào nhật ký hoạt động kèm tên tài khoản của bạn.`,
    confirmLabel: 'Xác nhận',
  })
  if (!ok) return

  boostSubmitting.value = true
  try {
    const body: Record<string, unknown> = { mode: boostMode.value, amount }
    if (boostMode.value === 'gradual') body.minutes = minutes
    await $fetch(`/api/admin/articles/${statsArticle.value.id}/boost`, { method: 'POST', body })
    toast.success(boostMode.value === 'instant' ? 'Đã cộng lượt xem ảo.' : 'Đã tạo lượt tăng dần.')
    boostAmount.value = null
    await loadStats()
    await fetchArticles(pagination.value.page)
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thực hiện được thao tác tăng lượt xem.'))
  } finally {
    boostSubmitting.value = false
  }
}

const cancelBoost = async () => {
  if (!statsArticle.value || !runningBoost.value) return
  const ok = await confirm({
    title: 'Huỷ lượt tăng dần',
    // Nói rõ phần đã cộng vẫn giữ: người vận hành cần biết huỷ là dừng phần còn
    // lại, không phải hoàn tác phần đã chạy.
    message: `Dừng lượt tăng dần đang chạy? Phần đã cộng (${formatViews(runningBoost.value.appliedAmount)} lượt) vẫn được giữ nguyên.`,
    danger: true,
    confirmLabel: 'Huỷ lượt tăng',
  })
  if (!ok) return
  try {
    await $fetch(`/api/admin/articles/${statsArticle.value.id}/boost`, { method: 'DELETE' })
    toast.success('Đã huỷ lượt tăng dần.')
    await loadStats()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không huỷ được lượt tăng dần.'))
  }
}


onMounted(async () => {
  // Pre-select categoryId from query param (coming from categories page "Xem bài")
  const qCategoryId = route.query.categoryId ? Number(route.query.categoryId) : null
  // Hai lượt này độc lập nhau — danh sách người đăng không phụ thuộc thể loại —
  // nên chạy song song thay vì nối đuôi.
  await Promise.all([fetchCategories(), fetchAuthors()])
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
      <!-- Người đăng bài. Tuỳ chọn "Không rõ tác giả" chỉ hiện khi thật sự có bài
           mất tác giả (tài khoản đã xoá → author_id NULL) — một lựa chọn luôn cho
           ra danh sách rỗng thì không nên có mặt. -->
      <select
        v-model="selectedAuthorId"
        aria-label="Lọc theo người đăng bài"
        @change="fetchArticles(1)"
        class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]"
      >
        <option value="">Tất cả Người đăng</option>
        <option v-for="author in authorOptions" :key="author.id" :value="String(author.id)">
          {{ author.username }} ({{ author.articleCount }})
        </option>
        <option v-if="orphanAuthorCount > 0" value="none">Không rõ tác giả ({{ orphanAuthorCount }})</option>
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
      <button type="button" class="rounded-lg border border-[#2c6e33] bg-white px-3 py-2 text-sm font-bold text-[#2c6e33] hover:bg-white/70" @click="bulkComments(true)">Mở bình luận</button>
      <button type="button" class="rounded-lg border border-[#c8d6c9] bg-white px-3 py-2 text-sm font-bold text-[#3d4f3f] hover:bg-white/70" @click="bulkComments(false)">Đóng bình luận</button>
      <button type="button" class="rounded-lg bg-[#d12420] px-3 py-2 text-sm font-bold text-white hover:bg-[#b01f1b]" @click="bulkDelete">Xóa</button>
    </AdminBulkActionBar>

    <!-- Table Card -->
    <div class="bg-white rounded-xl border border-[#e2ece3] overflow-hidden">
      <SkeletonTable v-if="loading" label="Đang tải danh sách bài viết" :rows="6" :cols="8" />

      <!-- Error -->
      <div v-else-if="loadError" role="alert" class="px-6 py-10 text-center text-[#b04a4a] text-[0.9rem]">
        <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
        {{ loadError }}. Vui lòng <button type="button" class="text-[#2c6e33] font-bold underline bg-transparent border-0 cursor-pointer p-0" @click="fetchArticles(1)">thử lại</button>.
      </div>

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
              <button
                type="button"
                class="bg-none border-0 p-0 text-[#2c6e33] font-bold text-[0.8rem] cursor-pointer"
                :aria-label="`Xem thống kê lượt xem bài viết: ${a.title}`"
                @click="openStats(a)"
              ><i class="fa-regular fa-eye" aria-hidden="true"></i> {{ formatViews(a.viewTotal) }} lượt xem</button>
              <button class="bg-none border-0 text-[#d12420] font-bold text-[0.8rem] cursor-pointer p-0" @click="deleteArticle(a)"><i class="fa-regular fa-trash"></i> Xóa</button>
            </div>
          </div>
        </div>
        <div v-if="articles.length === 0" class="p-8 text-center text-[#667768] text-sm">Không có bài viết nào.</div>
      </div>

      <!-- Desktop Table View -->
      <div v-if="!loading && !loadError" class="hidden md:block overflow-x-auto">
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
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Lượt xem</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Bình luận</th>
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
              <!-- Views -->
              <td class="px-4 py-3 border-b border-[#eef2ee] whitespace-nowrap">
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-md border border-[#e2ece3] bg-white px-2 py-1 text-[0.82rem] font-bold text-[#2c6e33] transition-colors hover:bg-[#f0f7f1] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2c6e33]/40"
                  :aria-label="`Xem thống kê lượt xem bài viết: ${a.title}`"
                  @click="openStats(a)"
                >
                  <i class="fa-regular fa-eye text-[0.75rem]" aria-hidden="true"></i>
                  {{ formatViews(a.viewTotal) }}
                </button>
              </td>
              <!-- Comments switch. Bật/tắt tại chỗ qua chính route sửa bài, nên
                   vẫn chịu đúng kiểm tra quyền theo thể loại và vẫn ghi audit. -->
              <td class="px-4 py-3 border-b border-[#eef2ee] whitespace-nowrap">
                <button
                  type="button"
                  :disabled="togglingComments === Number(a.id)"
                  class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2c6e33]/40 disabled:opacity-60"
                  :class="a.commentsEnabled ? 'bg-[#e4f2e5] text-[#2c6e33] hover:bg-[#d6ecd8]' : 'bg-[#f5f5f5] text-[#888] hover:bg-[#ededed]'"
                  :aria-pressed="a.commentsEnabled ? 'true' : 'false'"
                  :aria-label="`${a.commentsEnabled ? 'Đóng' : 'Mở'} bình luận cho bài viết: ${a.title}`"
                  @click="toggleComments(a)"
                >
                  <i :class="a.commentsEnabled ? 'fa-solid fa-comments' : 'fa-solid fa-comment-slash'" class="text-[0.7rem]" aria-hidden="true"></i>
                  {{ a.commentsEnabled ? 'Đang mở' : 'Đang đóng' }}
                </button>
              </td>
              <!-- Date -->
              <td class="px-4 py-3 border-b border-[#eef2ee] text-[#667768] text-[0.82rem] whitespace-nowrap">{{ formatDateTimeVN(a.createdAt) }}</td>
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

    <!-- Modal: thống kê lượt xem & tăng lượt xem ảo -->
    <div
      v-if="statsArticle"
      class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stats-modal-title"
      @click.self="closeStats"
    >
      <div class="w-full max-w-2xl rounded-xl border border-[#e2ece3] bg-white shadow-lg">
        <div class="flex items-start justify-between gap-3 border-b border-[#eef2ee] px-5 py-4">
          <div class="min-w-0">
            <h2 id="stats-modal-title" class="m-0 text-[1.05rem] font-extrabold text-[#122815]">Thống kê lượt xem</h2>
            <p class="m-0 mt-1 line-clamp-2 text-[0.82rem] text-[#667768]">{{ statsArticle.title }}</p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-lg border-0 bg-none p-1.5 text-[#667768] hover:text-[#122815] cursor-pointer"
            aria-label="Đóng"
            @click="closeStats"
          ><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </div>

        <div class="px-5 py-4">
          <div v-if="statsLoading" class="py-10 text-center text-[0.85rem] text-[#667768]">Đang tải số liệu lượt xem...</div>

          <div v-else-if="statsError" class="rounded-lg border border-dashed border-[#e2b3b3] bg-[#fdf6f6] px-4 py-6 text-center">
            <p class="m-0 text-[0.85rem] font-semibold text-[#b01f1b]">{{ statsError }}</p>
            <button
              type="button"
              class="mt-3 rounded-lg border border-[#2c6e33] bg-white px-3 py-2 text-sm font-bold text-[#2c6e33] cursor-pointer hover:bg-[#f0f7f1]"
              @click="loadStats"
            >Thử lại</button>
          </div>

          <div v-else-if="statsData" class="flex flex-col gap-5">
            <!--
              Ba ô, không bao giờ chỉ một. Con số công khai là tổng, nhưng cán bộ
              phải đọc được ngay phần nào là thật và phần nào do quản trị viên
              cộng vào.
            -->
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div class="rounded-lg border border-[#e2ece3] bg-[#f8faf8] px-4 py-3">
                <p class="m-0 text-[0.72rem] font-bold uppercase tracking-wide text-[#667768]">Tổng hiển thị</p>
                <p class="m-0 mt-1 text-[1.35rem] font-extrabold text-[#122815]">{{ formatViews(statsData.totalDisplayed) }}</p>
              </div>
              <div class="rounded-lg border border-[#cfe4d1] bg-[#f0f7f1] px-4 py-3">
                <p class="m-0 text-[0.72rem] font-bold uppercase tracking-wide text-[#2c6e33]">Lượt xem thật</p>
                <p class="m-0 mt-1 text-[1.35rem] font-extrabold text-[#1e4620]">{{ formatViews(statsData.totalReal) }}</p>
              </div>
              <div class="rounded-lg border border-[#f0dcae] bg-[#fff8e1] px-4 py-3">
                <p class="m-0 text-[0.72rem] font-bold uppercase tracking-wide text-[#b78103]">Lượt xem ảo</p>
                <p class="m-0 mt-1 text-[1.35rem] font-extrabold text-[#765b00]">{{ formatViews(statsData.totalFabricated) }}</p>
              </div>
            </div>

            <!-- Lượt tăng dần đang chạy -->
            <div v-if="runningBoost" class="rounded-lg border border-[#f0dcae] bg-[#fffdf6] px-4 py-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="m-0 text-[0.82rem] font-bold text-[#765b00]">
                  Đang cộng dần: {{ formatViews(runningBoost.appliedAmount) }} / {{ formatViews(runningBoost.totalAmount) }} lượt
                  ({{ formatViews(runningBoost.durationMinutes) }} phút)
                </p>
                <button
                  type="button"
                  class="rounded-lg border border-[#d12420] bg-white px-3 py-1.5 text-[0.8rem] font-bold text-[#d12420] cursor-pointer hover:bg-[#fdf6f6]"
                  @click="cancelBoost"
                >Huỷ lượt tăng</button>
              </div>
              <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#f0e6c8]">
                <div class="h-full rounded-full bg-[#b78103] transition-all" :style="{ width: `${boostProgress}%` }"></div>
              </div>
              <p class="m-0 mt-1.5 text-[0.75rem] text-[#8a7a4a]">Kết thúc lúc {{ new Date(runningBoost.endsAt).toLocaleString('vi-VN') }}</p>
            </div>

            <!-- Nguồn truy cập (chỉ lượt xem thật) -->
            <div>
              <h3 class="m-0 mb-2 text-[0.85rem] font-extrabold text-[#122815]">
                Nguồn truy cập <span class="font-medium text-[#667768]">— {{ statsData.days }} ngày gần nhất, chỉ tính lượt xem thật</span>
              </h3>
              <table v-if="statsData.bySource.length" class="w-full border-collapse text-left text-[0.82rem]">
                <thead>
                  <tr>
                    <th class="border-b border-[#e2ece3] bg-[#f8faf8] px-3 py-2 font-bold text-[#667768]">Nguồn</th>
                    <th class="border-b border-[#e2ece3] bg-[#f8faf8] px-3 py-2 text-right font-bold text-[#667768]">Lượt xem</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in statsData.bySource" :key="row.sourceCategory">
                    <td class="border-b border-[#eef2ee] px-3 py-2 text-[#445546]">{{ sourceLabels[row.sourceCategory] || row.sourceCategory }}</td>
                    <td class="border-b border-[#eef2ee] px-3 py-2 text-right font-bold text-[#122815]">{{ formatViews(row.views) }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="m-0 rounded-lg border border-dashed border-[#e2ece3] px-3 py-4 text-center text-[0.82rem] text-[#8a9f8c]">
                Chưa ghi nhận lượt xem thật nào trong khoảng thời gian này.
              </p>
            </div>

            <!-- Diễn biến theo ngày -->
            <div>
              <h3 class="m-0 mb-2 text-[0.85rem] font-extrabold text-[#122815]">Diễn biến theo ngày</h3>
              <ul v-if="statsData.daily.length" class="m-0 flex list-none flex-col gap-1.5 p-0">
                <li v-for="row in statsData.daily" :key="row.day" class="flex items-center gap-3">
                  <span class="w-20 shrink-0 text-[0.78rem] text-[#667768]">{{ new Date(row.day).toLocaleDateString('vi-VN') }}</span>
                  <span class="h-2 flex-1 overflow-hidden rounded-full bg-[#eef2ee]">
                    <span class="block h-full rounded-full bg-[#2c6e33]" :style="{ width: dailyPeak ? `${(row.total / dailyPeak) * 100}%` : '0%' }"></span>
                  </span>
                  <span class="w-32 shrink-0 text-right text-[0.78rem] text-[#445546]">
                    <strong class="text-[#122815]">{{ formatViews(row.total) }}</strong>
                    <span class="text-[#8a9f8c]"> ({{ formatViews(row.real) }} thật / {{ formatViews(row.fabricated) }} ảo)</span>
                  </span>
                </li>
              </ul>
              <p v-else class="m-0 rounded-lg border border-dashed border-[#e2ece3] px-3 py-4 text-center text-[0.82rem] text-[#8a9f8c]">
                Bài viết chưa có lượt xem nào được ghi nhận.
              </p>
            </div>

            <!-- Tăng lượt xem ảo -->
            <div class="rounded-lg border border-[#e2ece3] bg-[#f8faf8] px-4 py-4">
              <h3 class="m-0 text-[0.85rem] font-extrabold text-[#122815]">Tăng lượt xem ảo</h3>
              <p class="m-0 mt-1 text-[0.78rem] text-[#667768]">
                Lượt xem ảo được lưu tách khỏi lượt xem thật và mọi thao tác đều ghi vào nhật ký hoạt động kèm tên tài khoản thực hiện.
              </p>
              <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <label class="flex flex-col gap-1">
                  <span class="text-[0.75rem] font-bold text-[#667768]">Chế độ</span>
                  <select
                    v-model="boostMode"
                    class="rounded-lg border border-[#c8d6c9] px-3 py-2 text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
                  >
                    <option value="instant">Cộng ngay</option>
                    <option value="gradual">Cộng dần theo thời gian</option>
                  </select>
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-[0.75rem] font-bold text-[#667768]">Số lượt xem</span>
                  <input
                    v-model.number="boostAmount"
                    type="number"
                    min="1"
                    max="1000000"
                    step="1"
                    placeholder="Ví dụ: 500"
                    class="w-40 rounded-lg border border-[#c8d6c9] px-3 py-2 text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
                  />
                </label>
                <label v-if="boostMode === 'gradual'" class="flex flex-col gap-1">
                  <span class="text-[0.75rem] font-bold text-[#667768]">Thời lượng (phút)</span>
                  <input
                    v-model.number="boostMinutes"
                    type="number"
                    min="1"
                    max="10080"
                    step="1"
                    class="w-40 rounded-lg border border-[#c8d6c9] px-3 py-2 text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
                  />
                </label>
                <button
                  type="button"
                  class="inline-flex items-center gap-2 rounded-lg border-0 bg-[#2c6e33] px-4 py-2.5 font-bold text-white transition-colors hover:bg-[#1e4620] disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="boostSubmitting"
                  @click="submitBoost"
                >
                  <i class="fa-solid fa-arrow-up-right-dots" aria-hidden="true"></i>
                  {{ boostSubmitting ? 'Đang thực hiện...' : 'Thực hiện' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
