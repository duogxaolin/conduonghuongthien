import { computed, ref, shallowRef, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

// Đường dẫn tương đối, KHÔNG alias `~/`: bộ nạp test (`scripts/ts-resolver.mjs`)
// không biết alias của Nuxt. `useRoute` / `useAsyncData` / `navigateTo` / `$fetch`
// là auto-import của Nuxt — để trần cho test thay bằng bản giả trên `globalThis`
// (`tests/public-article-list.test.ts`, phần 2).
import { pageRange as buildPageRange } from '../utils/pagination'
import {
  ALL_CATEGORIES,
  buildArticleListQuery,
  buildMostReadQuery,
  emptyArticleList,
  isPageOutOfRange,
  listDataKey,
  listLocation,
  readListRouteState,
  type ArticleListResponse,
} from '../utils/public-article-list'
import { useSsrFailureStatus } from './useSsrFailureStatus'

type ArticleFetch = (url: string, options: { query: object }) => Promise<ArticleListResponse>

/** `$fetch` có kiểu theo route Nitro — suy kiểu cho cả cây route rất đắt, ép về đúng hình dạng cần. */
const fetchArticles: ArticleFetch = (url, options) => ($fetch as unknown as ArticleFetch)(url, options)

/**
 * Ảnh chụp các tham số của MỘT lượt điều hướng, đổi đúng một lần mỗi nhịp.
 *
 * Vì sao không để khoá `useAsyncData` đọc thẳng `route` + prop: Nuxt theo dõi khoá
 * với `flush: 'sync'` (`nuxt/dist/app/composables/asyncData.js`), nên MỖI nguồn đổi
 * là một lần đổi khoá — một lượt gọi. Khi nhiều nguồn đổi trong cùng một nhịp
 * (`route.query` đổi ngay lúc điều hướng, còn prop chuyên mục từ trang cha chỉ đổi
 * khi cha render lại), khoá đi qua một tổ hợp TRUNG GIAN và bắn một lượt gọi thừa
 * với tham số cũ: chuyển chuyên mục từ trang 2 gửi `page=2&categorySlug=<mới>` rồi
 * mới `page=1&categorySlug=<mới>`. Chụp mọi nguồn trong một watcher `flush: 'pre'`
 * gom chúng lại: watcher chạy SAU khi trang cha đã cập nhật prop của component (và
 * không chạy nếu cha gỡ component trong nhịp đó), nên khoá đổi một lần với tổ hợp
 * cuối cùng. `same` chặn lượt ghi khi giá trị không thật sự đổi.
 */
export function useNavigationSnapshot<T>(read: () => T, same: (a: T, b: T) => boolean): Readonly<Ref<T>> {
  const snapshot = shallowRef(read())
  watch(read, (next) => {
    if (!same(snapshot.value, next)) snapshot.value = next
  }, { flush: 'pre' })
  return snapshot
}

export interface PublicArticleListOptions {
  /** `type` gửi `/api/public/articles` (`news`, `document`, `role_model`, `reintegration`, slug thể loại tự tạo). */
  type: MaybeRefOrGetter<string>
  perPage: number
  /** Ngôn ngữ hiện tại — bắt buộc: thiếu nó thì đổi ngôn ngữ không nạp lại và máy chủ đoán theo cookie. */
  lang: Ref<string>
  /** Đường dẫn của danh sách cho một chuyên mục (`ALL_CATEGORIES` = không lọc). */
  pathFor: (category: string) => string
  /** Nhận `?cat=` (link cũ). Các trang không có bộ lọc chuyên mục bỏ qua tham số này. */
  withCategory?: boolean
  /**
   * Chuyên mục do ĐƯỜNG DẪN quyết định (`/<loại>/<chuyên mục>`, trang cha truyền
   * xuống từ `route.params`). Có giá trị thì thắng `?cat=`.
   */
  pathCategory?: () => string | undefined
  /** Phần tử cuộn tới khi đổi trang. */
  scrollTargetId?: string
}

interface ListSnapshot {
  type: string
  lang: string
  page: number
  search: string
  category: string
}

const sameSnapshot = (a: ListSnapshot, b: ListSnapshot) =>
  a.type === b.type && a.lang === b.lang && a.page === b.page && a.search === b.search && a.category === b.category

/**
 * Danh sách bài viết công khai có phân trang + tìm kiếm, dùng chung cho `/news`,
 * `/documents`, `/role-models`, `/reintegration-models` và danh sách của một thể
 * loại / chuyên mục (`ContentTypeListSection.vue`: `/news/<chuyên mục>`,
 * `/<thể loại tự tạo>`).
 *
 * **URL là nguồn chân lý duy nhất.** Trang, từ khoá và chuyên mục đọc từ
 * `route.query` (+ chuyên mục theo đường dẫn); các hàm `setPage` / `applySearch` /
 * … chỉ `navigateTo`. Không có `ref` trạng thái nào được ghi lần lượt — mỗi lần
 * ghi như vậy từng là một lượt gọi API thừa với tham số trung gian.
 *
 * **Khoá `useAsyncData` dẫn xuất từ ảnh chụp điều hướng** (`useNavigationSnapshot`)
 * kèm `watch`. Nuxt 4 tự fetch khi khoá đổi và bỏ qua lượt `watch` trong cùng
 * nhịp đổi khoá, nên mỗi lượt điều hướng đúng một lượt gọi
 * (`tests/e2e/public-list-pagination.spec.ts` đếm từng lượt).
 *
 * `lazy: true` như trước: lượt dựng phía máy chủ vẫn chờ dữ liệu (HTML đầu tiên
 * và SEO không đổi), còn điều hướng phía client hiện khung xương thay vì đứng hình.
 */
export function usePublicArticleList(options: PublicArticleListOptions) {
  const route = useRoute()

  const snapshot = useNavigationSnapshot<ListSnapshot>(() => {
    const state = readListRouteState(route.query as Record<string, unknown>, { withCategory: options.withCategory })
    const fromPath = options.pathCategory?.()
    return {
      type: toValue(options.type),
      lang: options.lang.value,
      page: state.page,
      search: state.search,
      category: fromPath || state.category,
    }
  }, sameSnapshot)

  const currentPage = computed(() => snapshot.value.page)
  const searchQuery = computed(() => snapshot.value.search)
  const activeCategory = computed(() => snapshot.value.category)

  // Ô nhập là bản nháp của người đọc; chỉ đồng bộ lại khi từ khoá trong URL đổi
  // (gửi tìm kiếm, xoá lọc, nút Back).
  const searchInput = ref(searchQuery.value)
  watch(searchQuery, (value) => {
    searchInput.value = value
  })

  const listQuery = computed(() =>
    buildArticleListQuery({
      type: snapshot.value.type,
      perPage: options.perPage,
      page: snapshot.value.page,
      search: snapshot.value.search,
      category: snapshot.value.category,
      lang: snapshot.value.lang,
    }),
  )

  const asyncList = useAsyncData(
    () => listDataKey('public-articles', listQuery.value),
    () => fetchArticles('/api/public/articles', { query: listQuery.value }),
    {
      lazy: true,
      default: () => emptyArticleList(options.perPage),
      watch: [listQuery],
    },
  )
  const { data, pending, error, refresh } = asyncList

  const articles = computed(() => data.value?.articles || [])
  const loadError = computed(() => !!error.value || data.value?.ok === false)
  // Lượt SSR hỏng → 503 + no-store, để bộ đệm SWR (`/news/**`, `/role-models/**`…)
  // và CDN không phát lại HTML mang nhánh lỗi (trước đây 200 + `s-maxage=60`, đo
  // trên bản build không có CSDL). Cùng biểu thức với nhánh lỗi của danh sách.
  useSsrFailureStatus(() => asyncList, () => loadError.value)
  const pagination = computed(() => data.value?.pagination || emptyArticleList(options.perPage).pagination)
  const pageRange = computed(() => buildPageRange(pagination.value.page, pagination.value.totalPages))
  /** `?page=` vượt trang cuối của một danh sách có dữ liệu — hiện lối "Về trang đầu". */
  const pageOutOfRange = computed(() =>
    !pending.value && !loadError.value && isPageOutOfRange(currentPage.value, pagination.value),
  )

  // Bài tiêu điểm chỉ ở trang 1 khi không tìm kiếm.
  const isLeadPage = computed(() => currentPage.value === 1 && !searchQuery.value)
  const featured = computed(() => (isLeadPage.value ? articles.value[0] ?? null : null))
  const rest = computed(() => (isLeadPage.value ? articles.value.slice(1) : articles.value))

  /** Địa chỉ của một trạng thái danh sách — dùng cho `navigateTo` và cho `<nuxt-link :to>`. */
  const locationFor = (state: { category: string; search: string; page: number }) =>
    listLocation(options.pathFor(state.category), state)

  /** Địa chỉ trang `page` của danh sách hiện tại (giữ chuyên mục + từ khoá). */
  const pageLocation = (page: number) =>
    locationFor({ category: activeCategory.value, search: searchQuery.value, page })

  const go = (state: { category: string; search: string; page: number }) => navigateTo(locationFor(state))

  const setPage = (page: number) => {
    if (page < 1 || page > pagination.value.totalPages) return
    go({ category: activeCategory.value, search: searchQuery.value, page })
    if (import.meta.client && options.scrollTargetId) {
      document.getElementById(options.scrollTargetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  /** Về trang 1, giữ chuyên mục + từ khoá — lối thoát khi `?page=` vượt trang cuối. */
  const goFirstPage = () => go({ category: activeCategory.value, search: searchQuery.value, page: 1 })

  const setCategory = (category: string) => go({ category, search: searchQuery.value, page: 1 })

  const applySearch = () => go({ category: activeCategory.value, search: searchInput.value.trim(), page: 1 })

  const clearSearch = () => {
    searchInput.value = ''
    return go({ category: activeCategory.value, search: '', page: 1 })
  }

  /** Nút ✕ trong ô nhập: xoá bản nháp; chỉ điều hướng khi đang có lọc thật. */
  const clearSearchInput = () => {
    searchInput.value = ''
    if (searchQuery.value) return clearSearch()
  }

  const resetFilter = () => {
    searchInput.value = ''
    return go({ category: ALL_CATEGORIES, search: '', page: 1 })
  }

  return {
    currentPage,
    searchQuery,
    activeCategory,
    searchInput,
    articles,
    pagination,
    pageRange,
    pageOutOfRange,
    pending,
    loadError,
    refresh,
    isLeadPage,
    featured,
    rest,
    pageLocation,
    setPage,
    goFirstPage,
    setCategory,
    applySearch,
    clearSearch,
    clearSearchInput,
    resetFilter,
  }
}

/**
 * Khối "Đọc nhiều" (sort=views) — khoá theo loại + ngôn ngữ, nạp lại khi đổi ngôn ngữ.
 *
 * `mostReadFailed` + `retryMostRead`: lượt đọc hỏng thì Nuxt đặt `data` về `default()`
 * (danh sách rỗng), nên chỉ nhìn `mostRead` thì hỏng trông y như "chưa có dữ liệu lượt
 * xem" (FINDING-N3, /news). Nơi vẽ khối này đọc cờ để nói là hỏng và cho thử lại.
 */
export function usePublicMostRead(type: MaybeRefOrGetter<string>, lang: Ref<string>) {
  const query = computed(() => buildMostReadQuery(toValue(type), lang.value))
  const { data, pending, error, refresh } = useAsyncData(
    () => listDataKey('public-articles-most-read', query.value),
    () => fetchArticles('/api/public/articles', { query: query.value }),
    {
      lazy: true,
      default: () => emptyArticleList(6),
      watch: [query],
    },
  )
  const mostRead = computed(() => data.value?.articles || [])
  const mostReadFailed = computed(() => !!error.value || data.value?.ok === false)
  return { mostRead, mostReadPending: pending, mostReadFailed, retryMostRead: refresh }
}
