<template>
  <div class="min-h-screen bg-[#F7FAF6]">
    <!-- Breadcrumb & Header Bar -->
    <section class="bg-white border-b border-[#E2E8DF]">
      <div class="container py-7 sm:py-9">
        <nav aria-label="Đường dẫn trang" class="flex items-center gap-2 text-xs text-[#7A8A76] mb-3">
          <nuxt-link to="/" class="hover:text-[#4A6741] transition-colors flex items-center gap-1.5 no-underline text-[#556450]">
            <i class="fa-solid fa-house text-[0.7rem]" aria-hidden="true"></i>
            <span>Trang chủ</span>
          </nuxt-link>
          <span class="text-[#BAC8B6]">&rsaquo;</span>
          <span class="text-[#2D5A27] font-bold">Tìm kiếm</span>
        </nav>

        <h1 class="text-2xl sm:text-3xl font-black text-[#172516] tracking-tight m-0 mb-2">
          Tìm kiếm thông tin
        </h1>
        <p class="text-sm text-[#556450] max-w-2xl m-0 leading-relaxed">
          Tra cứu toàn diện bản tin, tấm gương hoàn lương, mô hình tái hòa nhập, văn bản pháp luật và giải đáp thắc mắc.
        </p>

        <!-- Big Search Form -->
        <form @submit.prevent="onFormSubmit" class="mt-6 max-w-3xl">
          <div class="relative flex items-center bg-white rounded-xl border-2 border-[#D5E1D3] focus-within:border-[#4A6741] focus-within:shadow-[0_4px_16px_rgba(74,103,65,0.12)] transition-all overflow-hidden p-1.5 shadow-sm">
            <span class="w-10 flex items-center justify-center text-[#7A8A76] text-sm shrink-0">
              <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            </span>
            <input
              v-model="inputQuery"
              type="text"
              placeholder="Nhập từ khóa cần tìm kiếm (tiêu đề, nội dung, chủ đề)..."
              class="w-full py-2.5 px-2 text-[0.95rem] text-[#172516] outline-none border-none bg-transparent font-medium placeholder:text-[#9AABA0]"
            />
            <button
              v-if="inputQuery"
              type="button"
              @click="inputQuery = ''"
              class="w-8 h-8 rounded-lg text-[#8A9A88] hover:text-[#2D5A27] hover:bg-[#EEF4EC] flex items-center justify-center text-xs shrink-0 cursor-pointer border-none bg-transparent transition-colors mr-1"
              aria-label="Xóa từ khóa"
            >
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
            <button
              type="submit"
              class="bg-[#4A6741] hover:bg-[#385132] text-white px-5 sm:px-6 py-2.5 rounded-lg text-sm font-extrabold cursor-pointer transition-all shrink-0 border-none flex items-center gap-2 shadow-sm"
            >
              <span>Tìm kiếm</span>
              <i class="fa-solid fa-arrow-right text-xs" aria-hidden="true"></i>
            </button>
          </div>
        </form>
      </div>
    </section>

    <!-- Main Results Section -->
    <section class="container py-8 sm:py-10">
      <!-- Query Summary & Type Filter Tabs -->
      <div v-if="searchQuery" class="mb-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#E1E8DF]">
          <div>
            <h2 class="text-lg font-black text-[#172516] m-0">
              Kết quả cho từ khóa: <span class="text-[#2D5A27]">&laquo;{{ searchQuery }}&raquo;</span>
            </h2>
            <p class="text-xs text-[#7A8A76] mt-1 m-0">
              Tìm thấy <strong>{{ searchData?.total ?? 0 }}</strong> kết quả phù hợp trên toàn hệ thống
            </p>
          </div>

          <div v-if="pending" class="text-xs text-[#4A6741] font-semibold flex items-center gap-2">
            <i class="fa-solid fa-circle-notch animate-spin text-sm" aria-hidden="true"></i>
            <span>Đang tìm kiếm...</span>
          </div>
        </div>

        <!-- Filter Tabs -->
        <div class="flex items-center gap-2 overflow-x-auto py-3 no-scrollbar">
          <button
            v-for="tab in filterTabs"
            :key="tab.key"
            type="button"
            @click="setTab(tab.key)"
            :class="[
              'px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all border shrink-0 flex items-center gap-2',
              activeType === tab.key
                ? 'bg-[#4A6741] text-white border-[#4A6741] shadow-sm'
                : 'bg-white text-[#4A5545] border-[#DCE5DB] hover:border-[#4A6741] hover:bg-[#F2F7F0]'
            ]"
          >
            <i :class="tab.icon" class="text-[0.75rem]" aria-hidden="true"></i>
            <span>{{ tab.label }}</span>
            <span
              :class="[
                'text-[0.7rem] px-1.5 py-0.2 rounded-full font-black',
                activeType === tab.key ? 'bg-white/20 text-white' : 'bg-[#EBF1EA] text-[#556653]'
              ]"
            >
              {{ getCountForTab(tab.key) }}
            </span>
          </button>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="pending" role="status" aria-busy="true" class="space-y-4">
        <span class="sr-only">Đang tải kết quả tìm kiếm</span>
        <div v-for="n in 5" :key="n" class="bg-white p-5 rounded-xl border border-[#E2E8DF] flex gap-4 animate-pulse motion-reduce:animate-none">
          <div class="w-24 sm:w-32 aspect-video bg-[#EEF2EC] rounded-lg shrink-0"></div>
          <div class="flex-1 space-y-2.5">
            <div class="h-4 w-28 bg-[#EEF2EC] rounded"></div>
            <div class="h-5 w-3/4 bg-[#EEF2EC] rounded"></div>
            <div class="h-3.5 w-full bg-[#EEF2EC] rounded"></div>
          </div>
        </div>
      </div>

      <!-- Error State -->
      <div
        v-else-if="error"
        role="alert"
        class="bg-white border-2 border-dashed border-[#F0B8B8] px-6 py-12 rounded-2xl text-center text-[#B04A4A] shadow-sm"
      >
        <div class="w-12 h-12 rounded-full bg-[#FCE8E8] text-[#C62828] flex items-center justify-center mx-auto mb-3 text-lg">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        </div>
        <h3 class="text-base font-extrabold text-[#992222] m-0 mb-1">Không thể tải kết quả tìm kiếm</h3>
        <p class="text-sm text-[#667768] m-0 mb-4">Đã xảy ra lỗi khi kết nối dữ liệu máy chủ.</p>
        <button
          type="button"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#C62828] text-white text-xs font-bold hover:bg-[#B71C1C] transition-all cursor-pointer border-none"
          @click="() => refresh()"
        >
          <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
          <span>Thử lại</span>
        </button>
      </div>

      <!-- No Query Initial State -->
      <div v-else-if="!searchQuery" class="bg-white border border-[#E2E8DF] rounded-2xl p-10 text-center max-w-xl mx-auto shadow-sm">
        <div class="w-16 h-16 rounded-full bg-[#EBF3E8] text-[#4A6741] flex items-center justify-center mx-auto mb-4 text-2xl shadow-sm">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        </div>
        <h3 class="text-lg font-extrabold text-[#172516] m-0 mb-2">Nhập từ khóa để bắt đầu tìm kiếm</h3>
        <p class="text-sm text-[#556450] m-0 leading-relaxed mb-6">
          Bạn có thể tìm kiếm tên bài viết, tấm gương hoàn lương, mô hình cơ sở, câu hỏi giải đáp pháp luật hoặc số hiệu văn bản.
        </p>
        <div class="flex flex-wrap items-center justify-center gap-2 text-xs">
          <span class="text-[#7A8A76] font-medium">Gợi ý từ khóa:</span>
          <button
            v-for="kw in ['Ninh Bình', 'Tái hòa nhập', 'Tấm gương', 'Văn bản', 'Nghị định']"
            :key="kw"
            type="button"
            @click="quickSearch(kw)"
            class="px-2.5 py-1 rounded-md bg-[#F2F7F0] text-[#385932] hover:bg-[#4A6741] hover:text-white transition-all font-bold cursor-pointer border border-[#D5E1D3]"
          >
            {{ kw }}
          </button>
        </div>
      </div>

      <!-- Empty Results State -->
      <div v-else-if="!searchData?.items?.length" class="bg-white border border-[#E2E8DF] rounded-2xl p-10 text-center max-w-xl mx-auto shadow-sm">
        <div class="w-16 h-16 rounded-full bg-[#FCE8E8] text-[#C62828] flex items-center justify-center mx-auto mb-4 text-2xl">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        </div>
        <h3 class="text-lg font-extrabold text-[#172516] m-0 mb-2">Không tìm thấy kết quả nào</h3>
        <p class="text-sm text-[#556450] m-0 leading-relaxed mb-6">
          Không có nội dung nào phù hợp với từ khóa &laquo;<strong>{{ searchQuery }}</strong>&raquo;. Vui lòng thử lại với từ khóa ngắn gọn hơn hoặc chọn bộ lọc khác.
        </p>
        <div class="flex justify-center gap-3">
          <button
            v-if="activeType !== 'all'"
            type="button"
            @click="setTab('all')"
            class="px-4 py-2 rounded-lg bg-[#4A6741] text-white text-xs font-bold hover:bg-[#385132] transition-all cursor-pointer border-none"
          >
            Xem tất cả chuyên mục
          </button>
          <button
            type="button"
            @click="inputQuery = ''; inputFocus()"
            class="px-4 py-2 rounded-lg border border-[#D5E1D3] bg-white text-[#4A5545] text-xs font-bold hover:bg-[#F2F7F0] transition-all cursor-pointer"
          >
            Nhập từ khóa mới
          </button>
        </div>
      </div>

      <!-- Results List -->
      <div v-else class="space-y-4">
        <article
          v-for="item in searchData.items"
          :key="item.id"
          class="group bg-white rounded-xl border border-[#E2E8DF] shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_20px_rgba(74,103,65,0.1)] hover:border-[#7CB342] transition-all p-4 sm:p-5 flex flex-col sm:flex-row gap-4 sm:gap-5"
        >
          <!-- Thumbnail (if any) -->
          <nuxt-link
            v-if="item.thumbnailUrl"
            :to="item.url"
            class="block w-full sm:w-40 md:w-48 aspect-video bg-[#EEF4EC] rounded-lg overflow-hidden shrink-0 no-underline"
          >
            <img
              :src="item.thumbnailUrl"
              :alt="item.title"
              class="w-full h-full object-cover object-center transition-transform duration-500 ease-out group-hover:scale-105"
              loading="lazy"
              decoding="async"
            />
          </nuxt-link>

          <!-- Content Details -->
          <div class="flex flex-col justify-between flex-1 min-w-0">
            <div>
              <div class="flex items-center gap-2 mb-2 flex-wrap">
                <!-- Type Badge -->
                <span :class="['inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[0.7rem] font-extrabold uppercase tracking-wider', item.typeBadgeClass]">
                  <i :class="item.typeIcon" class="text-[0.65rem]" aria-hidden="true"></i>
                  <span>{{ item.typeLabel }}</span>
                </span>

                <!-- Category Name -->
                <span v-if="item.categoryName" class="text-xs text-[#556653] font-semibold">
                  {{ item.categoryName }}
                </span>

                <!-- Published Date -->
                <span v-if="item.publishedAt" class="text-xs text-[#889985] flex items-center gap-1 font-medium">
                  <i class="fa-regular fa-calendar-days text-[0.7rem]" aria-hidden="true"></i>
                  <span>{{ formatDate(item.publishedAt) }}</span>
                </span>
              </div>

              <!-- Title -->
              <h3 class="text-base sm:text-[1.1rem] font-bold text-[#172516] group-hover:text-[#2D5A27] transition-colors leading-snug m-0 mb-2">
                <nuxt-link :to="item.url" class="text-[#172516] hover:text-[#2D5A27] no-underline">
                  {{ item.title }}
                </nuxt-link>
              </h3>

              <!-- Excerpt -->
              <p v-if="item.excerpt" class="text-[0.88rem] text-[#556450] leading-relaxed line-clamp-2 m-0 mb-3">
                {{ item.excerpt }}
              </p>
            </div>

            <!-- Bottom link -->
            <div class="pt-2.5 border-t border-[#F5F8F4] flex items-center justify-between text-xs">
              <nuxt-link
                :to="item.url"
                class="inline-flex items-center gap-1.5 font-extrabold text-[#385932] hover:text-[#1B3617] transition-all no-underline group/link"
              >
                <span>Xem chi tiết</span>
                <i class="fa-solid fa-arrow-right text-[0.68rem] transition-transform duration-200 group-hover/link:translate-x-1" aria-hidden="true"></i>
              </nuxt-link>
              <span class="text-[#8E9F8B] font-medium text-[0.75rem]">Cổng thông tin C11</span>
            </div>
          </div>
        </article>

        <!-- Pagination -->
        <nav
          v-if="searchData.pagination && searchData.pagination.totalPages > 1"
          aria-label="Phân trang kết quả tìm kiếm"
          class="flex flex-col sm:flex-row items-center justify-between gap-4 mt-8 pt-6 border-t border-[#DDE6DC]"
        >
          <div class="text-xs text-[#6F7F6C] font-medium">
            Trang <strong>{{ currentPage }}</strong> trên tổng số <strong>{{ searchData.pagination.totalPages }}</strong> trang
          </div>

          <div class="flex items-center gap-1.5 flex-wrap justify-center">
            <button
              type="button"
              class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#D5E1D3] bg-white text-[#4A5545] text-xs font-bold cursor-pointer transition-all hover:border-[#4A6741] hover:text-[#4A6741] disabled:opacity-30 disabled:cursor-not-allowed"
              :disabled="currentPage <= 1"
              @click="setPage(currentPage - 1)"
              aria-label="Trang trước"
            >
              <i class="fa-solid fa-chevron-left text-[0.7rem]" aria-hidden="true"></i>
            </button>

            <button
              v-for="p in searchData.pagination.totalPages"
              :key="p"
              type="button"
              :class="[
                'inline-flex items-center justify-center min-w-9 h-9 px-2.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all',
                currentPage === p
                  ? 'bg-[#4A6741] text-white border border-[#4A6741] shadow-sm'
                  : 'bg-white border border-[#D5E1D3] text-[#4A5545] hover:border-[#4A6741] hover:text-[#4A6741]'
              ]"
              @click="setPage(p)"
            >
              {{ p }}
            </button>

            <button
              type="button"
              class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#D5E1D3] bg-white text-[#4A5545] text-xs font-bold cursor-pointer transition-all hover:border-[#4A6741] hover:text-[#4A6741] disabled:opacity-30 disabled:cursor-not-allowed"
              :disabled="currentPage >= searchData.pagination.totalPages"
              @click="setPage(currentPage + 1)"
              aria-label="Trang tiếp"
            >
              <i class="fa-solid fa-chevron-right text-[0.7rem]" aria-hidden="true"></i>
            </button>
          </div>
        </nav>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { formatDateVN } from '../utils/formatDate'

useHead({
  title: 'Tìm kiếm thông tin | Con Đường Hướng Thiện',
  meta: [
    {
      name: 'description',
      content: 'Tra cứu thông tin tin tức, tấm gương hoàn lương, mô hình tái hòa nhập và văn bản pháp luật.',
    },
  ],
})

const route = useRoute()
const router = useRouter()

const searchQuery = computed(() => String(route.query.q || '').trim())
const activeType = computed(() => String(route.query.type || 'all').trim().toLowerCase())
const currentPage = computed(() => {
  const p = Number(route.query.page || 1)
  return Number.isFinite(p) && p > 0 ? p : 1
})

const inputQuery = ref(searchQuery.value)

watch(searchQuery, (newVal) => {
  inputQuery.value = newVal
})

const filterTabs = [
  { key: 'all', label: 'Tất cả', icon: 'fa-solid fa-layer-group' },
  { key: 'news', label: 'Bản tin', icon: 'fa-solid fa-newspaper' },
  { key: 'role_model', label: 'Tấm gương', icon: 'fa-solid fa-award' },
  { key: 'reintegration_model', label: 'Mô hình', icon: 'fa-solid fa-people-group' },
  { key: 'document', label: 'Văn bản', icon: 'fa-solid fa-file-lines' },
  { key: 'faq', label: 'Giải đáp', icon: 'fa-solid fa-circle-question' },
  { key: 'qa', label: 'Hỏi – Đáp', icon: 'fa-solid fa-comments' },
  { key: 'page', label: 'Trang', icon: 'fa-solid fa-file-invoice' },
]

const { data: searchData, pending, error, refresh } = await useFetch('/api/public/search', {
  query: computed(() => ({
    q: searchQuery.value,
    type: activeType.value,
    page: currentPage.value,
    limit: 10,
  })),
  watch: [searchQuery, activeType, currentPage],
})

const getCountForTab = (tabKey: string) => {
  if (!searchData.value?.counts) return 0
  const counts = searchData.value.counts as Record<string, number>
  return counts[tabKey] ?? 0
}

const onFormSubmit = () => {
  const q = inputQuery.value.trim()
  router.push({
    path: '/search',
    query: {
      q: q || undefined,
      type: activeType.value !== 'all' ? activeType.value : undefined,
      page: 1,
    },
  })
}

const setTab = (type: string) => {
  router.push({
    path: '/search',
    query: {
      ...route.query,
      type: type !== 'all' ? type : undefined,
      page: 1,
    },
  })
}

const setPage = (page: number) => {
  router.push({
    path: '/search',
    query: {
      ...route.query,
      page,
    },
  })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

const quickSearch = (keyword: string) => {
  inputQuery.value = keyword
  onFormSubmit()
}

const inputFocus = () => {
  const inputEl = document.querySelector('input[type="text"]') as HTMLInputElement | null
  if (inputEl) inputEl.focus()
}

const formatDate = (dateStr: string | null) => {
  return dateStr ? formatDateVN(dateStr) : ''
}
</script>
