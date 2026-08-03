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
      <div v-if="pending" class="animate-pulse motion-reduce:animate-none flex flex-col gap-5">
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
        <span class="text-[0.85rem] font-bold text-[#4A6741] bg-[#F8FAF7] px-3 py-1.5 rounded inline-flex flex-wrap items-center gap-x-2 mb-4">
          <span><span aria-hidden="true">{{ metaIcon }}</span> {{ categoryLabel }}</span>
          <span aria-hidden="true">•</span>
          <span><i class="fa-regular fa-calendar" aria-hidden="true"></i> Ngày đăng: {{ formattedDate }}</span>
          <span aria-hidden="true">•</span>
          <span><i class="fa-regular fa-user" aria-hidden="true"></i> {{ authorDisplay }}</span>
          <span aria-hidden="true">•</span>
          <span><i class="fa-regular fa-eye" aria-hidden="true"></i> {{ formattedViews }} lượt xem</span>
        </span>
        <h1 class="text-[2.2rem] font-extrabold leading-[1.3] text-[#1E251C] mb-5">{{ article.title }}</h1>

        <div
          v-if="article.excerpt"
          class="text-[1.12rem] font-semibold text-[#4A5545] leading-[1.6] border-l-4 border-[#7CB342] pl-5 mb-8"
        >
          <p>{{ article.excerpt }}</p>
        </div>

        <div v-if="article.thumbnailUrl" class="my-8 text-center">
          <img
            :src="article.thumbnailUrl"
            :alt="article.title"
            class="w-full max-h-[450px] object-cover rounded-lg shadow-sm"
            loading="lazy"
            decoding="async"
          />
        </div>

        <!--
          Mục lục tự động: chỉ hiện khi bài đủ dài để cần điều hướng.

          Deliberately a sibling of .article-body, not a child: the heading rules
          below are `.article-body :deep(h2)`, which would also claim this card's
          own <h2> and beat its utility classes on specificity.
        -->
        <nav
          v-if="toc.headings.length >= TOC_MIN_HEADINGS"
          class="my-8 rounded-lg border border-[#E2E8DF] bg-white px-6 py-5 shadow-sm"
          aria-labelledby="muc-luc-heading"
        >
          <div class="flex items-center justify-between gap-3">
            <h2 id="muc-luc-heading" class="m-0 text-[0.95rem] font-extrabold uppercase tracking-wide text-[#385130]">
              <i class="fa-solid fa-list-ul mr-2 text-[#7CB342]" aria-hidden="true"></i>Mục lục
            </h2>
            <button
              type="button"
              class="rounded px-2 py-1 text-[0.8rem] font-bold text-[#4A6741] transition hover:bg-[#F8FAF7] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]"
              :aria-expanded="tocOpen"
              aria-controls="muc-luc-list"
              @click="tocOpen = !tocOpen"
            >
              {{ tocOpen ? 'Thu gọn' : 'Mở rộng' }}
              <i :class="tocOpen ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'" class="ml-1" aria-hidden="true"></i>
            </button>
          </div>
          <ol v-show="tocOpen" id="muc-luc-list" class="mt-4 mb-0 list-none space-y-1.5 pl-0">
            <li
              v-for="heading in toc.headings"
              :key="heading.id"
              :style="{ paddingLeft: `${(heading.level - 2) * 16}px` }"
            >
              <a
                :href="`#${heading.id}`"
                class="text-[0.95rem] font-semibold text-[#4A6741] no-underline transition hover:text-[#385130] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]"
                :class="heading.level > 2 ? 'font-medium text-[0.9rem] text-[#5C6B55]' : ''"
              >{{ heading.text }}</a>
            </li>
          </ol>
        </nav>

        <div class="article-body text-[1.05rem] leading-[1.7] text-[#4A5545]">
          <!-- eslint-disable-next-line vue/no-v-html — sanitised server-side by sanitizeHtml() on write; buildToc only adds anchor ids -->
          <div v-html="toc.html"></div>
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
import { computed, onMounted, ref, watch } from 'vue'
import { formatDateVN } from '~/utils/formatDate'
import { classifySource } from '~/utils/analytics-collector'
import { buildToc, TOC_MIN_HEADINGS } from '~/utils/toc'

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

// `lazy` chỉ bỏ chặn điều hướng phía client — lượt dựng phía máy chủ vẫn chờ dữ
// liệu, nên HTML đầu tiên, thẻ SEO và mục lục không đổi. Đi từ danh sách sang
// chi tiết là lúc thấy rõ nhất: không có nó thì bấm vào một bài trông như bấm
// hụt cho tới khi bài về.
const { data, pending, error, refresh } = useFetch(() => `/api/public/articles/${props.slug}`, {
  key: () => `article-detail-${props.slug}`,
  lazy: true,
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

// Bài viết cũ có thể không còn tác giả (`author_id` nullable, tài khoản đã xoá).
// "Ban biên tập" là chủ thể phát ngôn thật của cổng trong trường hợp đó.
const authorDisplay = computed(() => article.value?.authorName || 'Ban biên tập')
const formattedViews = computed(() => Number(article.value?.viewTotal || 0).toLocaleString('vi-VN'))

/**
 * Outline + anchored body in one pass, so a list entry and its heading can never
 * point at different ids. Recomputed with the article, which also covers the
 * client-side navigation between two detail pages.
 */
const toc = computed(() => buildToc(article.value?.content))
const tocOpen = ref(true)

useSeoMeta({
  title: computed(() => (article.value ? `${article.value.title} | Con Đường Hướng Thiện` : props.seoFallbackTitle)),
  description: computed(() => article.value?.excerpt || props.seoFallbackDescription),
})

/**
 * Ghi nhận lượt xem từ trình duyệt, không phải từ lượt dựng phía máy chủ.
 *
 * Trang chi tiết bài viết được phục vụ từ bộ nhớ đệm SWR 60 giây
 * (`nuxt.config.ts`), nên người đọc thứ hai trở đi trong một cửa sổ 60 giây
 * không chạm vào mã máy chủ nào cả. Đếm ở phía máy chủ sẽ thiếu đúng bằng phần
 * mà bộ nhớ đệm đang phát huy tác dụng — và con số thiếu đó trông vẫn hợp lý.
 *
 * Mọi lỗi đều nuốt: một bộ đếm lượt xem không có tư cách làm hỏng trang của
 * khách. Việc chống bấm F5 liên tục do máy chủ lo (cửa sổ 30 phút), không phải
 * do phía client — client-side thì xoá cache trình duyệt là thoát.
 */
const sentSlug = ref('')

function pingView(slug) {
  if (!slug || sentSlug.value === slug) return
  sentSlug.value = slug
  $fetch(`/api/public/articles/${encodeURIComponent(slug)}/view`, {
    method: 'POST',
    body: { sourceCategory: classifySource(document.referrer, window.location.hostname) },
    keepalive: true,
    retry: 0,
    timeout: 1500,
  }).catch(() => {})
}

onMounted(() => pingView(props.slug))
// Điều hướng phía client giữa hai bài viết dùng lại chính component này, nên
// `onMounted` chỉ chạy một lần cho cả chuỗi bài đọc liên tiếp.
watch(() => props.slug, slug => pingView(slug))
</script>

<style scoped>
/* Retained for v-html deep content — not expressible with Tailwind utility classes */

/* Anchor landing offset. The public header becomes `fixed` once the visitor
   scrolls (see layouts/default.vue), so a bare #fragment jump puts the target
   heading underneath it — the reader clicks a table-of-contents entry and lands
   on the paragraph above the one they asked for. 130px clears the desktop
   header, which is the taller of the two. */
.article-body :deep(h2),
.article-body :deep(h3),
.article-body :deep(h4) { scroll-margin-top: 130px; }

/* Article bodies had no heading rules at all, so an h2 written in the editor
   rendered at the browser default inside otherwise styled prose. The outline
   only exists once authors write headings, so they need to look deliberate.
   Sizes match the richtext block (components/blocks/RichTextBlock.vue) — the
   two render the same admin-authored HTML and should not disagree. */
.article-body :deep(h2) { font-size: 1.5rem; font-weight: 800; color: #1E251C; margin: 2rem 0 0.8rem; }
.article-body :deep(h3) { font-size: 1.2rem; font-weight: 800; color: #1E251C; margin: 1.6rem 0 0.6rem; }
.article-body :deep(h4) { font-size: 1.05rem; font-weight: 700; color: #2b352a; margin: 1.3rem 0 0.5rem; }

.article-body :deep(p) { font-size: 1.05rem; line-height: 1.7; color: #4A5545; margin-bottom: 20px; }
.article-body :deep(blockquote) { background-color: #F8FAF7; border-left: 4px solid #4A6741; padding: 20px 24px; margin: 30px 0; font-style: italic; font-size: 1.1rem; color: #385130; }
.article-body :deep(blockquote span) { display: block; font-size: 0.85rem; color: #7A8675; margin-top: 8px; font-weight: 700; font-style: normal; }
</style>
