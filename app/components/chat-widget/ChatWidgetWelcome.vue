<template>
  <div class="mx-auto mt-4 mb-2 max-w-[280px] text-center">
    <div class="w-14 h-14 mx-auto mb-3 rounded-full bg-brand-900/10 flex items-center justify-center">
      <i class="fa-solid fa-shield-halved text-brand-900 text-[1.4rem]"></i>
    </div>
    <p class="text-[0.82rem] text-ink-secondary leading-relaxed m-0"><I18nStrong :text="t('cw_welcome')" :values="{ org: t('cw_welcome_org') }" strong-class="text-brand-900" /></p>
  </div>
</template>

<script setup lang="ts">
/**
 * The greeting at the top of an empty chat transcript (`ChatWidget.vue`, wave3 split).
 * Static; the widget shows it while the conversation has nothing but the welcome message.
 * "Xin chào! … đã được **Cục C11** phê duyệt." — the bold name sits where each language
 * puts it (`cw_welcome` has `{org}`).
 */
import I18nStrong from '~/components/I18nStrong.vue'
import { useI18n } from '~/composables/useI18n'

const { t } = useI18n()
</script>
