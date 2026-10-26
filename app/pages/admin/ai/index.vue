<script setup lang="ts">
/**
 * AI Panel — orchestrator. Tách 5 tab thành 5 component con (pattern
 * `default.vue` 1301→382 + 7 component `Default*.vue`):
 *
 *  - `components/admin/ai/AiDashboardTab.vue` — tổng quan chi phí + Delify status
 *  - `components/admin/ai/AiProvidersTab.vue` — nhà cung cấp + model + giá (9Router)
 *  - `components/admin/ai/AiServicesTab.vue` — phân bổ model + prompt dịch vụ
 *  - `components/admin/ai/AiModerationTab.vue` — CHỈ tóm tắt (số hàng chờ + số quy tắc
 *    đang bật) + liên kết; quản lý quy tắc/hàng đối soát chỉ ở `/admin/ai/moderation` (D10)
 *  - `components/admin/ai/AiLogsTab.vue` — nhật ký cuộc gọi
 *
 * Cha chỉ giữ: `activeTab`, cấu hình tab nav, lazy-load wiring, và forward
 * sự kiện `invalidate` từ Providers/Services xuống Dashboard.loadUsage + Logs.clearLogs.
 * `providers` + `pricingRows` (ref của Providers tab) được truyền prop xuống Services +
 * Logs qua `watchEffect` đọc expose của `providersRef`. Khi Providers chưa mount (v-if
 * loại nó khỏi DOM), `ensureProvidersLoaded()` tự fetch fallback để 2 tab vẫn có filter.
 *
 * Hằng số dùng chung (SERVICE_LABELS, PROVIDER_PRESETS, RULE_CATEGORY_LABELS,
 * formatVnd/formatNum/formatTime) đã tách ra `app/utils/ai-service-labels.ts`.
 */
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

import type { ProviderOption, PricingRow } from '~/utils/ai-service-labels'
import AiDashboardTab from '~/components/admin/ai/AiDashboardTab.vue'
import AiProvidersTab from '~/components/admin/ai/AiProvidersTab.vue'
import AiServicesTab from '~/components/admin/ai/AiServicesTab.vue'
import AiModerationTab from '~/components/admin/ai/AiModerationTab.vue'
import AiLogsTab from '~/components/admin/ai/AiLogsTab.vue'

type Tab = 'dashboard' | 'providers' | 'services' | 'moderation' | 'logs'
const activeTab = ref<Tab>('dashboard')

const tabs: Array<{ key: Tab; label: string; icon: string }> = [
  { key: 'dashboard', label: 'Tổng quan', icon: 'fa-solid fa-chart-pie' },
  { key: 'providers', label: 'Nhà cung cấp & Models', icon: 'fa-solid fa-plug' },
  { key: 'services', label: 'Prompt dịch vụ', icon: 'fa-solid fa-comment-code' },
  { key: 'moderation', label: '🛡️ Kiểm duyệt An ninh', icon: 'fa-solid fa-shield-halved' },
  { key: 'logs', label: 'Nhật ký gọi', icon: 'fa-solid fa-list-check' },
]

// ── Refs xuống 5 component con ─────────────────────────────────────────
const dashboardRef = ref<{ loadUsage: () => Promise<void>; loadDelifyStatus: (p?: '1h' | '24h' | '7d' | '30d' | 'all') => Promise<void> } | null>(null)
const providersRef = ref<{ loadProviders: () => Promise<void>; providers: ProviderOption[]; pricingRows: PricingRow[] } | null>(null)
const servicesRef = ref<{ loadServices: () => Promise<void> } | null>(null)
const moderationRef = ref<{ loadModeration: () => Promise<void> } | null>(null)
const logsRef = ref<{ loadLogs: () => Promise<void>; clearLogs: () => void } | null>(null)

// ── Prop bridge: Providers là source of providers + pricingRows. Services +
// Logs cần hai danh sách này. Cha giữ hai ref đồng bộ từ expose của Providers
// thay vì Mobility qua store — ít magic, dễ trace.
const providers = ref<ProviderOption[]>([])
const pricingRows = ref<PricingRow[]>([])

watchEffect(() => {
  if (providersRef.value) {
    providers.value = providersRef.value.providers
    pricingRows.value = providersRef.value.pricingRows
  }
})

// ── Forward `invalidate` từ Providers/Services xuống Dashboard + Logs ────
// testCallModel / syncDelifyPricing / testService làm thay đổi usage + logs;
// cha điều phối而不是 hai con tự ghi chéo.
function handleInvalidate() {
  void dashboardRef.value?.loadUsage()
  logsRef.value?.clearLogs()
}

// ── Lazy-load tab data on first switch ───────────────────────────────
// Khi sang Services/Logs mà Providers chưa mount (v-if loại nó khỏi DOM),
// providersRef là null → providers/pricingRows rỗng → filter dropdown trống.
// Cha tự fetch fallback để 2 tab vẫn có danh sách nhà cung cấp + model.
async function ensureProvidersLoaded() {
  if (providers.value.length > 0) return
  try {
    const [pData, prData] = await Promise.all([
      ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ providers: ProviderOption[] }>)('/api/admin/ai/providers'),
      ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ pricing: PricingRow[] }>)('/api/admin/ai/pricing'),
    ])
    providers.value = pData.providers
    pricingRows.value = prData.pricing
  } catch { /* Providers tab sẽ thử lại khi user sang đó */ }
}

watch(activeTab, (tab) => {
  if (tab === 'providers') void providersRef.value?.loadProviders()
  if (tab === 'services') {
    void ensureProvidersLoaded()
    void servicesRef.value?.loadServices()
  }
  if (tab === 'moderation') void moderationRef.value?.loadModeration()
  if (tab === 'logs') {
    void ensureProvidersLoaded()
    void logsRef.value?.loadLogs()
  }
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-col gap-1">
      <h1 class="m-0 text-[1.3rem] font-extrabold text-brand-950">AI Panel</h1>
      <p class="m-0 mt-1 text-sm text-ink-muted">Quản lý nhà cung cấp AI, phân bổ model, prompt dịch vụ và theo dõi chi phí tập trung kiểu 9Router.</p>
    </header>

    <!-- Tab navigation -->
    <nav class="flex flex-wrap gap-1 border-b border-line">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer bg-transparent"
        :class="activeTab === tab.key
          ? 'border-brand-700 text-brand-700'
          : 'border-transparent text-ink-muted hover:text-brand-700'"
        @click="activeTab = tab.key"
      >
        <i :class="tab.icon" class="text-[0.9rem]"></i>
        {{ tab.label }}
      </button>
    </nav>

    <!-- Dashboard Tab -->
    <AiDashboardTab v-if="activeTab === 'dashboard'" ref="dashboardRef" />

    <!-- Providers Tab -->
    <AiProvidersTab
      v-else-if="activeTab === 'providers'"
      ref="providersRef"
      @invalidate="handleInvalidate"
    />

    <!-- Services Tab — nhận providers + pricingRows từ Providers qua cha -->
    <AiServicesTab
      v-else-if="activeTab === 'services'"
      ref="servicesRef"
      :providers="providers"
      :pricing-rows="pricingRows"
      @invalidate="handleInvalidate"
    />

    <!-- Moderation Tab -->
    <AiModerationTab v-else-if="activeTab === 'moderation'" ref="moderationRef" />

    <!-- Logs Tab — nhận providers từ Providers qua cha (cho filter dropdown) -->
    <AiLogsTab v-else-if="activeTab === 'logs'" ref="logsRef" :providers="providers" />
  </div>
</template>
