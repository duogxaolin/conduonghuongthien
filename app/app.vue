<script setup lang="ts">
import { onMounted, ref } from 'vue'

// Page loading overlay — CSS-driven, shows immediately from SSR HTML and hides
// once Vue hydration completes. Covers the gap between "blank screen" and "page
// rendered" that `pending` skeletons can't reach (they only work during client
// navigation, not initial load).
const isPageLoading = ref(true)
onMounted(() => {
  // nextTick not needed — onMounted means Vue has finished hydrating and the
  // real page content is already rendered. Hiding the overlay now is safe.
  isPageLoading.value = false
})
</script>

<template>
  <div>
    <!-- Page Loading Overlay — hides after hydration -->
    <div
      v-if="isPageLoading"
      class="fixed inset-0 bg-[#F8FAF7] z-[99999] flex items-center justify-center transition-opacity duration-300"
      :class="{ 'opacity-0 pointer-events-none': !isPageLoading }"
      aria-live="polite"
      aria-busy="true"
    >
      <div class="flex flex-col items-center gap-4">
        <!-- Spinner -->
        <div
          class="w-12 h-12 border-4 border-[#E2E8DF] border-t-[#4A6741] rounded-full animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        ></div>
        <span class="text-[#4A6741] text-sm font-semibold">Đang tải...</span>
      </div>
    </div>

    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>
