import type { ChatbotKnowledge, ChatbotKnowledgeTerm } from '../../db/schema'
import { safePublicSourceUrl } from './serializers'

export type RetrievalEntry = ChatbotKnowledge & { terms?: Pick<ChatbotKnowledgeTerm, 'kind' | 'value' | 'normalizedValue'>[] }

/**
 * A reference surfaced to the citizen. `kind` distinguishes where it came from
 * so the chat can decide how to display it:
 *   - `'knowledge'` — an approved entry from the `chatbot_knowledge` bank. These
 *     are the only references that belong in the "Nguồn tham khảo" citation
 *     list, because they point at curated, sourced legal/administrative text.
 *   - `'evidence'` — prefetched articles / videos / photos from `prefetchEvidence`.
 *     These are already woven into the answer body via `renderEvidenceBlock`
 *     (article links, video posters, inline photos), so listing them again
 *     under "Nguồn tham khảo" would duplicate what the citizen already sees above.
 */
export type PublicKnowledgeReference = {
  id: number
  kind: 'knowledge' | 'evidence'
  question: string
  answer: string
  topic: string
  source: { label: string | null, reference: string | null, url: string | null } | null
}
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

/**
 * Hư từ tiếng Việt (đã bỏ dấu) — KHÔNG bao giờ tính là bằng chứng liên quan.
 *
 * Đo trên kho 20 mục của bản QA (2026-11-04): câu "Công thức nấu phở bò ngon?"
 * khớp mục "Những nguyên tắc trong thực hiện công tác tái hòa nhập" **chỉ** vì token
 * "thuc" (từ "thức") nằm trong "thực hiện", cộng "cong" nằm trong "công tác" — đủ
 * `matchedKeywords >= 1` và `partial >= 2` để vượt ngưỡng. Câu "luật sư miễn phí"
 * khớp nhờ "su"/"can" ("sư"/"cần"). Câu "đăng ký cư trú thế nào" khớp 13/20 mục nhờ
 * "the"/"nao" ("thế"/"nào").
 *
 * Đây là bộ lọc theo TỪ, không phải theo ngữ nghĩa: một hư từ không mang chủ đề, nên
 * khớp nó không nói gì về việc mục có trả lời đúng câu hỏi hay không. Giữ danh sách
 * NGẮN và chỉ gồm từ chức năng — thêm một từ mang nghĩa vào đây sẽ làm mất kết quả
 * đúng (vd. "cho", "của" chỉ dùng khi đi với từ khác nên để lại).
 */
const VIETNAMESE_STOP_WORDS: Readonly<Record<string, true>> = {
  va: true, la: true, thi: true, ma: true, nen: true, deu: true, cung: true, chi: true, con: true,
  the: true, nao: true, gi: true, sao: true, ai: true, dau: true, bao: true, nhieu: true, khi: true, luc: true,
  toi: true, minh: true, chung: true, ho: true, ban: true, anh: true, em: true,
  co: true, khong: true, duoc: true, bi: true, se: true, da: true, dang: true, vua: true, moi: true,
  ve: true, trong: true, ngoai: true, tren: true, duoi: true, truoc: true, sau: true, giua: true, voi: true,
  nhu: true, theo: true, boi: true, de: true, vi: true, tai: true, vao: true, ra: true,
  nay: true, do: true, kia: true, ay: true, no: true, day: true,
  can: true, muon: true, phai: true, hay: true,
  thuc: true, su: true, cong: true, viec: true, cac: true, nhung: true, mot: true,
}

/** Token dùng để CHẤM ĐIỂM: bỏ hư từ. Rỗng khi câu chỉ gồm hư từ (→ không khớp gì). */
function contentTokens(value: string): string[] {
  return tokens(value).filter(token => !VIETNAMESE_STOP_WORDS[token])
}

function tokens(value: string): string[] {
  return [...new Set(searchForm(normalizeKnowledgeText(value)).split(/[^\p{L}\p{N}]+/u).filter(token => token.length > 0))]
}

function toPublicReference(entry: RetrievalEntry): PublicKnowledgeReference {
  return {
    id: entry.id,
    kind: 'knowledge',
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
  const queryTokens = contentTokens(normalizedQuery)
  // Câu chỉ gồm hư từ ("thế nào?", "là gì?") không mang chủ đề nào để tra. Trả rỗng
  // thay vì để `partial >= 2` khớp mọi mục có chữ "thế nào" trong câu hỏi chuẩn.
  if (queryTokens.length === 0) return [] as PublicKnowledgeReference[]
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
      // Substring (fuzzy) matching is gated to tokens/keywords of length >= 4 so
      // that ubiquitous short syllables do not create spurious matches; exact
      // equality still matches any length. Vietnamese syllables in their
      // diacritic-stripped form are mostly 2-3 characters ("thu", "cong",
      // "tac"), so a threshold of 3 lets nearly every single syllable through —
      // that is why keyword "thủ" (search form "thu") matched token "thức"
      // ("thuc"), pulling "công thức nấu phở" into a legal entry. A threshold of
      // 4 cuts that class while keeping meaningful prefix matches ("giay to"
      // matching "giay to tuy than" is 7 chars).
      // Multi-word terms must appear as a whole phrase in the query. Matching
      // them per-token would let "công tác" fire on an unrelated question that
      // merely contains "công". Single-word terms keep the token rules above.
      const matchedKeywords = keywords.filter((keyword) => {
        if (keyword.includes(' ')) return querySearch.includes(keyword)
        return queryTokens.some(token => keyword === token || (token.length >= 4 && keyword.includes(token)) || (keyword.length >= 4 && token.includes(keyword)))
      })
      // Hai vế đều bỏ hư từ: khớp "thế"/"nào" không nói gì về chủ đề, và một mục
      // có 5 hư từ trong câu hỏi chuẩn sẽ vượt `partial >= 2` với mọi câu hỏi khác.
      const canonicalTokens = contentTokens(entry.canonicalQuestion)
      const partial = canonicalTokens.filter(token => queryTokens.includes(token)).length
      const score = exact ? 10000 : aliasExact ? 9000 : matchedKeywords.length * 100 + partial
      return { entry, score, exact, aliasExact, matchedKeywordCount: matchedKeywords.length, partial }
    })
    // Relevance floor. Sharing one ordinary word with a question is not evidence of
    // relevance — without this, "công thức nấu phở" matched every entry containing
    // "công" and the assistant answered with an irrelevant legal text instead of
    // offering to take the visitor's details.
    //
    // Cổng liên quan. Đo trên kho 20 mục: 10 câu đúng chủ đề + 6 câu lạc đề
    // (2026-11-04; "lọt" = câu lạc đề vẫn trả về tài liệu):
    //   bỏ hư từ + ngưỡng này     10/10 đúng, 3/6 lọt
    //   KHÔNG bỏ hư từ (bản cũ)    10/10 đúng, 5/6 lọt
    // Bỏ hư từ mua được độ chính xác mà KHÔNG mất câu đúng nào: nó xoá đúng nhóm khớp
    // giả ("thuc"~"thực hiện", "cong"~"công tác", "can"~"cần", "su"~"sư", "the"/"nao"
    // của "thế nào"). Siết thêm bằng độ dài từ khoá thì mất câu thật — "vay 100 triệu"
    // chỉ khớp qua "vay", "tìm việc" qua "tim"/"viec" (đo: 7–9/10 đúng).
    //
    // Ba câu còn lọt là ĐỒNG ÂM KHÁC NGHĨA, không phải ngưỡng: "giá vàng"~"… và gia
    // đình", "nấu canh"~"chuẩn bị", "bóng đá Việt Nam"~"Việt Nam" (một cụm từ khoá thật
    // của mục 8). Bài toán ngữ nghĩa, không giải được bằng bộ so chuỗi — xem
    // `docs/decisions/chatbot.md` § truy xuất, và bước 5 (semantic provider).
    .filter(item => item.exact || item.aliasExact || item.matchedKeywordCount >= 1 || item.partial >= 2)
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
