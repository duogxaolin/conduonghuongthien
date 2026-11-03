import { computed, type Ref } from 'vue'
import type { PublicArticleRelatedResponse } from '../types/public-content-api'

// Đường dẫn tương đối / auto-import trần: tệp này cũng chạy trong test Node
// (tests/article-detail-page.test.ts), nơi `useAsyncData` là bản giả trên `globalThis`.

/**
 * Suy từ handler `articles/[slug]/related.get.ts` (D-FETCH lô G). Bản viết tay trước đó
 * khai một `featuredImage` máy chủ không bao giờ gửi (không nơi nào đọc).
 */
export type ArticleRelatedResponse = PublicArticleRelatedResponse
export type RelatedArticleItem = ArticleRelatedResponse['articles'][number]
export type RelatedTopic = ArticleRelatedResponse['topics'][number]

/**
 * Nội dung liên quan — lượt fetch thứ hai, ref đặt tên riêng (khối "Bài viết khác" của
 * `components/ArticleDetail.vue`, tách ở wave3 4.2).
 *
 * Không gộp vào endpoint chi tiết: bài viết là thứ trang này tồn tại để hiện, và
 * một truy vấn phụ hỏng hoặc chậm không được phép giữ nó lại. Tách ra thì phần
 * thân bài về ngay còn khối này tự lo khung chờ và nhánh lỗi của mình.
 *
 * `error.value` của lượt này KHÔNG được gộp vào `loadError` của trang: gộp là biến
 * một khối phụ hỏng thành một trang lỗi, ném đi đúng nội dung đã tải xong.
 *
 * Gọi trong `setup` của ArticleDetail.vue, NGAY SAU lượt đọc bài — cùng chỗ lượt gọi
 * `useAsyncData` này đứng trước khi tách, nên hai lượt fetch vẫn chạy song song (trên máy
 * chủ cả hai cùng được chờ trước khi ghi HTML). Request (`fetchRelated`, một lượt
 * `publicFetch<T>()`) do ArticleDetail.vue truyền vào; khung chờ, nhánh lỗi + "thử lại" vẽ ở đó.
 */
export function useArticleRelated(
  props: { slug: string; backTo: string },
  article: Ref<{ type?: string } | null>,
  currentLang: Ref<string>,
  fetchRelated: () => Promise<ArticleRelatedResponse>,
) {
  const {
    data: relatedData,
    pending: relatedPending,
    error: relatedFetchError,
    refresh: refreshRelated,
  } = useAsyncData(
    () => `article-related-${props.slug}`,
    fetchRelated,
    {
      lazy: true,
      default: () => ({ ok: true, articles: [], topics: [] }),
      watch: [() => props.slug, currentLang],
      getCachedData: (key, nuxtApp) => {
        const cached = nuxtApp.payload.data[key] || nuxtApp.static.data[key]
        if (cached && (cached as { ok: boolean }).ok) {
          return cached as ArticleRelatedResponse
        }
        return undefined
      },
    },
  )
  const relatedArticles = computed(() => relatedData.value?.articles || [])
  const relatedTopics = computed(() => relatedData.value?.topics || [])
  // `ok: false` là lượt truy vấn hỏng phía máy chủ — phải đọc ra như một lỗi, chứ
  // không phải như "không có gì liên quan".
  const relatedError = computed(() => !!relatedFetchError.value || relatedData.value?.ok === false)

  /**
   * Chip chủ đề trỏ vào `${backTo}/${slug}` (path segment `/news/<cat>`). Hai điều
   * kiện phải đúng **cả hai**:
   *
   * 1. `/news` là danh sách **duy nhất** có category filter (path segment) —
   *    `/role-models`, `/reintegration-models`, `/documents`, `/legal-qa` không
   *    có category filter nên chip ở đó mở ra danh sách chưa lọc (bấm hụt).
   * 2. `/news` **ghim cứng** `type: 'news'` trong truy vấn, nên chủ đề của một bài
   *    `document`/`faq` (cả hai cũng render tại `/news/<slug>`) sẽ mở ra danh sách
   *    rỗng — chip vẫn bấm được, chỉ không có gì phía sau.
   */
  const showTopics = computed(
    () => props.backTo === '/news' && article.value?.type === 'news' && relatedTopics.value.length > 0,
  )

  return { relatedPending, relatedError, relatedArticles, relatedTopics, showTopics, refreshRelated }
}
