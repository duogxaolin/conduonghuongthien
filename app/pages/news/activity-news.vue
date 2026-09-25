<template>
  <NewsCategoryList
    :heading="t('n_activity_heading')"
    :subheading="t('n_activity_sub')"
    category-slug="tin-hoat-dong"
    :category-label="t('n_activity_label')"
    :empty-text="t('n_activity_empty')"
  />
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'

const { t } = useI18n()

useSeoMeta({
  title: () => `${t('n_activity_heading')} | Con Đường Hướng Thiện`,
  description: () => t('n_activity_sub'),
})
</script>
