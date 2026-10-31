<template>
  <div class="flex-shrink-0 bg-brand-900 px-4 pt-[calc(env(safe-area-inset-top,0px)+12px)] pb-3 md:pt-3 md:rounded-t-2xl">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <button class="md:hidden w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white/90 text-[1rem] border-none cursor-pointer transition-[background-color,transform] active:scale-90" @click="emit('close')" :aria-label="t('cw_back')">
          <i class="fa-solid fa-arrow-left"></i>
        </button>
        <div class="w-10 h-10 rounded-full bg-white/15 border-2 border-white/30 flex items-center justify-center flex-shrink-0">
          <i class="fa-solid fa-robot text-white text-[1.1rem]"></i>
        </div>
        <div>
          <h4 id="public-chatbot-title" class="text-[0.95rem] font-bold text-white m-0 leading-tight">Trợ lý Hướng Thiện</h4>
          <p class="text-[0.7rem] text-white/60 mt-0.5 mb-0 flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-accent inline-block animate-pulse" aria-hidden="true"></span>
            Đang hoạt động
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2 md:gap-1.5">
        <button
          class="w-10 h-10 md:w-8 md:h-8 rounded-full bg-white/10 border-none text-white/80 flex items-center justify-center cursor-pointer transition-[background-color,transform] hover:bg-white/20 active:scale-90"
          @click="emit('toggle-history')"
          :aria-expanded="isConversationListOpen"
          :title="t('cw_history')"
          :aria-label="t('cw_history')"
        >
          <i class="fa-solid fa-clock-rotate-left text-[0.9rem] md:text-[0.8rem]"></i>
        </button>
        <button class="w-10 h-10 md:w-8 md:h-8 rounded-full bg-white/10 border-none text-white/80 flex items-center justify-center cursor-pointer transition-[background-color,transform] hover:bg-white/20 active:scale-90" @click="emit('clear')" :title="t('cw_clear')" :aria-label="t('cw_clear')">
          <i class="fa-solid fa-broom text-[0.9rem] md:text-[0.8rem]"></i>
        </button>
        <!-- Expand: desktop/iPad only. The full page is a two-column layout
             that has no room to be useful on a phone. -->
        <button class="hidden md:flex w-8 h-8 rounded-full bg-white/10 border-none text-white/80 items-center justify-center cursor-pointer transition-[background-color,transform] hover:bg-white/20 active:scale-90" @click="emit('expand')" :title="t('cw_expand')" :aria-label="t('cw_expand')">
          <i class="fa-solid fa-up-right-and-down-left-from-center text-[0.75rem]"></i>
        </button>
        <button class="hidden md:flex w-8 h-8 rounded-full bg-white/10 border-none text-white/80 items-center justify-center cursor-pointer transition-[background-color,transform] hover:bg-white/20 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50" @click="emit('close')" aria-label="Đóng">
          <i class="fa-solid fa-xmark text-[0.9rem]"></i>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'

/**
 * The chat dialog's header (`ChatWidget.vue`, wave3 split): back (phones), history,
 * clear, expand and close (desktop/iPad). Display only — every button emits, the widget
 * acts.
 *
 * Header buttons avoid `transition-all`: they would transition the visibility they
 * inherit from the dialog, and the first one takes focus the moment the dialog opens
 * (design D24, tests/chat-widget-dialog-a11y.test.ts).
 */
defineProps<{
  /** Whether the conversation list under the header is open. */
  isConversationListOpen: boolean
}>()
const emit = defineEmits<{ close: [], 'toggle-history': [], clear: [], expand: [] }>()
const { t } = useI18n()
</script>
