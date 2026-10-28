import { setHeader, createError, getRequestHeader } from 'h3'
import { getChatbotSettings } from '../../../services/chatbot-settings'
import { answerChat } from '../../../utils/chatbot/chat'
import { CHAT_RATE_LIMITED_MESSAGE, chargeChatRateLimit, validateChatRequestBody } from '../../../utils/chatbot/chat-policy'
import { assertChatInputLength } from '../../../utils/chatbot/input-length'
import { verifySessionToken } from '../../../utils/chatbot/session-token'
import { persistChatTurn } from '../../../utils/chatbot/session-db'
import { getClientIp } from '../../../utils/client-ip'
import { analyticsHmacSecret } from '../../../utils/runtime-config'
import { earlierTurnsToWithhold, fastPreModerate } from '../../../services/moderation-worker'
import { createModerationRegexBudget } from '../../../services/moderation-regex'
import { chatHistoryShapeOk, chatTextsToScreen, lastUserTurnText, withoutUserTurns } from '../../../utils/chatbot/chat-turns'
import { createSseHeartbeat } from '../../../utils/chatbot/sse-heartbeat'

/** Serialises a result into the single-event SSE envelope the widget parses. */
function sseEnvelope(answer: string, kind: string, sources: unknown, retryAfter: number | null, askContact: boolean, followUps: string[] = []): string {
  const payload = JSON.stringify({
    choices: [{ delta: { content: answer } }],
    chatbot: { kind, sources, retryAfter, askContact, followUps },
  })
  return `data: ${payload}\n\ndata: [DONE]\n\n`
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
  // Read through chat-turns.ts — the same string the policy answers and we store.
  const userText = lastUserTurnText(messages)

  // Hạn mức theo địa chỉ TRƯỚC kiểm duyệt: mỗi tin bị chặn ghi một hàng chờ duyệt
  // (và một lượt chat khi có phiên), nên kiểm duyệt đứng trước hạn mức là cửa cho
  // một script làm ngập hàng đợi. Quá hạn mức → trả lời ngay, không ghi gì.
  // `answerChat` dùng lại đúng quyết định này (không trừ lượt hai lần).
  const retryAfter = await chargeChatRateLimit(event, settings)
  if (retryAfter) {
    setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
    setHeader(event, 'Cache-Control', 'no-cache, no-transform')
    return sseEnvelope(CHAT_RATE_LIMITED_MESSAGE, 'rate_limited', [], retryAfter, false)
  }

  // Trần độ dài SAU hạn mức (lượt quá dài vẫn bị tính), TRƯỚC kiểm duyệt: đúng chuỗi
  // sắp được quét, theo đúng trần `answerChat` áp (cài đặt `maxInputChars`).
  // History shape first (count, total size, a user turn last) so a 64 KB body of
  // thousands of turns is refused before any of it is screened; then every user
  // turn about to be screened is length-capped, not just the newest.
  if (!chatHistoryShapeOk(messages)) throw createError({ statusCode: 400, statusMessage: 'Invalid chat messages' })
  const screenedTexts = chatTextsToScreen(messages)
  for (const screened of screenedTexts) assertChatInputLength(screened, settings)

  // Tiền kiểm duyệt an ninh tức thì (< 1ms):
  // Câu hỏi MỚI vi phạm → TỪ CHỐI NGAY và ghi một hàng chờ duyệt.
  // Lượt người dùng CŨ trong lịch sử (do trình duyệt gửi lên) cũng được quét, nhưng lượt
  // vi phạm chỉ bị bỏ khỏi lịch sử gửi model: từ chối vì nó làm kẹt cả cuộc trò chuyện
  // (widget chỉ bỏ lượt mới nhất) và ghi lại câu cũ vào hàng chờ ở mỗi tin nhắn.
  // Một hạn mức thời gian regex cho cả request (moderation-regex-runtime.ts), câu mới quét
  // trước để lịch sử không tiêu hết; các lượt cũ quét trong một lượt gộp — lượt cũ mà hạn mức
  // không tới được cũng bị giữ khỏi model, không bao giờ gửi đi khi chưa quét.
  const regexBudget = createModerationRegexBudget()
  const [latest, ...earlier] = screenedTexts
  let blocked: string | null = null
  if (latest) {
    const fastCheck = await fastPreModerate(latest, {
      targetType: 'chat',
      sessionId: sessionId || undefined,
      contextTitle: sessionId ? `Phiên Chatbot #${sessionId.slice(0, 8)}` : 'Chatbot trực tuyến',
      contextUrl: sessionId ? `/admin/chatbot/sessions?search=${encodeURIComponent(sessionId)}` : '/admin/chatbot/sessions',
      authorIp: getClientIp(event) || undefined,
      capQueuePerSource: true,
      regexBudget,
    }).catch(() => null)
    if (fastCheck?.blocked) blocked = latest
  }
  const withheld = blocked === null
    ? await earlierTurnsToWithhold(earlier, { regexBudget }).catch(() => new Set(earlier))
    : new Set<string>()
  const answerMessages = withoutUserTurns(messages, withheld)

  if (blocked !== null) {
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
          userText: blocked, // the newest turn, screened and refused
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
        userText: blocked, // the newest turn, screened and refused
        botText: refusalMessage,
        kind: 'moderation_blocked',
      }).catch(() => null)
    }

    return sseEnvelope(refusalMessage, 'moderation_blocked', [], null, false)
  }

  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-cache, no-transform')
  setHeader(event, 'Connection', 'keep-alive')
  // Ngắn nginx buffer SSE: không có header này, nginx gom nhiều res.write thành
  // 1 TCP packet → visitor thấy text nhảy thành đoạn thay vì từng từ.
  setHeader(event, 'X-Accel-Buffering', 'no')

  const res = event.node?.res
  if (res && typeof res.write === 'function') {
    let streamed = false
    let result
    // Một dòng `: ping` sau mỗi 15 giây không có gì trên đường truyền, để proxy không cắt kết nối:
    // lúc provider AI còn đang nghĩ, và lúc lớp chặn chủ quyền giữ chữ hoặc đã thay câu trả lời mà
    // model vẫn đang viết (xem sse-heartbeat.ts). Mỗi lần ghi đếm lại từ đầu.
    const heartbeat = createSseHeartbeat(frame => { res.write(frame) })
    heartbeat.start()
    try {
      result = await answerChat(
        event,
        settings,
        answerMessages,
        (delta: string) => {
          heartbeat.stop()
          streamed = true
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`)
          // Ép flush ngay để visitor thấy từng từ. Node `res.write` chỉ ghi vào
          // buffer kernel; `res.uncork()` ép TCP gửi packet ngay thay vì gom
          // nhiều write thành 1 segment. X-Accel-Buffering:no (ở header) bảo
          // nginx không buffer; đây là phần đối ứng phía Node.
          if (typeof res.uncork === 'function') { res.cork(); res.uncork() }
          heartbeat.start()
        },
        (toolEvt: { name: string; query?: string; status: 'calling' | 'done'; count?: number }) => {
          res.write(`data: ${JSON.stringify({ chatbot: { toolEvent: toolEvt } })}\n\n`)
        },
        // Lớp chặn chủ quyền rút lại câu trả lời đang stream (sovereignty-guard.ts): `replace` cho widget
        // hiện tại (thay hẳn), `content` cho tab đang mở bản widget cũ (chỉ biết nối thêm).
        (answer: string) => {
          heartbeat.stop()
          streamed = true
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `\n\n${answer}` } }], chatbot: { replace: answer } })}\n\n`)
          if (typeof res.uncork === 'function') { res.cork(); res.uncork() }
          // Model vẫn viết tiếp (không dừng được) và không chữ nào của nó được gửi nữa: giữ nhịp tim tới hết.
          heartbeat.start()
        },
      )
    } catch (error) {
      if ((error as Error).message === 'INVALID_MESSAGES') throw createError({ statusCode: 400, statusMessage: 'Invalid chat messages' })
      throw error
    } finally {
      heartbeat.stop()
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
        followUps: result.followUps ?? [],
      },
    })}\n\n`)
    res.write('data: [DONE]\n\n')

    if (sessionId) {
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
  try { result = await answerChat(event, settings, answerMessages) }
  catch (error) {
    if ((error as Error).message === 'INVALID_MESSAGES') throw createError({ statusCode: 400, statusMessage: 'Invalid chat messages' })
    throw error
  }

  if (sessionId) {
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

  return sseEnvelope(result.answer, result.kind, result.sources, result.retryAfter || null, result.askContact || false, result.followUps ?? [])
})
