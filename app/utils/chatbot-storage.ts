/**
 * Khử độc dữ liệu chatbot đọc lại từ `localStorage`.
 *
 * Rút khỏi `useChatbot.ts` (759 dòng) không phải để đếm dòng, mà vì đây là
 * **biên tin cậy và nó chưa có test nào**: mọi thứ ở đây đọc từ `localStorage`,
 * tức là **khách sửa được bằng devtools**, và một bản build cũ có thể đã ghi một
 * hình dạng khác. Nằm trong cùng module với state cấp module và các lời gọi
 * `$fetch` thì không kiểm được mà không nạp cả composable.
 *
 * Cái nguy hiểm nhất ở đây là `safeHttpsUrl`: một `ChatSource.url` đi thẳng vào
 * `:href` trên trang công khai. Bỏ phép kiểm giao thức là để `javascript:` chạy
 * được từ một giá trị **khách tự ghi vào localStorage của chính họ** — nhỏ hơn
 * XSS lưu trữ, nhưng đúng là loại lỗ mà một lần refactor "cho gọn" tạo ra, và
 * một danh sách chặn ngừng chặn trông y hệt một danh sách đang chạy đúng.
 *
 * Toàn bộ tệp là **hàm thuần** trừ `newLocalId` (đọc `crypto`/đồng hồ) — nó nhận
 * vào dưới dạng tham số nên các hàm ở đây kiểm được không cần trình duyệt.
 */

export const CHATBOT_CLIENT_LIMITS = Object.freeze({
  maxMessageChars: 2000,
  maxOutputChars: 8000,
  maxHistoryMessages: 8,
  maxTotalUserChars: 30000,
  maxQuickQuestions: 8,
  maxSources: 3,
  maxSourceLabelChars: 160,
  maxSourceReferenceChars: 160,
  maxConversations: 10,
  maxTitleChars: 40,
})

export const CHATBOT_RESPONSE_KINDS = new Set([
  'curated', 'provider', 'small_talk', 'not_found', 'unavailable', 'rate_limited',
])

export const CHATBOT_WELCOME_MESSAGE = Object.freeze({
  id: 'welcome',
  sender: 'bot' as const,
  text: 'Xin chào! Tôi là Trợ lý ảo Hướng Thiện. Tôi chỉ hỗ trợ theo thông tin công khai trong kho dữ liệu đã được Cục C11 phê duyệt.',
})

export type ChatSource = { id: string, label: string, reference: string, url: string | null, entryId: number | null }
export type ChatLead = { name: string, phone: string, email: string, question: string, status: 'idle' | 'sending' | 'done', error: string }

/** One reference's approved Q&A, fetched on demand when the visitor opens it. */
export type SourceDetailState = { status: 'loading' | 'ready' | 'error', question: string, answer: string }

export type ChatMessage = {
  id: string
  sender: 'user' | 'bot'
  text: string
  kind?: string | undefined
  sources?: ChatSource[]
  askContact?: boolean
  lead?: ChatLead | null
  isStreaming?: boolean
}

export type StoredConversation = {
  id: string
  /** Opaque `<uuid>.<hmac>` minted by the server. Null until the first send. */
  token: string | null
  title: string
  createdAt: number
  messages: ChatMessage[]
}

/**
 * `https:` hoặc `null` — không có lối thứ ba.
 *
 * Giá trị này đi vào `:href` trên trang công khai. Chỉ kiểm "có phải URL không"
 * là để `javascript:` và `data:` đi qua; chỉ kiểm tiền tố chuỗi (`startsWith`)
 * là để `https:evil` và khoảng trắng đầu chuỗi đi qua. `new URL()` chuẩn hoá
 * trước, rồi so **đúng** thuộc tính `protocol`.
 */
export function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** The knowledge-bank row id, when the payload carries a usable one. */
export function knowledgeEntryId(raw: Record<string, unknown>): number | null {
  // Fresh replies carry the numeric row id at the top level of the reference.
  // Re-read localStorage carries it as `entryId`, because `id` was already
  // folded into a composite render key by an earlier pass through this function.
  for (const candidate of [raw.entryId, raw.id]) {
    const value = typeof candidate === 'number' ? candidate : Number(candidate)
    if (Number.isSafeInteger(value) && value > 0) return value
  }
  return null
}

export function normalizeSource(item: unknown, index: number): ChatSource | null {
  if (!item || typeof item !== 'object') return null
  const raw = item as Record<string, unknown>
  const rawSource = (raw.source && typeof raw.source === 'object' ? raw.source : raw) as Record<string, unknown>
  const label = typeof rawSource.label === 'string' ? rawSource.label.normalize('NFKC').trim().slice(0, CHATBOT_CLIENT_LIMITS.maxSourceLabelChars) : ''
  const reference = typeof rawSource.reference === 'string' ? rawSource.reference.normalize('NFKC').trim().slice(0, CHATBOT_CLIENT_LIMITS.maxSourceReferenceChars) : ''
  const url = safeHttpsUrl(rawSource.url)
  if (!label && !reference) return null
  const idPart = typeof raw.id === 'number' || typeof raw.id === 'string' ? raw.id : index
  return { id: `${idPart}-${label}-${reference}`, label: label || 'Tài liệu công khai', reference, url, entryId: knowledgeEntryId(raw) }
}

export function normalizeStoredMessage(item: unknown, index: number): ChatMessage | null {
  if (!item || typeof item !== 'object') return null
  const raw = item as Record<string, unknown>
  if (raw.sender !== 'user' && raw.sender !== 'bot') return null
  const maxChars = raw.sender === 'user' ? CHATBOT_CLIENT_LIMITS.maxMessageChars : CHATBOT_CLIENT_LIMITS.maxOutputChars
  const text = typeof raw.text === 'string' ? raw.text.normalize('NFKC').trim().slice(0, maxChars) : ''
  if (!text) return null
  if (raw.sender === 'user') return { id: `stored-${index}`, sender: 'user', text }
  const kind = typeof raw.kind === 'string' && CHATBOT_RESPONSE_KINDS.has(raw.kind) ? raw.kind : undefined
  const sources = Array.isArray(raw.sources)
    ? raw.sources.slice(0, CHATBOT_CLIENT_LIMITS.maxSources).map(normalizeSource).filter((value): value is ChatSource => value !== null)
    : []
  return { id: `stored-${index}`, sender: 'bot', text, kind, sources }
}

/**
 * `newId` và `now` nhận vào làm tham số, không đọc trực tiếp.
 *
 * `crypto.randomUUID()` và `Date.now()` là hai thứ khiến hàm này chỉ chạy được
 * trong trình duyệt và cho ra kết quả khác nhau mỗi lượt — tức là không kiểm
 * được. Nơi gọi thật vẫn truyền đúng hai thứ đó vào.
 */
export function normalizeConversation(
  item: unknown,
  newId: () => string,
  now: () => number,
): StoredConversation | null {
  if (!item || typeof item !== 'object') return null
  const raw = item as Record<string, unknown>
  const id = typeof raw.id === 'string' && raw.id ? raw.id : newId()
  const token = typeof raw.token === 'string' && raw.token ? raw.token : null
  const title = typeof raw.title === 'string' && raw.title.trim()
    ? raw.title.normalize('NFKC').trim().slice(0, CHATBOT_CLIENT_LIMITS.maxTitleChars)
    : 'Cuộc trò chuyện mới'
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now()
  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .slice(-(CHATBOT_CLIENT_LIMITS.maxHistoryMessages * 2))
        .map(normalizeStoredMessage)
        .filter((value): value is ChatMessage => value !== null)
    : []
  return { id, token, title, createdAt, messages: [{ ...CHATBOT_WELCOME_MESSAGE }, ...messages.filter(m => m.id !== 'welcome')] }
}
