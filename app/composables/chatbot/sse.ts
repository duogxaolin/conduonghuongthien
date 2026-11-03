import {
  CHATBOT_CLIENT_LIMITS,
  // Import tường minh (không trông vào auto-import của Nuxt cho `utils/`): `parseSseLine`
  // dùng nó, và Node test chạy composable thật (tests/chatbot-send-rejection.test.ts).
  CHATBOT_RESPONSE_KINDS,
  normalizeSource,
  normalizeFollowUps,
  type ChatMessage,
  type ChatSource,
  type ToolCallExecution,
} from '../../utils/chatbot-storage'

/**
 * One line of the chat endpoint's SSE stream, read into the reply being built. Pure: it
 * touches nothing but `target`. Part of `useChatbot` (see `./state.ts`), which re-exports
 * it under its old name — the sovereignty and slow-wait suites import it from there.
 */

/**
 * Accumulates one SSE line into `target`. `text` is collected apart from the message so playback can start
 * from empty (writing `message.text` would show the whole answer for a frame before the typewriter reset it).
 * `chatbot.replace` swaps `text` instead of appending: the server withdrew what it streamed (sovereignty guard);
 * the `content` in the same frame is only for an older widget, which can only append.
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
