<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero Header -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-[2]">
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">Văn Bản Quy Phạm Pháp Luật</h2>
        <p class="text-[1.1rem] opacity-90">Tra cứu các nghị định, chính sách, chỉ thị về công tác quản lý thi hành án hình sự và tái hòa nhập cộng đồng</p>
      </div>
    </section>

    <!-- Main Content -->
    <section class="section">
      <div class="container">
        <div>
          <SectionBar icon="fa-solid fa-file-contract" title="Văn bản pháp luật mới" />

          <!-- Search Bar -->
          <form class="flex flex-col gap-3 mb-[30px] bg-white p-4 rounded-lg border border-[#E2E8DF] shadow-sm sm:flex-row" @submit.prevent="applySearch">
            <input
              type="text"
              placeholder="Nhập từ khóa tìm kiếm văn bản (Ví dụ: 49/2020, vay vốn, xóa án tích...)"
              v-model="searchInput"
              class="flex-1 px-3 py-3 border border-[#E2E8DF] rounded text-[0.95rem] outline-none focus:border-[#7CB342] font-[inherit] transition-colors duration-200"
            />
            <button type="submit" class="btn btn-primary w-full sm:w-auto">Tìm kiếm</button>
          </form>

          <!-- Loading -->
          <div v-if="pending" class="bg-white rounded-lg border border-[#E2E8DF] shadow-sm p-6 flex flex-col gap-4">
            <div v-for="n in 5" :key="n" class="h-5 w-full bg-[#EEF2EC] rounded animate-pulse"></div>
          </div>

          <!-- Error -->
          <div v-else-if="loadError" class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]">
            <i class="fa-solid fa-triangle-exclamation mr-2"></i>
            Không thể tải văn bản. Vui lòng <button class="text-[#4A6741] font-bold underline" @click="refresh()">thử lại</button>.
          </div>

          <!-- Empty -->
          <div v-else-if="docs.length === 0" class="bg-white border border-dashed border-[#E2E8DF] px-6 py-10 rounded-lg text-center text-[#7A8675] text-[0.95rem]">
            Không tìm thấy văn bản phù hợp.
          </div>

          <!-- Table -->
          <div v-else class="bg-white rounded-lg border border-[#E2E8DF] shadow-sm overflow-x-auto">
            <table class="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th class="w-[15%] px-5 py-4 border-b border-[#E2E8DF] bg-[#F8FAF7] text-[#4A6741] font-bold text-[0.8rem] uppercase tracking-[0.5px]">Ngày ban hành</th>
                  <th class="w-[60%] px-5 py-4 border-b border-[#E2E8DF] bg-[#F8FAF7] text-[#4A6741] font-bold text-[0.8rem] uppercase tracking-[0.5px]">Trích yếu nội dung</th>
                  <th class="w-[15%] px-5 py-4 border-b border-[#E2E8DF] bg-[#F8FAF7] text-[#4A6741] font-bold text-[0.8rem] uppercase tracking-[0.5px]">Loại văn bản</th>
                  <th class="w-[10%] px-5 py-4 border-b border-[#E2E8DF] bg-[#F8FAF7] text-[#4A6741] font-bold text-[0.8rem] uppercase tracking-[0.5px]">Xem</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="doc in docs" :key="doc.id">
                  <td class="px-5 py-4 border-b border-[#E2E8DF] text-[0.9rem]">
                    <span class="text-[0.82rem] text-[#7A8675]">{{ formatDate(doc) }}</span>
                  </td>
                  <td class="px-5 py-4 border-b border-[#E2E8DF] text-[0.9rem]">
                    <nuxt-link :to="`/news/${doc.slug}`" class="no-underline text-[#1E251C] font-semibold leading-snug hover:text-[#4A6741] transition-colors duration-300">{{ doc.title }}</nuxt-link>
                    <p v-if="doc.excerpt" class="text-[0.82rem] text-[#7A8675] mt-1 leading-snug">{{ doc.excerpt }}</p>
                  </td>
                  <td class="px-5 py-4 border-b border-[#E2E8DF] text-[0.9rem] text-[#4A5545] font-medium">{{ doc.categoryName || 'Văn bản' }}</td>
                  <td class="px-5 py-4 border-b border-[#E2E8DF] text-[0.9rem]">
                    <nuxt-link :to="`/news/${doc.slug}`" class="text-[#4A6741] no-underline font-bold hover:underline">Chi tiết &rarr;</nuxt-link>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
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

const articlesQuery = computed(() => {
  const q = { type: 'document', limit: 50 }
  if (searchQuery.value) q.search = searchQuery.value
  return q
})
const { data, pending, error, refresh } = await useFetch('/api/public/articles', {
  query: articlesQuery,
  default: () => ({ ok: true, articles: [], pagination: {} })
})
const docs = computed(() => data.value?.articles || [])
const loadError = computed(() => !!error.value || data.value?.ok === false)

const applySearch = () => {
  searchQuery.value = searchInput.value.trim()
  navigateTo({ path: '/documents', query: searchQuery.value ? { q: searchQuery.value } : {} })
}

const formatDate = (item) => formatDateVN(item.publishedAt || item.createdAt)
</script>
