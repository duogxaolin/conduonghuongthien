import { setHeader, createError, getRequestHeader } from 'h3'
import { getChatbotSettings } from '../../../services/chatbot-settings'
import { answerChat } from '../../../utils/chatbot/chat'
import { validateChatRequestBody } from '../../../utils/chatbot/chat-policy'
import { verifySessionToken } from '../../../utils/chatbot/session-token'
import { persistChatTurn } from '../../../utils/chatbot/session-db'
import { getClientIp } from '../../../utils/client-ip'
import { analyticsHmacSecret } from '../../../utils/runtime-config'
import { checkAndModerateContent, fastPreModerate } from '../../../services/moderation-worker'

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
  const userText = lastUserText(messages)

  // Tiền kiểm duyệt an ninh tức thì (< 1ms):
  // Nếu phát hiện nội dung độc hại/chống phá/nguy hiểm: TỪ CHỐI NGAY LẬP TỨC (0ms)
  if (userText) {
    const fastCheck = await fastPreModerate(userText, {
      targetType: 'chat',
      sessionId: sessionId || undefined,
      contextTitle: sessionId ? `Phiên Chatbot #${sessionId.slice(0, 8)}` : 'Chatbot trực tuyến',
      contextUrl: sessionId ? `/admin/chatbot/sessions?search=${encodeURIComponent(sessionId)}` : '/admin/chatbot/sessions',
      authorIp: getClientIp(event) || undefined,
    }).catch(() => null)

    if (fastCheck?.blocked) {
      const refusalMessage = 'Nội dung câu hỏi của bạn có dấu hiệu vi phạm chính sách an toàn thông tin và quy định pháp luật (Luật An ninh mạng). Cổng thông tin Cục C11 từ chối tiếp nhận và xử lý yêu cầu này.'

      setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
      setHeader(event, 'Cache-Control', 'no-cache, no-transform')
      setHeader(event, 'Connection', 'keep-alive')

      const res = event.node?.res
      if (res && typeof res.write === 'function') {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: refusalMessage } }] })}\n\n`)
        res.write(`data: ${JSON.stringify({
          choices: [{ delta: { content: '' } }],
          chatbot: {
            kind: 'moderation_blocked',
            sources: [],
            retryAfter: null,
            askContact: false,
          },
        })}\n\n`)
        res.write('data: [DONE]\n\n')

        if (sessionId) {
          await persistChatTurn({
            sessionId,
            ip: getClientIp(event) || null,
            userAgent: getRequestHeader(event, 'user-agent') ?? null,
            userText,
            botText: refusalMessage,
            kind: 'moderation_blocked',
          }).catch(() => null)
        }
        res.end()
        return
      }

      if (sessionId) {
        await persistChatTurn({
          sessionId,
          ip: getClientIp(event) || null,
          userAgent: getRequestHeader(event, 'user-agent') ?? null,
          userText,
          botText: refusalMessage,
          kind: 'moderation_blocked',
        }).catch(() => null)
      }

      return sseEnvelope(refusalMessage, 'moderation_blocked', [], null, false)
    }
  }

  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-cache, no-transform')
  setHeader(event, 'Connection', 'keep-alive')

  const res = event.node?.res
  if (res && typeof res.write === 'function') {
    let streamed = false
    let result
    try {
      result = await answerChat(
        event,
        settings,
        messages,
        (delta: string) => {
          streamed = true
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`)
        },
        (toolEvt: { name: string; query?: string; status: 'calling' | 'done'; count?: number }) => {
          res.write(`data: ${JSON.stringify({ chatbot: { toolEvent: toolEvt } })}\n\n`)
        }
      )
    } catch (error) {
      if ((error as Error).message === 'INVALID_MESSAGES') throw createError({ statusCode: 400, statusMessage: 'Invalid chat messages' })
      throw error
    }

    if (!streamed) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: result.answer } }] })}\n\n`)
    }

    res.write(`data: ${JSON.stringify({
      choices: [{ delta: { content: '' } }],
      chatbot: {
        kind: result.kind,
        sources: result.sources,
        toolCalls: result.toolCalls,
        retryAfter: result.retryAfter || null,
        askContact: result.askContact || false,
      },
    })}\n\n`)
    res.write('data: [DONE]\n\n')

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
        // Đã được kiểm duyệt và ghi nhận trong pre-moderation ở đầu luồng
      }
    }

    res.end()
    return
  }

  let result
  try { result = await answerChat(event, settings, messages) }
  catch (error) {
    if ((error as Error).message === 'INVALID_MESSAGES') throw createError({ statusCode: 400, statusMessage: 'Invalid chat messages' })
    throw error
  }

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

  return sseEnvelope(result.answer, result.kind, result.sources, result.retryAfter || null, result.askContact || false)
})
