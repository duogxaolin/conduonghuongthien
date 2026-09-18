<template>
  <div class="bg-[#F8FAF7]">
    <!-- Page Header (Đồng bộ chuẩn phong cách mới) -->
    <section class="border-b border-[#E2E8DF] bg-white">
      <div class="container pt-7 sm:pt-9 pb-5">
        <nav aria-label="Đường dẫn trang" class="flex items-center gap-2 text-xs text-[#7A8A76] mb-3">
          <nuxt-link to="/" class="hover:text-[#4A6741] transition-colors flex items-center gap-1.5 no-underline text-[#556450]">
            <i class="fa-solid fa-house text-[0.7rem]" aria-hidden="true"></i>
            <span>Trang chủ</span>
          </nuxt-link>
          <span class="text-[#BAC8B6]">&rsaquo;</span>
          <span class="text-[#2D5A27] font-bold">Tài liệu Hỏi – Đáp</span>
        </nav>

        <p class="text-[0.78rem] font-extrabold uppercase tracking-[1.2px] text-[#7CB342] m-0 mb-1">Kho tri thức nghiệp vụ C11</p>
        <h1 class="text-[1.65rem] sm:text-[2.05rem] font-extrabold text-[#1E251C] leading-[1.2] m-0">Tài Liệu Hỏi – Đáp</h1>
        <p class="text-[0.95rem] text-[#5A6655] mt-2 mb-5 leading-relaxed max-w-3xl">
          Toàn bộ nội dung hỏi – đáp nghiệp vụ đã được Cục C11 phê duyệt. Đây cũng chính là kho dữ liệu chuẩn mà Trợ lý ảo Hướng Thiện dùng để trả lời cho công dân.
        </p>

        <!-- Topic Chips in Header -->
        <div v-if="topics.length" class="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <span class="text-xs text-[#7A8A76] font-medium shrink-0 mr-1">Chủ đề:</span>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border shrink-0 cursor-pointer"
            :class="!activeTopic
              ? 'bg-[#4A6741] text-white border-[#4A6741] shadow-sm'
              : 'bg-white text-[#4A5545] border-[#DCE5DB] hover:border-[#4A6741] hover:bg-[#F2F7F0]'"
            :aria-pressed="!activeTopic"
            @click="applyTopic('')"
          >
            <span>Tất cả</span>
            <span class="text-[0.7rem] px-1.5 py-0.2 rounded-full font-extrabold" :class="!activeTopic ? 'bg-white/20 text-white' : 'bg-[#EBF1EA] text-[#556653]'">
              {{ pagination.total }}
            </span>
          </button>
          <button
            v-for="item in topics"
            :key="item.topic"
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border shrink-0 cursor-pointer"
            :class="activeTopic === item.topic
              ? 'bg-[#4A6741] text-white border-[#4A6741] shadow-sm'
              : 'bg-white text-[#4A5545] border-[#DCE5DB] hover:border-[#4A6741] hover:bg-[#F2F7F0]'"
            :aria-pressed="activeTopic === item.topic"
            @click="applyTopic(item.topic)"
          >
            <span>{{ item.topic }}</span>
            <span class="text-[0.7rem] px-1.5 py-0.2 rounded-full font-extrabold" :class="activeTopic === item.topic ? 'bg-white/20 text-white' : 'bg-[#EBF1EA] text-[#556653]'">
              {{ item.total }}
            </span>
          </button>
        </div>
      </div>
    </section>

    <!-- Main Content Section -->
    <section class="py-8 lg:py-10">
      <div class="container">
        <!-- Grid layout: Cột chính + Sidebar -->
        <div class="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px] lg:gap-10 items-start">
          <!-- Cột chính -->
          <div class="flex flex-col gap-6 min-w-0">
            <!-- Search Form -->
            <form class="flex flex-col sm:flex-row gap-3 bg-white p-2 rounded-xl border border-[#D5E1D3] shadow-sm focus-within:border-[#4A6741] transition-all" @submit.prevent="applySearch">
              <label class="sr-only" for="qa-search">Tìm trong tài liệu hỏi – đáp</label>
              <div class="relative flex-1 flex items-center pl-3">
                <i class="fa-solid fa-magnifying-glass text-[#7A8A76] text-sm mr-2.5" aria-hidden="true"></i>
                <input
                  id="qa-search"
                  v-model="searchInput"
                  type="search"
                  placeholder="Nhập từ khóa (Ví dụ: xóa án tích, vay vốn, học nghề...)"
                  class="flex-1 py-2 text-[0.95rem] text-[#172516] outline-none border-none bg-transparent font-medium placeholder:text-[#9AABA0]"
                />
                <button
                  v-if="searchInput"
                  type="button"
                  @click="searchInput = ''; applySearch()"
                  class="text-[#8A9A88] hover:text-[#2D5A27] w-7 h-7 rounded-lg flex items-center justify-center text-xs cursor-pointer border-none bg-transparent mr-1"
                  aria-label="Xóa từ khóa"
                >
                  <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
              </div>
              <button
                type="submit"
                class="bg-[#4A6741] hover:bg-[#385132] text-white px-6 py-2.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all border-none flex items-center justify-center gap-1.5 shadow-sm shrink-0"
              >
                <span>Tìm kiếm</span>
                <i class="fa-solid fa-arrow-right text-[0.7rem]" aria-hidden="true"></i>
              </button>
            </form>

            <!-- Section Divider Header -->
            <div class="flex items-center justify-between pt-1 pb-3 border-b-2 border-[#E1EADF]">
              <div class="flex items-center gap-2.5">
                <span class="w-2.5 h-6 rounded-sm bg-[#4A6741]" aria-hidden="true"></span>
                <h2 class="text-base sm:text-lg font-black text-[#1A2A17] tracking-tight uppercase m-0">
                  Nội dung đã được phê duyệt
                </h2>
                <span v-if="!pending" class="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-[#EBF3E8] text-[#385932]">
                  {{ pagination.total }} câu hỏi
                </span>
              </div>
              <span v-if="activeTopic" class="text-xs text-[#4A6741] font-bold">
                Chủ đề: &laquo;{{ activeTopic }}&raquo;
              </span>
            </div>

            <!-- Loading Skeleton -->
            <div
              v-if="pending"
              role="status"
              aria-busy="true"
              class="flex flex-col gap-3.5"
            >
              <span class="sr-only">Đang tải tài liệu hỏi – đáp</span>
              <div
                v-for="n in 6"
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
              <h3 class="text-base font-extrabold text-[#992222] m-0 mb-1">Không thể tải tài liệu hỏi – đáp</h3>
              <p class="text-sm text-[#667768] m-0 mb-4">Đã xảy ra lỗi khi kết nối dữ liệu máy chủ.</p>
              <button
                type="button"
                class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4A6741] text-white text-xs font-bold hover:bg-[#385132] transition-all cursor-pointer border-none"
                @click="refresh()"
              >
                <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                <span>Thử lại</span>
              </button>
            </div>

            <!-- Empty -->
            <div
              v-else-if="entries.length === 0"
              class="bg-white border border-[#E2E8DF] rounded-2xl p-10 text-center shadow-sm"
            >
              <div class="w-16 h-16 rounded-full bg-[#EBF3E8] text-[#4A6741] flex items-center justify-center mx-auto mb-4 text-2xl">
                <i class="fa-solid fa-book-open text-xl"></i>
              </div>
              <h3 class="text-lg font-extrabold text-[#172516] m-0 mb-2">
                {{ searchQuery || activeTopic
                  ? 'Không tìm thấy nội dung phù hợp. Anh/chị thử từ khóa khác hoặc bỏ lọc chủ đề.'
                  : 'Chưa có nội dung hỏi – đáp nào được phê duyệt.' }}
              </h3>
              <p class="text-sm text-[#556450] m-0 mb-4">Vui lòng điều chỉnh từ khóa tìm kiếm hoặc chọn lại danh sách chủ đề.</p>
              <button
                v-if="searchQuery || activeTopic"
                type="button"
                @click="applyTopic(''); searchInput = ''; applySearch()"
                class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4A6741] text-white text-xs font-bold hover:bg-[#385132] transition-all cursor-pointer border-none"
              >
                <span>Xem toàn bộ tài liệu</span>
              </button>
            </div>

            <!-- List -->
            <template v-else>
              <div class="flex flex-col gap-3.5">
                <article
                  v-for="item in entries"
                  :id="`qa-${item.id}`"
                  :key="item.id"
                  class="bg-white rounded-2xl border overflow-hidden scroll-mt-24 transition-all duration-300"
                  :class="highlightId === item.id
                    ? 'border-[#4A6741] shadow-[0_4px_16px_rgba(74,103,65,0.12)]'
                    : 'border-[#E2E8DF] shadow-[0_1px_4px_rgba(0,0,0,0.02)] hover:border-[#BAC8B6]'"
                >
                  <h3 class="m-0">
                    <button
                      type="button"
                      :aria-expanded="isOpen(item.id)"
                      :aria-controls="`qa-answer-${item.id}`"
                      class="w-full px-5 sm:px-6 py-4 sm:py-4.5 flex justify-between items-center gap-4 bg-transparent border-none font-[inherit] text-left cursor-pointer transition-colors duration-200"
                      @click="toggle(item.id)"
                    >
                      <div class="flex items-center gap-3.5 min-w-0">
                        <div
                          class="w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0 transition-colors"
                          :class="isOpen(item.id) ? 'bg-[#4A6741] text-white' : 'bg-[#EBF3E8] text-[#2D5A27]'"
                        >
                          <i class="fa-solid fa-comments"></i>
                        </div>
                        <span
                          class="text-[0.98rem] sm:text-[1.04rem] font-bold leading-snug transition-colors"
                          :class="isOpen(item.id) ? 'text-[#2D5A27]' : 'text-[#172516]'"
                        >
                          {{ item.question }}
                        </span>
                      </div>
                      <div class="w-7 h-7 rounded-lg flex items-center justify-center text-xs shrink-0 bg-[#F5F8F4]">
                        <span class="text-[1.4rem] leading-none text-[#7A8675] shrink-0" aria-hidden="true">{{ isOpen(item.id) ? '−' : '+' }}</span>
                      </div>
                    </button>
                  </h3>

                  <div
                    v-show="isOpen(item.id)"
                    :id="`qa-answer-${item.id}`"
                    class="px-6 pb-6 pt-2 border-t border-[#EEF2EC] bg-[#F9FAF8]"
                  >
                    <p class="text-[0.94rem] text-[#4A5545] leading-[1.7] whitespace-pre-line m-0 pt-2">{{ item.answer }}</p>

                    <div class="mt-4 pt-3.5 border-t border-[#E8EEE6] flex flex-wrap items-center justify-between gap-3 text-xs text-[#7A8A76]">
                      <div class="flex items-center gap-3 flex-wrap">
                        <span v-if="item.topic" class="inline-flex items-center gap-1.5 bg-[#EBF3E8] text-[#2D5A27] px-2.5 py-0.5 rounded text-[0.72rem] font-bold">
                          <i class="fa-solid fa-tag text-[0.65rem]" aria-hidden="true"></i>
                          <span>Chủ đề: {{ item.topic }}</span>
                        </span>
                        <span v-if="item.source" class="flex items-center gap-1 font-medium">
                          <i class="fa-solid fa-file-lines text-[0.7rem] text-[#7CB342]" aria-hidden="true"></i>
                          <span>Nguồn: {{ item.source.label || item.source.reference || 'Tài liệu đã phê duyệt' }}</span>
                          <span v-if="item.source.reference && item.source.label"> · {{ item.source.reference }}</span>
                        </span>
                      </div>

                      <a
                        v-if="item.source?.url"
                        :href="item.source.url"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex items-center gap-1 text-[#385932] font-bold hover:underline"
                      >
                        <span>Xem văn bản</span>
                        <i class="fa-solid fa-arrow-up-right-from-square text-[0.65rem]"></i>
                      </a>
                    </div>
                  </div>
                </article>
              </div>

              <!-- Pagination -->
              <nav
                v-if="pagination.totalPages > 1"
                class="mt-8 pt-6 border-t border-[#DDE6DC] flex flex-col sm:flex-row items-center justify-between gap-4"
                aria-label="Phân trang tài liệu"
              >
                <div class="text-xs text-[#6F7F6C] font-medium">
                  Trang <strong>{{ page }}</strong> trên tổng số <strong>{{ pagination.totalPages }}</strong> trang
                </div>

                <div class="flex items-center gap-1.5 flex-wrap justify-center">
                  <button
                    type="button"
                    class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#D5E1D3] bg-white text-[#4A5545] text-xs font-bold cursor-pointer transition-all hover:border-[#4A6741] hover:text-[#4A6741] disabled:opacity-30 disabled:cursor-not-allowed"
                    :disabled="page <= 1 || pending"
                    @click="goToPage(page - 1)"
                    aria-label="Trang trước"
                  >
                    <i class="fa-solid fa-chevron-left text-[0.7rem]" aria-hidden="true"></i>
                  </button>

                  <button
                    v-for="p in pagination.totalPages"
                    :key="p"
                    type="button"
                    :class="[
                      'inline-flex items-center justify-center min-w-9 h-9 px-2.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all',
                      page === p
                        ? 'bg-[#4A6741] text-white border border-[#4A6741] shadow-sm'
                        : 'bg-white border border-[#D5E1D3] text-[#4A5545] hover:border-[#4A6741] hover:text-[#4A6741]'
                    ]"
                    @click="goToPage(p)"
                  >
                    {{ p }}
                  </button>

                  <button
                    type="button"
                    class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#D5E1D3] bg-white text-[#4A5545] text-xs font-bold cursor-pointer transition-all hover:border-[#4A6741] hover:text-[#4A6741] disabled:opacity-30 disabled:cursor-not-allowed"
                    :disabled="page >= pagination.totalPages || pending"
                    @click="goToPage(page + 1)"
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
            <!-- Widget 1: Chủ đề lọc -->
            <div v-if="topics.length" class="bg-white rounded-2xl border border-[#E2E8DF] shadow-sm p-5" role="group" aria-label="Lọc theo chủ đề">
              <h3 class="text-[0.8rem] font-extrabold text-[#4A6741] uppercase tracking-[0.6px] pb-2 mb-3 border-b-2 border-[#E2E8DF] m-0">Chủ đề nghiệp vụ</h3>
              <div class="flex flex-col gap-1">
                <button
                  type="button"
                  class="w-full flex items-center justify-between gap-2 text-left px-3 py-2.5 rounded-xl text-[0.88rem] font-semibold transition-colors duration-200 cursor-pointer border-none"
                  :class="!activeTopic
                    ? 'bg-[#4A6741] text-white shadow-sm'
                    : 'bg-transparent text-[#4A5545] hover:bg-[#F2F7F0] hover:text-[#4A6741]'"
                  :aria-pressed="!activeTopic"
                  @click="applyTopic('')"
                >
                  <span class="flex items-center gap-2">
                    <i class="fa-solid fa-layer-group text-xs" aria-hidden="true"></i>
                    <span>Tất cả</span>
                  </span>
                  <span class="text-[0.75rem] px-2 py-0.5 rounded-full font-bold" :class="!activeTopic ? 'bg-white/20 text-white' : 'bg-[#EBF1EA] text-[#556653]'">
                    {{ pagination.total }}
                  </span>
                </button>
                <button
                  v-for="item in topics"
                  :key="item.topic"
                  type="button"
                  class="w-full flex items-center justify-between gap-2 text-left px-3 py-2.5 rounded-xl text-[0.88rem] font-semibold transition-colors duration-200 cursor-pointer border-none"
                  :class="activeTopic === item.topic
                    ? 'bg-[#4A6741] text-white shadow-sm'
                    : 'bg-transparent text-[#4A5545] hover:bg-[#F2F7F0] hover:text-[#4A6741]'"
                  :aria-pressed="activeTopic === item.topic"
                  @click="applyTopic(item.topic)"
                >
                  <span class="min-w-0 break-words flex items-center gap-2">
                    <i class="fa-solid fa-tag text-xs opacity-70" aria-hidden="true"></i>
                    <span class="truncate">{{ item.topic }}</span>
                  </span>
                  <span class="text-[0.75rem] px-2 py-0.5 rounded-full font-bold shrink-0" :class="activeTopic === item.topic ? 'bg-white/20 text-white' : 'bg-[#EBF1EA] text-[#556653]'">
                    {{ item.total }}
                  </span>
                </button>
              </div>
            </div>

            <!-- Widget 2: Trợ lý ảo tư vấn -->
            <div class="bg-gradient-to-br from-[#2D5A27] to-[#1E3E1A] rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
              <div class="absolute -right-4 -bottom-6 text-white/5 text-8xl pointer-events-none">
                <i class="fa-solid fa-robot" aria-hidden="true"></i>
              </div>
              <div class="relative z-10">
                <span class="inline-block px-2.5 py-0.5 rounded-full bg-white/15 text-[#A5D6A7] text-[0.68rem] font-extrabold uppercase tracking-wider mb-3">
                  Trợ lý AI Hướng Thiện
                </span>
                <h3 class="text-lg font-black leading-tight mb-2 m-0 text-white">
                  Không tìm thấy nội dung?
                </h3>
                <p class="text-xs text-white/80 leading-relaxed mb-4 m-0">
                  Đặt câu hỏi trực tiếp cho Trợ lý ảo để được tra cứu tức thì từ kho kiến thức đã duyệt, hoặc liên hệ Công an xã/phường để được chỉ dẫn.
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

            <!-- Widget 3: Xem thêm -->
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
          </aside>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

useSeoMeta({
  title: 'Tài liệu Hỏi – Đáp | Con Đường Hướng Thiện',
  description: 'Toàn bộ nội dung hỏi – đáp đã được Cục C11 phê duyệt về xóa án tích, vay vốn, học nghề và tái hòa nhập cộng đồng.',
})

const route = useRoute()

const quickLinks = [
  { to: '/legal-qa', icon: 'fa-solid fa-circle-question', title: 'Giải đáp pháp luật', description: 'Câu hỏi thường gặp theo từng thủ tục' },
  { to: '/documents', icon: 'fa-solid fa-file-contract', title: 'Văn bản pháp luật', description: 'Nghị định, chính sách liên quan' },
  { to: '/contact', icon: 'fa-solid fa-headset', title: 'Đăng ký tư vấn 24/7', description: 'Gửi yêu cầu để cán bộ liên hệ lại' },
]

const searchQuery = computed(() => String(route.query.q || '').trim())
const activeTopic = computed(() => String(route.query.topic || '').trim())
const page = computed(() => {
  const value = Number(route.query.page)
  return Number.isFinite(value) && value >= 1 ? Math.trunc(value) : 1
})
const searchInput = ref(searchQuery.value)
watch(searchQuery, (value) => { searchInput.value = value })

const listQuery = computed(() => {
  const query: { page: number; perPage: number; search?: string; topic?: string } =
    { page: page.value, perPage: 20 }
  if (searchQuery.value) query.search = searchQuery.value
  if (activeTopic.value) query.topic = activeTopic.value
  return query
})

const { data, pending, error, refresh } = useFetch('/api/public/chatbot/knowledge', {
  query: listQuery,
  lazy: true,
  default: () => ({ ok: true, items: [], topics: [], pagination: { page: 1, perPage: 20, total: 0, totalPages: 0 } }),
})

const entries = computed(() => (data.value as { items?: any[] })?.items || [])
const topics = computed(() => (data.value as { topics?: any[] })?.topics || [])
const pagination = computed(() => (data.value as { pagination?: any })?.pagination || { page: 1, perPage: 20, total: 0, totalPages: 0 })
const loadError = computed(() => !!error.value || (data.value as { ok?: boolean })?.ok === false)

const highlightId = computed(() => {
  const raw = Number(String(route.hash || '').replace('#qa-', ''))
  return Number.isSafeInteger(raw) && raw > 0 ? raw : null
})

const openIds = ref<Set<number>>(new Set())
watch(highlightId, (value) => { if (value) openIds.value = new Set([...openIds.value, value]) }, { immediate: true })

const isOpen = (id: number) => openIds.value.has(id)
const toggle = (id: number) => {
  const next = new Set(openIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  openIds.value = next
}

const push = (query: Record<string, string | number>) => navigateTo({ path: '/qa-documents', query })
const applySearch = () => {
  const value = searchInput.value.trim()
  push({ ...(value ? { q: value } : {}), ...(activeTopic.value ? { topic: activeTopic.value } : {}) })
}
const applyTopic = (topic: string) => {
  push({ ...(searchQuery.value ? { q: searchQuery.value } : {}), ...(topic ? { topic } : {}) })
}
const goToPage = (next: number) => {
  push({
    ...(searchQuery.value ? { q: searchQuery.value } : {}),
    ...(activeTopic.value ? { topic: activeTopic.value } : {}),
    ...(next > 1 ? { page: next } : {}),
  })
}
</script>
