<template>
  <ArticleDetail
    :slug="slug"
    back-to="/reintegration-models"
    variant="reintegration"
    :back-label="t('a_back_reintegration')"
    meta-icon="💡"
    :seo-fallback-title="t('a_reintegration_seo_title')"
    :seo-fallback-description="t('a_reintegration_seo_desc')"
  />
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useI18n } from '~/composables/useI18n'

const { t } = useI18n()

const route = useRoute()
const slug = String(route.params.id || '')
</script>
