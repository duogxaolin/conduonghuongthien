<template>
  <div class="bg-white rounded-2xl border border-line shadow-sm p-5">
    <div class="flex items-center gap-2 pb-3 border-b border-surface-tint mb-3">
      <span class="w-7 h-7 rounded-lg bg-line text-brand-600 flex items-center justify-center text-xs shadow-sm">
        <i class="fa-solid fa-bookmark" aria-hidden="true"></i>
      </span>
      <h2 class="text-[0.92rem] font-black text-ink-strong uppercase tracking-wide m-0">
        {{ t('quick_tools') }}
      </h2>
    </div>
    <div class="flex flex-col gap-2 text-xs">
      <nuxt-link
        to="/documents"
        class="flex items-center justify-between p-2.5 rounded-xl bg-surface hover:bg-surface-tint text-[#2C3E29] font-bold no-underline transition-all border border-line"
      >
        <span class="flex items-center gap-2">
          <i class="fa-solid fa-scale-balanced text-brand-600" aria-hidden="true"></i>
          <span>{{ t('documents_title') }}</span>
        </span>
        <i class="fa-solid fa-arrow-right text-[0.65rem] text-[#8CA088]" aria-hidden="true"></i>
      </nuxt-link>
      <nuxt-link
        to="/legal-qa"
        class="flex items-center justify-between p-2.5 rounded-xl bg-surface hover:bg-surface-tint text-[#2C3E29] font-bold no-underline transition-all border border-line"
      >
        <span class="flex items-center gap-2">
          <i class="fa-solid fa-circle-question text-brand-600" aria-hidden="true"></i>
          <span>{{ t('legal_qa') }}</span>
        </span>
        <i class="fa-solid fa-arrow-right text-[0.65rem] text-[#8CA088]" aria-hidden="true"></i>
      </nuxt-link>
      <nuxt-link
        to="/role-models"
        class="flex items-center justify-between p-2.5 rounded-xl bg-surface hover:bg-surface-tint text-[#2C3E29] font-bold no-underline transition-all border border-line"
      >
        <span class="flex items-center gap-2">
          <i class="fa-solid fa-award text-brand-600" aria-hidden="true"></i>
          <span>{{ t('role_models') }}</span>
        </span>
        <i class="fa-solid fa-arrow-right text-[0.65rem] text-[#8CA088]" aria-hidden="true"></i>
      </nuxt-link>
      <nuxt-link
        to="/reintegration-models"
        class="flex items-center justify-between p-2.5 rounded-xl bg-surface hover:bg-surface-tint text-[#2C3E29] font-bold no-underline transition-all border border-line"
      >
        <span class="flex items-center gap-2">
          <i class="fa-solid fa-people-group text-brand-600" aria-hidden="true"></i>
          <span>{{ t('reintegration') }}</span>
        </span>
        <i class="fa-solid fa-arrow-right text-[0.65rem] text-[#8CA088]" aria-hidden="true"></i>
      </nuxt-link>
    </div>
  </div>
</template>

<script setup lang="ts">
/** `/news` rail: "Tra cứu nhanh" — four static links. */
import { useI18n } from '~/composables/useI18n'

const { t } = useI18n()
</script>
