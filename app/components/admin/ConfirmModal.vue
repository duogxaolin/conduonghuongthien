<script setup lang="ts">
const { confirmState, accept, cancel } = useConfirm()

function onKeydown(e: KeyboardEvent) {
  if (!confirmState.visible) return
  if (e.key === 'Enter') accept()
  if (e.key === 'Escape') cancel()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-fade">
      <div
        v-if="confirmState.visible"
        class="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50"
        @click.self="cancel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="confirmState.options.title ? 'confirm-title' : undefined"
        aria-describedby="confirm-message"
      >
        <div class="w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden">
          <!-- Header -->
          <div class="flex items-start gap-3 px-5 pt-5 pb-4">
            <div
              class="shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
              :class="confirmState.options.danger ? 'bg-red-100' : 'bg-amber-100'"
            >
              <i
                class="text-lg"
                :class="confirmState.options.danger ? 'fa-solid fa-triangle-exclamation text-red-500' : 'fa-solid fa-circle-question text-amber-500'"
                aria-hidden="true"
              ></i>
            </div>
            <div class="flex-1 min-w-0 pt-1">
              <h3
                v-if="confirmState.options.title"
                id="confirm-title"
                class="m-0 text-[1rem] font-extrabold text-[#122815] leading-tight"
              >
                {{ confirmState.options.title }}
              </h3>
              <p
                id="confirm-message"
                class="m-0 text-[0.9rem] text-[#4a5e4d] leading-relaxed"
                :class="confirmState.options.title ? 'mt-1' : ''"
              >
                {{ confirmState.options.message }}
              </p>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex gap-2 justify-end px-5 pb-5">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-lg border border-[#dce8dd] bg-white px-4 py-2 text-sm font-semibold text-[#4a5e4d] hover:bg-[#f0f7f1] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
              @click="cancel"
            >
              {{ confirmState.options.cancelLabel || 'Hủy' }}
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors"
              :class="confirmState.options.danger
                ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                : 'bg-[#2c6e33] hover:bg-[#245b2a] focus:ring-[#2c6e33]'"
              @click="accept"
            >
              {{ confirmState.options.confirmLabel || 'Xác nhận' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity 0.15s ease;
}
.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}
.confirm-fade-enter-active > div,
.confirm-fade-leave-active > div {
  transition: transform 0.15s ease;
}
.confirm-fade-enter-from > div,
.confirm-fade-leave-to > div {
  transform: scale(0.95);
}
</style>
