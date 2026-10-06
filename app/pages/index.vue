<template>
  <div>
    <!-- h1 sr-only cho trang chủ khi render Page blocks — block mở bằng <h2>
         (SectionBar/section header), nên cần <h1> cha để trình tự tiêu đề hợp
         lệ. Visually hidden, chỉ trình đọc màn hình + SEO nhìn thấy. -->
    <h1 v-if="blocks.length" class="sr-only">{{ page?.seoTitle || t('home_seo_title') }}</h1>
    <PageRenderer
      v-if="pending || loadError || blocks.length"
      :blocks="blocks"
      :interactive="isPreview"
      :selected-id="selectedId"
      :pending="pending"
      :load-error="loadError"
      :on-retry="refresh"
    />

    <!-- Graceful fallback if the page has no blocks. -->
    <section v-else class="section bg-white">
      <div class="container text-center py-20">
        <h1 class="text-[1.8rem] font-extrabold text-[#1E251C] mb-3">{{ t('home_fallback_title') }}</h1>
        <p class="text-[#4A5545]">{{ t('home_fallback_desc') }}</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'

const { currentLang, t } = useI18n()

// `lazy` chỉ bỏ chặn điều hướng phía client — lượt dựng phía máy chủ vẫn chờ dữ
// liệu, nên HTML đầu tiên và thẻ SEO không đổi (design.md D2). Không có nó thì
// bấm một liên kết về trang chủ giữ nguyên trang cũ trên màn hình cho tới khi
// dữ liệu về, trông y hệt bấm hụt.
const { data, pending, error, refresh } = useAsyncData(
  `page-home-${currentLang.value}`,
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; page: { title?: string; slug?: string; seoTitle?: string | null; seoDescription?: string | null } | null; blocks: import('~/utils/blocks/types').RenderableNode[] }>)(`/api/public/pages/home?lang=${currentLang.value}`),
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

// SEO: prefer page meta, fall back to the original homepage defaults.
useSeoMeta({
  title: () => page.value?.seoTitle || t('home_seo_title'),
  description: () => page.value?.seoDescription || t('home_seo_desc'),
  ogTitle: () => page.value?.seoTitle || t('home_og_title'),
  ogDescription: () => page.value?.seoDescription || t('home_og_desc'),
  ogType: 'website',
})
</script>
