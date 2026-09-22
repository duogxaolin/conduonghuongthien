<template>
  <div class="bg-[#F8FAF7]">
    <PageHero>
      <nav aria-label="Đường dẫn trang" class="flex items-center gap-2 text-xs text-[#6B7967] mb-3">
        <nuxt-link to="/" class="hover:text-[#385932] transition-colors flex items-center gap-1.5 no-underline text-[#556450]">
          <i class="fa-solid fa-house text-[0.7rem] text-[#4A6741]" aria-hidden="true"></i>
          <span>Trang chủ</span>
        </nuxt-link>
        <span class="text-[#A2B09F]" aria-hidden="true">&rsaquo;</span>
        <span class="text-[#2A3B27] font-bold">Giải đáp pháp luật</span>
      </nav>

      <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#E4EEE2] border border-[#D0DFCE] text-[#365730] text-[0.72rem] font-extrabold uppercase tracking-wider mb-2.5 shadow-sm">
        <span class="w-2 h-2 rounded-full bg-[#4A6741] animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
        <span>Hỏi đáp pháp lý</span>
      </div>
      <h1 class="text-2xl sm:text-3xl lg:text-[2.2rem] font-black text-[#172516] tracking-tight leading-[1.2] m-0">Giải Đáp Pháp Luật</h1>
      <p class="text-[0.92rem] sm:text-base text-[#576653] mt-2 mb-0 leading-relaxed max-w-3xl">
        Ngân hàng câu hỏi, giải đáp pháp luật về chính sách vay vốn ưu đãi, đào tạo nghề, thủ tục xóa án tích và tái hòa nhập cộng đồng.
      </p>
    </PageHero>

    <!-- Filter chips: tách khỏi hero, nằm trong phần nội dung bên dưới -->
    <section class="pt-6 lg:pt-8">
      <div class="container">
        <div class="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <span class="text-xs text-[#7A8A76] font-medium shrink-0 mr-1">Chủ đề thường gặp:</span>
          <button
            v-for="chip in filterChips"
            :key="chip"
            type="button"
            @click="setQuickChip(chip)"
            :class="[
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border shrink-0 cursor-pointer',
              searchKeyword === chip
                ? 'bg-[#4A6741] text-white border-[#4A6741] shadow-sm'
                : 'bg-white text-[#4A5545] border-[#DCE5DB] hover:border-[#4A6741] hover:bg-[#F2F7F0]'
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
        <div class="flex flex-col gap-6 min-w-0">
          <!-- Search Bar -->
          <div class="flex items-center bg-white p-2 rounded-xl border border-[#D5E1D3] shadow-sm focus-within:border-[#4A6741] transition-all">
            <i class="fa-solid fa-magnifying-glass text-[#7A8A76] text-sm ml-3 mr-2.5" aria-hidden="true"></i>
            <input
              v-model="searchKeyword"
              type="search"
              placeholder="Tìm nhanh câu hỏi (Ví dụ: xóa án tích, vay vốn, học nghề...)"
              class="flex-1 py-2 text-[0.95rem] text-[#172516] outline-none border-none bg-transparent font-medium placeholder:text-[#9AABA0]"
              aria-label="Tìm kiếm câu hỏi pháp luật"
            />
            <button
              v-if="searchKeyword"
              type="button"
              class="text-[#8A9A88] hover:text-[#2D5A27] w-7 h-7 rounded-lg flex items-center justify-center text-xs cursor-pointer border-none bg-transparent mr-1"
              @click="searchKeyword = ''"
              aria-label="Xóa từ khóa"
            >
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </div>

          <!-- Section Divider Header -->
          <div class="flex items-center justify-between pt-1 pb-3 border-b-2 border-[#E1EADF]">
            <div class="flex items-center gap-2.5">
              <span class="w-2.5 h-6 rounded-sm bg-[#4A6741]" aria-hidden="true"></span>
              <h2 class="text-base sm:text-lg font-black text-[#1A2A17] tracking-tight uppercase m-0">
                Câu hỏi thường gặp
              </h2>
              <span v-if="!pending" class="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-[#EBF3E8] text-[#385932]">
                {{ filteredFaqs.length }} câu hỏi
              </span>
            </div>
            <nuxt-link to="/qa-documents" class="text-xs text-[#4A6741] font-bold hover:underline flex items-center gap-1 no-underline">
              <span>Kho Hỏi – Đáp C11</span>
              <i class="fa-solid fa-arrow-right text-[0.65rem]" aria-hidden="true"></i>
            </nuxt-link>
          </div>

          <!-- Loading -->
          <div v-if="pending" role="status" aria-busy="true" class="flex flex-col gap-3.5">
            <span class="sr-only">Đang tải câu hỏi thường gặp</span>
            <div
              v-for="n in 5"
              :key="n"
              aria-hidden="true"
              class="bg-white rounded-2xl border border-[#E2E8DF] px-6 py-5 animate-pulse motion-reduce:animate-none shadow-sm"
            >
              <div class="h-4 w-3/4 bg-[#EEF2EC] rounded"></div>
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
            <h3 class="text-base font-extrabold text-[#992222] m-0 mb-1">Không thể tải câu hỏi</h3>
            <p class="text-sm text-[#667768] m-0 mb-4">Đã xảy ra lỗi khi kết nối dữ liệu máy chủ.</p>
            <button
              type="button"
              class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4A6741] text-white text-xs font-bold hover:bg-[#385132] transition-all cursor-pointer border-none"
              @click="() => refresh()"
            >
              <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
              <span>Thử lại</span>
            </button>
          </div>

          <!-- Empty -->
          <div
            v-else-if="faqs.length === 0"
            class="bg-white border border-[#E2E8DF] rounded-2xl p-10 text-center shadow-sm"
          >
            <div class="w-16 h-16 rounded-full bg-[#EBF3E8] text-[#4A6741] flex items-center justify-center mx-auto mb-4 text-2xl">
              <i class="fa-solid fa-circle-question" aria-hidden="true"></i>
            </div>
            <h3 class="text-lg font-extrabold text-[#172516] m-0 mb-2">Chưa có câu hỏi nào được đăng tải</h3>
            <p class="text-sm text-[#556450] m-0 mb-4">Hiện tại cơ sở dữ liệu giải đáp pháp luật đang được cập nhật.</p>
          </div>

          <!-- Empty Search -->
          <div
            v-else-if="filteredFaqs.length === 0"
            class="bg-white border border-[#E2E8DF] rounded-2xl p-10 text-center shadow-sm"
          >
            <div class="w-16 h-16 rounded-full bg-[#FCE8E8] text-[#C62828] flex items-center justify-center mx-auto mb-4 text-2xl">
              <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            </div>
            <h3 class="text-lg font-extrabold text-[#172516] m-0 mb-2">Không tìm thấy câu hỏi phù hợp</h3>
            <p class="text-sm text-[#556450] m-0 mb-4">
              Không tìm thấy nội dung khớp với từ khóa &laquo;<strong>{{ searchKeyword }}</strong>&raquo;.
            </p>
            <button
              type="button"
              @click="searchKeyword = ''"
              class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4A6741] text-white text-xs font-bold hover:bg-[#385132] transition-all cursor-pointer border-none"
            >
              <span>Xem tất cả câu hỏi</span>
            </button>
          </div>

          <!-- Accordion List -->
          <template v-else>
            <div class="flex flex-col gap-3.5">
              <div
                v-for="(item, index) in paginatedFaqs"
                :key="item.id"
                class="bg-white rounded-2xl border transition-all duration-300 overflow-hidden"
                :class="activeIndex === index
                  ? 'border-[#4A6741] shadow-[0_4px_16px_rgba(74,103,65,0.08)]'
                  : 'border-[#E2E8DF] shadow-[0_1px_4px_rgba(0,0,0,0.02)] hover:border-[#BAC8B6]'"
              >
                <button
                  :id="`faq-question-${item.id}`"
                  type="button"
                  :aria-expanded="activeIndex === index"
                  :aria-controls="`faq-answer-${item.id}`"
                  class="w-full px-5 sm:px-6 py-4 sm:py-4.5 flex justify-between items-center gap-4 bg-transparent border-none font-[inherit] text-left cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7CB342]"
                  @click="toggleFaq(index)"
                >
                  <div class="flex items-center gap-3.5 min-w-0">
                    <div
                      class="w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0 transition-colors"
                      :class="activeIndex === index ? 'bg-[#4A6741] text-white' : 'bg-[#EBF3E8] text-[#2D5A27]'"
                    >
                      <i class="fa-solid fa-circle-question"></i>
                    </div>
                    <span
                      class="text-[0.96rem] sm:text-[1.02rem] font-bold leading-snug transition-colors"
                      :class="activeIndex === index ? 'text-[#2D5A27]' : 'text-[#172516]'"
                    >
                      {{ item.title }}
                    </span>
                  </div>
                  <span class="text-[1.4rem] text-[#7A8675] shrink-0 select-none" aria-hidden="true">{{ activeIndex === index ? '−' : '+' }}</span>
                </button>

                <div
                  v-show="activeIndex === index"
                  :id="`faq-answer-${item.id}`"
                  class="px-6 pb-5 pt-1 text-[0.92rem] text-[#4A5545] leading-relaxed border-t border-[#EEF2EC] bg-[#F9FAF8]"
                >
                  <p class="m-0 pt-3">{{ item.excerpt }}</p>
                  <div v-if="item.slug" class="pt-3 mt-3 border-t border-[#E8EEE6] flex items-center justify-between text-xs">
                    <nuxt-link
                      :to="`/news/${item.slug}`"
                      class="inline-flex items-center gap-1.5 font-bold text-[#385932] hover:text-[#1B3617] no-underline group/link"
                    >
                      <span>Xem toàn bộ bài giải đáp</span>
                      <i class="fa-solid fa-arrow-right text-[0.68rem] transition-transform duration-200 group-hover/link:translate-x-1" aria-hidden="true"></i>
                    </nuxt-link>
                    <span class="text-[#8E9F8B] font-medium">Ban tư vấn C11</span>
                  </div>
                </div>
              </div>
            </div>

              <!-- Pagination -->
              <nav
                v-if="filteredFaqs.length > 0"
                class="mt-8 pt-6 border-t border-[#DDE6DC] flex flex-col sm:flex-row items-center justify-between gap-4"
                aria-label="Phân trang câu hỏi"
              >
                <div class="text-xs text-[#6F7F6C] font-medium">
                  Trang <strong>{{ currentPage }}</strong> trên tổng số <strong>{{ totalPages }}</strong> trang
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
                    v-for="p in totalPages"
                    :key="p"
                    type="button"
                    :class="[
                      'inline-flex items-center justify-center min-w-9 h-9 px-2.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all',
                      currentPage === p
                        ? 'bg-[#4A6741] text-white border border-[#4A6741] shadow-sm'
                        : 'bg-white border border-[#D5E1D3] text-[#4A5545] hover:border-[#4A6741] hover:text-[#4A6741]'
                    ]"
                    :aria-current="currentPage === p ? 'page' : undefined"
                    @click="setPage(p)"
                  >
                    {{ p }}
                  </button>

                  <button
                    type="button"
                    class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#D5E1D3] bg-white text-[#4A5545] text-xs font-bold cursor-pointer transition-all hover:border-[#4A6741] hover:text-[#4A6741] disabled:opacity-30 disabled:cursor-not-allowed"
                    :disabled="currentPage >= totalPages"
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
          <!-- Widget 1: Xem thêm -->
          <div class="bg-white rounded-2xl border border-[#E2E8DF] shadow-sm p-5">
            <h3 class="text-[0.8rem] font-extrabold text-[#4A6741] uppercase tracking-[0.6px] pb-2 mb-3 border-b-2 border-[#E2E8DF] m-0">Xem thêm</h3>
            <ul class="list-none p-0 m-0 flex flex-col">
              <li v-for="link in quickLinks" :key="link.to" class="border-b border-[#F0F5EE] last:border-b-0">
                <nuxt-link
                  :to="link.to"
                  class="flex items-start gap-3 py-3 no-underline text-[#1E251C] transition-colors duration-200 hover:text-[#2D5A27] group"
                >
                  <div class="w-7 h-7 rounded-lg bg-[#EBF3E8] text-[#2D5A27] flex items-center justify-center text-xs shrink-0 mt-0.5 transition-colors group-hover:bg-[#4A6741] group-hover:text-white">
                    <i :class="link.icon" aria-hidden="true"></i>
                  </div>
                  <span class="min-w-0 flex-1">
                    <span class="block text-[0.88rem] font-bold leading-snug">{{ link.title }}</span>
                    <span class="block text-[0.75rem] text-[#7A8A76] leading-relaxed mt-0.5">{{ link.description }}</span>
                  </span>
                </nuxt-link>
              </li>
            </ul>
          </div>

          <!-- Widget 2: Trợ lý ảo tư vấn -->
          <div class="bg-gradient-to-br from-[#2D5A27] to-[#1E3E1A] rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
            <div class="absolute -right-4 -bottom-6 text-white/5 text-8xl pointer-events-none">
              <i class="fa-solid fa-headset" aria-hidden="true"></i>
            </div>
            <div class="relative z-10">
              <span class="inline-block px-2.5 py-0.5 rounded-full bg-white/15 text-[#A5D6A7] text-[0.68rem] font-extrabold uppercase tracking-wider mb-3">
                Tư vấn trực tuyến
              </span>
              <h3 class="text-lg font-black leading-tight mb-2 m-0 text-white">
                Không thấy câu trả lời?
              </h3>
              <p class="text-xs text-white/80 leading-relaxed mb-4 m-0">
                Đặt câu hỏi trực tiếp cho Trợ lý ảo hoặc gửi yêu cầu tư vấn 24/7 để cán bộ hỗ trợ theo từng trường hợp cụ thể.
              </p>
              <nuxt-link
                to="/assistant"
                class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#7CB342] hover:bg-[#689F38] text-white font-extrabold text-xs transition-all no-underline shadow-sm"
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
import { ref, computed } from 'vue'

useSeoMeta({
  title: 'Giải đáp pháp luật | Con Đường Hướng Thiện',
  description: 'Giải đáp các câu hỏi pháp lý thường gặp về xóa án tích, vay vốn ưu đãi, học nghề cho người hoàn lương.',
})

const filterChips = ['Vay vốn', 'Xóa án tích', 'Học nghề', 'Đặc xá', 'Cư trú']

const quickLinks = [
  { to: '/qa-documents', icon: 'fa-solid fa-book-open', title: 'Tài liệu Hỏi – Đáp', description: 'Nội dung đã được Cục C11 phê duyệt' },
  { to: '/documents', icon: 'fa-solid fa-file-contract', title: 'Văn bản pháp luật', description: 'Nghị định, chính sách liên quan' },
  { to: '/reintegration-models', icon: 'fa-solid fa-people-group', title: 'Mô hình tái hòa nhập', description: 'Quỹ vốn, học nghề, liên kết việc làm' },
  { to: '/contact', icon: 'fa-solid fa-headset', title: 'Đăng ký tư vấn 24/7', description: 'Gửi yêu cầu để cán bộ liên hệ lại' },
]

const activeIndex = ref<number | null>(null)

const { data, pending, error, refresh } = useFetch('/api/public/articles', {
  query: { type: 'faq', limit: 50 },
  lazy: true,
  default: () => ({ ok: true, articles: [], pagination: {} }),
})
const faqs = computed(() => (data.value as { articles?: any[] })?.articles || [])
const loadError = computed(() => !!error.value || (data.value as { ok?: boolean })?.ok === false)

const searchKeyword = ref('')
const filteredFaqs = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return faqs.value
  return faqs.value.filter((item: any) =>
    item.title?.toLowerCase().includes(kw) ||
    item.excerpt?.toLowerCase().includes(kw)
  )
})

const perPage = 5
const currentPage = ref(1)
const totalPages = computed(() => Math.ceil(filteredFaqs.value.length / perPage) || 1)
const paginatedFaqs = computed(() => {
  const start = (currentPage.value - 1) * perPage
  return filteredFaqs.value.slice(start, start + perPage)
})
const setPage = (p: number) => {
  if (p < 1 || p > totalPages.value) return
  currentPage.value = p
  activeIndex.value = null
}

const toggleFaq = (index: number) => {
  activeIndex.value = activeIndex.value === index ? null : index
}

const setQuickChip = (chip: string) => {
  if (searchKeyword.value === chip) {
    searchKeyword.value = ''
  } else {
    searchKeyword.value = chip
  }
}
</script>
