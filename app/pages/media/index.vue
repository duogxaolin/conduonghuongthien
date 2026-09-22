<!--
  Thư viện Video công khai: danh sách, lọc theo chuyên mục, tìm kiếm, phân trang.

  ## Bộ lọc nằm trong URL

  `q`, `category`, `page` đọc từ query string và ghi lại vào đó, nên một khung nhìn
  đã lọc **chia sẻ được** và sống qua F5. Cùng lối `/qa-documents` và `/documents`
  đang theo. Chuyên mục lạ trả **trang rỗng**, không trả lỗi: URL do người đọc sửa
  được, và một liên kết cũ báo lỗi đọc ra là cổng bị hỏng.

  ## Ba trạng thái phải phân biệt được

  Đang tải / lỗi / rỗng là **một hợp đồng**, không phải ba nhánh tuỳ chọn. Máy chủ
  đã tách sẵn hai nhánh sau: `ok: false` là một lượt truy vấn hỏng, còn `ok: true`
  với `items: []` là "chưa đăng gì". Gộp chúng ở đây sẽ biến "cơ sở dữ liệu đang
  hỏng" thành "cổng chưa có video nào" — và người đọc kế tiếp đi tạo lại nội dung
  đã có.

  Nút thử lại gọi lại **chính lượt fetch đã hỏng** (`refresh()`), không tải lại
  trang: `location.reload()` ném đi mọi khung khác và mọi thứ đang gõ dở.

  ## Ràng buộc `swr: 60`

  `/media` và `/media/**` phục vụ qua `swr: 60` (`nuxt.config.ts`). HTML dựng phía
  máy chủ được phát lại cho người kế tiếp trong cùng cửa sổ 60 giây, nên **không
  có gì phụ thuộc người đọc được dựng ở đây**: không danh tính, không bình luận,
  không cờ xoá. Khối hero tự hỏi trạng thái buổi phát **sau mount** vì một buổi
  phát có thể bắt đầu hoặc kết thúc bên trong cửa sổ đó.
-->
<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero: buổi phát trực tiếp nếu đang có, ngược lại là hero mặc định. Tự hỏi
         trạng thái sau mount — xem `LiveHero.vue` cho lý do đầy đủ. -->
    <LiveHero />

    <section class="py-8 lg:py-10">
      <div class="container">
        <!-- Bộ lọc. `@submit.prevent` vì đây là một form: bấm Enter trong ô tìm
             kiếm phải lọc, và một lượt submit thật sẽ tải lại cả trang. -->
        <form
          class="flex flex-col lg:flex-row gap-3 bg-white p-2 rounded-xl border border-[#D5E1D3] shadow-sm focus-within:border-[#4A6741] transition-all"
          @submit.prevent="applySearch"
        >
          <label class="sr-only" for="media-search">Tìm kiếm video</label>
          <div class="relative flex-1 flex items-center pl-3">
            <i class="fa-solid fa-magnifying-glass text-[#7A8A76] text-sm mr-2.5" aria-hidden="true"></i>
            <input
              id="media-search"
              v-model="searchInput"
              type="search"
              placeholder="Nhập từ khóa tìm kiếm video…"
              class="flex-1 py-2 text-[0.95rem] text-[#172516] outline-none border-none bg-transparent font-medium placeholder:text-[#9AABA0]"
            />
            <button
              v-if="searchInput"
              type="button"
              class="text-[#8A9A88] hover:text-[#2D5A27] w-7 h-7 rounded-lg flex items-center justify-center text-xs cursor-pointer border-none bg-transparent mr-1"
              aria-label="Xóa từ khóa"
              @click="clearSearch"
            >
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </div>

          <label class="sr-only" for="media-category">Chuyên mục</label>
          <select
            id="media-category"
            :value="categoryFilter"
            class="lg:w-56 px-3 py-2 rounded-lg border border-[#DCE5DB] bg-white text-[0.9rem] font-semibold text-[#3A4638] cursor-pointer outline-none focus:border-[#4A6741]"
            @change="applyCategory(($event.target as HTMLSelectElement).value)"
          >
            <option value="">Tất cả chuyên mục</option>
            <option v-for="entry in categories" :key="entry.slug" :value="entry.slug">
              {{ entry.name }} ({{ entry.count }})
            </option>
          </select>

          <button
            type="submit"
            class="bg-[#4A6741] hover:bg-[#385132] text-white px-6 py-2.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all border-none flex items-center justify-center gap-1.5 shadow-sm shrink-0"
          >
            <span>Tìm kiếm</span>
            <i class="fa-solid fa-arrow-right text-[0.7rem]" aria-hidden="true"></i>
          </button>
        </form>

        <div class="flex items-center justify-between pt-5 pb-3 border-b-2 border-[#E1EADF] mt-6">
          <div class="flex items-center gap-2.5">
            <span class="w-2.5 h-6 rounded-sm bg-[#4A6741]" aria-hidden="true"></span>
            <h2 class="text-base sm:text-lg font-black text-[#1A2A17] tracking-tight uppercase m-0">
              Danh sách video
            </h2>
            <span v-if="!pending && !loadError" class="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-[#EBF3E8] text-[#385932]">
              {{ pagination.total }} video
            </span>
          </div>
          <span v-if="pagination.totalPages > 1" class="text-xs text-[#7A8A76] font-medium hidden sm:inline">
            Trang {{ pagination.page }} / {{ pagination.totalPages }}
          </span>
        </div>

        <!-- 1. Đang tải -->
        <div
          v-if="pending"
          role="status"
          aria-busy="true"
          class="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          <span class="sr-only">Đang tải danh sách video</span>
          <div
            v-for="n in 6"
            :key="n"
            aria-hidden="true"
            class="bg-white rounded-2xl border border-[#E2E8DF] shadow-sm overflow-hidden animate-pulse motion-reduce:animate-none"
          >
            <div class="w-full aspect-video bg-[#EEF2EC]"></div>
            <div class="p-4 flex flex-col gap-2.5">
              <div class="h-4 w-4/5 bg-[#EEF2EC] rounded"></div>
              <div class="h-3 w-1/3 bg-[#EEF2EC] rounded"></div>
            </div>
          </div>
        </div>

        <!-- 2. Lỗi -->
        <div
          v-else-if="loadError"
          role="alert"
          class="mt-6 bg-white border-2 border-dashed border-[#F0B8B8] px-6 py-12 rounded-2xl text-center shadow-sm"
        >
          <div class="w-12 h-12 rounded-full bg-[#FCE8E8] text-[#C62828] flex items-center justify-center mx-auto mb-3 text-lg">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          </div>
          <h3 class="text-base font-extrabold text-[#992222] m-0 mb-1">Không thể tải thư viện video</h3>
          <p class="text-sm text-[#667768] m-0 mb-4">Đã xảy ra lỗi khi kết nối dữ liệu. Vui lòng kiểm tra lại kết nối mạng.</p>
          <button
            type="button"
            class="bg-[#4A6741] hover:bg-[#385132] text-white px-6 py-2.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all border-none inline-flex items-center gap-2"
            @click="reload"
          >
            <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
            <span>Thử lại</span>
          </button>
        </div>

        <!-- 3. Rỗng. Phân biệt được với lỗi: máy chủ đã trả `ok: true`. -->
        <div v-else-if="!items.length" class="mt-6 bg-white border border-[#E2E8DF] rounded-2xl px-6 py-14 text-center shadow-sm">
          <div class="w-14 h-14 rounded-full bg-[#EEF4EC] text-[#4A6741] flex items-center justify-center mx-auto mb-4 text-xl">
            <i class="fa-solid fa-clapperboard" aria-hidden="true"></i>
          </div>
          <h3 class="text-base font-extrabold text-[#1E251C] m-0 mb-1">
            {{ hasFilters ? 'Không tìm thấy video phù hợp' : 'Thư viện video đang được cập nhật' }}
          </h3>
          <p class="text-sm text-[#5A6655] m-0 mb-5 max-w-md mx-auto">
            {{ hasFilters
              ? 'Thử một từ khóa khác hoặc bỏ bộ lọc chuyên mục.'
              : 'Các video về công tác hỗ trợ tái hòa nhập cộng đồng sẽ sớm được đăng tải.' }}
          </p>
          <button
            v-if="hasFilters"
            type="button"
            class="bg-[#4A6741] hover:bg-[#385132] text-white px-6 py-2.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all border-none inline-flex items-center gap-2"
            @click="clearSearch"
          >
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            <span>Bỏ bộ lọc</span>
          </button>
        </div>

        <!-- 4. Có dữ liệu -->
        <template v-else>
          <ul class="mt-6 list-none m-0 p-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <li v-for="entry in items" :key="entry.id">
              <nuxt-link
                :to="`/media/${entry.shortId}`"
                class="group flex flex-col h-full bg-white rounded-2xl border border-[#E2E8DF] shadow-sm overflow-hidden no-underline transition-all hover:border-[#4A6741] hover:shadow-md"
              >
                <span class="relative block w-full aspect-video bg-[#EEF2EC] overflow-hidden">
                  <!-- Ảnh thu nhỏ luôn đến từ **chính cổng này** (`/api/public/media/<slug>/thumb`),
                       kể cả với video nguồn ngoài — không hot-link `i.ytimg.com`. -->
                  <img
                    v-if="entry.thumbnailUrl"
                    :src="entry.thumbnailUrl"
                    :alt="entry.title"
                    loading="lazy"
                    class="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <span
                    v-else
                    class="absolute inset-0 flex items-center justify-center text-[#8A9A88] text-2xl"
                    aria-hidden="true"
                  >
                    <i class="fa-solid fa-film"></i>
                  </span>

                  <span
                    v-if="formatMediaDuration(entry.durationSeconds)"
                    class="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/75 text-white text-[0.7rem] font-bold"
                  >
                    {{ formatMediaDuration(entry.durationSeconds) }}
                  </span>
                </span>

                <span class="flex flex-col gap-2 p-4 flex-grow">
                  <span
                    v-if="entry.categoryName"
                    class="inline-flex items-center gap-1.5 text-[0.68rem] font-extrabold uppercase tracking-wide text-[#4A6741]"
                  >
                    <i class="fa-solid fa-tag text-[0.6rem]" aria-hidden="true"></i>
                    {{ entry.categoryName }}
                  </span>
                  <span class="text-[0.95rem] font-bold text-[#1E251C] leading-snug line-clamp-2 group-hover:text-[#4A6741] transition-colors">
                    {{ entry.title }}
                  </span>
                  <span class="mt-auto text-[0.7rem] text-[#8A9A88] inline-flex items-center gap-1.5">
                    <i class="fa-regular fa-eye" aria-hidden="true"></i>
                    {{ entry.viewCount }} lượt xem
                  </span>
                </span>
              </nuxt-link>
            </li>
          </ul>

          <!-- Phân trang -->
          <nav
            v-if="pagination.totalPages > 1"
            class="mt-8 pt-6 border-t border-[#DDE6DC] flex flex-col sm:flex-row items-center justify-between gap-4"
            aria-label="Phân trang thư viện video"
          >
            <span class="text-xs text-[#7A8A76]">
              Trang <strong>{{ pagination.page }}</strong> trên tổng số <strong>{{ pagination.totalPages }}</strong> trang
            </span>

            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="w-9 h-9 rounded-lg border border-[#DCE5DB] bg-white text-[#4A5545] flex items-center justify-center cursor-pointer transition-all hover:border-[#4A6741] hover:bg-[#F2F7F0] disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="pagination.page <= 1 || pending"
                aria-label="Trang trước"
                @click="setPage(pagination.page - 1)"
              >
                <i class="fa-solid fa-chevron-left text-xs" aria-hidden="true"></i>
              </button>

              <button
                v-for="(page, index) in pageRange"
                :key="`${page}-${index}`"
                type="button"
                :class="[
                  'min-w-9 h-9 px-2 rounded-lg border text-xs font-extrabold cursor-pointer transition-all',
                  page === pagination.page
                    ? 'bg-[#4A6741] text-white border-[#4A6741]'
                    : 'bg-white text-[#4A5545] border-[#DCE5DB] hover:border-[#4A6741] hover:bg-[#F2F7F0]',
                ]"
                :aria-current="page === pagination.page ? 'page' : undefined"
                :aria-label="`Trang ${page}`"
                @click="setPage(page)"
              >
                {{ page }}
              </button>

              <button
                type="button"
                class="w-9 h-9 rounded-lg border border-[#DCE5DB] bg-white text-[#4A5545] flex items-center justify-center cursor-pointer transition-all hover:border-[#4A6741] hover:bg-[#F2F7F0] disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="pagination.page >= pagination.totalPages || pending"
                aria-label="Trang tiếp"
                @click="setPage(pagination.page + 1)"
              >
                <i class="fa-solid fa-chevron-right text-xs" aria-hidden="true"></i>
              </button>
            </div>
          </nav>
        </template>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { formatMediaDuration } from '~/utils/media-duration'
import type { MediaListPayload, PublicMediaListItem } from '~/types/public-api'

const PER_PAGE = 12

const route = useRoute()

/**
 * Số trang đọc từ URL, và **phải qua `Number.isFinite`**.
 *
 * `Math.max(1, Number('abc'))` là `NaN` — mọi so sánh với `NaN` đều `false`, nên
 * `Math.max` trả lại chính `NaN`. Giá trị đó vào query string rồi máy chủ nhận
 * `?page=NaN`, và đây đúng là lỗi mà `finitePositive()` tồn tại ở phía máy chủ để
 * chặn. Phía giao diện cũng phải chặn, vì URL do người đọc sửa được.
 */
function readPage(value: unknown): number {
  const parsed = Number(Array.isArray(value) ? value[0] : value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1
}

const currentPage = ref(readPage(route.query.page))
const searchQuery = ref(String(route.query.q ?? '').trim())
const searchInput = ref(searchQuery.value)
const categoryFilter = ref(String(route.query.category ?? '').trim())

const listQuery = computed(() => {
  const query: { page: number, limit: number, search?: string, category?: string } = {
    page: currentPage.value,
    limit: PER_PAGE,
  }
  if (searchQuery.value) query.search = searchQuery.value
  if (categoryFilter.value) query.category = categoryFilter.value
  return query
})

const { data, pending, error, refresh } = useFetch('/api/public/media', {
  query: listQuery,
  // `lazy` chỉ bỏ chặn điều hướng phía client; lượt dựng phía máy chủ vẫn chờ dữ
  // liệu, nên HTML đầu tiên và thẻ SEO không đổi. Không có nó thì khung xương bên
  // trên **không bao giờ được vẽ** — bấm một liên kết trông như bấm hụt.
  lazy: true,
  default: () => ({
    ok: true,
    items: [] as PublicMediaListItem[],
    categories: [] as MediaListPayload['categories'],
    pagination: { page: 1, limit: PER_PAGE, total: 0, totalPages: 0 },
  }),
})

const items = computed<PublicMediaListItem[]>(() => data.value?.items ?? [])
const categories = computed(() => data.value?.categories ?? [])
const pagination = computed(() => data.value?.pagination ?? { page: 1, limit: PER_PAGE, total: 0, totalPages: 0 })

/**
 * Lỗi gồm **cả** một lượt fetch hỏng lẫn một phản hồi `ok: false`.
 *
 * Máy chủ cố ý tách hai nhánh đó khỏi "thư viện rỗng" (xem `index.get.ts`), nên
 * giao diện phải đọc `ok` chứ không suy từ `items.length === 0` — nếu không, một
 * lượt truy vấn hỏng hiện ra y hệt "cổng chưa đăng gì".
 */
const loadError = computed(() => !!error.value || data.value?.ok === false)

const hasFilters = computed(() => !!searchQuery.value || !!categoryFilter.value)

function reload() {
  // Gọi lại **chính lượt fetch đã hỏng**, không tải lại trang.
  refresh()
}

/** Ghi bộ lọc vào URL để chia sẻ được và sống qua F5. */
function syncUrl() {
  const query: { q?: string, category?: string, page?: number } = {}
  if (searchQuery.value) query.q = searchQuery.value
  if (categoryFilter.value) query.category = categoryFilter.value
  if (currentPage.value > 1) query.page = currentPage.value
  navigateTo({ path: '/media', query })
}

function applySearch() {
  searchQuery.value = searchInput.value.trim()
  currentPage.value = 1
  syncUrl()
}

function applyCategory(value: string) {
  categoryFilter.value = value
  currentPage.value = 1
  syncUrl()
}

function clearSearch() {
  searchInput.value = ''
  searchQuery.value = ''
  categoryFilter.value = ''
  currentPage.value = 1
  syncUrl()
}

function setPage(page: number) {
  if (page < 1 || page > pagination.value.totalPages) return
  currentPage.value = page
  syncUrl()
  if (import.meta.client) {
    // Cuộn về đầu danh sách, không về đầu trang: người đọc vừa bấm một số trang
    // và thứ họ cần thấy là danh sách mới, không phải lại thanh hero.
    document.getElementById('media-search')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

/**
 * Dãy số trang, có dấu `…` ở giữa.
 *
 * Cùng thuật toán `/documents` đang dùng, và cố ý không tách thành một component
 * dùng chung: hai trang có hai cách đánh số khác nhau (ở kia là `pagination.page`
 * của máy chủ, ở đây cùng thế nhưng khối này còn phụ thuộc `pending` của chính
 * trang này). Một component dùng chung sẽ phải nhận cả hai qua prop và trở thành
 * một lớp chuyển tiếp không ngăn được lỗi nào.
 */
const pageRange = computed(() => {
  const total = pagination.value.totalPages
  const current = pagination.value.page
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  const pages = new Set([1, total, current, current - 1, current + 1])
  for (const page of [...pages]) if (page < 1 || page > total) pages.delete(page)
  return [...pages].sort((a, b) => a - b)
})

/**
 * Điều hướng phía client giữa hai lượt xem thư viện dùng lại chính component này,
 * nên bộ lọc phải **đọc lại từ URL** khi URL đổi vì một lý do khác — nút Back của
 * trình duyệt, hoặc một liên kết nội bộ trỏ tới `/media?category=…`.
 */
watch(() => route.query, query => {
  const page = readPage(query.page)
  const search = String(query.q ?? '').trim()
  const category = String(query.category ?? '').trim()
  if (page === currentPage.value && search === searchQuery.value && category === categoryFilter.value) return
  currentPage.value = page
  searchQuery.value = search
  searchInput.value = search
  categoryFilter.value = category
}, { deep: true })

useSeoMeta({
  title: 'Thư viện Video | Con Đường Hướng Thiện',
  description: 'Xem các phóng sự, phim tài liệu ngắn và buổi phát trực tiếp về công tác hỗ trợ tái hòa nhập cộng đồng.',
  ogTitle: 'Thư viện Video | Con Đường Hướng Thiện',
  ogDescription: 'Kênh video của Cổng thông tin hỗ trợ người hoàn lương tái hòa nhập cộng đồng.',
  ogType: 'website',
})
</script>
