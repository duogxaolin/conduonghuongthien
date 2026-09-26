import { eq } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { aiProviders, aiModelPricing } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import { decryptAiSecret } from '../../../utils/ai/crypto'
import { safeProviderRequest } from '../../../utils/chatbot/outbound'
import { calculateAiCost } from '../../../utils/ai-cost'
import { logAiUsage } from '../../../utils/ai-usage'
import { checkBudget } from '../../../utils/ai-budget'

/**
 * Test call a specific AI model with a real prompt/message.
 * Used by both:
 * 1. "Nhà cung cấp & Models" tab: to test call any model directly with a greeting.
 * 2. "Prompt dịch vụ" tab: to test call the exact configured provider + model + system prompt.
 *
 * Sends an actual chat completion request to the provider's API.
 * Returns the model's text response, duration (ms), token usage, and estimated cost.
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

  if (!providerName) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng chọn nhà cung cấp.' })
  }
  if (!model) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng chọn hoặc nhập mã model cần kiểm tra.' })
  }

  const db = getDb()

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

  // 3. Build outbound request
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

  // 4. Resolve allowed host for SSRF protection
  let allowedHost: string
  try {
    allowedHost = new URL(urlStr).hostname
  } catch {
    return { ok: false, error: `Base URL không hợp lệ: ${urlStr}` }
  }

  // 5. Measure call time and execute
  const startTime = Date.now()

  try {
    const response = await safeProviderRequest({
      url: urlStr,
      allowedHosts: [allowedHost],
      method: 'POST',
      headers,
      body: requestBodyStr,
      timeoutMs: 20_000,
      maxResponseBytes: 131_072,
    })

    const durationMs = Date.now() - startTime

    if (response.status < 200 || response.status >= 300) {
      const errBody = Buffer.from(response.body).toString('utf8').slice(0, 300)
      const serviceKey = typeof body.serviceKey === 'string' && body.serviceKey.trim()
        ? body.serviceKey.trim()
        : 'test_call'
      const errorMsg = `HTTP ${response.status}: ${errBody || 'Lỗi từ máy chủ AI'}`

      await logAiUsage(db, {
        serviceKey,
        provider: providerName,
        model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        costVnd: 0,
        executionMs: durationMs,
        userId: adminUser.id ?? null,
        success: false,
        errorMessage: errorMsg,
      })

      return {
        ok: false,
        model,
        durationMs,
        error: errorMsg,
      }
    }

    // 6. Clean response body (strip trailing SSE data: [DONE] if present)
    let rawBody = Buffer.from(response.body).toString('utf8').trim()
    const lastBrace = rawBody.lastIndexOf('}')
    if (lastBrace !== -1) {
      rawBody = rawBody.slice(0, lastBrace + 1)
    }

    const json = JSON.parse(rawBody) as Record<string, unknown>

    // 7. Extract reply text
    let reply = ''
    if (isAnthropic) {
      const content = json.content
      if (Array.isArray(content) && content.length > 0 && typeof content[0] === 'object' && content[0] !== null) {
        const firstBlock = content[0]
        if ('text' in firstBlock && typeof firstBlock.text === 'string') {
          reply = firstBlock.text
        }
      }
    } else {
      const choices = json.choices
      if (Array.isArray(choices) && choices.length > 0 && typeof choices[0] === 'object' && choices[0] !== null) {
        const firstChoice = choices[0]
        if ('message' in firstChoice && typeof firstChoice.message === 'object' && firstChoice.message !== null) {
          const msg = firstChoice.message
          if ('content' in msg && typeof msg.content === 'string') {
            reply = msg.content
          }
        }
      }
    }

    if (!reply) {
      reply = '(Model đã phản hồi thành công nhưng không có nội dung chữ)'
    }

    // 8. Extract token usage directly from provider response (matches Delify receipts 100%)
    let promptTokens = 0
    let completionTokens = 0
    if ('usage' in json && typeof json.usage === 'object' && json.usage !== null) {
      const u = json.usage
      if ('prompt_tokens' in u && typeof u.prompt_tokens === 'number') promptTokens = u.prompt_tokens
      else if ('input_tokens' in u && typeof u.input_tokens === 'number') promptTokens = u.input_tokens

      if ('completion_tokens' in u && typeof u.completion_tokens === 'number') completionTokens = u.completion_tokens
      else if ('output_tokens' in u && typeof u.output_tokens === 'number') completionTokens = u.output_tokens
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
    // 9. Estimate cost if pricing exists
    let costUsd = 0
    let costVnd = 0
    const [pricing] = await db.select().from(aiModelPricing)
      .where(eq(aiModelPricing.model, model))
      .limit(1)

    if (pricing) {
      const costResult = calculateAiCost(model, promptTokens, completionTokens, {
        model,
        promptCostPerMillion: Number(pricing.promptCostPerMillion),
        completionCostPerMillion: Number(pricing.completionCostPerMillion),
      })
      costUsd = costResult.costUsd
      costVnd = costResult.costVnd
    }

    const serviceKey = typeof body.serviceKey === 'string' && body.serviceKey.trim()
      ? body.serviceKey.trim()
      : 'test_call'

    // 10. Record usage in ai_usage_logs (tracked in call logs and billing!)
    await logAiUsage(db, {
      serviceKey,
      provider: providerName,
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd,
      costVnd,
      executionMs: durationMs,
      userId: adminUser.id ?? null,
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
  } catch (error) {
    const durationMs = Date.now() - startTime
    const msg = error instanceof Error ? error.message : 'Lỗi kết nối'

    const serviceKey = typeof body.serviceKey === 'string' && body.serviceKey.trim()
      ? body.serviceKey.trim()
      : 'test_call'

    await logAiUsage(db, {
      serviceKey,
      provider: providerName,
      model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      costVnd: 0,
      executionMs: durationMs,
      userId: adminUser.id ?? null,
      success: false,
      errorMessage: msg,
    })

    return {
      ok: false,
      model,
      durationMs,
      error: `Thất bại khi gọi API: ${msg}`,
    }
  }
})
