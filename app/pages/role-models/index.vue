<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero Header -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <!-- Gradient thay cho một mảng phẳng rgba(74,103,65,0.9): mảng phẳng gần như
           xoá hẳn tấm ảnh mà trang vẫn phải tải về. -->
      <div class="absolute inset-0 bg-[linear-gradient(180deg,rgba(30,45,26,0.72)_0%,rgba(74,103,65,0.92)_55%,rgba(74,103,65,0.95)_100%)]"></div>
      <div class="container relative z-10">
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">Tấm Gương Tiêu Biểu</h2>
        <p class="text-[1.1rem] opacity-90">Hành trình vươn lên từ lầm lỡ, khẳng định giá trị bản thân và đóng góp tích cực cho cộng đồng</p>
      </div>
    </section>

    <!-- Main List -->
    <section class="section">
      <div class="container">
        <SectionBar icon="fa-solid fa-star" title="Những tấm gương hoàn lương" />

        <!-- Loading — hình dạng khớp bố cục thật: một câu chuyện chủ đạo bên trái,
             cột tiêu đề bên phải, rồi lưới thẻ bên dưới. -->
        <div v-if="pending" role="status" aria-busy="true" class="flex flex-col gap-8">
          <span class="sr-only">Đang tải danh sách tấm gương hoàn lương</span>
          <div aria-hidden="true" class="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_minmax(0,1fr)]">
            <div class="bg-white rounded-lg overflow-hidden border border-[#E2E8DF] shadow-sm animate-pulse motion-reduce:animate-none">
              <div class="h-[240px] sm:h-[330px] bg-[#EEF2EC]"></div>
              <div class="p-5 flex flex-col gap-3">
                <div class="h-3 w-28 bg-[#EEF2EC] rounded"></div>
                <div class="h-5 w-4/5 bg-[#EEF2EC] rounded"></div>
                <div class="h-3 w-full bg-[#EEF2EC] rounded"></div>
              </div>
            </div>
            <div class="bg-white rounded-lg border border-[#E2E8DF] shadow-sm p-5 flex flex-col gap-5 animate-pulse motion-reduce:animate-none">
              <div v-for="n in 3" :key="n" class="flex gap-3">
                <div class="w-[56px] h-[56px] rounded-full bg-[#EEF2EC] shrink-0"></div>
                <div class="flex-1 flex flex-col gap-2">
                  <div class="h-4 w-full bg-[#EEF2EC] rounded"></div>
                  <div class="h-3 w-2/3 bg-[#EEF2EC] rounded"></div>
                </div>
              </div>
            </div>
          </div>
          <div aria-hidden="true" class="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            <div v-for="n in 3" :key="n" class="bg-white rounded-lg border border-[#E2E8DF] shadow-sm p-5 flex flex-col items-center gap-3 animate-pulse motion-reduce:animate-none">
              <div class="w-[92px] h-[92px] rounded-full bg-[#EEF2EC]"></div>
              <div class="h-4 w-3/4 bg-[#EEF2EC] rounded"></div>
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
          Không thể tải danh sách. Vui lòng
          <button type="button" class="text-[#4A6741] font-bold underline" @click="refresh()">thử lại</button>.
        </div>

        <!-- Empty -->
        <div v-else-if="roleModels.length === 0" class="bg-white border border-dashed border-[#E2E8DF] px-6 py-10 rounded-lg text-center text-[#7A8675] text-[0.95rem]">
          Chưa có tấm gương nào được đăng tải.
        </div>

        <template v-else>
          <!-- Câu chuyện chủ đạo + cột những câu chuyện kế tiếp.
               `minmax(0,1fr)` chứ không `1fr`: một tiêu đề dài không có chỗ ngắt sẽ
               đẩy cột rộng hơn khung chứa nó và làm cả trang cuộn ngang được. -->
          <div class="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_minmax(0,1fr)]">
            <article
              v-if="featured"
              class="group bg-white rounded-lg overflow-hidden border border-[#E2E8DF] shadow-sm transition-all duration-300 hover:shadow-md hover:border-[#7CB342]"
            >
              <nuxt-link :to="`/role-models/${featured.slug}`" class="block no-underline">
                <div class="relative h-[240px] sm:h-[330px] overflow-hidden">
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
                      <span class="inline-block bg-[#7CB342] text-white px-2 py-[3px] text-[0.65rem] font-extrabold rounded-sm uppercase tracking-[0.4px]">Câu chuyện nổi bật</span>
                      <span v-if="featured.categoryName" class="text-[0.74rem] font-semibold opacity-90">{{ featured.categoryName }}</span>
                    </div>
                    <h3 class="text-[1.2rem] sm:text-[1.42rem] font-extrabold leading-[1.3] mb-2 text-white transition-colors duration-300 group-hover:text-[#c5e1a5]">{{ featured.title }}</h3>
                    <p v-if="featured.excerpt" class="text-[0.86rem] leading-[1.55] opacity-[0.88] m-0 line-clamp-2">{{ featured.excerpt }}</p>
                  </div>
                </div>
              </nuxt-link>
            </article>

            <!-- Cột kế tiếp: chân dung nhỏ cạnh tiêu đề, để mắt quét nhanh nhiều
                 câu chuyện thay vì cuộn qua từng thẻ lớn. -->
            <div v-if="headlines.length" class="bg-white rounded-lg border border-[#E2E8DF] shadow-sm px-5 py-2">
              <h3 class="text-[0.8rem] font-extrabold text-[#4A6741] uppercase tracking-[0.6px] pt-3 pb-2 border-b-2 border-[#E2E8DF] m-0">Câu chuyện kế tiếp</h3>
              <ul class="list-none p-0 m-0">
                <li
                  v-for="item in headlines"
                  :key="item.id"
                  class="group flex gap-3 py-[14px] border-b border-[#E2E8DF] last:border-b-0"
                >
                  <nuxt-link
                    :to="`/role-models/${item.slug}`"
                    class="w-[56px] h-[56px] rounded-full overflow-hidden border-2 border-[#F8FAF7] shrink-0"
                    :aria-label="item.title"
                  >
                    <img
                      :src="item.thumbnailUrl || '/assets/hero_banner.jpg'"
                      :alt="item.title"
                      class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
                      loading="lazy"
                      decoding="async"
                    />
                  </nuxt-link>
                  <div class="min-w-0">
                    <h4 class="text-[0.9rem] font-bold leading-[1.4] m-0 mb-[5px]">
                      <nuxt-link
                        :to="`/role-models/${item.slug}`"
                        class="text-[#1E251C] no-underline transition-colors duration-300 hover:text-[#4A6741]"
                      >{{ item.title }}</nuxt-link>
                    </h4>
                    <span v-if="item.categoryName" class="text-[0.72rem] text-[#7A8675] font-semibold">{{ item.categoryName }}</span>
                  </div>
                </li>
              </ul>
            </div>
          </div>

          <!-- Lưới những tấm gương còn lại -->
          <template v-if="rest.length">
            <h3 class="text-[0.85rem] font-extrabold text-[#4A6741] uppercase tracking-[0.6px] border-b-2 border-[#E2E8DF] pb-2 mt-8 mb-6">Các tấm gương khác</h3>
            <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              <article
                v-for="item in rest"
                :key="item.id"
                class="group bg-white rounded-lg border border-[#E2E8DF] shadow-sm p-5 flex flex-col items-center text-center transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-[#7CB342]"
              >
                <nuxt-link
                  :to="`/role-models/${item.slug}`"
                  class="w-[92px] h-[92px] rounded-full overflow-hidden border-4 border-[#F8FAF7] shrink-0 mb-3"
                  :aria-label="item.title"
                >
                  <img
                    :src="item.thumbnailUrl || '/assets/hero_banner.jpg'"
                    :alt="item.title"
                    class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
                    loading="lazy"
                    decoding="async"
                  />
                </nuxt-link>
                <span v-if="item.categoryName" class="text-[0.72rem] font-bold text-[#4A6741] bg-[#F8FAF7] px-[10px] py-[4px] rounded mb-2">{{ item.categoryName }}</span>
                <h4 class="text-[1.02rem] font-bold leading-[1.4] m-0 mb-2">
                  <nuxt-link
                    :to="`/role-models/${item.slug}`"
                    class="no-underline text-[#1E251C] transition-colors duration-300 hover:text-[#4A6741]"
                  >{{ item.title }}</nuxt-link>
                </h4>
                <p v-if="item.excerpt" class="text-[0.86rem] text-[#4A5545] leading-[1.6] m-0 mb-3 line-clamp-3">{{ item.excerpt }}</p>
                <nuxt-link
                  :to="`/role-models/${item.slug}`"
                  class="text-[#7CB342] font-bold no-underline text-[0.85rem] mt-auto"
                >Đọc câu chuyện &rarr;</nuxt-link>
              </article>
            </div>
          </template>
        </template>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

useSeoMeta({
  title: 'Tấm gương tiêu biểu | Con Đường Hướng Thiện',
  description: 'Những tấm gương hoàn lương lập nghiệp thành công sau khi chấp hành xong án phạt tù.'
})

// `lazy` chỉ bỏ chặn điều hướng phía client — lượt dựng phía máy chủ vẫn chờ dữ
// liệu, nên HTML đầu tiên và thẻ SEO không đổi. Khung xương `v-if="pending"` ở
// trên vốn đã có; thiếu `lazy` thì nó không bao giờ được vẽ vì router giữ lại
// trang cũ cho tới khi fetch xong.
const { data, pending, error, refresh } = useFetch('/api/public/articles', {
  query: { type: 'role_model', limit: 30 },
  lazy: true,
  default: () => ({ ok: true, articles: [], pagination: {} })
})
const roleModels = computed(() => data.value?.articles || [])
const loadError = computed(() => !!error.value || data.value?.ok === false)

// Ba khu của bố cục, cắt từ MỘT danh sách đã tải. Cố ý không gọi thêm lượt fetch
// nào: endpoint đã sắp theo `publishedAt` giảm dần, nên câu chuyện chủ đạo là câu
// mới nhất — một truy vấn thứ hai cho cùng dữ liệu là một lượt đi mạng nữa và một
// cơ hội để hai khu nói hai điều khác nhau.
const featured = computed(() => roleModels.value[0] ?? null)
const headlines = computed(() => roleModels.value.slice(1, 4))
const rest = computed(() => roleModels.value.slice(4))
</script>
