<template>
  <div class="bg-[#F8FAF7]">
    <!-- Page header — gọn nhẹ trên nền sáng, không khối hero gây lướt giật (giống /news). -->
    <section class="border-b border-[#E2E8DF] bg-white">
      <div class="container pt-7 sm:pt-9 pb-5">
        <p class="text-[0.78rem] font-extrabold uppercase tracking-[1.2px] text-[#7CB342] m-0 mb-1">Mô hình</p>
        <h1 class="text-[1.65rem] sm:text-[2.05rem] font-extrabold text-[#1E251C] leading-[1.2] m-0">Mô Hình Tái Hòa Nhập Cộng Đồng</h1>
        <p class="text-[0.95rem] text-[#5A6655] mt-2 mb-5">Các mô hình kinh tế tập thể, quỹ hỗ trợ nhân văn giúp người hoàn lương ổn định cuộc sống</p>
      </div>
    </section>

    <!-- Main Content Grid — cùng nhịp lưới /news: cột trái main + cột phải 320px. -->
    <section class="py-8 lg:py-10">
      <div class="container grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-[34px] lg:items-start">
        <!-- Models Column -->
        <div class="flex flex-col gap-6 min-w-0">
          <!-- Mỏ neo cho "đổi trang cuộn lên đầu danh sách" — `setPage` cuộn tới đây. -->
          <div id="models-list-top" class="scroll-mt-[100px]"></div>

          <!-- Loading state — hình dạng khớp bố cục thật (giống /news). -->
          <div v-if="pending" role="status" aria-busy="true" class="flex flex-col gap-8">
            <span class="sr-only">Đang tải danh sách mô hình tái hòa nhập</span>
            <div aria-hidden="true" class="bg-white rounded-lg overflow-hidden border border-[#E2E8DF] shadow-sm flex flex-col sm:flex-row animate-pulse motion-reduce:animate-none">
              <div class="sm:w-[44%] shrink-0 h-[220px] sm:h-[260px] bg-[#EEF2EC]"></div>
              <div class="p-5 sm:p-6 flex flex-col gap-3 sm:w-[56%]">
                <div class="h-3 w-32 bg-[#EEF2EC] rounded"></div>
                <div class="h-5 w-4/5 bg-[#EEF2EC] rounded"></div>
                <div class="h-3 w-full bg-[#EEF2EC] rounded"></div>
                <div class="h-3 w-2/3 bg-[#EEF2EC] rounded"></div>
              </div>
            </div>
            <div aria-hidden="true" class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <div v-for="n in 4" :key="n" class="bg-white rounded-lg overflow-hidden border border-[#E2E8DF] shadow-sm animate-pulse motion-reduce:animate-none">
                <div class="aspect-video bg-[#EEF2EC]"></div>
                <div class="p-4 flex flex-col gap-3">
                  <div class="h-3 w-24 bg-[#EEF2EC] rounded"></div>
                  <div class="h-4 w-3/4 bg-[#EEF2EC] rounded"></div>
                  <div class="h-3 w-full bg-[#EEF2EC] rounded"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Error state -->
          <div
            v-else-if="loadError"
            role="alert"
            class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]"
          >
            <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
            Không thể tải danh sách mô hình. Vui lòng
            <button type="button" class="text-[#4A6741] font-bold underline" @click="refresh()">thử lại</button>.
          </div>

          <!-- Empty state -->
          <div
            v-else-if="modelsList.length === 0"
            class="bg-white border border-dashed border-[#E2E8DF] px-6 py-10 rounded-lg text-center text-[#7A8675] text-[0.95rem]"
          >
            Chưa có mô hình nào được đăng tải.
          </div>

          <template v-else>
            <!-- Mô hình chủ đạo: ảnh trái + nội dung phải (giống tin chủ đạo /news). -->
            <article v-if="featured" class="group bg-white rounded-lg overflow-hidden border border-[#E2E8DF] shadow-sm flex flex-col sm:flex-row transition-all duration-300 hover:shadow-md hover:border-[#7CB342]">
              <nuxt-link :to="`/news/${featured.slug}`" class="block overflow-hidden sm:w-[44%] shrink-0 no-underline">
                <img
                  :src="featured.thumbnailUrl || '/assets/hero_banner.jpg'"
                  :alt="featured.title"
                  class="w-full h-[220px] sm:h-full object-cover transition-transform duration-[0.6s] ease-[cubic-bezier(0.165,0.84,0.44,1)] group-hover:scale-[1.04]"
                  loading="lazy"
                  decoding="async"
                />
              </nuxt-link>
              <div class="p-5 sm:p-6 flex flex-col justify-center sm:w-[56%] min-w-0">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
                  <span class="inline-block bg-[#7CB342] text-white px-2 py-[3px] text-[0.65rem] font-extrabold rounded-sm uppercase tracking-[0.4px]">Tiêu biểu</span>
                  <span v-if="featured.categoryName" class="text-[0.74rem] font-semibold text-[#4A6741]">{{ featured.categoryName }}</span>
                  <span class="text-[0.74rem] text-[#7A8675]">{{ formatDate(featured) }}</span>
                </div>
                <h2 class="text-[1.25rem] sm:text-[1.5rem] font-extrabold leading-[1.3] mb-3 m-0">
                  <nuxt-link
                    :to="`/news/${featured.slug}`"
                    class="text-[#1E251C] no-underline transition-colors duration-300 hover:text-[#4A6741]"
                  >{{ featured.title }}</nuxt-link>
                </h2>
                <p v-if="featured.excerpt" class="text-[0.9rem] text-[#4A5545] leading-[1.6] m-0 line-clamp-3">{{ featured.excerpt }}</p>
                <nuxt-link
                  :to="`/news/${featured.slug}`"
                  class="inline-flex items-center gap-1.5 mt-4 text-[0.84rem] font-bold text-[#4A6741] no-underline transition-colors duration-300 hover:text-[#385130] w-fit"
                >Đọc tiếp <i class="fa-solid fa-arrow-right text-[0.72rem]" aria-hidden="true"></i></nuxt-link>
              </div>
            </article>

            <!-- Lưới các mô hình còn lại — bốn bài trở đi xếp lưới (đường 2→3→4 cột). -->
            <template v-if="rest.length">
              <h2 class="text-[0.85rem] font-extrabold text-[#4A6741] uppercase tracking-[0.6px] border-b-2 border-[#7CB342] pb-2 m-0">Các mô hình khác</h2>
              <div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <article
                  v-for="item in rest"
                  :key="item.id"
                  class="group bg-white rounded-lg overflow-hidden border border-[#E2E8DF] shadow-sm flex flex-col transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-[#7CB342]"
                >
                  <nuxt-link :to="`/news/${item.slug}`" class="block overflow-hidden">
                    <img
                      :src="item.thumbnailUrl || '/assets/hero_banner.jpg'"
                      :alt="item.title"
                      class="aspect-video w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                      loading="lazy"
                      decoding="async"
                    />
                  </nuxt-link>
                  <div class="p-4 flex flex-col gap-2 flex-1">
                    <span v-if="item.categoryName" class="inline-block self-start bg-[#EDF3EA] text-[#4A6741] text-[0.68rem] font-bold uppercase tracking-[0.3px] px-2 py-[3px] rounded-sm">{{ item.categoryName }}</span>
                    <span class="text-[0.75rem] text-[#7A8675] font-semibold">{{ formatDate(item) }}</span>
                    <h3 class="text-[0.95rem] font-bold leading-[1.4] m-0">
                      <nuxt-link
                        :to="`/news/${item.slug}`"
                        class="no-underline text-[#1E251C] transition-colors duration-300 hover:text-[#4A6741]"
                      >{{ item.title }}</nuxt-link>
                    </h3>
                    <p v-if="item.excerpt" class="text-[0.85rem] text-[#4A5545] leading-[1.55] m-0 line-clamp-2">{{ item.excerpt }}</p>
                  </div>
                </article>
              </div>
            </template>

            <!-- Phân trang — copied từ /news, aria-label đổi "Phân trang mô hình". -->
            <nav
              v-if="pagination.totalPages > 1"
              :aria-label="'Phân trang mô hình'"
              class="flex items-center justify-center gap-2 mt-8 flex-wrap"
            >
              <button
                type="button"
                class="inline-flex items-center justify-center w-9 h-9 rounded-md border border-[#E2E8DF] text-[#4A5545] text-[0.82rem] font-bold cursor-pointer transition-all duration-300 hover:border-[#7CB342] hover:text-[#4A6741] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[#E2E8DF] disabled:hover:text-[#4A5545]"
                :disabled="pagination.page <= 1"
                @click="setPage(pagination.page - 1)"
                aria-label="Trang trước"
              >&larr;</button>

              <template v-for="(p, i) in pageRange" :key="p">
                <span
                  v-if="i > 0 && p - (pageRange[i - 1] ?? p) > 1"
                  class="text-[#7A8675] text-[0.85rem] px-1 select-none"
                  aria-hidden="true"
                >&hellip;</span>
                <button
                  type="button"
                  :aria-current="pagination.page === p ? 'page' : undefined"
                  :class="[
                    'inline-flex items-center justify-center min-w-9 h-9 px-2 rounded-md text-[0.82rem] font-bold cursor-pointer transition-all duration-300',
                    pagination.page === p
                      ? 'bg-[#7CB342] text-white border border-[#7CB342]'
                      : 'border border-[#E2E8DF] text-[#4A5545] hover:border-[#7CB342] hover:text-[#4A6741]'
                  ]"
                  @click="setPage(p)"
                >{{ p }}</button>
              </template>

              <button
                type="button"
                class="inline-flex items-center justify-center w-9 h-9 rounded-md border border-[#E2E8DF] text-[#4A5545] text-[0.82rem] font-bold cursor-pointer transition-all duration-300 hover:border-[#7CB342] hover:text-[#4A6741] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[#E2E8DF] disabled:hover:text-[#4A5545]"
                :disabled="pagination.page >= pagination.totalPages"
                @click="setPage(pagination.page + 1)"
                aria-label="Trang tiếp"
              >&rarr;</button>
            </nav>
          </template>
        </div>

        <!-- Right Rail — "Đọc nhiều" + banner hotline (giống /news). -->
        <aside class="flex flex-col gap-6 min-w-0 lg:sticky lg:top-[100px]">
          <div class="bg-white rounded-lg border border-[#E2E8DF] shadow-sm px-5 py-2">
            <h2 class="text-[0.8rem] font-extrabold text-[#4A6741] uppercase tracking-[0.6px] pt-3 pb-2 border-b-2 border-[#E2E8DF] m-0">Đọc nhiều</h2>

            <div v-if="mostReadPending" role="status" aria-busy="true" class="py-2">
              <span class="sr-only">Đang tải mô hình đọc nhiều</span>
              <div aria-hidden="true" class="flex flex-col">
                <div v-for="n in 6" :key="n" class="flex gap-3 py-3 border-b border-[#E2E8DF] last:border-b-0">
                  <div class="h-6 w-6 bg-[#EEF2EC] rounded shrink-0 animate-pulse motion-reduce:animate-none"></div>
                  <div class="flex-1 flex flex-col gap-1.5 pt-0.5">
                    <div class="h-3.5 w-full bg-[#EEF2EC] rounded animate-pulse motion-reduce:animate-none"></div>
                    <div class="h-3.5 w-2/3 bg-[#EEF2EC] rounded animate-pulse motion-reduce:animate-none"></div>
                  </div>
                </div>
              </div>
            </div>

            <ul v-else-if="mostRead.length" class="list-none p-0 m-0">
              <li
                v-for="(item, i) in mostRead"
                :key="item.id"
                class="flex gap-3 py-[13px] border-b border-[#E2E8DF] last:border-b-0"
              >
                <span class="w-7 shrink-0 text-right text-[1.45rem] leading-[1.15] font-extrabold" :class="i < 3 ? 'text-[#7CB342]' : 'text-[#C7D2C2]'">{{ i + 1 }}</span>
                <h3 class="text-[0.9rem] font-bold leading-[1.4] m-0 min-w-0">
                  <nuxt-link
                    :to="`/news/${item.slug}`"
                    class="text-[#1E251C] no-underline transition-colors duration-300 hover:text-[#4A6741] line-clamp-2"
                  >{{ item.title }}</nuxt-link>
                </h3>
              </li>
            </ul>

            <p v-else class="text-[0.85rem] text-[#7A8675] italic py-4 m-0">Chưa có dữ liệu lượt xem.</p>
          </div>

          <!-- Banner hotline — cùng hình dạng /news. -->
          <div class="relative rounded-lg overflow-hidden shadow-sm text-white bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover">
            <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]" aria-hidden="true"></div>
            <div class="relative p-6">
              <h3 class="text-[1rem] font-extrabold uppercase m-0 mb-2">Hotline hỗ trợ</h3>
              <p class="text-[0.78rem] leading-[1.5] m-0 mb-4 opacity-90">Tư vấn thủ tục và hỗ trợ người hoàn lương — mọi lúc, mọi nơi.</p>
              <a
                href="tel:0903480985"
                class="inline-flex items-center gap-2 bg-[#7CB342] text-white px-[14px] py-[6px] text-[0.9rem] font-extrabold rounded no-underline transition-colors duration-300 hover:bg-[#689F38]"
              ><i class="fa-solid fa-phone" aria-hidden="true"></i>0903.480.985</a>
            </div>
          </div>
        </aside>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { formatDateVN } from '~/utils/formatDate'

useSeoMeta({
  title: 'Mô Hình Tái Hòa Nhập Cộng Đồng | Con Đường Hướng Thiện',
  description: 'Các mô hình tiêu biểu hỗ trợ người hoàn lương tái hòa nhập cộng đồng: quỹ tín dụng, câu lạc bộ, liên kết đào tạo nghề.'
})

const route = useRoute()
const PER_PAGE = 20
const currentPage = ref(Math.max(1, Math.floor(Number(route.query.page) || 1)) || 1)

// Article list — DB-driven, refetches reactively when page change.
const articlesQuery = computed(() => {
  const q: { type: string; limit: number; page: number } = { type: 'reintegration', limit: PER_PAGE, page: currentPage.value }
  return q
})
const { data: articlesData, pending, error, refresh } = useFetch('/api/public/articles', {
  query: articlesQuery,
  lazy: true,
  default: () => ({ ok: true, articles: [], pagination: { page: 1, limit: PER_PAGE, total: 0, totalPages: 1 } })
})
const modelsList = computed(() => articlesData.value?.articles || [])
const loadError = computed(() => !!error.value || articlesData.value?.ok === false)
const pagination = computed(() => articlesData.value?.pagination || { page: 1, limit: PER_PAGE, total: 0, totalPages: 1 })

// "Đọc nhiều" — xếp theo tổng lượt xem hiển thị (thật + ảo) qua `sort=views`.
// Cố ý KHÔNG lọc theo category: khối này trả lời "cổng đang đọc gì" (giống /news).
const { data: mostReadData, pending: mostReadPending } = useFetch('/api/public/articles', {
  query: { type: 'reintegration', limit: 6, sort: 'views' },
  lazy: true,
  default: () => ({ ok: true, articles: [], pagination: {} })
})
const mostRead = computed(() => mostReadData.value?.articles || [])

// Hai khu cắt từ MỘT danh sách — featured = bài đầu trang, rest = 19 kế (giống /news).
const featured = computed(() => modelsList.value[0] ?? null)
const rest = computed(() => modelsList.value.slice(1))

const formatDate = (item: { publishedAt?: string | null; createdAt?: string | null }) =>
  formatDateVN(item.publishedAt || item.createdAt)

const syncUrl = () => {
  const query: { page?: number } = {}
  if (currentPage.value > 1) query.page = currentPage.value
  navigateTo({ path: '/reintegration-models', query })
}

const setPage = (page: number) => {
  if (page < 1 || page > pagination.value.totalPages) return
  currentPage.value = page
  syncUrl()
  if (import.meta.client) {
    const el = document.getElementById('models-list-top')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

// Dải số trang — đầu/cuối + ±2 quanh trang hiện tại (giống /news).
const pageRange = computed(() => {
  const total = pagination.value.totalPages
  const cur = pagination.value.page
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set([1, total, cur, cur - 1, cur + 1])
  for (const p of pages) if (p < 1 || p > total) pages.delete(p)
  return [...pages].sort((a, b) => a - b)
})
</script>
