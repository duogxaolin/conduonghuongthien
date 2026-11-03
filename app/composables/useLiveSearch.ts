import { ref, nextTick, type Ref } from 'vue'
import { createLiveSearch, type LiveSearchStatus } from '~/utils/live-search'
import { publicFetch } from '~/composables/publicFetch'
import type { PublicSearchResponse } from '~/types/public-content-api'

/**
 * Ô tìm kiếm nhanh ở header (desktop) + ngăn kéo mobile.
 *
 * State ở cấp composable (module) — không phải component — để hai ô nhập ở
 * hai bề mặt (desktop header + drawer) cùng một `searchQuery`, và một ô xoá
 * thì ô kia cũng xoá theo. `isSearchActive` chỉ mở/khớp nút ở header, không ảnh
 * hưởng drawer.
 *
 * Live preview gõ ≥2 ký tự thì gọi `/api/public/search` (debounce 250ms) để
 * hiện 6 gợi ý. Bấm vào gợi ý điều hướng và đóng cả header + drawer.
 *
 * `isMobileMenuOpen` truyền vào từ `useMobileMenu` (cùng闭/ mở drawer): tìm
 * kiếm đóng drawer khi điều hướng, nên hai composable chia sẻ ref đó.
 */
export interface LiveSearchItem {
  id: string | number
  kind: string
  type: string
  typeLabel: string
  typeIcon: string
  typeBadgeClass: string
  title: string
  excerpt: string
  url: string
  thumbnailUrl: string | null
  categoryName: string | null
}

/**
 * Trạng thái gợi ý (`idle`/`loading`/`success`/`error`) dùng chung giữa composable này
 * (gọi ở `default.vue`) và `DefaultSearchDropdown.vue`. Qua `useState` chứ không qua
 * prop: `default.vue` đã được tách cố ý và không nhận thêm logic/prop mới; và chứ
 * không qua `ref` cấp module: một `ref` module sống chung giữa mọi yêu cầu SSR.
 */
export const LIVE_SEARCH_STATUS_KEY = 'cdkt-live-search-status'
export const useLiveSearchStatus = () => useState<LiveSearchStatus>(LIVE_SEARCH_STATUS_KEY, () => 'idle')

export function useLiveSearch(isMobileMenuOpen: Ref<boolean>) {
  const searchQuery = ref('')
  const isSearchActive = ref(false)
  const liveSearchResults = ref<LiveSearchItem[]>([])
  const isSearchingLive = ref(false)
  const showLivePreview = ref(false)
  const searchInputRef = ref<HTMLInputElement | null>(null)
  const searchBarRef = ref<HTMLElement | null>(null)
  const liveSearchStatus = useLiveSearchStatus()

  // Máy trạng thái thuần (`utils/live-search.ts`): debounce 250 ms, huỷ lượt cũ,
  // tách "lỗi" khỏi "không có kết quả".
  const live = createLiveSearch<LiveSearchItem>({
    fetch: (q, signal) =>
      publicFetch<PublicSearchResponse>('/api/public/search', {
        params: { q, limit: 6 },
        signal,
        // ofetch mặc định tự gọi lại một lần khi 503 — với gợi ý gõ-tới-đâu-gọi-tới-đó
        // thì đó là gấp đôi tải lên một máy chủ đang hỏng. Người đọc có nút "Thử lại".
        retry: 0,
      }),
    onChange: (state) => {
      liveSearchStatus.value = state.status
      liveSearchResults.value = state.items
      isSearchingLive.value = state.status === 'loading'
      showLivePreview.value = state.visible
    },
  })

  const onSearchInput = () => live.input(searchQuery.value)

  const clearSearch = () => {
    searchQuery.value = ''
    live.reset()
    if (searchInputRef.value) searchInputRef.value.focus()
  }

  /** Bấm một gợi ý hoặc bấm "xem tất cả": đóng preview + header + drawer rồi đi. */
  const closeSearchAndNavigate = () => {
    showLivePreview.value = false
    isSearchActive.value = false
    isMobileMenuOpen.value = false
  }

  const toggleSearch = async () => {
    isSearchActive.value = !isSearchActive.value
    if (isSearchActive.value) {
      await nextTick()
      if (searchInputRef.value) {
        searchInputRef.value.focus()
      }
    } else {
      showLivePreview.value = false
    }
  }

  const handleSearch = () => {
    const q = searchQuery.value.trim()
    if (q) {
      navigateTo({ path: '/search', query: { q } })
      searchQuery.value = ''
      live.reset() // huỷ lượt gợi ý đang chờ/đang bay — không để nó mở lại khung gợi ý
      showLivePreview.value = false
      isSearchActive.value = false
      isMobileMenuOpen.value = false
    }
  }

  return {
    searchQuery,
    isSearchActive,
    liveSearchResults,
    isSearchingLive,
    showLivePreview,
    searchInputRef,
    searchBarRef,
    onSearchInput,
    clearSearch,
    closeSearchAndNavigate,
    toggleSearch,
    handleSearch,
  }
}
