<template>
  <NewsCategoryList
    :heading="t('n_featured_heading')"
    :subheading="t('n_featured_sub')"
    category-slug="tin-noi-bat"
    :category-label="t('n_featured_label')"
    :empty-text="t('n_featured_empty')"
  />
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'

const { t } = useI18n()

useSeoMeta({
  title: () => `${t('n_featured_heading')} | Con Đường Hướng Thiện`,
  description: () => t('n_featured_sub'),
})
</script>
