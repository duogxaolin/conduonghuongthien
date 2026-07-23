<template>
  <section class="section bg-[#f7f9f6] border-t border-[#E2E8DF] py-[50px]">
    <div class="container">
      <div class="text-center max-w-[600px] mx-auto mb-[50px]">
        <span v-if="d.subtitle" class="block text-[0.8rem] font-extrabold text-[#7CB342] uppercase tracking-[1.5px] mb-2">{{ d.subtitle }}</span>
        <h2 class="text-[2.2rem] md:text-[1.6rem] font-extrabold text-[#1E251C] mb-3">{{ d.title || 'Liên Kết Hữu Ích' }}</h2>
      </div>

      <div class="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
        <a
          v-for="(link, i) in links"
          :key="i"
          :href="link.url"
          target="_blank"
          rel="noopener"
          class="flex flex-col items-center justify-center bg-white border border-[#E2E8DF] rounded-lg p-5 text-center no-underline text-[#1E251C] shadow-sm transition hover:-translate-y-1 hover:border-[#4A6741] hover:shadow-md group"
        >
          <div class="w-[46px] h-[46px] rounded-full bg-[rgba(74,103,65,0.05)] flex items-center justify-center text-[1.45rem] mb-3 transition group-hover:bg-[#4A6741] group-hover:text-white">{{ link.icon }}</div>
          <span class="text-[0.82rem] font-bold leading-[1.3]">{{ link.label }}</span>
        </a>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})

const defaultLinks = [
  { icon: '🏛', label: 'Bộ Công an', url: 'https://bocongan.gov.vn' },
  { icon: '💻', label: 'Cổng Dịch vụ công', url: 'https://dichvucong.gov.vn' },
  { icon: '🏦', label: 'Ngân hàng CSXH', url: 'https://vbsp.org.vn' },
  { icon: '⚖', label: 'Bộ LĐ-TB&XH', url: 'https://molisa.gov.vn' },
  { icon: '📰', label: 'Báo CAND', url: 'https://cand.com.vn' },
]

const links = computed(() => {
  const raw = d.value.links
  return Array.isArray(raw) && raw.length ? raw : defaultLinks
})
</script>
