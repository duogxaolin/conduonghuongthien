<script setup lang="ts">
/**
 * Services tab của AI Panel — Phân bổ model + system prompt cho từng dịch vụ
 * (chatbot / translation / editorial / moderation). Tách khỏi `ai/index.vue`.
 *
 * Phụ thuộc chéo: nhận prop `providers` + `pricingRows` từ cha (cha lấy từ
 * Providers tab) để vẽ filter nhà cung cấp đang hoạt động + danh sách model đang
 * bật. Khi testService làm thay đổi usage, emit `invalidate` lên cha để cha forward
 * xuống Dashboard loadUsage + Logs clearLogs.
 */
import { errorMessage } from '~/utils/errorMessage'
import { formatTime, formatVnd, type ProviderOption, type PricingRow } from '~/utils/ai-service-labels'
import AdminModal from '~/components/admin/AdminModal.vue'

interface ServiceRow {
  id: number
  serviceKey: string
  serviceName: string
  provider: string
  model: string | null
  systemPrompt: string | null
  defaultSystemPrompt: string
  temperature: string
  maxTokens: number
  isActive: boolean
  updatedAt: string | null
}

const props = defineProps<{
  providers: ProviderOption[]
  pricingRows: PricingRow[]
}>()

const emit = defineEmits<{ invalidate: [] }>()

const toast = useToast()

const servicesError = ref(null as string | null)
const servicesLoading = ref(false)
const services = ref<ServiceRow[]>([])
const editingService = ref<ServiceRow | null>(null)
const serviceForm = ref({ model: '', systemPrompt: '', temperature: '0.30', maxTokens: 4096, isActive: false, provider: '' })
const savingService = ref(false)
const testingService = ref(false)
const serviceTestResult = ref<string | null>(null)

const TEMPLATE_HINTS: Record<string, string[]> = {
  chatbot: ['{{question}}', '{{references}}', '{{fallback_message}}'],
  translation_article: ['{{source_text}}', '{{target_language}}', '{{source_language}}'],
  translation_ui: ['{{source_text}}', '{{target_language}}'],
  editorial_assistant: ['{{article_title}}', '{{article_content}}'],
  moderation: ['{{content}}', '{{author}}'],
}

// Active models for currently selected provider in the service form. Sử dụng
// `props.pricingRows` (cha truyền) — Services không tự fetch pricing để không gọi
// hai lần khi Providers cũng mở.
const activeModelsForSelectedProvider = computed(() => {
  return props.pricingRows.filter(m => m.provider === serviceForm.value.provider && m.isActive)
})

async function loadServices() {
  servicesError.value = null
  servicesLoading.value = true
  try {
    // Chỉ fetch services — pricingRows do cha truyền qua prop (cha lấy từ
    // Providers tab), Services không tự fetch pricing để không gọi hai lần khi
    // hai tab cùng mở.
    const data = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ services: ServiceRow[] }>)('/api/admin/ai/services')
    services.value = data.services
  } catch (err: unknown) {
    servicesError.value = errorMessage(err, 'Không thể tải danh sách dịch vụ.')
  } finally {
    servicesLoading.value = false
  }
}

function openServiceEdit(s: ServiceRow) {
  editingService.value = s
  serviceForm.value = {
    model: s.model ?? '',
    systemPrompt: s.systemPrompt ?? '',
    temperature: s.temperature,
    maxTokens: s.maxTokens,
    isActive: s.isActive,
    provider: s.provider,
  }
  serviceTestResult.value = null
}

function restoreDefaultServicePrompt() {
  if (!editingService.value?.defaultSystemPrompt) return
  serviceForm.value.systemPrompt = editingService.value.defaultSystemPrompt
  toast.info('Đã khôi phục prompt mặc định — nhớ bấm Lưu để áp dụng')
}

async function saveService() {
  if (!editingService.value) return
  savingService.value = true
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/ai/services/${editingService.value.id}`, {
      method: 'PUT',
      body: {
        model: serviceForm.value.model || null,
        systemPrompt: serviceForm.value.systemPrompt || null,
        provider: serviceForm.value.provider,
        temperature: serviceForm.value.temperature,
        maxTokens: serviceForm.value.maxTokens,
        isActive: serviceForm.value.isActive,
      },
    })
    toast.success('Đã lưu cấu hình dịch vụ.')
    editingService.value = null
    await loadServices()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể lưu dịch vụ.'))
  } finally {
    savingService.value = false
  }
}

async function testService() {
  if (!editingService.value) return
  if (!serviceForm.value.model.trim()) {
    serviceTestResult.value = 'Thất bại: Vui lòng chọn hoặc nhập mã model cần kiểm tra.'
    return
  }
  testingService.value = true
  serviceTestResult.value = null
  try {
    const result = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{
      ok: boolean
      model?: string
      reply?: string
      durationMs?: number
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
      costVnd?: number
      error?: string
    }>)(`/api/admin/ai/test-call`, {
      method: 'POST',
      body: {
        provider: serviceForm.value.provider,
        model: serviceForm.value.model.trim(),
        serviceKey: editingService.value.serviceKey,
        systemPrompt: serviceForm.value.systemPrompt || null,
        message: 'Xin chào! Hãy giới thiệu bạn là ai trong 1 câu ngắn.',
        temperature: Number(serviceForm.value.temperature) || 0.3,
        maxTokens: 150,
      },
    })
    emit('invalidate')
    if (result.ok) {
      serviceTestResult.value = `Thành công (${result.model} — ${result.durationMs}ms):\n"${result.reply}"\n[${result.usage?.totalTokens ?? 0} tokens ~ ${formatVnd(result.costVnd ?? 0)}]`
    } else {
      serviceTestResult.value = `Thất bại: ${result.error ?? 'Lỗi không rõ từ model'}`
    }
  } catch (err: unknown) {
    serviceTestResult.value = `Thất bại: ${errorMessage(err, 'Lỗi kết nối tới API')}`
  } finally {
    testingService.value = false
  }
}

// Tự fetch khi mount — không phụ thuộc watch(activeTab) ở cha (ref assign sau patch).
onMounted(() => { void loadServices() })

// Cha gọi khi tab được lazy-load.
defineExpose<{ loadServices: typeof loadServices }>({ loadServices })
</script>

<template>
  <div class="flex flex-col gap-5">
    <div v-if="servicesError" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">
      <strong>Lỗi:</strong> {{ servicesError }}
      <button type="button" class="font-bold underline text-brand-600 ml-2" @click="loadServices()">Thử lại</button>
    </div>

    <div v-if="servicesLoading" class="flex items-center justify-center py-12" role="status" aria-busy="true">
      <span class="sr-only">Đang tải danh sách dịch vụ</span>
      <div class="flex gap-1.5" aria-hidden="true">
        <span class="w-2.5 h-2.5 rounded-full bg-brand-700 animate-pulse motion-reduce:animate-none"></span>
        <span class="w-2.5 h-2.5 rounded-full bg-brand-700 animate-pulse motion-reduce:animate-none" style="animation-delay: 0.15s"></span>
        <span class="w-2.5 h-2.5 rounded-full bg-brand-700 animate-pulse motion-reduce:animate-none" style="animation-delay: 0.3s"></span>
      </div>
    </div>

    <template v-if="!servicesLoading && !servicesError">
      <div class="rounded-xl border border-line bg-white overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-surface text-left">
            <tr>
              <th class="px-4 py-3 font-bold text-brand-950">Dịch vụ</th>
              <th class="px-4 py-3 font-bold text-brand-950">Nhà cung cấp</th>
              <th class="px-4 py-3 font-bold text-brand-950">Model đang dùng</th>
              <th class="px-4 py-3 font-bold text-brand-950">Trạng thái</th>
              <th class="px-4 py-3 font-bold text-brand-950">Cập nhật</th>
              <th class="px-4 py-3 font-bold text-brand-950"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in services" :key="s.id" class="border-t border-line">
              <td class="px-4 py-3 font-semibold text-brand-950">{{ s.serviceName }}</td>
              <td class="px-4 py-3 text-brand-700 font-semibold">{{ s.provider }}</td>
              <td class="px-4 py-3 text-brand-950 font-mono">{{ s.model ?? '—' }}</td>
              <td class="px-4 py-3">
                <span :class="s.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'" class="px-2 py-0.5 rounded-full text-xs font-semibold">
                  {{ s.isActive ? 'Bật' : 'Tắt' }}
                </span>
              </td>
              <td class="px-4 py-3 text-ink-muted text-xs">{{ formatTime(s.updatedAt) }}</td>
              <td class="px-4 py-3">
                <button type="button" class="text-brand-700 font-semibold text-xs hover:underline" @click="openServiceEdit(s)">Cấu hình</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Edit Service Modal -->
      <AdminModal
        :open="!!editingService"
        :title="`Cấu hình: ${editingService?.serviceName ?? ''}`"
        size="lg"
        :busy="savingService"
        @close="editingService = null"
      >
        <div v-if="editingService" class="flex flex-col gap-4">

          <!-- 1. Chọn Nhà cung cấp -->
          <label class="flex flex-col gap-1.5 text-sm font-bold">
            <span class="text-brand-950">Nhà cung cấp (Provider)</span>
            <select v-model="serviceForm.provider" class="rounded-lg border border-line-strong px-3 py-2 text-sm bg-white">
              <option v-for="p in props.providers.filter(pr => pr.isActive)" :key="p.provider" :value="p.provider">
                {{ p.label }} ({{ p.provider }})
              </option>
              <option v-if="!props.providers.some(pr => pr.provider === serviceForm.provider && pr.isActive)" :value="serviceForm.provider">
                {{ serviceForm.provider }}
              </option>
            </select>
            <span class="text-xs text-ink-muted font-normal">Chỉ hiển thị nhà cung cấp đang hoạt động.</span>
          </label>

          <!-- 2. Chọn Model (Lọc theo NCC đã chọn - 9Router style) -->
          <div class="flex flex-col gap-1.5 text-sm font-bold">
            <div class="flex items-center justify-between">
              <span class="text-brand-950">Model sử dụng</span>
              <span class="text-xs text-ink-muted font-normal">
                Chỉ hiển thị model <strong>đang bật</strong> của {{ serviceForm.provider }}
              </span>
            </div>
            <div class="flex flex-col gap-2">
              <select v-if="activeModelsForSelectedProvider.length > 0" v-model="serviceForm.model" class="rounded-lg border border-line-strong px-3 py-2 text-sm bg-white">
                <option value="">— Chọn model đang bật —</option>
                <option v-for="m in activeModelsForSelectedProvider" :key="m.model" :value="m.model">
                  {{ m.model }} {{ m.label ? `(${m.label})` : '' }} — ${{ m.promptCostPerMillion }} in / ${{ m.completionCostPerMillion }} out
                </option>
              </select>
              <div v-else class="rounded-lg border border-dashed border-line-strong p-3 text-xs text-[#a32924] bg-red-50/50">
                Chưa có model nào được bật cho nhà cung cấp này. Vui lòng vào tab <strong>"Nhà cung cấp & Models"</strong> để bật ít nhất 1 model.
              </div>
              <input
                v-model="serviceForm.model"
                type="text"
                placeholder="Hoặc nhập thủ công mã model khác..."
                class="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-mono"
              />
            </div>
          </div>

          <!-- 3. System Prompt -->
          <div class="flex flex-col gap-1.5 text-sm font-bold">
            <div class="flex items-center justify-between">
              <span class="text-brand-950">System Prompt</span>
              <button
                v-if="editingService.defaultSystemPrompt"
                type="button"
                class="px-3 py-1.5 rounded-lg border border-line-strong bg-white text-xs font-semibold text-brand-950 hover:bg-surface-tint transition-colors cursor-pointer"
                @click="restoreDefaultServicePrompt"
              >
                <i class="fa-solid fa-rotate-left mr-1" aria-hidden="true"></i> Khôi phục mặc định
              </button>
            </div>
            <textarea v-model="serviceForm.systemPrompt" rows="7" class="rounded-lg border border-line-strong px-3 py-2 text-sm font-mono resize-y" placeholder="Nhập system prompt..."></textarea>
          </div>
          <div v-if="TEMPLATE_HINTS[editingService.serviceKey]" class="flex flex-col gap-1 text-xs text-ink-muted">
            <span class="font-bold">Biến template có sẵn:</span>
            <div class="flex flex-wrap gap-1">
              <code v-for="hint in TEMPLATE_HINTS[editingService.serviceKey]" :key="hint" class="px-2 py-0.5 rounded bg-surface text-brand-700">{{ hint }}</code>
            </div>
          </div>

          <!-- 4. Parameters -->
          <div class="grid grid-cols-2 gap-4">
            <label class="flex flex-col gap-1.5 text-sm font-bold">
              <span class="text-brand-950">Temperature: {{ serviceForm.temperature }}</span>
              <input v-model="serviceForm.temperature" type="range" min="0" max="2" step="0.01" class="accent-brand-700" />
            </label>
            <label class="flex flex-col gap-1.5 text-sm font-bold">
              <span class="text-brand-950">Max Tokens</span>
              <input v-model.number="serviceForm.maxTokens" type="number" min="1" max="32768" class="rounded-lg border border-line-strong px-3 py-2 text-sm" />
            </label>
          </div>

          <label class="flex items-center gap-3 text-sm font-semibold">
            <input v-model="serviceForm.isActive" type="checkbox" class="w-4 h-4 accent-brand-700" />
            <span class="text-brand-950">Kích hoạt dịch vụ này</span>
          </label>

          <!-- Test result banner -->
          <div v-if="serviceTestResult" class="rounded-xl p-3.5 text-xs flex flex-col gap-2 transition-all" :class="serviceTestResult.startsWith('Thành công') ? 'bg-green-50 text-green-900 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'" role="status">
            <div class="font-bold flex items-center gap-1.5 text-sm">
              <i :class="serviceTestResult.startsWith('Thành công') ? 'fa-solid fa-circle-check text-green-600' : 'fa-solid fa-triangle-exclamation text-red-600'" aria-hidden="true"></i>
              <span>{{ serviceTestResult.startsWith('Thành công') ? 'Kiểm tra thành công (Model phản hồi thực tế)' : 'Kiểm tra thất bại' }}</span>
            </div>
            <div class="whitespace-pre-wrap font-sans text-xs leading-relaxed bg-white/70 p-2.5 rounded-lg border border-black/5">
              {{ serviceTestResult }}
            </div>
          </div>

        </div>
        <template #footer>
            <button
              type="button"
              class="mr-auto px-4 py-2 rounded-lg border border-line-strong text-sm font-semibold text-brand-950 hover:bg-surface-tint"
              :disabled="testingService"
              @click="testService()"
            >
              {{ testingService ? 'Đang test...' : 'Kiểm tra kết nối' }}
            </button>
            <button type="button" class="px-4 py-2 rounded-lg border border-line-strong text-sm font-semibold text-ink-muted hover:bg-surface" @click="editingService = null">Huỷ</button>
            <button type="button" class="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-semibold hover:bg-brand-900" @click="saveService()" :disabled="savingService">
              {{ savingService ? 'Đang lưu...' : 'Lưu cấu hình' }}
            </button>
        </template>
      </AdminModal>
    </template>
  </div>
</template>
