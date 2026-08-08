import { setHeader, createError, getRequestHeader } from 'h3'
import { getChatbotSettings } from '../../../services/chatbot-settings'
import { answerChat } from '../../../utils/chatbot/chat'
import { validateChatRequestBody } from '../../../utils/chatbot/chat-policy'
import { verifySessionToken } from '../../../utils/chatbot/session-token'
import { persistChatTurn } from '../../../utils/chatbot/session-db'
import { getClientIp } from '../../../utils/client-ip'
import { analyticsHmacSecret } from '../../../utils/runtime-config'

/** Serialises a result into the single-event SSE envelope the widget parses. */
function sseEnvelope(answer: string, kind: string, sources: unknown, retryAfter: number | null, askContact: boolean): string {
  const payload = JSON.stringify({
    choices: [{ delta: { content: answer } }],
    chatbot: { kind, sources, retryAfter, askContact },
  })
  return `data: ${payload}\n\ndata: [DONE]\n\n`
}

/** Last user turn — the only one that can contain contact details worth storing. */
function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index] as { text?: unknown; content?: unknown } | null
    const value = typeof item?.text === 'string' ? item.text : typeof item?.content === 'string' ? item.content : ''
    if (value.trim()) return value.trim()
  }
  return ''
}

export default defineEventHandler(async (event) => {
  const settings = await getChatbotSettings()
  const body = await readBody(event).catch(() => null)

  // Honeypot. A real browser leaves `_h` empty — it is visually hidden and
  // removed from the tab order, so only a form-filling script writes to it.
  //
  // The response is a normal 200 carrying a plausible reply. A 400 here would
  // tell the script exactly which field gave it away, and it would stop sending
  // that field on the next run.
  const honeypot = (body as { _h?: unknown } | null)?._h
  if (typeof honeypot === 'string' && honeypot.trim() !== '') {
    setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
    setHeader(event, 'Cache-Control', 'no-cache, no-transform')
    return sseEnvelope(
      'Hiện chưa có thông tin phù hợp trong kho dữ liệu đã được phê duyệt.',
      'not_found',
      [],
      null,
      false,
    )
  }

  try { validateChatRequestBody(body) }
  catch (error) {
    if ((error as Error).message === 'REQUEST_TOO_LARGE') throw createError({ statusCode: 413, statusMessage: 'Request is too large' })
    throw error
  }

  // Verify before answering: the AI quota is keyed on the session, so the policy
  // needs the id already resolved by the time it decides to call a provider.
  const sessionId = verifySessionToken(getRequestHeader(event, 'x-chat-session'), analyticsHmacSecret(event))
  if (sessionId) event.context.chatSessionId = sessionId

  const messages = (body as { messages?: unknown } | null)?.messages
  let result
  try { result = await answerChat(event, settings, messages) }
  catch (error) {
    if ((error as Error).message === 'INVALID_MESSAGES') throw createError({ statusCode: 400, statusMessage: 'Invalid chat messages' })
    throw error
  }

  // Transcript write. Awaited rather than fired-and-forgotten: Nitro may tear
  // the request context down as soon as the handler returns, which can cut a
  // detached promise off mid-query. `persistChatTurn` swallows its own errors,
  // so awaiting it cannot fail the reply.
  if (sessionId) {
    const userText = lastUserText(messages)
    if (userText) {
      await persistChatTurn({
        sessionId,
        ip: getClientIp(event) || null,
        userAgent: getRequestHeader(event, 'user-agent') ?? null,
        userText,
        botText: result.answer,
        kind: result.kind,
      })
    }
  }

  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-cache, no-transform')
  setHeader(event, 'Connection', 'keep-alive')
  return sseEnvelope(result.answer, result.kind, result.sources, result.retryAfter || null, result.askContact || false)
})
