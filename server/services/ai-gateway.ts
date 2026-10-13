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
 *   7. Send via `chatbot/outbound.ts` `safeProviderRequest`.
 *   8. Parse usage tokens from the response (provider-specific strategy).
 *   9. Calculate cost via `calculateAiCost`.
 *  10. Log to `ai_usage_logs` (awaited, errors caught).
 *  11. Return `{ ok: true, text }` or `{ ok: false, error }`.
 */
import { eq } from 'drizzle-orm'
import { cleanAiContent, createStreamingCleaner } from './ai-text-cleaner'
import { extractToolCallsFromMessage, parseProviderResponse, parseToolArguments } from './ai-response-parse'
import { readChatSse, type ChatSseUsage, type ToolCallAccumulator } from './ai-sse'

export { createStreamingCleaner, extractToolCallsFromMessage, parseToolArguments }
import { getDb, type Database } from '../utils/db'
import {
  aiServiceConfigs, aiProviders, aiModelPricing,
  type AiServiceConfig, type AiProvider, type AiModelPricing,
} from '../db/schema'
import { decryptAiSecret } from '../utils/ai/crypto'
import { calculateAiCost, type AiModelPricingEntry } from '../utils/ai-cost'
import { checkBudget } from '../utils/ai-budget'
import { logAiUsage } from '../utils/ai-usage'
import { logWarn, logInfo } from '../utils/logger'
import { safeProviderRequest } from '../utils/chatbot/outbound'
import {
  buildProviderChatCall, resolveProviderPolicy, type ProviderCall,
} from '../utils/chatbot/providers'


// ─── Types ──────────────────────────────────────────────────────────────

export interface AiToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown
}

export interface AiCallInput {
  /** The user's prompt text. */
  prompt: string
  /** Override the system prompt from the service config (used by chatbot to inject grounded references). */
  systemPrompt?: string
  /** Template variables to substitute into `system_prompt` `{{key}}` placeholders. */
  variables?: Record<string, string>
  /** The admin user ID triggering the call (for usage logging), or null. */
  userId?: number | null
  db?: Database
  /** Chat history: prior user turns, oldest first. */
  history?: Array<{ role: string; content: string }>
  /** Optional callback for real-time token streaming */
  onChunk?: (chunk: string) => void | Promise<void>
  /** Optional callback for real-time tool execution events */
  onToolCall?: (event: { name: string; query?: string; status: 'calling' | 'done'; count?: number; result?: unknown }) => void | Promise<void>
  /** Optional tool calling / function calling definitions */
  tools?: AiToolDefinition[]
}
export interface AiCallResult {
  ok: boolean
  text?: string
  error?: string
  errorMessage?: string
  /** Usage metadata (filled on success for callers that need it). */
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  costUsd?: number
  costVnd?: number
  /** Tools executed during this call */
  toolCallsExecuted?: Array<{ name: string; query?: string; count?: number; data?: unknown }>
}

interface CachedConfig {
  config: AiServiceConfig | null
  loadedAt: number
}

interface CachedProvider {
  provider: AiProvider | null
  loadedAt: number
}

const CACHE_TTL_MS = 60_000

// ─── Module-level caches ───────────────────────────────────────────────

const configCache = new Map<string, CachedConfig>()
const providerCache = new Map<string, CachedProvider>()

// ─── Provider→policy mapping ────────────────────────────────────────────

/** Map AI Panel provider names to the policy used by `buildProviderChatCall`.
 *  Anthropic uses its own message format; everything else is OpenAI-compatible
 *  (including Google Gemini via OpenAI-compatible proxy endpoints). */
const PROVIDER_POLICY: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai-compatible',
  google: 'openai-compatible',
  deepseek: 'openai-compatible',
}

function policyForProvider(provider: string): string {
  return PROVIDER_POLICY[provider] ?? 'openai-compatible'
}

// ─── Template variable substitution ────────────────────────────────────

/** Replace `{{key}}` placeholders in the prompt with values from `variables`.
 *  Unknown placeholders are left as-is — a missing variable should be visible
 *  in the prompt, not silently replaced with empty string (spec R5.5). */
export function substituteVariables(prompt: string, variables: Record<string, string>): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return variables[key] ?? match
  })
}

// ─── Cached reads ───────────────────────────────────────────────────────

async function loadServiceConfig(db: Database, serviceKey: string): Promise<AiServiceConfig | null> {
  const cached = configCache.get(serviceKey)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.config

  const [row] = await db.select().from(aiServiceConfigs).where(eq(aiServiceConfigs.serviceKey, serviceKey)).limit(1)
  configCache.set(serviceKey, { config: row ?? null, loadedAt: Date.now() })
  return row ?? null
}

async function loadProvider(db: Database, providerName: string): Promise<AiProvider | null> {
  const cached = providerCache.get(providerName)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.provider

  const [row] = await db.select().from(aiProviders).where(eq(aiProviders.provider, providerName)).limit(1)
  providerCache.set(providerName, { provider: row ?? null, loadedAt: Date.now() })
  return row ?? null
}

async function loadPricing(db: Database, model: string): Promise<AiModelPricing | null> {
  const [row] = await db.select().from(aiModelPricing).where(eq(aiModelPricing.model, model)).limit(1)
  return row ?? null
}

/**
 * Call an AI service. This is the single entry point for all AI calls (spec R10.1).
 *
 * @returns `{ ok: true, text }` on success, `{ ok: false, error }` on failure.
 *          Failure reasons: 'service_inactive', 'no_api_key', 'budget_exceeded',
 *          'provider_error', 'parse_error'.
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

  const providerCall: ProviderCall = buildProviderChatCall({
    policy,
    baseUrl,
    model,
    secret,
    systemPrompt,
    history: input.history ?? [{ role: 'user', content: input.prompt }],
    maxTokens: config.maxTokens ? Number(config.maxTokens) : undefined,
  })

  // 6. Resolve allowed hosts from the base URL (for SSRF protection).
  const url = new URL(providerCall.url)
  const allowedHosts = [url.hostname]

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
        const resp1 = await fetch(providerCall.url, {
          method: 'POST',
          headers: providerCall.headers,
          body: JSON.stringify(reqBodyObj),
        })
        if (!resp1.ok || !resp1.body) {
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
        const resp1 = await fetch(providerCall.url, {
          method: 'POST',
          headers: providerCall.headers,
          body: JSON.stringify(reqBodyObj),
        })
        if (!resp1.ok) {
          success = false
          errorMessage = `HTTP ${resp1.status}`
          return { ok: false, error: 'provider_error' }
        }
        let raw1 = await resp1.text()
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
          const resp2 = await fetch(providerCall.url, {
            method: 'POST',
            headers: providerCall.headers,
            body: JSON.stringify(reqBodyObj),
          })
          if (!resp2.ok || !resp2.body) {
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
          const resp2 = await fetch(providerCall.url, {
            method: 'POST',
            headers: providerCall.headers,
            body: JSON.stringify(reqBodyObj),
          })
          if (!resp2.ok) {
            success = false
            errorMessage = `HTTP ${resp2.status}`
            return { ok: false, error: 'provider_error' }
          }
          let raw2 = await resp2.text()
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
          const respDirect = await fetch(providerCall.url, {
            method: 'POST',
            headers: providerCall.headers,
            body: JSON.stringify(reqBodyObj),
          })
          if (respDirect.ok && respDirect.body) {
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
      const response = await fetch(providerCall.url, {
        method: 'POST',
        headers: providerCall.headers,
        body: JSON.stringify(streamBody),
      })

      if (!response.ok || !response.body) {
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
