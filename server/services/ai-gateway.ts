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

/** Core cleaner: applies the 8 regexes but does NOT trim. Trimming belongs
 *  to the final answer, not to incremental streaming — a per-chunk `trim()`
 *  strips the trailing space between words ("Chào " → "Chào") so the next
 *  chunk glues them together ("Chào" + "anh" = "Chàoanh"). That was half of
 *  the garbled-output bug: the slice() shift was the other half. */
function cleanAiContentCore(text: string): string {
  if (!text) return ''
  return text
    .replace(/<\|channel>thought[\s\S]*?<channel\|>/gi, '')
    .replace(/<\|channel\|>thought[\s\S]*?<\|channel\|>/gi, '')
    .replace(/<\|thought\|>[\s\S]*?<\|\/thought\|>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\|channel>[\s\S]*?<channel\|>/gi, '')
    .replace(/thought\s*<channel\|>/gi, '')
    .replace(/<\|channel>|channel\|>|<channel\|>|<\|channel\|>/gi, '')
    .replace(/(?:Actually|Wait),\s*I'll\s*try[\s\S]*?(?=(?:Dạ|Chào|Theo|Hiện|Về|\d+\.|\n\n|$))/gi, '')
}

function cleanAiContent(text: string): string {
  return cleanAiContentCore(text).trim()
}

/** Incremental cleaner for streaming: avoids re-running 8 regexes on the full
 *  `streamText` for every chunk (O(n²)). Holds an incomplete trailing tag in
 *  `carry` so a split like `<thi` + `nk>` does not leak.
 *
 * Emits by **prefix diff**, not by byte length. `cleanAiContent` runs 8 regexes
 * that *delete* spans (reasoning tags like ``, "Actually, I'll
 * try…" leaks) and those spans can straddle chunk boundaries: the opening tag
 * arrives in chunk N (already emitted), the closing tag in chunk M. Once the
 * closer arrives, `cleaned` shrinks *ahead of* the emit point, so
 * `slice(emittedLen)` indexes into the wrong position and emits garbled text
 * (missing spaces, duplicated/merged words — "Chào anh/chị" → "Chàochị"). We
 * track the emitted *string* and only emit the suffix of `cleaned` that extends
 * it; if a regex deletes inside the already-emitted region we emit nothing
 * rather than emitting from a shifted offset. The already-shown text stays
 * (a trailing reasoning fragment may linger briefly) which is the safe
 * failure mode — corrupting the answer text is not. */
/**
 * Finds the index at which an unclosed reasoning span begins in `text`, so the
 * cleaner can hold it back instead of emitting reasoning markers (``,
 * `<|channel>…`, "Actually, I'll try…" leaks) that the regexes cannot yet
 * strip because their closer has not arrived. Returns -1 when nothing is
 * pending.
 *
 * The reasoning regexes match `open … close` pairs. While the closer is still
 * in transit, the open marker sits in the buffer and would emit raw to the
 * visitor. We hold from the open marker onward; once the closer arrives the
 * full span deletes in one regex pass and `emittedText.startsWith(cleaned)`
 * resyncs silently (the divergent-continuation branch never fires, because
 * the held region produces no `emittedText` growth).
 */
function unclosedReasoningStart(text: string): number {
  const thinkOpen = '<' + 'thi' + 'nk>'
  const thinkClose = '<' + '/thi' + 'nk>'
  // Count unmatched opening think tags.
  let pos = 0
  while ((pos = text.indexOf(thinkOpen, pos)) !== -1) {
    const closeIdx = text.indexOf(thinkClose, pos + thinkOpen.length)
    if (closeIdx === -1) return pos
    pos = closeIdx + thinkClose.length
  }
  // Channel-tag span: `<|channel>…<channel|>` (the `thought` prefix variants
  // are subsumed by the plain `<channel|>` closer — note the `<` and `|`
  // swap positions between open and close).
  const chOpen = '<|' + 'channel' + '>'
  const chClose = '<' + 'channel' + '|>'
  pos = 0
  while ((pos = text.indexOf(chOpen, pos)) !== -1) {
    const closeIdx = text.indexOf(chClose, pos + chOpen.length)
    if (closeIdx === -1) return pos
    pos = closeIdx + chClose.length
  }
  // "Actually, I'll try…" leak: deleted up to the next sentence boundary
  // (Dạ/Chào/Theo/Hiện/Về/digit./\n\n). If we have an opening but none of the
  // boundaries have arrived yet, hold from the opening so the visible answer
  // is not corrupted by reasoning text that the regex *will* delete once the
  // boundary lands.
  const leakRe = /(?:Actually|Wait),\s*I'?\s*ll\s*try/i
  const leakMatch = leakRe.exec(text)
  if (leakMatch) {
    const after = text.slice(leakMatch.index + leakMatch[0].length)
    if (!/(?:Dạ|Chào|Theo|Hiện|Về|\d+\.|\n\n)/.test(after)) return leakMatch.index
  }
  return -1
}

export function createStreamingCleaner() {
  let carry = ''
  let emittedText = ''
  let rawBuffer = ''
  return {
    push(delta: string): string {
      rawBuffer += delta
      // Hold incomplete trailing "<...": don't emit tail that hasn't closed yet.
      // We compute the hold on the *full* raw buffer so a tag that opens in
      // chunk N and is still open here is held back regardless of how many
      // chunks the span already spans.
      const lastOpen = rawBuffer.lastIndexOf('<')
      const lastClose = rawBuffer.lastIndexOf('>')
      let usable: string
      let nextCarry = ''
      if (lastOpen !== -1 && lastOpen > lastClose) {
        usable = rawBuffer.slice(0, lastOpen)
        nextCarry = rawBuffer.slice(lastOpen)
      } else {
        usable = rawBuffer
      }
      // Also hold any unclosed reasoning span (think-tag, channel-tag, or the
      // "Actually, I'll try…" leak) whose closer has not arrived yet. Without
      // this, the open marker would emit raw to the visitor and the suffix
      // beyond it would be prematurely committed to `emittedText`.
      const unclosedAt = unclosedReasoningStart(usable)
      if (unclosedAt !== -1) {
        nextCarry = usable.slice(unclosedAt) + nextCarry
        usable = usable.slice(0, unclosedAt)
      }
      // Clean the **whole usable raw buffer**, not just the current delta. A
      // reasoning span like `<think>…` (or the "Actually, I'll try…"
      // lookahead match) can straddle chunk boundaries: the opening arrives
      // in chunk N, the closing in chunk M. Cleaning only the per-chunk
      // `toClean` means no chunk ever contains both ends, so the regex never
      // matches and the reasoning text leaks through. Cleaning the full
      // buffer makes the regex match once the closer arrives, and the
      // emit-side prefix-diff below correctly suppresses the now-deleted
      // region instead of emitting garbled shifted text.
      const cleaned = cleanAiContentCore(usable)
      carry = nextCarry
      let newChunk = ''
      if (cleaned.startsWith(emittedText)) {
        // Normal extension: `cleaned` grew by appending to the already-emitted
        // text. Emit only the new suffix.
        newChunk = cleaned.slice(emittedText.length)
      } else if (emittedText.startsWith(cleaned)) {
        // A regex deleted the **tail** of the already-emitted region (e.g. a
        // reasoning tag that opened inside the emit point and closed in this
        // chunk). Emit nothing — the shown text keeps its tail (a reasoning
        // fragment may linger briefly) and we resync so future chunks extend
        // from the shorter cleaned form. Resyncing here is safe precisely
        // because we are not emitting: the alternative would be emitting from
        // a shifted offset, which is the garbled-output bug.
        newChunk = ''
      } else {
        // Divergence: `cleaned` and `emittedText` share a coincidental prefix
        // (or none) but the regexes only *delete* spans, never rewrite in
        // place — so a real "rewrite keeping the prefix" case is already
        // covered by `emittedText.startsWith(cleaned)` above. Anything left is
        // genuinely new text that is not an extension of what was shown, so
        // emit the whole `cleaned`. Using a common-prefix slice here would
        // drop a coincidental shared character (e.g. "Cục " then "C11."
        // shared "C", and slice(1) ate it → "11.").
        newChunk = cleaned
      }
      emittedText = cleaned
      return newChunk
    },
    flush(): string {
      // Final pass: clean the whole raw buffer. Any held-back trailing span
      // is now part of `rawBuffer`; if it never closed, the regexes leave it
      // and it emits as-is (the caller's `finalText(streamText)` fallback is
      // the safety net for a provider that never closed its tag).
      const cleaned = cleanAiContentCore(rawBuffer)
      carry = ''
      let tail = ''
      if (cleaned.startsWith(emittedText)) {
        tail = cleaned.slice(emittedText.length)
      } else if (emittedText.startsWith(cleaned)) {
        tail = ''
      } else {
        tail = cleaned
      }
      emittedText = cleaned
      return tail
    },
    finalText(raw: string): string {
      // Only the final, complete answer is trimmed. Intermediate chunks must
      // keep their boundary whitespace or words glue together.
      return cleanAiContentCore(raw).trim()
    },
  }
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

export function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null) return raw as Record<string, unknown>
  let str = String(raw || '').trim()
  str = str.replace(/<\|"\|>/g, '"').replace(/<\|/g, '').replace(/\|>/g, '')
  try {
    return JSON.parse(str) as Record<string, unknown>
  } catch {
    try {
      const fixed = str.replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":')
      return JSON.parse(fixed) as Record<string, unknown>
    } catch {
      return {}
    }
  }
}

export function extractToolCallsFromMessage(
  msg: Record<string, unknown> | undefined,
  availableTools?: Array<{ name: string }>,
): Array<{ id: string; function: { name: string; arguments: string } }> {
  if (!msg) return []
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    return msg.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }>
  }
  const content = typeof msg.content === 'string' ? msg.content : ''
  if (!content) return []
  const list: Array<{ id: string; function: { name: string; arguments: string } }> = []

  // Pattern A: <|tool_call>call:funcName{...}
  const patA = /<\|tool_call>call:(\w+)([\{][\s\S]*?[\}])(?:<\|?\/?tool_call\|?>)?/g
  let mA: RegExpExecArray | null
  while ((mA = patA.exec(content)) !== null) {
    list.push({
      id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      function: {
        name: mA[1] ?? '',
        arguments: mA[2] ?? '',
      },
    })
  }
  // Pattern B: Pythonic function calls: funcName(param="value")
  if (list.length === 0 && Array.isArray(availableTools) && availableTools.length > 0) {
    for (const t of availableTools) {
      const regex = new RegExp(t.name + '\\s*\\(([^)]*)\\)', 'g')
      let mB: RegExpExecArray | null
      while ((mB = regex.exec(content)) !== null) {
        const rawArgs = (mB[1] ?? '').trim()
        let args: Record<string, unknown> = {}
        const argRegex = /(\w+)\s*=\s*["']([^"']*)["']/g
        let am: RegExpExecArray | null
        while ((am = argRegex.exec(rawArgs)) !== null) {
          args[am[1] ?? ''] = am[2] ?? ''
        }
        if (Object.keys(args).length > 0) {
          list.push({
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            function: {
              name: t.name,
              arguments: JSON.stringify(args),
            },
          })
        }
      }
    }
  }

  return list
}

function extractUsage(provider: string, payload: unknown): { promptTokens: number; completionTokens: number; totalTokens: number } {
  if (!payload || typeof payload !== 'object') return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
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

      // Step 1: Fast non-streaming call to evaluate tool choice
      reqBodyObj.messages = messages
      reqBodyObj.tools = formattedTools
      reqBodyObj.tool_choice = 'auto'
      reqBodyObj.stream = false
      reqBodyObj.max_tokens = 300

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
          const cleaner = createStreamingCleaner()
          const reader = resp2.body.getReader()
          const decoder = new TextDecoder()
          let streamBuffer = ''
          let streamText = ''
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
                  streamText += delta
                  const newChunk = cleaner.push(delta)
                  if (newChunk) {
                    answerText += newChunk
                    await input.onChunk(newChunk)
                  }
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
          const tail = cleaner.flush()
          if (tail) { answerText += tail; await input.onChunk(tail) }
          if (!answerText.trim()) answerText = cleaner.finalText(streamText).trim()
          if (!answerText) {
            answerText = streamText.replace(/<\|channel>[\s\S]*?<channel\|>/gi, '').trim()
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
          let c2 = Number((json2.usage as { completion_tokens?: number })?.completion_tokens) || 0
          if (config.provider === 'delify' && p2 >= 2000) p2 -= 2000
          promptTokens += p2
          completionTokens += c2
        }
      } else {
        // Model answered directly without tool calls
        delete reqBodyObj.tools
        delete reqBodyObj.tool_choice
        reqBodyObj.max_tokens = originalMaxTokens
        if (input.onChunk) {
          reqBodyObj.stream = true
          const respDirect = await fetch(providerCall.url, {
            method: 'POST',
            headers: providerCall.headers,
            body: JSON.stringify(reqBodyObj),
          })
          if (respDirect.ok && respDirect.body) {
            const cleaner2 = createStreamingCleaner()
            const reader = respDirect.body.getReader()
            const decoder = new TextDecoder()
            let streamBuffer = ''
            let streamText = ''
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
                    streamText += delta
                    const newChunk = cleaner2.push(delta)
                    if (newChunk) {
                      answerText += newChunk
                      await input.onChunk(newChunk)
                    }
                  }
                  if (parsed?.usage) {
                    let p2 = Number(parsed.usage.prompt_tokens) || 0
                    let c2 = Number(parsed.usage.completion_tokens) || 0
                    if (config.provider === 'delify' && p2 >= 2000) p2 -= 2000
                    if (p2 > 0 && !parsed.usage.estimated) promptTokens += p2
                    if (c2 > 0 && !parsed.usage.estimated) completionTokens += c2
                  }
                } catch {}
              }
            }
            const tail2 = cleaner2.flush()
            if (tail2) { answerText += tail2; await input.onChunk(tail2) }
            if (!answerText.trim()) answerText = cleaner2.finalText(streamText).trim()
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
