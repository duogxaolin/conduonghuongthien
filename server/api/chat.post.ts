import { setHeader, createError } from 'h3'
import { getChatbotSettings } from '../services/chatbot-settings'
import { answerChat } from '../utils/chatbot/chat'
import { CHAT_RATE_LIMITED_MESSAGE, chargeChatRateLimit } from '../utils/chatbot/chat-policy'
import { assertChatInputLength } from '../utils/chatbot/input-length'
import { fastPreModerate, matchInstantRuleBatch } from '../services/moderation-worker'
import { createModerationRegexBudget } from '../services/moderation-regex'
import { getClientIp } from '../utils/client-ip'
import { chatHistoryShapeOk, chatTextsToScreen, withoutUserTurns } from '../utils/chatbot/chat-turns'

/** Backwards-compatible public chatbot endpoint. The governed implementation lives in utils/chatbot/chat.ts. */
export default defineEventHandler(async (event) => {
  const settings = await getChatbotSettings()
  const body = await readBody(event).catch(() => null)
  if (Buffer.byteLength(JSON.stringify(body ?? null), 'utf8') > 64_000) throw createError({ statusCode: 413, statusMessage: 'Request is too large' })
  const rawMessages = (body as { messages?: unknown } | null)?.messages

  // Rate limit BEFORE moderation (a blocked message writes a review-queue row);
  // answerChat reuses this decision instead of charging the request twice.
  const retryAfter = await chargeChatRateLimit(event, settings)
  if (retryAfter) {
    setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
    setHeader(event, 'Cache-Control', 'no-cache, no-transform')
    return `data: ${JSON.stringify({ choices: [{ delta: { content: CHAT_RATE_LIMITED_MESSAGE } }], chatbot: { kind: 'rate_limited', sources: [], retryAfter } })}\n\ndata: [DONE]\n\n`
  }

  // Length cap AFTER the rate-limit charge, BEFORE moderation (same rule answerChat applies).
  // Read through chat-turns.ts — the same strings the policy answers (a `{sender, text}`
  // turn used to skip moderation here entirely). History shape is checked first; then
  // every user turn reaches the model, so every one is length-capped and screened.
  if (!chatHistoryShapeOk(rawMessages)) throw createError({ statusCode: 400, statusMessage: 'Invalid chat messages' })
  const screenedTexts = chatTextsToScreen(rawMessages)
  for (const screened of screenedTexts) assertChatInputLength(screened, settings)

  // The new question is screened and refused (one review-queue row); an EARLIER user
  // turn that trips a rule is only withheld from the model — refusing for it locked
  // the conversation and re-filed the old line on every message. One regex budget for
  // the whole request (moderation-regex-runtime.ts), the new question first so the
  // history cannot spend it; the history turns in one batched pass.
  const regexBudget = createModerationRegexBudget()
  const [latest, ...earlier] = screenedTexts
  if (latest) {
    const fastCheck = await fastPreModerate(latest, {
      targetType: 'chat',
      authorIp: getClientIp(event) || undefined,
      contextTitle: 'Chatbot trực tuyến',
      contextUrl: '/admin/chatbot/sessions',
      capQueuePerSource: true,
      regexBudget,
    }).catch(() => null)

    if (fastCheck?.blocked) {
      const refusalMessage = 'Nội dung câu hỏi của bạn có dấu hiệu vi phạm chính sách an toàn thông tin và quy định pháp luật (Luật An ninh mạng). Cổng thông tin Cục C11 từ chối tiếp nhận và xử lý yêu cầu này.'
      setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
      setHeader(event, 'Cache-Control', 'no-cache, no-transform')
      setHeader(event, 'Connection', 'keep-alive')
      return `data: ${JSON.stringify({ choices: [{ delta: { content: refusalMessage } }], chatbot: { kind: 'moderation_blocked', sources: [] } })}\n\ndata: [DONE]\n\n`
    }
  }

  const verdicts = await matchInstantRuleBatch(earlier, { regexBudget }).catch(() => [])
  const withheld = new Set(earlier.filter((_, index) => verdicts[index]))

  let result
  try { result = await answerChat(event, settings, withoutUserTurns(rawMessages, withheld)) }
  catch (error) { if ((error as Error).message === 'INVALID_MESSAGES') throw createError({ statusCode: 400, statusMessage: 'Invalid chat messages' }); throw error }
  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-cache, no-transform')
  setHeader(event, 'Connection', 'keep-alive')
  return `data: ${JSON.stringify({ choices: [{ delta: { content: result.answer } }], chatbot: { kind: result.kind, sources: result.sources, retryAfter: result.retryAfter || null } })}\n\ndata: [DONE]\n\n`
})
