<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-[2]">
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">Tài Liệu Hỏi – Đáp</h2>
        <p class="text-[1.1rem] opacity-90 max-w-[760px] mx-auto">
          Toàn bộ nội dung hỏi – đáp đã được Cục C11 phê duyệt. Đây cũng chính là kho dữ liệu mà Trợ lý ảo Hướng Thiện dùng để trả lời.
        </p>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <SectionBar icon="fa-solid fa-book-open" title="Nội dung đã được phê duyệt" />

        <!-- Search + topic filter -->
        <form class="flex flex-col gap-3 mb-6 bg-white p-4 rounded-lg border border-[#E2E8DF] shadow-sm sm:flex-row" @submit.prevent="applySearch">
          <label class="sr-only" for="qa-search">Tìm trong tài liệu hỏi – đáp</label>
          <input
            id="qa-search"
            v-model="searchInput"
            type="search"
            placeholder="Nhập từ khóa (Ví dụ: xóa án tích, vay vốn, học nghề...)"
            class="flex-1 px-3 py-3 border border-[#E2E8DF] rounded text-[0.95rem] outline-none focus:border-[#7CB342] font-[inherit] transition-colors duration-200"
          />
          <button type="submit" class="btn btn-primary w-full sm:w-auto">Tìm kiếm</button>
        </form>

        <div v-if="topics.length" class="flex flex-wrap gap-2 mb-6" role="group" aria-label="Lọc theo chủ đề">
          <button
            type="button"
            class="px-3 py-1.5 rounded-full text-[0.85rem] font-semibold border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]"
            :class="!activeTopic
              ? 'bg-[#4A6741] border-[#4A6741] text-white'
              : 'bg-white border-[#E2E8DF] text-[#4A5545] hover:border-[#7CB342]'"
            :aria-pressed="!activeTopic"
            @click="applyTopic('')"
          >Tất cả</button>
          <button
            v-for="item in topics"
            :key="item.topic"
            type="button"
            class="px-3 py-1.5 rounded-full text-[0.85rem] font-semibold border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]"
            :class="activeTopic === item.topic
              ? 'bg-[#4A6741] border-[#4A6741] text-white'
              : 'bg-white border-[#E2E8DF] text-[#4A5545] hover:border-[#7CB342]'"
            :aria-pressed="activeTopic === item.topic"
            @click="applyTopic(item.topic)"
          >{{ item.topic }} <span class="opacity-70">({{ item.total }})</span></button>
        </div>

        <div class="max-w-[860px]">
          <!-- Loading -->
          <div
            v-if="pending"
            role="status"
            aria-busy="true"
            class="flex flex-col gap-4"
          >
            <span class="sr-only">Đang tải tài liệu hỏi – đáp</span>
            <div
              v-for="n in 5"
              :key="n"
              aria-hidden="true"
              class="bg-white rounded-lg border border-[#E2E8DF] px-6 py-5 animate-pulse motion-reduce:animate-none"
            >
              <div class="h-4 w-2/3 bg-[#EEF2EC] rounded"></div>
            </div>
          </div>

          <!-- Error -->
          <div
            v-else-if="loadError"
            role="alert"
            class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]"
          >
            <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
            Không thể tải tài liệu hỏi – đáp. Vui lòng
            <button type="button" class="text-[#4A6741] font-bold underline" @click="refresh()">thử lại</button>.
          </div>

          <!-- Empty -->
          <div v-else-if="entries.length === 0" class="bg-white border border-dashed border-[#E2E8DF] px-6 py-10 rounded-lg text-center text-[#7A8675] text-[0.95rem]">
            {{ searchQuery || activeTopic
              ? 'Không tìm thấy nội dung phù hợp. Anh/chị thử từ khóa khác hoặc bỏ lọc chủ đề.'
              : 'Chưa có nội dung hỏi – đáp nào được phê duyệt.' }}
          </div>

          <!-- List -->
          <template v-else>
            <p class="text-[0.9rem] text-[#7A8675] mb-3">
              {{ pagination.total }} nội dung đã phê duyệt<span v-if="activeTopic"> · chủ đề “{{ activeTopic }}”</span>
            </p>
            <div class="flex flex-col gap-4">
              <article
                v-for="item in entries"
                :id="`qa-${item.id}`"
                :key="item.id"
                class="bg-white rounded-lg border overflow-hidden scroll-mt-24 transition-all duration-300"
                :class="highlightId === item.id ? 'border-[#4A6741] shadow-sm' : 'border-[#E2E8DF]'"
              >
                <h3 class="m-0">
                  <button
                    type="button"
                    :aria-expanded="isOpen(item.id)"
                    :aria-controls="`qa-answer-${item.id}`"
                    class="w-full px-6 py-5 flex justify-between items-start gap-4 bg-transparent border-none font-[inherit] text-base font-bold text-left cursor-pointer transition-colors duration-200 hover:text-[#4A6741] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7CB342]"
                    :class="isOpen(item.id) ? 'text-[#4A6741]' : 'text-[#1E251C]'"
                    @click="toggle(item.id)"
                  >
                    <span>{{ item.question }}</span>
                    <span class="text-[1.4rem] leading-none text-[#7A8675] shrink-0" aria-hidden="true">{{ isOpen(item.id) ? '−' : '+' }}</span>
                  </button>
                </h3>
                <!-- Not a landmark region on purpose: the APG advises against it once
                     an accordion can hold more than about six panels, and this page
                     renders up to 50. -->
                <div
                  v-show="isOpen(item.id)"
                  :id="`qa-answer-${item.id}`"
                  class="px-6 pb-5 pt-4 border-t border-[#E2E8DF] bg-[#F8FAF7]"
                >
                  <!-- Approved prose rendered as text, never v-html: this content is
                       the assistant's own answer text and must not take a path that
                       executes markup. `whitespace-pre-line` keeps the paragraph and
                       numbering breaks the officers wrote. -->
                  <p class="text-[0.95rem] text-[#4A5545] leading-[1.7] whitespace-pre-line m-0">{{ item.answer }}</p>
                  <p v-if="item.topic" class="mt-3 mb-0 text-[0.8rem] text-[#7A8675]">
                    <i class="fa-solid fa-tag mr-1.5" aria-hidden="true"></i>Chủ đề: {{ item.topic }}
                  </p>
                  <p v-if="item.source" class="mt-2 mb-0 text-[0.8rem] text-[#7A8675]">
                    <i class="fa-solid fa-file-lines mr-1.5" aria-hidden="true"></i>
                    Nguồn: {{ item.source.label || item.source.reference || 'Tài liệu đã phê duyệt' }}
                    <span v-if="item.source.reference && item.source.label"> · {{ item.source.reference }}</span>
                    <a
                      v-if="item.source.url"
                      :href="item.source.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-[#4A6741] font-bold underline ml-1"
                    >Xem văn bản</a>
                  </p>
                </div>
              </article>
            </div>

            <!-- Pagination -->
            <nav v-if="pagination.totalPages > 1" class="flex flex-wrap items-center justify-center gap-2 mt-8" aria-label="Phân trang tài liệu hỏi – đáp">
              <button
                type="button"
                class="px-4 py-2 rounded border border-[#E2E8DF] bg-white text-[0.9rem] font-semibold text-[#4A5545] disabled:opacity-40 disabled:cursor-not-allowed hover:border-[#7CB342] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]"
                :disabled="page <= 1"
                @click="goToPage(page - 1)"
              >← Trước</button>
              <span class="text-[0.9rem] text-[#4A5545] px-2" aria-live="polite">Trang {{ page }} / {{ pagination.totalPages }}</span>
              <button
                type="button"
                class="px-4 py-2 rounded border border-[#E2E8DF] bg-white text-[0.9rem] font-semibold text-[#4A5545] disabled:opacity-40 disabled:cursor-not-allowed hover:border-[#7CB342] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]"
                :disabled="page >= pagination.totalPages"
                @click="goToPage(page + 1)"
              >Sau →</button>
            </nav>
          </template>
        </div>

        <!-- Route back to the assistant. The page answers "what has been approved";
             the assistant answers "what applies to me". -->
        <div class="max-w-[860px] mt-10 bg-white border border-[#E2E8DF] rounded-lg px-6 py-6">
          <p class="m-0 text-[0.95rem] text-[#4A5545] leading-[1.7]">
            Không tìm thấy nội dung anh/chị cần?
            <nuxt-link to="/assistant" class="text-[#4A6741] font-bold underline">Đặt câu hỏi cho Trợ lý ảo</nuxt-link>
            hoặc liên hệ Công an xã/phường nơi cư trú để được hướng dẫn trực tiếp.
          </p>
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
  description: 'Toàn bộ nội dung hỏi – đáp đã được Cục C11 phê duyệt về xóa án tích, vay vốn, học nghề và tái hòa nhập cộng đồng.'
})

const route = useRoute()

// URL is the source of truth for search/topic/page, so a filtered view can be
// shared or bookmarked — and so the chat's citation link can point at one entry.
const searchQuery = computed(() => String(route.query.q || '').trim())
const activeTopic = computed(() => String(route.query.topic || '').trim())
// `?page=abc` is a URL a visitor can type or a stale link can carry.
// `Math.max(1, Number('abc'))` is `NaN`, which would go into the fetch query and
// come back as a paginator reporting no page at all, so the non-numeric case has
// to fall back to 1 rather than propagate.
const page = computed(() => {
  const value = Number(route.query.page)
  return Number.isFinite(value) && value >= 1 ? Math.trunc(value) : 1
})
const searchInput = ref(searchQuery.value)
watch(searchQuery, value => { searchInput.value = value })

const listQuery = computed(() => {
  // Khai tường minh: một object literal suy ra `{page,perPage}` nên hai phép gán
  // bên dưới không biên dịch được. Cả hai để tuỳ chọn vì bỏ hẳn khoá khác với gửi
  // chuỗi rỗng — `?search=` vào bộ nhớ đệm dưới một khoá khác cho cùng danh sách.
  const query: { page: number; perPage: number; search?: string; topic?: string } =
    { page: page.value, perPage: 20 }
  if (searchQuery.value) query.search = searchQuery.value
  if (activeTopic.value) query.topic = activeTopic.value
  return query
})

// `lazy` so the skeleton is what a visitor sees while a search or page change is
// in flight; the server render still waits for data, so SEO is unchanged.
const { data, pending, error, refresh } = useFetch('/api/public/chatbot/knowledge', {
  query: listQuery,
  lazy: true,
  default: () => ({ ok: true, items: [], topics: [], pagination: { page: 1, perPage: 20, total: 0, totalPages: 0 } })
})

const entries = computed(() => data.value?.items || [])
const topics = computed(() => data.value?.topics || [])
const pagination = computed(() => data.value?.pagination || { page: 1, perPage: 20, total: 0, totalPages: 0 })
const loadError = computed(() => !!error.value || data.value?.ok === false)

// `#qa-<id>` opens that entry on arrival: this is where a chat citation lands, and
// landing on a collapsed list with nothing open would read as a broken link.
const highlightId = computed(() => {
  const raw = Number(String(route.hash || '').replace('#qa-', ''))
  return Number.isSafeInteger(raw) && raw > 0 ? raw : null
})

// `Set<number>` tường minh: `new Set()` trần suy ra `Set<unknown>`, nên `.has(id)`
// nhận mọi thứ và phép mở theo neo `#qa-<id>` mất kiểm kiểu.
const openIds = ref<Set<number>>(new Set())
watch(highlightId, value => { if (value) openIds.value = new Set([...openIds.value, value]) }, { immediate: true })

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
