<template>
  <div>
    <!-- h1 sr-only cho trang chủ khi render Page blocks — block mở bằng <h2>
         (SectionBar/section header), nên cần <h1> cha để trình tự tiêu đề hợp
         lệ. Visually hidden, chỉ trình đọc màn hình + SEO nhìn thấy. Chỉ khi
         không block nào tự có <h1> (hero) — một trang đúng một <h1> (D22). -->
    <h1 v-if="blocks.length && !pageHasOwnH1" class="sr-only">{{ page?.seoTitle || t('home_seo_title') }}</h1>
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
        <h1 class="text-[1.8rem] font-extrabold text-ink mb-3">{{ t('home_fallback_title') }}</h1>
        <p class="text-ink-secondary">{{ t('home_fallback_desc') }}</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useSsrFailureStatus } from '~/composables/useSsrFailureStatus'
import { blocksRenderOwnH1 } from '~/utils/blocks/page-heading'

const { currentLang, t } = useI18n()

// `lazy` chỉ bỏ chặn điều hướng phía client — lượt dựng phía máy chủ vẫn chờ dữ
// liệu, nên HTML đầu tiên và thẻ SEO không đổi (design.md D2). Không có nó thì
// bấm một liên kết về trang chủ giữ nguyên trang cũ trên màn hình cho tới khi
// dữ liệu về, trông y hệt bấm hụt.
const homeAsync = useAsyncData(
  `page-home-${currentLang.value}`,
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; page: { title?: string; slug?: string; seoTitle?: string | null; seoDescription?: string | null } | null; blocks: import('~/utils/blocks/types').RenderableNode[] }>)(`/api/public/pages/home?lang=${currentLang.value}`),
  { lazy: true, default: () => ({ ok: false, page: null, blocks: [] }) }
)
const { data, pending, error, refresh } = homeAsync

// Lượt SSR hỏng → 503 + no-store: không để bộ đệm SWR/CDN phát lại trang lỗi.
// Cùng biểu thức với nhánh lỗi (`loadError` bên dưới).
useSsrFailureStatus(() => homeAsync, () => !!error.value)

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

// SEO: prefer page meta, fall back to the original homepage defaults.
useSeoMeta({
  title: () => page.value?.seoTitle || t('home_seo_title'),
  description: () => page.value?.seoDescription || t('home_seo_desc'),
  ogTitle: () => page.value?.seoTitle || t('home_og_title'),
  ogDescription: () => page.value?.seoDescription || t('home_og_desc'),
  ogType: 'website',
})
</script>
