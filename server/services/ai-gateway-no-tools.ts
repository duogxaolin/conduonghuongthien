/**
 * The two paths of `callAi` without tools — part of the `ai-gateway.ts` family (the split of
 * `callAi`, wave3 follow-up to 4.3). One request each:
 *   - `runStreamedAnswer` when the caller streams (`onChunk`): the fourth SSE reading of the
 *     gateway, through `readChatSse`;
 *   - `runBufferedAnswer` otherwise: one buffered request, the answer and usage parsed per
 *     provider (`parseProviderResponse`).
 * Both settle their tokens the same way (`settleSingleRequestTokens`) and end as
 * `provider_error` on any throw.
 */
import { parseProviderResponse } from './ai-response-parse'
import { readChatSse } from './ai-sse'
import { resolveProviderPolicy } from '../utils/chatbot/providers'
import { isSuccess, parseUpToLastBrace, responseText, type ProviderSender } from './ai-gateway-send'
import { createStreamTokens, settleSingleRequestTokens } from './ai-gateway-tokens'
import type { AiCallInput, AiPathOutcome, PreparedAiCall } from './ai-gateway-types'

/** Real-time streaming from the provider via SSE. */
export async function runStreamedAnswer(call: PreparedAiCall, sender: ProviderSender, input: AiCallInput,
  onChunk: NonNullable<AiCallInput['onChunk']>): Promise<AiPathOutcome> {
  try {
    const streamBody = JSON.parse(call.providerCall.body ?? '{}')
    // `buildProviderChatCall` builds the body with `stream: false`; without this the
    // provider answers with one JSON document, this reader finds no `data:` lines,
    // and the call ends as an empty response.
    streamBody.stream = true
    const response = await sender.postStream(JSON.stringify(streamBody))

    if (!response.body) return { ok: false, error: 'provider_error' }

    // `createStreamingCleaner` (inside `readChatSse`) is required here for the SAME
    // reason the tool-call streaming steps require it: the provider leaks reasoning
    // markers (``, `<|channel>…`, "Actually, I'll try…") into the SSE delta stream, and
    // those spans straddle chunk boundaries. Pushing raw `delta` to `onChunk` emits the
    // raw markers to the visitor and, once the closer arrives, the held-back region drops
    // — but the client has already rendered the leak. This is the no-tools path (provider
    // answers directly), and skipping the cleaner here was the regression: garbled/cut
    // text reappeared whenever the model answered without tool calls.
    // One request, one step: a later usage event REPLACES the earlier one (a real
    // figure beats an estimate, never the other way round), unlike the tool loop
    // where every step adds. delify's 2000-token overhead comes off at the end.
    const usage = createStreamTokens()
    const streamed = await readChatSse(response.body, { emit: onChunk, onUsage: usage.onUsage })
    let answerText = streamed.relayed
    if (!answerText.trim()) answerText = streamed.finalText()

    if (!answerText) return { ok: false, error: 'parse_error' }
    return { ok: true, answerText, ...settleSingleRequestTokens(call.provider, usage.latest, input.prompt, answerText) }
  } catch {
    return { ok: false, error: 'provider_error' }
  }
}

/** One buffered request; the caller waits for the whole answer. */
export async function runBufferedAnswer(call: PreparedAiCall, sender: ProviderSender, input: AiCallInput): Promise<AiPathOutcome> {
  try {
    const response = await sender.postPlain()

    if (!isSuccess(response.status)) return { ok: false, error: 'provider_error' }

    const payload = parseUpToLastBrace(responseText(response).trim())
    const parsed = parseProviderResponse(call.provider, payload, resolveProviderPolicy(call.policy))
    const answerText = parsed.answerText
    const tokens = settleSingleRequestTokens(call.provider, parsed, input.prompt, answerText)
    if (!answerText) return { ok: false, error: 'parse_error' }
    return { ok: true, answerText, ...tokens }
  } catch {
    return { ok: false, error: 'provider_error' }
  }
}
