import { ref, computed, nextTick } from 'vue'

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

const CHATBOT_RESPONSE_KINDS = new Set(['curated', 'provider', 'small_talk', 'not_found', 'unavailable', 'rate_limited'])

/** Multi-conversation store. The v2 key held a single flat message array. */
const SESSIONS_KEY = 'cdkt_sessions_v1'
const LEGACY_HISTORY_KEY = 'cdkt_chat_history_v2'

/**
 * Playback pacing — a reading pace, not a progress bar.
 *
 * These two numbers answer different questions and the earlier pair had both
 * wrong in the same direction. `TYPEWRITER_WORD_DELAY_MS` sets how fast words
 * appear; at 30ms it revealed ~33 words per second, and since the everyday
 * replies measure a median of 33 words, a whole answer flashed into place in
 * under a second. Nothing was legible while it moved, so the effect read as a
 * glitch rather than as typing. 70ms is roughly 14 words per second — the pace
 * of the streaming chat interfaces a visitor has already seen, and slow enough
 * that the text can be followed as it lands.
 *
 * `TYPEWRITER_MAX_MS` only exists for the long tail: the knowledge bank's legal
 * answers run to ~330 words, which at 70ms each would hold the visitor for 23
 * seconds over text already sitting in memory. The cap engages past ~85 words,
 * so every everyday reply and most approved answers keep the full per-word pace
 * and only the genuinely long ones compress.
 */
export const TYPEWRITER_WORD_DELAY_MS = 70
export const TYPEWRITER_MAX_MS = 6000

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

// ─── Shared state ────────────────────────────────────────────────────────────
const conversations = ref<StoredConversation[]>([])
const activeId = ref<string>('')
const isSubmitting = ref(false)
const botInput = ref('')
const botInputError = ref('')
const quickQuestions = ref<{ id: string, question: string }[]>([])
const quickQuestionState = ref<'loading' | 'success' | 'empty' | 'error'>('loading')
const hydrated = ref(false)

let quickQuestionsController: AbortController | null = null
let chatRequestController: AbortController | null = null
let botRequestSequence = 0
let messageSequence = 0
/** Frame handle during playback (rAF id on the client, timeout id on the server). */
let typewriterTimer: ReturnType<typeof setTimeout> | null = null
/** Set when playback is cut short so the message can be completed in one step. */
let typewriterFinish: (() => void) | null = null

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

// ─── Normalisation ───────────────────────────────────────────────────────────
// Everything read back from localStorage is untrusted: the visitor can edit it,
// and an older build may have written a different shape.

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** The knowledge-bank row id, when the payload carries a usable one. */
function knowledgeEntryId(raw: Record<string, unknown>): number | null {
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

function normalizeStoredMessage(item: unknown, index: number): ChatMessage | null {
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

function normalizeConversation(item: unknown): StoredConversation | null {
  if (!item || typeof item !== 'object') return null
  const raw = item as Record<string, unknown>
  const id = typeof raw.id === 'string' && raw.id ? raw.id : newLocalId()
  const token = typeof raw.token === 'string' && raw.token ? raw.token : null
  const title = typeof raw.title === 'string' && raw.title.trim()
    ? raw.title.normalize('NFKC').trim().slice(0, CHATBOT_CLIENT_LIMITS.maxTitleChars)
    : 'Cuộc trò chuyện mới'
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now()
  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .slice(-(CHATBOT_CLIENT_LIMITS.maxHistoryMessages * 2))
        .map(normalizeStoredMessage)
        .filter((value): value is ChatMessage => value !== null)
    : []
  return { id, token, title, createdAt, messages: [{ ...CHATBOT_WELCOME_MESSAGE }, ...messages.filter(m => m.id !== 'welcome')] }
}

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
          .filter(item => item.id !== 'welcome' && !item.isStreaming && typeof item.text === 'string' && item.text.trim())
          .slice(-(CHATBOT_CLIENT_LIMITS.maxHistoryMessages * 2))
          // `sources` is rewritten rather than copied: the render key in `id` is
          // derived, while `entryId` is the only field that can reopen the full
          // approved answer after a reload.
          .map(({ sender, text, kind, sources }) => ({
            sender,
            text,
            kind,
            sources: (sources ?? []).map(({ label, reference, url, entryId }) => ({ label, reference, url, entryId })),
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

// ─── Typewriter playback ─────────────────────────────────────────────────────

function prefersReducedMotion(): boolean {
  if (!import.meta.client || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Monotonic where available, so a clock adjustment mid-answer cannot skew pacing. */
function now(): number {
  return typeof performance?.now === 'function' ? performance.now() : Date.now()
}

/**
 * One playback step per animation frame, so the DOM write and the scroll that
 * follows it happen at the rate the browser actually paints. A background tab
 * stops painting and therefore stops firing these — which is correct here,
 * because there is nobody watching the words appear. Pacing is read from the
 * clock, so the frame that arrives on return reveals everything now due.
 */
function schedule(step: () => void): ReturnType<typeof setTimeout> {
  if (import.meta.client && typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(step) as unknown as ReturnType<typeof setTimeout>
  }
  return setTimeout(step, 16)
}

function cancel(handle: ReturnType<typeof setTimeout>): void {
  if (import.meta.client && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle as unknown as number)
    return
  }
  clearTimeout(handle)
}

/**
 * Ends playback. `complete` fills in whatever had not been typed yet, so an
 * interrupted message is left whole rather than truncated mid-sentence.
 */
function stopTypewriter(complete: boolean): void {
  if (typewriterTimer) {
    cancel(typewriterTimer)
    typewriterTimer = null
  }
  if (complete && typewriterFinish) typewriterFinish()
  typewriterFinish = null
}

/**
 * Reveals `fullText` on `message` progressively.
 *
 * The server sends the whole answer in a single SSE event, so this is a
 * presentation effect rather than transport streaming. Splitting on whitespace
 * while *keeping* the separators means the reassembled text is byte-identical to
 * what arrived — a plain `split(' ')` would collapse newlines and double spaces,
 * quietly reformatting legal text.
 *
 * Paced by *elapsed time* rather than by counting timer firings. A `setInterval`
 * at one word per tick made three separate promises the browser does not keep:
 * that ticks arrive on schedule (they are throttled to ~1/second in a background
 * tab, so switching away mid-answer stretched playback to minutes), that a tick
 * costs nothing (each one wrote to the DOM and forced a synchronous
 * `scrollHeight` read — one layout per word), and that answer length is bounded
 * (it was not; ~330-word answers ran ~23 seconds at the current pace). Reading
 * the clock each frame makes a late or coalesced frame catch up by revealing more
 * words, so the answer always lands within `TYPEWRITER_MAX_MS` regardless of
 * length or tab state.
 */
export function playTypewriter(
  message: ChatMessage,
  fullText: string,
  options: { onTick?: () => void, delayMs?: number } = {},
): Promise<void> {
  stopTypewriter(true)

  const chunks = fullText.match(/\S+\s*/g) ?? []
  if (chunks.length === 0) {
    message.text = fullText
    message.isStreaming = false
    return Promise.resolve()
  }

  // Reduced motion is an accessibility setting for people who get motion sick.
  // Text appearing progressively is exactly the kind of movement it turns off.
  if (prefersReducedMotion() || options.delayMs === 0) {
    message.text = fullText
    message.isStreaming = false
    options.onTick?.()
    return Promise.resolve()
  }

  message.text = ''
  message.isStreaming = true

  // Cap engages past ~85 words; everything shorter runs at the full per-word
  // pace. `perWord` is also the whole answer's rate now that no per-frame floor
  // overrides it, so this figure is what a visitor actually experiences.
  const perWord = options.delayMs ?? TYPEWRITER_WORD_DELAY_MS
  const totalMs = Math.min(chunks.length * perWord, TYPEWRITER_MAX_MS)

  return new Promise<void>((resolve) => {
    let index = 0
    const settle = () => {
      message.text = fullText
      message.isStreaming = false
      resolve()
    }
    typewriterFinish = settle

    // The first word lands in this tick, not after the first delay. Waiting meant
    // the bubble appeared empty for one interval right as the typing indicator
    // disappeared — a blank white box flickering between the two states.
    message.text += chunks[index]!
    index += 1
    options.onTick?.()
    if (index >= chunks.length) {
      typewriterFinish = null
      message.isStreaming = false
      resolve()
      return
    }

    const startedAt = now()
    const step = () => {
      // How many words are due by now. No floor of `index + 1` here, and that
      // absence is the point: with it, every frame advanced at least one word, so
      // playback ran at the refresh rate (~60 words/second at 60fps) and the
      // per-word constant only ever governed answers long enough to hit the cap.
      // Raising it changed nothing a visitor could see. Reading the clock alone
      // makes the pace mean what it says.
      const elapsed = now() - startedAt
      const target = Math.min(
        chunks.length,
        Math.ceil((elapsed / totalMs) * chunks.length),
      )

      // A frame with no word due writes nothing and fires no tick. `onTick` makes
      // the surfaces read `scrollHeight`, so an unconditional call here would
      // force a layout on every frame to display text that had not changed.
      if (target > index) {
        message.text = chunks.slice(0, target).join('')
        index = target
        options.onTick?.()
      }

      if (index >= chunks.length) {
        typewriterTimer = null
        typewriterFinish = null
        message.isStreaming = false
        resolve()
        return
      }
      typewriterTimer = schedule(step)
    }
    typewriterTimer = schedule(step)
  })
}

// ─── Session token ───────────────────────────────────────────────────────────

/**
 * Fetches the conversation's session token, once, lazily.
 *
 * The server mints it because signing needs a secret the browser must never
 * hold. A failure here is not fatal: the reply still goes out, only the
 * transcript is skipped, so this never blocks a send.
 */
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

function boundedUserHistory(): { sender: 'user', text: string }[] {
  const messages = activeConversation.value.messages
    .filter(item => item.sender === 'user' && typeof item.text === 'string')
    .map(item => ({ sender: 'user' as const, text: item.text.normalize('NFKC').trim().slice(0, CHATBOT_CLIENT_LIMITS.maxMessageChars) }))
    .filter(item => item.text)
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
function parseSseLine(line: string, target: { text: string, message: ChatMessage }): void {
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
    target.message.kind = typeof chatbot.kind === 'string' && CHATBOT_RESPONSE_KINDS.has(chatbot.kind) ? chatbot.kind : 'unavailable'
    target.message.sources = Array.isArray(chatbot.sources)
      ? chatbot.sources.slice(0, CHATBOT_CLIENT_LIMITS.maxSources).map(normalizeSource).filter((value): value is ChatSource => value !== null)
      : []
    target.message.askContact = chatbot.askContact === true
    if (target.message.askContact && !target.message.lead) {
      target.message.lead = { name: '', phone: '', email: '', question: '', status: 'idle', error: '' }
    }
  }
}

async function fetchStreamBotReply(onScroll?: () => void): Promise<boolean> {
  if (isSubmitting.value) return false
  const requestSequence = ++botRequestSequence
  const conversation = activeConversation.value
  isSubmitting.value = true
  botInputError.value = ''
  chatRequestController = new AbortController()
  const requestController = chatRequestController

  const botMessage: ChatMessage = {
    id: `bot-${++messageSequence}`,
    sender: 'bot',
    text: '',
    kind: undefined,
    sources: [],
    askContact: false,
    lead: null,
    isStreaming: true,
  }
  // Deliberately not pushed yet. Pushing it here rendered an empty bubble holding
  // nothing but the streaming cursor *alongside* the typing indicator, for the
  // whole network wait — two indicators for one pending reply. It joins the
  // transcript once there is text to show.
  onScroll?.()

  const accumulator = { text: '', message: botMessage }

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
    if (!response.ok || !response.body) throw new Error('CHATBOT_UNAVAILABLE')

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let doneEvent = false
    while (!doneEvent) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const lines = buffer.split('\n')
      buffer = done ? '' : lines.pop() || ''
      for (const line of lines) {
        if (line.trim() === 'data: [DONE]') { doneEvent = true; break }
        parseSseLine(line, accumulator)
      }
      if (done) break
    }
    if (buffer) parseSseLine(buffer, accumulator)
    if (!accumulator.text.trim()) throw new Error('EMPTY_CHATBOT_RESPONSE')
    if (!botMessage.kind) botMessage.kind = 'unavailable'

    // The reply joins the transcript only now that it has content. Until this
    // point the typing indicator stood in for it, so the two never coexist.
    conversation.messages.push(botMessage)

    // Playback must mutate the message through the array, not through the local
    // `botMessage` literal. `conversations` is a `ref`, so Vue hands out a proxy
    // per element and only writes made *through that proxy* schedule a re-render.
    // Typing into the raw object updated the data and told no one: the bubble
    // stayed frozen on whatever the first paint caught, then filled in all at
    // once the next time anything else touched the array — which is why the
    // answer appeared only after the visitor sent their next message.
    const tracked = conversation.messages[conversation.messages.length - 1]!

    // Playback is a presentation effect, so nothing waits on it. Awaiting it here
    // held the send back for the whole animation: the caller could not clear the
    // input box, and the question sat there looking unsent until the last word
    // had been typed. `persist()` runs when playback ends, because a message
    // still mid-playback is deliberately not written to storage.
    isSubmitting.value = false
    chatRequestController = null
    void playTypewriter(tracked, accumulator.text, { onTick: onScroll }).then(persist)
    return true
  } catch (error) {
    // The bot message is only in the transcript if the reply arrived, so a failure
    // before that point has nothing to remove. Removing it unconditionally would
    // have deleted whichever message happened to be last.
    const index = conversation.messages.findIndex(item => item.id === botMessage.id)
    if (index !== -1) conversation.messages.splice(index, 1)
    if ((error as Error)?.name !== 'AbortError' && requestSequence === botRequestSequence) {
      botInputError.value = 'Không thể nhận phản hồi lúc này. Nội dung câu hỏi đã được giữ lại để bạn thử lại.'
    }
    return false
  } finally {
    if (requestSequence === botRequestSequence) {
      isSubmitting.value = false
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
  if (text.length > CHATBOT_CLIENT_LIMITS.maxMessageChars) {
    botInputError.value = `Câu hỏi không được vượt quá ${CHATBOT_CLIENT_LIMITS.maxMessageChars} ký tự.`
    return
  }

  const conversation = activeConversation.value
  applyAutoTitle(text)
  const userMessage: ChatMessage = { id: `user-${++messageSequence}`, sender: 'user', text }
  conversation.messages.push(userMessage)
  onScroll?.()

  const requestSequence = botRequestSequence + 1
  const succeeded = await fetchStreamBotReply(onScroll)
  if (requestSequence !== botRequestSequence) return
  if (succeeded) {
    botInput.value = ''
    persist()
  } else {
    const index = conversation.messages.findIndex(item => item.id === userMessage.id)
    if (index !== -1) conversation.messages.splice(index, 1)
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
    await $fetch('/api/public/chatbot/lead', {
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
    limits: CHATBOT_CLIENT_LIMITS,
    isProblemKind,
    messageKindLabel,
    messageKindClass,
  }
}
