<template>
  <div class="bg-[#F8FAF7]">
    <PageRenderer
      v-if="pending || loadError || blocks.length"
      :blocks="blocks"
      :interactive="isPreview"
      :selected-id="selectedId"
      :pending="pending"
      :load-error="loadError"
      :on-retry="refresh"
    />

    <!-- Fallback if the page has no blocks yet. -->
    <section v-else class="section">
      <div class="container text-center py-20">
        <h1 class="text-[1.8rem] font-extrabold text-[#1E251C] mb-3">{{ t('about_fallback_title') }}</h1>
        <p class="text-[#4A5545]">{{ t('about_fallback_desc') }}</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'

const { currentLang, t } = useI18n()

// `lazy`: bỏ chặn điều hướng phía client, lượt dựng phía máy chủ vẫn chờ dữ
// liệu nên HTML đầu tiên và thẻ SEO không đổi (design.md D2).
const { data, pending, error, refresh } = useAsyncData(
  `page-about-${currentLang.value}`,
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; page: { title?: string; slug?: string; seoTitle?: string | null; seoDescription?: string | null } | null; blocks: import('~/utils/blocks/types').RenderableNode[] }>)(`/api/public/pages/about?lang=${currentLang.value}`),
  { lazy: true, default: () => ({ ok: false, page: null, blocks: [] }) }
)

watch(currentLang, () => {
  void refresh()
})

onMounted(() => {
  if (currentLang.value !== 'vi') {
    void refresh()
  }
})

const loadError = computed(() => error.value || null)
const page = computed(() => data.value?.page || null)

// Builder preview: when embedded in the editor iframe, live-edited blocks
// pushed via postMessage override the fetched ones (see usePagePreview).
const { isPreview, previewBlocks, selectedId } = usePagePreview()
const blocks = computed(() => previewBlocks.value ?? data.value?.blocks ?? [])

useSeoMeta({
  title: () => page.value?.seoTitle || 'Giới thiệu | Con Đường Hướng Thiện',
  description: () => page.value?.seoDescription || 'Giới thiệu Ban Biên tập Cổng thông tin Con Đường Hướng Thiện - Cục C11 Bộ Công an.',
})
</script>
