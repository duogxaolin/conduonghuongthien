<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero Header -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-[2]">
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">Giải Đáp Pháp Luật</h2>
        <p class="text-[1.1rem] opacity-90">Ngân hàng câu hỏi đáp pháp luật, quy trình thủ tục hành chính hỗ trợ xóa án tích, vay vốn</p>
      </div>
    </section>

    <!-- Content -->
    <section class="section">
      <div class="container">
        <SectionBar icon="fa-solid fa-circle-question" title="Câu hỏi thường gặp" />
        <div class="max-w-[800px] mx-auto flex flex-col gap-4">
          <!-- Loading -->
          <template v-if="pending">
            <div v-for="n in 3" :key="n" class="bg-white rounded-lg border border-[#E2E8DF] px-6 py-5 animate-pulse">
              <div class="h-4 w-2/3 bg-[#EEF2EC] rounded"></div>
            </div>
          </template>

          <!-- Error -->
          <div v-else-if="loadError" class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]">
            <i class="fa-solid fa-triangle-exclamation mr-2"></i>
            Không thể tải câu hỏi. Vui lòng <button class="text-[#4A6741] font-bold underline" @click="refresh()">thử lại</button>.
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
                class="w-full px-6 py-5 flex justify-between items-center bg-transparent border-none font-[inherit] text-base font-bold text-left cursor-pointer transition-colors duration-200 hover:text-[#4A6741]"
                :class="activeIndex === index ? 'text-[#4A6741]' : 'text-[#1E251C]'"
                @click="toggleFaq(index)"
              >
                <span>{{ item.title }}</span>
                <span class="text-[1.4rem] text-[#7A8675]">{{ activeIndex === index ? '−' : '+' }}</span>
              </button>
              <div
                v-show="activeIndex === index"
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
    </section>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

useSeoMeta({
  title: 'Giải đáp pháp luật | Con Đường Hướng Thiện',
  description: 'Giải đáp các câu hỏi pháp lý thường gặp về xóa án tích, vay vốn ưu đãi, học nghề cho người hoàn lương.'
})

const activeIndex = ref(null)

const { data, pending, error, refresh } = await useFetch('/api/public/articles', {
  query: { type: 'faq', limit: 50 },
  default: () => ({ ok: true, articles: [], pagination: {} })
})
const faqs = computed(() => data.value?.articles || [])
const loadError = computed(() => !!error.value || data.value?.ok === false)

const toggleFaq = (index) => {
  activeIndex.value = activeIndex.value === index ? null : index
}
</script>
