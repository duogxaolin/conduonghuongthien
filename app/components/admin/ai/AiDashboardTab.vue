<script setup lang="ts">
/**
 * Dashboard tab của AI Panel — Tổng quan chi phí + trạng thái Delify Router thời
 * gian thực. Tách khỏi `ai/index.vue` để tab tự持有 state fetch lỗi/thử-lại riêng
 * (pattern `ProfileActivityHistory.vue`).
 *
 * Phụ thuộc chéo: `testCallModel` / `syncDelifyPricing` ở Providers tab làm thay
 * đổi usage, nên cha điều phối — khi nhận `invalidate` từ Providers, cha gọi
 * `dashboardRef.value?.loadUsage()` qua `defineExpose` bên dưới.
 */
import { errorMessage } from '~/utils/errorMessage'
import {
  CHART_COLORS,
  SERVICE_LABELS,
  formatNum,
  formatVnd,
} from '~/utils/ai-service-labels'

interface UsageSummary {
  monthlyCostVnd: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalRequests: number
  successRate: number
}
interface ByServiceRow {
  serviceKey: string
  costVnd: number
  promptTokens: number
  completionTokens: number
  requests: number
}
interface DailyRow { day: string; costVnd: number; requests: number }
interface BudgetInfo { monthlyBudgetVnd: number; warningThresholdPct: number; usagePercent: number }

const usageError = ref(null as string | null)
const usageLoading = ref(false)
const usageSummary = ref<UsageSummary | null>(null)
const byService = ref<ByServiceRow[]>([])
const dailyData = ref<DailyRow[]>([])
const budgetInfo = ref<BudgetInfo | null>(null)

interface DelifyStatusResponse {
  ok: boolean
  configured: boolean
  error?: string
  keyInfo?: {
    name: string
    groupName: string
    active: boolean
    budgetUsd: number | null
    budgetVnd?: number | null
    usedCostUsd: number
    usedCostVnd?: number
    remainingBudgetUsd: number | null
    remainingBudgetVnd?: number | null
    totalRequests: number
    allowedModels: string[]
    rpm: number | null
    windowStartedAt: string | null
  }
  period: string
  periodSummary?: {
    items?: Array<{ model: string; input: number; output: number; requests: number; cost: number }>
    totals?: { input: number; output: number; requests: number; cost: number }
  } | null
  recentHistory?: Array<{ timestamp: string; model: string; status: string; cost: number; input: number; output: number; tok: number }>
  availableModels?: Array<{ name: string; input: number; output: number }>
}

const delifyPeriod = ref<'1h' | '24h' | '7d' | '30d' | 'all'>('7d')
const delifyStatus = ref<DelifyStatusResponse | null>(null)
const delifyStatusLoading = ref(false)
const delifyStatusError = ref<string | null>(null)

async function loadDelifyStatus(period: '1h' | '24h' | '7d' | '30d' | 'all' = delifyPeriod.value) {
  delifyPeriod.value = period
  delifyStatusLoading.value = true
  delifyStatusError.value = null
  try {
    const data = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<DelifyStatusResponse>)('/api/admin/ai/delify/status', {
      params: { period },
    })
    delifyStatus.value = data
    if (!data.ok && data.error) {
      delifyStatusError.value = data.error
    }
  } catch (err: unknown) {
    delifyStatusError.value = errorMessage(err, 'Không thể tải trạng thái Delify Router.')
  } finally {
    delifyStatusLoading.value = false
  }
}

const CHART_MAX_HEIGHT = 120
function chartBarHeight(cost: number): number {
  const max = Math.max(...dailyData.value.map(d => d.costVnd), 1)
  return Math.max(2, (cost / max) * CHART_MAX_HEIGHT)
}

const donutSegments = computed(() => {
  const total = byService.value.reduce((sum, s) => sum + s.costVnd, 0)
  let offset = 0
  return byService.value.map((s, i) => {
    const fraction = total > 0 ? s.costVnd / total : 0
    const dash = fraction * 251.2
    const seg = {
      color: CHART_COLORS[i % CHART_COLORS.length],
      dasharray: `${dash} ${251.2 - dash}`,
      dashoffset: -offset,
      label: SERVICE_LABELS[s.serviceKey] ?? s.serviceKey,
      costVnd: s.costVnd,
      fraction,
    }
    offset += dash
    return seg
  })
})

const effectiveBudgetVnd = computed(() => {
  if (budgetInfo.value?.monthlyBudgetVnd && budgetInfo.value.monthlyBudgetVnd > 0) {
    return budgetInfo.value.monthlyBudgetVnd
  }
  if (delifyStatus.value?.keyInfo?.budgetUsd != null) {
    return delifyStatus.value.keyInfo.budgetVnd ?? delifyStatus.value.keyInfo.budgetUsd * 25500
  }
  return 0
})

const effectiveUsedVnd = computed(() => {
  return delifyStatus.value?.keyInfo?.usedCostVnd ?? usageSummary.value?.monthlyCostVnd ?? 0
})

const effectiveUsagePercent = computed(() => {
  if (!effectiveBudgetVnd.value || effectiveBudgetVnd.value <= 0) return 0
  return (effectiveUsedVnd.value / effectiveBudgetVnd.value) * 100
})

const budgetColor = computed(() => {
  const pct = effectiveUsagePercent.value
  if (pct >= 100) return 'bg-red-500'
  if (pct >= 80) return 'bg-yellow-500'
  return 'bg-green-500'
})

async function loadUsage() {
  usageError.value = null
  usageLoading.value = true
  try {
    const data = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{
      usage: UsageSummary
      byService: ByServiceRow[]
      daily: DailyRow[]
      budget: BudgetInfo
    }>)('/api/admin/ai/usage')
    usageSummary.value = data.usage
    byService.value = data.byService
    dailyData.value = data.daily
    budgetInfo.value = data.budget
  } catch (err: unknown) {
    usageError.value = errorMessage(err, 'Không thể tải dữ liệu sử dụng.')
  } finally {
    usageLoading.value = false
  }
}

onMounted(() => {
  void loadUsage()
  void loadDelifyStatus()
})

// Cha gọi khi Providers tab test-call/sync Delify làm thay đổi usage.
defineExpose<{ loadUsage: typeof loadUsage; loadDelifyStatus: typeof loadDelifyStatus }>({
  loadUsage,
  loadDelifyStatus,
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <div v-if="usageError" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">
      <strong>Lỗi:</strong> {{ usageError }}
      <button type="button" class="font-bold underline text-brand-600 ml-2" @click="loadUsage()">Thử lại</button>
    </div>

    <div v-if="usageLoading" class="flex items-center justify-center py-12" role="status" aria-busy="true">
      <span class="sr-only">Đang tải dữ liệu tổng quan</span>
      <div class="flex gap-1.5" aria-hidden="true">
        <span class="w-2.5 h-2.5 rounded-full bg-brand-700 animate-pulse motion-reduce:animate-none"></span>
        <span class="w-2.5 h-2.5 rounded-full bg-brand-700 animate-pulse motion-reduce:animate-none" style="animation-delay: 0.15s"></span>
        <span class="w-2.5 h-2.5 rounded-full bg-brand-700 animate-pulse motion-reduce:animate-none" style="animation-delay: 0.3s"></span>
      </div>
    </div>

    <template v-if="!usageLoading && !usageError">
      <!-- KPI Cards -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-xl border border-line bg-white p-4">
          <p class="m-0 text-xs font-bold text-ink-muted uppercase tracking-wide">Chi phí tháng này</p>
          <p class="m-0 mt-2 text-2xl font-extrabold text-brand-950">{{ formatVnd(usageSummary?.monthlyCostVnd ?? 0) }}</p>
        </div>
        <div class="rounded-xl border border-line bg-white p-4">
          <p class="m-0 text-xs font-bold text-ink-muted uppercase tracking-wide">Tổng Tokens</p>
          <p class="m-0 mt-2 text-2xl font-extrabold text-brand-950">{{ formatNum((usageSummary?.totalPromptTokens ?? 0) + (usageSummary?.totalCompletionTokens ?? 0)) }}</p>
          <p class="m-0 mt-1 text-xs text-ink-muted">Input: {{ formatNum(usageSummary?.totalPromptTokens ?? 0) }} / Output: {{ formatNum(usageSummary?.totalCompletionTokens ?? 0) }}</p>
        </div>
        <div class="rounded-xl border border-line bg-white p-4">
          <p class="m-0 text-xs font-bold text-ink-muted uppercase tracking-wide">Số lượt gọi AI</p>
          <p class="m-0 mt-2 text-2xl font-extrabold text-brand-950">{{ formatNum(usageSummary?.totalRequests ?? 0) }}</p>
          <p class="m-0 mt-1 text-xs text-ink-muted">Tỉ lệ thành công: {{ (usageSummary?.successRate ?? 100).toFixed(1) }}%</p>
        </div>
        <div class="rounded-xl border border-line bg-white p-4">
          <p class="m-0 text-xs font-bold text-ink-muted uppercase tracking-wide">Hạn mức ngân sách</p>
          <p class="m-0 mt-2 text-2xl font-extrabold text-brand-950">
            {{ effectiveBudgetVnd ? formatVnd(effectiveBudgetVnd) : 'Không giới hạn' }}
          </p>
          <div v-if="effectiveBudgetVnd" class="mt-2">
            <div class="h-2 rounded-full bg-line overflow-hidden">
              <div class="h-full rounded-full transition-all" :class="budgetColor" :style="{ width: Math.min(100, effectiveUsagePercent) + '%' }"></div>
            </div>
            <p class="m-0 mt-1 text-xs text-ink-muted">{{ effectiveUsagePercent.toFixed(1) }}% (đã dùng {{ formatVnd(effectiveUsedVnd) }})</p>
          </div>
        </div>
      </div>

      <!-- Delify Router Live Observability Card (Real-time from Delify API) -->
      <div class="rounded-xl border border-line-strong bg-surface-tint p-4 sm:p-5 flex flex-col gap-4 shadow-sm">
        <!-- Card Header with Period Selector -->
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line-strong pb-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-brand-700 text-white flex items-center justify-center font-bold text-lg shadow-sm">
              <i class="fa-solid fa-cloud-bolt" aria-hidden="true"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="m-0 text-base font-extrabold text-brand-950">Trạng thái Delify Router (Thời gian thực từ API)</h2>
                <span
                  class="px-2 py-0.5 rounded-full text-xs font-bold"
                  :class="delifyStatus?.ok ? 'bg-green-100 text-green-800 border border-green-300' : 'bg-yellow-100 text-yellow-800 border border-yellow-300'"
                >
                  {{ delifyStatus?.ok ? '● Đã kết nối' : 'Chưa kết nối' }}
                </span>
              </div>
              <p class="m-0 mt-0.5 text-xs text-ink-muted flex items-center gap-2 flex-wrap">
                <span v-if="delifyStatus?.keyInfo">Key: <strong class="text-brand-950">{{ delifyStatus.keyInfo.name }}</strong> (Nhóm: {{ delifyStatus.keyInfo.groupName }})</span>
                <span>•</span>
                <span>Cập nhật trực tiếp từ <code class="text-brand-700">router.delify.vn</code></span>
              </p>
            </div>
          </div>

          <!-- Period Filter Tabs & Refresh Button -->
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-xs font-semibold text-ink-muted mr-1 hidden sm:inline">Kỳ lọc:</span>
            <button
              v-for="p in ([{ key: '1h', label: '1 Giờ' }, { key: '24h', label: '24 Giờ' }, { key: '7d', label: '7 Ngày' }, { key: '30d', label: '30 Ngày' }, { key: 'all', label: 'Tất cả' }] as const)"
              :key="p.key"
              type="button"
              class="px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer"
              :class="delifyPeriod === p.key
                ? 'bg-brand-700 text-white shadow-xs'
                : 'bg-white text-ink-muted border border-line-strong hover:bg-[#e4ece4]'"
              :disabled="delifyStatusLoading"
              @click="loadDelifyStatus(p.key)"
            >
              {{ p.label }}
            </button>

            <button
              type="button"
              class="px-2.5 py-1 rounded-md bg-white border border-line-strong text-xs font-bold text-brand-700 hover:bg-[#e4ece4] ml-1 flex items-center gap-1"
              :disabled="delifyStatusLoading"
              title="Làm mới dữ liệu từ Delify Router"
              @click="loadDelifyStatus()"
            >
              <i class="fa-solid fa-rotate text-[0.7rem]" :class="delifyStatusLoading ? 'animate-spin' : ''" aria-hidden="true"></i>
              <span class="hidden sm:inline">Làm mới</span>
            </button>
          </div>
        </div>

        <div v-if="delifyStatusLoading" class="py-6 text-center text-xs text-ink-muted" role="status" aria-busy="true">
          <span class="inline-block w-4 h-4 rounded-full border-2 border-brand-700 border-t-transparent animate-spin mr-2"></span>
          Đang tải dữ liệu thời gian thực từ router.delify.vn...
        </div>

        <div v-else-if="delifyStatusError" class="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700" role="alert">
          <i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>
          {{ delifyStatusError }}
        </div>

        <template v-else-if="delifyStatus?.ok && delifyStatus.keyInfo">
          <!-- 4 Financial Metric Cards -->
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <!-- 1. Ngân sách được cấp -->
            <div class="rounded-xl bg-white p-3.5 border border-line shadow-xs">
              <p class="m-0 text-xs font-bold text-ink-muted uppercase">Ngân sách được cấp</p>
              <p class="m-0 mt-1 text-xl font-extrabold text-brand-950">
                {{ delifyStatus.keyInfo.budgetUsd != null ? '$' + delifyStatus.keyInfo.budgetUsd.toFixed(2) : 'Không giới hạn' }}
              </p>
              <p class="m-0 mt-0.5 text-xs text-ink-muted">
                ~{{ formatVnd((delifyStatus.keyInfo.budgetUsd ?? 0) * 25500) }}
              </p>
            </div>

            <!-- 2. Số tiền đã dùng -->
            <div class="rounded-xl bg-white p-3.5 border border-line shadow-xs">
              <p class="m-0 text-xs font-bold text-ink-muted uppercase">Tiền hiện tại đã dùng</p>
              <p class="m-0 mt-1 text-xl font-extrabold text-danger">
                {{ formatVnd(delifyStatus.keyInfo.usedCostVnd ?? ((delifyStatus.keyInfo.usedCostUsd ?? 0) * 25500)) }}
              </p>
              <p class="m-0 mt-0.5 text-xs text-ink-muted">
                ~${{ (delifyStatus.keyInfo.usedCostUsd ?? 0).toFixed(4) }} ({{ delifyStatus.keyInfo.totalRequests }} cuộc gọi)
              </p>
            </div>

            <!-- 3. SỐ TIỀN CÒN LẠI (Remaining Balance) -->
            <div class="rounded-xl bg-white p-3.5 border border-line-strong bg-gradient-to-br from-white to-surface-tint shadow-xs ring-1 ring-brand-700/20">
              <div class="flex items-center justify-between">
                <p class="m-0 text-xs font-bold text-brand-700 uppercase tracking-wide">Số tiền CÒN LẠI</p>
                <i class="fa-solid fa-wallet text-brand-700 text-xs" aria-hidden="true"></i>
              </div>
              <p class="m-0 mt-1 text-2xl font-extrabold text-brand-700">
                {{ delifyStatus.keyInfo.remainingBudgetVnd != null ? formatVnd(delifyStatus.keyInfo.remainingBudgetVnd) : (delifyStatus.keyInfo.remainingBudgetUsd != null ? '$' + delifyStatus.keyInfo.remainingBudgetUsd.toFixed(4) : '—') }}
              </p>
              <p class="m-0 mt-0.5 text-xs font-bold text-brand-950">
                {{ delifyStatus.keyInfo.remainingBudgetUsd != null ? '$' + delifyStatus.keyInfo.remainingBudgetUsd.toFixed(4) : '—' }}
              </p>
            </div>

            <!-- 4. Chi phí trong kỳ đã lọc -->
            <div class="rounded-xl bg-white p-3.5 border border-line shadow-xs">
              <div class="flex items-center justify-between">
                <p class="m-0 text-xs font-bold text-ink-muted uppercase">Trong kỳ ({{ delifyPeriod }})</p>
                <span class="text-[0.65rem] px-1.5 py-0.5 bg-[#e4f0e2] text-brand-700 font-bold rounded">API Receipts</span>
              </div>
              <p class="m-0 mt-1 text-xl font-extrabold text-brand-950">
                ${{ (delifyStatus.periodSummary?.totals?.cost ?? 0).toFixed(4) }}
              </p>
              <p class="m-0 mt-0.5 text-xs text-ink-muted">
                {{ delifyStatus.periodSummary?.totals?.requests ?? 0 }} requests • {{ formatNum(delifyStatus.periodSummary?.totals?.input ?? 0) }} in / {{ formatNum(delifyStatus.periodSummary?.totals?.output ?? 0) }} out
              </p>
            </div>
          </div>

        </template>
      </div>
      <!-- Charts -->
      <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <!-- Daily cost bar chart -->
        <div class="rounded-xl border border-line bg-white p-4">
          <h2 class="m-0 mb-4 text-sm font-bold text-brand-950">Chi phí theo ngày (30 ngày gần nhất)</h2>
          <div v-if="dailyData.length === 0" class="py-8 text-center text-sm text-ink-muted">Chưa có dữ liệu.</div>
          <div v-else class="flex items-end gap-1 h-[140px] border-b border-line pb-1">
            <div
              v-for="row in dailyData"
              :key="row.day"
              class="flex-1 min-w-[3px] rounded-t-sm bg-brand-700 hover:bg-brand-600 transition-colors"
              :style="{ height: chartBarHeight(row.costVnd) + 'px' }"
              :title="`${row.day}: ${formatVnd(row.costVnd)}`"
            ></div>
          </div>
        </div>

        <!-- Cost by service donut -->
        <div class="rounded-xl border border-line bg-white p-4">
          <h2 class="m-0 mb-4 text-sm font-bold text-brand-950">Chi phí theo dịch vụ</h2>
          <div v-if="byService.length === 0" class="py-8 text-center text-sm text-ink-muted">Chưa có dữ liệu.</div>
          <div v-else class="flex items-center gap-6">
            <svg viewBox="0 0 100 100" class="w-[140px] h-[140px] -rotate-90 shrink-0">
              <circle cx="50" cy="50" r="40" fill="none" stroke="#e2ece3" stroke-width="14" />
              <circle
                v-for="(seg, i) in donutSegments"
                :key="i"
                cx="50"
                cy="50"
                r="40"
                fill="none"
                :stroke="seg.color"
                stroke-width="14"
                :stroke-dasharray="seg.dasharray"
                :stroke-dashoffset="seg.dashoffset"
              />
            </svg>
            <ul class="flex-1 flex flex-col gap-2 m-0 p-0 list-none">
              <li v-for="(seg, i) in donutSegments" :key="i" class="flex items-center gap-2 text-xs">
                <span class="w-3 h-3 rounded-sm shrink-0" :style="{ background: seg.color }"></span>
                <span class="font-semibold text-brand-950">{{ seg.label }}</span>
                <span class="ml-auto text-ink-muted">{{ (seg.fraction * 100).toFixed(1) }}%</span>
                <span class="text-ink-muted">{{ formatVnd(seg.costVnd) }}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
