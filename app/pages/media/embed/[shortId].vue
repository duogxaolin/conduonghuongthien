<!--
  Khung phát nhúng của một video — chỉ trình phát, không điều hướng, không chân trang.

  Bài viết nhúng nó bằng `<iframe src="/media/embed/<short_id>">` (trình soạn bài: nút "Video từ kho").
  Bộ lọc HTML (`server/utils/sanitize-html.ts`) chỉ cho đúng dạng đường dẫn này làm `src` cùng gốc;
  `X-Frame-Options: SAMEORIGIN` + `frame-ancestors 'self'` chỉ cho chính cổng này khung nó (nội dung
  của trang này không bao giờ nhúng được vào trang của bên khác).

  Cùng ràng buộc với trang chi tiết (`/media/[shortId].vue`): tuyến `/media/**` chạy `swr: 60`, nên
  chỉ đọc nội dung CÔNG KHAI (`/api/public/media/<short_id>` — chỉ mục đã đăng, nháp/lưu trữ/không có
  đều là cùng một 404), không có gì phụ thuộc người đọc, không đếm lượt xem ở đây (trang chi tiết đếm).
  Không đánh chỉ mục: nội dung chính của nó là trang chi tiết.
-->
<template>
  <main class="flex min-h-screen w-full items-center justify-center bg-black text-white">
    <h1 class="sr-only">{{ item?.title || t('m_video_library') }}</h1>

    <div v-if="pending" role="status" aria-busy="true" class="p-6 text-sm">
      <span class="sr-only">{{ t('m_detail_loading') }}</span>
      <i class="fa-solid fa-spinner animate-spin motion-reduce:animate-none text-2xl" aria-hidden="true"></i>
    </div>

    <div v-else-if="loadError" role="alert" class="max-w-md p-6 text-center">
      <p class="m-0 mb-3 text-sm">{{ t('m_detail_error_desc') }}</p>
      <button
        type="button"
        class="cursor-pointer rounded-lg border-none bg-white px-5 py-2 text-xs font-extrabold text-brand-800"
        @click="reload"
      >
        {{ t('m_retry') }}
      </button>
    </div>

    <p v-else-if="!item" class="m-0 max-w-md p-6 text-center text-sm">{{ t('m_not_found_desc') }}</p>

    <div v-else class="w-full max-w-[1280px]">
      <MediaPlayer :item="item" />
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '~/composables/useI18n'
import { publicFetch } from '~/composables/publicFetch'
import type { MediaDetailPayload, PublicMediaItem } from '~/types/public-api'

definePageMeta({ layout: false })

const { t } = useI18n()
const route = useRoute()
const shortId = computed(() => String(route.params.shortId || ''))

const { data, pending, error, refresh } = useAsyncData(
  () => `media-embed-${shortId.value}`,
  () => publicFetch<MediaDetailPayload>(`/api/public/media/${encodeURIComponent(shortId.value)}`),
  { default: () => ({ ok: false, item: null }) },
)

const item = computed<PublicMediaItem | null>(() => data.value?.item ?? null)
// A 404 is an answer (an unknown, unpublished or archived id), not a failed load: no "retry" for an id that
// will not exist next time.
const loadError = computed(() => !!error.value && (error.value as { statusCode?: number }).statusCode !== 404)
const reload = () => { void refresh() }

useHead(() => ({
  title: item.value?.title ?? t('m_video_library'),
  meta: [{ name: 'robots', content: 'noindex' }],
}))
</script>
