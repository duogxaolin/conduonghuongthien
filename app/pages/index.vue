<template>
  <div>
    <PageRenderer v-if="blocks.length" :blocks="blocks" />

    <!-- Graceful fallback if the page has no blocks or the fetch failed. -->
    <section v-else class="section bg-white">
      <div class="container text-center py-20">
        <h1 class="text-[1.8rem] font-extrabold text-[#1E251C] mb-3">Con Đường Hướng Thiện</h1>
        <p class="text-[#4A5545]">Nội dung trang chủ đang được cập nhật. Vui lòng quay lại sau.</p>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const { data } = await useAsyncData(
  'page-home',
  () => $fetch('/api/public/pages/home'),
  { default: () => ({ ok: false, page: null, blocks: [] }) }
)

const page = computed(() => data.value?.page || null)
const blocks = computed(() => data.value?.blocks || [])

// SEO: prefer page meta, fall back to the original homepage defaults.
useSeoMeta({
  title: () => page.value?.seoTitle || 'Con Đường Hướng Thiện - Hỗ trợ tái hòa nhập cộng đồng',
  description: () => page.value?.seoDescription || 'Cổng thông tin điện tử C11 Bộ Công an hỗ trợ người hoàn lương tái hòa nhập cộng đồng: vay vốn QĐ 22/2023, đào tạo nghề, xóa án tích, tư vấn tâm lý, kết nối doanh nghiệp.',
  ogTitle: () => page.value?.seoTitle || 'Con Đường Hướng Thiện - Hỗ trợ tái hòa nhập cộng đồng',
  ogDescription: () => page.value?.seoDescription || 'Hỗ trợ toàn diện về nghề nghiệp, pháp lý và tư vấn tâm lý giúp người chấp hành xong án phạt tái hòa nhập cộng đồng.',
  ogType: 'website',
})
</script>
