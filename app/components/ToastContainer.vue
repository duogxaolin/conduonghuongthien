<template>
  <Teleport to="body">
    <div
      class="fixed top-6 right-6 z-[999999] flex flex-col gap-3 max-w-[420px] w-[calc(100vw-48px)] pointer-events-none"
      aria-live="polite"
      aria-atomic="true"
    >
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="relative flex items-start gap-[14px] px-[18px] py-4 rounded-xl bg-white/[0.96] backdrop-blur-[12px] shadow-[0_10px_30px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)] border border-black/[0.08] pointer-events-auto overflow-hidden transition-all duration-300"
          :class="{
            'border-l-[5px] border-l-[#2e7d32]': toast.type === 'success',
            'border-l-[5px] border-l-[#d32f2f]': toast.type === 'error',
            'border-l-[5px] border-l-[#ed6c02]': toast.type === 'warning',
            'border-l-[5px] border-l-[#0288d1]': toast.type === 'info' || !['success','error','warning'].includes(toast.type),
          }"
        >
          <div
            class="text-[1.4rem] flex-shrink-0 mt-[2px]"
            :class="{
              'text-[#2e7d32]': toast.type === 'success',
              'text-[#d32f2f]': toast.type === 'error',
              'text-[#ed6c02]': toast.type === 'warning',
              'text-[#0288d1]': toast.type === 'info' || !['success','error','warning'].includes(toast.type),
            }"
          >
            <i v-if="toast.type === 'success'" class="fa-solid fa-circle-check"></i>
            <i v-else-if="toast.type === 'error'" class="fa-solid fa-circle-xmark"></i>
            <i v-else-if="toast.type === 'warning'" class="fa-solid fa-triangle-exclamation"></i>
            <i v-else class="fa-solid fa-circle-info"></i>
          </div>

          <div class="flex-1 min-w-0">
            <h4
              class="text-[0.95rem] font-bold mb-1 leading-[1.3] m-0"
              :class="{
                'text-[#1b5e20]': toast.type === 'success',
                'text-[#c62828]': toast.type === 'error',
                'text-[#e65100]': toast.type === 'warning',
                'text-[#01579b]': toast.type === 'info' || !['success','error','warning'].includes(toast.type),
              }"
            >{{ toast.title }}</h4>
            <p class="text-[0.88rem] text-[#4b5563] m-0 leading-[1.4] break-words">{{ toast.message }}</p>
          </div>

          <button
            class="bg-transparent border-0 text-[#9ca3af] text-[1.1rem] cursor-pointer px-1 py-0.5 leading-none rounded hover:text-[#1f2937] hover:bg-black/[0.05] transition-all duration-200 flex-shrink-0"
            @click="remove(toast.id)"
            aria-label="Đóng thông báo"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>

          <div
            v-if="toast.duration && toast.duration > 0"
            class="absolute bottom-0 left-0 h-[3px] w-full opacity-80 toast-progress"
            :class="{
              'bg-[#2e7d32]': toast.type === 'success',
              'bg-[#d32f2f]': toast.type === 'error',
              'bg-[#ed6c02]': toast.type === 'warning',
              'bg-[#0288d1]': toast.type === 'info' || !['success','error','warning'].includes(toast.type),
            }"
            :style="{ animationDuration: `${toast.duration}ms` }"
          ></div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const { toasts, remove } = useToast()
</script>

<style scoped>
.toast-progress {
  animation: toast-countdown linear forwards;
}

@keyframes toast-countdown {
  from { width: 100%; }
  to { width: 0%; }
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(60px) scale(0.95);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(60px) scale(0.9);
}
</style>
