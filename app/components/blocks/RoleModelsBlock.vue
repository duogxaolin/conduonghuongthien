<template>
  <section class="section bg-[#F8FAF7]">
    <div class="container">
      <div class="text-center max-w-[600px] mx-auto mb-[40px]">
        <span v-if="d.subtitle" class="block text-[0.8rem] font-extrabold text-[#7CB342] uppercase tracking-[1.5px] mb-2">{{ d.subtitle }}</span>
        <h2 class="text-[2.2rem] sm:text-[1.6rem] font-extrabold text-[#1E251C] mb-3">{{ d.title || 'Tấm Gương Sáng Điển Hình' }}</h2>
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

        <!-- Nút mũi tên tròn đè hai bên mép, canh giữa vùng ảnh (đúng vị trí như ảnh cand.vn) -->
        <button class="hidden sm:flex absolute top-[calc(50%-46px)] -translate-y-1/2 left-[-20px] w-11 h-11 rounded-full bg-white border border-black/[0.08] shadow-[0_6px_20px_rgba(0,0,0,0.12)] text-[#4A6741] items-center justify-center cursor-pointer z-10 transition hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741]" @click="prevSlide" aria-label="Slide trước">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.5" fill="none" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <button class="hidden sm:flex absolute top-[calc(50%-46px)] -translate-y-1/2 right-[-20px] w-11 h-11 rounded-full bg-white border border-black/[0.08] shadow-[0_6px_20px_rgba(0,0,0,0.12)] text-[#4A6741] items-center justify-center cursor-pointer z-10 transition hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741]" @click="nextSlide" aria-label="Slide tiếp">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.5" fill="none" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>

        <!-- Hàng dưới: mũi tên nhỏ + progress bar + hint — đúng `.wrap-function` của cand.vn -->
        <div class="mt-6 flex items-center gap-3 px-1">
          <button class="text-[#4A6741] w-7 h-7 flex-shrink-0 rounded-full border border-[rgba(30,70,32,0.15)] flex items-center justify-center cursor-pointer transition hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741]" @click="prevSlide" aria-label="Trước">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <div class="flex-1 h-[5px] rounded-full bg-[rgba(30,70,32,0.12)] overflow-hidden">
            <div class="h-full rounded-full bg-[#7CB342] transition-[width] duration-300 ease-out" :style="{ width: progress + '%' }"></div>
          </div>
          <button class="text-[#4A6741] w-7 h-7 flex-shrink-0 rounded-full border border-[rgba(30,70,32,0.15)] flex items-center justify-center cursor-pointer transition hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741]" @click="nextSlide" aria-label="Tiếp">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
          <span class="text-[0.74rem] text-[#7A8675] whitespace-nowrap hidden sm:inline">Kéo sang để xem nhanh hơn</span>
        </div>
      </div>

      <p v-else class="text-center text-[0.9rem] text-[#7A8675] italic">Chưa có tấm gương nào được đăng.</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})

// 8 mặc định thay vì 4: carousel kiểu cand.vn chỉ hiện ~3.5 slide cùng lúc, cần
// dư ảnh dự phòng bên phải để autoplay và "kéo sang" có ý nghĩa. maxItems vẫn
// cấu hình được ở Page Builder.
const maxItems = computed(() => Number(d.value.maxItems) || 8)
const categorySlug = computed(() => d.value.categorySlug || '')

const { data } = await useAsyncData(
  `block-role-models-${props.block.id}-${categorySlug.value}`,
  () => $fetch('/api/public/articles', {
    params: {
      type: 'role_model',
      limit: maxItems.value,
      ...(categorySlug.value ? { categorySlug: categorySlug.value } : {}),
    },
  }),
  // `lazy: true`: server vẫn chờ dữ liệu cho HTML đầu + SEO, client không chặn
  // chuyển trang — khung xương (nhánh empty / default) vẽ ngay, dữ liệu về sau
  // thì tự cập nhật.
  { lazy: true, default: () => ({ articles: [] }) }
)

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
let autoplayTimer: ReturnType<typeof setInterval> | null = null

const onScroll = () => {
  const el = track.value
  if (!el) return
  const max = el.scrollWidth - el.clientWidth
  progress.value = max > 0 ? Math.min(100, Math.max(0, (el.scrollLeft / max) * 100)) : 0
}

const scrollByCard = (dir: 1 | -1) => {
  const el = track.value
  if (!el) return
  const card = el.children[0] as HTMLElement | undefined
  // +18px là gap-[18px] giữa các slide — bắt buộc tính cả gap, không thì mỗi
  // bước lệch một nửa card và ảnh bị cắt đôi ở mép.
  const step = card ? card.offsetWidth + 18 : el.clientWidth * 0.8
  el.scrollBy({ left: dir * step, behavior: 'smooth' })
}
const nextSlide = () => scrollByCard(1)
const prevSlide = () => scrollByCard(-1)

const startAutoplay = () => {
  stopAutoplay()
  // 5s/slide: đủ để đọc một tiêu đề 2 dòng. cand.vn dùng 10s nhưng dữ liệu của
  // mình ít slide hơn nên vòng lặp dài hơn sẽ trông như đứng im.
  autoplayTimer = setInterval(() => {
    const el = track.value
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    if (max > 0 && el.scrollLeft + el.clientWidth >= max - 2) {
      el.scrollTo({ left: 0, behavior: 'smooth' })
    } else {
      scrollByCard(1)
    }
  }, 5000)
}
const stopAutoplay = () => {
  if (autoplayTimer) { clearInterval(autoplayTimer); autoplayTimer = null }
}

onMounted(() => {
  onScroll()
  if (list.value.length) startAutoplay()
})
onUnmounted(() => stopAutoplay())
</script>
