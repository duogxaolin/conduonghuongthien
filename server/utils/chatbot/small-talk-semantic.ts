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

/** Exact metadata and examples a local ranker may inspect. Answers are never exposed. */
export type SemanticSmallTalkEntry = {
  id: number
  intent: string | null
  category: string
  semanticExamples: readonly string[]
}

/** DB-backed source rows accepted by the selector before metadata projection. */
export type SemanticSmallTalkSource = {
  id: number
  category: string
  normalizedQuestion?: string | null
  patterns?: readonly string[] | null
  intent?: string | null
  semanticExamples?: readonly string[]
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

/**
 * Optional provider hook for deployments that install a local ranker without
 * changing the chatbot request path. The hook is deliberately inert unless a
 * provider is explicitly installed by server bootstrap code.
 */
const semanticProviderSlot = Symbol.for('cdkt.chatbot.smallTalkSemanticProvider')

type SemanticProviderRegistry = { [semanticProviderSlot]?: SemanticSmallTalkProvider }

export function installSmallTalkSemanticProvider(provider: SemanticSmallTalkProvider | null): void {
  const registry = globalThis as typeof globalThis & SemanticProviderRegistry
  if (provider) registry[semanticProviderSlot] = provider
  else delete registry[semanticProviderSlot]
}

export function getSmallTalkSemanticProvider(): SemanticSmallTalkProvider | null {
  const registry = globalThis as typeof globalThis & SemanticProviderRegistry
  const provider = registry[semanticProviderSlot]
  return provider && typeof provider.rank === 'function' ? provider : null
}

export type SmallTalkSelection = {
  entryId: number
  intent: string | null
  category: string
  confidence: number
}

/**
 * `confidenceThreshold` / `top1Top2Margin` / `timeoutMs` để TRỐNG nghĩa là "dùng mặc định
 * của ranker đang cắm". Chúng chỉ có mặt khi người triển khai đặt biến môi trường tường
 * minh — nếu không, `normalizeConfig` điền mặc định của KHUNG (0.82), và một ranker đo
 * được ở 0.65 sẽ không bao giờ khớp dù cấu hình ranker nói 0.65. Đó đúng là lỗi đã xảy ra
 * khi cắm ranker trigram: provider tự khai ngưỡng 0.65 nhưng env rỗng kéo nó về 0.82.
 */
export type SmallTalkSemanticConfig = {
  enabled: boolean
  confidenceThreshold?: number
  top1Top2Margin?: number
  timeoutMs?: number
}

export type SmallTalkRuleMatcher<Entry> = (
  entries: readonly Entry[],
  query: unknown,
) => { id: number } | null

export type SelectSmallTalkOptions<Entry extends SemanticSmallTalkSource> = {
  /** Non-empty means the governed business bank won; small-talk is not consulted. */
  businessReferences: readonly unknown[]
  entries: readonly Entry[]
  query: unknown
  ruleMatcher: SmallTalkRuleMatcher<Entry>
  semanticProvider?: SemanticSmallTalkProvider | null
  semanticConfig?: Partial<SmallTalkSemanticConfig>
  /** Mặc định của ranker đang cắm; `semanticConfig` chỉ ghi đè khi đặt tường minh. */
  semanticDefaults?: { confidenceThreshold: number, top1Top2Margin: number, timeoutMs: number }
}

/** Project a DB row to the exact metadata contract exposed to a semantic provider. */
export function projectSemanticEntry(entry: SemanticSmallTalkSource): SemanticSmallTalkEntry {
  const examples = [
    ...(entry.semanticExamples ?? []),
    ...(entry.normalizedQuestion ? [entry.normalizedQuestion] : []),
    ...(entry.patterns ?? []),
  ].filter((example): example is string => typeof example === 'string' && example.trim().length > 0)
  return {
    id: entry.id,
    intent: entry.intent ?? null,
    category: entry.category,
    semanticExamples: [...new Set(examples)],
  }
}

/** Có đặt (số hữu hạn) thì kẹp vào khoảng; KHÔNG đặt thì trả `undefined`, không trả default. */
function bounded(value: unknown, minimum: number, maximum: number, round = false): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const clamped = Math.min(maximum, Math.max(minimum, value))
  return round ? Math.round(clamped) : clamped
}

function normalizeConfig(input: Partial<SmallTalkSemanticConfig> | undefined): SmallTalkSemanticConfig {
  const confidenceThreshold = bounded(input?.confidenceThreshold, LIMITS.minimumConfidence, LIMITS.maximumConfidence)
  const top1Top2Margin = bounded(input?.top1Top2Margin, LIMITS.minimumConfidence, LIMITS.maximumConfidence)
  const timeoutMs = bounded(input?.timeoutMs, LIMITS.minimumTimeoutMs, LIMITS.maximumTimeoutMs, true)
  // Khoá VẮNG MẶT, không phải khoá bằng `undefined`: "người triển khai không đặt" phải phân
  // biệt được với "đặt bằng mặc định", nếu không ranker tự khai 0.65 lại bị kéo về 0.82 của
  // khung. Nơi gọi điền mặc định qua `resolveSemanticConfig`.
  return {
    enabled: input?.enabled === true,
    ...(confidenceThreshold === undefined ? {} : { confidenceThreshold }),
    ...(top1Top2Margin === undefined ? {} : { top1Top2Margin }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  }
}

/**
 * Bộ cấu hình CUỐI CÙNG cho một lượt chọn: phần người triển khai đặt được áp lên mặc định
 * của ranker. Tách khỏi `normalizeConfig` để một ranker khác cắm vào chỉ cần truyền bộ mặc
 * định của nó, không phải sửa hàm chuẩn hoá.
 */
export type ResolvedSemanticConfig = {
  enabled: boolean
  confidenceThreshold: number
  top1Top2Margin: number
  timeoutMs: number
}

function resolveSemanticConfig(
  input: Partial<SmallTalkSemanticConfig> | undefined,
  defaults: { confidenceThreshold: number, top1Top2Margin: number, timeoutMs: number },
): ResolvedSemanticConfig {
  const normalized = normalizeConfig(input)
  return {
    enabled: normalized.enabled,
    confidenceThreshold: normalized.confidenceThreshold ?? defaults.confidenceThreshold,
    top1Top2Margin: normalized.top1Top2Margin ?? defaults.top1Top2Margin,
    timeoutMs: normalized.timeoutMs ?? defaults.timeoutMs,
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
      Promise.resolve().then(() => provider.rank({ query, candidates: entries, signal: controller.signal })).catch(() => null),
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
export async function selectSmallTalk<Entry extends SemanticSmallTalkSource>(
  options: SelectSmallTalkOptions<Entry>,
): Promise<SmallTalkSelection | null> {
  if (options.businessReferences.length > 0) return null

  const query = typeof options.query === 'string' ? options.query.normalize('NFKC').trim() : ''
  if (!query) return null

  const entriesById = new Map(options.entries.map(entry => [entry.id, entry]))
  const rule = options.ruleMatcher(options.entries, query)
  const ruleEntry = rule ? entriesById.get(rule.id) : undefined
  if (ruleEntry) return selection(projectSemanticEntry(ruleEntry), 1)

  const config = resolveSemanticConfig(options.semanticConfig, options.semanticDefaults ?? {
    confidenceThreshold: SMALL_TALK_SEMANTIC_DEFAULTS.confidenceThreshold,
    top1Top2Margin: SMALL_TALK_SEMANTIC_DEFAULTS.top1Top2Margin,
    timeoutMs: SMALL_TALK_SEMANTIC_DEFAULTS.timeoutMs,
  })
  if (!config.enabled || !options.semanticProvider || options.entries.length === 0) return null
  if (query.length > LIMITS.maximumQueryChars) return null

  const projectedEntries = options.entries.map(projectSemanticEntry)
  const projectedById = new Map(projectedEntries.map(entry => [entry.id, entry]))
  const rawScores = await rankWithinTimeout(options.semanticProvider, query, projectedEntries, config.timeoutMs)
  if (!Array.isArray(rawScores)) return null

  const ranked = acceptedScores(rawScores, projectedById)
  const top = ranked[0]
  if (!top || top.confidence < config.confidenceThreshold) return null

  const runnerUpConfidence = ranked[1]?.confidence ?? 0
  if (top.confidence - runnerUpConfidence < config.top1Top2Margin) return null

  const matchedEntry = projectedById.get(top.entryId)
  return matchedEntry ? selection(matchedEntry, top.confidence) : null
}
