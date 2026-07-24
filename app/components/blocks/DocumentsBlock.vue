<template>
  <section class="section bg-[#F8FAF7]">
    <div class="container grid grid-cols-1 items-center gap-10 sm:grid-cols-2">
      <div>
        <h2 class="text-[2.2rem] sm:text-[1.6rem] font-extrabold text-[#1E251C] mb-4">{{ d.title || 'Văn Bản Pháp Quy Mới' }}</h2>
        <p class="text-[#4A5545] mb-6 leading-[1.6]">{{ d.description || 'Cập nhật liên tục các quyết định chỉ đạo của Thủ tướng Chính phủ, các thông tư chỉ thị của Bộ Công an về công tác thi hành án hình sự và hỗ trợ hòa nhập cộng đồng.' }}</p>
        <nuxt-link :to="d.btnLink || '/documents'" class="btn btn-primary">{{ d.btnText || 'Tra cứu thư viện văn bản' }}</nuxt-link>
      </div>
      <div class="flex flex-col gap-4">
        <div v-for="doc in docs" :key="doc.id" class="bg-white border border-[#E2E8DF] rounded-lg p-4 flex gap-4 items-start transition hover:border-[#4A6741] hover:shadow-sm">
          <span class="text-2xl">📄</span>
          <div>
            <span class="block text-[0.75rem] font-bold text-[#4A6741] mb-1">{{ doc.number }} • {{ doc.date }}</span>
            <h4 class="text-[0.88rem] font-bold leading-[1.4] m-0">{{ doc.title }}</h4>
          </div>
        </div>
        <p v-if="!docs.length" class="text-[0.9rem] text-[#7A8675] italic">Chưa có văn bản nào được đăng.</p>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})

const formatDate = (dateStr) => (dateStr ? new Date(dateStr).toLocaleDateString('vi-VN') : '')
const maxItems = computed(() => Number(d.value.maxItems) || 3)
const categorySlug = computed(() => d.value.categorySlug || '')

const { data } = await useAsyncData(
  `block-documents-${props.block.id}-${categorySlug.value}`,
  () => $fetch('/api/public/articles', {
    params: {
      type: 'document',
      limit: maxItems.value,
      ...(categorySlug.value ? { categorySlug: categorySlug.value } : {}),
    },
  }),
  { default: () => ({ articles: [] }) }
)

const docs = computed(() =>
  (data.value?.articles || []).map(a => ({
    id: a.id,
    number: a.title,
    date: formatDate(a.publishedAt || a.createdAt),
    title: a.excerpt || a.title,
  }))
)
</script>
