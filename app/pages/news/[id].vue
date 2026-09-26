<template>
  <ArticleDetail
    :slug="slug"
    back-to="/news"
    variant="news"
    :back-label="t('a_back_news')"
    meta-icon="📰"
    :type-labels="typeLabels"
    :seo-fallback-title="t('a_news_seo_title')"
    :seo-fallback-description="t('a_news_seo_desc')"
  />
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'

const { t } = useI18n()

// This route renders any article type, so the badge falls back to the type name.
const typeLabels = computed(() => ({
  news:          t('a_back_news'),
  role_model:    t('a_back_role'),
  reintegration: t('a_back_reintegration'),
  document:      t('a_category_doc'),
  faq:           t('a_category_faq'),
}))

const route = useRoute()
const slug = String(route.params.id || '')
</script>
