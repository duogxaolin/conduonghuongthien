<script setup lang="ts">
/**
 * Logs tab của AI Panel — Nhật ký cuộc gọi AI với filter + phân trang. Tách khỏi
 * `ai/index.vue` để tab tự持有 fetch lỗi/thử-lại riêng.
 *
 * Phụ thuộc chéo: nhận prop `providers` từ cha (cha lấy từ Providers tab) để vẽ
 * filter nhà cung cấp — không tự fetch providers để không gọi hai lần khi 2 tab
 * cùng mở. Khi Providers test-call/sync thổi cache nhật ký, cha gọi
 * `logsRef.value?.clearLogs()` qua `defineExpose` bên dưới.
 */
import { errorMessage } from '~/utils/errorMessage'
import { SERVICE_LABELS, formatNum, formatTime, formatVnd, type ProviderOption } from '~/utils/ai-service-labels'

interface LogRow {
  id: number
  serviceKey: string
  provider: string
  model: string | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: string
  costVnd: string
  executionMs: number
  userId: number | null
  success: boolean
  errorMessage: string | null
  createdAt: string | null
}

const props = defineProps<{ providers: ProviderOption[] }>()

const logsError = ref(null as string | null)
const logsLoading = ref(false)
const logs = ref<LogRow[]>([])
const logsPagination = ref({ page: 1, perPage: 20, total: 0, totalPages: 0 })
const logsFilters = ref({ serviceKey: '', provider: '', startDate: '', endDate: '', success: '' })
const expandedRows = ref<Set<number>>(new Set())

function toggleRowExpand(id: number) {
  if (expandedRows.value.has(id)) expandedRows.value.delete(id)
  else expandedRows.value.add(id)
}

async function loadLogs() {
  logsError.value = null
  logsLoading.value = true
  try {
    const params: Record<string, string> = { page: String(logsPagination.value.page), perPage: String(logsPagination.value.perPage) }
    if (logsFilters.value.serviceKey) params.serviceKey = logsFilters.value.serviceKey
    if (logsFilters.value.provider) params.provider = logsFilters.value.provider
    if (logsFilters.value.startDate) params.startDate = logsFilters.value.startDate
    if (logsFilters.value.endDate) params.endDate = logsFilters.value.endDate
    if (logsFilters.value.success) params.success = logsFilters.value.success

    const data = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ logs: LogRow[]; pagination: { page: number; perPage: number; total: number; totalPages: number } }>)('/api/admin/ai/logs', { params })
    logs.value = data.logs
    logsPagination.value = data.pagination
  } catch (err: unknown) {
    logsError.value = errorMessage(err, 'Không thể tải nhật ký.')
  } finally {
    logsLoading.value = false
  }
}

function applyFilters() {
  logsPagination.value.page = 1
  expandedRows.value = new Set()
  void loadLogs()
}

function goToPage(page: number) {
  logsPagination.value.page = page
  void loadLogs()
}

// Providers test-call/sync xoá cache nhật ký để nhật ký cũ không kẹt lại.
function clearLogs() {
  logs.value = []
}

// Tự fetch khi mount — không phụ thuộc watch(activeTab) ở cha (ref assign sau patch).
onMounted(() => { void loadLogs() })

// Cha gọi khi tab được lazy-load lần đầu, và khi Providers invalidate.
defineExpose<{ loadLogs: typeof loadLogs; clearLogs: typeof clearLogs }>({
  loadLogs,
  clearLogs,
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <div v-if="logsError" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">
      <strong>Lỗi:</strong> {{ logsError }}
      <button type="button" class="font-bold underline text-brand-600 ml-2" @click="loadLogs()">Thử lại</button>
    </div>

    <!-- Filters -->
    <div class="rounded-xl border border-line bg-white p-4">
      <div class="flex flex-wrap gap-3 items-end">
        <label class="flex flex-col gap-1 text-xs font-semibold">
          <span class="text-ink-muted">Dịch vụ</span>
          <select v-model="logsFilters.serviceKey" class="rounded-lg border border-[#d0ddd1] px-3 py-1.5 text-sm bg-white">
            <option value="">Tất cả</option>
            <option v-for="key in Object.keys(SERVICE_LABELS)" :key="key" :value="key">{{ SERVICE_LABELS[key] }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-xs font-semibold">
          <span class="text-ink-muted">Nhà cung cấp</span>
          <select v-model="logsFilters.provider" class="rounded-lg border border-[#d0ddd1] px-3 py-1.5 text-sm bg-white">
            <option value="">Tất cả</option>
            <option v-for="p in props.providers" :key="p.provider" :value="p.provider">{{ p.label }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-xs font-semibold">
          <span class="text-ink-muted">Từ ngày</span>
          <input v-model="logsFilters.startDate" type="date" class="rounded-lg border border-[#d0ddd1] px-3 py-1.5 text-sm" />
        </label>
        <label class="flex flex-col gap-1 text-xs font-semibold">
          <span class="text-ink-muted">Đến ngày</span>
          <input v-model="logsFilters.endDate" type="date" class="rounded-lg border border-[#d0ddd1] px-3 py-1.5 text-sm" />
        </label>
        <label class="flex flex-col gap-1 text-xs font-semibold">
          <span class="text-ink-muted">Trạng thái</span>
          <select v-model="logsFilters.success" class="rounded-lg border border-[#d0ddd1] px-3 py-1.5 text-sm bg-white">
            <option value="">Tất cả</option>
            <option value="true">Thành công</option>
            <option value="false">Lỗi</option>
          </select>
        </label>
        <button type="button" class="px-4 py-1.5 rounded-lg bg-brand-700 text-white text-sm font-semibold hover:bg-brand-900" @click="applyFilters">Lọc</button>
      </div>
      <p class="m-0 mt-3 text-xs text-ink-muted">Chỉ hiển thị nhật ký 90 ngày gần nhất.</p>
    </div>

    <div v-if="logsLoading" class="flex items-center justify-center py-12" role="status" aria-busy="true">
      <span class="sr-only">Đang tải nhật ký</span>
      <div class="flex gap-1.5" aria-hidden="true">
        <span class="w-2.5 h-2.5 rounded-full bg-brand-700 animate-pulse motion-reduce:animate-none"></span>
        <span class="w-2.5 h-2.5 rounded-full bg-brand-700 animate-pulse motion-reduce:animate-none" style="animation-delay: 0.15s"></span>
        <span class="w-2.5 h-2.5 rounded-full bg-brand-700 animate-pulse motion-reduce:animate-none" style="animation-delay: 0.3s"></span>
      </div>
    </div>

    <template v-if="!logsLoading && !logsError">
      <div v-if="logs.length === 0" class="rounded-xl border border-line bg-white p-8 text-center text-sm text-ink-muted">
        Chưa có nhật ký nào.
      </div>
      <div v-else class="rounded-xl border border-line bg-white overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-[#f4f7f4] text-left">
            <tr>
              <th class="px-3 py-3 font-bold text-brand-950">Thời gian</th>
              <th class="px-3 py-3 font-bold text-brand-950">Dịch vụ</th>
              <th class="px-3 py-3 font-bold text-brand-950">Nhà cung cấp</th>
              <th class="px-3 py-3 font-bold text-brand-950">Model</th>
              <th class="px-3 py-3 font-bold text-brand-950 text-right">Input</th>
              <th class="px-3 py-3 font-bold text-brand-950 text-right">Output</th>
              <th class="px-3 py-3 font-bold text-brand-950 text-right">Chi phí</th>
              <th class="px-3 py-3 font-bold text-brand-950 text-right">Thời gian</th>
              <th class="px-3 py-3 font-bold text-brand-950">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="log in logs" :key="log.id">
              <tr
                class="border-t border-line cursor-pointer hover:bg-[#f4f7f4]"
                :class="!log.success ? 'bg-red-50/50' : ''"
                @click="!log.success && toggleRowExpand(log.id)"
              >
                <td class="px-3 py-2.5 text-xs text-ink-muted whitespace-nowrap">{{ formatTime(log.createdAt) }}</td>
                <td class="px-3 py-2.5 font-semibold text-brand-950">{{ SERVICE_LABELS[log.serviceKey] ?? log.serviceKey }}</td>
                <td class="px-3 py-2.5 text-ink-muted">{{ log.provider }}</td>
                <td class="px-3 py-2.5 text-brand-950 font-mono">{{ log.model ?? '—' }}</td>
                <td class="px-3 py-2.5 text-right text-ink-muted">{{ formatNum(log.promptTokens) }}</td>
                <td class="px-3 py-2.5 text-right text-ink-muted">{{ formatNum(log.completionTokens) }}</td>
                <td class="px-3 py-2.5 text-right text-brand-700 font-mono font-bold whitespace-nowrap">{{ formatVnd(Number(log.costVnd)) }}</td>
                <td class="px-3 py-2.5 text-right text-ink-muted">{{ log.executionMs }}ms</td>
                <td class="px-3 py-2.5">
                  <span :class="log.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'" class="px-2 py-0.5 rounded-full text-xs font-semibold">
                    {{ log.success ? 'OK' : 'Lỗi' }}
                  </span>
                </td>
              </tr>
              <tr v-if="!log.success && expandedRows.has(log.id)" class="border-t border-line bg-red-50/30">
                <td colspan="9" class="px-3 py-3">
                  <div class="rounded-lg bg-red-50 p-3 text-xs text-red-700 font-mono">{{ log.errorMessage ?? 'Không có chi tiết lỗi.' }}</div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <AdminPagination
        v-if="logsPagination.totalPages > 1"
        :page="logsPagination.page"
        :total-pages="logsPagination.totalPages"
        :total="logsPagination.total"
        item-label="bản ghi"
        @update:page="goToPage"
      />
    </template>
  </div>
</template>
