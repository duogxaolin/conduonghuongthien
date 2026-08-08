<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero Header -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-10">
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">Tấm Gương Tiêu Biểu</h2>
        <p class="text-[1.1rem] opacity-90">Hành trình vươn lên từ lầm lỡ, khẳng định giá trị bản thân và đóng góp tích cực cho cộng đồng</p>
      </div>
    </section>

    <!-- Main List -->
    <section class="py-12">
      <div class="container">
        <SectionBar icon="fa-solid fa-star" title="Những tấm gương hoàn lương" />

        <!-- Loading -->
        <div v-if="pending" class="flex flex-col gap-[30px] max-w-[900px] mx-auto">
          <div v-for="n in 3" :key="n" class="bg-white rounded-lg p-5 sm:p-[30px] flex flex-col md:flex-row items-center gap-5 sm:gap-[30px] shadow-sm border border-[#E2E8DF] animate-pulse motion-reduce:animate-none">
            <div class="w-24 h-24 sm:w-[140px] sm:h-[140px] rounded-full bg-[#EEF2EC] shrink-0"></div>
            <div class="flex-1 flex flex-col gap-3 w-full">
              <div class="h-3 w-32 bg-[#EEF2EC] rounded"></div>
              <div class="h-4 w-3/4 bg-[#EEF2EC] rounded"></div>
              <div class="h-3 w-full bg-[#EEF2EC] rounded"></div>
            </div>
          </div>
        </div>

        <!-- Error -->
        <div v-else-if="loadError" class="max-w-[900px] mx-auto bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]">
          <i class="fa-solid fa-triangle-exclamation mr-2"></i>
          Không thể tải danh sách. Vui lòng <button class="text-[#4A6741] font-bold underline" @click="refresh()">thử lại</button>.
        </div>

        <!-- Empty -->
        <div v-else-if="roleModels.length === 0" class="max-w-[900px] mx-auto bg-white border border-dashed border-[#E2E8DF] px-6 py-10 rounded-lg text-center text-[#7A8675] text-[0.95rem]">
          Chưa có tấm gương nào được đăng tải.
        </div>

        <!-- List -->
        <div v-else class="flex flex-col gap-[30px] max-w-[900px] mx-auto">
          <div
            v-for="item in roleModels"
            :key="item.id"
            class="bg-white rounded-lg p-5 sm:p-[30px] flex flex-col items-center text-center gap-5 sm:gap-[30px] shadow-sm border border-[#E2E8DF] transition-all duration-300 hover:shadow-md hover:border-[#7CB342] md:flex-row md:items-start md:text-left"
          >
            <div class="w-24 h-24 sm:w-[140px] sm:h-[140px] rounded-full overflow-hidden border-4 border-[#F8FAF7] shrink-0">
              <img :src="item.thumbnailUrl || '/assets/hero_banner.jpg'" :alt="item.title" class="w-full h-full object-cover"  loading="lazy" decoding="async" />
            </div>
            <div>
              <span v-if="item.categoryName" class="text-[0.8rem] font-bold text-[#4A6741] bg-[#F8FAF7] px-[10px] py-[4px] rounded inline-block mb-[10px]">📍 {{ item.categoryName }}</span>
              <h3 class="text-[1.3rem] font-bold mb-3 text-[#1E251C]">{{ item.title }}</h3>
              <p class="text-[0.95rem] text-[#4A5545] leading-[1.6] mb-5">{{ item.excerpt }}</p>
              <nuxt-link :to="`/role-models/${item.slug}`" class="btn btn-outline">Đọc câu chuyện hoàn lương &rarr;</nuxt-link>
            </div>
          </div>
        </div>
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
</script>
