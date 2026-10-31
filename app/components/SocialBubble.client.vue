<script setup lang="ts">
import { useLayoutConfig } from '~/composables/useLayoutConfig'
import { publicFetch } from '~/composables/publicFetch'
import type { PublicSocialLinksResponse } from '~/types/public-site-api'

/**
 * Suy từ handler (D-FETCH lô G). Bản viết tay cũ khai `iconType` là union ba giá trị; cột là
 * `varchar(16)` — template so sánh từng giá trị, giá trị lạ không vẽ biểu tượng nào.
 */
type SocialLink = PublicSocialLinksResponse['items'][number]

const props = withDefaults(defineProps<{
  isHidden?: boolean
}>(), {
  isHidden: false,
})

const items = ref<SocialLink[]>([])
const { config } = useLayoutConfig()
const isFloating = computed(() => config.value.socialDisplayMode === 'floating')
const { t } = useI18n()
const openLinkAria = (item: SocialLink) => t('social_open_link_aria').replace('{name}', item.label || item.platform)

const open = ref(false)
const loaded = ref(false)
const root = ref<HTMLElement | null>(null)

// Trạng thái mở rộng cho chế độ Nút tròn rời (Floating):
// - Floating: Mặc định mở trên cả PC lẫn Mobile (nút tròn rời không che nội
//   dung như bảng popup — chỉ là các viên thuốc nhỏ xếp dọc).
// - Popup: PC mặc định mở, Mobile mặc định thu gọn (bảng popup che nội dung
//   trên điện thoại).
// `socialAutoOpen` (từ admin settings) cho phép admin tắt tự mở hoàn toàn.
const isExpanded = ref(true)

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

async function load() {
  try {
    const res = await publicFetch<PublicSocialLinksResponse>('/api/public/social-links')
    if (res.ok) items.value = res.items || []
  } catch {
    // Nuốt lỗi — widget MXH không làm gián đoạn trải nghiệm người dùng
  } finally {
    loaded.value = true
  }
}

function toggle() {
  open.value = !open.value
}

function close() {
  open.value = false
}

// Đóng khi click ra ngoài hoặc bấm Escape
function onClickOutside(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) {
    open.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (open.value) open.value = false
  }
}

onMounted(() => {
  void load()
  document.addEventListener('click', onClickOutside)
  document.addEventListener('keydown', onKeydown)

  // Tự mở theo chế độ hiển thị + kích thước màn hình:
  // - Floating: mở trên cả PC và mobile (nút tròn rời không che nội dung).
  // - Popup: chỉ mở trên PC (≥768px); mobile thu gọn để bảng không che nội dung.
  // `socialAutoOpen` tắt → không tự mở ở đâu (admin chủ ý).
  if (typeof window !== 'undefined' && config.value.socialAutoOpen !== false) {
    const isDesktop = window.innerWidth >= 768
    if (isFloating.value) {
      isExpanded.value = true
      open.value = true
    } else {
      isExpanded.value = isDesktop
      open.value = isDesktop
    }
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
  document.removeEventListener('keydown', onKeydown)
})

function hexToRgba(hex: string, alpha: number) {
  let c = (hex || '').replace('#', '')
  if (c.length === 3) c = c.split('').map(x => x + x).join('')
  const num = parseInt(c, 16)
  if (isNaN(num)) return `rgba(0, 104, 255, ${alpha})`
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Trả về style nút và màu pulse theo chuẩn tpoint.minhhieu.shop
function getIconStyle(item: SocialLink) {
  const isInstagram = item.platform.toLowerCase() === 'instagram'
  const isZalo = item.platform.toLowerCase() === 'zalo'
  const baseColor = isZalo ? '#0068FF' : (item.color || '#1e4620')
  const pulseColor = isInstagram 
    ? 'rgba(228, 64, 95, 0.7)' 
    : isZalo 
      ? 'rgba(0, 104, 255, 0.7)' 
      : hexToRgba(baseColor, 0.7)

  if (item.iconType === 'fontawesome') {
    if (isInstagram) {
      return {
        background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
        color: '#ffffff',
        '--pulse-color': pulseColor,
      }
    }
    return {
      backgroundColor: baseColor,
      color: '#ffffff',
      '--pulse-color': pulseColor,
    }
  }

  return {
    backgroundColor: item.color || '#ffffff',
    '--pulse-color': pulseColor,
  }
}
</script>

<template>
  <!-- Floating mode: cột nút tròn rời từng nền tảng (tham khảo chuẩn hiệu ứng tpoint.minhhieu.shop) -->
  <div
    v-if="loaded && items.length && isFloating"
    ref="root"
    class="fixed right-3.5 bottom-[calc(84px+env(safe-area-inset-bottom,0px))] md:right-auto md:left-6 md:bottom-6 z-[9950] flex flex-col items-end md:items-start gap-2.5 select-none transition-all duration-300"
    :class="{ 'opacity-0 pointer-events-none translate-y-3': isHidden }"
  >
    <!-- Khi đang mở rộng (Mặc định trên cả PC lẫn Mobile ở floating mode): hiển thị các nút tròn rời kèm nhãn chữ và nút X thu gọn -->
    <TransitionGroup
      enter-active-class="transition duration-250 ease-out"
      enter-from-class="opacity-0 translate-y-3 scale-90"
      enter-to-class="opacity-100 translate-y-0 scale-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0 scale-100"
      leave-to-class="opacity-0 translate-y-2 scale-90"
    >
      <div
        v-if="isExpanded"
        key="floating-list"
        class="flex flex-col items-end md:items-start gap-2.5"
      >
        <!-- Danh sách các kênh mạng xã hội -->
        <div
          v-for="item in items"
          :key="item.id"
          class="flex items-center gap-2.5 flex-row-reverse md:flex-row group"
        >
          <!-- Nút tròn hiệu ứng zalo-pulse chuẩn tpoint.minhhieu.shop -->
          <a
            :href="item.url"
            target="_blank"
            rel="noopener noreferrer"
            class="zalo-pulse-btn w-10 h-10 sm:w-11 sm:h-11 md:w-12 md:h-12 border border-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0068FF]"
            :class="{ 'zalo-pulse-active': item.platform.toLowerCase() === 'zalo' }"
            :style="getIconStyle(item)"
            :aria-label="openLinkAria(item)"
          >
            <!-- Logo Zalo chính thức sắc nét -->
            <img
              v-if="item.platform.toLowerCase() === 'zalo'"
              src="/assets/social/zalo.svg"
              alt="Zalo"
              class="w-full h-full object-cover rounded-full"
            />
            <!-- Ảnh/SVG từ server -->
            <img
              v-else-if="item.iconType === 'image'"
              :src="item.icon"
              :alt="item.label || item.platform"
              class="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 object-contain"
            />
            <img
              v-else-if="item.iconType === 'svg'"
              :src="item.icon"
              :alt="item.label || item.platform"
              class="w-full h-full object-cover rounded-full"
            />
            <!-- FontAwesome icon -->
            <i
              v-else
              :class="item.icon"
              class="text-[1.1rem] sm:text-[1.2rem]"
              aria-hidden="true"
            ></i>
          </a>

          <!-- Nhãn chữ trắng bo góc chuẩn .zalo-text-label của tpoint.minhhieu.shop -->
          <div
            class="zalo-text-label opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none md:pointer-events-auto"
            :style="{ color: item.platform.toLowerCase() === 'zalo' ? '#0068FF' : (item.color || '#1e4620') }"
          >
            {{ item.label || item.platform }}
          </div>
        </div>

        <!-- Nút X để thu gọn (Desktop: icon + label hover; Mobile: pill [ ✕ Thu gọn ] gọn gàng) -->
        <!-- Desktop (≥md) -->
        <div class="hidden md:flex items-center gap-2.5 group">
          <button
            type="button"
            class="w-12 h-12 rounded-full bg-white/95 text-ink-secondary hover:text-[#b42318] hover:bg-[#fee4e2] border border-line shadow-[0_4px_10px_rgba(0,0,0,0.15)] flex items-center justify-center transition-all duration-200 cursor-pointer active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
            :title="t('social_collapse')"
            :aria-label="t('social_collapse_aria')"
            @click.stop="toggleExpand"
          >
            <i class="fa-solid fa-xmark text-lg transition-transform duration-200 group-hover:rotate-90" aria-hidden="true"></i>
          </button>
          <div class="zalo-text-label text-ink-muted opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            {{ t('social_collapse') }}
          </div>
        </div>

        <!-- Mobile (<md): Nút [ ✕ Thu gọn ] dạng pill viên nang nhỏ gọn -->
        <button
          type="button"
          class="flex md:hidden items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/95 backdrop-blur-md border border-[#d2e3d3] shadow-[0_4px_14px_rgba(15,35,18,0.12)] text-[#153317] active:scale-95 transition-all duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
          :aria-label="t('social_collapse_aria')"
          :aria-expanded="isExpanded"
          @click.stop="toggleExpand"
        >
          <i class="fa-solid fa-xmark text-xs text-[#b42318]" aria-hidden="true"></i>
          <span class="text-[0.74rem] font-bold">{{ t('social_collapse') }}</span>
        </button>
      </div>
    </TransitionGroup>

    <!-- Nút điều khiển khi đang THU GỌN:
         - Desktop (≥md): Kiểu [ (Zalo) Liên hệ hỗ trợ ] chuẩn tpoint
         - Mobile (<md): Viên nang hợp nhất (Unified Floating Capsule) cực kỳ tinh tế, không choán màn hình
    -->
    <!-- Desktop (≥md) -->
    <div
      v-if="!isExpanded"
      class="hidden md:flex items-center gap-2.5 cursor-pointer group"
      @click.stop="toggleExpand"
    >
      <button
        type="button"
        class="zalo-pulse-btn zalo-pulse-active w-12 h-12 bg-gradient-to-br from-brand-700 to-[#153317] text-white border border-white/30 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-700"
        style="--pulse-color: rgba(44, 110, 51, 0.75)"
        :aria-label="t('social_expand_aria')"
        :aria-expanded="isExpanded"
      >
        <i class="fa-solid fa-headset text-lg text-white" aria-hidden="true"></i>
      </button>

      <div class="zalo-text-label group-hover:shadow-[0_6px_14px_rgba(44,110,51,0.25)] transition-shadow">
        {{ t('social_support') }}
      </div>
    </div>

    <!-- Mobile (<md): Viên nang hợp nhất (Unified Floating Capsule) -->
    <!-- Tên truy cập chứa nguyên văn chữ nhìn thấy ("Hỗ trợ 24/7") rồi mới tới mô tả (WCAG 2.5.3). -->
    <button
      v-if="!isExpanded"
      type="button"
      class="flex md:hidden items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full bg-white/95 backdrop-blur-md border border-[#d2e3d3] shadow-[0_6px_20px_rgba(15,35,18,0.16)] active:scale-95 transition-all duration-200 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
      :aria-label="`${t('social_support')}. ${t('social_expand_aria')}`"
      :aria-expanded="isExpanded"
      @click.stop="toggleExpand"
    >
      <span class="flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-brand-700 animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
        <span class="text-[0.76rem] font-bold text-[#153317] tracking-tight">{{ t('social_support') }}</span>
      </span>
      <span
        class="w-7 h-7 rounded-full bg-gradient-to-br from-brand-700 to-[#153317] text-white flex items-center justify-center zalo-pulse-btn zalo-pulse-active shrink-0 shadow-xs"
        style="--pulse-color: rgba(44, 110, 51, 0.75)"
        aria-hidden="true"
      >
        <i class="fa-solid fa-headset text-[0.82rem] text-white" aria-hidden="true"></i>
      </span>
    </button>
  </div>

  <!-- Popup mode: panel + launcher (mặc định) -->
  <div
    v-else-if="loaded && items.length"
    ref="root"
    class="fixed right-3.5 bottom-[calc(84px+env(safe-area-inset-bottom,0px))] md:right-auto md:left-6 md:bottom-6 z-[9950] flex flex-col items-end md:items-start gap-2.5 transition-all select-none"
    :class="{ 'opacity-0 pointer-events-none translate-y-3': isHidden }"
  >
    <!-- Panel danh sách kênh mạng xã hội chính thức (mở lên phía trên launcher) -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-3 scale-95"
      enter-to-class="opacity-100 translate-y-0 scale-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0 scale-100"
      leave-to-class="opacity-0 translate-y-2 scale-95"
    >
      <div
        v-if="open"
        class="w-[285px] sm:w-[315px] max-h-[350px] sm:max-h-[410px] bg-white rounded-2xl border border-line shadow-[0_20px_50px_-12px_rgba(20,50,25,0.25),0_4px_16px_rgba(0,0,0,0.08)] overflow-hidden flex flex-col motion-reduce:transition-none"
        role="dialog"
        :aria-label="t('social_panel_aria')"
      >
        <!-- Header: Gradient xanh C11 uy tín + thông tin nhận diện (shrink-0 không bao giờ bị bóp méo) -->
        <div class="shrink-0 bg-gradient-to-r from-brand-900 via-[#245328] to-brand-900 px-3.5 py-3 flex items-center justify-between text-white border-b border-white/10">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-8 h-8 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center text-white shrink-0 shadow-inner">
              <i class="fa-solid fa-share-nodes text-[0.85rem]" aria-hidden="true"></i>
            </div>
            <div class="min-w-0">
              <h4 class="text-[0.82rem] font-bold text-white tracking-wide leading-tight m-0 truncate">
                {{ t('social_panel_title') }}
              </h4>
              <p class="text-[0.66rem] text-white/80 font-normal leading-tight mt-0.5 m-0 truncate">
                {{ t('social_panel_subtitle') }}
              </p>
            </div>
          </div>
          <!-- Nút X đóng bảng popup trên PC và Mobile -->
          <button
            type="button"
            class="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 active:scale-90 text-white flex items-center justify-center border-none cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 shrink-0 ml-2"
            :aria-label="t('social_close_aria')"
            @click.stop="close"
          >
            <i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i>
          </button>
        </div>

        <!-- Danh sách kênh chính thức: Giới hạn vừa vặn 4 mục trên mobile, kéo xuống để xem thêm -->
        <div class="social-scroll-list flex-1 min-h-0 max-h-[230px] sm:max-h-[290px] p-2 overflow-y-auto overscroll-contain flex flex-col gap-1 [scrollbar-width:thin] [scrollbar-color:#2c6e33_#f0f4f0]">
          <a
            v-for="item in items"
            :key="item.id"
            :href="item.url"
            target="_blank"
            rel="noopener noreferrer"
            class="group flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-surface-tint border border-transparent hover:border-line transition-all duration-150 no-underline"
            :aria-label="openLinkAria(item)"
          >
            <!-- Khung icon squircle chuẩn hóa 36x36px -->
            <span
              class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-2xs transition-transform duration-200 group-hover:scale-105 overflow-hidden"
              :style="getIconStyle(item)"
            >
              <img
                v-if="item.iconType === 'image'"
                :src="item.icon"
                :alt="item.label || item.platform"
                class="w-6 h-6 object-contain"
              />
              <img
                v-else-if="item.iconType === 'svg'"
                :src="item.icon"
                :alt="item.label || item.platform"
                class="w-full h-full object-cover rounded-xl"
              />
              <i
                v-else
                :class="item.icon"
                class="text-[1.05rem]"
                aria-hidden="true"
              ></i>
            </span>

            <!-- Thông tin tên nền tảng & nhãn hiển thị -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="text-[0.82rem] font-bold text-ink group-hover:text-brand-900 transition-colors leading-snug truncate">
                  {{ item.platform }}
                </span>
                <i class="fa-solid fa-circle-check text-[0.65rem] text-brand-700 shrink-0" title="Kênh chính thức" aria-hidden="true"></i>
              </div>
              <span class="text-[0.68rem] text-ink-muted block truncate leading-tight mt-0.5">
                {{ item.label || item.platform }}
              </span>
            </div>

            <!-- Mũi tên liên kết ra ngoài -->
            <span class="w-6 h-6 rounded-full bg-transparent group-hover:bg-white text-[#9ca3af] group-hover:text-brand-900 flex items-center justify-center transition-all shrink-0">
              <i class="fa-solid fa-arrow-up-right-from-square text-[0.65rem] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true"></i>
            </span>
          </a>
        </div>

        <!-- Footer chứng nhận uy tín C11 (shrink-0 cố định đáy) -->
        <div class="shrink-0 px-3.5 py-2 bg-surface border-t border-line flex items-center justify-between text-[0.68rem] text-ink-soft">
          <span class="flex items-center gap-1.5 font-medium">
            <i class="fa-solid fa-shield-check text-brand-800 text-[0.75rem]" aria-hidden="true"></i>
            C11 - BCA
          </span>
        </div>
      </div>
    </Transition>

    <!-- Nút launcher kích hoạt dạng viên nang hoàn mỹ (Nhỏ gọn, tinh tế, không méo tròn) -->
    <button
      type="button"
      class="group flex items-center gap-2 bg-gradient-to-r from-brand-900 to-[#153317] hover:from-[#153317] hover:to-brand-950 text-white px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-full border border-white/20 shadow-[0_8px_24px_rgba(30,70,32,0.28)] hover:shadow-[0_12px_28px_rgba(30,70,32,0.38)] hover:-translate-y-0.5 cursor-pointer transition-all duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-900 motion-reduce:transition-none"
      :class="{ 'ring-2 ring-[#7CB342] shadow-[0_12px_28px_rgba(30,70,32,0.45)]': open }"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :aria-label="t('social_launcher_aria')"
      @click.stop="toggle"
    >
      <span class="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center text-[0.82rem] transition-transform duration-200 group-hover:rotate-12">
        <i class="fa-solid fa-share-nodes text-white" aria-hidden="true"></i>
      </span>
      <span class="text-[0.8rem] sm:text-[0.84rem] font-bold tracking-wide text-white">{{ t('social_launcher') }}</span>
      <span
        v-if="items.length"
        class="inline-flex items-center justify-center min-w-[1.2rem] h-4.5 sm:h-5 px-1.5 text-[0.62rem] sm:text-[0.65rem] font-extrabold rounded-full bg-white/20 text-white"
      >
        {{ items.length }}
      </span>
    </button>
  </div>
</template>

<style scoped>
/* Hiệu ứng tỏa sáng xung quanh nút chuẩn tpoint.minhhieu.shop */
@keyframes zalo-pulse {
  0% {
    box-shadow: 0 0 0 0 var(--pulse-color, rgba(0, 104, 255, 0.7));
  }
  70% {
    box-shadow: 0 0 0 15px rgba(0, 0, 0, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(0, 0, 0, 0);
  }
}

.zalo-pulse-btn {
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
  animation: zalo-pulse 1.8s infinite;
  transition: transform 0.3s ease;
}

.zalo-pulse-btn.zalo-pulse-active {
  animation: zalo-pulse 1.5s infinite;
}

.zalo-pulse-btn:hover {
  transform: scale(1.1);
  animation: zalo-pulse 1.2s infinite;
}

/* Người dùng bật "giảm chuyển động": tắt vòng sáng lặp vô hạn (kể cả khi hover). */
@media (prefers-reduced-motion: reduce) {
  .zalo-pulse-btn,
  .zalo-pulse-btn.zalo-pulse-active,
  .zalo-pulse-btn:hover {
    animation: none;
    transition: none;
  }
}

.zalo-pulse-btn svg,
.zalo-pulse-btn i,
.zalo-pulse-btn img {
  filter: drop-shadow(1px 1px 2px rgba(0, 0, 0, 0.2));
}

/* Định dạng dòng chữ "Liên hệ hỗ trợ" chuẩn tpoint.minhhieu.shop */
.zalo-text-label {
  background-color: #ffffff;
  color: #0068FF;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  padding: 7px 15px;
  border-radius: 20px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
  white-space: nowrap;
  border: 1px solid #e0e0e0;
  line-height: 1.3;
}

/* Custom scrollbar cho danh sách kênh trên mobile và desktop */
.social-scroll-list::-webkit-scrollbar {
  width: 5px;
}
.social-scroll-list::-webkit-scrollbar-track {
  background: #f0f4f0;
  border-radius: 4px;
}
.social-scroll-list::-webkit-scrollbar-thumb {
  background: #2c6e33;
  border-radius: 4px;
}
.social-scroll-list::-webkit-scrollbar-thumb:hover {
  background: #1e4620;
}
</style>
