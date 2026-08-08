<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero Header -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <!-- Lớp phủ dạng gradient thay cho một mảng phẳng rgba(74,103,65,0.9): mảng
           phẳng gần như xoá hẳn tấm ảnh mà trang vẫn phải tải. Gradient giữ đủ độ
           tương phản cho chữ ở giữa mà vẫn thấy được ảnh ở hai mép. -->
      <div class="absolute inset-0 bg-[linear-gradient(180deg,rgba(30,45,26,0.72)_0%,rgba(74,103,65,0.92)_55%,rgba(74,103,65,0.95)_100%)]"></div>
      <div class="container relative z-10">
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">Bản Tin Hoạt Động</h2>
        <p class="text-[1.1rem] opacity-90">Cập nhật tin tức, chỉ đạo điều hành và sự kiện hỗ trợ hoàn lương trên toàn quốc</p>
      </div>
    </section>

    <!-- Main Content Grid -->
    <section class="section">
      <!-- `minmax(0,1fr)` chứ không `1fr`: một tiêu đề dài không có chỗ ngắt sẽ đẩy
           cột tin rộng hơn khung chứa nó và làm CẢ TRANG cuộn ngang được — `1fr` có
           sàn là `auto`, tức là kích thước nội dung tối thiểu. -->
      <div class="container grid grid-cols-1 gap-8 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-[34px]">
        <!-- Filter Sidebar -->
        <aside>
          <div class="bg-white p-6 rounded-lg border border-[#E2E8DF] shadow-sm lg:sticky lg:top-[100px]">
            <h4 class="text-[0.9rem] font-bold text-[#4A6741] mb-4 border-b-2 border-[#E2E8DF] pb-2">DANH MỤC TIN TỨC</h4>
            <ul class="list-none flex flex-col gap-2 p-0 m-0">
              <li>
                <button
                  :class="activeCategory === 'all' ? 'bg-[#F8FAF7] text-[#4A6741] !pl-[18px]' : 'text-[#4A5545]'"
                  class="w-full text-left bg-transparent border-0 px-[14px] py-[10px] text-[0.9rem] font-semibold rounded cursor-pointer transition-all duration-300 hover:bg-[#F8FAF7] hover:text-[#4A6741] hover:pl-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]"
                  @click="setCategory('all')"
                >Tất cả bản tin</button>
              </li>
              <li v-for="cat in rootCategories" :key="cat.id">
                <button
                  :class="activeCategory === cat.slug ? 'bg-[#F8FAF7] text-[#4A6741] !pl-[18px]' : 'text-[#4A5545]'"
                  class="w-full text-left bg-transparent border-0 px-[14px] py-[10px] text-[0.9rem] font-semibold rounded cursor-pointer transition-all duration-300 hover:bg-[#F8FAF7] hover:text-[#4A6741] hover:pl-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]"
                  @click="setCategory(cat.slug)"
                >{{ cat.name }}</button>
                <ul v-if="childrenOf(cat.id).length" class="list-none flex flex-col gap-1 pl-3 mt-1 mb-1">
                  <li v-for="child in childrenOf(cat.id)" :key="child.id">
                    <button
                      :class="activeCategory === child.slug ? 'text-[#4A6741] font-bold' : 'text-[#7A8675]'"
                      class="w-full text-left bg-transparent border-0 px-[14px] py-[7px] text-[0.83rem] font-semibold rounded cursor-pointer transition-all duration-300 hover:text-[#4A6741] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]"
                      @click="setCategory(child.slug)"
                    >— {{ child.name }}</button>
                  </li>
                </ul>
              </li>
            </ul>
          </div>
        </aside>

        <!-- News List -->
        <div class="flex flex-col gap-6">
          <SectionBar icon="fa-solid fa-newspaper" title="Bản tin hoạt động" />

          <!-- Search result banner -->
          <div
            v-if="searchQuery"
            class="bg-[#F8FAF7] border border-[#E2E8DF] border-l-4 border-l-[#7CB342] px-[18px] py-[14px] rounded text-[0.92rem] text-[#4A5545] flex items-center justify-between gap-3 flex-wrap"
          >
            Kết quả tìm kiếm cho từ khóa: <strong>&laquo;{{ searchQuery }}&raquo;</strong>
            <button
              class="bg-transparent border border-[#E2E8DF] rounded-[20px] px-3 py-[5px] text-[0.8rem] font-bold text-[#4A5545] cursor-pointer transition-all duration-300 hover:bg-[#4A6741] hover:border-[#4A6741] hover:text-white"
              @click="clearSearch"
            >✕ Bỏ tìm kiếm</button>
          </div>

          <!-- Loading state — hình dạng khớp bố cục thật: một tin chủ đạo, một cột
               tiêu đề bên cạnh, rồi lưới thẻ bên dưới. -->
          <div v-if="pending" role="status" aria-busy="true" class="flex flex-col gap-8">
            <span class="sr-only">Đang tải bản tin hoạt động</span>
            <div aria-hidden="true" class="grid grid-cols-1 gap-6 lg:grid-cols-[1.55fr_minmax(0,1fr)]">
              <div class="bg-white rounded-lg overflow-hidden border border-[#E2E8DF] shadow-sm animate-pulse motion-reduce:animate-none">
                <div class="h-[240px] sm:h-[340px] bg-[#EEF2EC]"></div>
                <div class="p-5 flex flex-col gap-3">
                  <div class="h-3 w-32 bg-[#EEF2EC] rounded"></div>
                  <div class="h-5 w-4/5 bg-[#EEF2EC] rounded"></div>
                  <div class="h-3 w-full bg-[#EEF2EC] rounded"></div>
                </div>
              </div>
              <div class="bg-white rounded-lg border border-[#E2E8DF] shadow-sm p-5 flex flex-col gap-5 animate-pulse motion-reduce:animate-none">
                <div v-for="n in 4" :key="n" class="flex flex-col gap-2">
                  <div class="h-3 w-24 bg-[#EEF2EC] rounded"></div>
                  <div class="h-4 w-full bg-[#EEF2EC] rounded"></div>
                  <div class="h-4 w-2/3 bg-[#EEF2EC] rounded"></div>
                </div>
              </div>
            </div>
            <div aria-hidden="true" class="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              <div v-for="n in 3" :key="n" class="bg-white rounded-lg overflow-hidden border border-[#E2E8DF] shadow-sm animate-pulse motion-reduce:animate-none">
                <div class="h-[170px] bg-[#EEF2EC]"></div>
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
            Không thể tải bản tin. Vui lòng
            <button type="button" class="text-[#4A6741] font-bold underline" @click="refresh()">thử lại</button>.
          </div>

          <!-- Empty state -->
          <div
            v-else-if="newsList.length === 0"
            class="bg-white border border-dashed border-[#E2E8DF] px-6 py-10 rounded-lg text-center text-[#7A8675] text-[0.95rem]"
          >
            Không tìm thấy bản tin phù hợp. Vui lòng thử từ khóa khác hoặc xem
            <button type="button" class="text-[#4A6741] font-bold underline" @click="setCategory('all')">tất cả bản tin</button>.
          </div>

          <template v-else>
            <!-- Khu tin chủ đạo: một tin lớn + cột tiêu đề bên phải. Đây là hình dạng
                 mà `NewsBlock.vue` ở trang chủ đã dùng, nên cổng thông tin đọc như một
                 tờ tin thay vì một danh sách phẳng. -->
            <div class="grid grid-cols-1 gap-6 lg:grid-cols-[1.55fr_minmax(0,1fr)]">
              <article v-if="featured" class="group bg-white rounded-lg overflow-hidden border border-[#E2E8DF] shadow-sm transition-all duration-300 hover:shadow-md hover:border-[#7CB342]">
                <nuxt-link :to="`/news/${featured.slug}`" class="block no-underline">
                  <div class="relative h-[240px] sm:h-[340px] overflow-hidden">
                    <img
                      :src="featured.thumbnailUrl || '/assets/hero_banner.jpg'"
                      :alt="featured.title"
                      class="w-full h-full object-cover transition-transform duration-[0.6s] ease-[cubic-bezier(0.165,0.84,0.44,1)] group-hover:scale-[1.03]"
                      loading="lazy"
                      decoding="async"
                    />
                    <div class="absolute inset-x-0 bottom-0 h-[70%] bg-[linear-gradient(to_top,rgba(16,28,16,0.94)_0%,rgba(16,28,16,0.45)_58%,rgba(16,28,16,0)_100%)]"></div>
                    <div class="absolute inset-x-0 bottom-0 p-5 sm:p-6 text-white">
                      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
                        <span class="inline-block bg-[#7CB342] text-white px-2 py-[3px] text-[0.65rem] font-extrabold rounded-sm uppercase tracking-[0.4px]">Tin nổi bật</span>
                        <span v-if="featured.categoryName" class="text-[0.74rem] font-semibold opacity-90">{{ featured.categoryName }}</span>
                        <span class="text-[0.74rem] opacity-85">{{ formatDate(featured) }}</span>
                      </div>
                      <h3 class="text-[1.2rem] sm:text-[1.45rem] font-extrabold leading-[1.3] mb-2 text-white transition-colors duration-300 group-hover:text-[#c5e1a5]">{{ featured.title }}</h3>
                      <p v-if="featured.excerpt" class="text-[0.86rem] leading-[1.55] opacity-[0.88] m-0 line-clamp-2">{{ featured.excerpt }}</p>
                    </div>
                  </div>
                </nuxt-link>
              </article>

              <!-- Cột tiêu đề: không ảnh, chỉ chữ. Đây là phần làm nên nhịp của một
                   trang tin — mắt đọc một tin lớn rồi quét nhanh các tin kế tiếp. -->
              <div v-if="headlines.length" class="bg-white rounded-lg border border-[#E2E8DF] shadow-sm px-5 py-2">
                <h3 class="text-[0.8rem] font-extrabold text-[#4A6741] uppercase tracking-[0.6px] pt-3 pb-2 border-b-2 border-[#E2E8DF] m-0">Tin tiếp theo</h3>
                <ul class="list-none p-0 m-0">
                  <li
                    v-for="item in headlines"
                    :key="item.id"
                    class="flex gap-3 py-[14px] border-b border-[#E2E8DF] last:border-b-0"
                  >
                    <span class="w-[6px] h-[6px] rounded-full bg-[#7CB342] mt-2 shrink-0" aria-hidden="true"></span>
                    <div class="min-w-0">
                      <h4 class="text-[0.9rem] font-bold leading-[1.4] m-0 mb-[6px]">
                        <nuxt-link
                          :to="`/news/${item.slug}`"
                          class="text-[#1E251C] no-underline transition-colors duration-300 hover:text-[#4A6741]"
                        >{{ item.title }}</nuxt-link>
                      </h4>
                      <span class="text-[0.72rem] text-[#7A8675] font-semibold">
                        {{ formatDate(item) }}<template v-if="item.categoryName"> • {{ item.categoryName }}</template>
                      </span>
                    </div>
                  </li>
                </ul>
              </div>
            </div>

            <!-- Lưới tin còn lại -->
            <template v-if="rest.length">
              <h3 class="text-[0.85rem] font-extrabold text-[#4A6741] uppercase tracking-[0.6px] border-b-2 border-[#E2E8DF] pb-2 m-0">Các bản tin khác</h3>
              <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                <article
                  v-for="item in rest"
                  :key="item.id"
                  class="group bg-white rounded-lg overflow-hidden border border-[#E2E8DF] shadow-sm flex flex-col transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-[#7CB342]"
                >
                  <nuxt-link :to="`/news/${item.slug}`" class="block h-[170px] overflow-hidden">
                    <img
                      :src="item.thumbnailUrl || '/assets/hero_banner.jpg'"
                      :alt="item.title"
                      class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                      loading="lazy"
                      decoding="async"
                    />
                  </nuxt-link>
                  <div class="p-4 flex flex-col gap-2 flex-1">
                    <span class="text-[0.75rem] text-[#7A8675] font-semibold">
                      {{ formatDate(item) }}<template v-if="item.categoryName"> • {{ item.categoryName }}</template>
                    </span>
                    <h4 class="text-[1rem] font-bold leading-[1.4] m-0">
                      <nuxt-link
                        :to="`/news/${item.slug}`"
                        class="no-underline text-[#1E251C] transition-colors duration-300 hover:text-[#4A6741]"
                      >{{ item.title }}</nuxt-link>
                    </h4>
                    <p v-if="item.excerpt" class="text-[0.85rem] text-[#4A5545] leading-[1.55] m-0 line-clamp-3">{{ item.excerpt }}</p>
                    <nuxt-link
                      :to="`/news/${item.slug}`"
                      class="text-[#7CB342] font-bold no-underline text-[0.85rem] mt-auto pt-1 self-start"
                    >Xem chi tiết &rarr;</nuxt-link>
                  </div>
                </article>
              </div>
            </template>
          </template>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { formatDateVN } from '~/utils/formatDate'

useSeoMeta({
  title: 'Bản tin hoạt động | Con Đường Hướng Thiện',
  description: 'Tin tức, chỉ đạo điều hành và sự kiện hỗ trợ hoàn lương, tái hòa nhập cộng đồng trên toàn quốc.'
})

const route = useRoute()
const activeCategory = ref(route.query.cat ? String(route.query.cat) : 'all')
const searchQuery = ref(route.query.q ? String(route.query.q) : '')

// Category sidebar — DB-driven via /api/public/categories?type=news
// Không `await`: hai lượt fetch của trang này độc lập với nhau, nên `await` ở đây
// chỉ có tác dụng bắt lượt fetch bài viết bên dưới xếp hàng đợi danh mục xong
// mới bắt đầu. Bỏ đi thì cả hai khởi động cùng lúc, thời gian chờ là lượt chậm
// hơn chứ không phải tổng hai lượt.
const { data: catData } = useFetch('/api/public/categories', {
  query: { type: 'news' },
  lazy: true,
  default: () => ({ ok: true, items: [] })
})
const allCategories = computed(() => catData.value?.items || [])
const rootCategories = computed(() => allCategories.value.filter((c) => c.parentId === null))
const childrenOf = (parentId: number) => allCategories.value.filter((c) => c.parentId === parentId)

// Article list — DB-driven, refetches reactively when category/search change
const articlesQuery = computed(() => {
  // Khai tường minh: object literal suy ra `{type,limit}` nên hai phép gán bên
  // dưới không biên dịch được. Tuỳ chọn để khoá được bỏ hẳn khi không dùng.
  const q: { type: string; limit: number; categorySlug?: string; search?: string } =
    { type: 'news', limit: 20 }
  if (activeCategory.value !== 'all') q.categorySlug = activeCategory.value
  if (searchQuery.value) q.search = searchQuery.value
  return q
})
const { data: articlesData, pending, error, refresh } = useFetch('/api/public/articles', {
  query: articlesQuery,
  lazy: true,
  default: () => ({ ok: true, articles: [], pagination: {} })
})
const newsList = computed(() => articlesData.value?.articles || [])
const loadError = computed(() => !!error.value || articlesData.value?.ok === false)

// Ba khu của bố cục tin, cắt từ MỘT danh sách đã tải. Cố ý không gọi thêm lượt
// fetch nào: `/api/public/articles` đã sắp theo `publishedAt` giảm dần, nên "tin
// chủ đạo" là tin mới nhất — một truy vấn thứ hai cho cùng dữ liệu là một lượt đi
// mạng nữa và một cơ hội để hai khu nói hai điều khác nhau.
const featured = computed(() => newsList.value[0] ?? null)
const headlines = computed(() => newsList.value.slice(1, 5))
const rest = computed(() => newsList.value.slice(5))

const formatDate = (item: { publishedAt?: string | null; createdAt?: string | null }) =>
  formatDateVN(item.publishedAt || item.createdAt)

const syncUrl = () => {
  const query: { cat?: string; q?: string } = {}
  if (activeCategory.value !== 'all') query.cat = activeCategory.value
  if (searchQuery.value) query.q = searchQuery.value
  navigateTo({ path: '/news', query })
}

const setCategory = (cat: string) => {
  activeCategory.value = cat
  syncUrl()
}

const clearSearch = () => {
  searchQuery.value = ''
  syncUrl()
}
</script>
