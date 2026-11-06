/**
 * Khoá của cache câu trả lời chatbot (`chatbot_answer_cache`) — mã THUẦN, không đọc CSDL, để
 * `server/services/chatbot-answer-cache.ts`, lượt dọn định kỳ và E2E tính ra CÙNG một khoá.
 * Thiết kế khoá (phiên bản dữ liệu + cấu hình trong khoá, không cache lượt nhiều câu): xem đầu
 * tệp service và `docs/decisions/chatbot.md` § Bộ đệm câu trả lời.
 */
import { createHash } from 'node:crypto'
import type { ChatbotSettings } from '../../db/schema'
import { searchForm } from './retrieval'

export type AnswerCacheSettings = Pick<ChatbotSettings, 'mode' | 'outOfScopeBehavior' | 'model' | 'baseUrl' | 'systemPrompt'>

/**
 * Bộ tính khoá cho MỘT cấu hình + phiên bản: phần không đổi theo câu hỏi (băm system prompt — tới 20 000
 * ký tự) tính một lần. Lượt dọn dựng lại khoá cho hàng nghìn hàng; băm lại prompt ở mỗi hàng từng chặn
 * event loop ~1 s ở 20 000 hàng (verifier 2026-11-06). Trả `null` = "câu này không được cache".
 */
export function answerCacheKeyer(settings: AnswerCacheSettings, version: number): (question: string) => string | null {
  // Prompt dài; băm riêng để khoá cuối vẫn cố định độ dài.
  const promptHash = createHash('sha256').update(settings.systemPrompt ?? '').digest('hex')
  const fixed = [version, settings.mode, settings.outOfScopeBehavior, settings.model ?? '', settings.baseUrl ?? '', promptHash] as const
  return (question) => {
    // Dạng TÌM KIẾM (bỏ dấu) chứ không phải dạng hiển thị: người gõ "lam sao de xoa an
    // tich" và "Làm sao để xóa án tích?" là cùng một câu hỏi. Dùng `normalizeKnowledgeText`
    // ở đây sẽ tách chúng thành hai hàng cache và làm cache gần như vô dụng với người gõ
    // không dấu — nhóm người dùng rất đông trên cổng này.
    const normalized = searchForm(question).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim()
    if (!normalized) return null
    return createHash('sha256').update(JSON.stringify([normalized, ...fixed])).digest('hex')
  }
}

/**
 * Khoá cache. Trả `null` nghĩa là "lượt này không được cache" — người gọi coi như miss
 * và đi tiếp bình thường.
 */
export function answerCacheKey(input: {
  question: string
  settings: AnswerCacheSettings
  version: number
  historyLength: number
}): string | null {
  // Câu trả lời cho lượt có ngữ cảnh phụ thuộc các lượt trước; một khoá theo câu hỏi
  // hiện tại sẽ trả lời sai ngữ cảnh.
  if (input.historyLength > 1) return null
  return answerCacheKeyer(input.settings, input.version)(input.question)
}

/**
 * Hàng này còn được tra tới không? Khoá chỉ băm từ câu hỏi + phiên bản + cấu hình, nên dựng lại
 * khoá từ câu hỏi đã lưu với phiên bản/cấu hình HIỆN TẠI: khác khoá của hàng ⇒ không lượt hỏi nào
 * tính ra khoá đó nữa (đã tăng phiên bản, đổi model/prompt…) — hàng chết, chỉ còn chiếm chỗ và giữ
 * câu hỏi của người dân. Hàng được cache luôn là lượt một câu (`historyLength` 1). Nhiều hàng: dùng
 * `answerCacheKeyer` một lần.
 */
export function answerCacheKeyIsLive(
  row: { cacheKey: string, question: string },
  settings: AnswerCacheSettings,
  version: number,
): boolean {
  return answerCacheKeyer(settings, version)(row.question) === row.cacheKey
}
