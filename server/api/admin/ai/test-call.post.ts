import { eq } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { aiProviders, aiModelPricing, aiServiceConfigs } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import { decryptAiSecret } from '../../../utils/ai/crypto'
import { ChatbotOutboundError, safeProviderRequest, type SafeProviderResponse } from '../../../utils/chatbot/outbound'
import { calculateAiCost } from '../../../utils/ai-cost'
import { logAiUsage } from '../../../utils/ai-usage'
import { checkBudget } from '../../../utils/ai-budget'

/**
 * `ai_usage_logs.model` and `.service_key` are VARCHAR(64). A longer value fails the
 * insert under MySQL's strict sql_mode, `logAiUsage` swallows that by design, and a
 * call that was sent and paid for never reaches the table `checkBudget` sums.
 */
const USAGE_LOG_FIELD_MAX = 64
// The chatbot's own ceilings — one visitor message (`CHAT_LIMITS.maxMessageChars`) and
// a system prompt (`validateChatbotSettingsUpdate`). Every character is a billed token;
// a test call is no reason for a bigger one.
const MAX_MESSAGE_CHARS = 10_000
const MAX_SYSTEM_PROMPT_CHARS = 20_000
const DEFAULT_SERVICE_KEY = 'test_call'
const REDACTED_KEY = '[đã ẩn khoá API]'

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The key as it can appear in a provider's text: literally, or with any of its
 * characters written as a JSON escape — `\uXXXX` (either case), `\"`, `\\`, `\/` — and
 * a body may escape some characters and not others.
 */
function secretPattern(secret: string): RegExp {
  let source = ''
  for (let index = 0; index < secret.length; index += 1) {
    const char = secret[index]!
    const hex = secret.charCodeAt(index).toString(16).padStart(4, '0').replace(/[a-f]/g, digit => `[${digit}${digit.toUpperCase()}]`)
    const forms = [`\\\\u${hex}`]
    if (char === '"' || char === '\\' || char === '/') forms.push(`\\\\${escapeRegExp(char)}`)
    forms.push(escapeRegExp(char))
    source += `(?:${forms.join('|')})`
  }
  return new RegExp(source, 'g')
}

/**
 * The provider's text with the API key taken out. Providers and proxies echo the
 * credential they rejected ("Incorrect API key provided: sk-…"), raw or JSON-escaped;
 * neither the answer nor `ai_usage_logs.error_message` (shown in the AI Logs tab) may
 * carry it. Applied to the raw body before it is cut, and to the reply after parsing.
 */
function withoutSecret(text: string, secret: string): string {
  return secret ? text.replace(secretPattern(secret), REDACTED_KEY) : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The answer as a JSON object (a trailing SSE `data: [DONE]` cut off), or null. */
function parseProviderJson(text: string): Record<string, unknown> | null {
  let raw = text.trim()
  const lastBrace = raw.lastIndexOf('}')
  if (lastBrace !== -1) raw = raw.slice(0, lastBrace + 1)
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Test call a specific AI model with a real prompt/message.
 * Used by both:
 * 1. "Nhà cung cấp & Models" tab: to test call any model directly with a greeting.
 * 2. "Prompt dịch vụ" tab: to test call the exact configured provider + model + system prompt.
 *
 * Sends an actual chat completion request to the provider's API.
 * Returns the model's text response, duration (ms), token usage, and estimated cost.
 *
 * Every database read happens BEFORE the paid call: after it only `logAiUsage` runs
 * (which never throws), so a database failure cannot be reported as a provider
 * failure or leave a paid call recorded as failed at zero cost.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const providerName = typeof body.provider === 'string' ? body.provider.trim() : ''
  const model = typeof body.model === 'string' ? body.model.trim() : ''
  const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : ''
  const message = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : 'Xin chào! Bạn là ai?'
  const temperature = typeof body.temperature === 'number' && Number.isFinite(body.temperature) ? Math.max(0, Math.min(body.temperature, 2)) : 0.3
  const maxTokens = typeof body.maxTokens === 'number' && Number.isFinite(body.maxTokens) ? Math.max(1, Math.min(body.maxTokens, 1024)) : 150
  const requestedServiceKey = typeof body.serviceKey === 'string' && body.serviceKey.trim() ? body.serviceKey.trim() : DEFAULT_SERVICE_KEY

  if (!providerName) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng chọn nhà cung cấp.' })
  }
  if (!model) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng chọn hoặc nhập mã model cần kiểm tra.' })
  }
  if (model.length > USAGE_LOG_FIELD_MAX) {
    throw createError({ statusCode: 400, statusMessage: `Mã model dài quá ${USAGE_LOG_FIELD_MAX} ký tự.` })
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    throw createError({ statusCode: 400, statusMessage: `Tin nhắn thử dài quá ${MAX_MESSAGE_CHARS} ký tự.` })
  }
  if (systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
    throw createError({ statusCode: 400, statusMessage: `Prompt hệ thống dài quá ${MAX_SYSTEM_PROMPT_CHARS} ký tự.` })
  }

  const db = getDb()

  // The call is billed to `test_call` or to a configured service (the "Prompt dịch
  // vụ" tab) — never to a label the client made up. The stored spelling is kept.
  let serviceKey = DEFAULT_SERVICE_KEY
  if (requestedServiceKey !== DEFAULT_SERVICE_KEY) {
    const [service] = await db.select({ serviceKey: aiServiceConfigs.serviceKey }).from(aiServiceConfigs)
      .where(eq(aiServiceConfigs.serviceKey, requestedServiceKey))
      .limit(1)
    if (!service) {
      throw createError({ statusCode: 400, statusMessage: 'Dịch vụ AI không tồn tại.' })
    }
    serviceKey = service.serviceKey
  }

  // 0. Check quota/budget before making test call
  const budgetResult = await checkBudget(db, 'test_call')
  if (!budgetResult.allowed) {
    return {
      ok: false,
      error: budgetResult.errorMessage ?? 'Hệ thống hết ngân sách cho AI. Vui lòng nạp thêm ngân sách để tiếp tục sử dụng.',
    }
  }
  // 1. Load provider
  const [provider] = await db.select().from(aiProviders)
    .where(eq(aiProviders.provider, providerName))
    .limit(1)

  if (!provider) {
    return { ok: false, error: `Nhà cung cấp "${providerName}" không tồn tại trong hệ thống.` }
  }

  if (!provider.apiKeyCiphertext || !provider.apiKeyNonce || !provider.apiKeyAuthTag || !provider.apiKeyVersion || !provider.apiKeyKeyId) {
    return { ok: false, error: `Chưa cấu hình API key cho nhà cung cấp "${provider.label}". Vui lòng nhập API key trước.` }
  }

  if (!provider.baseUrl) {
    return { ok: false, error: `Chưa cấu hình Base URL cho nhà cung cấp "${provider.label}".` }
  }

  // 2. Decrypt API key
  let secret: string
  try {
    secret = decryptAiSecret({
      ciphertext: provider.apiKeyCiphertext,
      nonce: provider.apiKeyNonce,
      authTag: provider.apiKeyAuthTag,
      version: provider.apiKeyVersion,
      keyId: provider.apiKeyKeyId,
      lastFour: provider.apiKeyLastFour ?? '',
    })
  } catch {
    return { ok: false, error: 'Không thể giải mã API key của nhà cung cấp. Vui lòng cập nhật lại key.' }
  }

  // 3. Pricing, read now so nothing touches the database between the call and its record.
  const [pricing] = await db.select().from(aiModelPricing)
    .where(eq(aiModelPricing.model, model))
    .limit(1)

  // 4. Build outbound request
  const isAnthropic = providerName === 'anthropic'
  let urlStr: string
  let headers: Record<string, string>
  let requestBodyStr: string

  const cleanBase = provider.baseUrl.replace(/\/+$/g, '')

  if (isAnthropic) {
    urlStr = cleanBase.endsWith('/v1') ? `${cleanBase}/messages` : `${cleanBase}/v1/messages`
    headers = {
      'x-api-key': secret,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
    const payload: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: message }],
      temperature,
    }
    if (systemPrompt) payload.system = systemPrompt
    requestBodyStr = JSON.stringify(payload)
  } else {
    // OpenAI-compatible (OpenAI, Delify, DeepSeek, Google Gemini OpenAI-compat)
    urlStr = cleanBase.endsWith('/chat/completions')
      ? cleanBase
      : cleanBase.endsWith('/v1')
        ? `${cleanBase}/chat/completions`
        : `${cleanBase}/v1/chat/completions`

    headers = {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }

    const messages = []
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }
    messages.push({ role: 'user', content: message })

    requestBodyStr = JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    })
  }

  // 5. Resolve allowed host for SSRF protection
  let allowedHost: string
  try {
    allowedHost = new URL(urlStr).hostname
  } catch {
    return { ok: false, error: `Base URL không hợp lệ: ${urlStr}` }
  }

  const usageBase = { serviceKey, provider: providerName, model, userId: adminUser.id ?? null }
  const recordFailure = (executionMs: number, errorMessage: string) => logAiUsage(db, {
    ...usageBase,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    costVnd: 0,
    executionMs,
    success: false,
    errorMessage,
  })

  // 6. Measure call time and execute
  const startTime = Date.now()
  let response: SafeProviderResponse
  try {
    response = await safeProviderRequest({
      url: urlStr,
      allowedHosts: [allowedHost],
      method: 'POST',
      headers,
      body: requestBodyStr,
      timeoutMs: 20_000,
      maxResponseBytes: 131_072,
    })
  } catch (error) {
    const durationMs = Date.now() - startTime
    // `safeProviderRequest` throws classified errors whose message is written for
    // the client; anything else is reported without its text.
    const msg = error instanceof ChatbotOutboundError ? error.message : 'Lỗi kết nối'
    await recordFailure(durationMs, msg)
    return { ok: false, model, durationMs, error: `Thất bại khi gọi API: ${msg}` }
  }

  const durationMs = Date.now() - startTime
  const text = Buffer.from(response.body).toString('utf8')

  if (response.status < 200 || response.status >= 300) {
    // Redact BEFORE cutting: a key that straddles the cut would leave its start behind.
    const errorMsg = `HTTP ${response.status}: ${withoutSecret(text, secret).slice(0, 300) || 'Lỗi từ máy chủ AI'}`
    await recordFailure(durationMs, errorMsg)
    return { ok: false, model, durationMs, error: errorMsg }
  }

  // 7. Parse — a body that is not a JSON object is a failed call, reported in our words
  // (V8's SyntaxError quotes the start of the text). Nothing of the body leaves this
  // handler but the reply, which is redacted once decoded (step 8).
  const json = parseProviderJson(text)
  if (!json) {
    const errorMsg = 'Phản hồi của nhà cung cấp không phải JSON hợp lệ.'
    await recordFailure(durationMs, errorMsg)
    return { ok: false, model, durationMs, error: `Thất bại khi gọi API: ${errorMsg}` }
  }

  // 8. Extract reply text
  let reply = ''
  if (isAnthropic) {
    const content = json.content
    if (Array.isArray(content) && content.length > 0 && isRecord(content[0])) {
      const firstBlock = content[0]
      if (typeof firstBlock.text === 'string') {
        reply = firstBlock.text
      }
    }
  } else {
    const choices = json.choices
    if (Array.isArray(choices) && choices.length > 0 && isRecord(choices[0])) {
      const msg = choices[0].message
      if (isRecord(msg) && typeof msg.content === 'string') {
        reply = msg.content
      }
    }
  }

  // After JSON decoding: a key the body wrote as `\uXXXX` escapes is plain text here.
  reply = withoutSecret(reply, secret)

  if (!reply) {
    reply = '(Model đã phản hồi thành công nhưng không có nội dung chữ)'
  }

  // 9. Extract token usage directly from provider response (matches Delify receipts 100%)
  let promptTokens = 0
  let completionTokens = 0
  if (isRecord(json.usage)) {
    const u = json.usage
    if (typeof u.prompt_tokens === 'number') promptTokens = u.prompt_tokens
    else if (typeof u.input_tokens === 'number') promptTokens = u.input_tokens

    if (typeof u.completion_tokens === 'number') completionTokens = u.completion_tokens
    else if (typeof u.output_tokens === 'number') completionTokens = u.output_tokens
  }
  // Delify Router completions API offset of 2000 tokens vs official receipt API
  if (providerName === 'delify' && promptTokens >= 2000) {
    promptTokens -= 2000
  }
  // Fallback only if provider returned 0 tokens:
  if (!promptTokens) {
    promptTokens = Math.max(1, Math.ceil(message.length / 3.5))
  }
  if (!completionTokens) {
    completionTokens = Math.max(1, Math.ceil(reply.length / 3.5))
  }
  // 10. Estimate cost if pricing exists
  let costUsd = 0
  let costVnd = 0
  if (pricing) {
    const costResult = calculateAiCost(model, promptTokens, completionTokens, {
      model,
      promptCostPerMillion: Number(pricing.promptCostPerMillion),
      completionCostPerMillion: Number(pricing.completionCostPerMillion),
    })
    costUsd = costResult.costUsd
    costVnd = costResult.costVnd
  }

  // 11. Record usage in ai_usage_logs (tracked in call logs and billing!)
  await logAiUsage(db, {
    ...usageBase,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUsd,
    costVnd,
    executionMs: durationMs,
    success: true,
  })

  return {
    ok: true,
    model,
    provider: providerName,
    reply,
    durationMs,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
    costVnd,
  }
})
