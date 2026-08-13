<script setup lang="ts">
import { onMounted, ref } from 'vue'

const isInitialLoad = ref(true)
const isNavigating = ref(false)
let navTimer: ReturnType<typeof setTimeout> | null = null

const nuxtApp = useNuxtApp()

onMounted(() => {
  isInitialLoad.value = false
})

// Phản hồi chuyển trang: khi điều hướng client-side bắt đầu, hiện lớp phủ làm mờ
// trang hiện tại + spinner ở giữa. Trì hoãn 100ms để các trang load nhanh (cache)
// không chớp lớp phủ — thanh load phía trên vẫn phản hồi tức thì qua throttle 0.
// Fade-out che mọi khung trắng giữa lúc trang cũ gỡ và trang mới kịp vẽ.
if (import.meta.client) {
  nuxtApp.hook('page:start', () => {
    if (navTimer) clearTimeout(navTimer)
    navTimer = setTimeout(() => {
      isNavigating.value = true
    }, 100)
  })

  nuxtApp.hook('page:finish', () => {
    if (navTimer) {
      clearTimeout(navTimer)
      navTimer = null
    }
    isNavigating.value = false
  })
}
</script>

<template>
  <div>
    <!-- Khung tải toàn màn hình cho lượt tải đầu tiên -->
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-300"
      enter-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isInitialLoad"
        class="fixed inset-0 bg-[#F8FAF7] z-[99999] flex items-center justify-center"
        aria-live="polite"
        aria-busy="true"
      >
        <div class="flex flex-col items-center gap-4">
          <div
            class="w-12 h-12 border-4 border-[#E2E8DF] border-t-[#4A6741] rounded-full animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          ></div>
          <span class="text-[#4A6741] text-sm font-semibold">Đang tải...</span>
        </div>
      </div>
    </Transition>

    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <!-- Lớp phủ chuyển trang — thiết kế Liquid Glass.
         Trên mobile lớp nền phải đủ đậm để thấy rõ trang đang tải: nền xanh nhạt
         vốn đã nhạt nên dùng gradient xanh đậm (0.28) + backdrop-blur mạnh (12px)
         để nội dung trang hiện rõ "đang mờ/lùi lại". Spinner nằm trong thẻ kính
         (glass card) nổi bật ở giữa thay vì rời rạc trên nền trong suốt.

         z-[9998] nằm dưới header (z-[10001]) và thanh load phía trên (mặc định
         rất cao) nên thanh điều hướng vẫn nhìn rõ, chỉ nội dung trang bị mờ.
         Lớp nền không bao giờ trắng. Fade-out (200ms) che mọi khung trắng khi
         đổi trang. -->
    <Transition
      enter-active-class="transition-opacity duration-150"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isNavigating"
        class="fixed inset-0 z-[9998] bg-[linear-gradient(135deg,rgba(56,81,48,0.32)_0%,rgba(74,103,65,0.26)_100%)] backdrop-blur-md flex items-center justify-center px-6"
        aria-live="polite"
        aria-busy="true"
      >
        <!-- Thẻ kính chứa spinner — glass card nổi bật với border sáng + shadow sâu -->
        <div
          class="flex flex-col items-center gap-4 px-8 py-7 rounded-[28px] bg-white/80 backdrop-blur-xl border border-white/90 shadow-[0_20px_50px_rgba(15,35,18,0.25),inset_0_1px_2px_rgba(255,255,255,0.6)]"
        >
          <div class="relative" aria-hidden="true">
            <!-- Vòng ngoài mờ trang trí -->
            <div class="absolute inset-0 rounded-full bg-[#4A6741]/10 blur-md animate-pulse motion-reduce:animate-none"></div>
            <!-- Spinner chính: to hơn trên mobile để dễ thấy -->
            <div
              class="relative w-12 h-12 sm:w-14 sm:h-14 border-[3.5px] border-[#D7E5D2] border-t-[#4A6741] rounded-full animate-spin motion-reduce:animate-none"
            ></div>
          </div>
          <span class="text-[#385130] text-sm font-bold tracking-wide">Đang chuyển trang</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style>
/* Đảm bảo background luôn là màu xanh nhạt, không bao giờ trắng */
html,
body {
  background-color: #F8FAF7;
  min-height: 100vh;
}
</style>
