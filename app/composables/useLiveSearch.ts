import { ref, nextTick, type Ref } from 'vue'

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

export function useLiveSearch(isMobileMenuOpen: Ref<boolean>) {
  const searchQuery = ref('')
  const isSearchActive = ref(false)
  const liveSearchResults = ref<LiveSearchItem[]>([])
  const isSearchingLive = ref(false)
  const showLivePreview = ref(false)
  const searchInputRef = ref<HTMLInputElement | null>(null)
  const searchBarRef = ref<HTMLElement | null>(null)
  let liveSearchTimer: ReturnType<typeof setTimeout> | null = null

  const onSearchInput = () => {
    const q = searchQuery.value.trim()
    if (q.length < 2) {
      liveSearchResults.value = []
      showLivePreview.value = false
      return
    }
    showLivePreview.value = true
    isSearchingLive.value = true
    if (liveSearchTimer) clearTimeout(liveSearchTimer)
    liveSearchTimer = setTimeout(async () => {
      try {
        const res = await ($fetch as (u: string, o: Record<string, unknown>) => Promise<{ ok: boolean; items: LiveSearchItem[] }>)('/api/public/search', {
          params: { q, limit: 6 },
        })
        if (res?.ok && Array.isArray(res.items)) {
          liveSearchResults.value = res.items
        } else {
          liveSearchResults.value = []
        }
      } catch {
        liveSearchResults.value = []
      } finally {
        isSearchingLive.value = false
      }
    }, 250)
  }

  const clearSearch = () => {
    searchQuery.value = ''
    liveSearchResults.value = []
    showLivePreview.value = false
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
