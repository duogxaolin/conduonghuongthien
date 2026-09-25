<template>
  <!--
    Banner variant: hero header gradient nhạt, text tối — đồng bộ với PageHero
    của các trang list (news, role-models, ...). Cố ý bỏ ảnh nền + overlay xanh:
    kiểu ảnh-nền text-trắng đã bị thay vì nó trình bày kém hài hoà với phần nội
    dung sáng bên dưới. Block data vẫn giữ trường `bgImage` để không phá trang
    đã lưu, nhưng nó không còn được dựng.
  -->
  <section
    v-if="d.variant === 'banner'"
    class="border-b border-[#DDE6DC] bg-gradient-to-b from-[#EEF5EB] via-[#F5FAF3] to-[#F7FAF6]"
  >
    <div class="container pt-6 sm:pt-8 pb-6 sm:pb-7">
      <div class="max-w-2xl">
        <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#E4EEE2] border border-[#D0DFCE] text-[#365730] text-[0.72rem] font-extrabold uppercase tracking-wider mb-3 shadow-sm">
          <span class="w-2 h-2 rounded-full bg-[#4A6741] animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
          <span>{{ t('portal_agency_badge') || 'Cổng Thông Tin Điện Tử C11 • Bộ Công An' }}</span>
        </div>
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem] text-[#172516] tracking-tight leading-tight">{{ d.text || 'Tiêu đề mục' }}</h2>
        <p v-if="d.subtitle" class="text-[1.05rem] text-[#576653] leading-relaxed">{{ d.subtitle }}</p>
      </div>
    </div>
  </section>

  <!-- Default variant: plain section heading -->
  <section v-else class="section bg-white">
    <div class="container">
      <div class="max-w-[720px] mx-auto" :class="alignClass">
        <span v-if="d.subtitle" class="block text-[0.8rem] font-extrabold text-[#7CB342] uppercase tracking-[1.5px] mb-2">{{ d.subtitle }}</span>
        <h2 class="text-[2.2rem] md:text-[1.6rem] font-extrabold text-[#1E251C]">{{ d.text || 'Tiêu đề mục' }}</h2>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'

const { t } = useI18n()
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})
const alignClass = computed(() => {
  const a = d.value.align || 'center'
  return a === 'left' ? 'text-left' : a === 'right' ? 'text-right ml-auto' : 'text-center mx-auto'
})
</script>
