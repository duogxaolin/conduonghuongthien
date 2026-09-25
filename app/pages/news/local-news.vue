<template>
  <NewsCategoryList
    :heading="t('n_local_heading')"
    :subheading="t('n_local_sub')"
    category-slug="tin-dia-phuong"
    :category-label="t('n_local_label')"
    :empty-text="t('n_local_empty')"
  />
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'

const { t } = useI18n()

useSeoMeta({
  title: () => `${t('n_local_heading')} | Con Đường Hướng Thiện`,
  description: () => t('n_local_sub'),
})
</script>
