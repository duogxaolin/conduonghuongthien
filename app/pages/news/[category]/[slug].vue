<template>
  <ArticleDetail
    :slug="slug"
    back-to="/news"
    variant="news"
    :back-label="t('a_back_news')"
    meta-icon="📰"
    :category-fallback="humanizedCategory"
    :seo-fallback-title="t('a_news_seo_title')"
    :seo-fallback-description="t('a_news_seo_desc')"
  >
    <template #crumb="{ categoryLabel }">
      <nuxt-link :to="`/news?cat=${categorySlug}`" class="text-[#4A6741] no-underline hover:underline">{{ categoryLabel }}</nuxt-link> &raquo;
    </template>
  </ArticleDetail>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '~/composables/useI18n'

const { t } = useI18n()

const route = useRoute()
const categorySlug = computed(() => String(route.params.category || ''))
const slug = String(route.params.slug || '')

// Used only until the article's own category name arrives.
const humanizedCategory = computed(
  () =>
    categorySlug.value
      .split('-')
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ') || t('a_back_news'),
)
</script>
