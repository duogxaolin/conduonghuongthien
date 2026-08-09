<script setup lang="ts">
import { onMounted, ref } from 'vue'

const isInitialLoad = ref(true)
onMounted(() => {
  isInitialLoad.value = false
})
</script>

<template>
  <div>
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
  </div>
</template>

<style>
.page-enter-active,
.page-leave-active {
  transition: opacity 0.15s ease-out, transform 0.15s ease-out;
}
.page-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.page-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
