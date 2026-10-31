/**
 * AI Gateway — unified entry point for all AI calls (spec R10, design.md D3).
 *
 * `callAi(serviceKey, { prompt, variables, userId, db })` is the single choke-point:
 * every AI call — chatbot, translation, editorial — goes through this function.
 *
 * Steps:
 *   1. Load `ai_service_configs` row for `serviceKey` (cached 60s).
 *   2. Check budget (spec R9).
 *   3. Load `ai_providers` row for the service's `provider` (cached 60s) and decrypt the
 *      API key.
 *   4. Pick the system prompt (the caller's, else the stored one, else the service's
 *      default) and substitute `{{variables}}`.
 *   5. Check the stored base URL against the provider URL policy, then build the HTTP
 *      request using the `chatbot/providers.ts` patterns.
 *   6. Send — `ai-gateway-send.ts`, the one file that calls `chatbot/outbound.ts`
 *      (`safeProviderRequest` buffered, `safeProviderStream` SSE). No path uses a bare
 *      `fetch`: DNS→public IP pinned to the socket, https/443, no redirects, deadline,
 *      byte cap. One of three paths:
 *        - tools offered → `ai-gateway-tool-loop.ts`;
 *        - no tools, `onChunk` → `runStreamedAnswer`, else `runBufferedAnswer`
 *          (`ai-gateway-no-tools.ts`).
 *      Usage tokens per path: `ai-gateway-tokens.ts`.
 *   7. Calculate cost, log to `ai_usage_logs` (awaited, errors caught), log the success
 *      line — `ai-gateway-record.ts`. A path that failed writes its one row there too
 *      (`success: false`, the code, 0 tokens); a refusal in steps 1–5 writes none.
 *   8. Return `{ ok: true, text }` or `{ ok: false, error }`.
 *
 * Part of the `ai-gateway.ts` family (wave3-long-term 4.3, D-SPLIT): callers import the
 * barrel `./ai-gateway`, never this file. 4.3 moved `callAi` here whole (one 545-line
 * function); the follow-up split it along the steps above without changing what it does —
 * written first and green on the unsplit function: `tests/ai-gateway-callai-behavior.test.ts`,
 * with `tests/ai-gateway-seams-behavior.test.ts` and the other `ai-gateway-*` behaviour
 * tests unchanged. The prelude stays HERE, with the key: this is the file that decrypts it
 * (`tests/server-bare-fetch-guard.test.ts`), and it hands it on only inside the built
 * request.
 */
import { getDb, type Database } from '../utils/db'
import { decryptAiSecret } from '../utils/ai/crypto'
import { checkBudget } from '../utils/ai-budget'
import { logWarn } from '../utils/logger'
import { checkProviderBaseUrl } from '../utils/ai/provider-url'
import { effectiveSystemPrompt } from '../utils/ai/prompt-defaults'
import { buildProviderChatCall, type ProviderCall } from '../utils/chatbot/providers'
import type { AiCallInput, AiCallResult, AiPathOutcome, PreparedAiCall } from './ai-gateway-types'
import { loadProvider, loadServiceConfig, policyForProvider, substituteVariables } from './ai-gateway-config'
import { providerSender } from './ai-gateway-send'
import { runToolLoop } from './ai-gateway-tool-loop'
import { runBufferedAnswer, runStreamedAnswer } from './ai-gateway-no-tools'
import { recordAiCall, recordAiFailure } from './ai-gateway-record'

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

  const prepared = await prepareAiCall(db, serviceKey, input)
  if ('refused' in prepared) return prepared.refused
  const { call } = prepared

  const sender = providerSender(call.providerCall, input.transport)

  // Measure execution time from before the provider call (spec R10.6): the prelude above and
  // the pricing read after it are not the provider's time.
  const startTime = Date.now()
  // A local const so the narrowing survives into the paths below.
  const onChunk = input.onChunk
  let outcome: AiPathOutcome
  if (Array.isArray(input.tools) && input.tools.length > 0) {
    outcome = await runToolLoop(call, sender, input, input.tools, onChunk)
  } else if (onChunk) {
    outcome = await runStreamedAnswer(call, sender, input, onChunk)
  } else {
    outcome = await runBufferedAnswer(call, sender, input)
  }
  const executionMs = Date.now() - startTime

  // One usage row per call that went past the refusals — answered or failed (`ai-gateway-record.ts`).
  if (!outcome.ok) return recordAiFailure(db, serviceKey, call, outcome, executionMs, input.userId ?? null)
  return recordAiCall(db, serviceKey, call, outcome, executionMs, input.userId ?? null)
}

/**
 * Steps 1–5: every refusal, in order — and what each one does NOT do: no budget check before
 * the config, no key load before the budget, no decrypt without a full envelope, no DNS and
 * no request before the URL policy (`tests/ai-gateway-seams-behavior.test.ts`).
 */
async function prepareAiCall(db: Database, serviceKey: string, input: AiCallInput): Promise<{ refused: AiCallResult } | { call: PreparedAiCall }> {
  // 1. Load service config (spec R10.1 step 1).
  const config = await loadServiceConfig(db, serviceKey)
  if (!config) {
    return { refused: { ok: false, error: 'service_not_found' } }
  }
  if (!config.isActive) {
    return { refused: { ok: false, error: 'service_inactive' } }
  }

  // 2. Check budget (spec R10.1 step 3, R9).
  const budgetResult = await checkBudget(db, serviceKey)
  if (!budgetResult.allowed) {
    return {
      refused: {
        ok: false,
        error: budgetResult.reason ?? 'budget_exceeded',
        errorMessage: budgetResult.errorMessage ?? 'Hệ thống hết ngân sách cho AI',
      },
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
    return { refused: { ok: false, error: 'no_api_key' } }
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
    return { refused: { ok: false, error: 'no_api_key' } }
  }

  // 4. Substitute template variables (spec R10.1 step 4, R5.5).
  const rawSystemPrompt = input.systemPrompt ?? effectiveSystemPrompt(serviceKey, config.systemPrompt)
  const systemPrompt = substituteVariables(
    rawSystemPrompt,
    input.variables ?? {},
  )

  // 5. Build the HTTP request (spec R10.1 step 6).
  const policy = policyForProvider(config.provider)
  const baseUrl = providerRow.baseUrl ?? ''
  const model = config.model ?? ''
  if (!baseUrl || !model) {
    return { refused: { ok: false, error: 'service_inactive' } }
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
    return { refused: { ok: false, error: 'provider_url_rejected', errorMessage: baseUrlCheck.message } }
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

  return { call: { provider: config.provider, model, policy, providerCall } }
}
