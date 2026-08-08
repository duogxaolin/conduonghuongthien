<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero Header -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-10">
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">Bản Tin Hoạt Động</h2>
        <p class="text-[1.1rem] opacity-90">Cập nhật tin tức, chỉ đạo điều hành và sự kiện hỗ trợ hoàn lương trên toàn quốc</p>
      </div>
    </section>

    <!-- Main Content Grid -->
    <section class="section">
      <div class="container grid grid-cols-1 lg:grid-cols-[1fr_3fr] gap-[30px]">
        <!-- Filter Sidebar -->
        <aside>
          <div class="bg-white p-6 rounded-lg border border-[#E2E8DF] shadow-sm sticky top-[100px]">
            <h4 class="text-[0.9rem] font-bold text-[#4A6741] mb-4 border-b-2 border-[#E2E8DF] pb-2">DANH MỤC TIN TỨC</h4>
            <ul class="list-none flex flex-col gap-2 p-0 m-0">
              <li>
                <button
                  :class="activeCategory === 'all' ? 'bg-[#F8FAF7] text-[#4A6741] !pl-[18px]' : 'text-[#4A5545]'"
                  class="w-full text-left bg-transparent border-0 px-[14px] py-[10px] text-[0.9rem] font-semibold rounded cursor-pointer transition-all duration-300 hover:bg-[#F8FAF7] hover:text-[#4A6741] hover:pl-[18px]"
                  @click="setCategory('all')"
                >Tất cả bản tin</button>
              </li>
              <li v-for="cat in rootCategories" :key="cat.id">
                <button
                  :class="activeCategory === cat.slug ? 'bg-[#F8FAF7] text-[#4A6741] !pl-[18px]' : 'text-[#4A5545]'"
                  class="w-full text-left bg-transparent border-0 px-[14px] py-[10px] text-[0.9rem] font-semibold rounded cursor-pointer transition-all duration-300 hover:bg-[#F8FAF7] hover:text-[#4A6741] hover:pl-[18px]"
                  @click="setCategory(cat.slug)"
                >{{ cat.name }}</button>
                <ul v-if="childrenOf(cat.id).length" class="list-none flex flex-col gap-1 pl-3 mt-1 mb-1">
                  <li v-for="child in childrenOf(cat.id)" :key="child.id">
                    <button
                      :class="activeCategory === child.slug ? 'text-[#4A6741] font-bold' : 'text-[#7A8675]'"
                      class="w-full text-left bg-transparent border-0 px-[14px] py-[7px] text-[0.83rem] font-semibold rounded cursor-pointer transition-all duration-300 hover:text-[#4A6741]"
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

          <!-- Loading state -->
          <div v-if="pending" class="flex flex-col gap-6">
            <div
              v-for="n in 4"
              :key="n"
              class="flex flex-col sm:flex-row bg-white rounded-lg overflow-hidden shadow-sm border border-[#E2E8DF] animate-pulse motion-reduce:animate-none"
            >
              <div class="w-full sm:w-[260px] h-[200px] sm:h-[180px] flex-shrink-0 bg-[#EEF2EC]"></div>
              <div class="p-6 flex flex-col gap-3 flex-1">
                <div class="h-3 w-32 bg-[#EEF2EC] rounded"></div>
                <div class="h-4 w-3/4 bg-[#EEF2EC] rounded"></div>
                <div class="h-3 w-full bg-[#EEF2EC] rounded"></div>
                <div class="h-3 w-2/3 bg-[#EEF2EC] rounded"></div>
              </div>
            </div>
          </div>

          <!-- Error state -->
          <div
            v-else-if="loadError"
            class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]"
          >
            <i class="fa-solid fa-triangle-exclamation mr-2"></i>
            Không thể tải bản tin. Vui lòng
            <button class="text-[#4A6741] font-bold underline" @click="refresh()">thử lại</button>.
          </div>

          <!-- Empty state -->
          <div
            v-else-if="newsList.length === 0"
            class="bg-white border border-dashed border-[#E2E8DF] px-6 py-10 rounded-lg text-center text-[#7A8675] text-[0.95rem]"
          >
            Không tìm thấy bản tin phù hợp. Vui lòng thử từ khóa khác hoặc xem
            <button class="text-[#4A6741] font-bold underline" @click="setCategory('all')">tất cả bản tin</button>.
          </div>

          <!-- News cards -->
          <div
            v-for="item in newsList"
            v-else
            :key="item.id"
            class="flex flex-col sm:flex-row bg-white rounded-lg overflow-hidden shadow-sm border border-[#E2E8DF] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-[#7CB342]"
          >
            <div class="w-full sm:w-[260px] h-[200px] sm:h-[180px] flex-shrink-0">
              <img :src="item.thumbnailUrl || '/assets/hero_banner.jpg'" :alt="item.title" class="w-full h-full object-cover"  loading="lazy" decoding="async" />
            </div>
            <div class="p-6 flex flex-col justify-between">
              <span class="text-[0.8rem] text-[#7A8675] font-semibold mb-1.5 block">
                {{ formatDate(item) }}<template v-if="item.categoryName"> • {{ item.categoryName }}</template>
              </span>
              <h3 class="text-[1.15rem] font-bold leading-[1.4] mb-2">
                <nuxt-link
                  :to="`/news/${item.slug}`"
                  class="no-underline text-[#1E251C] transition-all duration-300 hover:text-[#4A6741]"
                >{{ item.title }}</nuxt-link>
              </h3>
              <p class="text-[0.88rem] text-[#4A5545] leading-[1.5] mb-3">{{ item.excerpt }}</p>
              <nuxt-link
                :to="`/news/${item.slug}`"
                class="text-[#7CB342] font-bold no-underline text-[0.88rem] self-start"
              >Xem chi tiết &rarr;</nuxt-link>
            </div>
          </div>
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
