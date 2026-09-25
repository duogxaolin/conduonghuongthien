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
      <slot name="title">{{ localizedTitle }}</slot>
    </div>
    <nuxt-link
      v-if="to"
      :to="to"
      class="text-sm font-medium transition-colors duration-200"
      :class="variant === 'light'
        ? 'text-[#4A6741] hover:text-[#385130]'
        : 'text-white/80 hover:text-white'"
    >
      {{ localizedViewall }}
    </nuxt-link>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'

const { t, currentLang } = useI18n()

const props = defineProps({
  title: { type: String, default: '' },
  icon: { type: String, default: '' },
  to: { type: String, default: '' },
  viewallText: { type: String, default: '' },
  variant: { type: String, default: '' }
})

const SECTION_TITLE_MAP: Record<string, string> = {
  'Chỉ đạo & Hoạt động': 'news_activities',
  'Tin nổi bật': 'news_featured',
  'Bản tin hoạt động': 'news_activities',
  'Tấm Gương Tiêu Biểu': 'role_models_title',
  'Tấm Gương Sáng Điển Hình': 'role_models_title',
  'Mô Hình Tái Hòa Nhập': 'reintegration_models_title',
  'Văn Bản Pháp Luật Mới Ban Hành': 'latest_docs_title',
  'Tin tức': 'news',
}

const localizedTitle = computed(() => {
  if (currentLang.value === 'vi') return props.title
  const key = SECTION_TITLE_MAP[props.title?.trim() || '']
  if (key) {
    const trans = t(key)
    if (trans && trans !== key) return trans
  }
  return t(props.title) || props.title
})

const localizedViewall = computed(() => {
  if (currentLang.value === 'vi') return props.viewallText || 'Xem tất cả →'
  return t('all_news_arrow') || t('view_all_arrow') || 'View all →'
})
</script>
