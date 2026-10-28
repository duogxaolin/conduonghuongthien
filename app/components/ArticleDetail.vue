<template>
  <div class="py-10 bg-surface">
    <!--
      Container rộng 1200px thay vì 800px, vì từ khi có khối liên quan thì trang
      này không còn là một cột chữ nữa. Cột đọc vẫn giữ đúng bề rộng cũ (~800px)
      — nới nó ra theo container là đổi một khoảng trắng hai bên thành một dòng
      chữ quá dài, mà dòng quá dài thì mắt mất chỗ khi xuống hàng.
    -->
    <div class="max-w-[1200px] mx-auto px-4">
      <!-- Breadcrumb -->
      <nav class="text-[0.85rem] text-ink-soft mb-6" :aria-label="t('a_breadcrumb_aria')">
        <nuxt-link to="/" class="text-brand-600 no-underline hover:underline">{{ t('a_home') }}</nuxt-link> &raquo;
        <nuxt-link :to="backTo" class="text-brand-600 no-underline hover:underline">{{ backLabelText }}</nuxt-link> &raquo;
        <slot name="crumb" :category-label="categoryLabel" />
        <span>{{ currentCrumbText }}</span>
      </nav>

      <!-- Loading. Giới hạn theo bề rộng cột đọc, không theo container: một khung
           chờ trải hết 1200px hứa một bố cục rộng rồi trả về một cột hẹp. -->
      <div v-if="pending" role="status" aria-busy="true" class="lg:max-w-[820px] animate-pulse motion-reduce:animate-none flex flex-col gap-5">
        <span class="sr-only">Đang tải nội dung bài viết</span>
        <div aria-hidden="true" class="h-5 w-40 bg-surface-tint rounded"></div>
        <div aria-hidden="true" class="h-9 w-3/4 bg-surface-tint rounded"></div>
        <div aria-hidden="true" class="h-24 w-full bg-surface-tint rounded"></div>
        <div aria-hidden="true" class="h-64 w-full bg-surface-tint rounded-lg"></div>
      </div>

      <!-- Load failure — distinct from "not published", so the visitor knows to retry -->
      <div
        v-else-if="loadError"
        role="alert"
        class="lg:max-w-[820px] bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-danger-soft text-[0.95rem]"
      >
        <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
        Không thể tải nội dung. Vui lòng
        <button type="button" class="text-brand-600 font-bold underline" @click="refresh()">thử lại</button>.
      </div>

      <!-- Main content -->
      <!--
        Bố cục hai cột trên PC: cột đọc bên trái, khối liên quan thành cột phải.

        Trước đây khối liên quan là một dải ngang dưới đáy bài, nên trên màn hình
        rộng phần "đọc gì tiếp" nằm dưới đúng cái màn hình vừa cuộn hết — người
        đọc phải cuộn thêm để thấy nó, còn hai bên cột chữ là khoảng trắng không
        làm gì. Đưa nó sang phải giải quyết cả hai bằng một thay đổi.

        `items-start` là điều kiện tiên quyết, không phải tinh chỉnh: mặc định
        `stretch` sẽ kéo cột phải cao bằng bài viết, và `sticky` bên trong một ô
        lưới cao bằng cả bài thì không bao giờ dính — nó chỉ dính khi ô của nó
        thấp hơn vùng cuộn.
      -->
      <article v-else-if="article" class="lg:grid lg:grid-cols-[minmax(0,820px)_320px] lg:items-start lg:gap-10">
        <!-- Cột đọc. `min-w-0` để một khối `v-html` rộng (bảng, ảnh, code) co lại
             theo cột thay vì nong cột ra và đẩy cột phải tràn khỏi container. -->
        <div class="min-w-0">
        <ArticleMetaHeader :article="article" :category-label="categoryLabel" :meta-icon="metaIcon" />

        <!-- Mục lục tự động: chỉ hiện khi bài đủ dài để cần điều hướng. Đứng cạnh thân
             bài, không nằm trong nó: luật tiêu đề `.article-body :deep(h2)` của ArticleBody
             sẽ giành cả <h2> của khung này và thắng class utility của nó. -->
        <ArticleToc v-if="toc.headings.length >= TOC_MIN_HEADINGS" v-model:open="tocOpen" :headings="toc.headings" />

        <!-- Thân bài: `toc.html` (nội dung đã lọc + id tiêu đề). ArticleBody chỉ được dùng ở đây. -->
        <ArticleBody :html="toc.html" />

        <!-- Thanh chia sẻ bài viết & in ấn (in: mở `/in-bai/<slug>` trong cửa sổ mới) -->
        <ArticleShareBar :slug="slug" :back-to="backTo" />
        <!-- Bình luận công khai. Ở trong cột đọc, không ở cột phải: một luồng hội
             thoại dài không đoán được độ dài sẽ phá bố cục của một cột hẹp, và
             bình luận là phần *nội dung* của bài này chứ không phải điều hướng đi
             nơi khác. Toàn bộ component tự nạp sau khi mount nên không có gì phụ
             thuộc người đọc lọt vào HTML của trang đã cache. -->
        <ArticleComments :slug="slug" />

        <!-- Back link -->
        <div class="mt-10 border-t border-line pt-8">
          <nuxt-link :to="backTo" class="btn btn-primary">&larr; {{ backCtaText }}</nuxt-link>
        </div>
        </div>
        <!-- ↑ hết cột đọc -->

        <!--
          Bài viết khác — cột phải trên PC, dải ngang dưới đáy trên mobile.

          Trước đây trang kết thúc ngay tại nút quay lại, nên đọc xong một bài là
          hết đường đi: người đọc phải về danh sách rồi tự tìm bài kế tiếp. Khối
          này trả lời hai câu hỏi khác nhau — "đọc gì tiếp" (bài viết) và "còn gì
          trong nhóm này" (chủ đề) — và chỉ hiện khi thật sự có nội dung, vì một
          tiêu đề "Bài viết khác" bên trên khoảng trắng còn trống trải hơn chỗ
          trống ban đầu. (Vì sao là một DANH SÁCH chứ không phải lưới thẻ: đầu
          components/article/ArticleRelatedList.vue.)

          `sticky top-[100px]` là cùng giá trị mà sidebar của `/news` dùng — nó
          phải chừa được cái header `fixed` (xem layouts/default.vue), y như
          `scroll-margin-top` của các heading trong bài.
        -->
        <aside
          v-if="relatedPending || relatedError || relatedArticles.length || showTopics"
          class="mt-12 border-t border-line pt-8 lg:mt-0 lg:border-t-0 lg:pt-0 lg:sticky lg:top-[100px]"
          aria-labelledby="noi-dung-lien-quan-heading"
        >
          <h2 id="noi-dung-lien-quan-heading" class="m-0 mb-4 text-[0.95rem] font-extrabold uppercase tracking-wide text-brand-800">
            <i class="fa-solid fa-layer-group mr-2 text-accent" aria-hidden="true"></i>{{ t('a_related_title') }}
          </h2>

          <!-- Đang tải. Cùng hình dạng hàng ngang với nội dung thật bên dưới:
               một khung chờ có kích thước khác thứ nó thay thế sẽ làm trang nhảy
               đúng lúc nội dung về. -->
          <div v-if="relatedPending" role="status" aria-busy="true" class="flex flex-col divide-y divide-line">
            <span class="sr-only">{{ t('a_related_loading') }}</span>
            <div
              v-for="n in 5"
              :key="n"
              aria-hidden="true"
              class="flex items-start gap-3 py-3 first:pt-0 animate-pulse motion-reduce:animate-none"
            >
              <div class="w-[72px] h-[54px] shrink-0 bg-surface-tint rounded"></div>
              <div class="min-w-0 flex-grow flex flex-col gap-2">
                <div class="h-3.5 w-full bg-surface-tint rounded"></div>
                <div class="h-3.5 w-3/5 bg-surface-tint rounded"></div>
              </div>
            </div>
          </div>

          <!-- Lỗi: gọi lại chính lượt fetch đã hỏng, không tải lại trang — bài
               viết ở trên vẫn đọc được và không có lý do gì để mất nó. -->
          <div
            v-else-if="relatedError"
            role="alert"
            class="bg-white border border-dashed border-[#E2A0A0] px-6 py-8 rounded-lg text-center text-danger-soft text-[0.95rem]"
          >
            <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
            {{ t('a_related_error') }}
            <button type="button" class="text-brand-600 font-bold underline" @click="refreshRelated()">{{ t('a_retry') }}</button>.
          </div>

          <!-- Đã tải: danh sách hàng ngang + chip chủ đề (ArticleRelatedList.vue, chỉ hiển thị). -->
          <ArticleRelatedList
            v-else
            :related-articles="relatedArticles"
            :related-topics="relatedTopics"
            :show-topics="showTopics"
            :back-to="backTo"
          />
        </aside>
      </article>

      <!-- Not found -->
      <div v-else class="py-10 text-center">
        <p class="text-ink-secondary mb-4">{{ notFoundTextValue }}</p>
        <nuxt-link :to="backTo" class="btn btn-primary">{{ backCtaText }}</nuxt-link>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Shared article detail view.
 *
 * /news/[id], /news/[category]/[slug], /role-models/[id] and
 * /reintegration-models/[id] were four copies of the same 85–123 line page.
 * They had already drifted (rounded-md vs rounded-lg, 1.15rem vs 1.12rem
 * excerpts, leading-[1.6] vs leading-relaxed) and each carried a private
 * local-time date formatter that can render a different day on the server than
 * in the browser. Everything lives here now (and, since wave3 4.2, in its parts under
 * `components/article/`), on the UTC-safe formatDateVN.
 *
 * The category breadcrumb that only /news/[category]/[slug] needs is supplied
 * through the `crumb` slot, which receives the resolved category label so the
 * crumb and the badge can never disagree.
 *
 * Split in wave3 4.2 (730 lines → this file + `components/article/*` + three composables).
 * Kept here: every request (article, related list, settings, view ping — the `$fetch` casts
 * stay here: there is no public typed fetch helper; the composables get them as functions),
 * the SSR status decision, the loading / error + retry / not-found branches of the page AND
 * of the related column, SEO, the TOC's open state. The parts render only: header, outline,
 * body (`ArticleBody` — the `v-html` and its `:deep()` rules; used nowhere else), share/print
 * bar (window.open/clipboard, no fetch), loaded related list.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { buildToc, TOC_MIN_HEADINGS } from '~/utils/toc'
import { useReadingHistory } from '~/composables/useReadingHistory'
import { useArticleDetailLabels } from '~/composables/useArticleDetailLabels'
import { useArticleRelated, type ArticleRelatedResponse } from '~/composables/useArticleRelated'
import { useArticleReadTracking } from '~/composables/useArticleReadTracking'
import { useSiteSettings, type PublicSettingsResponse } from '~/composables/useSiteSettings'
import { useSsrFailureStatus } from '~/composables/useSsrFailureStatus'
import { resolveDetailFetch } from '~/utils/ssr-failure-response'
import ArticleMetaHeader from '~/components/article/ArticleMetaHeader.vue'
import ArticleToc from '~/components/article/ArticleToc.vue'
import ArticleBody from '~/components/article/ArticleBody.vue'
import ArticleShareBar from '~/components/article/ArticleShareBar.vue'
import ArticleRelatedList from '~/components/article/ArticleRelatedList.vue'

const { record: recordRead } = useReadingHistory()

const props = defineProps({
  /** Article slug (or id) to fetch. */
  slug: { type: String, required: true },
  /** Listing route used by the breadcrumb and both back links. */
  backTo: { type: String, required: true },
  /** Pick which i18n key family to fall back to for the labels below. */
  variant: { type: String as () => 'news' | 'role' | 'reintegration', default: 'news' },
  /** Breadcrumb label for the listing. Falls back to t('a_back_<variant>'). */
  backLabel: { type: String, default: null },
  /** Call-to-action label on the back links. */
  backCtaLabel: { type: String, default: null },
  /** Final, non-linked breadcrumb. */
  currentCrumb: { type: String, default: null },
  /** Decorative glyph in front of the category badge. */
  metaIcon: { type: String, default: '📰' },
  /** Category shown when the article carries no category of its own. */
  categoryFallback: { type: String, default: null },
  /** Optional article-type → label map, consulted before categoryFallback. */
  typeLabels: { type: Object, default: () => ({}) },
  notFoundText: { type: String, default: null },
  seoFallbackTitle: { type: String, default: null },
  seoFallbackDescription: { type: String, default: null },
})

// `lazy` chỉ bỏ chặn điều hướng phía client — lượt dựng phía máy chủ vẫn chờ dữ
// liệu, nên HTML đầu tiên, thẻ SEO và mục lục không đổi. Đi từ danh sách sang
// chi tiết là lúc thấy rõ nhất: không có nó thì bấm vào một bài trông như bấm
// hụt cho tới khi bài về.
const { currentLang, t } = useI18n()

// Nhãn: prop của trang bọc nếu có, không thì khoá i18n theo `variant`.
const {
  backLabelText, backCtaText, currentCrumbText, notFoundTextValue, categoryFallbackValue,
  seoFallbackTitleValue, seoFallbackDescriptionValue,
} = useArticleDetailLabels(props, t)

type ArticleDetailResponse = {
  ok: boolean
  article: {
    id: number
    title: string
    slug: string
    excerpt: string | null
    content: string
    featuredImage: string | null
    thumbnailUrl?: string | null
    publishedAt: string | null
    createdAt?: string | null
    type?: string
    categoryName?: string | null
    authorName?: string | null
    viewTotal?: number
    category?: { name: string; slug: string } | null
    [key: string]: unknown
  } | null
}

const articleAsync = useAsyncData(
  () => `article-detail-${props.slug}-${currentLang.value}`,
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<ArticleDetailResponse>)(`/api/public/articles/${props.slug}?lang=${currentLang.value}`),
  {
    lazy: true,
    watch: [() => props.slug, currentLang],
    getCachedData: (key, nuxtApp) => {
      const cached = nuxtApp.payload.data[key] || nuxtApp.static.data[key]
      if (cached && (cached as ArticleDetailResponse).article) {
        return cached as ArticleDetailResponse
      }
      return undefined
    },
  },
)
const { data, pending, error, status, refresh } = articleAsync

/**
 * Hỏng ≠ không có (`utils/ssr-failure-response.ts` → `resolveDetailFetch`): API trả
 * 404 cho bài không tồn tại/chưa xuất bản — đó là "Không tìm thấy" (HTTP 404), không
 * phải "không tải được, thử lại". Chỉ lỗi KHÁC 404 mới là nhánh lỗi + thử lại.
 */
const fetchOutcome = computed(() => resolveDetailFetch({ status: status.value, error: error.value, hasContent: !!data.value?.article }))
const loadError = computed(() => fetchOutcome.value === 'failed')

// Lượt SSR hỏng → 503 + no-store; bài không có → 404 (CÙNG quyết định với nhánh hiển
// thị). Phía trình duyệt: nút "thử lại" + `onMounted` bên dưới như trước.
useSsrFailureStatus(() => articleAsync, () => loadError.value, { notFound: () => fetchOutcome.value === 'not-found' })

watch(currentLang, () => {
  void refresh()
  void refreshRelated()
})

onMounted(() => {
  // Nếu hydrate từ SSR mà chưa có bài viết (hoặc lệch cache), fetch ngay lập tức
  if (!article.value) {
    void refresh()
  }
  if (!relatedArticles.value.length) {
    void refreshRelated()
  }
})
const article = computed(() => data.value?.article || null)

const categoryLabel = computed(() => {
  const a = article.value
  if (!a) return ''
  return a.categoryName || (a.type ? props.typeLabels[a.type] : '') || props.categoryFallback || categoryFallbackValue.value
})

/**
 * Outline + anchored body in one pass, so a list entry and its heading can never
 * point at different ids. Recomputed with the article, which also covers the
 * client-side navigation between two detail pages. The open/folded state lives here, not
 * in `ArticleToc`: the outline is unmounted whenever the article reloads (a language
 * switch shows the skeleton), and a reader who folded it keeps it folded.
 */
const toc = computed(() => buildToc(article.value?.content))
const tocOpen = ref(true)

// Nội dung liên quan — lượt fetch thứ hai (luồng ở `useArticleRelated`, request ở đây).
// Lỗi của nó KHÔNG gộp vào `loadError`; khung chờ, nhánh lỗi + "thử lại" ở template trên.
const { relatedPending, relatedError, relatedArticles, relatedTopics, showTopics, refreshRelated } = useArticleRelated(
  props,
  article,
  currentLang,
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<ArticleRelatedResponse>)(`/api/public/articles/${props.slug}/related?lang=${currentLang.value}`),
)

// Ảnh chia sẻ: thumbnail bài viết > ảnh OG mặc định từ settings > hero_banner cứng.
// `server/plugins/og-image.ts` đã chèn `og:image` mặc định cho mọi route, nhưng
// `useSeoMeta` (`@unhead`) dedup theo `property="og:image"` và thay thế tag plugin
// — nên thumbnail bài viết thắng ảnh mặc định khi có. Dưới đây chỉ khai báo lại
// để Vue head biết tag của trang này là `og:image` (đúng hơn là để dedup), và lùi
// về ảnh mặc định nếu bài viết không có thumbnail.
//
// `useSiteSettings` giờ nhận `settingsData` ref (xem `useSiteSettings.ts`) —
// dùng cùng key `public-settings-nav` để Nuxt dedupe với layout, không phát thêm
// request. Component (page) có async context nên `useAsyncData` tự await.
const { data: settingsData } = useAsyncData<PublicSettingsResponse | null>(
  'public-settings-nav',
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<PublicSettingsResponse>)('/api/public/settings'),
  { default: () => null },
)
const { sitePublicSettings } = useSiteSettings(settingsData)
const ogImageFallback = computed(() => sitePublicSettings.value.og_image_url?.trim() || '/assets/hero_banner.jpg')

useSeoMeta({
  title: computed(() => (article.value ? `${article.value.title} | Con Đường Hướng Thiện` : seoFallbackTitleValue.value)),
  description: computed(() => article.value?.excerpt || seoFallbackDescriptionValue.value),
  ogTitle: computed(() => (article.value ? `${article.value.title} | Con Đường Hướng Thiện` : seoFallbackTitleValue.value)),
  ogDescription: computed(() => article.value?.excerpt || seoFallbackDescriptionValue.value),
  ogImage: computed(() => article.value?.thumbnailUrl || ogImageFallback.value),
  ogType: 'article',
})

// Lượt xem — đếm từ trình duyệt sau mount, mọi lỗi nuốt — và lịch sử đọc trên thiết bị
// (`useArticleReadTracking`; request lượt xem ở đây).
useArticleReadTracking({
  slug: () => props.slug,
  article,
  record: recordRead,
  sendView: (slug, body) => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/public/articles/${encodeURIComponent(slug)}/view`, {
    method: 'POST',
    body,
    keepalive: true,
    retry: 0,
    timeout: 1500,
  }),
})
</script>
