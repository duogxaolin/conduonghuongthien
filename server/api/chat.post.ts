import { setHeader, createError } from 'h3'
import { getChatbotSettings } from '../services/chatbot-settings'
import { answerChat } from '../utils/chatbot/chat'
import { fastPreModerate } from '../services/moderation-worker'
import { getClientIp } from '../utils/client-ip'

function extractLastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && typeof m === 'object' && 'role' in m && m.role === 'user' && 'content' in m && typeof m.content === 'string') {
      return m.content.trim()
    }
  }
  return ''
}

/** Backwards-compatible public chatbot endpoint. The governed implementation lives in utils/chatbot/chat.ts. */
export default defineEventHandler(async (event) => {
  const settings = await getChatbotSettings()
  const body = await readBody(event).catch(() => null)
  if (Buffer.byteLength(JSON.stringify(body ?? null), 'utf8') > 64_000) throw createError({ statusCode: 413, statusMessage: 'Request is too large' })
  const rawMessages = (body as { messages?: unknown } | null)?.messages
  const userText = extractLastUserText(rawMessages)
  if (userText) {
    const fastCheck = await fastPreModerate(userText, {
      targetType: 'chat',
      authorIp: getClientIp(event) || undefined,
      contextTitle: 'Chatbot trực tuyến',
      contextUrl: '/admin/chatbot/sessions',
    }).catch(() => null)

    if (fastCheck?.blocked) {
      const refusalMessage = 'Nội dung câu hỏi của bạn có dấu hiệu vi phạm chính sách an toàn thông tin và quy định pháp luật (Luật An ninh mạng). Cổng thông tin Cục C11 từ chối tiếp nhận và xử lý yêu cầu này.'
      setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
      setHeader(event, 'Cache-Control', 'no-cache, no-transform')
      setHeader(event, 'Connection', 'keep-alive')
      return `data: ${JSON.stringify({ choices: [{ delta: { content: refusalMessage } }], chatbot: { kind: 'moderation_blocked', sources: [] } })}\n\ndata: [DONE]\n\n`
    }
  }

  let result
  try { result = await answerChat(event, settings, rawMessages) }
  catch (error) { if ((error as Error).message === 'INVALID_MESSAGES') throw createError({ statusCode: 400, statusMessage: 'Invalid chat messages' }); throw error }
  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-cache, no-transform')
  setHeader(event, 'Connection', 'keep-alive')
  return `data: ${JSON.stringify({ choices: [{ delta: { content: result.answer } }], chatbot: { kind: result.kind, sources: result.sources, retryAfter: result.retryAfter || null } })}\n\ndata: [DONE]\n\n`
})
