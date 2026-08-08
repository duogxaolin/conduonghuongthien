<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero Header -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <!-- Gradient thay cho một mảng phẳng rgba(74,103,65,0.9): mảng phẳng gần như
           xoá hẳn tấm ảnh mà trang vẫn phải tải về. -->
      <div class="absolute inset-0 bg-[linear-gradient(180deg,rgba(30,45,26,0.72)_0%,rgba(74,103,65,0.92)_55%,rgba(74,103,65,0.95)_100%)]"></div>
      <div class="container relative z-[2]">
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">Văn Bản Quy Phạm Pháp Luật</h2>
        <p class="text-[1.1rem] opacity-90">Tra cứu các nghị định, chính sách, chỉ thị về công tác quản lý thi hành án hình sự và tái hòa nhập cộng đồng</p>
      </div>
    </section>

    <!-- Main Content -->
    <section class="section">
      <!-- `minmax(0,1fr)` chứ không `1fr`: một trích yếu dài không có chỗ ngắt sẽ đẩy
           cột chính rộng hơn khung chứa nó và làm cả trang cuộn ngang được. -->
      <div class="container grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_290px] lg:gap-[34px]">
        <!-- Cột chính -->
        <div class="flex flex-col gap-6">
          <SectionBar icon="fa-solid fa-file-contract" title="Văn bản pháp luật mới" />

          <!-- Search Bar -->
          <form class="flex flex-col gap-3 bg-white p-4 rounded-lg border border-[#E2E8DF] shadow-sm sm:flex-row" @submit.prevent="applySearch">
            <label class="sr-only" for="doc-search">Tìm kiếm văn bản</label>
            <input
              id="doc-search"
              v-model="searchInput"
              type="search"
              placeholder="Nhập từ khóa tìm kiếm văn bản (Ví dụ: 49/2020, vay vốn, xóa án tích...)"
              class="flex-1 px-3 py-3 border border-[#E2E8DF] rounded text-[0.95rem] outline-none focus:border-[#7CB342] font-[inherit] transition-colors duration-200"
            />
            <button type="submit" class="btn btn-primary w-full sm:w-auto">Tìm kiếm</button>
          </form>

          <!-- Loading — hình dạng khớp thẻ văn bản thật, không phải năm vạch xám. -->
          <div v-if="pending" role="status" aria-busy="true" class="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <span class="sr-only">Đang tải danh sách văn bản</span>
            <div
              v-for="n in 6"
              :key="n"
              aria-hidden="true"
              class="bg-white rounded-lg border border-[#E2E8DF] shadow-sm p-5 flex flex-col gap-3 animate-pulse motion-reduce:animate-none"
            >
              <div class="h-[18px] w-24 bg-[#EEF2EC] rounded-full"></div>
              <div class="h-4 w-4/5 bg-[#EEF2EC] rounded"></div>
              <div class="h-3 w-full bg-[#EEF2EC] rounded"></div>
              <div class="h-3 w-2/3 bg-[#EEF2EC] rounded"></div>
            </div>
          </div>

          <!-- Error -->
          <div
            v-else-if="loadError"
            role="alert"
            class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]"
          >
            <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
            Không thể tải văn bản. Vui lòng
            <button type="button" class="text-[#4A6741] font-bold underline" @click="refresh()">thử lại</button>.
          </div>

          <!-- Empty -->
          <div v-else-if="docs.length === 0" class="bg-white border border-dashed border-[#E2E8DF] px-6 py-10 rounded-lg text-center text-[#7A8675] text-[0.95rem]">
            Không tìm thấy văn bản phù hợp<span v-if="searchQuery"> với từ khóa &laquo;{{ searchQuery }}&raquo;</span>.
          </div>

          <template v-else>
            <p class="text-[0.9rem] text-[#7A8675] m-0">
              {{ docs.length }} văn bản<span v-if="searchQuery"> khớp từ khóa &laquo;{{ searchQuery }}&raquo;</span>
            </p>

            <!-- Lưới thẻ văn bản thay cho bảng bốn cột.
                 Bảng buộc mọi hàng vào cùng một chiều cao và trên điện thoại thì nó
                 cuộn ngang — tức là loại văn bản và ngày ban hành nằm ngoài màn hình
                 đúng lúc người dân cần chúng nhất. -->
            <div class="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <article
                v-for="doc in docs"
                :key="doc.id"
                class="group bg-white rounded-lg border border-[#E2E8DF] shadow-sm p-5 flex flex-col gap-3 border-l-4 border-l-[#7CB342] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-[#7CB342]"
              >
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span class="inline-flex items-center gap-1.5 bg-[#F8FAF7] text-[#4A6741] px-[10px] py-[4px] rounded text-[0.72rem] font-bold uppercase tracking-[0.4px]">
                    <i class="fa-solid fa-file-lines" aria-hidden="true"></i>{{ doc.categoryName || 'Văn bản' }}
                  </span>
                  <span class="text-[0.78rem] text-[#7A8675] font-semibold">Ban hành: {{ formatDate(doc) }}</span>
                </div>
                <h3 class="text-[1.02rem] font-bold leading-[1.45] m-0">
                  <nuxt-link
                    :to="`/news/${doc.slug}`"
                    class="no-underline text-[#1E251C] transition-colors duration-300 hover:text-[#4A6741]"
                  >{{ doc.title }}</nuxt-link>
                </h3>
                <p v-if="doc.excerpt" class="text-[0.87rem] text-[#4A5545] leading-[1.6] m-0 line-clamp-3">{{ doc.excerpt }}</p>
                <nuxt-link
                  :to="`/news/${doc.slug}`"
                  class="text-[#7CB342] font-bold no-underline text-[0.85rem] mt-auto pt-1 self-start"
                >Xem toàn văn &rarr;</nuxt-link>
              </article>
            </div>
          </template>
        </div>

        <!-- Cột phải: đường đi tiếp cho người không tìm thấy văn bản cần.
             Cố ý KHÔNG dựng một bộ lọc "loại văn bản" ở đây: nó chỉ lọc được trong
             số bản ghi đã tải, nên nó sẽ trông như lọc toàn bộ kho mà thật ra không —
             một bộ lọc nói dối tệ hơn không có bộ lọc nào. -->
        <aside class="flex flex-col gap-5 lg:sticky lg:top-[100px] lg:self-start">
          <div class="bg-white rounded-lg border border-[#E2E8DF] shadow-sm px-5 py-5">
            <h3 class="text-[0.8rem] font-extrabold text-[#4A6741] uppercase tracking-[0.6px] pb-2 mb-3 border-b-2 border-[#E2E8DF] m-0">Tra cứu nhanh</h3>
            <ul class="list-none p-0 m-0 flex flex-col">
              <li v-for="link in quickLinks" :key="link.to" class="border-b border-[#E2E8DF] last:border-b-0">
                <nuxt-link
                  :to="link.to"
                  class="flex items-start gap-3 py-[13px] no-underline text-[#1E251C] transition-colors duration-300 hover:text-[#4A6741]"
                >
                  <i :class="link.icon" class="text-[#7CB342] mt-[3px] w-[16px] text-center" aria-hidden="true"></i>
                  <span class="min-w-0">
                    <span class="block text-[0.9rem] font-bold leading-[1.35]">{{ link.title }}</span>
                    <span class="block text-[0.78rem] text-[#7A8675] leading-[1.45] mt-[3px]">{{ link.description }}</span>
                  </span>
                </nuxt-link>
              </li>
            </ul>
          </div>

          <div class="relative rounded-lg overflow-hidden px-5 py-6 text-white shadow-sm bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover">
            <div class="absolute inset-0 bg-[rgba(74,103,65,0.92)]"></div>
            <div class="relative">
              <h3 class="text-[0.98rem] font-extrabold uppercase m-0 mb-2">Cần hướng dẫn thủ tục?</h3>
              <p class="text-[0.8rem] leading-[1.5] m-0 mb-4 opacity-90">
                Liên hệ Công an xã/phường nơi cư trú, hoặc đặt câu hỏi cho Trợ lý ảo để được chỉ dẫn theo từng trường hợp.
              </p>
              <nuxt-link
                to="/assistant"
                class="inline-block bg-[#7CB342] text-white px-4 py-2 rounded text-[0.85rem] font-extrabold no-underline transition-colors duration-300 hover:bg-white hover:text-[#4A6741]"
              >Hỏi Trợ lý ảo &rarr;</nuxt-link>
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
  title: 'Văn bản pháp luật | Con Đường Hướng Thiện',
  description: 'Tra cứu văn bản quy phạm pháp luật về thi hành án hình sự, chính sách tín dụng và tái hòa nhập cộng đồng.'
})

const route = useRoute()
const searchQuery = ref(route.query.q ? String(route.query.q) : '')
const searchInput = ref(searchQuery.value)

const quickLinks = [
  { to: '/qa-documents', icon: 'fa-solid fa-book-open', title: 'Tài liệu Hỏi – Đáp', description: 'Nội dung đã được Cục C11 phê duyệt' },
  { to: '/legal-qa', icon: 'fa-solid fa-circle-question', title: 'Giải đáp pháp luật', description: 'Câu hỏi thường gặp theo từng thủ tục' },
  { to: '/reintegration-models', icon: 'fa-solid fa-trophy', title: 'Mô hình tái hòa nhập', description: 'Quỹ vốn, học nghề, liên kết việc làm' },
  { to: '/contact', icon: 'fa-solid fa-headset', title: 'Đăng ký tư vấn 24/7', description: 'Gửi yêu cầu để cán bộ liên hệ lại' },
]

const articlesQuery = computed(() => {
  // Khai kiểu tường minh: một object literal suy ra `{type,limit}` nên phép gán
  // `q.search` bên dưới không biên dịch được. `search` là tuỳ chọn vì bỏ hẳn khoá
  // khi không tìm gì khác với gửi khoá rỗng — `?search=` sẽ vào bộ nhớ đệm dưới
  // một khoá khác cho cùng một danh sách.
  const q: { type: string; limit: number; search?: string } = { type: 'document', limit: 50 }
  if (searchQuery.value) q.search = searchQuery.value
  return q
})
// Xem ghi chú ở role-models/index.vue. Ở trang này `lazy` còn quan trọng hơn:
// mỗi lần tìm kiếm là một lượt fetch mới, và không có nó thì ô tìm kiếm đứng im
// cho tới khi kết quả về.
const { data, pending, error, refresh } = useFetch('/api/public/articles', {
  query: articlesQuery,
  lazy: true,
  default: () => ({ ok: true, articles: [], pagination: {} })
})
const docs = computed(() => data.value?.articles || [])
const loadError = computed(() => !!error.value || data.value?.ok === false)

const applySearch = () => {
  searchQuery.value = searchInput.value.trim()
  navigateTo({ path: '/documents', query: searchQuery.value ? { q: searchQuery.value } : {} })
}

const formatDate = (item: { publishedAt?: string | null; createdAt?: string | null }) =>
  formatDateVN(item.publishedAt || item.createdAt)
</script>
