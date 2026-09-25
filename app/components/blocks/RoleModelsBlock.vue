<template>
  <section class="section bg-[#F8FAF7]">
    <div class="container">
      <div class="text-center max-w-[600px] mx-auto mb-[40px]">
        <span v-if="d.subtitle" class="block text-[0.8rem] font-extrabold text-[#7CB342] uppercase tracking-[1.5px] mb-2">{{ d.subtitle }}</span>
        <h2 class="text-[2.2rem] sm:text-[1.6rem] font-extrabold text-[#1E251C] mb-3">{{ d.title || t('block_role_title') }}</h2>
        <p v-if="d.description" class="text-[0.95rem] text-[#4A5545] leading-[1.5]">{{ d.description }}</p>
      </div>

      <div v-if="list.length" class="relative" @mouseenter="stopAutoplay" @mouseleave="startAutoplay">
        <!-- Carousel ngang theo đúng "Đa phương tiện" của cand.vn: mỗi slide chỉ có
             ẢNH TRÊN + TÊN BÀI DƯỚI, không card viền, không badge, không excerpt.
             Ảnh bo góc nhẹ, hover zoom. Autoplay + progress + "Kéo sang để xem
             nhanh hơn" ở hàng dưới, nút mũi tên tròn đè hai bên mép carousel. -->
        <div
          class="flex overflow-x-auto scroll-smooth [scroll-snap-type:x_mandatory] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden gap-[18px] pb-1"
          ref="track"
          @scroll.passive="onScroll"
        >
          <article
            v-for="model in list"
            :key="model.id"
            class="flex-[0_0_auto] w-[230px] sm:w-[250px] [scroll-snap-align:start]"
          >
            <nuxt-link :to="`/role-models/${model.id}`" class="group block no-underline">
              <figure class="relative aspect-[16/10] rounded-lg overflow-hidden bg-[#EEF2EC]">
                <img
                  :src="model.image"
                  :alt="model.name"
                  class="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
                  loading="lazy"
                  decoding="async"
                />
              </figure>
              <span v-if="model.location" class="block text-[0.7rem] font-extrabold text-[#7CB342] uppercase tracking-[0.5px] mt-3 mb-1 truncate">{{ model.location }}</span>
              <h3 class="text-[0.95rem] font-extrabold text-[#1E251C] leading-[1.35] line-clamp-2 transition-colors group-hover:text-[#4A6741]">{{ model.name }}</h3>
            </nuxt-link>
          </article>
        </div>

        <!-- Nút mũi tên tròn đè hai bên mép (Desktop) -->
        <button
          type="button"
          class="hidden sm:flex absolute top-[calc(50%-46px)] -translate-y-1/2 left-[-20px] w-11 h-11 rounded-full bg-white border border-black/[0.08] shadow-[0_6px_20px_rgba(0,0,0,0.12)] text-[#4A6741] items-center justify-center cursor-pointer z-10 transition hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741]"
          @click="prevSlide"
          :aria-label="t('carousel_prev')"
        >
          <i class="fa-solid fa-chevron-left text-sm" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="hidden sm:flex absolute top-[calc(50%-46px)] -translate-y-1/2 right-[-20px] w-11 h-11 rounded-full bg-white border border-black/[0.08] shadow-[0_6px_20px_rgba(0,0,0,0.12)] text-[#4A6741] items-center justify-center cursor-pointer z-10 transition hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741]"
          @click="nextSlide"
          :aria-label="t('carousel_next')"
        >
          <i class="fa-solid fa-chevron-right text-sm" aria-hidden="true"></i>
        </button>

        <!-- Thanh bấm chuyển tab / slide trực quan bên dưới -->
        <div class="mt-7 flex items-center justify-center gap-3">
          <button
            type="button"
            class="w-8 h-8 rounded-full border border-[#D5E1D3] bg-white text-[#4A6741] flex items-center justify-center cursor-pointer transition hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741] shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
            :disabled="currentIndex <= 0"
            @click="prevSlide"
            :aria-label="t('carousel_prev')"
          >
            <i class="fa-solid fa-chevron-left text-xs" aria-hidden="true"></i>
          </button>

          <!-- Clickable indicator tabs / pills -->
          <div class="flex items-center gap-1.5 px-2.5 py-1.5 bg-white rounded-full border border-[#E2E8DF] shadow-sm">
            <button
              v-for="(_, idx) in list"
              :key="idx"
              type="button"
              @click="goToSlide(idx)"
              :class="[
                'h-2.5 rounded-full transition-all duration-300 cursor-pointer border-none p-0',
                currentIndex === idx ? 'w-6 bg-[#4A6741]' : 'w-2.5 bg-[#D5E1D3] hover:bg-[#7CB342]'
              ]"
              :aria-label="t('carousel_goto').replace('{n}', String(idx + 1))"
              :aria-current="currentIndex === idx ? 'true' : undefined"
            ></button>
          </div>

          <button
            type="button"
            class="w-8 h-8 rounded-full border border-[#D5E1D3] bg-white text-[#4A6741] flex items-center justify-center cursor-pointer transition hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741] shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
            :disabled="currentIndex >= totalCards - 1"
            @click="nextSlide"
            :aria-label="t('carousel_next')"
          >
            <i class="fa-solid fa-chevron-right text-xs" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      <p v-else class="text-center text-[0.9rem] text-[#7A8675] italic">{{ t('block_role_empty') }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from '~/composables/useI18n'

const { currentLang, t } = useI18n()
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})
// 8 mặc định thay vì 4: carousel kiểu cand.vn chỉ hiện ~3.5 slide cùng lúc, cần
// dư ảnh dự phòng bên phải để autoplay và "kéo sang" có ý nghĩa. maxItems vẫn
// cấu hình được ở Page Builder.
const maxItems = computed(() => Number(d.value.maxItems) || 8)
const categorySlug = computed(() => d.value.categorySlug || '')

const { data, refresh } = await useAsyncData(
  `block-role-models-${props.block.id}-${categorySlug.value}-${currentLang.value}`,
  () => $fetch('/api/public/articles', {
    params: {
      type: 'role_model',
      limit: maxItems.value,
      lang: currentLang.value,
      ...(categorySlug.value ? { categorySlug: categorySlug.value } : {}),
    },
  }),
  { lazy: true, default: () => ({ articles: [] }) }
)

watch(currentLang, () => {
  void refresh()
})

const list = computed(() =>
  (data.value?.articles || []).map(a => ({
    id: a.slug,
    name: a.title,
    location: a.categoryName || '',
    image: a.thumbnailUrl || '/assets/guong_sang_1.jpg',
  }))
)

// ── Carousel ngang + autoplay (cand.vn "Đa phương tiện") ──
// Track là thanh cuộn thật (overflow-x-auto + scroll-snap), progress đọc từ vị
// trí cuộn nên kéo tay hay autoplay đều đúng — không có bộ đếm slide ảo thứ hai
// để lệch. `HTMLElement` vì `ref(null)` trần suy ra `Ref<null>` và không có
// `scrollLeft` trên kiểu đó.
const track = ref<HTMLElement | null>(null)
const progress = ref(0)
const currentIndex = ref(0)
const totalCards = computed(() => list.value.length)
let autoplayTimer: ReturnType<typeof setInterval> | null = null

const onScroll = () => {
  const el = track.value
  if (!el) return
  const max = el.scrollWidth - el.clientWidth
  progress.value = max > 0 ? Math.min(100, Math.max(0, (el.scrollLeft / max) * 100)) : 0
  const card = el.children[0] as HTMLElement | undefined
  const step = card ? card.offsetWidth + 18 : 268
  currentIndex.value = Math.min(totalCards.value - 1, Math.max(0, Math.round(el.scrollLeft / step)))
}

const scrollByCard = (dir: 1 | -1) => {
  const el = track.value
  if (!el) return
  const card = el.children[0] as HTMLElement | undefined
  const step = card ? card.offsetWidth + 18 : el.clientWidth * 0.8
  const max = el.scrollWidth - el.clientWidth
  if (dir === 1 && el.scrollLeft >= max - 8) {
    el.scrollTo({ left: 0, behavior: 'smooth' })
  } else if (dir === -1 && el.scrollLeft <= 8) {
    el.scrollTo({ left: max, behavior: 'smooth' })
  } else {
    el.scrollBy({ left: dir * step, behavior: 'smooth' })
  }
}
const nextSlide = () => scrollByCard(1)
const prevSlide = () => scrollByCard(-1)

const goToSlide = (idx: number) => {
  const el = track.value
  if (!el) return
  const card = el.children[0] as HTMLElement | undefined
  const step = card ? card.offsetWidth + 18 : 268
  el.scrollTo({ left: idx * step, behavior: 'smooth' })
  currentIndex.value = idx
}

const startAutoplay = () => {
  stopAutoplay()
  autoplayTimer = setInterval(() => {
    const el = track.value
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    if (max > 0 && el.scrollLeft >= max - 8) {
      el.scrollTo({ left: 0, behavior: 'smooth' })
    } else {
      scrollByCard(1)
    }
  }, 3500)
}
const stopAutoplay = () => {
  if (autoplayTimer) { clearInterval(autoplayTimer); autoplayTimer = null }
}

watch(list, (newList) => {
  if (newList.length) {
    nextTick(() => {
      onScroll()
      startAutoplay()
    })
  }
}, { immediate: true })

onMounted(() => {
  if (currentLang.value !== 'vi') {
    void refresh()
  }
  nextTick(() => {
    onScroll()
    if (list.value.length) startAutoplay()
  })
})
onUnmounted(() => stopAutoplay())
</script>
