import {
  CHATBOT_CLIENT_LIMITS,
  CHATBOT_WELCOME_MESSAGE,
  normalizeConversation as normalizeConversationRaw,
  normalizeStoredMessage,
  type ChatMessage,
  type StoredConversation,
} from '../../utils/chatbot-storage'
import { activeId, blankConversation, conversations, hydrated, newLocalId } from './state'

/**
 * What the chatbot keeps on this device: the conversations in `localStorage`, written
 * by `persist()` and read back once per page by `hydrate()`. Part of `useChatbot` (see
 * `./state.ts`); the shape checks on what is read back live in
 * `app/utils/chatbot-storage.ts`, the trust boundary.
 */

/** Multi-conversation store. The v2 key held a single flat message array. */
const SESSIONS_KEY = 'cdkt_sessions_v1'
const LEGACY_HISTORY_KEY = 'cdkt_chat_history_v2'

/** Bọc lại để nơi gọi trong tệp này giữ nguyên chữ ký một tham số. */
function normalizeConversation(item: unknown): StoredConversation | null {
  return normalizeConversationRaw(item, newLocalId, () => Date.now())
}

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

export function persist(): void {
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

export function hydrate(): void {
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
