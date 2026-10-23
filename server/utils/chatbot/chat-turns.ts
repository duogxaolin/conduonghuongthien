/**
 * Đọc nội dung một lượt chat — MỘT cách duy nhất cho kiểm duyệt, trả lời và lưu.
 *
 * Hai endpoint công khai từng kiểm duyệt `text ?? content` (chuỗi thô) trong khi
 * `chat-policy.ts` trả lời `content ?? text` đã chuẩn hoá NFKC (rà soát 2026-10-22).
 * Một request mang `text` vô hại và `content` bị cấm vì thế qua được kiểm duyệt,
 * tới được nhà cung cấp AI, và được lưu vào lịch sử như câu vô hại. Chữ tổ hợp dấu
 * tách rời hay chữ full-width cũng lọt regex vì regex quét chuỗi CHƯA chuẩn hoá.
 *
 * Mọi nơi kiểm duyệt, trả lời hay lưu một lượt đọc qua `chatTurnText`. Tệp này cố
 * ý không import `chat-policy.ts` (policy import nó), để các test giả lập policy
 * vẫn chạy đúng đường đọc thật.
 */

export type ChatTurn = { role?: unknown; sender?: unknown; content?: unknown; text?: unknown }

/** Trần tuyệt đối số lượt và tổng ký tự của lịch sử — `validateChatMessages` dùng đúng hai hằng này. */
export const CHAT_MAX_TURNS = 30
export const CHAT_MAX_TOTAL_CHARS = 30_000

/** Nội dung của lượt, đúng chuỗi model nhận: `content` trước `text`, NFKC, cắt khoảng trắng. */
export function chatTurnText(turn: ChatTurn | null | undefined): string {
  const value = turn?.content ?? turn?.text
  return typeof value === 'string' ? value.normalize('NFKC').trim() : ''
}

export function isUserTurn(turn: ChatTurn | null | undefined): boolean {
  return turn?.role === 'user' || turn?.sender === 'user'
}

/** Lượt mà policy giữ lại để gửi model (người dùng hoặc trợ lý). */
export function isChatTurn(turn: ChatTurn | null | undefined): boolean {
  return isUserTurn(turn) || turn?.role === 'assistant' || turn?.sender === 'bot'
}

function turnsOf(messages: unknown): ChatTurn[] {
  if (!Array.isArray(messages)) return []
  return messages.filter((item): item is ChatTurn => !!item && typeof item === 'object' && isChatTurn(item as ChatTurn))
}

/** Lượt người dùng mới nhất — câu được trả lời và được lưu. */
export function lastUserTurnText(messages: unknown): string {
  const turns = turnsOf(messages)
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (isUserTurn(turns[index])) {
      const value = chatTurnText(turns[index])
      if (value) return value
    }
  }
  return ''
}

/**
 * Lịch sử có hình dạng policy chấp nhận không — kiểm TRƯỚC khi quét, để một thân
 * request 64 KB gồm hàng nghìn lượt không đi hết qua kiểm duyệt rồi mới bị 400.
 * Lượt cuối phải là của người dùng: đó là câu được trả lời và được lưu.
 */
export function chatHistoryShapeOk(messages: unknown): boolean {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > CHAT_MAX_TURNS) return false
  const turns = turnsOf(messages)
  if (!turns.length || !isUserTurn(turns[turns.length - 1])) return false
  return turns.reduce((sum, turn) => sum + chatTurnText(turn).length, 0) <= CHAT_MAX_TOTAL_CHARS
}

/**
 * Mọi lượt NGƯỜI DÙNG khác nhau mà model sẽ thấy, mới nhất trước — thứ kiểm duyệt
 * phải quét (không chỉ lượt cuối: lịch sử do trình duyệt gửi lên).
 *
 * Không quét lượt "trợ lý": đó là lời của bot gửi lại, và một câu trả lời đúng có
 * thể chứa từ khoá trong luật (giải thích "tội lừa đảo") — quét nó từng từ chối oan
 * câu kế tiếp của người dân và ghi lời bot vào hàng chờ duyệt dưới IP của họ. Lượt
 * trợ lý giả mạo vẫn tới được model; chặn hẳn cần lịch sử phía máy chủ.
 */
export function chatTextsToScreen(messages: unknown): string[] {
  const seen = new Set<string>()
  const texts: string[] = []
  const turns = turnsOf(messages)
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (!isUserTurn(turns[index])) continue
    const value = chatTurnText(turns[index])
    if (value && !seen.has(value)) {
      seen.add(value)
      texts.push(value)
    }
  }
  return texts
}
