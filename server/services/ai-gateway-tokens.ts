/**
 * Token accounting of `callAi` — part of the `ai-gateway.ts` family (the split of `callAi`,
 * wave3 follow-up to 4.3). Pure: no I/O. The rules differ per path ON PURPOSE, and each
 * difference is pinned (`tests/ai-gateway-seams-behavior.test.ts`,
 * `tests/ai-gateway-streaming-paths.test.ts`):
 *   - the tool loop ADDS every step, each step minus delify's overhead, and an `estimated`
 *     streamed figure is never billed; it has no length estimate — zero stays zero;
 *   - the no-tool stream is one request, so a later usage event REPLACES the earlier one
 *     (a real figure beats an estimate, never the other way round); the overhead comes off
 *     the final figure;
 *   - both no-tool paths fall back to length / 3.5 when a count is zero (or unreadable),
 *     and recompute the total from the parts — the provider's own total is not trusted.
 */
import type { ChatSseUsage } from './ai-sse'

/** delify bills 2000 prompt tokens of its own overhead on every request. */
const DELIFY_PROMPT_OVERHEAD = 2000

/** A prompt count of one request without delify's own overhead (other providers: as reported). */
export function withoutDelifyOverhead(provider: string, promptTokens: number): number {
  return provider === 'delify' && promptTokens >= DELIFY_PROMPT_OVERHEAD ? promptTokens - DELIFY_PROMPT_OVERHEAD : promptTokens
}

/** The stand-in for a count the provider did not report — the no-tool paths only. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3.5))
}

export interface TokenCounts {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/**
 * The billed counts of a no-tool path's single request: the overhead off, a zero (or NaN)
 * count estimated from the prompt text / the answer, the total recomputed from the parts.
 */
export function settleSingleRequestTokens(provider: string, reported: { promptTokens: number, completionTokens: number },
  promptText: string, answerText: string): TokenCounts {
  let promptTokens = withoutDelifyOverhead(provider, reported.promptTokens)
  let completionTokens = reported.completionTokens
  if (!promptTokens) promptTokens = estimateTokens(promptText)
  if (!completionTokens) completionTokens = estimateTokens(answerText)
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
}

/** Running totals of the tool loop, fed once per step. */
export interface ToolLoopTokens {
  readonly totals: { promptTokens: number, completionTokens: number }
  /** `onUsage` of a streamed step: an estimate is the provider guessing — never billed. */
  addStreamed: (usage: ChatSseUsage) => void
  /** The `usage` object of a buffered step's JSON answer, whatever its shape. */
  addBuffered: (usage: unknown) => void
}

export function createToolLoopTokens(provider: string): ToolLoopTokens {
  const totals = { promptTokens: 0, completionTokens: 0 }
  return {
    totals,
    addStreamed: ({ promptTokens: prompt, completionTokens: completion, estimated }: ChatSseUsage) => {
      const adjusted = withoutDelifyOverhead(provider, prompt)
      if (adjusted > 0 && !estimated) totals.promptTokens += adjusted
      if (completion > 0 && !estimated) totals.completionTokens += completion
    },
    addBuffered: (usage: unknown) => {
      const prompt = withoutDelifyOverhead(provider, Number((usage as { prompt_tokens?: number })?.prompt_tokens) || 0)
      const completion = Number((usage as { completion_tokens?: number })?.completion_tokens) || 0
      totals.promptTokens += prompt
      totals.completionTokens += completion
    },
  }
}

/** The usage of the no-tool stream: the latest real figure, or the first estimate until one comes. */
export interface StreamTokens {
  readonly latest: { promptTokens: number, completionTokens: number }
  onUsage: (usage: ChatSseUsage) => void
}

export function createStreamTokens(): StreamTokens {
  const latest = { promptTokens: 0, completionTokens: 0 }
  return {
    latest,
    onUsage: ({ promptTokens: prompt, completionTokens: completion, estimated }: ChatSseUsage) => {
      if (prompt > 0 && (!latest.promptTokens || !estimated)) latest.promptTokens = prompt
      if (completion > 0 && (!latest.completionTokens || !estimated)) latest.completionTokens = completion
    },
  }
}
