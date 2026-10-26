<template>
  <div class="bg-surface">
    <PageHero>
      <nav aria-label="Đường dẫn trang" class="flex items-center gap-2 text-xs text-[#6B7967] mb-3">
        <nuxt-link to="/" class="hover:text-[#385932] transition-colors flex items-center gap-1.5 no-underline text-[#556450]">
          <i class="fa-solid fa-house text-[0.7rem] text-brand-600" aria-hidden="true"></i>
          <span>{{ t('home') }}</span>
        </nuxt-link>
        <span class="text-[#A2B09F]" aria-hidden="true">&rsaquo;</span>
        <span class="text-[#2A3B27] font-bold">{{ t('documents') }}</span>
      </nav>

      <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#E4EEE2] border border-[#D0DFCE] text-[#365730] text-[0.72rem] font-extrabold uppercase tracking-wider mb-2.5 shadow-sm">
        <span class="w-2 h-2 rounded-full bg-brand-600 animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
        <span>{{ t('documents_library') }}</span>
      </div>
      <h1 class="text-2xl sm:text-3xl lg:text-[2.2rem] font-black text-[#172516] tracking-tight leading-[1.2] m-0">{{ t('documents_title') }}</h1>
      <p class="text-[0.92rem] sm:text-base text-[#576653] mt-2 mb-0 leading-relaxed max-w-3xl">
        Tra cứu các chỉ thị, nghị định của Chính phủ và thông tư của Bộ Công an về công tác thi hành án hình sự, hỗ trợ tái hòa nhập cộng đồng.
      </p>
    </PageHero>

    <!-- Filter chips: tách khỏi hero, nằm trong phần nội dung bên dưới -->
    <section class="pt-6 lg:pt-8">
      <div class="container">
        <div class="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <span class="text-xs text-[#5A6C58] font-medium shrink-0 mr-1">{{ t('quick_search') }}</span>
          <button
            v-for="chip in filterChips"
            :key="chip"
            type="button"
            @click="setQuickChip(chip)"
            :class="[
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border shrink-0 cursor-pointer',
              searchQuery === chip
                ? 'bg-brand-600 text-white border-[#4A6741] shadow-sm'
                : 'bg-white text-ink-secondary border-[#DCE5DB] hover:border-brand-600 hover:bg-[#F2F7F0]'
            ]"
          >
            <span>{{ chip }}</span>
          </button>
        </div>
      </div>
    </section>

    <!-- Main Content -->
    <section class="py-8 lg:py-10">
      <div class="container grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px] lg:gap-10 items-start">
        <!-- Cột chính -->
        <div class="flex flex-col gap-6 min-w-0">
          <!-- Search Bar -->
          <form class="flex flex-col sm:flex-row gap-3 bg-white p-2 rounded-xl border border-[#D5E1D3] shadow-sm focus-within:border-brand-600 transition-all" @submit.prevent="applySearch">
            <label class="sr-only" for="doc-search">Tìm kiếm văn bản</label>
            <div class="relative flex-1 flex items-center pl-3">
              <i class="fa-solid fa-magnifying-glass text-[#5A6C58] text-sm mr-2.5" aria-hidden="true"></i>
              <input
                id="doc-search"
                v-model="searchInput"
                type="search"
                :placeholder="t('doc_search_placeholder')"
                class="flex-1 py-2 text-[0.95rem] text-[#172516] outline-none border-none bg-transparent font-medium placeholder:text-[#9AABA0]"
              />
              <button
                v-if="searchInput"
                type="button"
                @click="clearSearch"
                class="text-[#8A9A88] hover:text-[#2D5A27] w-7 h-7 rounded-lg flex items-center justify-center text-xs cursor-pointer border-none bg-transparent mr-1"
                aria-label="Xóa từ khóa"
              >
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
              </button>
            </div>
            <button
              type="submit"
              class="bg-brand-600 hover:bg-[#385132] text-white px-6 py-2.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all border-none flex items-center justify-center gap-1.5 shadow-sm shrink-0"
            >
              <span>{{ t('search_btn') }}</span>
              <i class="fa-solid fa-arrow-right text-[0.7rem]" aria-hidden="true"></i>
            </button>
          </form>

          <!-- Section Divider Header -->
          <div class="flex items-center justify-between pt-1 pb-3 border-b-2 border-[#E1EADF]">
            <div class="flex items-center gap-2.5">
              <span class="w-2.5 h-6 rounded-sm bg-brand-600" aria-hidden="true"></span>
              <h2 class="text-base sm:text-lg font-black text-[#1A2A17] tracking-tight uppercase m-0">
                Danh sách văn bản
              </h2>
              <span v-if="!pending" class="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-[#EBF3E8] text-[#385932]">
                {{ pagination.total || docs.length }} văn bản
              </span>
            </div>
            <span v-if="pagination.totalPages > 1" class="text-xs text-[#5A6C58] font-medium hidden sm:inline">
              Trang {{ pagination.page }} / {{ pagination.totalPages }}
            </span>
          </div>

          <!-- Loading Skeleton -->
          <div v-if="pending" role="status" aria-busy="true" class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <span class="sr-only">Đang tải danh sách văn bản</span>
            <div
              v-for="n in 6"
              :key="n"
              aria-hidden="true"
              class="bg-white rounded-2xl border border-[#E2E8DF] shadow-sm p-5 sm:p-6 flex flex-col gap-3 animate-pulse motion-reduce:animate-none"
            >
              <div class="h-4 w-28 bg-[#EEF2EC] rounded"></div>
              <div class="h-5 w-4/5 bg-[#EEF2EC] rounded"></div>
              <div class="h-3.5 w-full bg-[#EEF2EC] rounded"></div>
              <div class="h-3.5 w-2/3 bg-[#EEF2EC] rounded"></div>
            </div>
          </div>

          <!-- Error -->
          <div
            v-else-if="loadError"
            role="alert"
            class="bg-white border-2 border-dashed border-[#F0B8B8] px-6 py-12 rounded-2xl text-center text-[#B04A4A] shadow-sm"
          >
            <div class="w-12 h-12 rounded-full bg-[#FCE8E8] text-[#C62828] flex items-center justify-center mx-auto mb-3 text-lg">
              <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            </div>
            <h3 class="text-base font-extrabold text-[#992222] m-0 mb-1">Không thể tải văn bản</h3>
            <p class="text-sm text-ink-muted m-0 mb-4">Đã xảy ra lỗi khi kết nối dữ liệu. Vui lòng kiểm tra lại kết nối mạng.</p>
            <button
              type="button"
              class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-xs font-bold hover:bg-[#385132] transition-all cursor-pointer border-none"
              @click="() => refresh()"
            >
              <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
              <span>Thử lại</span>
            </button>
          </div>

          <!-- Empty -->
          <div
            v-else-if="docs.length === 0"
            class="bg-white border border-[#E2E8DF] rounded-2xl p-10 text-center shadow-sm"
          >
            <div class="w-16 h-16 rounded-full bg-[#EBF3E8] text-brand-600 flex items-center justify-center mx-auto mb-4 text-2xl">
              <i class="fa-solid fa-file-circle-question" aria-hidden="true"></i>
            </div>
            <template v-if="pageOutOfRange">
              <!-- `?page=` vượt trang cuối (link cũ, gõ tay): không phải "không có văn
                   bản" — đưa người đọc về trang đầu thay vì để kẹt ở một trang trắng. -->
              <p class="text-sm text-[#556450] m-0 mb-4">{{ t('list_page_out_of_range').replace('{total}', String(pagination.totalPages)) }}</p>
              <button
                type="button"
                class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-xs font-bold hover:bg-[#385132] transition-all cursor-pointer border-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                @click="goFirstPage"
              >
                <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                <span>{{ t('list_back_first_page') }}</span>
              </button>
            </template>
            <template v-else>
              <h3 class="text-lg font-extrabold text-[#172516] m-0 mb-2">{{ t('no_docs_found') }}</h3>
              <p class="text-sm text-[#556450] m-0 mb-5">
                Không có văn bản nào khớp với từ khóa &laquo;<strong>{{ searchQuery }}</strong>&raquo;.
              </p>
              <button
                type="button"
                @click="clearSearch"
                class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-xs font-bold hover:bg-[#385132] transition-all cursor-pointer border-none"
              >
                <i class="fa-solid fa-rotate-left text-xs" aria-hidden="true"></i>
                <span>{{ t('view_all_docs') }}</span>
              </button>
            </template>
          </div>

          <!-- Document Cards Grid -->
          <template v-else>
            <div :class="articleGridClass">
              <article
                v-for="doc in docs"
                :key="doc.id"
                class="group bg-white rounded-2xl border border-[#E2E8DF] shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_10px_24px_rgba(74,103,65,0.12)] hover:border-[#7CB342] transition-all duration-300 flex flex-col hover:-translate-y-1 h-full overflow-hidden"
              >
                <!-- Thumbnail: strictly 16:9 like news cards -->
                <nuxt-link :to="`/news/${doc.slug}`" class="block relative w-full aspect-video overflow-hidden bg-[#EEF4EC] no-underline shrink-0">
                  <SafeImg
                    :src="doc.thumbnailUrl || '/assets/hero_banner.jpg'"
                    :alt="doc.title" img-class="w-full h-full aspect-video object-cover object-center transition-transform duration-500 ease-out group-hover:scale-105"
                    loading="lazy"
                    decoding="async"
                    sizes="256px sm:384px lg:512px"
                  />
                  <div class="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                </nuxt-link>

                <!-- Content: flex-1 justify-between -->
                <div class="p-4 sm:p-5 flex flex-col flex-1">
                  <div class="flex items-center gap-2 mb-2 flex-wrap text-xs">
                    <span class="inline-block bg-[#EEF4EC] text-[#2D5A27] text-[0.68rem] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                      {{ doc.categoryName || 'Văn bản quy phạm' }}
                    </span>
                    <span class="text-[#5a6c58] text-[0.75rem] flex items-center gap-1 font-medium">
                      <i class="fa-regular fa-calendar-days text-[0.72rem]"></i>
                      <span>Ban hành: {{ formatDate(doc) }}</span>
                    </span>
                  </div>

                  <!-- Title (line-clamp-2 min-h) -->
                  <h3 class="text-[0.95rem] sm:text-[0.98rem] font-bold leading-snug text-[#172516] group-hover:text-[#2D5A27] transition-colors line-clamp-2 min-h-[2.6rem] mb-2 m-0">
                    <nuxt-link :to="`/news/${doc.slug}`" class="text-[#172516] hover:text-[#2D5A27] no-underline">
                      {{ doc.title }}
                    </nuxt-link>
                  </h3>

                  <!-- Excerpt (line-clamp-2) -->
                  <p v-if="doc.excerpt" class="text-[0.84rem] text-[#556450] leading-relaxed line-clamp-2 mb-3 m-0">
                    {{ cleanExcerpt(doc.excerpt) }}
                  </p>

                  <!-- Footer Action pinned with mt-auto -->
                  <div class="mt-auto pt-3 border-t border-[#F0F5EE] flex items-center justify-between text-xs text-[#5A6C58]">
                    <nuxt-link
                      :to="`/news/${doc.slug}`"
                      class="inline-flex items-center gap-1.5 font-bold text-[#385932] hover:text-[#1B3617] group-hover:translate-x-0.5 transition-all no-underline"
                    >
                      <span>{{ t('view_details') }}</span>
                      <i class="fa-solid fa-arrow-right text-[0.68rem] transition-transform duration-200 group-hover:translate-x-0.5"></i>
                    </nuxt-link>
                    <span class="text-[#6B7B68] font-medium text-[0.72rem]">Cục C11</span>
                  </div>
                </div>
              </article>
            </div>

            <!-- Pagination -->
            <nav v-if="pagination.total > 0" class="mt-8 pt-6 border-t border-[#DDE6DC] flex flex-col sm:flex-row items-center justify-between gap-4" aria-label="Phân trang văn bản">
              <div class="text-xs text-[#6F7F6C] font-medium">
                Trang <strong>{{ currentPage }}</strong> trên tổng số <strong>{{ pagination.totalPages }}</strong> trang
              </div>

              <div class="flex items-center gap-1.5 flex-wrap justify-center">
                <button
                  type="button"
                  class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#D5E1D3] bg-white text-ink-secondary text-xs font-bold cursor-pointer transition-all hover:border-brand-600 hover:text-brand-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  :disabled="currentPage <= 1 || pending"
                  @click="setPage(currentPage - 1)"
                  aria-label="Trang trước"
                >
                  <i class="fa-solid fa-chevron-left text-[0.7rem]" aria-hidden="true"></i>
                </button>

                <template v-for="(p, idx) in pageRange" :key="p">
                  <span v-if="idx > 0 && p - (pageRange[idx - 1] ?? p) > 1" class="text-[#8C9C88] text-xs px-1 select-none font-bold" aria-hidden="true">&hellip;</span>
                  <button
                    type="button"
                    :class="[
                      'inline-flex items-center justify-center min-w-9 h-9 px-2.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all',
                      currentPage === p
                        ? 'bg-brand-600 text-white border border-[#4A6741] shadow-sm'
                        : 'bg-white border border-[#D5E1D3] text-ink-secondary hover:border-brand-600 hover:text-brand-600'
                    ]"
                    :aria-current="currentPage === p ? 'page' : undefined"
                    @click="setPage(p)"
                  >
                    {{ p }}
                  </button>
                </template>

                <button
                  type="button"
                  class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#D5E1D3] bg-white text-ink-secondary text-xs font-bold cursor-pointer transition-all hover:border-brand-600 hover:text-brand-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  :disabled="currentPage >= pagination.totalPages || pending"
                  @click="setPage(currentPage + 1)"
                  aria-label="Trang tiếp"
                >
                  <i class="fa-solid fa-chevron-right text-[0.7rem]" aria-hidden="true"></i>
                </button>
              </div>
            </nav>
          </template>
        </div>

        <!-- Cột phải Sidebar -->
        <aside class="flex flex-col gap-6 lg:sticky lg:top-[90px] min-w-0">
          <!-- Widget 1: Tra cứu nhanh -->
          <div class="bg-white rounded-2xl border border-[#E2E8DF] shadow-sm p-5">
            <h3 class="text-[0.8rem] font-extrabold text-brand-600 uppercase tracking-[0.6px] pb-2 mb-3 border-b-2 border-[#E2E8DF] m-0">Tra cứu nhanh</h3>
            <ul class="list-none p-0 m-0 flex flex-col">
              <li v-for="link in quickLinks" :key="link.to" class="border-b border-[#F0F5EE] last:border-b-0">
                <nuxt-link
                  :to="link.to"
                  class="flex items-start gap-3 py-3 no-underline text-ink transition-colors duration-200 hover:text-[#2D5A27] group"
                >
                  <div class="w-7 h-7 rounded-lg bg-[#EBF3E8] text-[#2D5A27] flex items-center justify-center text-xs shrink-0 mt-0.5 transition-colors group-hover:bg-brand-600 group-hover:text-white">
                    <i :class="link.icon" aria-hidden="true"></i>
                  </div>
                  <span class="min-w-0 flex-1">
                    <span class="block text-[0.88rem] font-bold leading-snug">{{ link.title }}</span>
                    <span class="block text-[0.75rem] text-[#5A6C58] leading-relaxed mt-0.5">{{ link.description }}</span>
                  </span>
                </nuxt-link>
              </li>
            </ul>
          </div>

          <!-- Widget 2: Trợ lý ảo tư vấn -->
          <div class="bg-gradient-to-br from-[#2D5A27] to-[#1E3E1A] rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
            <div class="absolute -right-4 -bottom-6 text-white/5 text-8xl pointer-events-none">
              <i class="fa-solid fa-scale-balanced" aria-hidden="true"></i>
            </div>
            <div class="relative z-10">
              <span class="inline-block px-2.5 py-0.5 rounded-full bg-white/15 text-[#A5D6A7] text-[0.68rem] font-extrabold uppercase tracking-wider mb-3">
                Giải đáp quy định
              </span>
              <h3 class="text-lg font-black leading-tight mb-2 m-0 text-white">
                Cần hướng dẫn thủ tục pháp lý?
              </h3>
              <p class="text-xs text-white/80 leading-relaxed mb-4 m-0">
                Liên hệ Công an xã/phường nơi cư trú hoặc hỏi Trợ lý ảo để được chỉ dẫn quy định theo từng trường hợp cụ thể.
              </p>
              <nuxt-link
                to="/assistant"
                class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#4a7c1e] hover:bg-[#3d6b15] text-white font-extrabold text-xs transition-all no-underline shadow-sm"
              >
                <i class="fa-solid fa-comments" aria-hidden="true"></i>
                <span>Hỏi Trợ lý ảo ngay</span>
              </nuxt-link>
            </div>
          </div>
        </aside>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { formatDateVN } from '~/utils/formatDate'
import { cleanExcerpt } from '~/utils/article-excerpt'
import { useI18n } from '~/composables/useI18n'
import { useLayoutConfig } from '~/composables/useLayoutConfig'
import { usePublicArticleList } from '~/composables/usePublicArticleList'

const { t, currentLang } = useI18n()
const { articleGridClass } = useLayoutConfig()
useSeoMeta({
  title: 'Văn bản pháp luật | Con Đường Hướng Thiện',
  description: 'Tra cứu văn bản quy phạm pháp luật về thi hành án hình sự, chính sách tín dụng và tái hòa nhập cộng đồng.',
})

const filterChips = ['Nghị định 49/2020', 'Quyết định 22/2023', 'Vay vốn', 'Học nghề', 'Xóa án tích']

// Trạng thái đọc từ URL, khoá fetch dẫn xuất từ query (xem usePublicArticleList).
const {
  currentPage,
  searchQuery,
  searchInput,
  articles: docs,
  pagination,
  pageRange,
  pageOutOfRange,
  pending,
  loadError,
  refresh,
  setPage,
  goFirstPage,
  applySearch,
  clearSearch,
} = usePublicArticleList({
  type: 'document',
  perPage: 3,
  lang: currentLang,
  pathFor: () => '/documents',
  scrollTargetId: 'doc-search',
})

const quickLinks = [
  { to: '/qa-documents', icon: 'fa-solid fa-book-open', title: 'Tài liệu Hỏi – Đáp', description: 'Nội dung đã được Cục C11 phê duyệt' },
  { to: '/legal-qa', icon: 'fa-solid fa-circle-question', title: 'Giải đáp pháp luật', description: 'Câu hỏi thường gặp theo từng thủ tục' },
  { to: '/reintegration-models', icon: 'fa-solid fa-people-group', title: 'Mô hình tái hòa nhập', description: 'Quỹ vốn, học nghề, liên kết việc làm' },
  { to: '/contact', icon: 'fa-solid fa-headset', title: 'Đăng ký tư vấn 24/7', description: 'Gửi yêu cầu để cán bộ liên hệ lại' },
]

const setQuickChip = (chip: string) => {
  if (searchQuery.value === chip) {
    clearSearch()
  } else {
    searchInput.value = chip
    applySearch()
  }
}

const formatDate = (item: { publishedAt?: string | null; createdAt?: string | null }) =>
  formatDateVN(item.publishedAt || item.createdAt)
</script>
