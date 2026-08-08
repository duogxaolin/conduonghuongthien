<template>
  <div
    class="flex items-center justify-between px-4 py-2.5 border-l-4 border-[#4A6741] mb-4"
    :class="variant === 'light'
      ? 'bg-white border-b border-[#E2E8DF]'
      : 'bg-[#4A6741]'"
  >
    <div
      class="flex items-center gap-2 font-semibold text-base uppercase tracking-wide"
      :class="variant === 'light' ? 'text-[#4A6741]' : 'text-white'"
    >
      <i v-if="icon && icon.includes('fa-')" :class="[icon]" aria-hidden="true"></i>
      <span v-else-if="icon" aria-hidden="true">{{ icon }}</span>
      <slot name="title">{{ title }}</slot>
    </div>
    <nuxt-link
      v-if="to"
      :to="to"
      class="text-sm font-medium transition-colors duration-200"
      :class="variant === 'light'
        ? 'text-[#4A6741] hover:text-[#385130]'
        : 'text-white/80 hover:text-white'"
    >
      {{ viewallText || 'Xem tất cả →' }}
    </nuxt-link>
  </div>
</template>

<script setup lang="ts">
defineProps({
  title: { type: String, default: '' },
  icon: { type: String, default: '' },
  to: { type: String, default: '' },
  viewallText: { type: String, default: '' },
  variant: { type: String, default: '' }
})
</script>
