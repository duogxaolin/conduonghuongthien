<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

import { defineAsyncComponent } from 'vue'

const AnalyticsTrafficChart = defineAsyncComponent(() => import('~/components/admin/AnalyticsTrafficChart.client.vue'))
const AnalyticsLiveDashboard = defineAsyncComponent(() => import('~/components/admin/AnalyticsLiveDashboard.client.vue'))
type Range = { start: string; end: string; days: number }
type MetricRow = { value: string; pageViews: number; summedDailyUniqueVisitors: number }
type Summary = {
  ok: boolean
  range: Range
  totals: { pageViews: number; summedDailyUniqueVisitors: number; uniqueVisitorSemantics: 'summed_daily_uniques' }
  traffic: Array<{ day: string; pageViews: number; dailyUniqueVisitors: number }>
  adminUsers: { snapshotDay: string; totalUsers: number; activeUsers: number } | null
  freshness: { lastAggregatedDay: string | null; stale: boolean }
}
type DrillDown = { ok: boolean; range: Range; items: MetricRow[]; pagination: { page: number; perPage: number; total: number; totalPages: number } }
type Dimension = 'source_category' | 'device_class' | 'country_code' | 'region_code'
type DrillType = 'pages' | Dimension

const route = useRoute()
const router = useRouter()
const { hasPermission } = useAdminAuth()
const authorized = computed(() => hasPermission('analytics', 'read'))
const today = () => new Date().toISOString().slice(0, 10)
const isCalendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year = NaN, month = NaN, day = NaN] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
const shiftDay = (day: string, amount: number) => {
  const date = new Date(`${day}T00:00:00Z`)
  if (!Number.isFinite(date.getTime())) return today()
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}
const routeEnd = typeof route.query.end === 'string' && isCalendarDate(route.query.end) ? route.query.end : today()
const initialEnd = routeEnd
const initialStart = typeof route.query.start === 'string' ? route.query.start : shiftDay(initialEnd, -29)
const start = ref(initialStart)
const end = ref(initialEnd)
const selectedDrill = ref<DrillType>(['pages', 'source_category', 'device_class', 'country_code', 'region_code'].includes(String(route.query.view)) ? route.query.view as DrillType : 'pages')
const selectedValue = ref(typeof route.query.value === 'string' ? route.query.value : '')
const selectedDay = ref(typeof route.query.day === 'string' ? route.query.day : '')
const previousRange = ref<{ start: string; end: string } | null>(null)
const summary = ref<Summary | null>(null)
const drill = ref<DrillDown | null>(null)
const initialLoading = ref(false)
const drillLoading = ref(false)
const summaryError = ref('')
const drillError = ref('')
let summaryRequest = 0
let drillRequest = 0
let summaryController: AbortController | null = null
let drillController: AbortController | null = null

const presets = [
  { label: '7 ngày', days: 7 },
  { label: '30 ngày', days: 30 },
  { label: '90 ngày', days: 90 },
  { label: '12 tháng', days: 366 },
]
const dimensions: Array<{ value: DrillType; label: string }> = [
  { value: 'pages', label: 'Trang phổ biến' },
  { value: 'source_category', label: 'Nguồn truy cập' },
  { value: 'device_class', label: 'Thiết bị' },
  { value: 'country_code', label: 'Quốc gia' },
  { value: 'region_code', label: 'Khu vực' },
]
const validationError = computed(() => {
  if (!isCalendarDate(start.value) || !isCalendarDate(end.value)) return 'Khoảng ngày không hợp lệ hoặc chưa đủ ngày.'
  const from = Date.parse(`${start.value}T00:00:00Z`)
  const to = Date.parse(`${end.value}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 'Khoảng ngày không hợp lệ.'
  if (from > to) return 'Ngày bắt đầu không được sau ngày kết thúc.'
  if (end.value > today()) return 'Khoảng ngày không được bao gồm ngày tương lai.'
  if (Math.floor((to - from) / 86_400_000) + 1 > 366) return 'Khoảng thời gian tối đa là 366 ngày, tính cả hai đầu.'
  return ''
})
const isEmpty = computed(() => summary.value !== null && summary.value.traffic.length === 0)
const formatNumber = (value: number) => new Intl.NumberFormat('vi-VN').format(value)
const formatDay = (day: string | null) => day ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${day}T00:00:00Z`)) : 'Chưa có dữ liệu'
// Dùng helper dùng chung (`app/utils/errorMessage.ts`) thay hai bản sao viết tay:
// hai bản đọc lỗi khác nhau trên cùng một dự án là hai cách hiển thị khác nhau
// cho cùng một lỗi máy chủ.
import { errorMessage, errorStatus } from '~/utils/errorMessage'
const queryRange = () => ({ start: start.value, end: end.value })
const replaceQuery = async () => {
  const preservedQuery = { ...route.query }
  delete preservedQuery.start
  delete preservedQuery.end
  delete preservedQuery.view
  delete preservedQuery.value
  delete preservedQuery.day
  await router.replace({
    query: {
      ...preservedQuery,
      start: start.value,
      end: end.value,
      view: selectedDrill.value,
      ...(selectedValue.value ? { value: selectedValue.value } : {}),
      ...(selectedDay.value ? { day: selectedDay.value } : {}),
    },
  })
}

const loadSummary = async () => {
  if (!authorized.value || validationError.value) return
  const request = ++summaryRequest
  summaryController?.abort()
  summaryController = new AbortController()
  initialLoading.value = summary.value === null
  summaryError.value = ''
  try {
    const response = await $fetch<Summary>('/api/admin/analytics/summary', { query: queryRange(), signal: summaryController.signal })
    if (request === summaryRequest) summary.value = response
  } catch (error: unknown) {
    if (request !== summaryRequest || isAbortError(error)) return
    if (errorStatus(error) === 403) summaryError.value = 'Bạn không có quyền xem dữ liệu phân tích.'
    else summaryError.value = errorMessage(error, 'Không thể tải dữ liệu phân tích. Vui lòng thử lại.')
  } finally {
    if (request === summaryRequest) initialLoading.value = false
  }
}
const loadDrill = async () => {
  if (!authorized.value || validationError.value) return
  const request = ++drillRequest
  drillController?.abort()
  drillController = new AbortController()
  drillLoading.value = true
  drillError.value = ''
  const endpoint = selectedDrill.value === 'pages' ? '/api/admin/analytics/pages' : `/api/admin/analytics/dimensions/${selectedDrill.value}`
  const query: Record<string, string | number> = { ...queryRange(), perPage: 10 }
  if (selectedValue.value) query[selectedDrill.value === 'pages' ? 'path' : 'filter'] = selectedValue.value
  try {
    const response = await $fetch<DrillDown>(endpoint, { query, signal: drillController.signal })
    if (request === drillRequest) drill.value = response
  } catch (error: unknown) {
    if (request !== drillRequest || isAbortError(error)) return
    drillError.value = errorMessage(error, 'Không thể tải bảng xếp hạng. Vui lòng thử lại.')
  } finally {
    if (request === drillRequest) drillLoading.value = false
  }
}
const applyRange = async () => {
  if (validationError.value) return
  selectedDay.value = ''
  await replaceQuery()
  await Promise.all([loadSummary(), loadDrill()])
}
const applyPreset = async (days: number) => {
  end.value = today()
  start.value = shiftDay(end.value, -(days - 1))
  await applyRange()
}
const changeDrill = async () => {
  selectedValue.value = ''
  drill.value = null
  await replaceQuery()
  await loadDrill()
}
const selectValue = async (value: string) => {
  selectedValue.value = value
  await replaceQuery()
  await loadDrill()
}
const clearSelection = async () => {
  selectedValue.value = ''
  if (selectedDay.value && previousRange.value) {
    start.value = previousRange.value.start
    end.value = previousRange.value.end
  }
  selectedDay.value = ''
  previousRange.value = null
  await replaceQuery()
  await Promise.all([loadSummary(), loadDrill()])
}
const selectDay = async (day: string) => {
  if (!selectedDay.value) previousRange.value = { start: start.value, end: end.value }
  selectedDay.value = day
  start.value = day
  end.value = day
  await replaceQuery()
  await Promise.all([loadSummary(), loadDrill()])
}

onMounted(async () => {
  if (!authorized.value || validationError.value) return
  await Promise.all([loadSummary(), loadDrill()])
})
onBeforeUnmount(() => { summaryController?.abort(); drillController?.abort() })
</script>

<template>
  <div class="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
    <header>
      <p class="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-[#2c6e33]">Báo cáo quản trị</p>
      <h1 class="m-0 text-2xl font-extrabold text-[#122815] md:text-3xl">Phân tích truy cập</h1>
      <p class="mt-2 max-w-3xl text-sm leading-6 text-[#667768]">Theo dõi xu hướng truy cập tổng hợp, không hiển thị dữ liệu nhận dạng hay sự kiện truy cập thô.</p>
    </header>

    <section v-if="!authorized" class="rounded-xl border border-amber-300 bg-amber-50 p-6" role="alert">
      <div class="flex items-start gap-3"><i class="fa-solid fa-lock mt-1 text-amber-700" aria-hidden="true"></i><div><h2 class="m-0 text-lg font-bold text-amber-950">Không có quyền truy cập</h2><p class="mt-2 text-sm text-amber-900">Tài khoản cần quyền <strong>analytics:read</strong> để mở báo cáo này. Hãy liên hệ quản trị viên hệ thống.</p><NuxtLink to="/admin" class="mt-4 inline-flex rounded-lg bg-[#2c6e33] px-4 py-2.5 text-sm font-bold text-white no-underline focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2">Về Dashboard</NuxtLink></div></div>
    </section>

    <template v-else>
      <ClientOnly>
        <AnalyticsLiveDashboard />
        <template #fallback>
          <section class="rounded-xl border border-[#dbe7dc] bg-white p-6 shadow-sm" aria-labelledby="live-dashboard-loading-heading" aria-busy="true">
            <h2 id="live-dashboard-loading-heading" class="m-0 text-lg font-bold text-[#122815]">Phân tích thời gian thực</h2>
            <p class="mt-2 text-sm text-[#667768]" role="status" aria-live="polite">Đang tải bảng điều khiển thời gian thực…</p>
          </section>
        </template>
      </ClientOnly>

      <section class="flex flex-col gap-6" aria-labelledby="historical-report-heading">
        <header>
          <h2 id="historical-report-heading" class="m-0 text-xl font-extrabold text-[#122815] md:text-2xl">Báo cáo lịch sử</h2>
          <p class="mt-2 text-sm leading-6 text-[#667768]">Số liệu tổng hợp theo ngày và phạm vi thời gian đã chọn.</p>
        </header>

        <section class="rounded-xl border border-[#dbe7dc] bg-white p-4 shadow-sm" aria-labelledby="date-filter-heading">
          <div class="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div><h2 id="date-filter-heading" class="m-0 text-base font-bold text-[#122815]">Khoảng thời gian UTC</h2><p class="mt-1 text-xs text-[#667768]">Tối đa 366 ngày. Bộ lọc được lưu trên URL để chia sẻ và tải lại.</p></div>
            <div class="flex flex-wrap gap-2"><button v-for="preset in presets" :key="preset.days" type="button" class="rounded-lg border border-[#b8cdb9] bg-[#f6faf6] px-3 py-2 text-sm font-semibold text-[#254c29] hover:bg-[#e8f4e9] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] motion-reduce:transition-none" @click="applyPreset(preset.days)">{{ preset.label }}</button></div>
          </div>
          <form class="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" @submit.prevent="applyRange">
            <label class="text-sm font-semibold text-[#334e36]">Từ ngày<input v-model="start" type="date" :max="today()" required class="mt-1 block w-full rounded-lg border border-[#b8cdb9] px-3 py-2.5 text-sm focus:border-[#2c6e33] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/20" :aria-invalid="Boolean(validationError)" /></label>
            <label class="text-sm font-semibold text-[#334e36]">Đến ngày<input v-model="end" type="date" :max="today()" required class="mt-1 block w-full rounded-lg border border-[#b8cdb9] px-3 py-2.5 text-sm focus:border-[#2c6e33] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/20" :aria-invalid="Boolean(validationError)" /></label>
            <button type="submit" :disabled="Boolean(validationError)" class="rounded-lg bg-[#2c6e33] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#245b2a] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none">Áp dụng</button>
          </form>
          <p v-if="validationError" class="mt-3 text-sm font-semibold text-red-700" role="alert"><i class="fa-solid fa-circle-exclamation mr-2" aria-hidden="true"></i>{{ validationError }}</p>
        </section>

        <section v-if="initialLoading" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Đang tải báo cáo">
          <div v-for="index in 4" :key="index" class="h-32 animate-pulse rounded-xl border border-[#e2ece3] bg-white p-5 motion-reduce:animate-none"><span class="sr-only">Đang tải chỉ số</span><div class="h-3 w-24 rounded bg-[#dfe9e0]"></div><div class="mt-5 h-8 w-32 rounded bg-[#edf3ed]"></div></div>
        </section>
        <section v-else-if="summaryError && !summary" class="rounded-xl border border-red-200 bg-red-50 p-6" role="alert"><h2 class="m-0 text-lg font-bold text-red-900">Không thể tải báo cáo</h2><p class="mt-2 text-sm text-red-800">{{ summaryError }}</p><button type="button" class="mt-4 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-red-700 focus:ring-offset-2" @click="loadSummary">Thử lại</button></section>

        <template v-else-if="summary">
          <div v-if="summaryError" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">Dữ liệu đang hiển thị là lần tải thành công gần nhất. {{ summaryError }} <button type="button" class="ml-2 font-bold underline focus:outline-none focus:ring-2 focus:ring-red-700" @click="loadSummary">Thử lại</button></div>
          <div v-if="summary.freshness.stale" class="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status"><i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i><strong>Dữ liệu có thể chưa đầy đủ.</strong> Ngày tổng hợp gần nhất: {{ formatDay(summary.freshness.lastAggregatedDay) }}.</div>

          <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Chỉ số tổng quan">
            <article class="rounded-xl border border-[#dbe7dc] bg-white p-5 shadow-sm"><p class="m-0 text-sm font-semibold text-[#667768]">Lượt xem trang</p><p class="my-3 text-3xl font-extrabold tabular-nums text-[#122815]">{{ formatNumber(summary.totals.pageViews) }}</p><p class="m-0 text-xs leading-5 text-[#667768]">Tổng số lượt mở trang công khai đã được tổng hợp trong khoảng chọn.</p></article>
            <article class="rounded-xl border border-[#dbe7dc] bg-white p-5 shadow-sm"><p class="m-0 text-sm font-semibold text-[#667768]">Tổng khách duy nhất theo ngày</p><p class="my-3 text-3xl font-extrabold tabular-nums text-[#122815]">{{ formatNumber(summary.totals.summedDailyUniqueVisitors) }}</p><p class="m-0 text-xs leading-5 text-[#667768]">Cộng số khách duy nhất của từng ngày; không phải số người được khử trùng lặp xuyên ngày.</p></article>
            <article class="rounded-xl border border-[#dbe7dc] bg-white p-5 shadow-sm"><p class="m-0 text-sm font-semibold text-[#667768]">Quản trị viên hoạt động / tổng</p><p class="my-3 text-3xl font-extrabold tabular-nums text-[#122815]">{{ summary.adminUsers ? `${formatNumber(summary.adminUsers.activeUsers)} / ${formatNumber(summary.adminUsers.totalUsers)}` : 'Chưa có' }}</p><p class="m-0 text-xs leading-5 text-[#667768]">Ảnh chụp theo ngày {{ summary.adminUsers ? formatDay(summary.adminUsers.snapshotDay) : 'chưa ghi nhận' }}, không phải số liệu thời gian thực.</p></article>
            <article class="rounded-xl border border-[#dbe7dc] bg-white p-5 shadow-sm"><p class="m-0 text-sm font-semibold text-[#667768]">Ngày tổng hợp gần nhất</p><p class="my-3 text-2xl font-extrabold text-[#122815]">{{ formatDay(summary.freshness.lastAggregatedDay) }}</p><p class="m-0 text-xs leading-5 text-[#667768]">Các ngày sau mốc này có thể chưa được xử lý bởi tác vụ bảo trì.</p></article>
          </section>

          <section v-if="isEmpty" class="rounded-xl border border-dashed border-[#afc8b1] bg-[#f7fbf7] p-8 text-center"><i class="fa-regular fa-calendar-xmark text-3xl text-[#527a56]" aria-hidden="true"></i><h2 class="mt-3 text-lg font-bold text-[#193c1d]">Chưa có dữ liệu trong khoảng này</h2><p class="mx-auto mt-2 max-w-xl text-sm text-[#667768]">Hãy chọn khoảng ngày khác hoặc kiểm tra ngày tổng hợp gần nhất. Không có số liệu giả được hiển thị.</p><button type="button" class="mt-4 rounded-lg bg-[#2c6e33] px-4 py-2.5 text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2" @click="applyPreset(30)">Xem 30 ngày gần nhất</button></section>

          <template v-else>
            <section class="rounded-xl border border-[#dbe7dc] bg-white p-4 shadow-sm md:p-6" aria-labelledby="trend-heading">
              <div class="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h2 id="trend-heading" class="m-0 text-lg font-bold text-[#122815]">Xu hướng theo ngày</h2><p class="mt-1 text-xs text-[#667768]">Chọn một hàng trong bảng để thu hẹp báo cáo về đúng ngày đó.</p></div><button v-if="selectedDay" type="button" class="self-start rounded-md px-3 py-2 text-sm font-bold text-[#2c6e33] underline focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @click="clearSelection">Quay lại khoảng trước</button></div>
              <ClientOnly><AnalyticsTrafficChart :points="summary.traffic" :selected-day="selectedDay" @select="selectDay" /><template #fallback><div class="rounded-lg bg-[#f4f7f4] p-6 text-sm text-[#667768]" role="status">Đang tải biểu đồ tương tác…</div></template></ClientOnly>
            </section>

            <section class="rounded-xl border border-[#dbe7dc] bg-white p-4 shadow-sm md:p-6" aria-labelledby="ranking-heading">
              <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h2 id="ranking-heading" class="m-0 text-lg font-bold text-[#122815]">Xếp hạng và phân nhóm</h2><p class="mt-1 text-xs text-[#667768]">Kích hoạt một hàng bằng chuột hoặc bàn phím để lọc chi tiết; chọn “Quay lại” để bỏ lọc.</p></div><label class="text-sm font-semibold text-[#334e36]">Phân tích theo<select v-model="selectedDrill" class="mt-1 block w-full min-w-[220px] rounded-lg border border-[#b8cdb9] px-3 py-2.5 focus:border-[#2c6e33] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/20" @change="changeDrill"><option v-for="dimension in dimensions" :key="dimension.value" :value="dimension.value">{{ dimension.label }}</option></select></label></div>
              <div v-if="selectedValue" class="mt-4 flex items-center justify-between gap-3 rounded-lg bg-[#edf7ee] p-3 text-sm"><span>Đang lọc: <strong class="break-all">{{ selectedValue }}</strong></span><button type="button" class="shrink-0 font-bold text-[#2c6e33] underline focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @click="clearSelection">Quay lại</button></div>
              <div v-if="drillLoading" class="mt-5 rounded-lg bg-[#f4f7f4] p-6 text-center text-sm text-[#667768]" role="status" aria-live="polite"><i class="fa-solid fa-spinner fa-spin mr-2 motion-reduce:animate-none" aria-hidden="true"></i>Đang tải chi tiết…</div>
              <div v-else-if="drillError" class="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{{ drillError }} <button type="button" class="ml-2 font-bold underline focus:outline-none focus:ring-2 focus:ring-red-700" @click="loadDrill">Thử lại</button></div>
              <div v-else-if="drill && drill.items.length === 0" class="mt-5 rounded-lg border border-dashed border-[#afc8b1] bg-[#f7fbf7] p-6 text-center text-sm text-[#667768]">Không có dữ liệu xếp hạng phù hợp với bộ lọc hiện tại.</div>
              <div v-else-if="drill" class="mt-5 overflow-x-auto"><table class="w-full min-w-[620px] border-collapse text-left text-sm"><caption class="sr-only">Bảng xếp hạng {{ dimensions.find(item => item.value === selectedDrill)?.label }}</caption><thead><tr class="border-b border-[#dbe7dc] text-xs uppercase tracking-wide text-[#667768]"><th class="px-3 py-3" scope="col">Hạng</th><th class="px-3 py-3" scope="col">Giá trị</th><th class="px-3 py-3 text-right" scope="col">Lượt xem</th><th class="px-3 py-3 text-right" scope="col">Tổng khách/ngày</th><th class="px-3 py-3" scope="col">Chi tiết</th></tr></thead><tbody><tr v-for="(item, index) in drill.items" :key="item.value" class="border-b border-[#edf3ed] hover:bg-[#f7faf7]"><td class="px-3 py-3 font-bold text-[#527a56]">{{ index + 1 }}</td><th class="max-w-[380px] break-all px-3 py-3 font-semibold text-[#233c26]" scope="row">{{ item.value === 'other' ? 'Khác (đã gộp)' : item.value }}</th><td class="px-3 py-3 text-right tabular-nums">{{ formatNumber(item.pageViews) }}</td><td class="px-3 py-3 text-right tabular-nums">{{ formatNumber(item.summedDailyUniqueVisitors) }}</td><td class="px-3 py-3"><button type="button" class="rounded-md px-3 py-2 font-bold text-[#2c6e33] underline decoration-dotted underline-offset-4 focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @click="selectValue(item.value)">Lọc giá trị</button></td></tr></tbody></table></div>
            </section>
          </template>
        </template>
      </section>
    </template>
  </div>
</template>
