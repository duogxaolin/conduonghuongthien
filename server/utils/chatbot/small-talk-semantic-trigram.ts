/**
 * Ranker ngữ nghĩa CỤC BỘ cho kho small-talk: cosine trên trigram ký tự.
 *
 * Vì sao có tệp này: `small-talk-semantic.ts` cố ý chỉ là KHUNG — nó không mang model
 * runtime và bị tắt nếu không có provider cắm vào, và tới 2026-11-04 chưa có provider
 * nào cả. Hệ quả đo được: bộ luật tất định chỉ bắt 15/23 biến thể chào hỏi/cảm ơn thường
 * gặp ("Hi bạn ơi", "helo", "thank you", "tks nhé", "bye bye", "ok bạn", "ngủ ngon nhé").
 *
 * Trigram ký tự (sau khi bỏ dấu) là lựa chọn rẻ nhất còn hoạt động với tiếng Việt không
 * dấu/thiếu dấu, không cần model, không cần mạng, không cần thêm dependency:
 *   - "helo" ~ "hello" 0.67   (gõ thiếu ký tự)
 *   - "thank you" ~ "thanks" 0.55
 *   - "ngủ ngon nhé" ~ "chúc ngủ ngon" 0.66
 *
 * Đo trên kho 122 mục (2026-11-04, `cdkt_ai_qa`), bộ hẹp 23 câu cần bắt + 12 câu lạc đề:
 *   luật tất định                  bắt 15/23, lọt 0
 *   luật + trigram @0.65/margin 0   bắt 18/23, lọt 0
 * Bộ rộng hơn (26 câu chào/cảm ơn/tạm biệt/danh tính + 20 câu nghiệp vụ và đời thường):
 *   luật + trigram                  bắt 25/26, lọt 0 sau khi soát
 * Câu duy nhất "lọt" trong lượt đo đầu ("Tôi muốn gặp cán bộ phụ trách địa bàn") thực ra
 * khớp ĐÚNG mục `navigation` "muốn gặp cán bộ" — nhãn của người đo sai, không phải ranker.
 * Câu còn sót là "thank you" (0.55 < 0.65).
 *
 * Đo ĐẦU-CUỐI qua `answerChat` (đúng đường production, `cdkt_ai_qa`, cùng bộ 26 câu chào +
 * 20 câu nghiệp vụ/đời thường), bật/tắt bằng biến môi trường trong hai tiến trình riêng:
 *   TẮT  small_talk 16/26, lạc đề vào small_talk 0/20
 *   BẬT  small_talk 19/26, lạc đề vào small_talk 0/20
 * Sáu câu còn sót bị KHO NGHIỆP VỤ bắt trước (`kind: 'curated'`) — "tạm biệt" khớp từ khoá
 * âm tiết `tam` của "tâm lý", "chúc ngủ ngon" khớp `chuc` của "chức". Đó là ngưỡng liên
 * quan của tầng truy xuất (`retrieval.ts`), không phải của ranker này: đo riêng `selectSmallTalk`
 * (bỏ qua kho) cho 25/26. Sửa gốc nằm ở việc khoá một-âm-tiết chỉ được tính là bằng chứng
 * khi có thêm khớp khác — chưa làm vì đo được là làm thế mất câu nghiệp vụ thật.
 *
 * Hạ ngưỡng KHÔNG phải cách bắt phần còn sót: ở 0.5 bộ hẹp bắt 22/23 nhưng lọt 4/12 câu
 * nghiệp vụ ("Xóa án tích cần gì?", "Học nghề miễn phí ở đâu?"), tức là chào lại người
 * đang hỏi thủ tục. Muốn bắt thêm thì thêm mẫu vào chính kho.
 *
 * Ngưỡng mặc định ở `SMALL_TALK_SEMANTIC_DEFAULTS` là 0.82 (dành cho một ranker ngữ nghĩa
 * thật). Provider này tự khai ngưỡng của nó ở `SMALL_TALK_TRIGRAM_DEFAULTS` và bootstrap
 * dùng đúng bộ đó — đừng đổi một bên mà không đo lại bên kia.
 */
import type {
  SemanticSmallTalkEntry,
  SemanticSmallTalkProvider,
  SemanticSmallTalkScore,
} from './small-talk-semantic'

/** Đo được, không phải chọn theo cảm giác: xem bảng ở đầu tệp. */
export const SMALL_TALK_TRIGRAM_DEFAULTS = Object.freeze({
  confidenceThreshold: 0.65,
  /**
   * Không cần biên: ở 0.65 không câu lạc đề nào vượt ngưỡng, nên biên chỉ làm mất câu
   * đúng ("cảm ơn nhiều lắm" có hai mục gần nhau). Để 0 và ghi lại phép đo.
   */
  top1Top2Margin: 0,
  timeoutMs: 60,
})

/** Bỏ dấu, hạ chữ, gom mọi dấu câu về khoảng trắng — cùng phép chuẩn hoá với kho. */
export function normalizeForTrigram(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[đĐ]/gu, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Trigram ký tự, có đệm hai đầu để "hi" và "hi " khác nhau. */
function trigrams(value: string): Map<string, number> {
  const padded = ` ${normalizeForTrigram(value)} `
  const counts = new Map<string, number>()
  for (let i = 0; i < padded.length - 2; i += 1) {
    const gram = padded.slice(i, i + 3)
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }
  return counts
}

function cosine(left: Map<string, number>, right: Map<string, number>): number {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (const [gram, count] of left) {
    leftNorm += count * count
    const other = right.get(gram)
    if (other) dot += count * other
  }
  for (const count of right.values()) rightNorm += count * count
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0
}

export type TrigramRanker = SemanticSmallTalkProvider & {
  /** Số mục đã lập chỉ mục; để log lúc boot. */
  readonly size: number
}

/**
 * Dựng ranker trên một danh sách mục đã chiếu (`projectSemanticEntry`).
 *
 * Chỉ đọc `semanticExamples` — KHÔNG đọc `answer`. Provider không bao giờ chạm nội dung
 * trả lời; `selectSmallTalk` tự tra câu trả lời từ hàng CSDL gốc.
 */
export function createTrigramRanker(entries: readonly SemanticSmallTalkEntry[]): TrigramRanker {
  /**
   * Bộ nhớ trigram theo mục, KHOÁ CẢ BẰNG CHÍNH CÁC VÍ DỤ: ứng viên được chấm theo ví dụ nó MANG THEO
   * (chiếu từ hàng CSDL vừa nạp), chỉ mục chỉ để khỏi tính lại khi ví dụ không đổi. Bản đầu chấm theo bản
   * chụp lúc dựng ranker — mục small-talk vừa thêm/sửa không khớp ở lượt hỏi đầu tiên sau khi sửa, câu đó
   * rơi xuống model, và câu của model được cache dưới khoá mới, che mục mới tới 30 ngày (2026-11-06).
   */
  const index = new Map<number, { key: string, grams: Map<string, number>[] }>()
  const gramsOf = (entry: SemanticSmallTalkEntry): Map<string, number>[] => {
    const examples = entry.semanticExamples.filter(example => typeof example === 'string' && example.trim().length > 0)
    const key = examples.join('\u0000')
    const known = index.get(entry.id)
    if (known && known.key === key) return known.grams
    const grams = examples.map(trigrams)
    index.set(entry.id, { key, grams })
    return grams
  }
  const size = entries.filter(entry => gramsOf(entry).length > 0).length

  return {
    size,
    async rank({ query, candidates }): Promise<readonly SemanticSmallTalkScore[]> {
      const queryGrams = trigrams(query)
      const scores: SemanticSmallTalkScore[] = []
      for (const candidate of candidates) {
        const grams = gramsOf(candidate)
        if (!grams.length) continue
        let best = 0
        for (const gram of grams) {
          const score = cosine(queryGrams, gram)
          if (score > best) best = score
        }
        scores.push({ entryId: candidate.id, confidence: best })
      }
      return scores
    },
  }
}
