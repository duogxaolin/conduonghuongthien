import { ref, computed, nextTick } from 'vue'

/**
 * Khử độc dữ liệu đọc lại từ `localStorage` ở `app/utils/chatbot-storage.ts`.
 *
 * Tách ra vì đó là **biên tin cậy**: khách sửa được `localStorage` bằng
 * devtools, và `ChatSource.url` đi thẳng vào `:href` trên trang công khai. Nằm
 * cùng module với state cấp module và các lời gọi `$fetch` thì chỉ kiểm được
 * bằng cách nạp cả composable.
 *
 * Re-export nguyên vẹn để hai bề mặt (widget + `/assistant`) và các test đang
 * import từ đây không phải đổi đường dẫn.
 */
export * from '../utils/chatbot-storage'
import {
  CHATBOT_CLIENT_LIMITS,
  // Import tường minh (không trông vào auto-import của Nuxt cho `utils/`): `parseSseLine`
  // dùng nó, và Node test chạy composable thật (tests/chatbot-send-rejection.test.ts).
  CHATBOT_RESPONSE_KINDS,
  CHATBOT_SEND_FAILURE_MESSAGES,
  CHATBOT_WELCOME_MESSAGE,
  chatInputTooLongText,
  describeChatSendFailure,
  normalizeConversation as normalizeConversationRaw,
  normalizeSource,
  normalizeFollowUps,
  normalizeStoredMessage,
  type ChatLead,
  type ChatMessage,
  type ChatSendFailure,
  type ChatSource,
  type StoredConversation,
} from '../utils/chatbot-storage'

/** Bọc lại để nơi gọi trong tệp này giữ nguyên chữ ký một tham số. */
function normalizeConversation(item: unknown): StoredConversation | null {
  return normalizeConversationRaw(item, newLocalId, () => Date.now())
}

/**
 * All chatbot state and behaviour, shared by the floating widget and the
 * full-screen /assistant page.
 *
 * Module-level refs, not per-call state: both surfaces must show the same
 * conversations, and a visitor who expands the widget mid-conversation should
 * land on that same conversation rather than a fresh one.
 *
 * Every browser-only API (localStorage, matchMedia) is reached behind an
 * `import.meta.client` guard so importing this file during SSR is inert.
 */


/** Multi-conversation store. The v2 key held a single flat message array. */
const SESSIONS_KEY = 'cdkt_sessions_v1'
const LEGACY_HISTORY_KEY = 'cdkt_chat_history_v2'




// ─── Shared state ────────────────────────────────────────────────────────────
const conversations = ref<StoredConversation[]>([])
const activeId = ref<string>('')
const isSubmitting = ref(false)
/**
 * The reply is in the transcript and being written. `isSubmitting` stays true
 * until the stream closes; the pending indicator must not, or it sits under an
 * answer that is already arriving and then vanishes at the end, jolting the
 * transcript up by its own height.
 */
const isReplyStreaming = ref(false)
const isAwaitingFirstWord = computed(() => isSubmitting.value && !isReplyStreaming.value)
const botInput = ref('')
const botInputError = ref('')
/**
 * Trần ký tự của ô nhập. Mặc định 2000 (`CHATBOT_CLIENT_LIMITS`); máy chủ áp
 * `min(10000, cài đặt max_input_chars)` nhưng không có endpoint công khai nào cho
 * biết trước con số đó. Khi máy chủ từ chối một câu vì quá dài nó kèm `maxChars` —
 * ô nhập (maxlength + bộ đếm) và phép kiểm trước khi gửi theo con số ấy cho tới khi
 * tải lại trang. Chỉ HẠ, không nâng quá 2000: một trần cao hơn ở máy chủ không bao
 * giờ được báo về (không câu nào ≤ 2000 bị từ chối vì độ dài).
 */
const inputCharLimit = ref<number>(CHATBOT_CLIENT_LIMITS.maxMessageChars)
const limits = computed(() => ({ ...CHATBOT_CLIENT_LIMITS, maxMessageChars: inputCharLimit.value }))
const quickQuestions = ref<{ id: string, question: string }[]>([])
const quickQuestionState = ref<'loading' | 'success' | 'empty' | 'error'>('loading')
const hydrated = ref(false)

let quickQuestionsController: AbortController | null = null
let chatRequestController: AbortController | null = null
let botRequestSequence = 0
let messageSequence = 0
/** Frame handle during playback (rAF id on the client, timeout id on the server). */
/** Set when playback is cut short so the message can be completed in one step. */

function newLocalId(): string {
  if (import.meta.client && typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function blankConversation(): StoredConversation {
  return {
    id: newLocalId(),
    token: null,
    title: 'Cuộc trò chuyện mới',
    createdAt: Date.now(),
    messages: [{ ...CHATBOT_WELCOME_MESSAGE }],
  }
}

const activeConversation = computed<StoredConversation>(() => {
  const found = conversations.value.find(item => item.id === activeId.value)
  return found ?? conversations.value[0] ?? blankConversation()
})

/** The active conversation's messages — what both surfaces render. */
const chatMessages = computed<ChatMessage[]>(() => activeConversation.value.messages)

// ─── Persistence ─────────────────────────────────────────────────────────────

/**
 * Imports the single-conversation v2 history into one conversation.
 *
 * Runs once. Without it, everyone with an open tab loses the conversation they
 * were in the middle of the moment this ships.
 */
function migrateLegacyHistory(): StoredConversation | null {
  try {
    const saved = localStorage.getItem(LEGACY_HISTORY_KEY)
    if (!saved) return null
    localStorage.removeItem(LEGACY_HISTORY_KEY)
    const parsed = JSON.parse(saved) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const messages = parsed
      .slice(-(CHATBOT_CLIENT_LIMITS.maxHistoryMessages * 2))
      .map(normalizeStoredMessage)
      .filter((value): value is ChatMessage => value !== null)
    if (messages.length === 0) return null
    return {
      id: newLocalId(),
      token: null,
      title: 'Cuộc trò chuyện trước',
      createdAt: Date.now(),
      messages: [{ ...CHATBOT_WELCOME_MESSAGE }, ...messages],
    }
  } catch {
    localStorage.removeItem(LEGACY_HISTORY_KEY)
    return null
  }
}

function persist(): void {
  if (!import.meta.client) return
  try {
    // A message still mid-playback is not saved: reloading would restore a
    // half-typed sentence with no way to finish it.
    const payload = {
      activeId: activeId.value,
      sessions: conversations.value.map(conversation => ({
        id: conversation.id,
        token: conversation.token,
        title: conversation.title,
        createdAt: conversation.createdAt,
        messages: conversation.messages
          .filter(item => item.id !== 'welcome' && !item.isStreaming && !item.status && typeof item.text === 'string' && item.text.trim())
          .slice(-(CHATBOT_CLIENT_LIMITS.maxHistoryMessages * 2))
          // `sources` is rewritten rather than copied: the render key in `id` is
          // derived, while `entryId` is the only field that can reopen the full
          // approved answer after a reload.
          .map(({ sender, text, kind, sources, toolCalls, followUps }) => ({
            sender,
            text,
            kind,
            sources: (sources ?? []).map(({ label, reference, url, entryId }) => ({ label, reference, url, entryId })),
            toolCalls: toolCalls ?? [],
            followUps: followUps ?? [],
          })),
      })),
    }
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(payload))
  } catch {
    // Private browsing can refuse writes; the chat stays usable in memory.
  }
}

function hydrate(): void {
  if (!import.meta.client || hydrated.value) return
  hydrated.value = true
  try {
    const saved = localStorage.getItem(SESSIONS_KEY)
    const parsed = saved ? JSON.parse(saved) as Record<string, unknown> : null
    const list = Array.isArray(parsed?.sessions)
      ? (parsed!.sessions as unknown[]).map(normalizeConversation).filter((value): value is StoredConversation => value !== null)
      : []

    if (list.length === 0) {
      const legacy = migrateLegacyHistory()
      conversations.value = [legacy ?? blankConversation()]
      activeId.value = conversations.value[0]!.id
      if (legacy) persist()
      return
    }

    conversations.value = list.slice(0, CHATBOT_CLIENT_LIMITS.maxConversations)
    const savedActive = typeof parsed?.activeId === 'string' ? parsed.activeId : ''
    activeId.value = conversations.value.some(item => item.id === savedActive)
      ? savedActive
      : conversations.value[0]!.id
  } catch {
    localStorage.removeItem(SESSIONS_KEY)
    conversations.value = [blankConversation()]
    activeId.value = conversations.value[0]!.id
  }
}

// ─── Conversation management ─────────────────────────────────────────────────

function cancelInFlight(): void {
  botRequestSequence += 1
  if (chatRequestController) chatRequestController.abort()
  chatRequestController = null
  stopTypewriter(true)
  isSubmitting.value = false
  botInputError.value = ''
}

function createConversation(): void {
  cancelInFlight()
  // Cap enforced by dropping the oldest by creation time, not by list position:
  // the list is ordered for display and that order can change.
  if (conversations.value.length >= CHATBOT_CLIENT_LIMITS.maxConversations) {
    const oldest = [...conversations.value].sort((a, b) => a.createdAt - b.createdAt)[0]
    if (oldest) conversations.value = conversations.value.filter(item => item.id !== oldest.id)
  }
  const created = blankConversation()
  conversations.value = [created, ...conversations.value]
  activeId.value = created.id
  persist()
}

function switchConversation(id: string): void {
  if (id === activeId.value) return
  if (!conversations.value.some(item => item.id === id)) return
  cancelInFlight()
  activeId.value = id
  persist()
}

function deleteConversation(id: string): void {
  const remaining = conversations.value.filter(item => item.id !== id)
  if (remaining.length === conversations.value.length) return

  if (id === activeId.value) cancelInFlight()
  if (remaining.length === 0) {
    const created = blankConversation()
    conversations.value = [created]
    activeId.value = created.id
  } else {
    conversations.value = remaining
    // Deleting the active conversation lands on the most recent survivor rather
    // than an empty view the visitor did not ask for.
    if (id === activeId.value) {
      const newest = [...remaining].sort((a, b) => b.createdAt - a.createdAt)[0]!
      activeId.value = newest.id
    }
  }
  persist()
}

/** Titles the conversation from its first real message. No-op afterwards. */
function applyAutoTitle(text: string): void {
  const conversation = activeConversation.value
  const alreadyTitled = conversation.messages.some(item => item.sender === 'user')
  if (alreadyTitled) return
  const title = text.normalize('NFKC').trim().slice(0, CHATBOT_CLIENT_LIMITS.maxTitleChars)
  if (title) conversation.title = title
}

function clearChatHistory(): void {
  cancelInFlight()
  const conversation = activeConversation.value
  conversation.messages = [{ ...CHATBOT_WELCOME_MESSAGE }]
  conversation.title = 'Cuộc trò chuyện mới'
  persist()
}

// The typewriter module owns these exports.  Do not re-export them here: Nuxt
// auto-imports both composables and otherwise has to choose one silently.
// Import the two operations this composable actually invokes.
import { playTypewriter, stopTypewriter } from './useChatbotTypewriter'

async function ensureSessionToken(conversation: StoredConversation): Promise<string | null> {
  if (conversation.token) return conversation.token
  try {
    const response = await fetch('/api/public/chatbot/session', {
      method: 'POST',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    const data = await response.json() as { token?: unknown }
    if (typeof data?.token !== 'string' || !data.token) return null
    conversation.token = data.token
    persist()
    return conversation.token
  } catch {
    return null
  }
}

// ─── Sending ─────────────────────────────────────────────────────────────────

function boundedUserHistory(): { sender: 'user' | 'bot', text: string }[] {
  const messages = activeConversation.value.messages
    .filter(item => (item.sender === 'user' || item.sender === 'bot') && !item.isStreaming && typeof item.text === 'string')
    .map(item => ({
      sender: item.sender as 'user' | 'bot',
      // Trần theo `inputCharLimit` (không phải hằng 2000): máy chủ kiểm độ dài TỪNG tin
      // trong lịch sử — một câu cũ dài hơn trần máy chủ vừa báo sẽ làm mọi lượt sau 400.
      text: item.text.normalize('NFKC').trim().slice(0, item.sender === 'bot' ? 1200 : inputCharLimit.value),
    }))
    .filter(item => item.text && item.text !== CHATBOT_WELCOME_MESSAGE.text)
    .slice(-CHATBOT_CLIENT_LIMITS.maxHistoryMessages)
  let total = 0
  return messages.reverse().filter((item) => {
    if (total + item.text.length > CHATBOT_CLIENT_LIMITS.maxTotalUserChars) return false
    total += item.text.length
    return true
  }).reverse()
}

/**
 * Accumulates one SSE line into `target`.
 *
 * `text` is collected separately from the message so playback can start from
 * empty; writing straight to `message.text` would show the whole answer for one
 * frame before the typewriter reset it.
 */
export function parseSseLine(line: string, target: { text: string, message: ChatMessage }): void {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') return
  let data: Record<string, unknown>
  try {
    data = JSON.parse(trimmed.slice(6)) as Record<string, unknown>
  } catch {
    return
  }
  const choices = data?.choices as { delta?: { content?: unknown } }[] | undefined
  const content = typeof choices?.[0]?.delta?.content === 'string' ? choices[0]!.delta!.content as string : ''
  if (content) target.text = `${target.text}${content}`.slice(0, CHATBOT_CLIENT_LIMITS.maxOutputChars)

  const chatbot = data?.chatbot as Record<string, unknown> | undefined
  if (chatbot && typeof chatbot === 'object') {
    // Máy chủ rút lại phần đã stream (lớp chặn chủ quyền): thay, không nối — `content` cùng khung là cho widget cũ.
    if (typeof chatbot.replace === 'string') target.text = chatbot.replace.slice(0, CHATBOT_CLIENT_LIMITS.maxOutputChars)
    if (chatbot.toolEvent && typeof chatbot.toolEvent === 'object') {
      const te = chatbot.toolEvent as { name: string; query?: string; status: 'calling' | 'done'; count?: number }
      if (!Array.isArray(target.message.toolCalls)) target.message.toolCalls = []
      const labelMap: Record<string, string> = {
        search_c11_knowledge: 'Tra cứu tri thức C11',
        search_c11_articles: 'Tìm bài viết & mô hình C11',
        search_c11_videos: 'Tìm video phóng sự C11',
        search_c11_photos: 'Tìm ảnh thư viện Media',
        get_c11_hotline_and_support: 'Lấy thông tin hỗ trợ C11',
      }
      const item: ToolCallExecution = {
        name: te.name,
        label: labelMap[te.name] || te.name,
        query: te.query,
        status: te.status,
        count: te.count,
      }
      const existingIdx = target.message.toolCalls.findIndex(t => t.name === te.name)
      if (existingIdx !== -1) {
        target.message.toolCalls[existingIdx] = item
      } else {
        target.message.toolCalls.push(item)
      }
    }
    if (Array.isArray(chatbot.toolCalls) && chatbot.toolCalls.length > 0) {
      const labelMap: Record<string, string> = {
        search_c11_knowledge: 'Tra cứu tri thức C11',
        search_c11_articles: 'Tìm bài viết & mô hình C11',
        search_c11_videos: 'Tìm video phóng sự C11',
        search_c11_photos: 'Tìm ảnh thư viện Media',
        get_c11_hotline_and_support: 'Lấy thông tin hỗ trợ C11',
      }
      target.message.toolCalls = chatbot.toolCalls.map(tc => {
        const item = tc as { name: string; query?: string; count?: number }
        return {
          name: item.name,
          label: labelMap[item.name] || item.name,
          query: item.query,
          status: 'done' as const,
          count: item.count,
        }
      })
    }
    target.message.kind = typeof chatbot.kind === 'string' && CHATBOT_RESPONSE_KINDS.has(chatbot.kind) ? chatbot.kind : target.message.kind
    if (Array.isArray(chatbot.sources)) {
      target.message.sources = chatbot.sources.slice(0, 8).map(normalizeSource).filter((value): value is ChatSource => value !== null)
    }
    if (Array.isArray(chatbot.followUps)) target.message.followUps = normalizeFollowUps(chatbot.followUps)
    target.message.askContact = chatbot.askContact === true
    if (target.message.askContact && !target.message.lead) {
      target.message.lead = { name: '', phone: '', email: '', question: '', status: 'idle', error: '' }
    }
  }
}

// ─── Stream → transcript, once per frame ─────────────────────────────────────

/** One per request, so an aborted request can never cancel the next one's frame. */
type StreamFlush = { run: () => void, handle: number | null, closed: boolean }

const canUseFrames = () => import.meta.client && typeof requestAnimationFrame === 'function'

function scheduleStreamFlush(pending: StreamFlush): void {
  if (pending.closed || pending.handle !== null) return
  const fire = () => {
    pending.handle = null
    if (!pending.closed) pending.run()
  }
  pending.handle = canUseFrames() ? requestAnimationFrame(fire) : setTimeout(fire, 16) as unknown as number
}

function cancelStreamFlush(pending: StreamFlush): void {
  pending.closed = true
  if (pending.handle === null) return
  if (canUseFrames()) cancelAnimationFrame(pending.handle)
  else clearTimeout(pending.handle)
  pending.handle = null
}

/** Runs the queued copy immediately — a background tab paints no frames. */
function flushStreamNow(pending: StreamFlush): void {
  if (pending.closed) return
  cancelStreamFlush(pending)
  pending.run()
}

/** Phản hồi không-ok của endpoint chat, đã phân loại (`describeChatSendFailure`). */
class ChatSendRejected extends Error {
  failure: ChatSendFailure
  constructor(failure: ChatSendFailure) {
    super('CHATBOT_SEND_REJECTED')
    this.failure = failure
  }
}

/**
 * `true` = câu trả lời đã về. Còn lại là lượt hỏng: `ChatSendFailure` khi máy chủ trả
 * một mã không-ok (đã phân loại), `null` khi hỏng không mang mã (mạng, luồng rỗng, huỷ).
 */
async function fetchStreamBotReply(userMessage: ChatMessage, onScroll?: () => void): Promise<true | ChatSendFailure | null> {
  if (isSubmitting.value) return null
  const requestSequence = ++botRequestSequence
  const conversation = activeConversation.value
  isSubmitting.value = true
  isReplyStreaming.value = false
  botInputError.value = ''
  chatRequestController = new AbortController()
  const requestController = chatRequestController

  const botMessage: ChatMessage = {
    id: `bot-${++messageSequence}`,
    sender: 'bot',
    text: '',
    kind: undefined,
    sources: [],
    toolCalls: [],
    askContact: false,
    lead: null,
  }
  // Deliberately not pushed yet. Pushing it here rendered an empty bubble holding
  // nothing but the streaming cursor *alongside* the typing indicator, for the
  // whole network wait — two indicators for one pending reply. It joins the
  // transcript once there is text to show.
  onScroll?.()

  const accumulator = { text: '', message: botMessage }
  const streamFlush: StreamFlush = { run: () => {}, handle: null, closed: false }

  try {
    const token = await ensureSessionToken(conversation)
    const headers: Record<string, string> = { Accept: 'text/event-stream', 'Content-Type': 'application/json' }
    if (token) headers['X-Chat-Session'] = token

    const response = await fetch('/api/public/chatbot', {
      method: 'POST',
      headers,
      // `_h` is the honeypot. A real browser leaves it empty; only a script that
      // fills every field it finds writes to it.
      body: JSON.stringify({ messages: boundedUserHistory(), _h: '' }),
      signal: requestController.signal,
    })
    if (!response.ok) {
      // Thân lỗi JSON của Nitro: `{ statusCode, message, data }`. Proxy có thể trả HTML.
      const errorBody: unknown = await response.json().catch(() => null)
      throw new ChatSendRejected(describeChatSendFailure(response.status, errorBody))
    }
    if (!response.body) throw new Error('CHATBOT_UNAVAILABLE')

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let doneEvent = false
    let isStreamPushed = false

    // Copies what has arrived so far onto the transcript. Every copy re-renders
    // the whole transcript and re-reads its height, so it runs at most once per
    // painted frame however many SSE events landed in between — a provider that
    // streams token by token would otherwise cost one full render per token,
    // which is what made long answers stutter on phones.
    const flushToTranscript = () => {
      const hasContentOrTools = Boolean(accumulator.text || (botMessage.toolCalls && botMessage.toolCalls.length > 0))
      if (!hasContentOrTools) return
      if (!isStreamPushed) {
        isStreamPushed = true
        botMessage.isStreaming = true
        conversation.messages.push(botMessage)
        if (requestSequence === botRequestSequence) isReplyStreaming.value = true
        // The server has answered, so the question is no longer "sending". Clearing
        // it here lands in the same frame as the reply bubble; clearing it when the
        // stream closes shrank the question under a finished answer and pulled the
        // whole answer up by that line's height.
        const question = conversation.messages.find(item => item.id === userMessage.id)
        if (question?.status === 'pending') question.status = undefined
      }
      const liveTracked = conversation.messages[conversation.messages.length - 1]!
      liveTracked.text = accumulator.text
      liveTracked.toolCalls = botMessage.toolCalls
      onScroll?.()
    }
    streamFlush.run = flushToTranscript

    while (!doneEvent) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const lines = buffer.split('\n')
      buffer = done ? '' : lines.pop() || ''
      for (const line of lines) {
        if (line.trim() === 'data: [DONE]') { doneEvent = true; break }
        parseSseLine(line, accumulator)
      }
      scheduleStreamFlush(streamFlush)
      if (done) break
    }
    // Whatever is still queued lands now, before playback and persistence read
    // the transcript.
    flushStreamNow(streamFlush)
    if (buffer) parseSseLine(buffer, accumulator)
    if (!accumulator.text.trim()) throw new Error('EMPTY_CHATBOT_RESPONSE')
    if (!botMessage.kind) botMessage.kind = 'unavailable'

    // The reply joins the transcript only now that it has content if not pushed during stream
    if (!isStreamPushed) {
      conversation.messages.push(botMessage)
    }

    const tracked = conversation.messages[conversation.messages.length - 1]!

    isSubmitting.value = false
    chatRequestController = null
    void playTypewriter(tracked, accumulator.text, { onTick: onScroll, delayMs: isStreamPushed ? 0 : undefined }).then(persist)

    // Moderation gate rejected the user turn before any AI call. Drop the
    // offending user message from the transcript so boundedUserHistory() never
    // sends it to the model on the next request — otherwise a user could smuggle
    // disallowed content past the gate by relying on conversation history. The
    // bot's refusal bubble stays so the user sees why their turn was rejected.
    if (botMessage.kind === 'moderation_blocked') {
      const userIdx = conversation.messages.findIndex(item => item.id === userMessage.id)
      if (userIdx !== -1) conversation.messages.splice(userIdx, 1)
      persist()
    }
    return true
  } catch (error) {
    // A frame still queued would push the bot message back in after it is removed.
    cancelStreamFlush(streamFlush)
    // The bot message is only in the transcript if the reply arrived, so a failure
    // before that point has nothing to remove. Removing it unconditionally would
    // have deleted whichever message happened to be last.
    const index = conversation.messages.findIndex(item => item.id === botMessage.id)
    if (index !== -1) conversation.messages.splice(index, 1)
    const failure = error instanceof ChatSendRejected ? error.failure : null
    if ((error as Error)?.name !== 'AbortError' && requestSequence === botRequestSequence) {
      botInputError.value = failure?.message ?? CHATBOT_SEND_FAILURE_MESSAGES.unavailable
    }
    return failure
  } finally {
    if (requestSequence === botRequestSequence) {
      isSubmitting.value = false
      isReplyStreaming.value = false
      chatRequestController = null
    }
    onScroll?.()
  }
}

async function submitBotQuestion(rawText: string, onScroll?: () => void): Promise<void> {
  // A send during playback finishes the previous message instantly rather than
  // leaving it frozen half-typed.
  stopTypewriter(true)
  if (isSubmitting.value) return

  const text = typeof rawText === 'string' ? rawText.normalize('NFKC').trim() : ''
  if (!text) {
    botInputError.value = 'Vui lòng nhập câu hỏi.'
    return
  }
  if (text.length > inputCharLimit.value) {
    botInputError.value = chatInputTooLongText(inputCharLimit.value)
    return
  }

  const conversation = activeConversation.value
  const titleBeforeSend = conversation.title
  applyAutoTitle(text)
  const userMessage: ChatMessage = { id: `user-${++messageSequence}`, sender: 'user', text }
  conversation.messages.push(userMessage)
  onScroll?.()

  // Mark the user message as pending — dimmed while awaiting server response
  userMessage.status = 'pending'

  const requestSequence = botRequestSequence + 1
  const outcome = await fetchStreamBotReply(userMessage, onScroll)
  if (requestSequence !== botRequestSequence) return
  const succeeded = outcome === true
  const failure = outcome === true ? null : outcome
  if (succeeded) {
    botInput.value = ''
    userMessage.status = undefined
    persist()
  } else if (failure?.kind === 'rejected') {
    // Máy chủ từ chối CHÍNH câu này (quá dài / không hợp lệ): gửi lại y nguyên vẫn
    // bị từ chối, và để nó trong hội thoại thì lịch sử của mọi lượt sau mang nó theo
    // → cũng bị từ chối. Bỏ khỏi hội thoại (kể cả tiêu đề tự đặt từ nó), giữ bản
    // nháp trong ô nhập; lý do đã ở `botInputError` (tests/chatbot-send-rejection.test.ts).
    const index = conversation.messages.findIndex(item => item.id === userMessage.id)
    if (index !== -1) conversation.messages.splice(index, 1)
    conversation.title = titleBeforeSend
    if (failure.maxChars) inputCharLimit.value = Math.min(inputCharLimit.value, failure.maxChars)
    botInput.value = text
    persist()
  } else {
    // Don't pop the message — mark as error and allow retry.
    // Restore the text to the input so the user can edit and resubmit.
    userMessage.status = 'error'
    userMessage.error = failure?.kind === 'rate_limited' ? failure.message : 'Không thể gửi câu hỏi. Vui lòng thử lại.'
    botInput.value = text
  }
}

// ─── Quick questions & lead capture ──────────────────────────────────────────

function normalizeQuickQuestion(item: unknown): { id: string, question: string } | null {
  if (!item || typeof item !== 'object') return null
  const raw = item as Record<string, unknown>
  const id = typeof raw.id === 'number' || typeof raw.id === 'string' ? String(raw.id) : ''
  const question = typeof raw.question === 'string' ? raw.question.normalize('NFKC').trim() : ''
  if (!id || !question || question.length > CHATBOT_CLIENT_LIMITS.maxMessageChars) return null
  return { id, question }
}

async function loadQuickQuestions(): Promise<void> {
  if (quickQuestionsController) quickQuestionsController.abort()
  quickQuestionsController = new AbortController()
  quickQuestionState.value = 'loading'
  quickQuestions.value = []
  try {
    const response = await fetch('/api/public/chatbot/quick-questions', {
      headers: { Accept: 'application/json' },
      signal: quickQuestionsController.signal,
    })
    if (!response.ok) throw new Error('QUICK_QUESTIONS_UNAVAILABLE')
    const data = await response.json() as Record<string, unknown>
    const items = Array.isArray(data?.items)
      ? data.items.slice(0, CHATBOT_CLIENT_LIMITS.maxQuickQuestions).map(normalizeQuickQuestion).filter((value): value is { id: string, question: string } => value !== null)
      : []
    quickQuestions.value = items
    quickQuestionState.value = data?.ok === true && data?.available === true && items.length > 0 ? 'success' : 'empty'
  } catch (error) {
    if ((error as Error)?.name !== 'AbortError') quickQuestionState.value = 'error'
  } finally {
    quickQuestionsController = null
  }
}

async function submitLead(msg: ChatMessage): Promise<void> {
  const lead = msg?.lead
  if (!lead || lead.status === 'sending' || lead.status === 'done') return
  if (!lead.phone.trim() && !lead.email.trim()) {
    lead.error = 'Vui lòng nhập số điện thoại hoặc email để cán bộ liên hệ.'
    return
  }
  lead.status = 'sending'
  lead.error = ''
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)('/api/public/chatbot/lead', {
      method: 'POST',
      body: { name: lead.name, phone: lead.phone, email: lead.email, question: lead.question },
    })
    lead.status = 'done'
  } catch (error) {
    lead.status = 'idle'
    lead.error = (error as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Không gửi được thông tin. Vui lòng thử lại.'
  }
}

// ─── Reference detail ────────────────────────────────────────────────────────
// Most knowledge-bank rows are imported from a spreadsheet and carry a source
// label but no URL ("Tài liệu Hỏi – Đáp"), so there was nothing to click and no
// way to read the approved answer behind a citation. These expand in place: the
// widget already runs its own Tab trap, and a modal inside a focus trap is a
// second trap fighting the first.

const sourceDetails = ref<Record<number, SourceDetailState>>({})
const expandedSourceIds = ref<number[]>([])

export function sourceDetailOf(entryId: number | null): SourceDetailState | null {
  return entryId === null ? null : sourceDetails.value[entryId] ?? null
}

export function isSourceExpanded(entryId: number | null): boolean {
  return entryId !== null && expandedSourceIds.value.includes(entryId)
}

async function loadSourceDetail(entryId: number): Promise<void> {
  // A row already read stays read: reopening a citation must not re-query.
  const current = sourceDetails.value[entryId]
  if (current?.status === 'ready' || current?.status === 'loading') return
  sourceDetails.value = { ...sourceDetails.value, [entryId]: { status: 'loading', question: '', answer: '' } }
  try {
    const response = await fetch(`/api/public/chatbot/sources?id=${encodeURIComponent(String(entryId))}`, {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error('SOURCE_UNAVAILABLE')
    const data = await response.json() as { ok?: unknown, source?: Record<string, unknown> }
    const question = typeof data?.source?.question === 'string'
      ? data.source.question.normalize('NFKC').trim().slice(0, CHATBOT_CLIENT_LIMITS.maxMessageChars)
      : ''
    const answer = typeof data?.source?.answer === 'string'
      ? data.source.answer.normalize('NFKC').trim().slice(0, CHATBOT_CLIENT_LIMITS.maxOutputChars)
      : ''
    if (data?.ok !== true || !answer) throw new Error('SOURCE_EMPTY')
    sourceDetails.value = { ...sourceDetails.value, [entryId]: { status: 'ready', question, answer } }
  } catch {
    // An unreachable citation must read as broken, not as an empty document: the
    // visible branch offers a retry of this same request.
    sourceDetails.value = { ...sourceDetails.value, [entryId]: { status: 'error', question: '', answer: '' } }
  }
}

function toggleSourceDetail(entryId: number | null): void {
  if (entryId === null) return
  if (expandedSourceIds.value.includes(entryId)) {
    expandedSourceIds.value = expandedSourceIds.value.filter(id => id !== entryId)
    return
  }
  expandedSourceIds.value = [...expandedSourceIds.value, entryId]
  void loadSourceDetail(entryId)
}

/** Retries the request that failed, rather than reloading the whole page. */
function retrySourceDetail(entryId: number | null): void {
  if (entryId === null) return
  const next = { ...sourceDetails.value }
  delete next[entryId]
  sourceDetails.value = next
  void loadSourceDetail(entryId)
}

// ─── Presentation helpers ────────────────────────────────────────────────────

/**
 * The one line that explains what the quick-question strip is currently doing.
 *
 * Loading, error and empty each get their own sentence because they mean
 * different things to the visitor: "wait", "the suggestions are broken but the
 * box below still works", and "there are no approved suggestions yet, the box
 * below still works". A single generic message would leave someone staring at an
 * empty strip with no idea whether to wait.
 */
const quickQuestionStatusText = computed(() => {
  if (quickQuestionState.value === 'loading') return 'Đang tải câu hỏi đã được phê duyệt…'
  if (quickQuestionState.value === 'error') return 'Hiện không thể tải câu hỏi gợi ý. Bạn vẫn có thể nhập câu hỏi bên dưới.'
  if (quickQuestionState.value === 'empty') return 'Hiện chưa có câu hỏi gợi ý đã được phê duyệt. Bạn vẫn có thể nhập câu hỏi bên dưới.'
  return 'Câu hỏi gợi ý từ kho dữ liệu đã phê duyệt'
})

/** One definition of "this reply did not answer the question". */
export function isProblemKind(kind: string | undefined): boolean {
  return kind === 'not_found' || kind === 'unavailable' || kind === 'rate_limited'
}

export function messageKindLabel(kind: string | undefined): string {
  return ({
    curated: 'Trả lời từ nội dung đã phê duyệt',
    provider: 'Giải thích có tham chiếu nội dung đã phê duyệt',
    small_talk: 'Trả lời chào hỏi',
    not_found: 'Chưa tìm thấy thông tin phù hợp',
    unavailable: 'Dịch vụ tạm thời chưa sẵn sàng',
    rate_limited: 'Tạm giới hạn yêu cầu',
  } as Record<string, string>)[kind ?? ''] || ''
}

export function messageKindClass(kind: string | undefined): string {
  return isProblemKind(kind) ? 'text-[#9a3412]' : 'text-[#385130]'
}

// ─── Public surface ──────────────────────────────────────────────────────────

export function useChatbot() {
  return {
    // state
    conversations,
    activeId,
    activeConversation,
    chatMessages,
    isSubmitting,
    isAwaitingFirstWord,
    botInput,
    botInputError,
    quickQuestions,
    quickQuestionState,
    quickQuestionStatusText,

    // lifecycle
    hydrate,
    persist,
    loadQuickQuestions,

    // conversations
    createConversation,
    switchConversation,
    deleteConversation,
    clearChatHistory,

    // sending
    submitBotQuestion,
    submitLead,
    stopTypewriter,

    // reference detail
    sourceDetails,
    expandedSourceIds,
    sourceDetailOf,
    isSourceExpanded,
    toggleSourceDetail,
    retrySourceDetail,

    // helpers
    // Computed: `maxMessageChars` theo trần máy chủ đã báo (xem `inputCharLimit`).
    limits,
    isProblemKind,
    messageKindLabel,
    messageKindClass,
  }
}
