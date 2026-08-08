<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero Header -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-10">
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">Mô Hình Tái Hòa Nhập Cộng Đồng</h2>
        <p class="text-[1.1rem] opacity-90">Các mô hình kinh tế tập thể, quỹ hỗ trợ nhân văn giúp người hoàn lương ổn định cuộc sống</p>
      </div>
    </section>

    <!-- Main List -->
    <section class="py-12">
      <div class="container">
        <SectionBar icon="fa-solid fa-trophy" title="Các mô hình tiêu biểu" />

        <!-- Loading -->
        <div v-if="pending" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[30px]">
          <div v-for="n in 6" :key="n" class="bg-white rounded-lg px-[30px] py-[40px] shadow-sm border border-[#E2E8DF] animate-pulse motion-reduce:animate-none flex flex-col gap-4">
            <div class="h-3 w-28 bg-[#EEF2EC] rounded"></div>
            <div class="h-5 w-3/4 bg-[#EEF2EC] rounded"></div>
            <div class="h-3 w-full bg-[#EEF2EC] rounded"></div>
            <div class="h-3 w-2/3 bg-[#EEF2EC] rounded"></div>
          </div>
        </div>

        <!-- Error -->
        <div v-else-if="loadError" class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]">
          <i class="fa-solid fa-triangle-exclamation mr-2"></i>
          Không thể tải danh sách mô hình. Vui lòng <button class="text-[#4A6741] font-bold underline" @click="refresh()">thử lại</button>.
        </div>

        <!-- Empty -->
        <div v-else-if="models.length === 0" class="bg-white border border-dashed border-[#E2E8DF] px-6 py-10 rounded-lg text-center text-[#7A8675] text-[0.95rem]">
          Chưa có mô hình nào được đăng tải.
        </div>

        <!-- List -->
        <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[30px]">
          <div
            v-for="item in models"
            :key="item.id"
            class="bg-white rounded-lg px-[30px] py-[40px] shadow-sm border border-[#E2E8DF] flex flex-col justify-between transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-[#7CB342]"
          >
            <div class="flex flex-col flex-grow">
              <span class="text-[0.75rem] font-bold text-[#4A6741] uppercase tracking-wide mb-[10px] block">💡 {{ item.categoryName || 'Mô hình tiêu biểu' }}</span>
              <h3 class="text-[1.25rem] font-bold text-[#1E251C] mb-4 leading-[1.4]">{{ item.title }}</h3>
              <p class="text-[0.92rem] text-[#4A5545] leading-[1.6] mb-6 flex-grow">{{ item.excerpt }}</p>
            </div>
            <nuxt-link
              :to="`/reintegration-models/${item.slug}`"
              class="text-[#7CB342] font-bold no-underline text-[0.9rem] transition-all duration-300 hover:text-[#4A6741]"
            >Xem chi tiết mô hình &rarr;</nuxt-link>
          </div>
        </div>
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

// Xem ghi chú ở role-models/index.vue.
const { data, pending, error, refresh } = useFetch('/api/public/articles', {
  query: { type: 'reintegration', limit: 30 },
  lazy: true,
  default: () => ({ ok: true, articles: [], pagination: {} })
})
const models = computed(() => data.value?.articles || [])
const loadError = computed(() => !!error.value || data.value?.ok === false)
</script>
