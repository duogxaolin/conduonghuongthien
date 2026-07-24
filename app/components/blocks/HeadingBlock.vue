<template>
  <!-- Banner variant: green hero header (restores the old about/contact page header) -->
  <section
    v-if="d.variant === 'banner'"
    class="relative bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]"
    :style="bgImage ? `background-image: url('${bgImage}')` : ''"
  >
    <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
    <div class="container relative z-10">
      <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">{{ d.text || 'Tiêu đề mục' }}</h2>
      <p v-if="d.subtitle" class="text-[1.1rem] opacity-90">{{ d.subtitle }}</p>
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

<script setup>
import { computed } from 'vue'
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})
const bgImage = computed(() => d.value.bgImage || '/assets/hero_banner.jpg')
const alignClass = computed(() => {
  const a = d.value.align || 'center'
  return a === 'left' ? 'text-left' : a === 'right' ? 'text-right ml-auto' : 'text-center mx-auto'
})
</script>
