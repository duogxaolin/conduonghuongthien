/**
 * Optional local semantic matching for the small-talk bank.
 *
 * This module deliberately owns no model runtime and imports no model package.
 * A deployment may inject a local provider, but the feature is disabled unless
 * explicitly enabled. Business retrieval and the deterministic rule matcher
 * always run first, so obvious greetings/acknowledgements never wait on a model.
 */

export const SMALL_TALK_SEMANTIC_DEFAULTS = Object.freeze({
  enabled: false,
  confidenceThreshold: 0.82,
  top1Top2Margin: 0.08,
  timeoutMs: 250,
})

const LIMITS = Object.freeze({
  minimumConfidence: 0,
  maximumConfidence: 1,
  minimumTimeoutMs: 10,
  maximumTimeoutMs: 2_000,
  maximumQueryChars: 2_000,
})

/** Metadata and examples a local ranker may inspect. Answers are never exposed. */
export type SemanticSmallTalkEntry = {
  id: number
  intent?: string | null
  category: string
  semanticExamples: readonly string[]
}

/** The only accepted provider output: an entry ID and its numeric confidence. */
export type SemanticSmallTalkScore = {
  entryId: number
  confidence: number
}

export type SemanticSmallTalkProvider = {
  rank: (request: {
    query: string
    candidates: readonly SemanticSmallTalkEntry[]
    signal: AbortSignal
  }) => Promise<readonly SemanticSmallTalkScore[]>
}

export type SmallTalkSelection = {
  entryId: number
  intent: string | null
  category: string
  confidence: number
}

export type SmallTalkSemanticConfig = {
  enabled: boolean
  confidenceThreshold: number
  top1Top2Margin: number
  timeoutMs: number
}

export type SmallTalkRuleMatcher<Entry> = (
  entries: readonly Entry[],
  query: unknown,
) => { id: number } | null

export type SelectSmallTalkOptions<Entry extends SemanticSmallTalkEntry> = {
  /** Non-empty means the governed business bank won; small-talk is not consulted. */
  businessReferences: readonly unknown[]
  entries: readonly Entry[]
  query: unknown
  ruleMatcher: SmallTalkRuleMatcher<Entry>
  semanticProvider?: SemanticSmallTalkProvider | null
  semanticConfig?: Partial<SmallTalkSemanticConfig>
}

function finiteNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback
}

function normalizeConfig(input: Partial<SmallTalkSemanticConfig> | undefined): SmallTalkSemanticConfig {
  return {
    enabled: input?.enabled === true,
    confidenceThreshold: finiteNumber(
      input?.confidenceThreshold,
      SMALL_TALK_SEMANTIC_DEFAULTS.confidenceThreshold,
      LIMITS.minimumConfidence,
      LIMITS.maximumConfidence,
    ),
    top1Top2Margin: finiteNumber(
      input?.top1Top2Margin,
      SMALL_TALK_SEMANTIC_DEFAULTS.top1Top2Margin,
      LIMITS.minimumConfidence,
      LIMITS.maximumConfidence,
    ),
    timeoutMs: Math.round(finiteNumber(
      input?.timeoutMs,
      SMALL_TALK_SEMANTIC_DEFAULTS.timeoutMs,
      LIMITS.minimumTimeoutMs,
      LIMITS.maximumTimeoutMs,
    )),
  }
}

function environmentBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true' || value?.trim() === '1'
}

function environmentNumber(value: string | undefined): number | undefined {
  if (value == null || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Runtime contract for an optional local provider. No variables means disabled,
 * preserving existing deployments. Values are bounded again by the selector.
 */
export function readSmallTalkSemanticConfig(
  environment: Record<string, string | undefined> = process.env,
): SmallTalkSemanticConfig {
  return normalizeConfig({
    enabled: environmentBoolean(environment.CHATBOT_SMALL_TALK_SEMANTIC_ENABLED),
    confidenceThreshold: environmentNumber(environment.CHATBOT_SMALL_TALK_SEMANTIC_CONFIDENCE),
    top1Top2Margin: environmentNumber(environment.CHATBOT_SMALL_TALK_SEMANTIC_MARGIN),
    timeoutMs: environmentNumber(environment.CHATBOT_SMALL_TALK_SEMANTIC_TIMEOUT_MS),
  })
}

function selection(entry: SemanticSmallTalkEntry, confidence: number): SmallTalkSelection {
  return {
    entryId: entry.id,
    intent: entry.intent ?? null,
    category: entry.category,
    confidence,
  }
}

function acceptedScores(
  scores: readonly SemanticSmallTalkScore[],
  entriesById: ReadonlyMap<number, SemanticSmallTalkEntry>,
): SemanticSmallTalkScore[] {
  const bestByEntry = new Map<number, number>()
  for (const score of scores) {
    if (!score || !entriesById.has(score.entryId)) continue
    if (!Number.isFinite(score.confidence) || score.confidence < 0 || score.confidence > 1) continue
    const previous = bestByEntry.get(score.entryId)
    if (previous === undefined || score.confidence > previous) bestByEntry.set(score.entryId, score.confidence)
  }
  return [...bestByEntry].map(([entryId, confidence]) => ({ entryId, confidence }))
    .sort((left, right) => right.confidence - left.confidence || left.entryId - right.entryId)
}

async function rankWithinTimeout(
  provider: SemanticSmallTalkProvider,
  query: string,
  entries: readonly SemanticSmallTalkEntry[],
  timeoutMs: number,
): Promise<readonly SemanticSmallTalkScore[] | null> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(null)
    }, timeoutMs)
  })

  try {
    return await Promise.race([
      Promise.resolve(provider.rank({ query, candidates: entries, signal: controller.signal })).catch(() => null),
      timeout,
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Select small-talk safely, without producing an answer.
 *
 * Precedence is fixed here rather than left to callers:
 * 1. any business reference wins;
 * 2. any deterministic rule match wins immediately;
 * 3. only then may an explicitly enabled local semantic provider run.
 *
 * The selected metadata is resolved from the trusted entry list. A provider
 * cannot inject an answer, intent, or category in its response.
 */
export async function selectSmallTalk<Entry extends SemanticSmallTalkEntry>(
  options: SelectSmallTalkOptions<Entry>,
): Promise<SmallTalkSelection | null> {
  if (options.businessReferences.length > 0) return null

  const query = typeof options.query === 'string' ? options.query.normalize('NFKC').trim() : ''
  if (!query) return null

  const entriesById = new Map(options.entries.map(entry => [entry.id, entry]))
  const rule = options.ruleMatcher(options.entries, query)
  const ruleEntry = rule ? entriesById.get(rule.id) : undefined
  if (ruleEntry) return selection(ruleEntry, 1)

  const config = normalizeConfig(options.semanticConfig)
  if (!config.enabled || !options.semanticProvider || options.entries.length === 0) return null
  if (query.length > LIMITS.maximumQueryChars) return null

  const rawScores = await rankWithinTimeout(options.semanticProvider, query, options.entries, config.timeoutMs)
  if (!rawScores) return null

  const ranked = acceptedScores(rawScores, entriesById)
  const top = ranked[0]
  if (!top || top.confidence < config.confidenceThreshold) return null

  const runnerUpConfidence = ranked[1]?.confidence ?? 0
  if (top.confidence - runnerUpConfidence < config.top1Top2Margin) return null

  const matchedEntry = entriesById.get(top.entryId)
  return matchedEntry ? selection(matchedEntry, top.confidence) : null
}
