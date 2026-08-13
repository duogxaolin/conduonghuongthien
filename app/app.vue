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

    <!-- Lớp phủ chuyển trang: làm mờ trang hiện tại + spinner ở giữa.
         z-[9998] nằm dưới header (z-[10001]) và thanh load phía trên (mặc định
         rất cao) nên thanh điều hướng vẫn nhìn rõ, chỉ nội dung trang bị mờ.
         Lớp nền dùng đúng màu xanh nhạt của site nên không bao giờ trắng.
         Fade-out (200ms) che mọi khung trắng khi đổi trang. -->
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
        class="fixed inset-0 z-[9998] bg-[rgba(248,250,247,0.7)] backdrop-blur-[4px] flex items-center justify-center"
        aria-live="polite"
        aria-busy="true"
      >
        <div class="flex flex-col items-center gap-3">
          <div
            class="w-10 h-10 border-4 border-[#E2E8DF] border-t-[#4A6741] rounded-full animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          ></div>
          <span class="text-[#4A6741] text-xs font-semibold">Đang chuyển trang...</span>
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
