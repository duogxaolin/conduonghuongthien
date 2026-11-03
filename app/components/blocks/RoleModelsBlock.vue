<template>
  <section class="section bg-surface">
    <div class="container">
      <div class="text-center max-w-[600px] mx-auto mb-[40px]">
        <span v-if="d.subtitle" class="block text-[0.8rem] font-extrabold text-brand-600 uppercase tracking-[1.5px] mb-2">{{ d.subtitle }}</span>
        <h2 class="text-[2.2rem] sm:text-[1.6rem] font-extrabold text-ink mb-3">{{ d.title || t('block_role_title') }}</h2>
        <p v-if="d.description" class="text-[0.95rem] text-ink-secondary leading-[1.5]">{{ d.description }}</p>
      </div>

      <!-- Tự chuyển slide do `createCarouselAutoplay` quyết định (D23): CHỈ nút
           tạm dừng–tiếp tục đổi ý muốn của người xem; trỏ chuột / focus ở trong (bàn
           phím hay cú bấm/chạm làm nút được focus) / ngón tay trên slide / tab ẩn chỉ
           tạm dừng trong lúc chúng còn đó.
           Người dùng chọn giảm chuyển động thì không tự chạy, không cuộn mượt. -->
      <div
        v-if="list.length"
        ref="carouselRoot"
        class="relative"
        @pointerenter="onPointerEnter"
        @pointerleave="onPointerLeave"
        @focusin="onFocusIn"
        @focusout="onFocusOut"
        @touchstart.passive="onTouchStart"
        @touchend.passive="onTouchEnd"
        @touchcancel.passive="onTouchEnd"
      >
        <!-- Carousel ngang theo đúng "Đa phương tiện" của cand.vn: mỗi slide chỉ có
             ẢNH TRÊN + TÊN BÀI DƯỚI, không card viền, không badge, không excerpt.
             Ảnh bo góc nhẹ, hover zoom. Autoplay + progress + "Kéo sang để xem
             nhanh hơn" ở hàng dưới, nút mũi tên tròn đè hai bên mép carousel. -->
        <div
          class="flex overflow-x-auto scroll-smooth motion-reduce:scroll-auto [scroll-snap-type:x_mandatory] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden gap-[18px] pb-1"
          ref="track"
          @scroll.passive="onScroll"
        >
          <article
            v-for="model in list"
            :key="model.id"
            class="flex-[0_0_auto] w-[230px] sm:w-[250px] [scroll-snap-align:start]"
          >
            <nuxt-link :to="`/role-models/${model.id}`" class="group block no-underline">
              <figure class="relative aspect-[16/10] rounded-lg overflow-hidden bg-surface-tint">
                <SafeImg
                  :src="model.image"
                  :alt="model.name" img-class="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
                  loading="lazy"
                  decoding="async"
                  sizes="256px sm:384px lg:512px"
                />
              </figure>
              <span v-if="model.location" class="block text-[0.7rem] font-extrabold text-brand-600 uppercase tracking-[0.5px] leading-[1.6] mt-3 mb-1 truncate">{{ model.location }}</span>
              <h3 class="text-[0.95rem] font-extrabold text-ink leading-[1.35] line-clamp-2 transition-colors group-hover:text-brand-600">{{ model.name }}</h3>
            </nuxt-link>
          </article>
        </div>

        <!-- Nút mũi tên tròn đè hai bên mép (Desktop) -->
        <button
          type="button"
          class="hidden sm:flex absolute top-[calc(50%-46px)] -translate-y-1/2 left-1 sm:left-[-10px] xl:left-[-20px] w-11 h-11 rounded-full bg-white border border-black/[0.08] shadow-[0_6px_20px_rgba(0,0,0,0.12)] text-brand-600 items-center justify-center cursor-pointer z-10 transition hover:bg-brand-600 hover:text-white hover:border-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          @click="prevSlide"
          :aria-label="t('carousel_prev')"
        >
          <i class="fa-solid fa-chevron-left text-sm" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="hidden sm:flex absolute top-[calc(50%-46px)] -translate-y-1/2 right-1 sm:right-[-10px] xl:right-[-20px] w-11 h-11 rounded-full bg-white border border-black/[0.08] shadow-[0_6px_20px_rgba(0,0,0,0.12)] text-brand-600 items-center justify-center cursor-pointer z-10 transition hover:bg-brand-600 hover:text-white hover:border-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          @click="nextSlide"
          :aria-label="t('carousel_next')"
        >
          <i class="fa-solid fa-chevron-right text-sm" aria-hidden="true"></i>
        </button>

        <!-- Thanh bấm chuyển tab / slide trực quan bên dưới -->
        <div class="mt-7 flex items-center justify-center gap-3">
          <!-- Tạm dừng / tiếp tục tự chuyển (WCAG 2.2.2). Nhãn nói việc nút sẽ làm. -->
          <button
            ref="autoplayToggle"
            type="button"
            class="w-8 h-8 rounded-full border border-[#D5E1D3] bg-white text-brand-600 flex items-center justify-center cursor-pointer transition hover:bg-brand-600 hover:text-white hover:border-brand-600 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            :aria-label="autoplayOn ? t('carousel_pause') : t('carousel_play')"
            @click="toggleAutoplay"
          >
            <i :class="autoplayOn ? 'fa-solid fa-pause' : 'fa-solid fa-play'" class="text-xs" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="w-8 h-8 rounded-full border border-[#D5E1D3] bg-white text-brand-600 flex items-center justify-center cursor-pointer transition hover:bg-brand-600 hover:text-white hover:border-brand-600 shadow-sm disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            :disabled="currentIndex <= 0"
            @click="prevSlide"
            :aria-label="t('carousel_prev')"
          >
            <i class="fa-solid fa-chevron-left text-xs" aria-hidden="true"></i>
          </button>

          <!-- Clickable indicator tabs / pills — pill nhỏ nhưng vùng tap ≥24px
               (p-1.5 = 6px mỗi bên → 24px) để đạt WCAG 2.5.5 tap-target. -->
          <div class="flex items-center gap-1 px-2 py-1 bg-white rounded-full border border-line shadow-sm">
            <button
              v-for="(_, idx) in list"
              :key="idx"
              type="button"
              @click="goToSlide(idx)"
              :class="[
                'p-1.5 rounded-full transition-colors duration-300 cursor-pointer border-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600'
              ]"
              :aria-label="t('carousel_goto').replace('{n}', String(idx + 1))"
              :aria-current="currentIndex === idx ? 'true' : undefined"
            >
              <span
                :class="[
                  'block rounded-full transition-all duration-300 h-2.5',
                  currentIndex === idx ? 'w-6 bg-[#4A6741]' : 'w-2.5 bg-[#D5E1D3] group-hover:bg-accent'
                ]"
              ></span>
            </button>
          </div>

          <button
            type="button"
            class="w-8 h-8 rounded-full border border-[#D5E1D3] bg-white text-brand-600 flex items-center justify-center cursor-pointer transition hover:bg-brand-600 hover:text-white hover:border-brand-600 shadow-sm disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            :disabled="currentIndex >= totalCards - 1"
            @click="nextSlide"
            :aria-label="t('carousel_next')"
          >
            <i class="fa-solid fa-chevron-right text-xs" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      <BlockLoadError
        v-else-if="loadError"
        :title="t('rm_load_error_title')"
        :description="t('rm_load_error_desc')"
        :retry-label="t('retry')"
        :retrying="pending"
        @retry="() => refresh()"
      />

      <!-- Chỉ nói "chưa có" khi đã tải xong: lúc đang tải câu đó là một lời sai. -->
      <p v-else-if="!pending" class="text-center text-[0.9rem] text-ink-soft italic">{{ t('block_role_empty') }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { publicFetch } from '~/composables/publicFetch'
import type { PublicArticlesResponse } from '~/types/public-content-api'
import BlockLoadError from './BlockLoadError.vue'
import { createCarouselAutoplay } from '~/utils/carousel-autoplay'

const { currentLang, t } = useI18n()
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})
// 8 mặc định thay vì 4: carousel kiểu cand.vn chỉ hiện ~3.5 slide cùng lúc, cần
// dư ảnh dự phòng bên phải để autoplay và "kéo sang" có ý nghĩa. maxItems vẫn
// cấu hình được ở Page Builder.
const maxItems = computed(() => Number(d.value.maxItems) || 8)
const categorySlug = computed(() => d.value.categorySlug || '')

const { data, pending, error, refresh } = await useAsyncData(
  `block-role-models-${props.block.id}-${categorySlug.value}-${currentLang.value}`,
  () => publicFetch<PublicArticlesResponse>('/api/public/articles', {
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

// API trả 503 khi CSDL hỏng → `$fetch` ném → `error`. Trước đây nó trả 200 rỗng
// và khối này hiện "chưa có tấm gương" cho một lượt tải hỏng.
const loadError = computed(() => !!error.value)

const list = computed(() =>
  (data.value?.articles || []).map(a => ({
    id: a.slug,
    name: a.title,
    // FINDING G-1 (D-FETCH lô G): `categoryName` của API, như bản đầu của khối (20073b4d). Từ
    // 30b87195 dòng này đọc `a.category?.name` (kiểu ép viết tay) — nhãn chuyên mục không bao giờ hiện.
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
const carouselRoot = ref<HTMLElement | null>(null)
const autoplayToggle = ref<HTMLButtonElement | null>(null)
const progress = ref(0)
const currentIndex = ref(0)
const totalCards = computed(() => list.value.length)
let autoplayTimer: ReturnType<typeof setInterval> | null = null

// ── Chuyển động do người xem kiểm soát (design D23) ──
// Đọc `prefers-reduced-motion` lúc mount (chỉ trình duyệt) và theo dõi khi nó
// đổi: khi bật, không tự chuyển (tới khi người xem tự bấm) và mọi lượt cuộn bằng
// script là tức thì (`auto`), không trượt mượt.
let reducedMotion = false
let reducedMotionQuery: MediaQueryList | null = null
const onReducedMotionChange = (event: MediaQueryListEvent) => {
  reducedMotion = event.matches
  autoplay.reducedMotionChange(event.matches)
  autoplayOn.value = autoplay.autoplayOn
}
const scrollBehavior = (): ScrollBehavior => (reducedMotion ? 'auto' : 'smooth')
const autoplayOn = ref(true)
const autoplay = createCarouselAutoplay((running) => {
  if (running) startAutoplay()
  else stopAutoplay()
})
// The ONLY place the visitor's wish changes (see carousel-autoplay.ts).
const toggleAutoplay = () => {
  autoplay.pressToggle()
  autoplayOn.value = autoplay.autoplayOn
}
/** The event started on the pause/play control: it belongs to that control. */
const fromToggle = (event: Event) => !!(event.target instanceof Node && autoplayToggle.value?.contains(event.target))
const onPointerEnter = (event: PointerEvent) => autoplay.pointerEnter(event.pointerType)
const onPointerLeave = (event: PointerEvent) => autoplay.pointerLeave(event.pointerType)
// Ngón tay trên slide: dừng trong lúc chạm. Chạm vào nút tạm dừng/tiếp tục KHÔNG
// phải chạm vào carousel — touchstart của nó nổi lên tới đây TRƯỚC cú click.
const onTouchStart = (event: TouchEvent) => autoplay.touchStart(fromToggle(event))
// Chạy lại chỉ khi ngón tay CUỐI CÙNG nhấc lên (`touches` = các ngón còn chạm).
const onTouchEnd = (event: TouchEvent) => autoplay.touchEnd(event.touches.length)
// Focus ở bất kỳ đâu trong carousel (kể cả chính nút; bằng Tab hay bằng cú
// bấm/chạm làm nút/liên kết được focus) thì dừng; chỉ bấm "tiếp tục" mới chạy lại
// khi focus còn ở trong; focus ra ngoài thì chạy lại trừ khi người xem đã bấm dừng.
const onFocusIn = () => autoplay.focusIn()
const onFocusOut = (event: FocusEvent) => {
  const next = event.relatedTarget as Node | null
  autoplay.focusOut(!!next && !!carouselRoot.value?.contains(next))
}
const onVisibilityChange = () => autoplay.visibilityChange(document.visibilityState === 'hidden')

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
    el.scrollTo({ left: 0, behavior: scrollBehavior() })
  } else if (dir === -1 && el.scrollLeft <= 8) {
    el.scrollTo({ left: max, behavior: scrollBehavior() })
  } else {
    el.scrollBy({ left: dir * step, behavior: scrollBehavior() })
  }
}
const nextSlide = () => scrollByCard(1)
const prevSlide = () => scrollByCard(-1)

const goToSlide = (idx: number) => {
  const el = track.value
  if (!el) return
  const card = el.children[0] as HTMLElement | undefined
  const step = card ? card.offsetWidth + 18 : 268
  el.scrollTo({ left: idx * step, behavior: scrollBehavior() })
  currentIndex.value = idx
}

const startAutoplay = () => {
  // Trình duyệt thôi. `watch(list, …, { immediate: true })` bên dưới chạy cả lúc
  // render phía server, và ở đó `onUnmounted` không bao giờ được gọi — mỗi lượt
  // render trang chủ sẽ để lại một `setInterval` 3,5 giây chạy mãi trong tiến
  // trình Node, giữ nguyên cả component. Nuxt 4.6 cảnh báo `NUXT_E1004`.
  if (!import.meta.client) return
  stopAutoplay()
  autoplayTimer = setInterval(() => {
    const el = track.value
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    if (max > 0 && el.scrollLeft >= max - 8) {
      el.scrollTo({ left: 0, behavior: scrollBehavior() })
    } else {
      scrollByCard(1)
    }
  }, 3500)
}
const stopAutoplay = () => {
  if (autoplayTimer) { clearInterval(autoplayTimer); autoplayTimer = null }
}

// Không có slide thì không có gì để chạy. Trước `autoplay.init` (lúc mount)
// không gì chạy được, nên lượt `immediate` chạy lúc render phía server vô hại.
watch(list, (newList) => {
  if (newList.length) {
    nextTick(() => {
      onScroll()
      autoplay.slidesChange(newList.length)
    })
  } else {
    autoplay.slidesChange(0)
  }
}, { immediate: true })

onMounted(() => {
  // `error.value` lúc mount = lượt SSR hỏng; HTML mang nhánh lỗi đó có thể vừa
  // ra từ bộ đệm SWR 60 giây của trang — tải lại một lần ở trình duyệt.
  if (currentLang.value !== 'vi' || error.value) {
    void refresh()
  }
  reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion = reducedMotionQuery.matches
  reducedMotionQuery.addEventListener('change', onReducedMotionChange)
  document.addEventListener('visibilitychange', onVisibilityChange)
  if (document.visibilityState === 'hidden') autoplay.visibilityChange(true)
  autoplay.init(reducedMotion)
  autoplayOn.value = autoplay.autoplayOn
  nextTick(() => onScroll())
})
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  reducedMotionQuery?.removeEventListener('change', onReducedMotionChange)
  stopAutoplay()
})
</script>
