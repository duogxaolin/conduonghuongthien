<template>
  <div class="fixed right-4 bottom-[88px] md:right-6 md:bottom-6 z-[10001] hidden md:flex flex-col items-end gap-2 transition-all" :class="{ 'opacity-0 pointer-events-none scale-90': isChatbotOpen }">
    <div
      v-if="chatTeaserVisible && !isChatbotOpen"
      class="hidden xl:block relative max-w-[220px] bg-white text-[#1f2937] text-[0.8rem] leading-snug px-3.5 py-2.5 rounded-[16px_16px_4px_16px] shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-black/5 animate-fade-slide-up motion-reduce:animate-none cursor-pointer"
      @click="emit('toggle')"
    >
      <p class="m-0">{{ chatTeaserText }}</p>
      <button type="button" class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#e5e7eb] text-[#6b7280] text-[0.6rem] flex items-center justify-center border-none cursor-pointer hover:bg-[#d1d5db]" @click.stop="emit('dismiss-teaser')" aria-label="Đóng">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <button
      ref="toggleButton"
      class="chatbot-toggle-btn flex bg-brand-900 text-white border border-white/20 px-4 py-2.5 pl-3.5 rounded-[50px] shadow-[0_8px_24px_rgba(30,70,32,0.25)] cursor-pointer items-center gap-2 font-bold text-[0.88rem] transition-all hover:-translate-y-0.5 hover:bg-[#153317] hover:shadow-[0_12px_30px_rgba(30,70,32,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-900 motion-reduce:transition-none"
      aria-controls="public-chatbot-dialog"
      :aria-expanded="isChatbotOpen"
      @click="emit('toggle')"
    >
      <div class="flex items-center justify-center">
        <i class="fa-solid fa-comment-dots text-[1.05rem]" aria-hidden="true"></i>
      </div>
      <span class="bot-label">{{ t('ask_ai') || 'Hỏi trợ lý' }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '~/composables/useI18n'

/**
 * The floating launcher and its teaser bubble (`ChatWidget.vue`, wave3 split), desktop
 * only (phones open the chat from the bottom nav). Display only: the teaser's timing is
 * `useChatWidgetTeaser`, opening and closing is the widget's. Shown by the widget except
 * on `/assistant`.
 */
defineProps<{
  isChatbotOpen: boolean
  chatTeaserVisible: boolean
  chatTeaserText: string
}>()
const emit = defineEmits<{ toggle: [], 'dismiss-teaser': [] }>()
const { t } = useI18n()

const toggleButton = ref<HTMLButtonElement | null>(null)
/** Where focus goes when the dialog closes and nothing else opened it. */
defineExpose({ focus: () => toggleButton.value?.focus() })
</script>
