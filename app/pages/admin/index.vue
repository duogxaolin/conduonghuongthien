<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

import { defineAsyncComponent } from 'vue'
const AnalyticsTrafficChart = defineAsyncComponent(() => import('~/components/admin/AnalyticsTrafficChart.client.vue'))

const { user, hasPermission } = useAdminAuth()
const canReadAnalytics = computed(() => hasPermission('analytics', 'read'))

type TrafficPoint = { day: string; pageViews: number; dailyUniqueVisitors: number }
type LiveData = { fiveMinuteTotals: { pageViews: number; approximateUniqueVisitors: number; eventsPerMinute: number } }
type BreakdownRow = { rank: number; value: string; pageViews: number; approximateUniqueVisitors: number; share: number }
type BreakdownData = { rows: BreakdownRow[]; totalPageViews: number }

const trafficPoints = ref<TrafficPoint[]>([])
const liveData = ref<LiveData | null>(null)
const trafficLoading = ref(false)
const liveLoading = ref(false)
const trafficError = ref(false)
const liveError = ref(false)

const sourceData = ref<BreakdownData | null>(null)
const deviceData = ref<BreakdownData | null>(null)
const sourceLoading = ref(false)
const deviceLoading = ref(false)
const sourceError = ref(false)
const deviceError = ref(false)

const activeSlice = ref<{ scope: 'source' | 'device'; row: BreakdownRow } | null>(null)

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

async function loadTraffic() {
  if (!canReadAnalytics.value) return
  trafficLoading.value = true
  trafficError.value = false
  try {
    const res = await $fetch<{ ok: boolean; traffic: TrafficPoint[] }>(
      `/api/admin/analytics/summary?start=${daysAgo(6)}&end=${today()}`
    )
    if (res?.ok) trafficPoints.value = res.traffic ?? []
  } catch {
    trafficError.value = true
  } finally {
    trafficLoading.value = false
  }
}

async function loadLive() {
  if (!canReadAnalytics.value) return
  liveLoading.value = true
  liveError.value = false
  try {
    const res = await $fetch<LiveData & { ok?: boolean }>('/api/admin/analytics/live')
    if (res) liveData.value = res
  } catch {
    liveError.value = true
  } finally {
    liveLoading.value = false
  }
}

async function loadBreakdowns() {
  if (!canReadAnalytics.value) return
  sourceLoading.value = true
  deviceLoading.value = true
  sourceError.value = false
  deviceError.value = false
  try {
    const res = await $fetch<{ ok: boolean; rows: BreakdownRow[]; totalPageViews: number }>(
      '/api/admin/analytics/live/breakdown?scope=source_category&window=60'
    )
    if (res?.ok) sourceData.value = { rows: res.rows ?? [], totalPageViews: res.totalPageViews ?? 0 }
  } catch {
    sourceError.value = true
  } finally {
    sourceLoading.value = false
  }
  try {
    const res = await $fetch<{ ok: boolean; rows: BreakdownRow[]; totalPageViews: number }>(
      '/api/admin/analytics/live/breakdown?scope=device_class&window=60'
    )
    if (res?.ok) deviceData.value = { rows: res.rows ?? [], totalPageViews: res.totalPageViews ?? 0 }
  } catch {
    deviceError.value = true
  } finally {
    deviceLoading.value = false
  }
}

const formatNum = (n: number) => new Intl.NumberFormat('vi-VN').format(n)
const formatPct = (n: number) => `${Math.round(n * 100)}%`

const SOURCE_COLORS = ['#2c6e33', '#5a9e60', '#8ed694', '#afc8b1', '#d0e4d1', '#e8f4e9']
const DEVICE_COLORS = ['#122815', '#2c6e33', '#5a9e60', '#8ed694', '#afc8b1', '#d0e4d1']

const SOURCE_LABELS: Record<string, string> = {
  direct: 'Trực tiếp', search: 'Tìm kiếm', social: 'Mạng xã hội',
  referral: 'Liên kết', email: 'Email', other: 'Khác',
}
const DEVICE_LABELS: Record<string, string> = {
  desktop: 'Máy tính', mobile: 'Điện thoại', tablet: 'Máy tính bảng',
  bot: 'Bot', unknown: 'Không rõ', other: 'Khác',
}

function friendlyLabel(scope: 'source' | 'device', value: string) {
  return scope === 'source' ? (SOURCE_LABELS[value] ?? value) : (DEVICE_LABELS[value] ?? value)
}

function buildDonutArcs(rows: BreakdownRow[], colors: string[]) {
  const R = 40
  const CX = 52
  const CY = 52
  const circumference = 2 * Math.PI * R
  let offset = 0
  return rows.map((row, i) => {
    const dashLength = row.share * circumference
    const arc = { share: row.share, dashLength, dashOffset: -offset, color: colors[i % colors.length] }
    offset += dashLength
    return arc
  })
}

function onSliceClick(scope: 'source' | 'device', row: BreakdownRow) {
  if (activeSlice.value?.scope === scope && activeSlice.value.row.value === row.value) {
    activeSlice.value = null
  } else {
    activeSlice.value = { scope, row }
  }
}

const stats = ref([
  { title: 'Bài viết & Tin tức', value: '...', icon: 'fa-solid fa-newspaper', badge: 'Nội dung', accent: '#2c6e33', bg: '#f0f7f1', path: '/admin/content/articles' },
  { title: 'Tấm gương tiêu biểu', value: '...', icon: 'fa-solid fa-trophy', badge: 'Nhân vật', accent: '#c8832a', bg: '#fdf4e7', path: '/admin/content/articles' },
  { title: 'Đơn đăng ký hỗ trợ', value: '...', icon: 'fa-solid fa-envelope-open-text', badge: 'Chờ xử lý', accent: '#2e7db8', bg: '#eef5fb', path: '/admin/submissions' },
  { title: 'Thư viện Media', value: '...', icon: 'fa-solid fa-images', badge: 'Tệp tin', accent: '#7a5cbf', bg: '#f4f0fb', path: '/admin/media' },
])

const quickActions = [
  { title: 'Tùy chỉnh Trang chủ', desc: 'Kéo-thả sắp xếp lại section & đổi nội dung', path: '/admin/content/home', icon: 'fa-solid fa-cubes', accent: '#2c6e33' },
  { title: 'Viết bài mới', desc: 'Soạn thảo tin tức, bài viết với TinyMCE Editor', path: '/admin/content/articles/new', icon: 'fa-solid fa-pen-to-square', accent: '#2e7db8' },
  { title: 'Quản lý Người dùng', desc: 'Thêm tài khoản admin mới, thiết lập phân quyền', path: '/admin/users', icon: 'fa-solid fa-users', accent: '#c8832a' },
  { title: 'Cấu hình Lưu trữ Media', desc: 'Chuyển đổi Local / Cloudflare R2 storage', path: '/admin/settings/media-storage', icon: 'fa-solid fa-cloud-arrow-up', accent: '#7a5cbf' },
]

onMounted(async () => {
  try {
    const [artRes, subRes, mediaRes] = await Promise.all([
      $fetch('/api/admin/articles').catch(() => null),
      $fetch('/api/admin/submissions').catch(() => null),
      $fetch('/api/admin/media').catch(() => null),
    ])
    if (artRes?.ok) stats.value[0].value = String(artRes.pagination?.total || 0)
    if (subRes?.ok) stats.value[2].value = String(subRes.submissions?.length || 0)
    if (mediaRes?.ok) stats.value[3].value = String(mediaRes.pagination?.total || 0)
  } catch { /* ignore */ }
  await Promise.all([loadTraffic(), loadLive(), loadBreakdowns()])
})
</script>

<template>
  <div class="flex flex-col gap-7">

    <!-- Welcome Banner -->
    <div class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#122815] via-[#1e4620] to-[#2c6e33] text-white px-6 py-6 md:px-8 md:py-7 shadow-[0_8px_32px_rgba(18,40,21,0.22)]">
      <!-- decorative circles -->
      <div class="pointer-events-none absolute -top-10 -right-10 w-52 h-52 rounded-full bg-white/5" aria-hidden="true"></div>
      <div class="pointer-events-none absolute bottom-0 right-20 w-32 h-32 rounded-full bg-white/5" aria-hidden="true"></div>
      <div class="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p class="m-0 text-[0.78rem] font-semibold uppercase tracking-widest text-white/60 mb-1">Con Đường Hướng Thiện — C11 Bộ Công an</p>
          <h1 class="text-[1.5rem] font-extrabold m-0 leading-tight">Xin chào, {{ user?.username || 'Admin' }}!</h1>
          <p class="text-[0.88rem] opacity-75 m-0 mt-1.5">
            Vai trò: <span class="font-bold text-white/90">{{ user?.isSuperAdmin ? 'SuperAdmin (Toàn quyền)' : user?.roleName }}</span>
          </p>
        </div>
        <div class="flex gap-2 flex-wrap shrink-0">
          <nuxt-link to="/admin/content/articles/new" class="inline-flex items-center gap-2 rounded-lg bg-white/15 hover:bg-white/25 border border-white/20 px-4 py-2 text-sm font-bold text-white no-underline transition-colors">
            <i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>
            <span>Viết bài</span>
          </nuxt-link>
          <nuxt-link to="/admin/analytics" class="inline-flex items-center gap-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 px-4 py-2 text-sm font-semibold text-white/85 no-underline transition-colors">
            <i class="fa-solid fa-chart-line" aria-hidden="true"></i>
            <span>Thống kê</span>
          </nuxt-link>
        </div>
      </div>
    </div>

    <!-- Stats Grid -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <nuxt-link
        v-for="(s, idx) in stats"
        :key="idx"
        :to="s.path"
        class="group relative overflow-hidden rounded-2xl border border-[#e2ece3] bg-white p-5 no-underline flex flex-col gap-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.07)] hover:border-transparent"
        :style="`--accent: ${s.accent}; --bg: ${s.bg}`"
      >
        <!-- colored top bar -->
        <div class="absolute inset-x-0 top-0 h-1 rounded-t-2xl" :style="`background: ${s.accent}`" aria-hidden="true"></div>
        <div class="flex items-start justify-between">
          <div class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" :style="`background: ${s.bg}`">
            <i :class="s.icon" class="text-[1.25rem]" :style="`color: ${s.accent}`" aria-hidden="true"></i>
          </div>
          <span class="text-[0.68rem] font-bold px-2 py-0.5 rounded-full border" :style="`color: ${s.accent}; background: ${s.bg}; border-color: ${s.accent}22`">
            {{ s.badge }}
          </span>
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-[2rem] font-extrabold leading-none" :style="`color: ${s.accent}`">{{ s.value }}</span>
          <span class="text-[0.78rem] text-[#667768] font-semibold truncate mt-0.5">{{ s.title }}</span>
        </div>
        <!-- hover arrow -->
        <i class="fa-solid fa-arrow-right absolute bottom-4 right-4 text-xs opacity-0 group-hover:opacity-100 transition-opacity" :style="`color: ${s.accent}`" aria-hidden="true"></i>
      </nuxt-link>
    </div>

    <!-- Quick Actions -->
    <div>
      <div class="flex items-center gap-3 mb-4">
        <span class="w-1 h-5 rounded-full bg-[#2c6e33]" aria-hidden="true"></span>
        <h2 class="text-[1rem] font-extrabold text-[#122815] m-0">Tác vụ nhanh</h2>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <nuxt-link
          v-for="(act, idx) in quickActions"
          :key="idx"
          :to="act.path"
          class="group bg-white border border-[#e2ece3] px-4 py-4 rounded-xl no-underline flex items-center gap-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(0,0,0,0.06)] hover:border-transparent"
        >
          <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors" :style="`background: ${act.accent}18`">
            <i :class="act.icon" class="text-[1.15rem]" :style="`color: ${act.accent}`" aria-hidden="true"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-[0.9rem] font-bold text-[#122815] m-0 truncate">{{ act.title }}</p>
            <p class="text-[0.78rem] text-[#667768] m-0 mt-0.5 line-clamp-1">{{ act.desc }}</p>
          </div>
          <i class="fa-solid fa-chevron-right text-[0.7rem] text-[#afc8b1] group-hover:text-[#2c6e33] shrink-0 transition-colors" aria-hidden="true"></i>
        </nuxt-link>
      </div>
    </div>

    <!-- Analytics section — only shown if user has analytics:read -->
    <template v-if="canReadAnalytics">

      <!-- Section header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="w-1 h-5 rounded-full bg-[#2c6e33]" aria-hidden="true"></span>
          <h2 class="text-[1rem] font-extrabold text-[#122815] m-0">Thống kê truy cập</h2>
          <span class="inline-flex items-center gap-1.5 text-[0.72rem] font-bold text-[#2c6e33] bg-[#f0f7f1] border border-[#c8e6ca] rounded-full px-2.5 py-0.5">
            <span class="w-1.5 h-1.5 rounded-full bg-[#2c6e33] animate-pulse" aria-hidden="true"></span>
            Live
          </span>
        </div>
        <nuxt-link to="/admin/analytics" class="inline-flex items-center gap-1.5 text-[0.8rem] font-semibold text-[#2c6e33] no-underline hover:underline">
          Xem đầy đủ <i class="fa-solid fa-arrow-right text-[0.7rem]" aria-hidden="true"></i>
        </nuxt-link>
      </div>

      <!-- Live stats row — 3 metric cards -->
      <div class="grid grid-cols-3 gap-4">
        <template v-if="liveLoading">
          <div v-for="n in 3" :key="n" class="rounded-2xl border border-[#e2ece3] bg-white p-5 animate-pulse h-24" role="status" aria-label="Đang tải…"></div>
        </template>
        <template v-else-if="liveError">
          <div class="col-span-3 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-500 flex items-center gap-2">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            Không thể tải dữ liệu trực tiếp.
          </div>
        </template>
        <template v-else-if="liveData">
          <div class="rounded-2xl border border-[#e2ece3] bg-white p-5 flex flex-col gap-1" role="region" aria-label="Lượt xem trang 5 phút qua">
            <div class="flex items-center gap-2 mb-1">
              <span class="w-8 h-8 rounded-xl bg-[#f0f7f1] flex items-center justify-center shrink-0">
                <i class="fa-solid fa-eye text-[#2c6e33] text-sm" aria-hidden="true"></i>
              </span>
              <span class="text-[0.72rem] text-[#667768] font-semibold uppercase tracking-wide">Lượt xem</span>
            </div>
            <span class="text-[2rem] font-extrabold text-[#122815] leading-none">{{ formatNum(liveData.fiveMinuteTotals.pageViews) }}</span>
            <span class="text-[0.72rem] text-[#667768]">5 phút gần nhất</span>
          </div>
          <div class="rounded-2xl border border-[#e2ece3] bg-white p-5 flex flex-col gap-1" role="region" aria-label="Khách ước tính 5 phút qua">
            <div class="flex items-center gap-2 mb-1">
              <span class="w-8 h-8 rounded-xl bg-[#eef5fb] flex items-center justify-center shrink-0">
                <i class="fa-solid fa-users text-[#2e7db8] text-sm" aria-hidden="true"></i>
              </span>
              <span class="text-[0.72rem] text-[#667768] font-semibold uppercase tracking-wide">Khách (ước tính)</span>
            </div>
            <span class="text-[2rem] font-extrabold text-[#122815] leading-none">{{ formatNum(liveData.fiveMinuteTotals.approximateUniqueVisitors) }}</span>
            <span class="text-[0.72rem] text-[#667768]">5 phút gần nhất</span>
          </div>
          <div class="rounded-2xl border border-[#e2ece3] bg-white p-5 flex flex-col gap-1" role="region" aria-label="Sự kiện mỗi phút">
            <div class="flex items-center gap-2 mb-1">
              <span class="w-8 h-8 rounded-xl bg-[#fdf4e7] flex items-center justify-center shrink-0">
                <i class="fa-solid fa-bolt text-[#c8832a] text-sm" aria-hidden="true"></i>
              </span>
              <span class="text-[0.72rem] text-[#667768] font-semibold uppercase tracking-wide">Sự kiện/phút</span>
            </div>
            <span class="text-[2rem] font-extrabold text-[#122815] leading-none">{{ liveData.fiveMinuteTotals.eventsPerMinute.toFixed(1) }}</span>
            <span class="text-[0.72rem] text-[#667768]">trung bình</span>
          </div>
        </template>
        <template v-else>
          <div class="col-span-3 rounded-2xl border border-dashed border-[#afc8b1] bg-[#f7fbf7] p-5 text-sm text-[#667768] text-center">Chưa có dữ liệu trực tiếp.</div>
        </template>
      </div>

      <!-- 7-day traffic chart -->
      <div class="bg-white rounded-2xl border border-[#e2ece3] p-5 md:p-6">
        <div class="flex items-center justify-between mb-5">
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-chart-area text-[#2c6e33]" aria-hidden="true"></i>
            <h2 class="text-[0.95rem] font-extrabold text-[#122815] m-0">Xu hướng 7 ngày qua</h2>
          </div>
          <nuxt-link to="/admin/analytics" class="text-[0.78rem] font-semibold text-[#2c6e33] no-underline hover:underline">Chi tiết →</nuxt-link>
        </div>
        <div v-if="trafficLoading" class="rounded-xl bg-[#f4f7f4] h-40 flex items-center justify-center text-sm text-[#667768] animate-pulse" role="status">Đang tải biểu đồ…</div>
        <div v-else-if="trafficError" class="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-500 flex items-center gap-2">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Không thể tải dữ liệu thống kê.
        </div>
        <div v-else-if="trafficPoints.length === 0" class="rounded-xl border border-dashed border-[#afc8b1] bg-[#f7fbf7] p-8 text-center text-sm text-[#667768]">
          <i class="fa-solid fa-chart-area text-2xl text-[#c8d6c9] mb-2 block" aria-hidden="true"></i>
          Chưa có dữ liệu thống kê trong 7 ngày qua.
        </div>
        <ClientOnly v-else>
          <AnalyticsTrafficChart :points="trafficPoints" />
          <template #fallback>
            <div class="rounded-xl bg-[#f4f7f4] h-40 flex items-center justify-center text-sm text-[#667768]" role="status">Đang tải biểu đồ tương tác…</div>
          </template>
        </ClientOnly>
      </div>

      <!-- Breakdown donut charts: source_category + device_class -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">

        <!-- Source category donut -->
        <div class="bg-white rounded-2xl border border-[#e2ece3] p-5">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-globe text-[#2c6e33] text-sm" aria-hidden="true"></i>
              <h2 class="text-[0.9rem] font-extrabold text-[#122815] m-0">Nguồn truy cập</h2>
              <span class="text-[0.65rem] text-[#667768] bg-[#f4f7f4] border border-[#e2ece3] rounded-full px-2 py-0.5 font-semibold">60 phút</span>
            </div>
            <nuxt-link to="/admin/analytics" class="text-[0.72rem] font-semibold text-[#2c6e33] no-underline hover:underline">Chi tiết →</nuxt-link>
          </div>
          <div v-if="sourceLoading" class="flex items-center justify-center h-28 text-sm text-[#667768] animate-pulse" role="status">Đang tải…</div>
          <div v-else-if="sourceError" class="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-500 flex items-center gap-2">
            <i class="fa-solid fa-triangle-exclamation shrink-0" aria-hidden="true"></i> Không thể tải dữ liệu.
          </div>
          <div v-else-if="!sourceData || sourceData.rows.length === 0" class="flex flex-col items-center justify-center h-28 rounded-xl border border-dashed border-[#afc8b1] bg-[#f7fbf7] text-sm text-[#667768] gap-2">
            <i class="fa-solid fa-globe text-xl text-[#c8d6c9]" aria-hidden="true"></i>
            Chưa có dữ liệu nguồn truy cập.
          </div>
          <div v-else class="flex flex-col gap-4">
            <div class="flex items-center gap-4">
              <div class="shrink-0">
                <svg width="110" height="110" viewBox="0 0 104 104" role="img" :aria-label="`Biểu đồ nguồn truy cập: ${sourceData.rows.map(r => friendlyLabel('source', r.value) + ' ' + formatPct(r.share)).join(', ')}`">
                  <circle cx="52" cy="52" r="40" fill="none" stroke="#f0f7f1" stroke-width="18" />
                  <circle
                    v-for="(arc, i) in buildDonutArcs(sourceData.rows, SOURCE_COLORS)"
                    :key="i"
                    cx="52" cy="52" r="40"
                    fill="none"
                    :stroke="arc.color"
                    stroke-width="18"
                    :stroke-dasharray="`${arc.dashLength} ${2 * Math.PI * 40 - arc.dashLength}`"
                    :stroke-dashoffset="arc.dashOffset"
                    stroke-linecap="butt"
                    class="cursor-pointer transition-opacity duration-150"
                    :style="`transform-origin: 52px 52px; transform: rotate(-90deg); opacity: ${activeSlice && activeSlice.scope === 'source' && activeSlice.row.value !== sourceData.rows[i].value ? 0.3 : 1}`"
                    tabindex="0"
                    :aria-label="`${friendlyLabel('source', sourceData.rows[i].value)}: ${formatPct(arc.share)}`"
                    role="button"
                    @click="onSliceClick('source', sourceData.rows[i])"
                    @keydown.enter.space.prevent="onSliceClick('source', sourceData.rows[i])"
                  />
                  <text x="52" y="49" text-anchor="middle" font-size="11" font-weight="800" fill="#122815">{{ formatNum(sourceData.totalPageViews) }}</text>
                  <text x="52" y="62" text-anchor="middle" font-size="8" fill="#667768">lượt xem</text>
                </svg>
              </div>
              <ul class="flex flex-col gap-1.5 min-w-0 flex-1 list-none p-0 m-0">
                <li
                  v-for="(row, i) in sourceData.rows"
                  :key="row.value"
                  class="flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1.5 transition-colors"
                  :class="activeSlice && activeSlice.scope === 'source' && activeSlice.row.value === row.value ? 'bg-[#f0f7f1]' : 'hover:bg-[#f7fbf7]'"
                  @click="onSliceClick('source', row)"
                >
                  <span class="shrink-0 w-2.5 h-2.5 rounded-full" :style="`background:${SOURCE_COLORS[i % SOURCE_COLORS.length]}`" aria-hidden="true"></span>
                  <span class="text-[0.78rem] text-[#122815] font-semibold truncate flex-1">{{ friendlyLabel('source', row.value) }}</span>
                  <span class="text-[0.75rem] text-[#667768] font-bold shrink-0 tabular-nums">{{ formatPct(row.share) }}</span>
                </li>
              </ul>
            </div>
            <Transition name="detail-fade">
              <div
                v-if="activeSlice && activeSlice.scope === 'source'"
                class="rounded-xl bg-[#f0f7f1] border border-[#dceedd] p-3.5"
                role="region"
                :aria-label="`Chi tiết nguồn: ${friendlyLabel('source', activeSlice.row.value)}`"
              >
                <div class="flex items-center justify-between mb-2.5">
                  <span class="text-[0.82rem] font-extrabold text-[#122815]">{{ friendlyLabel('source', activeSlice.row.value) }}</span>
                  <button class="w-6 h-6 flex items-center justify-center rounded-full text-[#667768] hover:bg-[#e2ece3] text-xs cursor-pointer border-0 bg-transparent" aria-label="Đóng chi tiết" @click="activeSlice = null">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                  </button>
                </div>
                <div class="grid grid-cols-3 gap-3">
                  <div class="flex flex-col gap-0.5">
                    <span class="text-[0.62rem] text-[#667768] font-semibold uppercase tracking-wide">Lượt xem</span>
                    <span class="text-[1.15rem] font-extrabold text-[#2c6e33]">{{ formatNum(activeSlice.row.pageViews) }}</span>
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <span class="text-[0.62rem] text-[#667768] font-semibold uppercase tracking-wide">Khách</span>
                    <span class="text-[1.15rem] font-extrabold text-[#122815]">{{ formatNum(activeSlice.row.approximateUniqueVisitors) }}</span>
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <span class="text-[0.62rem] text-[#667768] font-semibold uppercase tracking-wide">Tỷ lệ</span>
                    <span class="text-[1.15rem] font-extrabold text-[#122815]">{{ formatPct(activeSlice.row.share) }}</span>
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <!-- Device class donut -->
        <div class="bg-white rounded-2xl border border-[#e2ece3] p-5">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-mobile-screen text-[#2c6e33] text-sm" aria-hidden="true"></i>
              <h2 class="text-[0.9rem] font-extrabold text-[#122815] m-0">Thiết bị truy cập</h2>
              <span class="text-[0.65rem] text-[#667768] bg-[#f4f7f4] border border-[#e2ece3] rounded-full px-2 py-0.5 font-semibold">60 phút</span>
            </div>
            <nuxt-link to="/admin/analytics" class="text-[0.72rem] font-semibold text-[#2c6e33] no-underline hover:underline">Chi tiết →</nuxt-link>
          </div>
          <div v-if="deviceLoading" class="flex items-center justify-center h-28 text-sm text-[#667768] animate-pulse" role="status">Đang tải…</div>
          <div v-else-if="deviceError" class="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-500 flex items-center gap-2">
            <i class="fa-solid fa-triangle-exclamation shrink-0" aria-hidden="true"></i> Không thể tải dữ liệu.
          </div>
          <div v-else-if="!deviceData || deviceData.rows.length === 0" class="flex flex-col items-center justify-center h-28 rounded-xl border border-dashed border-[#afc8b1] bg-[#f7fbf7] text-sm text-[#667768] gap-2">
            <i class="fa-solid fa-mobile-screen text-xl text-[#c8d6c9]" aria-hidden="true"></i>
            Chưa có dữ liệu thiết bị.
          </div>
          <div v-else class="flex flex-col gap-4">
            <div class="flex items-center gap-4">
              <div class="shrink-0">
                <svg width="110" height="110" viewBox="0 0 104 104" role="img" :aria-label="`Biểu đồ thiết bị: ${deviceData.rows.map(r => friendlyLabel('device', r.value) + ' ' + formatPct(r.share)).join(', ')}`">
                  <circle cx="52" cy="52" r="40" fill="none" stroke="#f0f7f1" stroke-width="18" />
                  <circle
                    v-for="(arc, i) in buildDonutArcs(deviceData.rows, DEVICE_COLORS)"
                    :key="i"
                    cx="52" cy="52" r="40"
                    fill="none"
                    :stroke="arc.color"
                    stroke-width="18"
                    :stroke-dasharray="`${arc.dashLength} ${2 * Math.PI * 40 - arc.dashLength}`"
                    :stroke-dashoffset="arc.dashOffset"
                    stroke-linecap="butt"
                    class="cursor-pointer transition-opacity duration-150"
                    :style="`transform-origin: 52px 52px; transform: rotate(-90deg); opacity: ${activeSlice && activeSlice.scope === 'device' && activeSlice.row.value !== deviceData.rows[i].value ? 0.3 : 1}`"
                    tabindex="0"
                    :aria-label="`${friendlyLabel('device', deviceData.rows[i].value)}: ${formatPct(arc.share)}`"
                    role="button"
                    @click="onSliceClick('device', deviceData.rows[i])"
                    @keydown.enter.space.prevent="onSliceClick('device', deviceData.rows[i])"
                  />
                  <text x="52" y="49" text-anchor="middle" font-size="11" font-weight="800" fill="#122815">{{ formatNum(deviceData.totalPageViews) }}</text>
                  <text x="52" y="62" text-anchor="middle" font-size="8" fill="#667768">lượt xem</text>
                </svg>
              </div>
              <ul class="flex flex-col gap-1.5 min-w-0 flex-1 list-none p-0 m-0">
                <li
                  v-for="(row, i) in deviceData.rows"
                  :key="row.value"
                  class="flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1.5 transition-colors"
                  :class="activeSlice && activeSlice.scope === 'device' && activeSlice.row.value === row.value ? 'bg-[#f0f7f1]' : 'hover:bg-[#f7fbf7]'"
                  @click="onSliceClick('device', row)"
                >
                  <span class="shrink-0 w-2.5 h-2.5 rounded-full" :style="`background:${DEVICE_COLORS[i % DEVICE_COLORS.length]}`" aria-hidden="true"></span>
                  <span class="text-[0.78rem] text-[#122815] font-semibold truncate flex-1">{{ friendlyLabel('device', row.value) }}</span>
                  <span class="text-[0.75rem] text-[#667768] font-bold shrink-0 tabular-nums">{{ formatPct(row.share) }}</span>
                </li>
              </ul>
            </div>
            <Transition name="detail-fade">
              <div
                v-if="activeSlice && activeSlice.scope === 'device'"
                class="rounded-xl bg-[#f0f7f1] border border-[#dceedd] p-3.5"
                role="region"
                :aria-label="`Chi tiết thiết bị: ${friendlyLabel('device', activeSlice.row.value)}`"
              >
                <div class="flex items-center justify-between mb-2.5">
                  <span class="text-[0.82rem] font-extrabold text-[#122815]">{{ friendlyLabel('device', activeSlice.row.value) }}</span>
                  <button class="w-6 h-6 flex items-center justify-center rounded-full text-[#667768] hover:bg-[#e2ece3] text-xs cursor-pointer border-0 bg-transparent" aria-label="Đóng chi tiết" @click="activeSlice = null">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                  </button>
                </div>
                <div class="grid grid-cols-3 gap-3">
                  <div class="flex flex-col gap-0.5">
                    <span class="text-[0.62rem] text-[#667768] font-semibold uppercase tracking-wide">Lượt xem</span>
                    <span class="text-[1.15rem] font-extrabold text-[#2c6e33]">{{ formatNum(activeSlice.row.pageViews) }}</span>
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <span class="text-[0.62rem] text-[#667768] font-semibold uppercase tracking-wide">Khách</span>
                    <span class="text-[1.15rem] font-extrabold text-[#122815]">{{ formatNum(activeSlice.row.approximateUniqueVisitors) }}</span>
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <span class="text-[0.62rem] text-[#667768] font-semibold uppercase tracking-wide">Tỷ lệ</span>
                    <span class="text-[1.15rem] font-extrabold text-[#122815]">{{ formatPct(activeSlice.row.share) }}</span>
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </div>

      </div>
    </template>
  </div>
</template>

<style scoped>
.detail-fade-enter-active, .detail-fade-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.detail-fade-enter-from, .detail-fade-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
