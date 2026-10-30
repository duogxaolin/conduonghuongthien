<template>
  <section class="bg-gradient-to-br from-brand-900 to-[#133215] py-10 text-white">
    <div class="container">
      <nav aria-label="Đường dẫn" class="mb-3 text-[0.82rem] text-white/70">
        <nuxt-link to="/" class="text-white/80 no-underline hover:underline">{{ t('home') }}</nuxt-link> &raquo;
        <span class="text-white/95 font-semibold">{{ t('profile_title') }}</span>
      </nav>
      <h1 class="m-0 text-[1.7rem] font-extrabold">{{ t('profile_title') }}</h1>
      <p class="mt-2 mb-0 text-[0.92rem] text-white/80">
        {{ t('profile_subtitle') }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
/** `/profile` heading band: crumb, the page's one `<h1>`, subtitle. Rendered on the server — nothing here is the reader's. */
import { useI18n } from '~/composables/useI18n'

const { t } = useI18n()
</script>
