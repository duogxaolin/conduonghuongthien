import { normalizeKnowledgeText, retrieveKnowledge, type RetrievalEntry } from './retrieval'

/**
 * Câu hỏi gợi ý tiếp theo dưới mỗi câu trả lời của trợ lý.
 *
 * Kết hợp hai nguồn:
 *  1. **AI đề xuất** — model viết thêm vài câu hỏi tiếp theo ở cuối câu trả lời,
 *     sau dòng đánh dấu `FOLLOW_UP_MARKER`. Sát nội dung vừa trả lời, văn phong
 *     tự nhiên.
 *  2. **Kho tri thức đã duyệt** — mỗi đề xuất của AI chỉ được giữ khi nó khớp một
 *     mục trong kho (`retrieveKnowledge`, cùng bộ so khớp chatbot dùng để trả
 *     lời). Gợi ý một câu rồi bấm vào chatbot không trả lời được thì còn tệ hơn
 *     không gợi ý. Thiếu chỗ thì lấp bằng câu hỏi gốc của các mục kho vừa được
 *     tra cho câu trả lời này.
 *
 * Phần đánh dấu không bao giờ tới tay người đọc: bộ lọc stream giữ lại mọi thứ
 * từ dấu trở đi, và câu trả lời lưu/gửi đi được cắt tại dấu.
 */

export const FOLLOW_UP_MARKER = '[[GOI_Y]]'
export const FOLLOW_UP_LIMIT = 3
export const FOLLOW_UP_MAX_CHARS = 200
/** Đề xuất của AI được đọc tối đa chừng này dòng — phần còn lại là model nói lan man. */
const MAX_PROPOSALS = 6

/**
 * Bọc `forward` để phần đánh dấu và mọi thứ sau nó không bao giờ được phát ra.
 *
 * Dấu có thể bị cắt ngang giữa hai chunk (`…[[GO` | `I_Y]]…`), nên phần đuôi của
 * mỗi chunk trông giống đầu dấu được giữ lại tới chunk sau. Phần đuôi đó gần như
 * luôn ngắn (`[`, `[[`) và được nhả ra ngay khi chunk sau cho thấy nó không phải
 * dấu — một liên kết markdown `[Tên bài](…)` chỉ trễ đúng một chunk.
 */
export function createFollowUpStreamFilter(forward: (chunk: string) => void | Promise<void>) {
  let pending = ''
  let swallowed = false

  const heldPrefixLength = (text: string): number => {
    for (let length = Math.min(text.length, FOLLOW_UP_MARKER.length - 1); length > 0; length--) {
      if (FOLLOW_UP_MARKER.startsWith(text.slice(-length))) return length
    }
    return 0
  }

  return {
    async push(chunk: string): Promise<void> {
      if (swallowed || !chunk) return
      const text = pending + chunk
      const markerAt = text.indexOf(FOLLOW_UP_MARKER)
      if (markerAt !== -1) {
        swallowed = true
        pending = ''
        const before = text.slice(0, markerAt)
        if (before) await forward(before)
        return
      }
      const hold = heldPrefixLength(text)
      pending = hold ? text.slice(-hold) : ''
      const release = hold ? text.slice(0, -hold) : text
      if (release) await forward(release)
    },
    /** Stream đã đóng: phần đuôi đang giữ hoá ra không phải dấu, nhả nốt. */
    async finish(): Promise<void> {
      if (!swallowed && pending) await forward(pending)
      pending = ''
    },
  }
}

/** Cắt câu trả lời tại dấu và đọc các câu hỏi AI đề xuất phía sau nó. */
export function splitFollowUps(text: string): { answer: string, proposals: string[] } {
  const markerAt = text.indexOf(FOLLOW_UP_MARKER)
  if (markerAt === -1) return { answer: text, proposals: [] }
  const proposals = text.slice(markerAt + FOLLOW_UP_MARKER.length)
    .split('\n')
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\*\*/g, '').trim())
    .filter(line => line.length >= 6 && line.length <= FOLLOW_UP_MAX_CHARS)
    .slice(0, MAX_PROPOSALS)
  return { answer: text.slice(0, markerAt).trimEnd(), proposals }
}

const sameQuestion = (a: string, b: string) => normalizeKnowledgeText(a).replace(/[?.!\s]+$/u, '') === normalizeKnowledgeText(b).replace(/[?.!\s]+$/u, '')

/**
 * Chọn tối đa `FOLLOW_UP_LIMIT` câu gợi ý.
 *
 * Đề xuất của AI đi trước, giữ nguyên lời AI viết, nhưng chỉ khi khớp một mục
 * kho đã xuất bản; hai đề xuất trỏ về cùng một mục chỉ giữ một. Chỗ còn thiếu
 * lấp bằng `fallback` (câu hỏi gốc của các mục kho vừa được tra), bỏ qua mục đã
 * có một đề xuất trỏ tới. Câu
 * trùng với chính câu người dùng vừa hỏi bị bỏ — gợi ý hỏi lại điều vừa hỏi là
 * vô nghĩa.
 */
export function selectFollowUps(input: {
  proposals: string[]
  entries: RetrievalEntry[]
  userQuery: string
  fallback?: { id: number, question: string }[]
  retrieve?: typeof retrieveKnowledge
}): string[] {
  const retrieve = input.retrieve ?? retrieveKnowledge
  const chosen: string[] = []
  const usedEntryIds = new Set<number>()
  const isNew = (question: string) => !sameQuestion(question, input.userQuery) && !chosen.some(item => sameQuestion(item, question))

  for (const proposal of input.proposals) {
    if (chosen.length >= FOLLOW_UP_LIMIT) break
    if (!isNew(proposal)) continue
    const [match] = retrieve(input.entries, proposal, { topK: 1 })
    if (!match || usedEntryIds.has(match.id)) continue
    usedEntryIds.add(match.id)
    chosen.push(proposal.slice(0, FOLLOW_UP_MAX_CHARS))
  }

  for (const item of input.fallback ?? []) {
    if (chosen.length >= FOLLOW_UP_LIMIT) break
    const trimmed = item.question.normalize('NFKC').trim()
    if (!trimmed || trimmed.length > FOLLOW_UP_MAX_CHARS || usedEntryIds.has(item.id) || !isNew(trimmed)) continue
    usedEntryIds.add(item.id)
    chosen.push(trimmed)
  }
  return chosen
}
