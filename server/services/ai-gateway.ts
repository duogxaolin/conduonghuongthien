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

// ─── Provider response parsing ──────────────────────────────────────────

interface UsageParseResult {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  answerText: string
}

/**
 * Parse usage tokens from a provider response body (spec R10.2, design.md D8).
 *
 * Strategy map isolates provider-specific logic:
 * - Google Gemini: `usageMetadata.{promptTokenCount, candidatesTokenCount}`
 * - OpenAI/DeepSeek: `usage.{prompt_tokens, completion_tokens}`
 * - Anthropic: `usage.{input_tokens, output_tokens}`
 */
function parseProviderResponse(provider: string, payload: unknown, policy: string): UsageParseResult {
  const answerText = extractAnswer(policy, payload)
  const usage = extractUsage(provider, payload)

  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    answerText,
  }
}

function cleanAiContent(text: string): string {
  if (!text) return ''
  return text
    .replace(/<\|channel>thought[\s\S]*?<channel\|>/gi, '')
    .replace(/<\|channel\|>thought[\s\S]*?<\|channel\|>/gi, '')
    .replace(/<\|thought\|>[\s\S]*?<\|\/thought\|>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\|channel>[\s\S]*?<channel\|>/gi, '')
    .trim()
}

function extractAnswer(policy: string, payload: unknown): string {
  return cleanAiContent(rawExtractAnswer(policy, payload))
}

function rawExtractAnswer(policy: string, payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  if (policy === 'anthropic') {
    const blocks = (payload as { content?: unknown }).content
    if (!Array.isArray(blocks)) return ''
    return blocks
      .filter((block): block is { type?: unknown; text?: unknown } => Boolean(block) && typeof block === 'object')
      .filter(block => block.type === undefined || block.type === 'text')
      .map(block => (typeof block.text === 'string' ? block.text : ''))
      .join('')
  }

  // OpenAI-compatible (includes Google Gemini via compatible endpoint, DeepSeek)
  const choice = (payload as { choices?: unknown }).choices
  if (Array.isArray(choice) && choice[0] && typeof choice[0] === 'object') {
    const message = (choice[0] as { message?: unknown }).message
    if (message && typeof message === 'object') {
      const content = (message as { content?: unknown }).content
      return typeof content === 'string' ? content : ''
    }
  }

  // Google Gemini native API shape
  const candidates = (payload as { candidates?: unknown }).candidates
  if (Array.isArray(candidates) && candidates[0] && typeof candidates[0] === 'object') {
    const content = (candidates[0] as { content?: unknown }).content
    if (content && typeof content === 'object') {
      const parts = (content as { parts?: unknown }).parts
      if (Array.isArray(parts) && parts[0] && typeof parts[0] === 'object') {
        const text = (parts[0] as { text?: unknown }).text
        return typeof text === 'string' ? text : ''
      }
    }
  }

  return ''
}

function extractUsage(provider: string, payload: unknown): { promptTokens: number; completionTokens: number; totalTokens: number } {
  if (!payload || typeof payload !== 'object') return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  // Google Gemini
  if (provider === 'google') {
    const meta = (payload as { usageMetadata?: unknown }).usageMetadata
    if (meta && typeof meta === 'object') {
      const m = meta as { promptTokenCount?: unknown; candidatesTokenCount?: unknown; totalTokenCount?: unknown }
      const promptTokens = Number(m.promptTokenCount ?? 0)
      const completionTokens = Number(m.candidatesTokenCount ?? 0)
      return { promptTokens, completionTokens, totalTokens: Number(m.totalTokenCount ?? promptTokens + completionTokens) }
    }
  }

  // Anthropic
  if (provider === 'anthropic') {
    const usage = (payload as { usage?: unknown }).usage
    if (usage && typeof usage === 'object') {
      const u = usage as { input_tokens?: unknown; output_tokens?: unknown }
      const promptTokens = Number(u.input_tokens ?? 0)
      const completionTokens = Number(u.output_tokens ?? 0)
      return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
    }
  }

  // OpenAI-compatible (OpenAI, DeepSeek)
  const usage = (payload as { usage?: unknown }).usage
  if (usage && typeof usage === 'object') {
    const u = usage as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown }
    const promptTokens = Number(u.prompt_tokens ?? 0)
    const completionTokens = Number(u.completion_tokens ?? 0)
    return { promptTokens, completionTokens, totalTokens: Number(u.total_tokens ?? promptTokens + completionTokens) }
  }

  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
}

// ─── Gateway entry point ───────────────────────────────────────────────

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

  if (Array.isArray(input.tools) && input.tools.length > 0) {
    // ── Tool Calling Execution Loop ──────────────────────────────────
    try {
      const toolDefs = input.tools
      const reqBodyObj = JSON.parse(providerCall.body ?? '{}') as Record<string, unknown>
      reqBodyObj.tools = toolDefs.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
      reqBodyObj.tool_choice = 'auto'
      reqBodyObj.stream = false

      // Step 1: Initial call to evaluate tool choice
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
      const msg1 = choice1?.message

      let step1Prompt = Number((json1.usage as { prompt_tokens?: number })?.prompt_tokens) || 0
      let step1Comp = Number((json1.usage as { completion_tokens?: number })?.completion_tokens) || 0
      if (config.provider === 'delify' && step1Prompt >= 2000) step1Prompt -= 2000
      promptTokens += step1Prompt
      completionTokens += step1Comp

      const toolCalls = msg1?.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined

      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        // Execute tool calls and append to conversation
        const messages = (reqBodyObj.messages as Array<unknown>) || []
        messages.push(msg1)

        for (const tc of toolCalls) {
          const fn = toolDefs.find(t => t.name === tc.function?.name)
          let args = {}
          try { args = JSON.parse(tc.function?.arguments || '{}') } catch {}
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

          let qStr = ''
          if (args && typeof args === 'object') {
            qStr = String((args as Record<string, unknown>).query || (args as Record<string, unknown>).keyword || '')
          }
          const itemCount = Array.isArray(toolResult) ? toolResult.length : (toolResult ? 1 : 0)
          toolCallsExecuted.push({
            name: tc.function?.name,
            query: qStr || undefined,
            count: itemCount,
            data: toolResult,
          })

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
          })
        }

        // Step 2: Final response with tool results
        if (input.onChunk) {
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
          const reader = resp2.body.getReader()
          const decoder = new TextDecoder()
          let streamBuffer = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            streamBuffer += decoder.decode(value, { stream: true })
            const lines = streamBuffer.split('\n')
            streamBuffer = lines.pop() || ''
            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed.startsWith('data:') || trimmed === 'data: [DONE]') continue
              try {
                const parsed = JSON.parse(trimmed.slice(5).trim())
                const delta = parsed?.choices?.[0]?.delta?.content
                if (typeof delta === 'string' && delta) {
                  answerText += delta
                  await input.onChunk(delta)
                }
                if (parsed?.usage) {
                  const isEst = Boolean(parsed.usage.estimated)
                  let p2 = Number(parsed.usage.prompt_tokens) || 0
                  let c2 = Number(parsed.usage.completion_tokens) || 0
                  if (config.provider === 'delify' && p2 >= 2000) p2 -= 2000
                  if (p2 > 0 && !isEst) promptTokens += p2
                  if (c2 > 0 && !isEst) completionTokens += c2
                }
              } catch {}
            }
          }
        } else {
          // Non-streaming final call
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
          answerText = choice2?.message?.content || ''
          let p2 = Number((json2.usage as { prompt_tokens?: number })?.prompt_tokens) || 0
          let c2 = Number((json2.usage as { completion_tokens?: number })?.completion_tokens) || 0
          if (config.provider === 'delify' && p2 >= 2000) p2 -= 2000
          promptTokens += p2
          completionTokens += c2
        }
      } else {
        // Model answered directly without tool calls
        answerText = (msg1?.content as string) || ''
        if (input.onChunk && answerText) {
          await input.onChunk(answerText)
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
  } else if (input.onChunk) {
    // Real-time streaming from provider via SSE
    try {
      const streamBody = JSON.parse(providerCall.body ?? '{}')
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

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let streamBuffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        streamBuffer += decoder.decode(value, { stream: true })
        const lines = streamBuffer.split('\n')
        streamBuffer = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:') || trimmed === 'data: [DONE]') continue
          try {
            const parsed = JSON.parse(trimmed.slice(5).trim())
            const delta = parsed?.choices?.[0]?.delta?.content
            if (typeof delta === 'string' && delta) {
              answerText += delta
              await input.onChunk(delta)
            }
            if (parsed?.usage) {
              const isEst = Boolean(parsed.usage.estimated)
              const p = Number(parsed.usage.prompt_tokens) || 0
              const c = Number(parsed.usage.completion_tokens) || 0
              if (p > 0 && (!promptTokens || !isEst)) {
                promptTokens = p
              }
              if (c > 0 && (!completionTokens || !isEst)) {
                completionTokens = c
              }
            }
          } catch {
            // Ignore unparseable partial chunk
          }
        }
      }

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
    userId: input.userId,
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
