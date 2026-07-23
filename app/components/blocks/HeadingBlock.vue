<template>
  <section class="section bg-white">
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
const alignClass = computed(() => {
  const a = d.value.align || 'center'
  return a === 'left' ? 'text-left' : a === 'right' ? 'text-right ml-auto' : 'text-center mx-auto'
})
</script>
