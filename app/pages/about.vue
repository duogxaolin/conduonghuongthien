<template>
  <div class="bg-surface">
    <!-- Một trang đúng một <h1> (D22): khối "heading" mở bằng <h2>, nên khi không
         khối nào tự có <h1> (hero) thì trang đặt một <h1> cho trình đọc màn hình. -->
    <h1 v-if="blocks.length && !pageHasOwnH1" class="sr-only">{{ t('about_fallback_title') }}</h1>
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
        <h1 class="text-[1.8rem] font-extrabold text-ink mb-3">{{ t('about_fallback_title') }}</h1>
        <p class="text-ink-secondary">{{ t('about_fallback_desc') }}</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useSsrFailureStatus } from '~/composables/useSsrFailureStatus'
import { blocksRenderOwnH1 } from '~/utils/blocks/page-heading'
import { publicFetch } from '~/composables/publicFetch'
import type { PublicPageResponse } from '~/types/public-content-api'

const { currentLang, t } = useI18n()

// `lazy`: bỏ chặn điều hướng phía client, lượt dựng phía máy chủ vẫn chờ dữ
// liệu nên HTML đầu tiên và thẻ SEO không đổi (design.md D2).
const aboutAsync = useAsyncData(
  `page-about-${currentLang.value}`,
  () => publicFetch<PublicPageResponse>(`/api/public/pages/about?lang=${currentLang.value}`),
  { lazy: true, default: () => ({ ok: false, page: null, blocks: [] }) }
)
const { data, pending, error, refresh } = aboutAsync

// Lượt SSR hỏng → 503 + no-store: không để bộ đệm SWR/CDN phát lại trang lỗi.
// Cùng biểu thức với nhánh lỗi (`loadError` bên dưới).
useSsrFailureStatus(() => aboutAsync, () => !!error.value)

watch(currentLang, () => {
  void refresh()
})

// `error.value` lúc mount = lượt SSR hỏng (CSDL chập chờn) và HTML mang nhánh
// lỗi đó có thể vừa ra từ bộ đệm SWR 60 giây — tải lại một lần ở trình duyệt
// để khách không phải chờ hết cửa sổ đệm mới thấy nội dung.
onMounted(() => {
  if (currentLang.value !== 'vi' || error.value) {
    void refresh()
  }
})

const loadError = computed(() => error.value || null)
const page = computed(() => data.value?.page || null)

// Builder preview: when embedded in the editor iframe, live-edited blocks
// pushed via postMessage override the fetched ones (see usePagePreview).
const { isPreview, previewBlocks, selectedId } = usePagePreview()
const blocks = computed(() => previewBlocks.value ?? data.value?.blocks ?? [])
const pageHasOwnH1 = computed(() => blocksRenderOwnH1(blocks.value))

useSeoMeta({
  title: () => page.value?.seoTitle || t('about_seo_title'),
  description: () => page.value?.seoDescription || t('about_seo_desc'),
})
</script>
