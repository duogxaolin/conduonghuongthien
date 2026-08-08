<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <!-- Gradient thay cho một mảng phẳng rgba(74,103,65,0.9): mảng phẳng gần như
           xoá hẳn tấm ảnh mà trang vẫn phải tải về. -->
      <div class="absolute inset-0 bg-[linear-gradient(180deg,rgba(30,45,26,0.72)_0%,rgba(74,103,65,0.92)_55%,rgba(74,103,65,0.95)_100%)]"></div>
      <div class="container relative z-[2]">
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">Giải Đáp Pháp Luật</h2>
        <p class="text-[1.1rem] opacity-90">Ngân hàng câu hỏi đáp pháp luật, quy trình thủ tục hành chính hỗ trợ xóa án tích, vay vốn</p>
      </div>
    </section>

    <!-- Content -->
    <section class="section">
      <!-- `minmax(0,1fr)` chứ không `1fr`: một câu hỏi dài không có chỗ ngắt sẽ đẩy
           cột chính rộng hơn khung chứa nó và làm cả trang cuộn ngang được. -->
      <div class="container grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-[34px]">
        <div>
          <SectionBar icon="fa-solid fa-circle-question" title="Câu hỏi thường gặp" />
          <div class="flex flex-col gap-4">
            <!-- Loading -->
            <div v-if="pending" role="status" aria-busy="true" class="flex flex-col gap-4">
              <span class="sr-only">Đang tải câu hỏi thường gặp</span>
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
            <div v-else-if="loadError" role="alert" class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]">
              <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
              Không thể tải câu hỏi. Vui lòng <button type="button" class="text-[#4A6741] font-bold underline" @click="refresh()">thử lại</button>.
            </div>

            <!-- Empty -->
            <div v-else-if="faqs.length === 0" class="bg-white border border-dashed border-[#E2E8DF] px-6 py-10 rounded-lg text-center text-[#7A8675] text-[0.95rem]">
              Chưa có câu hỏi nào được đăng tải.
            </div>

            <!-- List -->
            <template v-else>
              <div
                v-for="(item, index) in faqs"
                :key="item.id"
                class="bg-white rounded-lg overflow-hidden transition-all duration-300"
                :class="activeIndex === index
                  ? 'border border-[#4A6741] shadow-sm'
                  : 'border border-[#E2E8DF]'"
              >
                <button
                  :id="`faq-question-${item.id}`"
                  type="button"
                  :aria-expanded="activeIndex === index"
                  :aria-controls="`faq-answer-${item.id}`"
                  class="w-full px-6 py-5 flex justify-between items-center bg-transparent border-none font-[inherit] text-base font-bold text-left cursor-pointer transition-colors duration-200 hover:text-[#4A6741] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7CB342]"
                  :class="activeIndex === index ? 'text-[#4A6741]' : 'text-[#1E251C]'"
                  @click="toggleFaq(index)"
                >
                  <span>{{ item.title }}</span>
                  <span class="text-[1.4rem] text-[#7A8675]" aria-hidden="true">{{ activeIndex === index ? '−' : '+' }}</span>
                </button>
                <!-- The panel is deliberately not a landmark: the APG advises against
                     the region landmark once an accordion can hold more than about
                     six panels, and this list renders up to 50. -->
                <div
                  v-show="activeIndex === index"
                  :id="`faq-answer-${item.id}`"
                  class="px-6 pb-5 pt-0 text-[0.95rem] text-[#4A5545] leading-[1.6] border-t border-[#E2E8DF] bg-[#F8FAF7]"
                >
                  <p>{{ item.excerpt }}</p>
                  <nuxt-link
                    v-if="item.slug"
                    :to="`/news/${item.slug}`"
                    class="inline-block mt-3 text-[#7CB342] font-bold no-underline text-[0.88rem]"
                  >Xem chi tiết &rarr;</nuxt-link>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Cột phải: đường đi tiếp cho người không tìm thấy câu trả lời trong danh
             sách rút gọn này. -->
        <aside class="flex flex-col gap-5 lg:sticky lg:top-[100px] lg:self-start">
          <div class="bg-white rounded-lg border border-[#E2E8DF] shadow-sm px-5 py-5">
            <h3 class="text-[0.8rem] font-extrabold text-[#4A6741] uppercase tracking-[0.6px] pb-2 mb-3 border-b-2 border-[#E2E8DF] m-0">Xem thêm</h3>
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
              <h3 class="text-[0.98rem] font-extrabold uppercase m-0 mb-2">Không thấy câu trả lời?</h3>
              <p class="text-[0.8rem] leading-[1.5] m-0 mb-4 opacity-90">
                Đặt câu hỏi trực tiếp cho Trợ lý ảo hoặc liên hệ Công an xã/phường nơi cư trú.
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

useSeoMeta({
  title: 'Giải đáp pháp luật | Con Đường Hướng Thiện',
  description: 'Giải đáp các câu hỏi pháp lý thường gặp về xóa án tích, vay vốn ưu đãi, học nghề cho người hoàn lương.'
})

const quickLinks = [
  { to: '/qa-documents', icon: 'fa-solid fa-book-open', title: 'Tài liệu Hỏi – Đáp', description: 'Nội dung đã được Cục C11 phê duyệt' },
  { to: '/documents', icon: 'fa-solid fa-file-contract', title: 'Văn bản pháp luật', description: 'Nghị định, chính sách liên quan' },
  { to: '/reintegration-models', icon: 'fa-solid fa-trophy', title: 'Mô hình tái hòa nhập', description: 'Quỹ vốn, học nghề, liên kết việc làm' },
  { to: '/contact', icon: 'fa-solid fa-headset', title: 'Đăng ký tư vấn 24/7', description: 'Gửi yêu cầu để cán bộ liên hệ lại' },
]

// `ref(null)` trần suy ra `Ref<null>`, nên phép gán một chỉ số ở `toggleFaq`
// không biên dịch được. Chỉ MỘT mục mở tại một thời điểm ở trang này là có chủ
// đích (khác `/qa-documents` dùng `Set` để mở nhiều) — `null` là "đang đóng hết".
const activeIndex = ref<number | null>(null)

// Xem ghi chú ở role-models/index.vue: `lazy` chỉ bỏ chặn điều hướng phía client,
// lượt dựng phía máy chủ vẫn chờ dữ liệu nên SEO không đổi.
const { data, pending, error, refresh } = useFetch('/api/public/articles', {
  query: { type: 'faq', limit: 50 },
  lazy: true,
  default: () => ({ ok: true, articles: [], pagination: {} })
})
const faqs = computed(() => data.value?.articles || [])
const loadError = computed(() => !!error.value || data.value?.ok === false)

const toggleFaq = (index: number) => {
  activeIndex.value = activeIndex.value === index ? null : index
}
</script>
