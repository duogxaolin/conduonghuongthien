import { CHATBOT_CLIENT_LIMITS, CHATBOT_WELCOME_MESSAGE } from '../../utils/chatbot-storage'
import { persist } from './persistence'
import { cancelInFlight } from './send'
import { activeConversation, activeId, blankConversation, CHATBOT_UNTITLED, conversations } from './state'

/**
 * The visitor's conversations: start one, switch, delete, clear. Each first cancels a
 * request in flight that belongs to the conversation being left (`cancelInFlight`), so a
 * late reply can never land in the wrong one. Part of `useChatbot` (see `./state.ts`).
 */

export function createConversation(): void {
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

export function switchConversation(id: string): void {
  if (id === activeId.value) return
  if (!conversations.value.some(item => item.id === id)) return
  cancelInFlight()
  activeId.value = id
  persist()
}

export function deleteConversation(id: string): void {
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

export function clearChatHistory(): void {
  cancelInFlight()
  const conversation = activeConversation.value
  conversation.messages = [{ ...CHATBOT_WELCOME_MESSAGE }]
  conversation.title = CHATBOT_UNTITLED
  persist()
}
