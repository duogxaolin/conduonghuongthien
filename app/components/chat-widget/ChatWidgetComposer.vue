<template>
  <div class="flex-shrink-0 bg-white border-t border-line px-3 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom,0px))] md:pb-3 md:rounded-b-2xl">
    <form class="flex items-end gap-2" @submit.prevent="emit('submit')">
      <!-- Honeypot: hidden from sight and from the tab order, so only a
           script that fills every field it finds will write to it. -->
      <input v-model="honeypot" type="text" name="_h" tabindex="-1" autocomplete="off" aria-hidden="true" class="absolute left-[-9999px] w-px h-px opacity-0 pointer-events-none" />
      <div class="flex-1 min-w-0">
        <label for="public-chatbot-input" class="sr-only">{{ t('cw_input_label') }}</label>
        <input
          id="public-chatbot-input"
          ref="botInputRef"
          type="text"
          :placeholder="t('cw_input_placeholder')"
          v-model="botInput"
          :maxlength="limits.maxMessageChars"
          :aria-describedby="botInputError ? 'public-chatbot-error public-chatbot-counter' : 'public-chatbot-counter'"
          :aria-invalid="Boolean(botInputError)"
          :disabled="isSubmitting"
          class="w-full px-4 py-3 rounded-full border border-[#d4e4d2] text-base md:text-[0.88rem] outline-none bg-surface transition-all focus:border-brand-900 focus:bg-white focus:shadow-[0_0_0_3px_rgba(30,70,32,0.08)] disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div v-if="botInputError" class="mt-1 px-4">
          <slot name="error" />
        </div>
      </div>
      <button type="submit" :disabled="isSubmitting || !botInput.trim()" class="w-11 h-11 rounded-full bg-brand-900 text-white border-none flex flex-shrink-0 items-center justify-center cursor-pointer transition-all hover:bg-[#153317] hover:shadow-[0_4px_12px_rgba(30,70,32,0.3)] active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:bg-[#a0b89e]" :aria-label="t('cw_send_aria')">
        <i class="fa-solid fa-paper-plane text-[0.85rem]"></i>
      </button>
    </form>
    <p id="public-chatbot-counter" class="m-0 mt-1 text-[0.65rem] text-[#9ca3af] text-right px-2" :class="{ '!text-[#b42318]': botInput.length > limits.maxMessageChars * 0.9 }">{{ botInput.length }}/{{ limits.maxMessageChars }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '~/composables/useI18n'

/**
 * The chat input row (`ChatWidget.vue`, wave3 split): the honeypot, the question box, the
 * send button and the character counter. Display only — the text and the honeypot are
 * the widget's (`v-model`), the send is emitted, and the input error is the widget's own
 * `role="alert"` line, rendered through the `#error` slot right under the box.
 */
defineProps<{
  limits: { maxMessageChars: number }
  botInputError: string
  isSubmitting: boolean
}>()
const botInput = defineModel<string>('botInput', { required: true })
const honeypot = defineModel<string>('honeypot', { required: true })
const emit = defineEmits<{ submit: [] }>()
const { t } = useI18n()

const botInputRef = ref<HTMLInputElement | null>(null)
/** The widget puts focus back in the box after an answer (desktop only). */
defineExpose({ focus: () => botInputRef.value?.focus() })
</script>
