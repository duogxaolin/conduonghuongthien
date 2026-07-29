<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

type EditableSettings = {
  enabled: boolean
  providerPolicy: string
  mode: string
  outOfScopeBehavior: string
  knowledgeGreeting: string
  fallbackMessage: string
  leadCaptureEnabled: boolean
  smallTalkEnabled: boolean
  leadCaptureEmail: string
  baseUrl: string
  model: string
  allowedHosts: string
  requestTimeoutMs: number
  maxResponseBytes: number
  maxInputChars: number
  maxHistoryMessages: number
  retrievalTopK: number
  referenceCharBudget: number
  rateLimitRequests: number
  rateLimitWindowSeconds: number
}

type ProviderPreset = { label: string, baseUrl: string, host: string, model: string, hint: string }

type SettingsMetadata = {
  systemPromptConfigured: boolean
  systemPromptLength: number
  hasApiKey: boolean
  apiKeyMasked: string | null
}

type SettingsResponse = Record<string, unknown>

type SettingsPatch = Omit<EditableSettings, 'allowedHosts'> & {
  allowedHosts: string[]
  systemPrompt?: string
  apiKey?: string
}

const DEFAULT_FORM: EditableSettings = {
  enabled: false,
  providerPolicy: 'openai-compatible',
  mode: 'knowledge',
  outOfScopeBehavior: 'knowledge_only',
  knowledgeGreeting: '',
  fallbackMessage: '',
  leadCaptureEnabled: true,
  smallTalkEnabled: true,
  leadCaptureEmail: '',
  baseUrl: '',
  model: '',
  allowedHosts: '',
  requestTimeoutMs: 10_000,
  maxResponseBytes: 262_144,
  maxInputChars: 2_000,
  maxHistoryMessages: 8,
  retrievalTopK: 3,
  referenceCharBudget: 6_000,
  rateLimitRequests: 10,
  rateLimitWindowSeconds: 60,
}

/**
 * Fallback presets. The server sends the authoritative list in the GET response;
 * these keep the selector usable if that field is ever absent (older server).
 */
const FALLBACK_PRESETS: Record<string, ProviderPreset> = {
  'openai-compatible': {
    label: 'OpenAI (và các API tương thích OpenAI)',
    baseUrl: 'https://api.openai.com/v1',
    host: 'api.openai.com',
    model: 'gpt-4o-mini',
    hint: 'Dùng cho OpenAI hoặc bất kỳ dịch vụ nói cùng giao thức /chat/completions.',
  },
  anthropic: {
    label: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com',
    host: 'api.anthropic.com',
    model: 'claude-opus-5',
    hint: 'Dùng Messages API của Anthropic.',
  },
}

const toast = useToast()
const { confirm } = useConfirm()
const loading = ref(true)
const saving = ref(false)
const clearingKey = ref(false)
const testing = ref(false)
const errorMessage = ref('')
const testMessage = ref('')
const dirty = ref(false)
const newApiKey = ref('')
const systemPromptReplacement = ref('')
const keyVisible = ref(false)
const form = reactive<EditableSettings>({ ...DEFAULT_FORM })
const metadata = reactive<SettingsMetadata>({
  systemPromptConfigured: false,
  systemPromptLength: 0,
  hasApiKey: false,
  apiKeyMasked: null,
})
/** Server-supplied defaults. Not secrets: the shipped prompt and the preset table. */
const defaultSystemPrompt = ref('')
const providerPresets = ref<Record<string, ProviderPreset>>({ ...FALLBACK_PRESETS })
const baseline = ref('')

const usingAi = computed(() => form.mode === 'ai')
const presetList = computed(() => Object.entries(providerPresets.value))
const activePreset = computed(() => providerPresets.value[form.providerPolicy] || null)
const promptMatchesDefault = computed(
  () => systemPromptReplacement.value.trim() === defaultSystemPrompt.value.trim(),
)

function editableSnapshot() {
  return JSON.stringify({
    ...form,
    newApiKey: newApiKey.value ? '[replacement-entered]' : '',
    systemPromptReplacement: systemPromptReplacement.value,
  })
}

function markDirty() {
  dirty.value = editableSnapshot() !== baseline.value
}

function errorText(error: any) {
  return error?.data?.statusMessage || 'Không thể hoàn tất thao tác. Vui lòng kiểm tra lại.'
}

function normalizedHosts(value: string) {
  return value
    .split(/[\n,]/u)
    .map(host => host.trim())
    .filter(Boolean)
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

function readPresets(value: unknown): Record<string, ProviderPreset> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...FALLBACK_PRESETS }
  const result: Record<string, ProviderPreset> = {}
  for (const [key, preset] of Object.entries(value as Record<string, unknown>)) {
    if (!preset || typeof preset !== 'object') continue
    const entry = preset as Record<string, unknown>
    result[key] = {
      label: readString(entry.label, key),
      baseUrl: readString(entry.baseUrl, ''),
      host: readString(entry.host, ''),
      model: readString(entry.model, ''),
      hint: readString(entry.hint, ''),
    }
  }
  return Object.keys(result).length ? result : { ...FALLBACK_PRESETS }
}

function applySettingsResponse(value: SettingsResponse) {
  form.enabled = readBoolean(value.enabled, DEFAULT_FORM.enabled)
  form.providerPolicy = readString(value.providerPolicy, DEFAULT_FORM.providerPolicy)
  form.mode = readString(value.mode, DEFAULT_FORM.mode)
  form.outOfScopeBehavior = readString(value.outOfScopeBehavior, DEFAULT_FORM.outOfScopeBehavior)
  form.knowledgeGreeting = readString(value.knowledgeGreeting, DEFAULT_FORM.knowledgeGreeting)
  form.fallbackMessage = readString(value.fallbackMessage, DEFAULT_FORM.fallbackMessage)
  form.leadCaptureEnabled = readBoolean(value.leadCaptureEnabled, DEFAULT_FORM.leadCaptureEnabled)
  form.smallTalkEnabled = readBoolean(value.smallTalkEnabled, DEFAULT_FORM.smallTalkEnabled)
  form.leadCaptureEmail = readString(value.leadCaptureEmail, DEFAULT_FORM.leadCaptureEmail)
  form.baseUrl = readString(value.baseUrl, DEFAULT_FORM.baseUrl)
  form.model = readString(value.model, DEFAULT_FORM.model)
  form.allowedHosts = Array.isArray(value.allowedHosts)
    ? value.allowedHosts.filter((host): host is string => typeof host === 'string').join('\n')
    : DEFAULT_FORM.allowedHosts
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
  defaultSystemPrompt.value = readString(value.defaultSystemPrompt, '')
  providerPresets.value = readPresets(value.providerPresets)
  newApiKey.value = ''
  // An unconfigured deployment starts from the shipped prompt, so saving once
  // stores a governed instruction instead of leaving the field empty. A stored
  // prompt is never echoed back, so the box stays empty and means "keep".
  systemPromptReplacement.value = metadata.systemPromptConfigured ? '' : defaultSystemPrompt.value
  keyVisible.value = false
}

/** Put the shipped prompt back in the box. Saving is still an explicit action. */
function restoreDefaultPrompt() {
  systemPromptReplacement.value = defaultSystemPrompt.value
}

/**
 * Fill provider fields from the preset when switching policy, without clobbering
 * anything the operator typed themselves: a value is replaced only when it is
 * empty or still equal to the previous policy's preset.
 */
function applyProviderPreset(previousPolicy: string) {
  const preset = providerPresets.value[form.providerPolicy]
  if (!preset) return
  const previous = providerPresets.value[previousPolicy]

  if (!form.baseUrl.trim() || form.baseUrl.trim() === previous?.baseUrl) form.baseUrl = preset.baseUrl
  if (!form.model.trim() || form.model.trim() === previous?.model) form.model = preset.model
  const hosts = normalizedHosts(form.allowedHosts)
  if (hosts.length === 0 || (hosts.length === 1 && hosts[0] === previous?.host)) form.allowedHosts = preset.host
}

function buildPatchPayload(): SettingsPatch {
  const body: SettingsPatch = {
    enabled: form.enabled,
    providerPolicy: form.providerPolicy,
    mode: form.mode,
    outOfScopeBehavior: form.outOfScopeBehavior,
    knowledgeGreeting: form.knowledgeGreeting,
    fallbackMessage: form.fallbackMessage,
    leadCaptureEnabled: form.leadCaptureEnabled,
    smallTalkEnabled: form.smallTalkEnabled,
    leadCaptureEmail: form.leadCaptureEmail,
    baseUrl: form.baseUrl,
    model: form.model,
    allowedHosts: normalizedHosts(form.allowedHosts),
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

  const apiKey = newApiKey.value.trim()
  if (apiKey) body.apiKey = apiKey

  // Base URL / Model are only meaningful in AI mode; omit when empty so the
  // server does not reject an empty model in knowledge-only mode.
  const record = body as Record<string, unknown>
  if (!form.baseUrl.trim()) delete record.baseUrl
  if (!form.model.trim()) delete record.model
  return body
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<{ settings?: SettingsResponse }>('/api/admin/chatbot/settings')
    applySettingsResponse(response.settings || {})
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
  testMessage.value = ''
  if (form.mode === 'ai' && (!form.baseUrl.trim() || !form.model.trim())) {
    errorMessage.value = 'Chế độ AI cần Base URL và Model.'
    return
  }

  let body: SettingsPatch
  try {
    body = buildPatchPayload()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : errorText(error)
    return
  }

  saving.value = true
  try {
    await $fetch('/api/admin/chatbot/settings', { method: 'PATCH', body })
    await load()
    toast.success('Đã lưu cấu hình chatbot.')
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    saving.value = false
  }
}

async function clearKey() {
  if (!metadata.hasApiKey || !await confirm({ title: 'Xóa API key', message: 'Xóa API key khỏi cấu hình chatbot?', danger: true, confirmLabel: 'Xóa key' })) return
  clearingKey.value = true
  errorMessage.value = ''
  testMessage.value = ''
  try {
    await $fetch('/api/admin/chatbot/settings/clear', { method: 'POST' })
    await load()
    toast.success('Đã xóa API key.')
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    clearingKey.value = false
  }
}

async function testConnection() {
  testing.value = true
  testMessage.value = ''
  errorMessage.value = ''
  try {
    const response = await $fetch<any>('/api/admin/chatbot/test', { method: 'POST' })
    testMessage.value = response.result?.status === 'success'
      ? `Kết nối thành công (${response.result.statusCode}, ${response.result.durationMs} ms).`
      : 'Kết nối chưa thành công. Kiểm tra cấu hình và thử lại.'
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    testing.value = false
  }
}

watch(form, markDirty, { deep: true })
watch(newApiKey, markDirty)
watch(systemPromptReplacement, markDirty)
watch(() => form.providerPolicy, (_, previous) => {
  if (previous) applyProviderPreset(previous)
})
onBeforeRouteLeave(() => {
  if (dirty.value) toast.warning('Bạn có thay đổi chưa lưu trong cài đặt chatbot.')
})
onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="m-0 text-[1.3rem] font-extrabold text-[#122815]">Cài đặt Chatbot</h1>
        <p class="m-0 mt-1 text-sm text-[#667768]">Quản lý kết nối, hành vi và giới hạn an toàn của trợ lý.</p>
      </div>
      <span v-if="dirty" class="text-sm font-semibold text-[#8a5a00]" role="status">Có thay đổi chưa lưu</span>
    </header>

    <div v-if="errorMessage" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">
      <strong>Lỗi:</strong> {{ errorMessage }}
    </div>
    <div v-if="loading" class="rounded-xl border border-[#e2ece3] bg-white p-12 text-center text-sm text-[#667768]" aria-live="polite">
      Đang tải cấu hình chatbot...
    </div>

    <form v-else class="flex flex-col gap-5" @submit.prevent="save">
      <!-- Answer mode + lead capture -->
      <section class="flex flex-col gap-4 rounded-xl border border-[#e2ece3] bg-white p-4 sm:p-5">
        <div>
          <h2 class="m-0 text-base font-extrabold text-[#122815]">Chế độ trả lời</h2>
          <p class="m-0 mt-1 text-sm text-[#667768]">Chọn cách trợ lý trả lời người dùng.</p>
        </div>

        <label class="flex items-center gap-3 text-sm font-semibold">
          <input v-model="form.enabled" type="checkbox" class="h-4 w-4 accent-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/30" />
          Bật chatbot cho người dùng
        </label>

        <div class="grid gap-3 sm:grid-cols-2">
          <label class="flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors" :class="form.mode === 'knowledge' ? 'border-[#2c6e33] bg-[#f0f7f1]' : 'border-[#c8d6c9] hover:bg-[#f8faf8]'">
            <span class="flex items-center gap-2 text-sm font-bold text-[#122815]"><input type="radio" value="knowledge" v-model="form.mode" class="h-4 w-4 accent-[#2c6e33]" /> Chỉ kho kiến thức (không AI)</span>
            <span class="pl-6 text-xs text-[#667768]">Trả lời vui vẻ dựa trên câu trả lời đã duyệt trong Kho kiến thức, khớp theo từ khoá. Không gọi AI, không cần API key.</span>
          </label>
          <label class="flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors" :class="form.mode === 'ai' ? 'border-[#2c6e33] bg-[#f0f7f1]' : 'border-[#c8d6c9] hover:bg-[#f8faf8]'">
            <span class="flex items-center gap-2 text-sm font-bold text-[#122815]"><input type="radio" value="ai" v-model="form.mode" class="h-4 w-4 accent-[#2c6e33]" /> Dùng AI</span>
            <span class="pl-6 text-xs text-[#667768]">AI + system prompt, ưu tiên dữ liệu trong Kho kiến thức. Mở thêm mục Nhà cung cấp và Chỉ dẫn bên dưới.</span>
          </label>
        </div>

        <label v-if="usingAi" class="flex flex-col gap-1.5 text-sm font-bold">
          Khi câu hỏi nằm ngoài Kho kiến thức
          <select v-model="form.outOfScopeBehavior" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20">
            <option value="knowledge_only">Chỉ bám Kho kiến thức + mời để lại thông tin (an toàn)</option>
            <option value="ai_freeform">Cho AI tự trả lời theo hiểu biết chung</option>
          </select>
        </label>

        <label v-if="form.mode === 'knowledge'" class="flex flex-col gap-1.5 text-sm font-bold">
          Lời chào vui vẻ (tùy chọn)
          <span class="font-normal text-[#667768]">Thêm vào đầu mỗi câu trả lời ở chế độ Kho kiến thức. VD: “Dạ, em xin phép trả lời ạ 😊”.</span>
          <input v-model="form.knowledgeGreeting" maxlength="500" autocomplete="off" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" />
        </label>

        <label class="flex items-start gap-3 border-t border-[#e2ece3] pt-4 text-sm font-semibold">
          <input v-model="form.smallTalkEnabled" type="checkbox" class="mt-0.5 h-4 w-4 accent-[#2c6e33]" />
          <span>Trả lời thường nhật<br /><span class="font-normal text-[#667768]">Áp dụng cho cả 2 chế độ. Các câu như “hi”, “chào bạn”, “cảm ơn”, “bạn là ai”, “tôi mới ra tù tôi lo lắm” sẽ được trả lời bằng nội dung trong kho <nuxt-link to="/admin/chatbot/small-talk" class="font-semibold text-[#2c6e33] underline">Trả lời thường nhật</nuxt-link> quản lý được, thay vì hỏi ngay thông tin liên hệ. Câu trả lời trong Kho kiến thức luôn được ưu tiên. Tắt công tắc này thì mọi câu không khớp kho kiến thức đều quay về hỏi thông tin liên hệ.</span></span>
        </label>

        <div class="flex flex-col gap-3 border-t border-[#e2ece3] pt-4">
          <label class="flex items-start gap-3 text-sm font-semibold">
            <input v-model="form.leadCaptureEnabled" type="checkbox" class="mt-0.5 h-4 w-4 accent-[#2c6e33]" />
            <span>Khi không có câu trả lời, mời khách để lại thông tin liên hệ<br /><span class="font-normal text-[#667768]">Áp dụng cho cả 2 chế độ. Thông tin được lưu ở mục Đơn đăng ký và gửi email cho cán bộ.</span></span>
          </label>
          <label class="flex flex-col gap-1.5 text-sm font-bold">
            Email nhận thông tin liên hệ
            <span class="font-normal text-[#667768]">Để trống sẽ dùng email liên hệ chung của trang (trong Cài đặt chung).</span>
            <input v-model="form.leadCaptureEmail" type="email" autocomplete="off" placeholder="canbo@donvi.gov.vn" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" />
          </label>
          <label class="flex flex-col gap-1.5 text-sm font-bold">
            Câu thông báo khi chưa có câu trả lời (tùy chọn)
            <input v-model="form.fallbackMessage" maxlength="1000" autocomplete="off" placeholder="Xin lỗi, hiện tôi chưa tìm thấy thông tin phù hợp…" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" />
          </label>
        </div>
      </section>

      <!-- Provider + system prompt: only meaningful once AI answering is chosen. -->
      <section v-if="usingAi" class="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div class="flex flex-col gap-4 rounded-xl border border-[#e2ece3] bg-white p-4 sm:p-5">
          <h2 class="m-0 text-base font-extrabold text-[#122815]">Nhà cung cấp</h2>

          <label class="flex flex-col gap-1.5 text-sm font-bold">
            Chính sách nhà cung cấp
            <select v-model="form.providerPolicy" required class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20">
              <option v-for="[key, preset] in presetList" :key="key" :value="key">{{ preset.label }}</option>
            </select>
            <span v-if="activePreset" class="font-normal text-[#667768]">{{ activePreset.hint }}</span>
          </label>

          <label class="flex flex-col gap-1.5 text-sm font-bold">
            Base URL
            <span class="font-normal text-[#667768]">Sửa được, để trỏ sang cổng trung gian hoặc bản tự triển khai.</span>
            <input v-model="form.baseUrl" type="url" :required="usingAi" autocomplete="url" :placeholder="activePreset?.baseUrl || 'https://provider.example/v1'" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" />
          </label>

          <label class="flex flex-col gap-1.5 text-sm font-bold">
            Model
            <input v-model="form.model" :required="usingAi" autocomplete="off" :placeholder="activePreset?.model || ''" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" />
          </label>

          <div class="flex flex-col gap-1.5">
            <label for="chatbot-api-key" class="text-sm font-bold">API key mới</label>
            <span class="text-sm text-[#667768]">
              {{ metadata.hasApiKey ? `Đang cấu hình ${metadata.apiKeyMasked || '••••'}` : 'Chưa cấu hình' }}. Để trống để giữ nguyên.
            </span>
            <div class="flex flex-col gap-2 sm:flex-row">
              <input id="chatbot-api-key" v-model="newApiKey" :type="keyVisible ? 'text' : 'password'" autocomplete="new-password" placeholder="Nhập key mới khi cần thay thế" class="min-w-0 flex-1 rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" />
              <button type="button" class="rounded-lg border border-[#c8d6c9] bg-white px-3 py-2.5 text-sm font-semibold hover:bg-[#f0f7f1] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/30" :aria-label="keyVisible ? 'Ẩn API key mới' : 'Hiện API key mới'" @click="keyVisible = !keyVisible">
                {{ keyVisible ? 'Ẩn' : 'Hiện' }}
              </button>
            </div>
          </div>

          <button v-if="metadata.hasApiKey" type="button" :disabled="clearingKey || saving" class="self-start rounded-lg border border-[#d12420] px-3 py-2 text-sm font-bold text-[#d12420] hover:bg-[#fff4f3] focus:outline-none focus:ring-2 focus:ring-[#d12420]/30 disabled:cursor-not-allowed disabled:opacity-60" @click="clearKey">
            {{ clearingKey ? 'Đang xóa...' : 'Xóa API key' }}
          </button>

          <label class="flex flex-col gap-1.5 text-sm font-bold">
            Hostname được phép
            <span class="font-normal text-[#667768]">Mỗi hostname một dòng, tối đa 20 hostname. Yêu cầu ra ngoài chỉ đi tới các host trong danh sách này.</span>
            <textarea v-model="form.allowedHosts" rows="3" autocomplete="off" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20"></textarea>
          </label>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-1 text-sm font-bold">
              Timeout yêu cầu (ms)
              <input v-model.number="form.requestTimeoutMs" type="number" min="1000" max="30000" step="1" required class="rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" />
            </label>
            <label class="flex flex-col gap-1 text-sm font-bold">
              Phản hồi tối đa (byte)
              <input v-model.number="form.maxResponseBytes" type="number" min="1024" max="1048576" step="1" required class="rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" />
            </label>
          </div>
        </div>

        <div class="flex flex-col gap-4 rounded-xl border border-[#e2ece3] bg-white p-4 sm:p-5">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <h2 class="m-0 text-base font-extrabold text-[#122815]">Chỉ dẫn cho AI</h2>
            <button type="button" :disabled="!defaultSystemPrompt || promptMatchesDefault" class="rounded-lg border border-[#c8d6c9] bg-white px-3 py-1.5 text-sm font-semibold text-[#2c3e2e] hover:bg-[#f0f7f1] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/30 disabled:cursor-not-allowed disabled:opacity-60" @click="restoreDefaultPrompt">
              Khôi phục mặc định
            </button>
          </div>

          <div class="rounded-lg border border-[#d7e5d8] bg-[#f0f7f1] p-3 text-sm text-[#38553b]" role="status">
            System prompt hiện tại: {{ metadata.systemPromptConfigured ? `đã cấu hình (${metadata.systemPromptLength} ký tự)` : 'chưa cấu hình — ô bên dưới đang điền sẵn mẫu mặc định, bấm Lưu để áp dụng' }}. Nội dung đã lưu không được hiển thị lại.
          </div>
          <label class="flex flex-col gap-1.5 text-sm font-bold">
            Thay thế system prompt
            <span class="font-normal text-[#667768]">Để trống để giữ nguyên prompt hiện tại. Chỉ nội dung mới bạn nhập mới được gửi.</span>
            <textarea v-model="systemPromptReplacement" rows="16" maxlength="20000" autocomplete="off" placeholder="Nhập prompt mới khi bạn muốn thay thế" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20"></textarea>
            <span class="font-normal text-[#667768]">{{ systemPromptReplacement.length }}/20000 ký tự</span>
          </label>
        </div>
      </section>

      <!-- Safety limits apply to both modes, so they stay visible. -->
      <section class="flex flex-col gap-4 rounded-xl border border-[#e2ece3] bg-white p-4 sm:p-5">
        <div>
          <h2 class="m-0 text-base font-extrabold text-[#122815]">Giới hạn an toàn</h2>
          <p class="m-0 mt-1 text-sm text-[#667768]">Áp dụng cho cả hai chế độ trả lời.</p>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <label class="flex flex-col gap-1 text-sm font-bold">
            Top K
            <input v-model.number="form.retrievalTopK" type="number" min="1" max="10" step="1" required class="rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" />
          </label>
          <label class="flex flex-col gap-1 text-sm font-bold">
            Ngân sách tham chiếu
            <input v-model.number="form.referenceCharBudget" type="number" min="500" max="20000" step="1" required class="rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" />
          </label>
          <label class="flex flex-col gap-1 text-sm font-bold">
            Giới hạn câu hỏi
            <input v-model.number="form.maxInputChars" type="number" min="1" max="10000" step="1" required class="rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" />
          </label>
          <label class="flex flex-col gap-1 text-sm font-bold">
            Số tin nhắn lịch sử
            <input v-model.number="form.maxHistoryMessages" type="number" min="0" max="20" step="1" required class="rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" />
          </label>
          <label class="flex flex-col gap-1 text-sm font-bold">
            Số lượt / cửa sổ
            <input v-model.number="form.rateLimitRequests" type="number" min="1" max="100" step="1" required class="rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" />
          </label>
          <label class="flex flex-col gap-1 text-sm font-bold">
            Cửa sổ rate limit (giây)
            <input v-model.number="form.rateLimitWindowSeconds" type="number" min="10" max="3600" step="1" required class="rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" />
          </label>
        </div>
      </section>

      <div v-if="testMessage" class="rounded-lg border border-[#8ed694] bg-[#f0f7f1] p-3 text-sm text-[#1e4620]" role="status">{{ testMessage }}</div>
      <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button v-if="usingAi" type="button" :disabled="testing || saving || clearingKey" class="rounded-lg border border-[#c8d6c9] bg-white px-4 py-2.5 font-bold text-[#2c3e2e] hover:bg-[#f0f7f1] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/30 disabled:cursor-not-allowed disabled:opacity-60" @click="testConnection">
          {{ testing ? 'Đang kiểm tra...' : 'Kiểm tra kết nối' }}
        </button>
        <button type="submit" :disabled="saving || clearingKey" class="rounded-lg bg-[#1e4620] px-5 py-2.5 font-bold text-white hover:bg-[#2c6e33] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
          {{ saving ? 'Đang lưu...' : 'Lưu cấu hình' }}
        </button>
      </div>
    </form>
  </div>
</template>
