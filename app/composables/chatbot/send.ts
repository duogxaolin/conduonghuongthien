import {
  CHATBOT_CLIENT_LIMITS,
  CHATBOT_SEND_FAILURE_MESSAGES,
  CHATBOT_WELCOME_MESSAGE,
  chatInputTooLongText,
  describeChatSendFailure,
  type ChatMessage,
  type ChatSendFailure,
  type StoredConversation,
} from '../../utils/chatbot-storage'
// The typewriter module owns these exports.  Do not re-export them here: Nuxt
// auto-imports both composables and otherwise has to choose one silently.
// Import the two operations this composable actually invokes.
import { playTypewriter, stopTypewriter } from '../useChatbotTypewriter'
import { persist } from './persistence'
import { parseSseLine } from './sse'
import {
  activeConversation, botInput, botInputError, inputCharLimit, isReplyStreaming, isSubmitting,
} from './state'

/**
 * Sending a question and streaming the reply into the transcript. Part of `useChatbot`
 * (see `./state.ts`).
 *
 * The in-flight request is tracked HERE and only here — `chatRequestController`,
 * `botRequestSequence`, `messageSequence`, `awaitedQuestion` — because every check that a
 * late reply or a late failure belongs to the current request compares against the same
 * counter. `cancelInFlight()` (used by the conversation actions) moves it too.
 */

let chatRequestController: AbortController | null = null
let botRequestSequence = 0
let messageSequence = 0
/** The question of the request in flight (the transcript's reactive copy). */
let awaitedQuestion: ChatMessage | null = null

export function cancelInFlight(): void {
  botRequestSequence += 1
  if (chatRequestController) chatRequestController.abort()
  chatRequestController = null
  // Cancelled before its first word, the question gets no answer now: it stays as asked, no
  // longer "sending", before the caller's `persist()` — what a cancel after the first word
  // leaves. It read "Đang gửi…" for as long as the page lived, unsaved (FINDING-C3).
  if (awaitedQuestion?.status === 'pending') awaitedQuestion.status = undefined
  awaitedQuestion = null
  stopTypewriter(true)
  isSubmitting.value = false
  botInputError.value = ''
}

const autoTitleOf = (text: string) => text.normalize('NFKC').trim().slice(0, CHATBOT_CLIENT_LIMITS.maxTitleChars)

/**
 * The words the server refused (moderation, 400) while this page lives, as titles
 * (`autoTitleOf`). No conversation takes one as its title again (FINDING-C2). In memory only:
 * after a reload, the same words sent again and failing before the server judges them title the
 * conversation like any first question (KNOWN F2).
 */
const refusedTitles = new Set<string>()

/** Titles the conversation from its first real message — never with refused words. No-op afterwards. */
function applyAutoTitle(text: string): void {
  const conversation = activeConversation.value
  const alreadyTitled = conversation.messages.some(item => item.sender === 'user')
  if (alreadyTitled) return
  const title = autoTitleOf(text)
  if (title && !refusedTitles.has(title)) conversation.title = title
}

/**
 * The title once a refused question has left the conversation (its words already in
 * `refusedTitles`). Never refused words, whatever else holds them: a failed send of the same
 * words titled the conversation and stays — unsaved — beside "Thử lại" or is resent with Enter;
 * a copy cancelled before its first word, or answered earlier, stays too (FINDING-C2: direct,
 * "Thử lại", Enter again). The first question in other words gives the title (the one before
 * this send, unless that was refused words); with none, the blank title.
 */
function titleWithout(conversation: StoredConversation, titleBeforeSend: string): string {
  const first = conversation.messages.find(item => item.sender === 'user' && !refusedTitles.has(autoTitleOf(item.text)))
  if (!first) return 'Cuộc trò chuyện mới'
  return refusedTitles.has(titleBeforeSend) ? autoTitleOf(first.text) : titleBeforeSend
}

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
 * `titleBeforeSend`: tiêu đề hội thoại trước khi câu này tự đặt tiêu đề — trả lại nếu câu bị chặn.
 */
async function fetchStreamBotReply(userMessage: ChatMessage, titleBeforeSend: string, onScroll?: () => void): Promise<true | ChatSendFailure | null> {
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
    // The title it gave the conversation goes too, as on the 400 path, here before any
    // `persist` (the playback's included) can save it (FINDING-C2).
    if (botMessage.kind === 'moderation_blocked') {
      const userIdx = conversation.messages.findIndex(item => item.id === userMessage.id)
      if (userIdx !== -1) conversation.messages.splice(userIdx, 1)
      refusedTitles.add(autoTitleOf(userMessage.text))
      conversation.title = titleWithout(conversation, titleBeforeSend)
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

export async function submitBotQuestion(rawText: string, onScroll?: () => void): Promise<void> {
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
  // Pending — dimmed, "Đang gửi…" — while awaiting the server's response.
  conversation.messages.push({ id: `user-${++messageSequence}`, sender: 'user', text, status: 'pending' })
  // Every later write goes through the transcript's reactive copy. A write on the object
  // that was pushed changes the data but schedules no render: a failed send kept "Đang
  // gửi…" and no "Thử lại" until something else repainted the widget (FINDING-C1).
  const question = conversation.messages[conversation.messages.length - 1]!
  awaitedQuestion = question
  onScroll?.()

  const requestSequence = botRequestSequence + 1
  const outcome = await fetchStreamBotReply(question, titleBeforeSend, onScroll)
  if (awaitedQuestion === question) awaitedQuestion = null
  if (requestSequence !== botRequestSequence) return
  const succeeded = outcome === true
  const failure = outcome === true ? null : outcome
  if (succeeded) {
    botInput.value = ''
    question.status = undefined
    persist()
  } else if (failure?.kind === 'rejected') {
    // Máy chủ từ chối CHÍNH câu này (quá dài / không hợp lệ): gửi lại y nguyên vẫn
    // bị từ chối, và để nó trong hội thoại thì lịch sử của mọi lượt sau mang nó theo
    // → cũng bị từ chối. Bỏ khỏi hội thoại (kể cả tiêu đề tự đặt từ nó), giữ bản
    // nháp trong ô nhập; lý do đã ở `botInputError` (tests/chatbot-send-rejection.test.ts).
    const index = conversation.messages.findIndex(item => item.id === question.id)
    if (index !== -1) conversation.messages.splice(index, 1)
    refusedTitles.add(autoTitleOf(text))
    conversation.title = titleWithout(conversation, titleBeforeSend)
    if (failure.maxChars) inputCharLimit.value = Math.min(inputCharLimit.value, failure.maxChars)
    botInput.value = text
    persist()
  } else {
    // Don't pop the message — mark as error and allow retry.
    // Restore the text to the input so the user can edit and resubmit.
    question.status = 'error'
    question.error = failure?.kind === 'rate_limited' ? failure.message : 'Không thể gửi câu hỏi. Vui lòng thử lại.'
    botInput.value = text
  }
}
