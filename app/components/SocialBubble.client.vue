<script setup lang="ts">
interface SocialLink {
  id: number
  platform: string
  label: string
  url: string
  icon: string
  iconType: 'fontawesome' | 'image' | 'svg'
  color: string
  sortOrder: number
}

const items = ref<SocialLink[]>([])
// Mặc định mở theo yêu cầu người dùng.
const open = ref(true)
const loaded = ref(false)
const root = ref<HTMLElement | null>(null)

async function load() {
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: SocialLink[] }>)('/api/public/social-links')
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
  if (e.key === 'Escape' && open.value) {
    open.value = false
  }
}

onMounted(() => {
  void load()
  document.addEventListener('click', onClickOutside)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
  document.removeEventListener('keydown', onKeydown)
})

// Trả về phong cách màu sắc hài hòa và chuyên nghiệp theo từng nền tảng
function getIconStyle(item: SocialLink) {
  if (item.iconType === 'fontawesome') {
    if (item.platform.toLowerCase() === 'instagram') {
      return {
        background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
        color: '#ffffff',
      }
    }
    return {
      backgroundColor: item.color || '#1e4620',
      color: '#ffffff',
    }
  }
  return {}
}
</script>

<template>
  <div
    v-if="loaded && items.length"
    ref="root"
    class="fixed left-4 bottom-[88px] md:left-6 md:bottom-6 z-[10007] flex flex-col items-start gap-2.5 transition-all select-none"
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
        class="w-[290px] sm:w-[310px] bg-white rounded-2xl border border-[#dce6dc] shadow-[0_20px_50px_-12px_rgba(20,50,25,0.22),0_4px_16px_rgba(0,0,0,0.06)] overflow-hidden flex flex-col motion-reduce:transition-none"
        role="dialog"
        aria-label="Kênh mạng xã hội chính thức C11"
      >
        <!-- Header: Gradient xanh C11 uy tín + thông tin nhận diện -->
        <div class="bg-gradient-to-r from-[#1e4620] via-[#245328] to-[#1e4620] px-3.5 py-3 flex items-center justify-between text-white border-b border-white/10">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-8 h-8 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center text-white shrink-0 shadow-inner">
              <i class="fa-solid fa-share-nodes text-[0.85rem]" aria-hidden="true"></i>
            </div>
            <div class="min-w-0">
              <h4 class="text-[0.82rem] font-bold text-white tracking-wide leading-tight m-0 truncate">
                Kênh mạng xã hội
              </h4>
              <p class="text-[0.66rem] text-white/80 font-normal leading-tight mt-0.5 m-0 truncate">
                Cục C11 — Bộ Công an
              </p>
            </div>
          </div>
          <button
            type="button"
            class="w-7 h-7 rounded-full bg-white/10 hover:bg-white/25 active:scale-90 text-white/90 hover:text-white flex items-center justify-center border-none cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 shrink-0 ml-2"
            aria-label="Đóng bảng mạng xã hội"
            @click.stop="close"
          >
            <i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i>
          </button>
        </div>

        <!-- Danh sách kênh chính thức -->
        <div class="p-2 max-h-[min(380px,calc(100dvh-220px))] overflow-y-auto overscroll-contain flex flex-col gap-1">
          <a
            v-for="item in items"
            :key="item.id"
            :href="item.url"
            target="_blank"
            rel="noopener noreferrer"
            class="group flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-[#f2f7f2] border border-transparent hover:border-[#dce6dc] transition-all duration-150 no-underline"
            :aria-label="`Mở ${item.label || item.platform} (mở tab mới)`"
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
                <span class="text-[0.82rem] font-bold text-[#1E251C] group-hover:text-[#1e4620] transition-colors leading-snug truncate">
                  {{ item.platform }}
                </span>
                <i class="fa-solid fa-circle-check text-[0.65rem] text-[#2c6e33] shrink-0" title="Kênh chính thức" aria-hidden="true"></i>
              </div>
              <span class="text-[0.68rem] text-[#667768] block truncate leading-tight mt-0.5">
                {{ item.label || item.platform }}
              </span>
            </div>

            <!-- Mũi tên liên kết ra ngoài -->
            <span class="w-6 h-6 rounded-full bg-transparent group-hover:bg-white text-[#9ca3af] group-hover:text-[#1e4620] flex items-center justify-center transition-all shrink-0">
              <i class="fa-solid fa-arrow-up-right-from-square text-[0.65rem] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true"></i>
            </span>
          </a>
        </div>

        <!-- Footer chứng nhận uy tín C11 -->
        <div class="px-3.5 py-2 bg-[#F8FAF7] border-t border-[#e2ece3] flex items-center justify-between text-[0.68rem] text-[#556655]">
          <span class="flex items-center gap-1.5 font-medium">
            <i class="fa-solid fa-shield-check text-[#385130] text-[0.75rem]" aria-hidden="true"></i>
            C11 - BCA
          </span>
        </div>
      </div>
    </Transition>

    <!-- Nút launcher nổi (tương tự như nút Hỏi trợ lý ở góc đối diện) -->
    <button
      type="button"
      class="group flex items-center gap-2.5 bg-[#1e4620] hover:bg-[#153317] text-white px-3.5 py-2.5 rounded-full shadow-[0_8px_24px_rgba(30,70,32,0.22)] hover:shadow-[0_12px_28px_rgba(30,70,32,0.32)] border border-white/15 cursor-pointer transition-all duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342] focus-visible:ring-offset-2 motion-reduce:transition-none"
      :class="{ 'ring-2 ring-[#7CB342] bg-[#153317] shadow-[0_12px_28px_rgba(30,70,32,0.35)]': open }"
      :aria-expanded="open"
      aria-haspopup="dialog"
      aria-label="Kênh mạng xã hội C11"
      @click.stop="toggle"
    >
      <span class="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center text-[0.8rem] transition-transform duration-200 group-hover:rotate-12">
        <i class="fa-solid fa-share-nodes" aria-hidden="true"></i>
      </span>
      <span class="text-[0.84rem] font-bold tracking-wide">Mạng xã hội</span>
      <span
        v-if="items.length"
        class="hidden sm:inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 text-[0.65rem] font-bold rounded-full bg-white/20 text-white"
      >
        {{ items.length }}
      </span>
    </button>
  </div>
</template>
