<template>
  <section class="section" :class="bgClass">
    <div class="container">
      <div class="text-center max-w-[680px] mx-auto">
        <h2 class="text-[2.2rem] md:text-[1.6rem] font-extrabold mb-4" :class="isGreen ? 'text-white' : 'text-[#1E251C]'">{{ d.title || 'Tiêu đề kêu gọi' }}</h2>
        <p v-if="d.description" class="leading-[1.6] mb-8" :class="isGreen ? 'text-white/85' : 'text-[#4A5545]'">{{ d.description }}</p>
        <nuxt-link
          v-if="d.btnText"
          :to="d.btnLink || '/'"
          class="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-[0.95rem] transition-all duration-200 hover:-translate-y-0.5"
          :class="isGreen ? 'bg-white text-[#2d4a2d]' : 'bg-[#4A6741] text-white'"
        >
          {{ d.btnText }}
        </nuxt-link>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})
const variant = computed(() => d.value.bgVariant || 'green')
const isGreen = computed(() => variant.value === 'green')
const bgClass = computed(() => {
  if (variant.value === 'green') return 'bg-[#2d4a2d]'
  if (variant.value === 'light') return 'bg-[#F8FAF7]'
  return 'bg-white'
})
</script>
