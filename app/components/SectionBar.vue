<template>
  <div class="section-bar" :class="{ 'section-bar-light': variant === 'light' }">
    <div class="section-bar-title">
      <i v-if="icon && icon.includes('fa-')" :class="[icon, 'section-bar-icon']" aria-hidden="true"></i>
      <span v-else-if="icon" class="section-bar-icon" aria-hidden="true">{{ icon }}</span>
      <slot name="title">{{ title }}</slot>
    </div>
    <nuxt-link
      v-if="to"
      :to="to"
      class="section-bar-viewall"
    >
      {{ viewallText || 'Xem tất cả →' }}
    </nuxt-link>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, default: '' },
  icon: { type: String, default: '' },
  to: { type: String, default: '' },
  viewallText: { type: String, default: '' },
  variant: { type: String, default: '' }
})
</script>
