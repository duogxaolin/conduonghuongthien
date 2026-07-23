<template>
  <div class="bg-[#F8FAF7]">
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover py-20 text-center text-white">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-10">
        <h2 class="text-[2.2rem] font-extrabold mb-2">Tin Nổi Bật</h2>
        <p class="text-base opacity-90">Các sự kiện và tin tức nổi bật về công tác tái hòa nhập cộng đồng</p>
      </div>
    </section>

    <section class="py-12">
      <div class="container">
        <!-- Loading -->
        <div v-if="pending" class="grid grid-cols-1 md:grid-cols-2 gap-[30px] max-w-[1000px] mx-auto">
          <div v-for="n in 4" :key="n" class="bg-white rounded-lg overflow-hidden shadow-sm border border-[#E2E8DF] animate-pulse">
            <div class="h-[220px] bg-[#EEF2EC]"></div>
            <div class="p-6 flex flex-col gap-3">
              <div class="h-3 w-32 bg-[#EEF2EC] rounded"></div>
              <div class="h-4 w-3/4 bg-[#EEF2EC] rounded"></div>
              <div class="h-3 w-full bg-[#EEF2EC] rounded"></div>
            </div>
          </div>
        </div>

        <!-- Error -->
        <div v-else-if="loadError" class="max-w-[1000px] mx-auto bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]">
          <i class="fa-solid fa-triangle-exclamation mr-2"></i>
          Không thể tải tin tức. Vui lòng <button class="text-[#4A6741] font-bold underline" @click="refresh()">thử lại</button>.
        </div>

        <!-- Empty -->
        <div v-else-if="newsList.length === 0" class="max-w-[1000px] mx-auto bg-white border border-dashed border-[#E2E8DF] px-6 py-10 rounded-lg text-center text-[#7A8675] text-[0.95rem]">
          Chưa có tin nổi bật nào. Xem <nuxt-link to="/news" class="text-[#4A6741] font-bold">tất cả bản tin</nuxt-link>.
        </div>

        <!-- List -->
        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-[30px] max-w-[1000px] mx-auto">
          <div
            v-for="item in newsList"
            :key="item.id"
            class="bg-white rounded-lg overflow-hidden shadow-sm border border-[#E2E8DF] transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-[#7CB342]"
          >
            <div class="h-[220px] overflow-hidden">
              <img :src="item.thumbnailUrl || '/assets/hero_banner.jpg'" :alt="item.title" class="w-full h-full object-cover" />
            </div>
            <div class="p-6">
              <span class="text-[0.8rem] text-[#7A8675] font-semibold block mb-2">{{ formatDate(item) }} • {{ item.categoryName || 'Tin nổi bật' }}</span>
              <h3 class="text-[1.15rem] font-bold leading-[1.4] mb-[10px]">
                <nuxt-link
                  :to="'/news/' + item.slug"
                  class="no-underline text-[#1E251C] transition-colors duration-300 hover:text-[#4A6741]"
                >{{ item.title }}</nuxt-link>
              </h3>
              <p class="text-[0.9rem] text-[#4A5545] leading-[1.5] mb-4">{{ item.excerpt }}</p>
              <nuxt-link :to="'/news/' + item.slug" class="text-[#7CB342] font-bold no-underline text-[0.88rem]">Chi tiết &rarr;</nuxt-link>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'

useSeoMeta({
  title: 'Tin nổi bật | Con Đường Hướng Thiện',
  description: 'Các sự kiện và tin tức nổi bật về công tác tái hòa nhập cộng đồng.'
})

const { data, pending, error, refresh } = await useFetch('/api/public/articles', {
  query: { type: 'news', categorySlug: 'tin-noi-bat', limit: 20 },
  default: () => ({ ok: true, articles: [], pagination: {} })
})
const newsList = computed(() => data.value?.articles || [])
const loadError = computed(() => !!error.value || data.value?.ok === false)

const formatDate = (item) => {
  const raw = item.publishedAt || item.createdAt
  if (!raw) return ''
  const d = new Date(raw)
  if (isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}
</script>
