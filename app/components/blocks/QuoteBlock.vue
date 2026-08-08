<template>
  <section
    v-if="quote || cite"
    class="relative w-full overflow-hidden bg-cover bg-center py-[90px] md:py-[120px]"
    :style="bgImage ? `background-image: url('${bgImage}');` : ''"
  >
    <!-- Green overlay (replaces original background-attachment: fixed parallax) -->
    <div class="absolute inset-0 bg-[rgba(45,74,45,0.85)]"></div>

    <div class="container relative z-10">
      <div class="mx-auto max-w-[860px] text-center">
        <i class="fa-solid fa-quote-left mb-6 text-3xl text-white/40" aria-hidden="true"></i>
        <blockquote v-if="quote" class="text-2xl font-semibold italic leading-relaxed text-white md:text-3xl">
          {{ quote }}
        </blockquote>
        <p v-if="cite" class="mt-7 text-[0.8rem] font-bold uppercase tracking-[1.5px] text-[#a8d878] md:text-[0.9rem]">
          {{ cite }}
        </p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})
const quote = computed(() => d.value.quote || '')
const cite = computed(() => d.value.cite || '')
const bgImage = computed(() => d.value.bgImage || '/assets/hero_banner.jpg')
</script>
