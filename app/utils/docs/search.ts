/**
 * Doc search engine — 3-tier matching ported from server/utils/chatbot/retrieval.ts.
 *
 * The 3 pure functions below (normalizeKnowledgeText, searchForm, tokens) are
 * copied — NOT imported — from retrieval.ts because that file imports Drizzle/DB
 * types which must not enter the client bundle. The functions are pure string
 * ops (~10 lines total). If a third consumer appears, extract to shared/utils.
 *
 * Source: server/utils/chatbot/retrieval.ts — keep in sync if changed there.
 */

// ── Ported from retrieval.ts (do not import server utils here) ────────

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

// ── Types ──────────────────────────────────────────────────────────────

export type SearchIntent = 'procedure' | 'explanation' | 'location' | 'definition' | 'keyword'

export type SearchableDoc = {
  slug: string
  title: string
  description: string
  aliases?: string[]
  keywords?: string[]
  questions?: string[]
}

/**
 * Generic so the caller keeps its own fields. `searchDocs` spreads each doc into
 * its result, so `icon`/`summary` of an `AdminDoc` are there at runtime; typing
 * the result as plain `SearchableDoc` hid them and made the page read fields the
 * compiler said did not exist.
 */
export type SearchResult<T extends SearchableDoc = SearchableDoc> = T & {
  score: number
  intent: SearchIntent
  matchedKeywords: number
  tokenOverlap: number
}

// ── Intent detection ───────────────────────────────────────────────────

const INTENT_PATTERNS: Array<[SearchIntent, RegExp]> = [
  ['procedure', /(?:làm sao|cách|how to|hướng dẫn|thực hiện|làm thế nào)/iu],
  ['explanation', /(?:tại sao|vì sao|why|nguyên nhân)/iu],
  ['location', /(?:ở đâu|where|vị trí|chỗ nào|nào có)/iu],
  ['definition', /(?:là gì|what is|định nghĩa|định nghĩa là gì)/iu],
]

export function detectIntent(query: string): SearchIntent {
  const normalized = normalizeKnowledgeText(query)
  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(normalized)) return intent
  }
  return 'keyword'
}

// ── Doc scoring (3-tier matching) ──────────────────────────────────────

export function scoreDoc(
  doc: SearchableDoc,
  querySearch: string,
  queryTokens: string[],
): { score: number; exact: boolean; aliasExact: boolean; matchedKeywords: number; tokenOverlap: number } {
  const titleSearch = searchForm(normalizeKnowledgeText(doc.title))
  const aliases = (doc.aliases ?? []).map(a => searchForm(normalizeKnowledgeText(a)))
  const keywords = (doc.keywords ?? []).map(k => searchForm(normalizeKnowledgeText(k)))

  const exact = titleSearch === querySearch
  const aliasExact = aliases.includes(querySearch)

  const matchedKeywords = keywords.filter(keyword => {
    if (keyword.includes(' '))
      return querySearch.includes(keyword)
    return queryTokens.some(token =>
      keyword === token
      || (token.length >= 4 && keyword.includes(token))
      || (keyword.length >= 4 && token.includes(keyword)),
    )
  }).length

  const docTokens = tokens(`${doc.title} ${doc.description} ${(doc.questions ?? []).join(' ')}`)
  const tokenOverlap = docTokens.filter(t => queryTokens.includes(t)).length

  const score = exact
    ? 10000
    : aliasExact
      ? 9000
      : matchedKeywords * 100 + tokenOverlap

  return { score, exact, aliasExact, matchedKeywords, tokenOverlap }
}

// ── Full search ────────────────────────────────────────────────────────

export function searchDocs<T extends SearchableDoc>(docs: T[], query: string, topK = 10): SearchResult<T>[] {
  const trimmed = query.slice(0, 200)
  const normalizedQuery = normalizeKnowledgeText(trimmed)
  if (!normalizedQuery) return []

  const querySearch = searchForm(normalizedQuery)
  const queryTokens = tokens(normalizedQuery)
  const intent = detectIntent(trimmed)

  return docs
    .map(doc => {
      const result = scoreDoc(doc, querySearch, queryTokens)
      return { ...doc, ...result, intent }
    })
    .filter(item => item.exact || item.aliasExact || item.matchedKeywords >= 1 || item.tokenOverlap >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

// ── Suggested questions for empty state ────────────────────────────────

export function suggestQuestions(docs: SearchableDoc[], count = 6): string[] {
  const all = docs.flatMap(d => d.questions ?? [])
  if (all.length <= count) return all
  const shuffled = [...all]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = shuffled[i]!
    shuffled[i] = shuffled[j]!
    shuffled[j] = a
  }
  return shuffled.slice(0, count)
}
