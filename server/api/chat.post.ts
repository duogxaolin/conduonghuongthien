import { setHeader, createError } from 'h3'
import { getChatbotSettings } from '../services/chatbot-settings'
import { answerChat } from '../utils/chatbot/chat'

/** Backwards-compatible public chatbot endpoint. The governed implementation lives in utils/chatbot/chat.ts. */
export default defineEventHandler(async (event) => {
  const settings = await getChatbotSettings()
  const body = await readBody(event).catch(() => null)
  if (Buffer.byteLength(JSON.stringify(body ?? null), 'utf8') > 64_000) throw createError({ statusCode: 413, statusMessage: 'Request is too large' })
  let result
  try { result = await answerChat(event, settings, (body as { messages?: unknown } | null)?.messages) }
  catch (error) { if ((error as Error).message === 'INVALID_MESSAGES') throw createError({ statusCode: 400, statusMessage: 'Invalid chat messages' }); throw error }
  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-cache, no-transform')
  setHeader(event, 'Connection', 'keep-alive')
  return `data: ${JSON.stringify({ choices: [{ delta: { content: result.answer } }], chatbot: { kind: result.kind, sources: result.sources, retryAfter: result.retryAfter || null } })}\n\ndata: [DONE]\n\n`
})
