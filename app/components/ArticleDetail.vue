<template>
  <div class="py-10 bg-[#F8FAF7]">
    <div class="max-w-[800px] mx-auto px-4">
      <!-- Breadcrumb -->
      <nav class="text-[0.85rem] text-[#7A8675] mb-6" aria-label="Đường dẫn">
        <nuxt-link to="/" class="text-[#4A6741] no-underline hover:underline">Trang chủ</nuxt-link> &raquo;
        <nuxt-link :to="backTo" class="text-[#4A6741] no-underline hover:underline">{{ backLabel }}</nuxt-link> &raquo;
        <slot name="crumb" :category-label="categoryLabel" />
        <span>{{ currentCrumb }}</span>
      </nav>

      <!-- Loading -->
      <div v-if="pending" class="animate-pulse flex flex-col gap-5">
        <div class="h-5 w-40 bg-[#EEF2EC] rounded"></div>
        <div class="h-9 w-3/4 bg-[#EEF2EC] rounded"></div>
        <div class="h-24 w-full bg-[#EEF2EC] rounded"></div>
        <div class="h-64 w-full bg-[#EEF2EC] rounded-lg"></div>
      </div>

      <!-- Load failure — distinct from "not published", so the visitor knows to retry -->
      <div
        v-else-if="loadError"
        class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]"
      >
        <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
        Không thể tải nội dung. Vui lòng
        <button type="button" class="text-[#4A6741] font-bold underline" @click="refresh()">thử lại</button>.
      </div>

      <!-- Main content -->
      <article v-else-if="article">
        <span class="text-[0.85rem] font-bold text-[#4A6741] bg-[#F8FAF7] px-3 py-1.5 rounded inline-block mb-4">
          <span aria-hidden="true">{{ metaIcon }}</span> {{ categoryLabel }} • Ngày đăng: {{ formattedDate }}
        </span>
        <h1 class="text-[2.2rem] font-extrabold leading-[1.3] text-[#1E251C] mb-5">{{ article.title }}</h1>

        <div
          v-if="article.excerpt"
          class="text-[1.12rem] font-semibold text-[#4A5545] leading-[1.6] border-l-4 border-[#7CB342] pl-5 mb-8"
        >
          <p>{{ article.excerpt }}</p>
        </div>

        <div class="article-body text-[1.05rem] leading-[1.7] text-[#4A5545]">
          <div v-if="article.thumbnailUrl" class="my-8 text-center">
            <img
              :src="article.thumbnailUrl"
              :alt="article.title"
              class="w-full max-h-[450px] object-cover rounded-lg shadow-sm"
              loading="lazy"
              decoding="async"
            />
          </div>

          <!-- eslint-disable-next-line vue/no-v-html — sanitised server-side by sanitizeHtml() on write -->
          <div v-html="article.content"></div>
        </div>

        <!-- Back link -->
        <div class="mt-10 border-t border-[#E2E8DF] pt-8">
          <nuxt-link :to="backTo" class="btn btn-primary">&larr; {{ backCtaLabel }}</nuxt-link>
        </div>
      </article>

      <!-- Not found -->
      <div v-else class="py-10 text-center">
        <p class="text-[#4A5545] mb-4">{{ notFoundText }}</p>
        <nuxt-link :to="backTo" class="btn btn-primary">{{ backCtaLabel }}</nuxt-link>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * Shared article detail view.
 *
 * /news/[id], /news/[category]/[slug], /role-models/[id] and
 * /reintegration-models/[id] were four copies of the same 85–123 line page.
 * They had already drifted (rounded-md vs rounded-lg, 1.15rem vs 1.12rem
 * excerpts, leading-[1.6] vs leading-relaxed) and each carried a private
 * local-time date formatter that can render a different day on the server than
 * in the browser. Everything lives here now, on the UTC-safe formatDateVN.
 *
 * The category breadcrumb that only /news/[category]/[slug] needs is supplied
 * through the `crumb` slot, which receives the resolved category label so the
 * crumb and the badge can never disagree.
 */
import { computed } from 'vue'
import { formatDateVN } from '~/utils/formatDate'

const props = defineProps({
  /** Article slug (or id) to fetch. */
  slug: { type: String, required: true },
  /** Listing route used by the breadcrumb and both back links. */
  backTo: { type: String, required: true },
  /** Breadcrumb label for the listing. */
  backLabel: { type: String, required: true },
  /** Call-to-action label on the back links. */
  backCtaLabel: { type: String, default: 'Quay lại danh sách' },
  /** Final, non-linked breadcrumb. */
  currentCrumb: { type: String, default: 'Chi tiết' },
  /** Decorative glyph in front of the category badge. */
  metaIcon: { type: String, default: '📰' },
  /** Category shown when the article carries no category of its own. */
  categoryFallback: { type: String, default: 'Thông tin' },
  /** Optional article-type → label map, consulted before categoryFallback. */
  typeLabels: { type: Object, default: () => ({}) },
  notFoundText: { type: String, default: 'Không tìm thấy bài viết yêu cầu hoặc bài viết đang được cập nhật.' },
  seoFallbackTitle: { type: String, required: true },
  seoFallbackDescription: { type: String, required: true },
})

const { data, pending, error, refresh } = await useFetch(() => `/api/public/articles/${props.slug}`, {
  key: () => `article-detail-${props.slug}`,
  default: () => ({ ok: false, article: null }),
})

const article = computed(() => data.value?.article || null)
// `ok: false` with no article is a legitimate 404 from the API, not a failure.
const loadError = computed(() => !!error.value)

const categoryLabel = computed(() => {
  const a = article.value
  if (!a) return ''
  return a.categoryName || props.typeLabels[a.type] || props.categoryFallback
})

const formattedDate = computed(() => formatDateVN(article.value?.publishedAt || article.value?.createdAt))

useSeoMeta({
  title: computed(() => (article.value ? `${article.value.title} | Con Đường Hướng Thiện` : props.seoFallbackTitle)),
  description: computed(() => article.value?.excerpt || props.seoFallbackDescription),
})
</script>

<style scoped>
/* Retained for v-html deep content — not expressible with Tailwind utility classes */
.article-body :deep(p) { font-size: 1.05rem; line-height: 1.7; color: #4A5545; margin-bottom: 20px; }
.article-body :deep(blockquote) { background-color: #F8FAF7; border-left: 4px solid #4A6741; padding: 20px 24px; margin: 30px 0; font-style: italic; font-size: 1.1rem; color: #385130; }
.article-body :deep(blockquote span) { display: block; font-size: 0.85rem; color: #7A8675; margin-top: 8px; font-weight: 700; font-style: normal; }
</style>
