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
  <div class="bg-surface">
    <!-- Hero: buổi phát trực tiếp nếu đang có, ngược lại là hero mặc định. Tự hỏi
         trạng thái sau mount — xem `LiveHero.vue` cho lý do đầy đủ. -->
    <LiveHero />

    <section class="py-8 lg:py-10">
      <div class="container">
        <!-- Bộ lọc. `@submit.prevent` vì đây là một form: bấm Enter trong ô tìm
             kiếm phải lọc, và một lượt submit thật sẽ tải lại cả trang. -->
        <form
          class="flex flex-col lg:flex-row gap-3 bg-white p-2 rounded-xl border border-[#D5E1D3] shadow-sm focus-within:border-brand-600 transition-all"
          @submit.prevent="applySearch"
        >
          <label class="sr-only" for="media-search">{{ t('m_search_aria') }}</label>
          <div class="relative flex-1 flex items-center pl-3">
            <i class="fa-solid fa-magnifying-glass text-ink-soft text-sm mr-2.5" aria-hidden="true"></i>
            <input
              id="media-search"
              v-model="searchInput"
              type="search"
              :placeholder="t('m_search_placeholder')"
              class="flex-1 py-2 text-[0.95rem] text-ink-strong outline-none border-none bg-transparent font-medium placeholder:text-[#9AABA0]"
            />
            <button
              v-if="searchInput"
              type="button"
              class="text-ink-faint hover:text-[#2D5A27] w-7 h-7 rounded-lg flex items-center justify-center text-xs cursor-pointer border-none bg-transparent mr-1"
              :aria-label="t('m_clear_search')"
              @click="clearSearch"
            >
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </div>

          <label class="sr-only" for="media-category">{{ t('m_category_aria') }}</label>
          <select
            id="media-category"
            :value="categoryFilter"
            class="lg:w-56 px-3 py-2 rounded-lg border border-line bg-white text-[0.9rem] font-semibold text-[#3A4638] cursor-pointer outline-none focus:border-brand-600"
            @change="applyCategory(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('m_all_categories') }}</option>
            <option v-for="entry in categories" :key="entry.slug" :value="entry.slug">
              {{ entry.name }} ({{ entry.count }})
            </option>
          </select>

          <button
            type="submit"
            class="bg-brand-600 hover:bg-brand-800 text-white px-6 py-2.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all border-none flex items-center justify-center gap-1.5 shadow-sm shrink-0"
          >
            <span>{{ t('m_search_btn') }}</span>
            <i class="fa-solid fa-arrow-right text-[0.7rem]" aria-hidden="true"></i>
          </button>
        </form>

        <div class="flex items-center justify-between pt-5 pb-3 border-b-2 border-line mt-6">
          <div class="flex items-center gap-2.5">
            <span class="w-2.5 h-6 rounded-sm bg-brand-600" aria-hidden="true"></span>
            <h2 class="text-base sm:text-lg font-black text-[#1A2A17] tracking-tight uppercase m-0">
              {{ t('m_list_title') }}
            </h2>
            <span v-if="!pending && !loadError" class="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-line text-brand-800">
              {{ t('m_count_suffix').replace('{n}', String(pagination.total)) }}
            </span>
          </div>
          <span v-if="pagination.totalPages > 1" class="text-xs text-ink-soft font-medium hidden sm:inline">
            {{ t('m_page_of').replace('{current}', String(pagination.page)).replace('{total}', String(pagination.totalPages)) }}
          </span>
        </div>

        <!-- 1. Đang tải -->
        <div
          v-if="pending"
          role="status"
          aria-busy="true"
          class="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          <span class="sr-only">{{ t('m_loading') }}</span>
          <div
            v-for="n in 6"
            :key="n"
            aria-hidden="true"
            class="bg-white rounded-2xl border border-line shadow-sm overflow-hidden animate-pulse motion-reduce:animate-none"
          >
            <div class="w-full aspect-video bg-surface-tint"></div>
            <div class="p-4 flex flex-col gap-2.5">
              <div class="h-4 w-4/5 bg-surface-tint rounded"></div>
              <div class="h-3 w-1/3 bg-surface-tint rounded"></div>
            </div>
          </div>
        </div>

        <!-- 2. Lỗi -->
        <div
          v-else-if="loadError"
          role="alert"
          class="mt-6 bg-white border-2 border-dashed border-[#F0B8B8] px-6 py-12 rounded-2xl text-center shadow-sm"
        >
          <div class="w-12 h-12 rounded-full bg-danger-bg text-[#C62828] flex items-center justify-center mx-auto mb-3 text-lg">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          </div>
          <h3 class="text-base font-extrabold text-[#992222] m-0 mb-1">{{ t('m_error_title') }}</h3>
          <p class="text-sm text-ink-muted m-0 mb-4">{{ t('m_error_desc') }}</p>
          <button
            type="button"
            class="bg-brand-600 hover:bg-brand-800 text-white px-6 py-2.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all border-none inline-flex items-center gap-2"
            @click="reload"
          >
            <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
            <span>{{ t('m_retry') }}</span>
          </button>
        </div>

        <!-- 3. Rỗng. Phân biệt được với lỗi: máy chủ đã trả `ok: true`. -->
        <div v-else-if="!items.length" class="mt-6 bg-white border border-line rounded-2xl px-6 py-14 text-center shadow-sm">
          <div class="w-14 h-14 rounded-full bg-surface-tint text-brand-600 flex items-center justify-center mx-auto mb-4 text-xl">
            <i class="fa-solid fa-clapperboard" aria-hidden="true"></i>
          </div>
          <!-- `?page=` vượt trang cuối (link cũ, gõ tay): thư viện CÓ video, chỉ là
               trang này trống — đưa về trang đầu thay vì báo "chưa có video". -->
          <template v-if="pageOutOfRange">
            <p class="text-sm text-[#5A6655] m-0 mb-5 max-w-md mx-auto">
              {{ t('list_page_out_of_range').replace('{total}', String(pagination.totalPages)) }}
            </p>
            <button
              type="button"
              class="bg-brand-600 hover:bg-brand-800 text-white px-6 py-2.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all border-none inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              @click="goFirstPage"
            >
              <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
              <span>{{ t('list_back_first_page') }}</span>
            </button>
          </template>
          <template v-else>
          <h3 class="text-base font-extrabold text-ink m-0 mb-1">
            {{ hasFilters ? t('m_empty_filtered_title') : t('m_empty_updating') }}
          </h3>
          <p class="text-sm text-[#5A6655] m-0 mb-5 max-w-md mx-auto">
            {{ hasFilters ? t('m_empty_filtered_desc') : t('m_empty_nofilter_desc') }}
          </p>
          <button
            v-if="hasFilters"
            type="button"
            class="bg-brand-600 hover:bg-brand-800 text-white px-6 py-2.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all border-none inline-flex items-center gap-2"
            @click="clearSearch"
          >
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            <span>{{ t('m_clear_filter') }}</span>
          </button>
          </template>
        </div>

        <!-- 4. Có dữ liệu -->
        <template v-else>
          <ul class="mt-6 list-none m-0 p-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <li v-for="entry in items" :key="entry.id">
              <nuxt-link
                :to="`/media/${entry.shortId}`"
                class="group flex flex-col h-full bg-white rounded-2xl border border-line shadow-sm overflow-hidden no-underline transition-all hover:border-brand-600 hover:shadow-md"
              >
                <span class="relative block w-full aspect-video bg-surface-tint overflow-hidden">
                  <!-- Ảnh thu nhỏ luôn đến từ **chính cổng này** (`/api/public/media/<slug>/thumb`),
                       kể cả với video nguồn ngoài — không hot-link máy chủ ảnh của YouTube
                       (`YOUTUBE_THUMBNAIL_HOST`, `server/utils/youtube-parser.ts`). -->
                  <img
                    v-if="entry.thumbnailUrl"
                    :src="entry.thumbnailUrl"
                    :alt="entry.title"
                    loading="lazy"
                    class="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <span
                    v-else
                    class="absolute inset-0 flex items-center justify-center text-ink-faint text-2xl"
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
                    class="inline-flex items-center gap-1.5 text-[0.68rem] font-extrabold uppercase tracking-wide text-brand-600"
                  >
                    <i class="fa-solid fa-tag text-[0.6rem]" aria-hidden="true"></i>
                    {{ entry.categoryName }}
                  </span>
                  <span class="text-[0.95rem] font-bold text-ink leading-snug line-clamp-2 group-hover:text-brand-600 transition-colors">
                    {{ entry.title }}
                  </span>
                  <span class="mt-auto text-[0.7rem] text-ink-faint inline-flex items-center gap-1.5">
                    <i class="fa-regular fa-eye" aria-hidden="true"></i>
                    {{ t('m_views_count').replace('{n}', String(entry.viewCount)) }}
                  </span>
                </span>
              </nuxt-link>
            </li>
          </ul>

          <!-- Phân trang -->
          <nav
            v-if="pagination.totalPages > 1"
            class="mt-8 pt-6 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-4"
            aria-label="pagination"
          >
            <span class="text-xs text-ink-soft">
              {{ t('m_pagination_summary').replace('{current}', String(pagination.page)).replace('{total}', String(pagination.totalPages)) }}
            </span>

            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="w-9 h-9 rounded-lg border border-line bg-white text-ink-secondary flex items-center justify-center cursor-pointer transition-all hover:border-brand-600 hover:bg-surface-tint disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="pagination.page <= 1 || pending"
                :aria-label="t('page_prev')"
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
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-ink-secondary border-line hover:border-brand-600 hover:bg-surface-tint',
                ]"
                :aria-current="page === pagination.page ? 'page' : undefined"
                :aria-label="t('m_page_aria').replace('{n}', String(page))"
                @click="setPage(page)"
              >
                {{ page }}
              </button>

              <button
                type="button"
                class="w-9 h-9 rounded-lg border border-line bg-white text-ink-secondary flex items-center justify-center cursor-pointer transition-all hover:border-brand-600 hover:bg-surface-tint disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="pagination.page >= pagination.totalPages || pending"
                :aria-label="t('page_next')"
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
import { formatMediaDuration } from '~/utils/media-duration'
import { useI18n } from '~/composables/useI18n'
import { usePublicMediaList } from '~/composables/usePublicMediaList'

const { t } = useI18n()

const PER_PAGE = 12

/**
 * Trạng thái (trang, từ khoá, chuyên mục) đọc thẳng từ URL — kể cả nút Back và
 * liên kết nội bộ `/media?category=…` — và mọi hành động chỉ điều hướng: xem
 * `usePublicMediaList` cho lý do (mỗi lượt điều hướng đúng một lượt gọi API).
 * Số trang lạ (`?page=abc`, `?page=-1`) về trang 1 qua `parsePageParam`.
 */
const {
  searchInput,
  categoryFilter,
  items,
  categories,
  pagination,
  pageRange,
  pending,
  loadError,
  hasFilters,
  pageOutOfRange,
  refresh,
  applySearch,
  applyCategory,
  clearSearch,
  goFirstPage,
  setPage,
} = usePublicMediaList({ perPage: PER_PAGE, scrollTargetId: 'media-search' })

function reload() {
  // Gọi lại **chính lượt fetch đã hỏng**, không tải lại trang.
  refresh()
}

useSeoMeta({
  title: () => `${t('m_list_title')} | Con Đường Hướng Thiện`,
  description: () => t('m_seo_desc'),
  ogTitle: () => `${t('m_list_title')} | Con Đường Hướng Thiện`,
  ogDescription: () => t('m_seo_og_desc'),
  ogType: 'website',
})
</script>
