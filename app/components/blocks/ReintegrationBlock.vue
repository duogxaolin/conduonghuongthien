<template>
  <section class="section bg-white">
    <div class="container">
      <div class="text-center max-w-[600px] mx-auto mb-[50px]">
        <span v-if="d.subtitle" class="block text-[0.8rem] font-extrabold text-[#7CB342] uppercase tracking-[1.5px] mb-2">{{ d.subtitle }}</span>
        <h2 class="text-[2.2rem] sm:text-[1.6rem] font-extrabold text-[#1E251C] mb-3">{{ d.title || 'Mô Hình Tái Hòa Nhập Cộng Đồng' }}</h2>
        <p v-if="d.description" class="text-[0.95rem] text-[#4A5545] leading-[1.5]">{{ d.description }}</p>
      </div>

      <div v-if="list.length" class="relative w-full pb-9" @mouseenter="stopAutoplay" @mouseleave="startAutoplay">
        <button class="absolute top-[42%] -translate-y-1/2 left-[-22px] sm:hidden w-11 h-11 rounded-full bg-white border border-black/[0.08] shadow-[0_6px_20px_rgba(0,0,0,0.09)] text-[#4A6741] flex items-center justify-center cursor-pointer z-10 transition hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741] hover:scale-[1.08]" @click="prevSlide" aria-label="Slide trước">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>

        <div
          class="grid grid-flow-col overflow-x-auto scroll-smooth [grid-auto-columns:calc(100%_-_12px)] [scroll-snap-type:x_mandatory] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden px-[6px] py-3 gap-[26px] sm:[grid-auto-columns:calc(50%_-_13px)] lg:[grid-auto-columns:calc(33.333%_-_18px)]"
          ref="track"
        >
          <div
            v-for="(item, index) in list"
            :key="item.id"
            class="[scroll-snap-align:start] bg-white rounded-2xl sm:rounded-xl px-6 py-8 sm:px-2 sm:py-[14px] text-center shadow-[0_6px_24px_rgba(0,0,0,0.04)] border border-[rgba(30,70,32,0.08)] transition-all duration-300 hover:-translate-y-[6px] hover:shadow-[0_16px_36px_rgba(30,70,32,0.12)] hover:border-[rgba(30,70,32,0.2)] flex flex-col items-center"
            :class="{ 'is-active-slide': activeIndex === index }"
          >
            <div class="w-16 h-16 sm:w-11 sm:h-11 rounded-[20px] sm:rounded-[14px] flex items-center justify-center text-[2.2rem] sm:text-[1.3rem] mb-[18px] sm:mb-2 shadow-[0_4px_12px_rgba(30,70,32,0.08)]" style="background: linear-gradient(135deg, rgba(30,70,32,0.08) 0%, rgba(124,179,66,0.15) 100%);">{{ item.icon }}</div>
            <h3 class="text-[1.12rem] sm:text-[0.84rem] font-extrabold text-[#1E251C] mb-[10px] sm:mb-1 sm:leading-[1.25]">{{ item.title }}</h3>
            <p class="text-[0.86rem] sm:text-[0.72rem] text-[#4A5545] leading-[1.5] sm:leading-[1.35] mb-[18px] sm:mb-[6px] sm:line-clamp-3">{{ item.desc }}</p>
            <nuxt-link :to="`/reintegration-models/${item.id}`" class="text-[0.84rem] sm:text-[0.7rem] text-[#4A6741] font-bold no-underline mt-auto">Tìm hiểu &rarr;</nuxt-link>
          </div>
        </div>

        <button class="absolute top-[42%] -translate-y-1/2 right-[-22px] sm:hidden w-11 h-11 rounded-full bg-white border border-black/[0.08] shadow-[0_6px_20px_rgba(0,0,0,0.09)] text-[#4A6741] flex items-center justify-center cursor-pointer z-10 transition hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741] hover:scale-[1.08]" @click="nextSlide" aria-label="Slide tiếp">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>

        <div class="absolute bottom-0 left-0 right-0 flex justify-center items-center gap-2">
          <span
            v-for="(item, index) in list"
            :key="'model-dot-' + index"
            class="rounded-full cursor-pointer transition-all duration-300 h-[9px]"
            :class="activeIndex === index ? 'w-[26px] rounded-[12px] bg-[#4A6741] shadow-[0_2px_8px_rgba(30,70,32,0.3)]' : 'w-[9px] bg-[rgba(30,70,32,0.2)] hover:bg-[rgba(30,70,32,0.5)]'"
            @click="goToSlide(index)"
          ></span>
        </div>
      </div>

      <p v-else class="text-center text-[0.9rem] text-[#7A8675] italic">Chưa có mô hình nào được đăng.</p>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})

const maxItems = computed(() => Number(d.value.maxItems) || 4)
const categorySlug = computed(() => d.value.categorySlug || '')

const { data } = await useAsyncData(
  `block-reintegration-${props.block.id}-${categorySlug.value}`,
  () => $fetch('/api/public/articles', {
    params: {
      type: 'reintegration',
      limit: maxItems.value,
      ...(categorySlug.value ? { categorySlug: categorySlug.value } : {}),
    },
  }),
  { default: () => ({ articles: [] }) }
)

const list = computed(() =>
  (data.value?.articles || []).map(a => ({
    id: a.slug,
    icon: '🌱',
    title: a.title,
    desc: a.excerpt || '',
  }))
)

// ── Carousel (ported from index.vue) ──
const track = ref(null)
const activeIndex = ref(0)
let autoplayTimer = null

const scrollToSlide = (idx) => {
  activeIndex.value = idx
  if (track.value) {
    const card = track.value.children[idx]
    if (card) {
      const scrollPos = card.offsetLeft - track.value.offsetLeft
      track.value.scrollTo({ left: scrollPos, behavior: 'smooth' })
    }
  }
}
const goToSlide = (idx) => scrollToSlide(idx)
const nextSlide = () => { if (list.value.length) scrollToSlide((activeIndex.value + 1) % list.value.length) }
const prevSlide = () => { if (list.value.length) scrollToSlide((activeIndex.value - 1 + list.value.length) % list.value.length) }

const startAutoplay = () => {
  stopAutoplay()
  autoplayTimer = setInterval(() => nextSlide(), 4000)
}
const stopAutoplay = () => {
  if (autoplayTimer) { clearInterval(autoplayTimer); autoplayTimer = null }
}

onMounted(() => { if (list.value.length) startAutoplay() })
onUnmounted(() => stopAutoplay())
</script>
