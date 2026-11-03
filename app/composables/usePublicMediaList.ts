import { computed, ref, watch } from 'vue'

// Đường dẫn tương đối, KHÔNG alias `~/`: bộ nạp test không biết alias của Nuxt.
// `useRoute` / `useAsyncData` / `navigateTo` / `$fetch` là auto-import của Nuxt —
// để trần cho `tests/public-media-list.test.ts` thay bằng bản giả trên `globalThis`
// (`publicFetch` gọi `$fetch` toàn cục lúc gọi).
import type { MediaListPayload, PublicMediaListItem } from '../types/public-api'
import { pageRange as buildPageRange } from '../utils/pagination'
import { isPageOutOfRange, listDataKey } from '../utils/public-article-list'
import {
  buildMediaListQuery,
  mediaListLocation,
  readMediaRouteState,
  sameMediaState,
  type MediaListQuery,
  type MediaRouteState,
} from '../utils/public-media-list'
import { publicFetch } from './publicFetch'
import { useNavigationSnapshot } from './usePublicArticleList'
import { useSsrFailureStatus } from './useSsrFailureStatus'

/** `/api/public/media` — kiểu suy từ handler (`media/index.get.ts`, D-FETCH lô G). */
type MediaListResponse = MediaListPayload
const fetchMedia = (url: string, options: { query: MediaListQuery }) => publicFetch<MediaListResponse>(url, options)

const emptyMediaList = (perPage: number): MediaListResponse => ({
  ok: true,
  items: [],
  categories: [],
  pagination: { page: 1, limit: perPage, total: 0, totalPages: 0 },
})

/**
 * Thư viện Video công khai (`/media`): danh sách + lọc chuyên mục + tìm kiếm +
 * phân trang, **URL là nguồn chân lý duy nhất** — cùng hợp đồng với
 * `usePublicArticleList`.
 *
 * Lỗi đã gặp: trang giữ `currentPage` / `searchQuery` / `categoryFilter` trong ba
 * `ref`, ghi lần lượt từng cái rồi mới `navigateTo`; một watcher trên `route.query`
 * lại ghi ngược chúng khi bấm Back. Khoá `useAsyncData` (Nuxt theo dõi
 * `flush: 'sync'`) đổi theo TỪNG lần ghi: tìm kiếm từ trang 2 gửi
 * `page=2&search=x` rồi `page=1&search=x`; Back gửi `page=2&search=x` rồi `page=2`.
 * Giờ không còn `ref` trạng thái nào: mọi hành động chỉ điều hướng, khoá dẫn xuất từ
 * ảnh chụp của URL nên đổi đúng một lần mỗi lượt điều hướng.
 */
export function usePublicMediaList(options: { perPage: number; scrollTargetId?: string }) {
  // `useRoute()` của Nuxt (route của TRANG), không phải của vue-router: route toàn
  // cục đổi ngay khi điều hướng sang trang khác, và trang đang rời sẽ bắn một lượt
  // gọi thừa trước khi bị gỡ.
  const route = useRoute()
  const state = useNavigationSnapshot<MediaRouteState>(
    () => readMediaRouteState(route.query as Record<string, unknown>),
    sameMediaState,
  )

  const currentPage = computed(() => state.value.page)
  const searchQuery = computed(() => state.value.search)
  const categoryFilter = computed(() => state.value.category)

  // Ô nhập là bản nháp; chỉ đồng bộ lại khi từ khoá trong URL đổi.
  const searchInput = ref(searchQuery.value)
  watch(searchQuery, (value) => {
    searchInput.value = value
  })

  const listQuery = computed(() => buildMediaListQuery(state.value, options.perPage))

  const asyncList = useAsyncData(
    () => listDataKey('public-media-list', listQuery.value),
    () => fetchMedia('/api/public/media', { query: listQuery.value }),
    {
      // `lazy` chỉ bỏ chặn điều hướng phía client; lượt dựng phía máy chủ vẫn chờ
      // dữ liệu, nên HTML đầu tiên và thẻ SEO không đổi. Không có nó thì khung
      // xương **không bao giờ được vẽ** — bấm một liên kết trông như bấm hụt.
      lazy: true,
      watch: [listQuery],
      default: () => emptyMediaList(options.perPage),
    },
  )
  const { data, pending, error, refresh } = asyncList

  const items = computed<PublicMediaListItem[]>(() => data.value?.items ?? [])
  const categories = computed(() => data.value?.categories ?? [])
  const pagination = computed(() => data.value?.pagination ?? emptyMediaList(options.perPage).pagination)
  const pageRange = computed(() => buildPageRange(pagination.value.page, pagination.value.totalPages))

  /**
   * Lỗi gồm **cả** một lượt fetch hỏng lẫn một phản hồi `ok: false` (kể cả 503 mà
   * `/api/public/media` trả khi CSDL hỏng). Máy chủ cố ý tách hai nhánh đó khỏi
   * "thư viện rỗng", nên giao diện phải đọc `ok` chứ không suy từ `items.length`.
   */
  const loadError = computed(() => !!error.value || data.value?.ok === false)
  // Lượt SSR hỏng → 503 + no-store: `/media` chạy `swr: 60`, và trước đây HTML mang
  // nhánh lỗi được đệm với 200 (đo trên bản build không có CSDL). Cùng biểu thức
  // với nhánh lỗi của trang.
  useSsrFailureStatus(() => asyncList, () => loadError.value)
  const hasFilters = computed(() => !!searchQuery.value || !!categoryFilter.value)
  /** `?page=` vượt trang cuối của một thư viện có video — hiện lối "Về trang đầu". */
  const pageOutOfRange = computed(() =>
    !pending.value && !loadError.value && isPageOutOfRange(currentPage.value, pagination.value),
  )

  const go = (next: Partial<MediaRouteState>) => navigateTo(mediaListLocation({ ...state.value, ...next }))

  const applySearch = () => go({ search: searchInput.value.trim(), page: 1 })
  const applyCategory = (category: string) => go({ category, page: 1 })
  const clearSearch = () => {
    searchInput.value = ''
    return go({ search: '', category: '', page: 1 })
  }
  const goFirstPage = () => go({ page: 1 })

  const setPage = (page: number) => {
    if (page < 1 || page > pagination.value.totalPages) return
    go({ page })
    if (import.meta.client && options.scrollTargetId) {
      // Cuộn về đầu danh sách, không về đầu trang: người đọc vừa bấm một số trang
      // và thứ họ cần thấy là danh sách mới, không phải lại thanh hero.
      document.getElementById(options.scrollTargetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return {
    currentPage,
    searchQuery,
    categoryFilter,
    searchInput,
    items,
    categories,
    pagination,
    pageRange,
    pending,
    loadError,
    hasFilters,
    pageOutOfRange,
    refresh,
    applySearch,
    applyCategory,
    clearSearch,
    goFirstPage,
    setPage,
  }
}
