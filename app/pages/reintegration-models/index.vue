<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero Header -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <!-- Gradient thay cho một mảng phẳng rgba(74,103,65,0.9): mảng phẳng gần như
           xoá hẳn tấm ảnh mà trang vẫn phải tải về. -->
      <div class="absolute inset-0 bg-[linear-gradient(180deg,rgba(30,45,26,0.72)_0%,rgba(74,103,65,0.92)_55%,rgba(74,103,65,0.95)_100%)]"></div>
      <div class="container relative z-10">
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">Mô Hình Tái Hòa Nhập Cộng Đồng</h2>
        <p class="text-[1.1rem] opacity-90">Các mô hình kinh tế tập thể, quỹ hỗ trợ nhân văn giúp người hoàn lương ổn định cuộc sống</p>
      </div>
    </section>

    <!-- Main Content -->
    <section class="section">
      <!-- `minmax(0,1fr)` chứ không `1fr`: một tiêu đề dài không có chỗ ngắt sẽ đẩy
           cột chính rộng hơn khung chứa nó và làm cả trang cuộn ngang được. -->
      <div class="container grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-[34px]">
        <div class="flex flex-col gap-6">
          <SectionBar icon="fa-solid fa-trophy" title="Các mô hình tiêu biểu" />

          <!-- Loading — hình dạng khớp bố cục thật: một mô hình chủ đạo, rồi lưới thẻ. -->
          <div v-if="pending" role="status" aria-busy="true" class="flex flex-col gap-6">
            <span class="sr-only">Đang tải danh sách mô hình tái hòa nhập</span>
            <div aria-hidden="true" class="bg-white rounded-lg overflow-hidden border border-[#E2E8DF] shadow-sm animate-pulse motion-reduce:animate-none lg:flex">
              <div class="h-[200px] lg:h-auto lg:w-[340px] shrink-0 bg-[#EEF2EC]"></div>
              <div class="p-6 flex flex-col gap-3 flex-1">
                <div class="h-3 w-28 bg-[#EEF2EC] rounded"></div>
                <div class="h-5 w-3/4 bg-[#EEF2EC] rounded"></div>
                <div class="h-3 w-full bg-[#EEF2EC] rounded"></div>
                <div class="h-3 w-2/3 bg-[#EEF2EC] rounded"></div>
              </div>
            </div>
            <div aria-hidden="true" class="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div v-for="n in 4" :key="n" class="bg-white rounded-lg px-6 py-8 shadow-sm border border-[#E2E8DF] animate-pulse motion-reduce:animate-none flex flex-col gap-4">
                <div class="h-3 w-28 bg-[#EEF2EC] rounded"></div>
                <div class="h-5 w-3/4 bg-[#EEF2EC] rounded"></div>
                <div class="h-3 w-full bg-[#EEF2EC] rounded"></div>
                <div class="h-3 w-2/3 bg-[#EEF2EC] rounded"></div>
              </div>
            </div>
          </div>

          <!-- Error -->
          <div
            v-else-if="loadError"
            role="alert"
            class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]"
          >
            <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
            Không thể tải danh sách mô hình. Vui lòng
            <button type="button" class="text-[#4A6741] font-bold underline" @click="refresh()">thử lại</button>.
          </div>

          <!-- Empty -->
          <div v-else-if="models.length === 0" class="bg-white border border-dashed border-[#E2E8DF] px-6 py-10 rounded-lg text-center text-[#7A8675] text-[0.95rem]">
            Chưa có mô hình nào được đăng tải.
          </div>

          <template v-else>
            <!-- Mô hình chủ đạo: ảnh lớn nằm ngang, khác hẳn nhịp của lưới thẻ bên
                 dưới nên trang không đọc như một danh sách phẳng lặp lại. -->
            <article
              v-if="featured"
              class="group bg-white rounded-lg overflow-hidden border border-[#E2E8DF] shadow-sm transition-all duration-300 hover:shadow-md hover:border-[#7CB342] lg:flex"
            >
              <nuxt-link :to="`/reintegration-models/${featured.slug}`" class="block h-[200px] lg:h-auto lg:w-[340px] shrink-0 overflow-hidden">
                <img
                  :src="featured.thumbnailUrl || '/assets/hero_banner.jpg'"
                  :alt="featured.title"
                  class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  loading="lazy"
                  decoding="async"
                />
              </nuxt-link>
              <div class="p-6 flex flex-col flex-1">
                <span class="text-[0.75rem] font-bold text-[#4A6741] uppercase tracking-wide mb-[10px] inline-flex items-center gap-1.5">
                  <i class="fa-solid fa-star" aria-hidden="true"></i>{{ featured.categoryName || 'Mô hình tiêu biểu' }}
                </span>
                <h3 class="text-[1.3rem] font-bold text-[#1E251C] mb-3 leading-[1.4]">{{ featured.title }}</h3>
                <p v-if="featured.excerpt" class="text-[0.92rem] text-[#4A5545] leading-[1.6] mb-4 flex-grow line-clamp-3">{{ featured.excerpt }}</p>
                <nuxt-link
                  :to="`/reintegration-models/${featured.slug}`"
                  class="text-[#7CB342] font-bold no-underline text-[0.9rem] mt-auto transition-colors duration-300 group-hover:text-[#4A6741]"
                >Xem chi tiết mô hình &rarr;</nuxt-link>
              </div>
            </article>

            <!-- Lưới các mô hình còn lại -->
            <template v-if="rest.length">
              <h3 class="text-[0.85rem] font-extrabold text-[#4A6741] uppercase tracking-[0.6px] border-b-2 border-[#E2E8DF] pb-2 m-0">Các mô hình khác</h3>
              <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <article
                  v-for="item in rest"
                  :key="item.id"
                  class="bg-white rounded-lg px-6 py-8 shadow-sm border border-[#E2E8DF] flex flex-col justify-between transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-[#7CB342]"
                >
                  <div class="flex flex-col flex-grow">
                    <span class="text-[0.75rem] font-bold text-[#4A6741] uppercase tracking-wide mb-[10px] block">💡 {{ item.categoryName || 'Mô hình tiêu biểu' }}</span>
                    <h3 class="text-[1.15rem] font-bold text-[#1E251C] mb-3 leading-[1.4]">{{ item.title }}</h3>
                    <p v-if="item.excerpt" class="text-[0.9rem] text-[#4A5545] leading-[1.6] mb-5 flex-grow line-clamp-3">{{ item.excerpt }}</p>
                  </div>
                  <nuxt-link
                    :to="`/reintegration-models/${item.slug}`"
                    class="text-[#7CB342] font-bold no-underline text-[0.88rem] transition-all duration-300 hover:text-[#4A6741]"
                  >Xem chi tiết mô hình &rarr;</nuxt-link>
                </article>
              </div>
            </template>
          </template>
        </div>

        <!-- Cột phải: điều hướng sang những gì thường đi cùng một mô hình tái hoà
             nhập — vốn vay, việc làm, câu hỏi pháp lý. -->
        <aside class="flex flex-col gap-5 lg:sticky lg:top-[100px] lg:self-start">
          <div class="bg-white rounded-lg border border-[#E2E8DF] shadow-sm px-5 py-5">
            <h3 class="text-[0.8rem] font-extrabold text-[#4A6741] uppercase tracking-[0.6px] pb-2 mb-3 border-b-2 border-[#E2E8DF] m-0">Liên quan</h3>
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
              <h3 class="text-[0.98rem] font-extrabold uppercase m-0 mb-2">Cần hỗ trợ vốn hoặc việc làm?</h3>
              <p class="text-[0.8rem] leading-[1.5] m-0 mb-4 opacity-90">
                Đăng ký để cán bộ liên hệ và hướng dẫn theo mô hình phù hợp với hoàn cảnh cụ thể.
              </p>
              <nuxt-link
                to="/contact"
                class="inline-block bg-[#7CB342] text-white px-4 py-2 rounded text-[0.85rem] font-extrabold no-underline transition-colors duration-300 hover:bg-white hover:text-[#4A6741]"
              >Đăng ký tư vấn &rarr;</nuxt-link>
            </div>
          </div>
        </aside>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

useSeoMeta({
  title: 'Mô hình tái hòa nhập | Con Đường Hướng Thiện',
  description: 'Các mô hình tiêu biểu hỗ trợ người hoàn lương tái hòa nhập cộng đồng: quỹ tín dụng, câu lạc bộ, liên kết đào tạo nghề.'
})

const quickLinks = [
  { to: '/role-models', icon: 'fa-solid fa-star', title: 'Tấm gương tiêu biểu', description: 'Câu chuyện hoàn lương thành công' },
  { to: '/qa-documents', icon: 'fa-solid fa-book-open', title: 'Tài liệu Hỏi – Đáp', description: 'Nội dung đã được Cục C11 phê duyệt' },
  { to: '/documents', icon: 'fa-solid fa-file-contract', title: 'Văn bản pháp luật', description: 'Nghị định, chính sách liên quan' },
  { to: '/contact', icon: 'fa-solid fa-headset', title: 'Đăng ký tư vấn 24/7', description: 'Gửi yêu cầu để cán bộ liên hệ lại' },
]

// Xem ghi chú ở role-models/index.vue.
const { data, pending, error, refresh } = useFetch('/api/public/articles', {
  query: { type: 'reintegration', limit: 30 },
  lazy: true,
  default: () => ({ ok: true, articles: [], pagination: {} })
})
const models = computed(() => data.value?.articles || [])
const loadError = computed(() => !!error.value || data.value?.ok === false)

// Hai khu, cắt từ MỘT danh sách đã tải — cùng lý do như /news và /role-models:
// endpoint đã sắp theo `publishedAt` giảm dần, nên mô hình chủ đạo là mô hình mới
// nhất mà không cần một truy vấn thứ hai.
const featured = computed(() => models.value[0] ?? null)
const rest = computed(() => models.value.slice(1))
</script>
