<template>
  <ArticleDetail
    :slug="slug"
    back-to="/news"
    back-label="Bản tin"
    back-cta-label="Quay lại Bản tin"
    meta-icon="📰"
    :category-fallback="humanizedCategory"
    not-found-text="Không tìm thấy bài viết yêu cầu."
    seo-fallback-title="Chi tiết | Con Đường Hướng Thiện"
    seo-fallback-description="Tin tức hỗ trợ hoàn lương, tái hòa nhập cộng đồng."
  >
    <template #crumb="{ categoryLabel }">
      <nuxt-link :to="`/news?cat=${categorySlug}`" class="text-[#4A6741] no-underline hover:underline">{{ categoryLabel }}</nuxt-link> &raquo;
    </template>
  </ArticleDetail>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

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
      .join(' ') || 'Bản tin',
)
</script>
