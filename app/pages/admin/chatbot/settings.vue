<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

type EditableSettings = {
  enabled: boolean
  providerPolicy: string
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
const baseline = ref('')

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

function applySettingsResponse(value: SettingsResponse) {
  form.enabled = readBoolean(value.enabled, DEFAULT_FORM.enabled)
  form.providerPolicy = readString(value.providerPolicy, DEFAULT_FORM.providerPolicy)
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
  newApiKey.value = ''
  systemPromptReplacement.value = ''
  keyVisible.value = false
}

function buildPatchPayload(): SettingsPatch {
  const body: SettingsPatch = {
    enabled: form.enabled,
    providerPolicy: form.providerPolicy,
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
  if (!form.baseUrl.trim() || !form.model.trim()) {
    errorMessage.value = 'Base URL và model là bắt buộc.'
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
      <section class="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div class="flex flex-col gap-4 rounded-xl border border-[#e2ece3] bg-white p-4 sm:p-5">
          <h2 class="m-0 text-base font-extrabold text-[#122815]">Nhà cung cấp</h2>

          <label class="flex items-center gap-3 text-sm font-semibold">
            <input v-model="form.enabled" type="checkbox" class="h-4 w-4 accent-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/30" />
            Bật chatbot cho người dùng
          </label>

          <label class="flex flex-col gap-1.5 text-sm font-bold">
            Chính sách nhà cung cấp
            <input v-model="form.providerPolicy" required autocomplete="off" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" />
          </label>

          <label class="flex flex-col gap-1.5 text-sm font-bold">
            Base URL
            <input v-model="form.baseUrl" type="url" required autocomplete="url" placeholder="https://provider.example/v1" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" />
          </label>

          <label class="flex flex-col gap-1.5 text-sm font-bold">
            Model
            <input v-model="form.model" required autocomplete="off" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" />
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
            <span class="font-normal text-[#667768]">Mỗi hostname một dòng, tối đa 20 hostname.</span>
            <textarea v-model="form.allowedHosts" rows="3" autocomplete="off" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20"></textarea>
          </label>
        </div>

        <div class="flex flex-col gap-4 rounded-xl border border-[#e2ece3] bg-white p-4 sm:p-5">
          <h2 class="m-0 text-base font-extrabold text-[#122815]">Chỉ dẫn và giới hạn</h2>

          <div class="rounded-lg border border-[#d7e5d8] bg-[#f0f7f1] p-3 text-sm text-[#38553b]" role="status">
            System prompt hiện tại: {{ metadata.systemPromptConfigured ? `đã cấu hình (${metadata.systemPromptLength} ký tự)` : 'chưa cấu hình' }}. Nội dung đã lưu không được hiển thị lại.
          </div>
          <label class="flex flex-col gap-1.5 text-sm font-bold">
            Thay thế system prompt
            <span class="font-normal text-[#667768]">Để trống để giữ nguyên prompt hiện tại. Chỉ nội dung mới bạn nhập mới được gửi.</span>
            <textarea v-model="systemPromptReplacement" rows="7" maxlength="20000" autocomplete="off" placeholder="Nhập prompt mới khi bạn muốn thay thế" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20"></textarea>
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
        </div>
      </section>

      <div v-if="testMessage" class="rounded-lg border border-[#8ed694] bg-[#f0f7f1] p-3 text-sm text-[#1e4620]" role="status">{{ testMessage }}</div>
      <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" :disabled="testing || saving || clearingKey" class="rounded-lg border border-[#c8d6c9] bg-white px-4 py-2.5 font-bold text-[#2c3e2e] hover:bg-[#f0f7f1] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/30 disabled:cursor-not-allowed disabled:opacity-60" @click="testConnection">
          {{ testing ? 'Đang kiểm tra...' : 'Kiểm tra kết nối' }}
        </button>
        <button type="submit" :disabled="saving || clearingKey" class="rounded-lg bg-[#1e4620] px-5 py-2.5 font-bold text-white hover:bg-[#2c6e33] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
          {{ saving ? 'Đang lưu...' : 'Lưu cấu hình' }}
        </button>
      </div>
    </form>
  </div>
</template>
