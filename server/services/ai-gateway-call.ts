/**
 * AI Gateway — unified entry point for all AI calls (spec R10, design.md D3).
 *
 * `callAi(serviceKey, { prompt, variables, userId, db })` is the single choke-point:
 * every AI call — chatbot, translation, editorial — goes through this function.
 *
 * Steps:
 *   1. Load `ai_service_configs` row for `serviceKey` (cached 60s).
 *   2. Load `ai_providers` row for the service's `provider` (cached 60s).
 *   3. Decrypt the API key.
 *   4. Check budget (spec R9).
 *   5. Substitute `{{variables}}` in `system_prompt`.
 *   6. Build the HTTP request using existing `chatbot/providers.ts` patterns.
 *   7. Send via `chatbot/outbound.ts` — `safeProviderRequest` (buffered) or
 *      `safeProviderStream` (SSE). No path uses a bare `fetch`: the provider URL
 *      policy (`utils/ai/provider-url.ts`) is checked first, then DNS→public IP
 *      pinned to the socket, https/443, no redirects, deadline, byte cap.
 *   8. Parse usage tokens from the response (provider-specific strategy).
 *   9. Calculate cost via `calculateAiCost`.
 *  10. Log to `ai_usage_logs` (awaited, errors caught).
 *  11. Return `{ ok: true, text }` or `{ ok: false, error }`.
 *
 * Part of the `ai-gateway.ts` family (wave3-long-term 4.3, D-SPLIT): callers import the
 * barrel `./ai-gateway`, never this file. `callAi` is moved here whole, byte for byte —
 * one 545-line function kept in one piece so the move is provably unchanged (capped in
 * `tests/ratchets/file-length.test.ts`); splitting it is a follow-up, pinned by
 * `tests/ai-gateway-seams-behavior.test.ts`.
 */
import { cleanAiContent } from './ai-text-cleaner'
import { extractToolCallsFromMessage, parseProviderResponse, parseToolArguments } from './ai-response-parse'
import { readChatSse, type ChatSseUsage, type ToolCallAccumulator } from './ai-sse'
import { getDb } from '../utils/db'
import { decryptAiSecret } from '../utils/ai/crypto'
import { calculateAiCost, type AiModelPricingEntry } from '../utils/ai-cost'
import { checkBudget } from '../utils/ai-budget'
import { logAiUsage } from '../utils/ai-usage'
import { logWarn, logInfo } from '../utils/logger'
import {
  safeProviderRequest, safeProviderStream,
  type SafeProviderResponse, type SafeProviderStreamResponse,
} from '../utils/chatbot/outbound'
import { checkProviderBaseUrl } from '../utils/ai/provider-url'
import {
  buildProviderChatCall, resolveProviderPolicy, type ProviderCall,
} from '../utils/chatbot/providers'
import type { AiCallInput, AiCallResult } from './ai-gateway-types'
import { loadPricing, loadProvider, loadServiceConfig, policyForProvider, substituteVariables } from './ai-gateway-config'

// Giới hạn đường ra của vòng gọi công cụ. Bước không stream của vòng công cụ
// trước đây dùng `fetch` trần — không hạn giờ, không trần dung lượng. Hạn giờ bằng
// hạn tổng của luồng SSE (outbound.ts): model suy luận có thể mất tới ~200 s trước
// khi trả gì, và quyết định đã chốt là đợi chứ không bỏ (sse-heartbeat.ts).
const TOOL_STEP_TIMEOUT_MS = 300_000
const TOOL_STEP_MAX_RESPONSE_BYTES = 1024 * 1024

/**
 * Call an AI service. This is the single entry point for all AI calls (spec R10.1).
 *
 * @returns `{ ok: true, text }` on success, `{ ok: false, error }` on failure.
 *          Failure reasons: 'service_inactive', 'no_api_key', 'budget_exceeded',
 *          'provider_url_rejected' (stored base URL fails the provider URL policy —
 *          no network call made), 'provider_error', 'parse_error'.
 */
export async function callAi(serviceKey: string, input: AiCallInput): Promise<AiCallResult> {
  const db = input.db ?? getDb()

  // 1. Load service config (spec R10.1 step 1).
  const config = await loadServiceConfig(db, serviceKey)
  if (!config) {
    return { ok: false, error: 'service_not_found' }
  }
  if (!config.isActive) {
    return { ok: false, error: 'service_inactive' }
  }

  // 2. Check budget (spec R10.1 step 3, R9).
  const budgetResult = await checkBudget(db, serviceKey)
  if (!budgetResult.allowed) {
    return {
      ok: false,
      error: budgetResult.reason ?? 'budget_exceeded',
      errorMessage: budgetResult.errorMessage ?? 'Hệ thống hết ngân sách cho AI',
    }
  }

  // 3. Load provider and decrypt key (spec R10.1 steps 2, R10.4).
  const providerRow = await loadProvider(db, config.provider)
  if (!providerRow || !providerRow.apiKeyCiphertext || !providerRow.apiKeyNonce || !providerRow.apiKeyAuthTag || !providerRow.apiKeyVersion || !providerRow.apiKeyKeyId) {
    logWarn({
      event: 'ai_gateway.key_unavailable',
      serviceKey,
      provider: config.provider,
      reason: providerRow ? 'no_key_stored' : 'provider_not_existent',
    })
    return { ok: false, error: 'no_api_key' }
  }

  let secret: string
  try {
    secret = decryptAiSecret({
      ciphertext: providerRow.apiKeyCiphertext,
      nonce: providerRow.apiKeyNonce,
      authTag: providerRow.apiKeyAuthTag,
      version: providerRow.apiKeyVersion,
      keyId: providerRow.apiKeyKeyId,
      lastFour: providerRow.apiKeyLastFour ?? '',
    })
  } catch {
    logWarn({
      event: 'ai_gateway.key_unavailable',
      serviceKey,
      provider: config.provider,
      reason: 'decrypt_failed',
    })
    return { ok: false, error: 'no_api_key' }
  }

  // 4. Substitute template variables (spec R10.1 step 4, R5.5).
  const rawSystemPrompt = input.systemPrompt ?? config.systemPrompt ?? ''
  const systemPrompt = substituteVariables(
    rawSystemPrompt,
    input.variables ?? {},
  )

  // 5. Build the HTTP request (spec R10.1 step 6).
  const policy = policyForProvider(config.provider)
  const baseUrl = providerRow.baseUrl ?? ''
  const model = config.model ?? ''
  if (!baseUrl || !model) {
    return { ok: false, error: 'service_inactive' }
  }

  // Kiểm chính sách địa chỉ TRƯỚC khi dựng request mang khoá API. Một hàng lưu từ
  // trước khi có kiểm lúc ghi (http://, IP, localhost, cổng lạ…) dừng ở đây — không
  // phân giải DNS, không mở kết nối. Phần DNS→IP công khai kiểm tiếp trong outbound.
  const baseUrlCheck = checkProviderBaseUrl(baseUrl)
  if (!baseUrlCheck.ok) {
    logWarn({
      event: 'ai_gateway.provider_url_rejected',
      serviceKey,
      provider: config.provider,
      violation: baseUrlCheck.violation,
    })
    return { ok: false, error: 'provider_url_rejected', errorMessage: baseUrlCheck.message }
  }

  const providerCall: ProviderCall = buildProviderChatCall({
    policy,
    baseUrl: baseUrlCheck.url,
    model,
    secret,
    systemPrompt,
    history: input.history ?? [{ role: 'user', content: input.prompt }],
    maxTokens: config.maxTokens ? Number(config.maxTokens) : undefined,
  })

  // 6. Every request below goes through `outbound.ts`. `allowedHosts` is derived
  //    from the same URL, so on its own it proves nothing — the guards that matter
  //    are `checkProviderBaseUrl` above (write-time policy re-checked at call time)
  //    and, inside outbound, DNS→public-IP with the checked IP pinned to the socket,
  //    https/443 only, no redirects, a deadline and a byte cap.
  const url = new URL(providerCall.url)
  const allowedHosts = [url.hostname]
  const transport = input.transport
  const postJson = (body: string): Promise<SafeProviderResponse> => safeProviderRequest({
    url: providerCall.url,
    allowedHosts,
    method: 'POST',
    headers: providerCall.headers,
    body,
    timeoutMs: TOOL_STEP_TIMEOUT_MS,
    maxResponseBytes: TOOL_STEP_MAX_RESPONSE_BYTES,
    resolveHost: transport?.resolveHost,
    request: transport?.request,
  })
  /** `body` is `null` exactly when the status is not 2xx. */
  const postStream = (body: string): Promise<SafeProviderStreamResponse> => safeProviderStream({
    url: providerCall.url,
    allowedHosts,
    method: 'POST',
    headers: providerCall.headers,
    body,
    resolveHost: transport?.resolveHost,
    request: transport?.request,
  })
  const responseText = (response: SafeProviderResponse): string => Buffer.from(response.body).toString('utf8')
  const isSuccess = (status: number): boolean => status >= 200 && status < 300

  // 7. Measure execution time from before the provider call (spec R10.6).
  const startTime = Date.now()
  let success = true
  let errorMessage: string | null = null
  let answerText = ''
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  const toolCallsExecuted: Array<{ name: string; query?: string; count?: number; data?: unknown }> = []
  // A local const so the narrowing survives into the streaming helpers below.
  const onChunk = input.onChunk

  /**
   * Usage reported by a streamed step of the tool loop: each step ADDS to the
   * running totals. delify bills 2000 prompt tokens of its own overhead per call,
   * and an `estimated` figure is the provider guessing — never billed.
   */
  const addStepUsage = ({ promptTokens: prompt, completionTokens: completion, estimated }: ChatSseUsage) => {
    const adjusted = config.provider === 'delify' && prompt >= 2000 ? prompt - 2000 : prompt
    if (adjusted > 0 && !estimated) promptTokens += adjusted
    if (completion > 0 && !estimated) completionTokens += completion
  }

  if (Array.isArray(input.tools) && input.tools.length > 0) {
    // ── Multi-Step Tool Calling Execution Loop ────────────────────────
    try {
      const toolDefs = input.tools
      const reqBodyObj = JSON.parse(providerCall.body ?? '{}') as Record<string, unknown>
      const originalMaxTokens = reqBodyObj.max_tokens ?? 1024
      const formattedTools = toolDefs.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
      const messages = (reqBodyObj.messages as Array<unknown>) || []

      // Step 1: Non-streaming call to evaluate tool choice.
      // `tool_choice: 'auto'` lets the model reason and decide for itself
      // whether a tool call is warranted — this is the right default for a
      // reasoning-capable model. Previously 'required' forced a tool call on
      // every question including openers ("tôi vừa đi tù về") where the model
      // should answer directly from the knowledge bank. With 'auto', the
      // model can think ("câu này cần dẫn chứng bài viết → gọi
      // search_c11_articles") or answer straight. The grounded system prompt
      // (chat-policy.ts buildGroundedSystemPrompt) strongly instructs tool
      // use for evidence; a model that answers without a tool simply answers.
      // `max_tokens` matches the service config (default 4096): 300 was too
      // tight — the model spent its budget on the reasoning prefix and never
      // reached the tool_call block.
      reqBodyObj.messages = messages
      reqBodyObj.tools = formattedTools
      reqBodyObj.tool_choice = 'auto'
      reqBodyObj.max_tokens = originalMaxTokens

      // Step 1: Ask the model to decide whether a tool call is needed.
      // When the caller provides `onChunk`, we stream this step so the
      // visitor sees the model's answer tokens in real time instead of
      // waiting 20-30 s for a reasoning model's first token (TTFT ~30 s →
      // ~1-2 s). Tool-call deltas arriving in the SSE stream are accumulated
      // into the same structure the non-streaming path produces, so
      // `extractToolCallsFromMessage` and the Step 2 branch work unchanged.
      let msg1: Record<string, unknown> | undefined
      if (onChunk) {
        reqBodyObj.stream = true
        const resp1 = await postStream(JSON.stringify(reqBodyObj))
        if (!resp1.body) {
          success = false
          errorMessage = `HTTP ${resp1.status}`
          return { ok: false, error: 'provider_error' }
        }
        const toolCallAccum: ToolCallAccumulator = {}
        const step1 = await readChatSse(resp1.body, { emit: onChunk, onUsage: addStepUsage, toolCalls: toolCallAccum })
        answerText += step1.relayed
        const streamText = step1.streamText
        // Object.values on numeric keys returns ascending index order in V8.
        const accumulatedToolCalls = Object.values(toolCallAccum)
        msg1 = {
          role: 'assistant',
          content: streamText || null,
          tool_calls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
        }
      } else {
        reqBodyObj.stream = false
        const resp1 = await postJson(JSON.stringify(reqBodyObj))
        if (!isSuccess(resp1.status)) {
          success = false
          errorMessage = `HTTP ${resp1.status}`
          return { ok: false, error: 'provider_error' }
        }
        let raw1 = responseText(resp1)
        const last1 = raw1.lastIndexOf('}')
        if (last1 !== -1) raw1 = raw1.slice(0, last1 + 1)
        const json1 = JSON.parse(raw1) as Record<string, unknown>
        const choice1 = (json1.choices as Array<{ message?: Record<string, unknown>; finish_reason?: string }>)?.[0]
        msg1 = choice1?.message

        let step1Prompt = Number((json1.usage as { prompt_tokens?: number })?.prompt_tokens) || 0
        const step1Comp = Number((json1.usage as { completion_tokens?: number })?.completion_tokens) || 0
        if (config.provider === 'delify' && step1Prompt >= 2000) step1Prompt -= 2000
        promptTokens += step1Prompt
        completionTokens += step1Comp
      }

      const toolCalls = extractToolCallsFromMessage(msg1, toolDefs)

      if (toolCalls.length > 0) {
        const cleanAssistantMsg = {
          role: 'assistant',
          content: null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.function.name,
              arguments: typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments),
            },
          })),
        }
        messages.push(cleanAssistantMsg)
        for (const tc of toolCalls) {
          const fn = toolDefs.find(t => t.name === tc.function?.name)
          const args = parseToolArguments(tc.function?.arguments)
          let qStr = ''
          if (args && typeof args === 'object') {
            qStr = String(args.query || args.keyword || (args.type ? `chủ đề: ${args.type}` : ''))
          }

          if (input.onToolCall) {
            await input.onToolCall({
              name: tc.function?.name,
              query: qStr || undefined,
              status: 'calling',
            })
          }

          let toolResult: unknown = null
          if (fn) {
            try {
              toolResult = await fn.execute(args)
            } catch (err: unknown) {
              toolResult = { error: err instanceof Error ? err.message : 'Tool execution error' }
            }
          } else {
            toolResult = { error: `Tool ${tc.function?.name} not found` }
          }

          const itemCount = Array.isArray(toolResult) ? toolResult.length : (toolResult ? 1 : 0)
          toolCallsExecuted.push({
            name: tc.function?.name,
            query: qStr || undefined,
            count: itemCount,
            data: toolResult,
          })

          if (input.onToolCall) {
            await input.onToolCall({
              name: tc.function?.name,
              query: qStr || undefined,
              status: 'done',
              count: itemCount,
              result: toolResult,
            })
          }

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
          })
        }

        // Step 2: Final response with tool results (remove tools and stream response in real-time)
        delete reqBodyObj.tools
        delete reqBodyObj.tool_choice
        reqBodyObj.max_tokens = originalMaxTokens
        if (onChunk) {
          reqBodyObj.stream = true
          const resp2 = await postStream(JSON.stringify(reqBodyObj))
          if (!resp2.body) {
            success = false
            errorMessage = `HTTP ${resp2.status}`
            return { ok: false, error: 'provider_error' }
          }
          const step2 = await readChatSse(resp2.body, { emit: onChunk, onUsage: addStepUsage })
          answerText += step2.relayed
          if (!answerText.trim()) answerText = step2.finalText()
          if (!answerText) {
            answerText = step2.streamText.replace(/<\|channel>[\s\S]*?<channel\|>/gi, '').trim()
          }
        } else {
          reqBodyObj.stream = false
          const resp2 = await postJson(JSON.stringify(reqBodyObj))
          if (!isSuccess(resp2.status)) {
            success = false
            errorMessage = `HTTP ${resp2.status}`
            return { ok: false, error: 'provider_error' }
          }
          let raw2 = responseText(resp2)
          const last2 = raw2.lastIndexOf('}')
          if (last2 !== -1) raw2 = raw2.slice(0, last2 + 1)
          const json2 = JSON.parse(raw2) as Record<string, unknown>
          const choice2 = (json2.choices as Array<{ message?: { content?: string } }>)?.[0]
          const raw2Content = choice2?.message?.content || ''
          answerText = cleanAiContent(raw2Content).trim()
          if (!answerText) {
            answerText = raw2Content.replace(/<\|channel>[\s\S]*?<channel\|>/gi, '').trim()
          }
          let p2 = Number((json2.usage as { prompt_tokens?: number })?.prompt_tokens) || 0
          const c2 = Number((json2.usage as { completion_tokens?: number })?.completion_tokens) || 0
          if (config.provider === 'delify' && p2 >= 2000) p2 -= 2000
          promptTokens += p2
          completionTokens += c2
        }
      } else {
        // Model answered directly without tool calls.
        //
        // When step 1 was streamed (`onChunk`), that stream already carried the
        // answer to the visitor — `answerText` holds it. Asking the provider again
        // here appended a SECOND, different answer to the first ("…ạ?Chào
        // anh/chị…") and billed the call twice. The follow-up request is only the
        // safety net for a step 1 that produced nothing visible (all reasoning).
        const answeredInStep1 = Boolean(onChunk) && answerText.trim() !== ''
        if (onChunk && !answeredInStep1) {
          delete reqBodyObj.tools
          delete reqBodyObj.tool_choice
          reqBodyObj.max_tokens = originalMaxTokens
          reqBodyObj.stream = true
          const respDirect = await postStream(JSON.stringify(reqBodyObj))
          if (respDirect.body) {
            const direct = await readChatSse(respDirect.body, { emit: onChunk, onUsage: addStepUsage })
            answerText += direct.relayed
            if (!answerText.trim()) answerText = direct.finalText()
          }
        }
        if (!answerText) {
          answerText = cleanAiContent((msg1?.content as string) || '')
        }
      }
      totalTokens = promptTokens + completionTokens
      if (!answerText) {
        success = false
        errorMessage = 'empty_response'
        return { ok: false, error: 'parse_error' }
      }
    } catch (error) {
      success = false
      errorMessage = error instanceof Error ? error.message : 'unknown_error'
      return { ok: false, error: 'provider_error' }
    }
  } else if (onChunk) {
    // Real-time streaming from provider via SSE
    try {
      const streamBody = JSON.parse(providerCall.body ?? '{}')
      // `buildProviderChatCall` builds the body with `stream: false`; without this the
      // provider answers with one JSON document, this reader finds no `data:` lines,
      // and the call ends as an empty response.
      streamBody.stream = true
      const response = await postStream(JSON.stringify(streamBody))

      if (!response.body) {
        success = false
        errorMessage = `HTTP ${response.status}`
        return { ok: false, error: 'provider_error' }
      }

      // `createStreamingCleaner` is required here for the SAME reason the
      // tool-call streaming branch (above) requires it: the provider leaks
      // reasoning markers (``, `<|channel>…`, "Actually, I'll try…") into the
      // SSE delta stream, and those spans straddle chunk boundaries. Pushing
      // raw `delta` to `onChunk` emits the raw markers to the visitor and, once
      // the closer arrives, the held-back region drops — but the client has
      // already rendered the leak. This branch is the no-tools path (provider
      // answers directly), and skipping the cleaner here was the regression:
      // garbled/cut text reappeared whenever the model answered without tool
      // calls. The fix mirrors the tool-call branch exactly.
      // One request, one step: a later usage event REPLACES the earlier one (a real
      // figure beats an estimate, never the other way round), unlike the tool loop
      // where every step adds. delify's 2000-token overhead comes off at the end.
      const streamed = await readChatSse(response.body, {
        emit: onChunk,
        onUsage: ({ promptTokens: prompt, completionTokens: completion, estimated }) => {
          if (prompt > 0 && (!promptTokens || !estimated)) promptTokens = prompt
          if (completion > 0 && (!completionTokens || !estimated)) completionTokens = completion
        },
      })
      answerText += streamed.relayed
      if (!answerText.trim()) answerText = streamed.finalText()

      if (!answerText) {
        success = false
        errorMessage = 'empty_response'
        return { ok: false, error: 'parse_error' }
      }
      if (config.provider === 'delify' && promptTokens >= 2000) {
        promptTokens -= 2000
      }
      if (!promptTokens) promptTokens = Math.max(1, Math.ceil(input.prompt.length / 3.5))
      if (!completionTokens) completionTokens = Math.max(1, Math.ceil(answerText.length / 3.5))
      totalTokens = promptTokens + completionTokens
    } catch (error) {
      success = false
      errorMessage = error instanceof Error ? error.message : 'unknown_error'
      return { ok: false, error: 'provider_error' }
    }
  } else {
    try {
      const response = await safeProviderRequest({
        url: providerCall.url,
        allowedHosts,
        method: 'POST',
        headers: providerCall.headers,
        body: providerCall.body,
        timeoutMs: 35_000,
        maxResponseBytes: 262_144,
        resolveHost: transport?.resolveHost,
        request: transport?.request,
      })

      if (response.status < 200 || response.status >= 300) {
        success = false
        errorMessage = `HTTP ${response.status}`
        return { ok: false, error: 'provider_error' }
      }

      let rawText = Buffer.from(response.body).toString('utf8').trim()
      const lastBrace = rawText.lastIndexOf('}')
      if (lastBrace !== -1) {
        rawText = rawText.slice(0, lastBrace + 1)
      }
      const payload = JSON.parse(rawText) as unknown
      const parsed = parseProviderResponse(config.provider, payload, resolveProviderPolicy(policy))
      answerText = parsed.answerText
      promptTokens = parsed.promptTokens
      completionTokens = parsed.completionTokens
      totalTokens = parsed.totalTokens
      if (config.provider === 'delify' && promptTokens >= 2000) {
        promptTokens -= 2000
      }
      if (!promptTokens) promptTokens = Math.max(1, Math.ceil(input.prompt.length / 3.5))
      if (!completionTokens) completionTokens = Math.max(1, Math.ceil(answerText.length / 3.5))
      totalTokens = promptTokens + completionTokens
      if (!answerText) {
        success = false
        errorMessage = 'empty_response'
        return { ok: false, error: 'parse_error' }
      }
    } catch (error) {
      success = false
      errorMessage = error instanceof Error ? error.message : 'unknown_error'
      return { ok: false, error: 'provider_error' }
    }
  }
  const executionMs = Date.now() - startTime

  // 8. Calculate cost (spec R10.1 step 9).


  const pricingRow = await loadPricing(db, model)
  if (!pricingRow) {
    logWarn({
      event: 'ai_usage.no_pricing',
      model,
      serviceKey,
    })
  }

  const pricingEntry: AiModelPricingEntry | null = pricingRow
    ? {
        model: pricingRow.model,
        promptCostPerMillion: pricingRow.promptCostPerMillion,
        completionCostPerMillion: pricingRow.completionCostPerMillion,
      }
    : null

  const { costUsd, costVnd } = calculateAiCost(model, promptTokens, completionTokens, pricingEntry)

  // 9. Log usage (awaited, errors caught — spec R10.5).
  await logAiUsage(db, {
    serviceKey,
    provider: config.provider,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd,
    costVnd,
    executionMs,
    userId: input.userId ?? null,
    success,
    errorMessage,
  })

  if (success) {
    logInfo({
      event: 'ai_gateway.call_succeeded',
      serviceKey,
      provider: config.provider,
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      costVnd,
      executionMs,
    })
  }

  return {
    ok: true,
    text: answerText,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd,
    costVnd,
    toolCallsExecuted: toolCallsExecuted.length > 0 ? toolCallsExecuted : undefined,
  }
}
