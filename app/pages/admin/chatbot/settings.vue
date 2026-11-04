<script setup lang="ts">
// `errorMessage` ở tệp này đã là tên một ref hiển thị, nên helper dùng chung
// vào dưới alias — trùng tên sẽ khiến ref che mất hàm và không có lỗi nào.
import { errorMessage as readErrorMessage } from '~/utils/errorMessage'
import type { AiPricingResponse, AiProvidersResponse, ChatbotSettingsResponse, ChatbotSettingsSaveResponse } from '~/types/admin-settings-api'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

/**
 * AI provider, model, API key và system prompt đã chuyển sang AI Panel
 * (`/admin/ai`). Trang này chỉ còn quản lý hành vi ứng xử của trợ lý:
 * chế độ trả lời, lead capture, small talk, và giới hạn an toàn.
 */

type EditableSettings = {
  enabled: boolean
  providerPolicy: string
  baseUrl: string
  model: string
  allowedHosts: string
  mode: string
  outOfScopeBehavior: string
  knowledgeGreeting: string
  fallbackMessage: string
  leadCaptureEnabled: boolean
  smallTalkEnabled: boolean
  smallTalkSemanticEnabled: boolean
  leadCaptureEmail: string
  requestTimeoutMs: number
  maxResponseBytes: number
  maxInputChars: number
  maxHistoryMessages: number
  retrievalTopK: number
  referenceCharBudget: number
  rateLimitRequests: number
  rateLimitWindowSeconds: number
}

type SettingsResponse = Record<string, unknown> // khối `settings` của GET (đã có kiểu), đọc phòng thủ từng trường
type SettingsMetadata = {
  systemPromptConfigured: boolean
  systemPromptLength: number
  hasApiKey: boolean
  apiKeyMasked: string | null
}
type SettingsPatch = Omit<EditableSettings, 'allowedHosts' | 'baseUrl'> & {
  systemPrompt?: string
  apiKey?: string
  baseUrl?: string
  model?: string
  provider?: string
  providerPolicy?: string
  allowedHosts?: string[]
}

const DEFAULT_FORM: EditableSettings = {
  enabled: false,
  providerPolicy: 'openai-compatible',
  baseUrl: '',
  model: '',
  allowedHosts: '',
  mode: 'knowledge',
  outOfScopeBehavior: 'knowledge_only',
  knowledgeGreeting: '',
  fallbackMessage: '',
  leadCaptureEnabled: true,
  smallTalkEnabled: true,
  smallTalkSemanticEnabled: false,
  leadCaptureEmail: '',
  requestTimeoutMs: 10_000,
  maxResponseBytes: 262_144,
  maxInputChars: 2_000,
  maxHistoryMessages: 8,
  retrievalTopK: 3,
  referenceCharBudget: 6_000,
  rateLimitRequests: 10,
  rateLimitWindowSeconds: 60,
}

const toast = useToast()
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const dirty = ref(false)
const form = reactive<EditableSettings>({ ...DEFAULT_FORM })
const metadata = reactive<SettingsMetadata>({
  systemPromptConfigured: false,
  systemPromptLength: 0,
  hasApiKey: false,
  apiKeyMasked: null,
})
const clearingKey = ref(false)
const testing = ref(false)
const testMessage = ref('')
const baseline = ref('')
const defaultSystemPrompt = ref('')
const systemPromptReplacement = ref('')
const activeProviders = ref<Array<{ provider: string; label: string; isActive: boolean }>>([])
const activeModels = ref<Array<{ model: string; provider: string; label: string | null; promptCostPerMillion: number; completionCostPerMillion: number; isActive: boolean }>>([])

const usingAi = computed(() => form.mode === 'ai')

const activeModelsForCurrentProvider = computed(() => {
  return activeModels.value.filter(m => m.provider === form.providerPolicy && m.isActive)
})

function restoreDefaultPrompt() {
  systemPromptReplacement.value = defaultSystemPrompt.value
}

function editableSnapshot() {
  return JSON.stringify({ ...form, systemPrompt: systemPromptReplacement.value })
}

function markDirty() {
  dirty.value = editableSnapshot() !== baseline.value
}

function errorText(error: unknown) {
  return readErrorMessage(error, 'Không thể hoàn tất thao tác. Vui lòng kiểm tra lại.')
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function readString(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function applySettingsResponse(value: SettingsResponse) {
  form.enabled = readBoolean(value.enabled, DEFAULT_FORM.enabled)
  form.providerPolicy = readString(value.providerPolicy, DEFAULT_FORM.providerPolicy)
  form.baseUrl = readString(value.baseUrl, DEFAULT_FORM.baseUrl)
  form.model = readString(value.model, DEFAULT_FORM.model)
  form.allowedHosts = Array.isArray(value.allowedHosts)
    ? value.allowedHosts.filter((host): host is string => typeof host === 'string').join('\n')
    : DEFAULT_FORM.allowedHosts
  form.mode = readString(value.mode, DEFAULT_FORM.mode)
  form.outOfScopeBehavior = readString(value.outOfScopeBehavior, DEFAULT_FORM.outOfScopeBehavior)
  form.knowledgeGreeting = readString(value.knowledgeGreeting, DEFAULT_FORM.knowledgeGreeting)
  form.fallbackMessage = readString(value.fallbackMessage, DEFAULT_FORM.fallbackMessage)
  form.leadCaptureEnabled = readBoolean(value.leadCaptureEnabled, DEFAULT_FORM.leadCaptureEnabled)
  form.smallTalkEnabled = readBoolean(value.smallTalkEnabled, DEFAULT_FORM.smallTalkEnabled)
  form.smallTalkSemanticEnabled = readBoolean(value.smallTalkSemanticEnabled, DEFAULT_FORM.smallTalkSemanticEnabled)
  form.leadCaptureEmail = readString(value.leadCaptureEmail, DEFAULT_FORM.leadCaptureEmail)
  form.requestTimeoutMs = readNumber(value.requestTimeoutMs, DEFAULT_FORM.requestTimeoutMs)
  form.maxResponseBytes = readNumber(value.maxResponseBytes, DEFAULT_FORM.maxResponseBytes)
  form.maxInputChars = readNumber(value.maxInputChars, DEFAULT_FORM.maxInputChars)
  form.maxHistoryMessages = readNumber(value.maxHistoryMessages, DEFAULT_FORM.maxHistoryMessages)
  form.retrievalTopK = readNumber(value.retrievalTopK, DEFAULT_FORM.retrievalTopK)
  form.referenceCharBudget = readNumber(value.referenceCharBudget, DEFAULT_FORM.referenceCharBudget)
  form.rateLimitRequests = readNumber(value.rateLimitRequests, DEFAULT_FORM.rateLimitRequests)
  form.rateLimitWindowSeconds = readNumber(value.rateLimitWindowSeconds, DEFAULT_FORM.rateLimitWindowSeconds)
  metadata.systemPromptConfigured = value.systemPromptConfigured === true
  metadata.systemPromptLength = typeof value.systemPromptLength === 'number' ? value.systemPromptLength : 0
  metadata.hasApiKey = value.hasApiKey === true
  metadata.apiKeyMasked = typeof value.apiKeyMasked === 'string' ? value.apiKeyMasked : null
}

function buildPatchPayload(): SettingsPatch {
  const body: SettingsPatch = {
    enabled: form.enabled,
    providerPolicy: form.providerPolicy === 'anthropic' ? 'anthropic' : 'openai-compatible',
    provider: form.providerPolicy,
    // `baseUrl`/`allowedHosts` cố ý KHÔNG gửi: trang không có ô sửa chúng, giá trị
    // trong form là địa chỉ của `ai_providers` phủ lên lúc tải. Gửi lại chúng từng
    // chép âm thầm địa chỉ bên AI Panel sang đường gọi cũ mang khoá chatbot; nay đổi
    // đích gọi đòi siêu quản trị, nên nếu còn gửi thì một lần lưu thường sẽ bị từ chối.
    model: form.model,
    mode: form.mode,
    outOfScopeBehavior: form.outOfScopeBehavior,
    knowledgeGreeting: form.knowledgeGreeting,
    fallbackMessage: form.fallbackMessage,
    leadCaptureEnabled: form.leadCaptureEnabled,
    smallTalkEnabled: form.smallTalkEnabled,
    smallTalkSemanticEnabled: form.smallTalkSemanticEnabled,
    leadCaptureEmail: form.leadCaptureEmail,
    requestTimeoutMs: form.requestTimeoutMs,
    maxResponseBytes: form.maxResponseBytes,
    maxInputChars: form.maxInputChars,
    maxHistoryMessages: form.maxHistoryMessages,
    retrievalTopK: form.retrievalTopK,
    referenceCharBudget: form.referenceCharBudget,
    rateLimitRequests: form.rateLimitRequests,
    rateLimitWindowSeconds: form.rateLimitWindowSeconds,
  }
  const prompt = systemPromptReplacement.value
  if (prompt.length > 0) {
    if (!prompt.trim()) throw new Error('System prompt mới không được chỉ chứa khoảng trắng.')
    body.systemPrompt = prompt
  }
  return body
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [response, provData, priceData] = await Promise.all([
      adminFetch<ChatbotSettingsResponse>('/api/admin/chatbot/settings'),
      adminFetch<AiProvidersResponse>('/api/admin/ai/providers').catch(() => ({ providers: [] })),
      adminFetch<AiPricingResponse>('/api/admin/ai/pricing').catch(() => ({ pricing: [] })),
    ])
    activeProviders.value = provData.providers.filter(p => p.isActive)
    activeModels.value = priceData.pricing
    applySettingsResponse(response.settings || {})
    defaultSystemPrompt.value = readString(response.settings?.defaultSystemPrompt, '')
    if (response.currentProvider) form.providerPolicy = response.currentProvider
    if (response.currentModel) form.model = response.currentModel
    const loadedPrompt = readString(response.currentSystemPrompt, '')
    systemPromptReplacement.value = loadedPrompt || defaultSystemPrompt.value
    baseline.value = editableSnapshot()
    dirty.value = false
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    loading.value = false
  }
}
async function save() {
  errorMessage.value = ''
  let body: SettingsPatch
  try {
    body = buildPatchPayload()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : errorText(error)
    return
  }

  saving.value = true
  try {
    await adminFetch<ChatbotSettingsSaveResponse>('/api/admin/chatbot/settings', { method: 'PATCH', body })
    await load()
    toast.success('Đã lưu cấu hình chatbot.')
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    saving.value = false
  }
}

watch(form, markDirty, { deep: true })
watch(systemPromptReplacement, markDirty)
onBeforeRouteLeave(() => {
  if (dirty.value) toast.warning('Bạn có thay đổi chưa lưu trong cài đặt chatbot.')
})
onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="m-0 text-[1.3rem] font-extrabold text-brand-950">Cài đặt Chatbot</h1>
        <p class="m-0 mt-1 text-sm text-ink-muted">Quản lý hành vi và giới hạn an toàn của trợ lý.</p>
      </div>
      <span v-if="dirty" class="text-sm font-semibold text-[#8a5a00]" role="status">Có thay đổi chưa lưu</span>
    </header>

    <!-- Chuyển hướng sang AI Panel cho cấu hình AI -->
    <div class="flex items-center gap-3 rounded-lg border border-[#d7e5d8] bg-surface-tint p-3 text-sm text-[#38553b]">
      <i class="fa-solid fa-circle-info text-base shrink-0" aria-hidden="true"></i>
      <span>
        Cấu hình nhà cung cấp AI (API key, model, system prompt) đã chuyển sang
        <nuxt-link to="/admin/ai" class="font-bold text-brand-700 underline">AI Panel</nuxt-link>.
        Trang này chỉ quản lý hành vi ứng xử của trợ lý.
        <span v-if="metadata.apiKeyMasked" class="sr-only">Đang cấu hình {{ metadata.apiKeyMasked }}</span>
      </span>
    </div>

    <div v-if="errorMessage" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">
      <strong>Lỗi:</strong> {{ errorMessage }}<template v-if="!loading && !saving"> Vui lòng <button type="button" class="font-bold underline text-brand-600" @click="load()">thử lại</button>.</template>
    </div>
    <SkeletonForm v-if="loading" label="Đang tải cấu hình chatbot" :fields="5" />

    <form v-else class="flex flex-col gap-5" @submit.prevent="save">
      <!-- Chế độ trả lời + giới hạn liên hệ: component riêng (trang vượt 400 dòng). -->
      <AdminChatbotAnswerModeSection v-model="form" :using-ai="usingAi" />

      <!-- Cấu hình Nhà cung cấp & Prompt cho Trợ lý AI (Đồng bộ 2 chiều với AI Panel) -->
      <section v-if="usingAi" class="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 sm:p-5">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
          <div>
            <h2 class="m-0 text-base font-extrabold text-brand-950">Cấu hình AI & Prompt cho Trợ lý</h2>
            <p class="m-0 mt-0.5 text-xs text-ink-muted">
              Đồng bộ 2 chiều với <nuxt-link to="/admin/ai" class="font-bold text-brand-700 underline">AI Panel</nuxt-link>. Bạn sửa ở đây hoặc sửa trong AI Panel đều có hiệu lực ngay lập tức.
            </p>
          </div>
          <button
            type="button"
            class="px-3 py-1.5 rounded-lg border border-line-strong bg-white text-xs font-semibold text-brand-950 hover:bg-surface-tint transition-colors"
            @click="restoreDefaultPrompt"
          >
            <i class="fa-solid fa-rotate-left mr-1" aria-hidden="true"></i> Khôi phục prompt mặc định C11
          </button>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label class="flex flex-col gap-1.5 text-sm font-bold">
            Nhà cung cấp (Provider)
            <select v-model="form.providerPolicy" class="rounded-lg border border-line-strong px-3 py-2.5 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20 bg-white">
              <option v-for="p in activeProviders" :key="p.provider" :value="p.provider">{{ p.label }} ({{ p.provider }})</option>
              <option v-if="!activeProviders.some(p => p.provider === form.providerPolicy)" :value="form.providerPolicy">{{ form.providerPolicy }}</option>
            </select>
          </label>

          <label class="flex flex-col gap-1.5 text-sm font-bold">
            Model sử dụng
            <select v-if="activeModelsForCurrentProvider.length > 0" v-model="form.model" class="rounded-lg border border-line-strong px-3 py-2.5 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20 bg-white">
              <option value="">— Chọn model đang bật —</option>
              <option v-for="m in activeModelsForCurrentProvider" :key="m.model" :value="m.model">
                {{ m.model }} {{ m.label ? `(${m.label})` : '' }} — ${{ m.promptCostPerMillion }} in / ${{ m.completionCostPerMillion }} out
              </option>
            </select>
            <input
              v-else
              v-model="form.model"
              type="text"
              placeholder="delify-5.5, flash, gpt-4o-mini..."
              class="rounded-lg border border-line-strong px-3 py-2.5 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20"
            />
          </label>
        </div>

        <!-- System Prompt Textarea -->
        <label class="flex flex-col gap-1.5 text-sm font-bold">
          <div class="flex items-center justify-between">
            <span>Chỉ dẫn hệ thống (System Prompt) cho Trợ lý</span>
            <span class="text-xs font-normal text-ink-muted">
              {{ systemPromptReplacement.length }} ký tự
            </span>
          </div>
          <textarea
            v-model="systemPromptReplacement"
            rows="10"
            placeholder="Nhập prompt chỉ dẫn cho trợ lý..."
            class="rounded-lg border border-line-strong px-3 py-2.5 font-normal font-sans text-sm leading-relaxed outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20"
          ></textarea>
        </label>
      </section>

      <!-- Safety limits apply to both modes, so they stay visible. -->
      <section class="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 sm:p-5">
        <div>
          <h2 class="m-0 text-base font-extrabold text-brand-950">Giới hạn an toàn</h2>
          <p class="m-0 mt-1 text-sm text-ink-muted">Áp dụng cho cả hai chế độ trả lời.</p>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <label class="flex flex-col gap-1 text-sm font-bold">
            Top K
            <input v-model.number="form.retrievalTopK" type="number" min="1" max="10" step="1" required class="rounded-lg border border-line-strong px-3 py-2 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20" />
          </label>
          <label class="flex flex-col gap-1 text-sm font-bold">
            Ngân sách tham chiếu
            <input v-model.number="form.referenceCharBudget" type="number" min="500" max="20000" step="1" required class="rounded-lg border border-line-strong px-3 py-2 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20" />
          </label>
          <label class="flex flex-col gap-1 text-sm font-bold">
            Giới hạn câu hỏi
            <input v-model.number="form.maxInputChars" type="number" min="1" max="10000" step="1" required class="rounded-lg border border-line-strong px-3 py-2 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20" />
          </label>
          <label class="flex flex-col gap-1 text-sm font-bold">
            Số tin nhắn lịch sử
            <input v-model.number="form.maxHistoryMessages" type="number" min="0" max="20" step="1" required class="rounded-lg border border-line-strong px-3 py-2 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20" />
          </label>
          <label class="flex flex-col gap-1 text-sm font-bold">
            Số lượt / cửa sổ
            <input v-model.number="form.rateLimitRequests" type="number" min="1" max="100" step="1" required class="rounded-lg border border-line-strong px-3 py-2 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20" />
          </label>
          <label class="flex flex-col gap-1 text-sm font-bold">
            Cửa sổ rate limit (giây)
            <input v-model.number="form.rateLimitWindowSeconds" type="number" min="10" max="3600" step="1" required class="rounded-lg border border-line-strong px-3 py-2 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20" />
          </label>
          <label class="flex flex-col gap-1 text-sm font-bold">
            Timeout yêu cầu (ms)
            <input v-model.number="form.requestTimeoutMs" type="number" min="1000" max="30000" step="1" required class="rounded-lg border border-line-strong px-3 py-2 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20" />
          </label>
          <label class="flex flex-col gap-1 text-sm font-bold">
            Phản hồi tối đa (byte)
            <input v-model.number="form.maxResponseBytes" type="number" min="1024" max="1048576" step="1" required class="rounded-lg border border-line-strong px-3 py-2 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20" />
          </label>
        </div>
      </section>

      <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="submit" :disabled="saving" class="rounded-lg bg-brand-900 px-5 py-2.5 font-bold text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
          {{ saving ? 'Đang lưu...' : 'Lưu cấu hình' }}
        </button>
      </div>
    </form>
  </div>
</template>
