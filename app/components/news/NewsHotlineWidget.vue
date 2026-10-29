<template>
  <div class="relative rounded-2xl overflow-hidden shadow-md text-white bg-gradient-to-br from-[#294B26] via-[#203D1E] to-[#162D15] p-6 border border-[#3E6539]">
    <div class="flex items-center gap-2 mb-2">
      <span class="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center text-xs">
        <i class="fa-solid fa-shield-halved text-[#A8D59D]" aria-hidden="true"></i>
      </span>
      <span class="text-[0.7rem] font-black uppercase tracking-wider text-[#A8D59D]">{{ t('support_24_7') }}</span>
    </div>
    <h3 class="text-[1.05rem] font-black m-0 mb-1.5 leading-snug">{{ t('hotline_title') }}</h3>
    <p class="text-xs leading-relaxed m-0 mb-4 text-white/80">
      {{ t('hotline_desc') }}
    </p>

    <a
      href="tel:0903480985"
      class="flex items-center justify-center gap-2.5 w-full bg-[#4a7c1e] hover:bg-[#3d6b15] text-white py-2.5 px-4 rounded-xl text-sm font-black no-underline transition-all shadow-md mb-2.5"
    >
      <i class="fa-solid fa-phone" aria-hidden="true"></i>
      <span>0903.480.985</span>
    </a>

    <nuxt-link
      to="/assistant"
      class="flex items-center justify-center gap-2 w-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold py-2 px-3 rounded-xl no-underline transition-all border border-white/15"
    >
      <i class="fa-solid fa-robot text-[0.8rem]" aria-hidden="true"></i>
      <span>{{ t('ask_ai_24_7') }}</span>
    </nuxt-link>
  </div>
</template>

<script setup lang="ts">
/** `/news` rail: "Hotline & Hỗ Trợ 24/7" — static. */
import { useI18n } from '~/composables/useI18n'

const { t } = useI18n()
</script>
