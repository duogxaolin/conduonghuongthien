import { ref } from 'vue'

/**
 * "Sao chép" under an answer in the chat widget: writes the answer's text to the
 * clipboard and marks that message "Đã chép" for 2 s. One mark for the whole transcript —
 * copying another answer moves it. A refused clipboard (no permission, insecure page)
 * changes nothing on screen.
 *
 * Split out of `ChatWidget.vue` (wave3); the button is
 * `components/chat-widget/ChatWidgetMessageMeta.vue`.
 */
export function useChatCopy() {
  const copiedMsgId = ref<string | null>(null)
  const copyMessageText = async (text: string, id: string | undefined) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      copiedMsgId.value = id || 'copied'
      setTimeout(() => { copiedMsgId.value = null }, 2000)
    } catch { /* ignore */ }
  }
  return { copiedMsgId, copyMessageText }
}
