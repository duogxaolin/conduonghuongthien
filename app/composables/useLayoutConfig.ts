/**
 * Đọc cấu hình layout chung của site từ `/api/public/settings` (đã có,
 * đã cache SWR qua routeRules + useAsyncData). Trả default an toàn khi chưa
 * cấu hình — không làm vỡ trang công khai.
 */

export interface LayoutConfig {
  containerWidth: 'compact' | 'standard' | 'wide' | 'custom'
  containerCustom: number
  articleGrid: 'grid' | 'list'
  articleGridCols: 2 | 3 | 4
  socialDisplayMode: 'popup' | 'floating'
  socialAutoOpen: boolean
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  containerWidth: 'standard',
  containerCustom: 1240,
  articleGrid: 'grid',
  articleGridCols: 3,
  socialDisplayMode: 'popup',
  socialAutoOpen: true,
}

const PRESET_PX: Record<Exclude<LayoutConfig['containerWidth'], 'custom'>, number> = {
  compact: 1152,  // max-w-6xl
  standard: 1240,
  wide: 1440,
}

function parseConfig(raw: unknown): LayoutConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LAYOUT_CONFIG }
  const obj = raw as Partial<LayoutConfig>
  return {
    containerWidth: (['compact', 'standard', 'wide', 'custom'].includes(obj.containerWidth as string) ? obj.containerWidth : DEFAULT_LAYOUT_CONFIG.containerWidth) as LayoutConfig['containerWidth'],
    containerCustom: Number.isFinite(obj.containerCustom) && (obj.containerCustom as number) >= 320 && (obj.containerCustom as number) <= 1920 ? (obj.containerCustom as number) : DEFAULT_LAYOUT_CONFIG.containerCustom,
    articleGrid: (['grid', 'list'].includes(obj.articleGrid as string) ? obj.articleGrid : DEFAULT_LAYOUT_CONFIG.articleGrid) as LayoutConfig['articleGrid'],
    articleGridCols: ([2, 3, 4].includes(obj.articleGridCols as number) ? obj.articleGridCols : DEFAULT_LAYOUT_CONFIG.articleGridCols) as 2 | 3 | 4,
    socialDisplayMode: (['popup', 'floating'].includes(obj.socialDisplayMode as string) ? obj.socialDisplayMode : DEFAULT_LAYOUT_CONFIG.socialDisplayMode) as 'popup' | 'floating',
    socialAutoOpen: typeof obj.socialAutoOpen === 'boolean' ? obj.socialAutoOpen : DEFAULT_LAYOUT_CONFIG.socialAutoOpen,
  }
}

/**
 * Lấy LayoutConfig từ public settings đã fetch (share payload với nav/footer).
 * Trả default nếu_endpoint lỗi hoặc key chưa có. Tuần tự: caller chịu trách nhiệm
 * đã có `useAsyncData('public-settings-nav')` hoặc tự fetch.
 */
export function parseLayoutSetting(value: string | null | undefined): LayoutConfig {
  if (!value) return { ...DEFAULT_LAYOUT_CONFIG }
  try {
    return parseConfig(JSON.parse(value))
  } catch {
    return { ...DEFAULT_LAYOUT_CONFIG }
  }
}

export function useLayoutConfig() {
  // `useState` được populate bởi layout default.vue / admin.vue qua fetch
  // `/api/public/settings`. Fallback default khi chưa hydrate.
  const stored = useState<LayoutConfig>('layout-config', () => ({ ...DEFAULT_LAYOUT_CONFIG }))
  const parsed = computed(() => stored.value)

  const containerPx = computed(() => {
    const c = parsed.value
    return c.containerWidth === 'custom' ? c.containerCustom : PRESET_PX[c.containerWidth] ?? PRESET_PX.standard!
  })

  const containerStyle = computed(() => ({ maxWidth: `${containerPx.value}px` }))

  // Class grid cho trang list bài công khai. `safelist` trong tailwind giữ
  // grid-cols-2/3/4 khỏi bị purge vì class động.
  const articleGridClass = computed(() => {
    const c = parsed.value
    if (c.articleGrid === 'list') return 'flex flex-col gap-5'
    return `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-${c.articleGridCols} gap-5`
  })

  return {
    config: parsed,
    containerPx,
    containerStyle,
    articleGridClass,
    setConfig(v: LayoutConfig) { stored.value = v },
  }
}

