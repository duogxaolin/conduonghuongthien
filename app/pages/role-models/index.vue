<template>
  <ModelArticlesListPage variant="role_model" />
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'

// Bố cục, danh sách, phân trang và tìm kiếm dùng chung với /reintegration-models
// (`app/components/ModelArticlesListPage.vue`); SEO của trang này giữ ở đây.
const { t } = useI18n()

useSeoMeta({
  title: () => `${t('rm_title')} | Con Đường Hướng Thiện`,
  description: () => t('rm_desc'),
})
</script>
