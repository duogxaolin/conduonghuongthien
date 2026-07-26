import type { ChatbotKnowledge, ChatbotKnowledgeTerm } from '../../db/schema'
import { safePublicSourceUrl } from './serializers'

export type RetrievalEntry = ChatbotKnowledge & { terms?: Pick<ChatbotKnowledgeTerm, 'kind' | 'value' | 'normalizedValue'>[] }

export type PublicKnowledgeReference = ReturnType<typeof toPublicReference>
export type RetrievalOptions = {
  topK?: number
  charBudget?: number
  tokenBudget?: number
  topic?: string
}

/** Normalize Unicode/case/whitespace without interpreting content as instructions. */
export function normalizeKnowledgeText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.normalize('NFKC').trim().toLocaleLowerCase('vi-VN').replace(/\s+/gu, ' ')
}

function searchForm(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/gu, '').replace(/[đĐ]/gu, 'd')
}

function tokens(value: string): string[] {
  return [...new Set(searchForm(normalizeKnowledgeText(value)).split(/[^\p{L}\p{N}]+/u).filter(token => token.length > 0))]
}

function toPublicReference(entry: RetrievalEntry) {
  return {
    id: entry.id,
    question: entry.canonicalQuestion,
    answer: entry.approvedAnswer,
    topic: entry.topic,
    source: entry.sourceLabel || entry.sourceReference || entry.sourceUrl
      ? { label: entry.sourceLabel ?? null, reference: entry.sourceReference ?? null, url: safePublicSourceUrl(entry.sourceUrl) }
      : null,
  }
}

function referenceSize(reference: PublicKnowledgeReference): number {
  return JSON.stringify(reference).length
}

/** Pure, published-only, deterministic retrieval. Private fields are never copied to output. */
export function retrieveKnowledge(entries: RetrievalEntry[], query: string, options: RetrievalOptions = {}) {
  const normalizedQuery = normalizeKnowledgeText(query)
  if (!normalizedQuery) return [] as PublicKnowledgeReference[]
  const querySearch = searchForm(normalizedQuery)
  const queryTokens = tokens(normalizedQuery)
  const topK = Math.min(10, Math.max(1, Math.floor(options.topK ?? 3)))
  const charBudget = options.charBudget === undefined ? Infinity : Math.max(0, Math.floor(options.charBudget))
  const tokenBudget = options.tokenBudget === undefined ? Infinity : Math.max(0, Math.floor(options.tokenBudget))

  const ranked = entries.filter(entry => entry.status === 'published' && (!options.topic || normalizeKnowledgeText(entry.topic) === normalizeKnowledgeText(options.topic)))
    .map(entry => {
      const canonical = searchForm(normalizeKnowledgeText(entry.canonicalQuestion))
      const terms = (entry.terms ?? []).map(term => ({ ...term, normalized: searchForm(normalizeKnowledgeText(term.normalizedValue || term.value)) }))
      const aliases = terms.filter(term => term.kind === 'alias').map(term => term.normalized)
      const keywords = terms.filter(term => term.kind === 'keyword').map(term => term.normalized)
      const exact = canonical === querySearch
      const aliasExact = aliases.includes(querySearch)
      // Substring (fuzzy) matching is gated to tokens/keywords of length >= 3 so
      // that ubiquitous 2-char syllables (e.g. "an" inside "san"/"hanh") do not
      // create spurious matches; exact equality still matches any length.
      // Multi-word terms must appear as a whole phrase in the query. Matching
      // them per-token would let "công tác" fire on an unrelated question that
      // merely contains "công". Single-word terms keep the token rules above.
      const matchedKeywords = keywords.filter((keyword) => {
        if (keyword.includes(' ')) return querySearch.includes(keyword)
        return queryTokens.some(token => keyword === token || (token.length >= 3 && keyword.includes(token)) || (keyword.length >= 3 && token.includes(keyword)))
      }).length
      const canonicalTokens = tokens(entry.canonicalQuestion)
      const partial = canonicalTokens.filter(token => queryTokens.includes(token)).length
      const score = exact ? 10000 : aliasExact ? 9000 : matchedKeywords * 100 + partial
      return { entry, score, exact, aliasExact, matchedKeywords, partial }
    })
    // Relevance floor. Sharing a single ordinary word with a question is not
    // evidence of relevance — without this, an unrelated query ("công thức nấu
    // phở") matches any entry containing "công" and the assistant answers with
    // an irrelevant legal text instead of offering to take the visitor's details.
    // An entry still qualifies on any keyword/alias hit, or on two or more
    // overlapping words of the canonical question (which keeps entries that were
    // created without explicit keyword terms working).
    .filter(item => item.exact || item.aliasExact || item.matchedKeywords >= 1 || item.partial >= 2)
    .sort((a, b) => b.score - a.score || Number(b.entry.priority) - Number(a.entry.priority) || Number(a.entry.id) - Number(b.entry.id))

  const result: PublicKnowledgeReference[] = []
  let chars = 0
  let tokenCount = 0
  for (const item of ranked.slice(0, topK)) {
    const reference = toPublicReference(item.entry)
    const size = referenceSize(reference)
    const count = tokens(`${reference.question} ${reference.answer}`).length
    if (chars + size > charBudget || tokenCount + count > tokenBudget) continue
    result.push(reference)
    chars += size
    tokenCount += count
  }
  return result
}
