<template>
  <ArticleDetail
    :slug="slug"
    :back-to="`/${typeSlug}`"
    :back-label="typeName"
    :meta-icon="metaIcon"
    :type-labels="typeLabels"
    :seo-fallback-title="seoTitle"
    :seo-fallback-description="seoDescription"
  />
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { computed } from 'vue'

/**
 * Route detail bài viết cho Content-Type custom (type tạo qua
 * /admin/content/content-types, không có route tĩnh riêng như /news hay
 * /role-models).
 *
 * `ArticleDetail` fetch bài theo `:slug` qua `/api/public/articles/<slug>` — không
 * cần type. `backTo` xây link related + breadcrumb về trang list `/<type-slug>`.
 * `variant` mặc định `news` chỉ để chọn fallback i18n key; `typeLabels` prop
 * đè lại nhãn theo tên content-type thực.
 */

const route = useRoute()
const slug = String(route.params.id || '')
const typeSlug = String(route.params.slug || '')

// Fetch content-types để lấy name/icon/description của type (cho breadcrumb + SEO).
const { data: typeData } = await useAsyncData(
  `content-type-for-detail-${typeSlug}`,
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: Array<{ slug: string; name: string; icon: string | null; description: string | null }> }>)(`/api/public/content-types`),
  {
    lazy: true,
    default: () => ({ ok: false, items: [] }),
  },
)

const currentType = computed(() =>
  (typeData.value?.items || []).find((ct) => ct.slug === typeSlug) || null,
)

const typeName = computed(() => currentType.value?.name || typeSlug)
const metaIcon = computed(() => currentType.value?.icon || 'fa-solid fa-folder')
const seoTitle = computed(() => `${typeName.value} | Con Đường Hướng Thiện`)
const seoDescription = computed(() => currentType.value?.description || `Con Đường Hướng Thiện - Cục C11 Bộ Công an.`)

// Map type → label cho badge category trong ArticleDetail. Chỉ có 1 entry (type
// hiện tại) — các type khác fallback về categoryFallback.
const typeLabels = computed(() => ({
  [typeSlug]: typeName.value,
}))
</script>
