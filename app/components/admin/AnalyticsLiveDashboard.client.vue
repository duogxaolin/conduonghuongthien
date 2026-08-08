<script setup lang="ts">
import {
  analyticsCountdownSeconds,
  createAnalyticsPanelPoller,
  type AnalyticsPanelPoller,
  type AnalyticsPanelPollingState,
} from '~/utils/analytics-live-polling'

type BreakdownScope = 'path' | 'source_category' | 'device_class' | 'country_code' | 'region_code'
type Freshness = 'current' | 'stale' | 'empty'
type UniqueVisitorSemantics = 'approximate_minute_token'
type LiveResponse = {
  points: { bucketStart: string; pageViews: number; approximateUniqueVisitors: number; uniqueVisitorSemantics: UniqueVisitorSemantics }[]
  fiveMinuteTotals: { pageViews: number; approximateUniqueVisitors: number; eventsPerMinute: number; uniqueVisitorSemantics: UniqueVisitorSemantics }
  generatedAt: string
  latestBucketStart: string | null
  nextPollAfterSeconds: number
  freshness: Freshness
  stale: boolean
}
type BreakdownResponse = {
  scope: BreakdownScope
  rows: { rank: number; value: string; pageViews: number; approximateUniqueVisitors: number; share: number; uniqueVisitorSemantics: UniqueVisitorSemantics }[]
  totalPageViews: number
  generatedAt: string
  latestBucketStart: string | null
  nextPollAfterSeconds: number
  freshness: Freshness
  stale: boolean
}
type NocResponse = {
  rows: NocRow[]
  generatedAt: string
  latestBucketStart: string | null
  nextPollAfterSeconds: number
  freshness: Freshness
  stale: boolean
}

type PanelKey = 'live' | 'breakdown' | 'noc'
type UiConnectionState = 'denied' | 'hidden' | 'loading' | 'disconnected' | 'partial' | 'connected'

const scopes: { value: BreakdownScope; label: string }[] = [
  { value: 'path', label: 'Trang' },
  { value: 'source_category', label: 'Nguồn truy cập' },
  { value: 'device_class', label: 'Thiết bị' },
  { value: 'country_code', label: 'Quốc gia' },
  { value: 'region_code', label: 'Khu vực' },
]
const route = useRoute()
const router = useRouter()

function queryValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value
}
function normalizeScope(value: unknown): BreakdownScope {
  const candidate = queryValue(value)
  return scopes.some(scope => scope.value === candidate) ? candidate as BreakdownScope : 'path'
}
function normalizeFilter(scope: BreakdownScope, value: unknown): string | null {
  const candidate = value
  if (typeof candidate !== 'string') return null
  if (scope === 'path') {
    const trimmed = candidate.trim().split(/[?#]/, 1)[0]
    if (!trimmed || trimmed.length > 512 || !trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\') || [...trimmed].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null
    return trimmed
  }
  const trimmed = candidate.trim()
  if (!trimmed || trimmed.length > 128 || [...trimmed].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null
  if (scope === 'source_category') {
    const normalized = trimmed.toLowerCase()
    return ['direct', 'search', 'social', 'referral', 'email', 'other'].includes(normalized) ? normalized : null
  }
  if (scope === 'device_class') {
    const normalized = trimmed.toLowerCase()
    return ['desktop', 'mobile', 'tablet', 'bot', 'unknown', 'other'].includes(normalized) ? normalized : null
  }
  if (scope === 'country_code') {
    const normalized = trimmed.toUpperCase()
    if (normalized !== 'OTHER' && !/^[A-Z]{2}$/.test(normalized)) return null
    return normalized === 'OTHER' ? 'other' : normalized
  }
  if (trimmed !== 'other' && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/.test(trimmed)) return null
  return trimmed
}
function initialPanelSnapshot(): AnalyticsPanelPollingState {
  return {
    loading: false,
    inFlight: false,
    paused: true,
    denied: false,
    stale: false,
    consecutiveFailures: 0,
    hasSuccessfulData: false,
    lastSuccessfulAt: null,
    nextPollAt: null,
    countdownSeconds: null,
    connectionState: 'paused',
    error: null,
  }
}

const initialScope = normalizeScope(route.query.liveScope)
const selectedScope = ref<BreakdownScope>(initialScope)
const selectedFilter = ref<string | null>(normalizeFilter(initialScope, route.query.liveFilter))
const liveData = shallowRef<LiveResponse | null>(null)
const breakdownData = shallowRef<BreakdownResponse | null>(null)
const nocData = shallowRef<NocResponse | null>(null)
const livePollingSnapshot = shallowRef<AnalyticsPanelPollingState>(initialPanelSnapshot())
const breakdownPollingSnapshot = shallowRef<AnalyticsPanelPollingState>(initialPanelSnapshot())
const nocPollingSnapshot = shallowRef<AnalyticsPanelPollingState>(initialPanelSnapshot())
const hidden = ref(import.meta.client ? document.hidden : false)
const clock = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null
let mounted = false

function errorMessage(reason: unknown) {
  const status = (reason as { status?: number; statusCode?: number } | null)?.status ?? (reason as { statusCode?: number } | null)?.statusCode
  return status ? `Yêu cầu thất bại (${status})` : 'Không thể tải dữ liệu'
}
function createBreakdownPoller() {
  const scope = selectedScope.value
  const filter = selectedFilter.value
  return createAnalyticsPanelPoller<BreakdownResponse>({
    request: signal => $fetch('/api/admin/analytics/live/breakdown', {
      signal,
      query: { scope, window: 60, limit: 10, value: filter || undefined },
    }),
    onSuccess: response => { breakdownData.value = response },
    isStale: response => response.stale,
    onStateChange: state => { breakdownPollingSnapshot.value = state },
    errorMessage,
  })
}

const livePoller = createAnalyticsPanelPoller<LiveResponse>({
  request: signal => $fetch('/api/admin/analytics/live', { signal, query: { window: 60 } }),
  onSuccess: response => { liveData.value = response },
  isStale: response => response.stale,
  onStateChange: state => { livePollingSnapshot.value = state },
  errorMessage,
})
let breakdownPoller: AnalyticsPanelPoller = createBreakdownPoller()
const nocPoller = createAnalyticsPanelPoller<NocResponse>({
  request: signal => $fetch('/api/admin/analytics/noc', { signal, query: { limit: 50 } }),
  onSuccess: response => { nocData.value = response },
  isStale: response => response.stale,
  onStateChange: state => { nocPollingSnapshot.value = state },
  errorMessage,
})

// Pagination state
const LIVE_PAGE_SIZE = 15
const BREAKDOWN_PAGE_SIZE = 10
// Hai hàm thuần sống ở app/utils/analytics-noc.ts để kiểm được — safeDetails
// là bộ lọc quyền riêng tư, nó cần test riêng chứ không chỉ nằm trong SFC.
const liveTablePage = ref(1)
const breakdownTablePage = ref(1)

/**
 * Trạng thái bảng NOC ở `app/composables/useAnalyticsNocTable.ts`.
 *
 * Khối đó tách ra được vì nó chỉ cần dữ liệu NOC vào; phần template của bảng thì
 * ở nguyên đây, nó dùng 22 định danh của component này. Việc tách cũng gộp một
 * bản sao: `nocSummary` từng viết lại chính regex của `isWarningOrError`.
 */
const {
  page: nocTablePage,
  severityOnly: nocSeverityFilter,
  dismissedIds: dismissedNocIds,
  expandedId: expandedNocId,
  filtered: filteredNocRows,
  pageRows: nocTableRows,
  totalPages: nocTotalPages,
  summary: nocSummary,
  toggleSeverityFilter: toggleNocSeverityFilter,
  dismissRow: dismissNocRow,
  undismissAll,
  toggleRow: toggleNocRow,
} = useAnalyticsNocTable(computed(() => nocData.value?.rows))

// Reset pages when data changes
watch(liveData, () => { liveTablePage.value = 1 })
watch(breakdownData, () => { breakdownTablePage.value = 1 })

const liveTableRows = computed(() => {
  const rows = liveData.value?.points || []
  const reversed = [...rows].reverse()
  const start = (liveTablePage.value - 1) * LIVE_PAGE_SIZE
  return reversed.slice(start, start + LIVE_PAGE_SIZE)
})
const liveTotalPages = computed(() => Math.max(1, Math.ceil((liveData.value?.points.length || 0) / LIVE_PAGE_SIZE)))

const breakdownTableRows = computed(() => {
  const rows = breakdownData.value?.rows || []
  const start = (breakdownTablePage.value - 1) * BREAKDOWN_PAGE_SIZE
  return rows.slice(start, start + BREAKDOWN_PAGE_SIZE)
})
const breakdownTotalPages = computed(() => Math.max(1, Math.ceil((breakdownData.value?.rows.length || 0) / BREAKDOWN_PAGE_SIZE)))


// Donut chart for breakdown panel
const BREAKDOWN_COLORS = ['#2c6e33', '#5a9e60', '#8ed694', '#afc8b1', '#c8ddc9', '#deeede', '#122815', '#3d8045', '#a0c8a3', '#b8d6ba']
const SCOPE_LABELS: Record<string, string> = {
  direct: 'Trực tiếp', search: 'Tìm kiếm', social: 'Mạng XH',
  referral: 'Liên kết', email: 'Email', other: 'Khác',
  desktop: 'Máy tính', mobile: 'Điện thoại', tablet: 'Máy bảng', bot: 'Bot', unknown: 'Không rõ',
}
function scopeLabel(value: string) { return SCOPE_LABELS[value] ?? value }

const donutArcs = computed(() => {
  const rows = breakdownData.value?.rows || []
  if (!rows.length) return []
  const R = 40
  const C = 2 * Math.PI * R
  let offset = 0
  return rows.map((row, i) => {
    const dash = row.share * C
    const arc = { row, dash, offset: -offset, color: BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length] }
    offset += dash
    return arc
  })
})
const donutTotal = computed(() => breakdownData.value?.totalPageViews ?? 0)

const livePanelState = computed(() => livePollingSnapshot.value)
const breakdownPanelState = computed(() => breakdownPollingSnapshot.value)
const nocPanelState = computed(() => nocPollingSnapshot.value)
const livePanelError = computed(() => livePanelState.value.error)
const breakdownPanelError = computed(() => breakdownPanelState.value.error)
const nocPanelError = computed(() => nocPanelState.value.error)
const panelStates = computed(() => [livePanelState.value, breakdownPanelState.value, nocPanelState.value])
const panelErrors = computed<Record<PanelKey, string | null>>(() => ({
  live: livePanelError.value,
  breakdown: breakdownPanelError.value,
  noc: nocPanelError.value,
}))
const refreshing = computed(() => panelStates.value.some(state => state.inFlight))
const denied = computed(() => panelStates.value.some(state => state.denied))
const hasData = computed(() => Boolean(liveData.value || breakdownData.value || nocData.value))
const overallLoading = computed(() => refreshing.value && !hasData.value)
const disconnected = computed(() => panelStates.value.some(state => state.connectionState === 'disconnected'))
const partial = computed(() => !disconnected.value && panelStates.value.some(state => state.connectionState === 'partial-error'))
const nextPollAt = computed(() => {
  const nextTimes = panelStates.value.flatMap(state => state.nextPollAt === null ? [] : [state.nextPollAt])
  return nextTimes.length ? Math.min(...nextTimes) : null
})
const countdown = computed(() => analyticsCountdownSeconds(nextPollAt.value, clock.value))
const connectionState = computed<UiConnectionState>(() => {
  if (denied.value) return 'denied'
  if (hidden.value) return 'hidden'
  if (overallLoading.value) return 'loading'
  if (disconnected.value) return 'disconnected'
  if (partial.value) return 'partial'
  return 'connected'
})
const connectionLabel = computed(() => ({ denied: 'Từ chối truy cập', hidden: 'Tạm dừng khi thẻ bị ẩn', loading: 'Đang tải dữ liệu trực tiếp', disconnected: 'Mất kết nối', partial: 'Dữ liệu không đầy đủ', connected: 'Đã kết nối' }[connectionState.value] || connectionState.value))
const liveDelaySeconds = computed(() => {
  if (!liveData.value?.latestBucketStart) return '—'
  const generatedAt = Date.parse(liveData.value.generatedAt)
  const latestBucketStart = Date.parse(liveData.value.latestBucketStart)
  if (!Number.isFinite(generatedAt) || !Number.isFinite(latestBucketStart)) return '—'
  return `${Math.max(0, Math.round((generatedAt - latestBucketStart) / 1000))} giây`
})
const maxLiveMetric = computed(() => Math.max(1, ...(liveData.value?.points.flatMap(point => [point.pageViews, point.approximateUniqueVisitors]) || [1])))
const maxBreakdownMetric = computed(() => Math.max(1, ...(breakdownData.value?.rows.flatMap(row => [row.pageViews, row.approximateUniqueVisitors]) || [1])))

function syncRouteQuery(scope: BreakdownScope, filter: string | null) {
  const currentScope = route.query.liveScope
  const currentFilter = route.query.liveFilter
  if (currentScope === scope && currentFilter === (filter ?? undefined)) return
  const preservedQuery = { ...route.query }
  delete preservedQuery.liveScope
  delete preservedQuery.liveFilter
  void router.replace({
    query: {
      ...preservedQuery,
      liveScope: scope,
      ...(filter ? { liveFilter: filter } : {}),
    },
  })
}
function setBreakdownIdentity(scopeValue: unknown, filterValue: unknown, updateRoute = true) {
  const scope = normalizeScope(scopeValue)
  const filter = normalizeFilter(scope, filterValue)
  if (updateRoute) syncRouteQuery(scope, filter)
  if (selectedScope.value === scope && selectedFilter.value === filter) return
  selectedScope.value = scope
  selectedFilter.value = filter
  breakdownData.value = null
  breakdownPoller.stop()
  breakdownPoller = createBreakdownPoller()
  if (mounted && !hidden.value) breakdownPoller.start()
}
function changeScope(scope: BreakdownScope) {
  setBreakdownIdentity(scope, null)
}
function applyFilter(value: string) {
  setBreakdownIdentity(selectedScope.value, value)
}
function clearFilter() {
  setBreakdownIdentity(selectedScope.value, null)
}
function manualRefresh() {
  livePoller.refresh()
  breakdownPoller.refresh()
  nocPoller.refresh()
}
function retryLivePanel() { livePoller.retry() }
function retryBreakdownPanel() { breakdownPoller.retry() }
function retryNocPanel() { nocPoller.retry() }
function formatUtc(value: string | number | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return `${date.toLocaleString('en-GB', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} UTC`
}
function utcDateTime(value: number) {
  return new Date(value).toISOString()
}
function freshnessLabel(data: { freshness: Freshness; stale: boolean } | null) {
  if (!data) return 'Không khả dụng'
  const label = { current: 'hiện thời', stale: 'cũ', empty: 'trống' }[data.freshness]
  return data.stale ? `${label} (đã cũ)` : label
}
function handleVisibility() {
  hidden.value = document.hidden
  if (hidden.value) {
    livePoller.pause()
    breakdownPoller.pause()
    nocPoller.pause()
  } else {
    livePoller.resume()
    breakdownPoller.resume()
    nocPoller.resume()
  }
}

watch(
  () => [route.query.liveScope, route.query.liveFilter] as const,
  ([scope, filter]) => {
    const normalizedScope = normalizeScope(scope)
    const normalizedFilter = normalizeFilter(normalizedScope, filter)
    setBreakdownIdentity(normalizedScope, normalizedFilter, false)
    syncRouteQuery(normalizedScope, normalizedFilter)
  },
)

onMounted(() => {
  mounted = true
  document.addEventListener('visibilitychange', handleVisibility)
  clockTimer = setInterval(() => { clock.value = Date.now() }, 1000)
  syncRouteQuery(selectedScope.value, selectedFilter.value)
  if (!hidden.value) {
    livePoller.start()
    breakdownPoller.start()
    nocPoller.start()
  }
})
onBeforeUnmount(() => {
  mounted = false
  document.removeEventListener('visibilitychange', handleVisibility)
  livePoller.stop()
  breakdownPoller.stop()
  nocPoller.stop()
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<template>
  <section class="flex flex-col gap-6" :aria-busy="refreshing">

    <!-- ── Header ── -->
    <header class="flex flex-col gap-3 rounded-xl border border-[#e2ece3] bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f0f7f1]">
          <i class="fa-solid fa-signal text-[#2c6e33]" aria-hidden="true"></i>
        </div>
        <div>
          <h2 class="m-0 text-[1.05rem] font-extrabold text-[#122815]">Phân tích thời gian thực</h2>
          <p class="m-0 mt-0.5 text-[0.8rem] text-[#667768]" aria-live="polite">
            <span class="inline-flex items-center gap-1.5">
              <span class="inline-block h-2 w-2 rounded-full" :class="connectionState === 'connected' ? 'bg-[#2c6e33] animate-pulse' : connectionState === 'disconnected' ? 'bg-red-500' : 'bg-amber-400'"></span>
              {{ connectionLabel }}
            </span>
            <span v-if="nextPollAt" class="ml-2 text-[#667768]">· cập nhật sau <strong class="text-[#122815]">{{ countdown }}s</strong></span>
          </p>
        </div>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg bg-[#2c6e33] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#245b2a] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="refreshing || hidden"
        @click="manualRefresh"
      >
        <i class="fa-solid" :class="refreshing ? 'fa-spinner fa-spin' : 'fa-rotate-right'" aria-hidden="true"></i>
        {{ refreshing ? 'Đang cập nhật…' : 'Cập nhật ngay' }}
      </button>
    </header>

    <!-- ── Connection alert banner ── -->
    <div
      v-if="denied || hidden || disconnected || partial"
      class="flex items-start gap-3 rounded-xl border p-4 text-sm"
      :class="denied || disconnected ? 'border-red-200 bg-red-50 text-red-800' : hidden ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-[#dce8dd] bg-[#f0f7f1] text-[#1e4620]'"
      aria-live="polite"
    >
      <i class="fa-solid mt-0.5 shrink-0" :class="denied || disconnected ? 'fa-circle-exclamation text-red-600' : hidden ? 'fa-pause-circle text-amber-600' : 'fa-triangle-exclamation text-[#2c6e33]'" aria-hidden="true"></i>
      <div>
        <strong>{{ connectionLabel }}.</strong>
        <span v-if="denied"> Một bảng bị từ chối quyền truy cập; các bảng còn lại vẫn hoạt động.</span>
        <span v-else-if="hidden"> Polling đã tạm dừng cho đến khi tab này hiển thị lại.</span>
        <span v-else-if="disconnected"> Mất kết nối — đang giữ dữ liệu hợp lệ gần nhất.</span>
        <span v-else-if="partial"> Một bảng gặp lỗi tạm thời — đang giữ dữ liệu gần nhất.</span>
      </div>
    </div>

    <!-- ── 5-minute KPI cards ── -->
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <article
        v-for="card in [
          { label: 'Lượt xem (5 phút)', value: liveData?.fiveMinuteTotals.pageViews ?? '—', icon: 'fa-eye', color: 'text-[#2c6e33]', bg: 'bg-[#f0f7f1]' },
          { label: 'Khách ước tính (5 phút)', value: liveData?.fiveMinuteTotals.approximateUniqueVisitors ?? '—', icon: 'fa-users', color: 'text-[#2c6e33]', bg: 'bg-[#f0f7f1]' },
          { label: 'Sự kiện / phút', value: liveData?.fiveMinuteTotals.eventsPerMinute ?? '—', icon: 'fa-bolt', color: 'text-[#5a9e60]', bg: 'bg-[#f4fbf4]' },
          { label: 'Độ trễ dữ liệu', value: liveDelaySeconds, icon: 'fa-clock', color: 'text-[#667768]', bg: 'bg-[#f7f9f7]' },
        ]"
        :key="card.label"
        class="rounded-xl border border-[#e2ece3] bg-white p-5 shadow-sm"
      >
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" :class="card.bg">
            <i class="fa-solid text-base" :class="[card.icon, card.color]" aria-hidden="true"></i>
          </div>
          <p class="m-0 text-[0.78rem] font-semibold text-[#667768]">{{ card.label }}</p>
        </div>
        <p class="m-0 mt-3 text-[1.7rem] font-extrabold tabular-nums text-[#122815] leading-none">{{ card.value }}</p>
      </article>
    </div>

    <!-- ── Live 60-min chart panel ── -->
    <article class="rounded-xl border border-[#e2ece3] bg-white shadow-sm" :aria-busy="livePanelState.inFlight" aria-labelledby="live-panel-title">
      <!-- Panel header -->
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2ece3] px-5 py-4">
        <div class="flex items-center gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f0f7f1]">
            <i class="fa-solid fa-chart-bar text-[#2c6e33] text-sm" aria-hidden="true"></i>
          </div>
          <div>
            <h3 id="live-panel-title" class="m-0 text-[0.95rem] font-extrabold text-[#122815]">Biểu đồ 60 phút gần nhất</h3>
            <p class="m-0 text-[0.72rem] text-[#667768]">Mốc mới nhất: {{ formatUtc(liveData?.latestBucketStart) }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span
            v-if="liveData && liveData.freshness === 'empty'"
            class="inline-flex items-center gap-1.5 rounded-full bg-[#f0f7f1] px-2.5 py-1 text-[0.7rem] font-bold text-[#667768]"
          >
            <i class="fa-solid fa-circle-minus" aria-hidden="true"></i>
            Chưa có dữ liệu
          </span>
          <span v-if="livePanelState.inFlight" class="text-[0.72rem] text-[#667768]"><i class="fa-solid fa-spinner fa-spin mr-1" aria-hidden="true"></i>Đang cập nhật</span>
        </div>
      </div>

      <div class="p-5">
        <!-- Status messages -->
        <div class="mb-4" role="status" aria-live="polite" aria-atomic="true">
          <div v-if="livePanelState.loading && !liveData" class="flex items-center gap-2 rounded-lg bg-[#f0f7f1] px-4 py-3 text-sm text-[#2c6e33]">
            <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Đang tải dữ liệu…
          </div>
          <div v-else-if="livePanelState.denied" class="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <i class="fa-solid fa-lock" aria-hidden="true"></i> Không có quyền truy cập (401/403).
          </div>
          <div v-else-if="livePanelState.connectionState === 'disconnected'" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span><i class="fa-solid fa-wifi-slash mr-1.5" aria-hidden="true"></i>Mất kết nối<span v-if="liveData"> — đang giữ dữ liệu gần nhất</span>.</span>
            <button type="button" class="rounded-md border border-red-300 px-2 py-1 text-xs font-bold hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500" @click="retryLivePanel">Thử lại</button>
          </div>
          <div v-else-if="livePanelError" class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <i class="fa-solid fa-triangle-exclamation mr-1.5" aria-hidden="true"></i>{{ livePanelError }}<span v-if="liveData"> — đang hiển thị dữ liệu gần nhất.</span>
          </div>
        </div>
        <!-- Freshness footer: shows whether the held data is stale and when the last successful poll landed (UTC). -->
        <p class="mb-4 -mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.72rem] text-[#8ea98f]">
          <span v-if="livePanelState.stale && liveData" class="flex items-center gap-1 font-semibold text-amber-700"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>Dữ liệu có thể chưa mới nhất</span>
          <span>Lần cập nhật thành công (UTC): <time v-if="livePanelState.lastSuccessfulAt" :datetime="utcDateTime(livePanelState.lastSuccessfulAt)">{{ formatUtc(livePanelState.lastSuccessfulAt) }}</time><span v-else>Chưa có</span></span>
        </p>

        <!-- Legend -->
        <div class="mb-3 flex flex-wrap gap-4 text-[0.75rem] font-semibold text-[#667768]">
          <span class="flex items-center gap-1.5"><span class="inline-block h-2.5 w-2.5 rounded-sm bg-[#2c6e33]"></span>Lượt xem / mốc phút</span>
          <span class="flex items-center gap-1.5"><span class="inline-block h-2.5 w-2.5 rounded-sm bg-[#5b8fce]"></span>Khách ước tính / mốc phút</span>
        </div>

        <!-- Bar chart -->
        <div class="overflow-x-auto pb-2">
          <div class="flex h-48 min-w-[700px] items-end gap-px border-b border-l border-[#dbe7dc] bg-[#fafcfa] px-2 pt-4" role="img" :aria-label="`Biểu đồ ${liveData?.points.length || 0} mốc phút: lượt xem và khách ước tính`">
            <template v-if="liveData?.points.length">
              <div
                v-for="(point, index) in liveData.points"
                :key="point.bucketStart"
                class="group flex h-full min-w-2 flex-1 flex-col justify-end"
                :title="`${formatUtc(point.bucketStart)}: ${point.pageViews} lượt xem, ${point.approximateUniqueVisitors} khách`"
              >
                <span class="flex h-40 items-end justify-center gap-px">
                  <span class="w-1/2 rounded-t bg-[#2c6e33] transition-opacity group-hover:opacity-80" :style="{ height: point.pageViews === 0 ? '0%' : `${Math.max(3, point.pageViews / maxLiveMetric * 100)}%` }"><span class="sr-only">{{ point.pageViews }} lượt xem</span></span>
                  <span class="w-1/2 rounded-t bg-[#5b8fce] transition-opacity group-hover:opacity-80" :style="{ height: point.approximateUniqueVisitors === 0 ? '0%' : `${Math.max(3, point.approximateUniqueVisitors / maxLiveMetric * 100)}%` }"><span class="sr-only">{{ point.approximateUniqueVisitors }} khách</span></span>
                </span>
                <time v-if="index === 0 || index === (liveData?.points.length || 0) - 1 || index % 10 === 0" :datetime="point.bucketStart" class="mt-1 block whitespace-nowrap text-[9px] text-[#8ea98f]">{{ formatUtc(point.bucketStart).slice(0, 16) }}</time>
                <span v-else class="h-3.5" aria-hidden="true"></span>
              </div>
            </template>
            <p v-else class="m-auto text-sm text-[#667768]">Chưa có dữ liệu theo phút.</p>
          </div>
        </div>

        <!-- Screen-reader parity table: the full text alternative for the chart above (role="img"). -->
        <table class="sr-only">
          <caption>Dữ liệu đầy đủ tương ứng biểu đồ trực tiếp</caption>
          <thead>
            <tr>
              <th class="px-3 py-2">Mốc UTC</th>
              <th class="px-3 py-2">Lượt xem</th>
              <th class="px-3 py-2">Khách ước tính</th>
              <th class="px-3 py-2">Ngữ nghĩa khách</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="point in (liveData?.points || [])" :key="`parity-${point.bucketStart}`">
              <td class="px-3 py-2">{{ formatUtc(point.bucketStart) }}</td>
              <td class="px-3 py-2">{{ point.pageViews }}</td>
              <td class="px-3 py-2">{{ point.approximateUniqueVisitors }}</td>
              <td class="px-3 py-2">{{ point.uniqueVisitorSemantics }}</td>
            </tr>
          </tbody>
        </table>

        <!-- Table -->
        <div class="mt-5">
          <div class="overflow-x-auto rounded-lg border border-[#e2ece3]">
            <table class="min-w-full text-left text-sm">
              <caption class="sr-only">Dữ liệu chi tiết biểu đồ trực tiếp</caption>
              <thead class="bg-[#f4f7f4]">
                <tr class="text-[0.72rem] font-bold uppercase tracking-wide text-[#667768]">
                  <th class="px-4 py-2.5">Mốc UTC</th>
                  <th class="px-4 py-2.5 text-right">Lượt xem</th>
                  <th class="px-4 py-2.5 text-right">Khách ước tính</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[#f0f4f0]">
                <tr v-for="point in liveTableRows" :key="`lp-${point.bucketStart}`" class="hover:bg-[#fafcfa]">
                  <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-[#334e36]">{{ formatUtc(point.bucketStart) }}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-semibold" :class="point.pageViews > 0 ? 'text-[#2c6e33]' : 'text-[#afc8b1]'">{{ point.pageViews }}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-semibold" :class="point.approximateUniqueVisitors > 0 ? 'text-[#5b8fce]' : 'text-[#afc8b1]'">{{ point.approximateUniqueVisitors }}</td>
                </tr>
                <tr v-if="!liveData?.points.length">
                  <td colspan="3" class="px-4 py-6 text-center text-sm text-[#667768]">Chưa có dữ liệu.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="liveTotalPages > 1" class="mt-3 flex items-center justify-between text-[0.8rem] text-[#667768]">
            <span>Trang {{ liveTablePage }} / {{ liveTotalPages }} &nbsp;·&nbsp; {{ liveData?.points.length || 0 }} mốc</span>
            <div class="flex gap-2">
              <button type="button" class="rounded-lg border border-[#e2ece3] px-3 py-1.5 font-semibold hover:bg-[#f0f7f1] disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" :disabled="liveTablePage === 1" @click="liveTablePage--">← Trước</button>
              <button type="button" class="rounded-lg border border-[#e2ece3] px-3 py-1.5 font-semibold hover:bg-[#f0f7f1] disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" :disabled="liveTablePage === liveTotalPages" @click="liveTablePage++">Sau →</button>
            </div>
          </div>
        </div>
      </div>
    </article>

    <!-- ── Breakdown panel ── -->
    <article class="rounded-xl border border-[#e2ece3] bg-white shadow-sm" :aria-busy="breakdownPanelState.inFlight" aria-labelledby="breakdown-panel-title">
      <!-- Panel header -->
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2ece3] px-5 py-4">
        <div class="flex items-center gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f0f7f1]">
            <i class="fa-solid fa-chart-pie text-[#2c6e33] text-sm" aria-hidden="true"></i>
          </div>
          <div>
            <h3 id="breakdown-panel-title" class="m-0 text-[0.95rem] font-extrabold text-[#122815]">Phân tích chi tiết (60 phút)</h3>
            <p class="m-0 text-[0.72rem] text-[#667768]">Mốc mới nhất: {{ formatUtc(breakdownData?.latestBucketStart) }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span
            v-if="breakdownData && breakdownData.freshness === 'empty'"
            class="inline-flex items-center gap-1.5 rounded-full bg-[#f0f7f1] px-2.5 py-1 text-[0.7rem] font-bold text-[#667768]"
          >
            <i class="fa-solid fa-circle-minus" aria-hidden="true"></i>
            Chưa có
          </span>
        </div>
      </div>

      <div class="p-5">
        <!-- Scope tabs -->
        <div class="flex flex-wrap gap-2" aria-label="Phạm vi phân tích">
          <button
            v-for="scope in scopes"
            :key="scope.value"
            type="button"
            class="rounded-lg border px-3 py-1.5 text-[0.82rem] font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2"
            :class="selectedScope === scope.value ? 'border-[#2c6e33] bg-[#2c6e33] text-white shadow-sm' : 'border-[#e2ece3] bg-white text-[#334e36] hover:bg-[#f0f7f1]'"
            :aria-pressed="selectedScope === scope.value"
            @click="changeScope(scope.value)"
          >{{ scope.label }}</button>
        </div>

        <!-- Active filter badge -->
        <div v-if="selectedFilter" class="mt-3 flex items-center gap-2 rounded-lg bg-[#edf7ee] border border-[#c8ddc9] px-3 py-2 text-[0.82rem] text-[#1e4620]">
          <i class="fa-solid fa-filter text-[#2c6e33]" aria-hidden="true"></i>
          <span>Đang lọc: <strong>{{ selectedFilter }}</strong></span>
          <button type="button" class="ml-auto rounded px-2 py-0.5 font-bold text-[#2c6e33] hover:underline focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @click="clearFilter">Xóa bộ lọc</button>
        </div>

        <!-- Status messages -->
        <div class="mt-4" role="status" aria-live="polite" aria-atomic="true">
          <div v-if="breakdownPanelState.loading && !breakdownData" class="flex items-center gap-2 rounded-lg bg-[#f0f7f1] px-4 py-3 text-sm text-[#2c6e33]">
            <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Đang tải…
          </div>
          <div v-else-if="breakdownPanelState.denied" class="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <i class="fa-solid fa-lock" aria-hidden="true"></i> Không có quyền truy cập (401/403).
          </div>
          <div v-else-if="breakdownPanelState.connectionState === 'disconnected'" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span><i class="fa-solid fa-wifi-slash mr-1.5" aria-hidden="true"></i>Mất kết nối<span v-if="breakdownData"> — đang giữ dữ liệu gần nhất</span>.</span>
            <button type="button" class="rounded-md border border-red-300 px-2 py-1 text-xs font-bold hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500" @click="retryBreakdownPanel">Thử lại</button>
          </div>
          <div v-else-if="breakdownPanelError" class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <i class="fa-solid fa-triangle-exclamation mr-1.5" aria-hidden="true"></i>{{ breakdownPanelError }}<span v-if="breakdownData"> — đang hiển thị dữ liệu gần nhất.</span>
          </div>
        </div>
        <!-- Freshness footer -->
        <p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.72rem] text-[#8ea98f]">
          <span v-if="breakdownPanelState.stale && breakdownData" class="flex items-center gap-1 font-semibold text-amber-700"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>Dữ liệu có thể chưa mới nhất</span>
          <span>Lần cập nhật thành công (UTC): <time v-if="breakdownPanelState.lastSuccessfulAt" :datetime="utcDateTime(breakdownPanelState.lastSuccessfulAt)">{{ formatUtc(breakdownPanelState.lastSuccessfulAt) }}</time><span v-else>Chưa có</span></span>
        </p>

        <!-- Donut chart + bar chart side-by-side when data exists -->
        <div v-if="breakdownData && breakdownData.rows.length" class="mt-5 flex flex-col gap-6 lg:flex-row lg:items-start">

          <!-- Donut chart -->
          <div class="flex shrink-0 flex-col items-center gap-4 lg:w-56">
            <svg width="140" height="140" viewBox="0 0 104 104" role="img" :aria-label="`Biểu đồ tròn phân tích theo ${selectedScope}: ${breakdownData.rows.map(r => scopeLabel(r.value) + ' ' + Math.round(r.share*100) + '%').join(', ')}`">
              <circle cx="52" cy="52" r="40" fill="none" stroke="#f0f7f1" stroke-width="20" />
              <circle
                v-for="arc in donutArcs"
                :key="arc.row.value"
                cx="52" cy="52" r="40"
                fill="none"
                :stroke="arc.color"
                stroke-width="20"
                :stroke-dasharray="`${arc.dash} ${2 * Math.PI * 40 - arc.dash}`"
                :stroke-dashoffset="arc.offset"
                stroke-linecap="butt"
                style="transform-origin:52px 52px;transform:rotate(-90deg)"
              />
              <text x="52" y="48" text-anchor="middle" font-size="11" font-weight="800" fill="#122815">{{ donutTotal }}</text>
              <text x="52" y="62" text-anchor="middle" font-size="8" fill="#667768">lượt xem</text>
            </svg>
            <!-- Legend -->
            <ul class="w-full list-none p-0 m-0 flex flex-col gap-1.5">
              <li v-for="(arc, i) in donutArcs" :key="arc.row.value" class="flex items-center gap-2 text-[0.78rem]">
                <span class="shrink-0 h-3 w-3 rounded-full" :style="`background:${arc.color}`" aria-hidden="true"></span>
                <span class="truncate font-semibold text-[#334e36]">{{ scopeLabel(arc.row.value) }}</span>
                <span class="ml-auto shrink-0 font-bold text-[#122815]">{{ Math.round(arc.row.share * 100) }}%</span>
              </li>
            </ul>
          </div>

          <!-- Horizontal bar chart -->
          <div class="flex-1 min-w-0 space-y-2.5" role="img" :aria-label="`Biểu đồ thanh phân tích chi tiết theo ${selectedScope}`">
            <div v-for="row in breakdownData.rows" :key="`bar-${row.rank}-${row.value}`" class="group">
              <div class="flex items-center justify-between gap-2 text-[0.78rem] mb-1">
                <span class="font-semibold text-[#122815] truncate" :title="row.value">#{{ row.rank }} {{ scopeLabel(row.value) }}</span>
                <span class="shrink-0 text-[#667768]">
                  <span class="font-bold text-[#2c6e33]">{{ row.pageViews }}</span> lượt ·
                  <span class="font-bold text-[#5b8fce]">{{ row.approximateUniqueVisitors }}</span> khách
                </span>
              </div>
              <div class="h-5 rounded-full bg-[#f0f7f1] overflow-hidden">
                <div
                  class="h-full rounded-full bg-[#2c6e33] transition-all"
                  :style="{ width: row.pageViews === 0 ? '1%' : `${Math.max(3, row.pageViews / maxBreakdownMetric * 100)}%` }"
                  :title="`${row.pageViews} lượt xem`"
                ></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Table -->
        <div class="mt-5">
          <div class="overflow-x-auto rounded-lg border border-[#e2ece3]">
            <table class="min-w-[700px] w-full text-left text-sm">
              <caption class="sr-only">Bảng xếp hạng phân tích chi tiết</caption>
              <thead class="bg-[#f4f7f4]">
                <tr class="text-[0.72rem] font-bold uppercase tracking-wide text-[#667768]">
                  <th class="px-4 py-2.5 w-12">Hạng</th>
                  <th class="px-4 py-2.5">Giá trị</th>
                  <th class="px-4 py-2.5 text-right">Lượt xem</th>
                  <th class="px-4 py-2.5 text-right">Khách ước tính</th>
                  <th class="px-4 py-2.5 text-right">Tỷ lệ</th>
                  <th class="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[#f0f4f0]">
                <tr v-for="row in breakdownTableRows" :key="`bd-${row.rank}-${row.value}`" class="hover:bg-[#fafcfa]">
                  <td class="px-4 py-2.5 font-bold text-[#8ea98f]">{{ row.rank }}</td>
                  <td class="px-4 py-2.5 max-w-xs truncate font-semibold text-[#233c26]" :title="row.value">{{ row.value }}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-semibold text-[#2c6e33]">{{ row.pageViews }}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-semibold text-[#5b8fce]">{{ row.approximateUniqueVisitors }}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums text-[#667768]">{{ Math.round(row.share * 100) }}%</td>
                  <td class="px-4 py-2.5">
                    <button type="button" class="rounded-md border border-[#e2ece3] px-2.5 py-1 text-xs font-bold text-[#2c6e33] hover:bg-[#f0f7f1] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @click="applyFilter(row.value)">
                      <i class="fa-solid fa-filter mr-1" aria-hidden="true"></i>Lọc
                    </button>
                  </td>
                </tr>
                <tr v-if="!breakdownData?.rows.length">
                  <td colspan="6" class="px-4 py-6 text-center text-sm text-[#667768]">Chưa có dữ liệu phân tích.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="breakdownTotalPages > 1" class="mt-3 flex items-center justify-between text-[0.8rem] text-[#667768]">
            <span>Trang {{ breakdownTablePage }} / {{ breakdownTotalPages }} &nbsp;·&nbsp; {{ breakdownData?.rows.length || 0 }} hàng</span>
            <div class="flex gap-2">
              <button type="button" class="rounded-lg border border-[#e2ece3] px-3 py-1.5 font-semibold hover:bg-[#f0f7f1] disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" :disabled="breakdownTablePage === 1" @click="breakdownTablePage--">← Trước</button>
              <button type="button" class="rounded-lg border border-[#e2ece3] px-3 py-1.5 font-semibold hover:bg-[#f0f7f1] disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" :disabled="breakdownTablePage === breakdownTotalPages" @click="breakdownTablePage++">Sau →</button>
            </div>
          </div>
        </div>
      </div>
    </article>

    <!-- ── NOC panel ── -->
    <article class="rounded-xl border border-[#e2ece3] bg-white shadow-sm" :aria-busy="nocPanelState.inFlight" aria-labelledby="noc-panel-title">
      <!-- Panel header -->
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2ece3] px-5 py-4">
        <div class="flex items-center gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f0f7f1]">
            <i class="fa-solid fa-server text-[#2c6e33] text-sm" aria-hidden="true"></i>
          </div>
          <div>
            <h3 id="noc-panel-title" class="m-0 text-[0.95rem] font-extrabold text-[#122815]">Sự kiện vận hành (NOC)</h3>
            <p class="m-0 text-[0.72rem] text-[#667768]">Mốc mới nhất: {{ formatUtc(nocData?.latestBucketStart) }}</p>
          </div>
        </div>
        <span
          v-if="nocData && nocData.freshness === 'empty'"
          class="inline-flex items-center gap-1.5 rounded-full bg-[#f0f7f1] px-2.5 py-1 text-[0.7rem] font-bold text-[#667768]"
        >
          <i class="fa-solid fa-circle-minus" aria-hidden="true"></i>
          Chưa có
        </span>
      </div>

      <div class="p-5">
        <!-- Status messages -->
        <div class="mb-4" role="status" aria-live="polite" aria-atomic="true">
          <div v-if="nocPanelState.loading && !nocData" class="flex items-center gap-2 rounded-lg bg-[#f0f7f1] px-4 py-3 text-sm text-[#2c6e33]">
            <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Đang tải sự kiện NOC…
          </div>
          <div v-else-if="nocPanelState.denied" class="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <i class="fa-solid fa-lock" aria-hidden="true"></i> Không có quyền truy cập.
          </div>
          <div v-else-if="nocPanelState.connectionState === 'disconnected'" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span><i class="fa-solid fa-wifi-slash mr-1.5" aria-hidden="true"></i>Mất kết nối<span v-if="nocData"> — đang giữ dữ liệu gần nhất</span>.</span>
            <button type="button" class="rounded-md border border-red-300 px-2 py-1 text-xs font-bold hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500" @click="retryNocPanel">Thử lại</button>
          </div>
          <div v-else-if="nocPanelError" class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <i class="fa-solid fa-triangle-exclamation mr-1.5" aria-hidden="true"></i>{{ nocPanelError }}<span v-if="nocData"> — đang hiển thị dữ liệu gần nhất.</span>
          </div>
        </div>
        <!-- Freshness footer -->
        <p class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.72rem] text-[#8ea98f]">
          <span v-if="nocPanelState.stale && nocData" class="flex items-center gap-1 font-semibold text-amber-700"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>Dữ liệu có thể chưa mới nhất</span>
          <span>Lần cập nhật thành công (UTC): <time v-if="nocPanelState.lastSuccessfulAt" :datetime="utcDateTime(nocPanelState.lastSuccessfulAt)">{{ formatUtc(nocPanelState.lastSuccessfulAt) }}</time><span v-else>Chưa có</span></span>
        </p>

        <!-- NOC summary cards -->
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 mb-5">
          <div v-for="card in [
            { label: 'Tổng sự kiện', value: nocSummary.totalEvents, icon: 'fa-list-check', color: 'text-[#2c6e33]', bg: 'bg-[#f0f7f1]', clickable: false },
            { label: 'Cảnh báo / Lỗi', value: nocSummary.warningErrorEvents, icon: 'fa-triangle-exclamation', color: nocSummary.warningErrorEvents > 0 ? 'text-amber-700' : 'text-[#8ea98f]', bg: nocSummary.warningErrorEvents > 0 ? 'bg-amber-50' : 'bg-[#f0f7f1]', clickable: true },
            { label: 'Thời lượng tối đa', value: nocSummary.maxDuration + ' ms', icon: 'fa-stopwatch', color: 'text-[#667768]', bg: 'bg-[#f7f9f7]', clickable: false },
            { label: 'Trạng thái mới nhất', value: nocSummary.latestStatus, icon: 'fa-circle-info', color: 'text-[#5b8fce]', bg: 'bg-[#f0f6ff]', clickable: false },
          ]" :key="card.label"
            class="rounded-xl border border-[#e2ece3] bg-[#fafcfa] p-4 transition"
            :class="card.clickable ? 'cursor-pointer select-none hover:border-amber-300 hover:bg-amber-50/50' : ''"
            :role="card.clickable ? 'button' : undefined"
            :tabindex="card.clickable ? 0 : undefined"
            :aria-pressed="card.clickable ? nocSeverityFilter : undefined"
            :aria-label="card.clickable ? (nocSeverityFilter ? 'Đang lọc cảnh báo/lỗi — bấm để tắt' : 'Lọc chỉ xem cảnh báo/lỗi') : undefined"
            @click="card.clickable ? toggleNocSeverityFilter() : undefined"
            @keydown.enter.space.prevent="card.clickable ? toggleNocSeverityFilter() : undefined"
          >
            <div class="flex items-center gap-2 mb-2">
              <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" :class="card.bg">
                <i class="fa-solid text-sm" :class="[card.icon, card.color]" aria-hidden="true"></i>
              </div>
              <p class="m-0 text-[0.72rem] font-semibold uppercase tracking-wide text-[#667768]">{{ card.label }}</p>
              <i v-if="card.clickable && nocSeverityFilter" class="fa-solid fa-filter ml-auto text-amber-600 text-xs" aria-hidden="true"></i>
            </div>
            <p class="m-0 text-[1.1rem] font-extrabold text-[#122815]">{{ card.value }}</p>
          </div>
        </div>

        <!-- NOC toolbar -->
        <div class="mb-3 flex flex-wrap items-center gap-3">
          <span v-if="nocSeverityFilter" class="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
            <i class="fa-solid fa-filter" aria-hidden="true"></i>
            Chỉ hiện cảnh báo / lỗi
            <button type="button" class="ml-1 rounded px-1 font-extrabold hover:text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-400" @click="toggleNocSeverityFilter" aria-label="Xóa bộ lọc">✕</button>
          </span>
          <span v-if="dismissedNocIds.size > 0" class="inline-flex items-center gap-2 rounded-full border border-[#e2ece3] bg-[#f7f9f7] px-3 py-1 text-xs font-bold text-[#667768]">
            <i class="fa-solid fa-eye-slash" aria-hidden="true"></i>
            Đã ẩn {{ dismissedNocIds.size }} mục
            <button type="button" class="ml-1 rounded px-1 font-semibold text-[#2c6e33] hover:underline focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @click="undismissAll">Hiện lại</button>
          </span>
        </div>

        <!-- NOC table -->
        <div class="overflow-x-auto rounded-lg border border-[#e2ece3]">
          <table class="min-w-[900px] w-full text-left text-sm">
            <caption class="sr-only">Danh sách sự kiện vận hành NOC</caption>
            <thead class="bg-[#f4f7f4]">
              <tr class="text-[0.72rem] font-bold uppercase tracking-wide text-[#667768]">
                <th class="px-4 py-2.5 w-6"></th>
                <th class="px-4 py-2.5">Thời gian UTC</th>
                <th class="px-4 py-2.5">Mức độ</th>
                <th class="px-4 py-2.5">Thành phần</th>
                <th class="px-4 py-2.5">Sự kiện</th>
                <th class="px-4 py-2.5">Trạng thái</th>
                <th class="px-4 py-2.5 text-right">Số SK</th>
                <th class="px-4 py-2.5 text-right">Max ms</th>
                <th class="px-4 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in nocTableRows" :key="row.id">
                <!-- Main row -->
                <tr
                  class="border-b border-[#f0f4f0] cursor-pointer transition-colors"
                  :class="[
                    expandedNocId === row.id ? 'bg-[#f0f7f1]' : 'hover:bg-[#fafcfa]',
                    isWarningOrError(row.severity) ? 'border-l-2 border-l-amber-300' : ''
                  ]"
                  :aria-expanded="expandedNocId === row.id"
                  :aria-controls="`noc-detail-${row.id}`"
                  @click="toggleNocRow(row.id)"
                >
                  <td class="px-3 py-2.5 text-center">
                    <i class="fa-solid text-xs text-[#667768]" :class="expandedNocId === row.id ? 'fa-chevron-down' : 'fa-chevron-right'" aria-hidden="true"></i>
                  </td>
                  <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-[#334e36]">{{ formatUtc(row.bucketStart) }}</td>
                  <td class="px-4 py-2.5">
                    <span class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.7rem] font-bold"
                      :class="/^(error|critical)$/i.test(row.severity) ? 'bg-red-100 text-red-700' : /^(warning|warn)$/i.test(row.severity) ? 'bg-amber-100 text-amber-700' : 'bg-[#e8f5e9] text-[#1e4620]'"
                    >
                      <i class="fa-solid" :class="[/^(error|critical)$/i.test(row.severity) ? 'fa-circle-exclamation' : /^(warning|warn)$/i.test(row.severity) ? 'fa-triangle-exclamation' : 'fa-circle-check', 'text-[0.6rem]']" aria-hidden="true"></i><span>{{ row.severity }}</span>
                    </span>
                  </td>
                  <td class="px-4 py-2.5 text-[#334e36] font-semibold">{{ row.component }}</td>
                  <td class="px-4 py-2.5 text-[#334e36]">{{ row.eventType }}</td>
                  <td class="px-4 py-2.5 text-[#667768]">{{ row.status }}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-bold text-[#122815]">{{ row.eventCount }}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums text-[#667768]">{{ row.duration.maxMs }}</td>
                  <td class="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-lg border border-[#e2ece3] bg-white px-2.5 py-1 text-xs font-bold text-[#2c6e33] hover:bg-[#f0f7f1] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]"
                      aria-label="Đánh dấu đã xử lý"
                      title="Đánh dấu đã xử lý"
                      @click.stop="dismissNocRow(row.id)"
                    >
                      <i class="fa-solid fa-check" aria-hidden="true"></i>
                      Xử lý
                    </button>
                  </td>
                </tr>

                <!-- Expandable detail row -->
                <tr v-if="expandedNocId === row.id" :id="`noc-detail-${row.id}`" role="region" :aria-label="`Chi tiết sự kiện ${row.eventType}`">
                  <td colspan="9" class="px-6 py-4 bg-[#f7fbf7] border-b border-[#e2ece3]">
                    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      <div>
                        <p class="text-[0.68rem] font-bold uppercase tracking-wide text-[#667768] mb-1">Thời gian</p>
                        <p class="font-mono text-sm text-[#122815]">{{ formatUtc(row.bucketStart) }}</p>
                      </div>
                      <div>
                        <p class="text-[0.68rem] font-bold uppercase tracking-wide text-[#667768] mb-1">Thành phần</p>
                        <p class="font-semibold text-[#122815]">{{ row.component }}</p>
                      </div>
                      <div>
                        <p class="text-[0.68rem] font-bold uppercase tracking-wide text-[#667768] mb-1">Loại sự kiện</p>
                        <p class="text-[#334e36]">{{ row.eventType }}</p>
                      </div>
                      <div>
                        <p class="text-[0.68rem] font-bold uppercase tracking-wide text-[#667768] mb-1">Trạng thái</p>
                        <p class="text-[#334e36]">{{ row.status }}</p>
                      </div>
                      <div>
                        <p class="text-[0.68rem] font-bold uppercase tracking-wide text-[#667768] mb-1">Mã lỗi</p>
                        <p class="font-mono text-sm" :class="row.errorCode ? 'text-red-700 font-bold' : 'text-[#afc8b1]'">{{ row.errorCode || '(không có)' }}</p>
                      </div>
                      <div>
                        <p class="text-[0.68rem] font-bold uppercase tracking-wide text-[#667768] mb-1">Thời lượng</p>
                        <p class="tabular-nums text-[#334e36]">TB: <strong>{{ row.duration.averageMs }} ms</strong> · Max: <strong>{{ row.duration.maxMs }} ms</strong> · N={{ row.duration.count }}</p>
                      </div>
                      <div v-if="row.details" class="sm:col-span-2 xl:col-span-3">
                        <p class="text-[0.68rem] font-bold uppercase tracking-wide text-[#667768] mb-1">Chi tiết kỹ thuật</p>
                        <!-- Native disclosure: keyboard-operable without JS; content is escaped by safeDetails(). -->
                        <details v-if="row.details">
                          <summary class="cursor-pointer text-[0.8rem] font-semibold text-[#2c6e33] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2c6e33]">Xem chi tiết an toàn</summary>
                          <pre class="mt-2 rounded-lg bg-[#122815] text-[#8ed694] px-4 py-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">{{ safeDetails(row.details) }}</pre>
                        </details>
                      </div>
                    </div>
                    <div class="mt-4 flex gap-2">
                      <button
                        type="button"
                        class="inline-flex items-center gap-2 rounded-lg bg-[#2c6e33] px-4 py-2 text-sm font-bold text-white hover:bg-[#245b2a] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2"
                        @click.stop="dismissNocRow(row.id)"
                      >
                        <i class="fa-solid fa-check-circle" aria-hidden="true"></i>
                        Đánh dấu đã xử lý
                      </button>
                      <button
                        type="button"
                        class="inline-flex items-center gap-2 rounded-lg border border-[#e2ece3] bg-white px-4 py-2 text-sm font-semibold text-[#334e36] hover:bg-[#f0f7f1] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]"
                        @click.stop="toggleNocRow(row.id)"
                      >
                        <i class="fa-solid fa-chevron-up" aria-hidden="true"></i>
                        Thu gọn
                      </button>
                    </div>
                  </td>
                </tr>
              </template>

              <tr v-if="!filteredNocRows.length">
                <td colspan="9" class="px-4 py-8 text-center text-sm text-[#667768]">
                  <i class="fa-regular fa-circle-check text-2xl text-[#8ed694] block mb-2" aria-hidden="true"></i>
                  <span v-if="nocSeverityFilter">Không có cảnh báo / lỗi nào.</span>
                  <span v-else-if="dismissedNocIds.size > 0">Tất cả sự kiện đã được xử lý.
                    <button type="button" class="ml-2 text-[#2c6e33] font-bold underline focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @click="undismissAll">Hiện lại</button>
                  </span>
                  <span v-else>Không có sự kiện NOC nào.</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="nocTotalPages > 1" class="mt-3 flex items-center justify-between text-[0.8rem] text-[#667768]">
          <span>Trang {{ nocTablePage }} / {{ nocTotalPages }} &nbsp;·&nbsp; {{ filteredNocRows.length }} sự kiện</span>
          <div class="flex gap-2">
            <button type="button" class="rounded-lg border border-[#e2ece3] px-3 py-1.5 font-semibold hover:bg-[#f0f7f1] disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" :disabled="nocTablePage === 1" @click="nocTablePage--">← Trước</button>
            <button type="button" class="rounded-lg border border-[#e2ece3] px-3 py-1.5 font-semibold hover:bg-[#f0f7f1] disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" :disabled="nocTablePage === nocTotalPages" @click="nocTablePage++">Sau →</button>
          </div>
        </div>
      </div>
    </article>

  </section>
</template>
