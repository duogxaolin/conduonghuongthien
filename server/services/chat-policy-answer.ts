/**
 * Định tuyến một lượt chat: kiểm request → rate limit (một lần mỗi request) → kho
 * tri thức đã duyệt (luôn thắng) → small-talk → AI (chỉ trừ hạn mức ngay trước lời
 * gọi provider) → các đường lùi. Tách nguyên văn từ `server/utils/chatbot/chat-policy.ts`
 * (wave3 D-SPLIT). Chủ quyền biển, đảo chặn ở đây, trước mọi nhánh: câu hỏi → lập trường
 * viết sẵn, lịch sử → bỏ cặp hỏi–đáp nhắc chủ đề, câu trả lời của model → lớp chặn đầu ra
 * (`sovereignty-guard.ts`, docs/decisions/chatbot.md).
 */
import type { ChatbotSettings } from '../db/schema'
import { retrieveKnowledge, type PublicKnowledgeReference } from '../utils/chatbot/retrieval'
import { logInfo, logWarn } from '../utils/logger'
import { chatTurnText } from '../utils/chatbot/chat-turns'
import { createSovereigntyOutputGuard, mentionsSovereignty, sovereigntyAnswer, withoutSovereigntyTurns } from '../utils/chatbot/sovereignty-guard'
import type { ChatDependencies, ChatEvent, ChatResult } from './chat-policy-contract'
import { AI_QUOTA_MESSAGE, CHAT_RATE_LIMITED_MESSAGE, chargeChatRateLimit, enforceAiQuota } from './chat-policy-rate-limit'
import { validateChatMessages, validateChatRequestBody } from './chat-policy-request'
import { knowledgeOrSituation, outOfScopeResult, smallTalkResult } from './chat-policy-fallbacks'
import { callProvider, providerFollowUps } from './chat-policy-provider'

type ProviderReply = NonNullable<Awaited<ReturnType<typeof callProvider>>>

function aiProviderReady(settings: ChatbotSettings): boolean {
  return Boolean(settings.enabled && settings.baseUrl && settings.model && settings.allowedHosts?.length)
}

export async function answerGroundedChat(
  event: ChatEvent,
  settings: ChatbotSettings,
  messages: unknown,
  dependencies: ChatDependencies,
  onChunk?: (chunk: string) => void | Promise<void>,
  onToolCall?: (event: { name: string; query?: string; status: 'calling' | 'done'; count?: number }) => void | Promise<void>,
  /** Rút lại phần đã stream và thay bằng `answer` (lớp chặn đầu ra, sovereignty-guard.ts). */
  onReplace?: (answer: string) => void | Promise<void>,
): Promise<ChatResult & { streamed?: boolean }> {
  validateChatRequestBody({ messages })
  // Lượt cũ nhắc chủ quyền biển, đảo (kể cả câu trả lời sai trước bản vá) không tới model.
  const history = withoutSovereigntyTurns(validateChatMessages(messages, settings))
  const retryAfter = await chargeChatRateLimit(event, settings)
  if (retryAfter) return { answer: CHAT_RATE_LIMITED_MESSAGE, sources: [], kind: 'rate_limited', retryAfter }

  const query = chatTurnText(history[history.length - 1])
  // Chủ quyền biển, đảo: lập trường do máy chủ viết, ở mọi chế độ, không bao giờ qua model (sovereignty-guard.ts).
  if (mentionsSovereignty(query)) {
    logInfo({ event: 'chatbot.sovereignty_answered', consequence: 'fixed official answer, provider not called' })
    return { answer: sovereigntyAnswer(query), sources: [], kind: 'curated' }
  }
  let references: PublicKnowledgeReference[]
  try {
    references = (dependencies.retrieve ?? retrieveKnowledge)(await dependencies.loadPublishedEntries(), query, { topK: settings.retrievalTopK, charBudget: settings.referenceCharBudget })
  } catch (error) {
    logWarn({
      event: 'chatbot.knowledge_retrieval_failed',
      error,
      consequence: 'knowledge bank unavailable, falling back to small-talk or out-of-scope',
    })
    references = []
  }

  // Chỉ knowledge bank được nạp sẵn. Bài viết / ảnh / video KHÔNG được server nạp
  // trước: model tự gọi search_c11_articles / _photos / _videos khi thấy dẫn chứng
  // làm câu trả lời thuyết phục hơn. (Nạp trước từng khiến cả "hi" cũng kèm 5 bài
  // + 3 video.)

  // The business knowledge bank is the first routing decision and always wins.
  const mode = settings.mode === 'knowledge' ? 'knowledge' : 'ai'
  if (mode !== 'ai') {
    if (references.length) return knowledgeOrSituation(settings, dependencies, query, history, references)
    return (await smallTalkResult(settings, dependencies, query, history)) ?? outOfScopeResult(settings)
  }

  // The AI quota is charged only where a provider call is imminent. Charging it
  // at the top of the handler would spend allowance on curated answers that
  // never reach a provider, and a visitor reading approved content would be cut
  // off for consuming nothing.
  const sessionId = typeof (event.context as { chatSessionId?: unknown } | undefined)?.chatSessionId === 'string'
    ? (event.context as { chatSessionId: string }).chatSessionId
    : null

  // Lớp chặn đầu ra: câu hỏi lách được bộ khớp mà model trả lời vào chủ đề chủ quyền → không chữ nào của
  // câu đó tới khách nữa, `onReplace` thay phần đã hiện, và câu trả lời trả về/lưu là lập trường chính thức.
  const officialAnswer = sovereigntyAnswer(query)
  const replaced: ChatResult & { streamed?: boolean } = { answer: officialAnswer, sources: [], kind: 'curated', streamed: Boolean(onChunk) }
  const outputGuard = createSovereigntyOutputGuard({
    forward: onChunk,
    question: query,
    replace: async () => {
      logWarn({ event: 'chatbot.sovereignty_output_replaced', consequence: 'model answer withheld, fixed official answer sent instead' })
      await onReplace?.(officialAnswer)
    },
  })
  // Câu truy vấn công cụ do model viết hiện dưới câu trả lời ("Truy vấn: «…»") và còn lại sau khi thay.
  const guardedToolCall: typeof onToolCall = onToolCall && (call => onToolCall(call.query && mentionsSovereignty(call.query, { output: true }) ? { ...call, query: undefined } : call))
  const askProvider = async (refs: PublicKnowledgeReference[]): Promise<ProviderReply | 'replaced' | null> => {
    try {
      const reply = await callProvider(settings, dependencies, refs, history, outputGuard.push, guardedToolCall)
      if (await outputGuard.finish(reply?.text ?? '')) return 'replaced'
      return reply && { ...reply, proposals: reply.proposals.filter(proposal => !mentionsSovereignty(proposal, { output: true })) }
    } catch (error) {
      // Đã thay giữa luồng rồi provider mới hỏng: khách đang thấy lập trường chính thức, giữ nguyên.
      if (outputGuard.tripped) return 'replaced'
      throw error
    }
  }

  if (references.length === 0) {
    const smallTalk = await smallTalkResult(settings, dependencies, query, history)
    if (smallTalk) return smallTalk
    if (settings.outOfScopeBehavior === 'ai_freeform' && aiProviderReady(settings)) {
      const quotaRetryAfter = await enforceAiQuota(event, sessionId)
      if (quotaRetryAfter) return { answer: AI_QUOTA_MESSAGE, sources: [], kind: 'rate_limited', retryAfter: quotaRetryAfter }
      try {
        const freeform = await askProvider([])
        if (freeform === 'replaced') return replaced
        if (freeform) {
          return {
            answer: freeform.text,
            sources: [],
            toolCalls: freeform.toolCalls,
            kind: 'provider',
            followUps: await providerFollowUps(dependencies, query, freeform, []),
            streamed: Boolean(onChunk),
          }
        }
      } catch (error) {
        logWarn({
          event: 'chatbot.freeform_provider_failed',
          error,
          consequence: 'falling back to out-of-scope message',
        })
      }
    }
    return outOfScopeResult(settings)
  }

  if (!aiProviderReady(settings)) return knowledgeOrSituation(settings, dependencies, query, history, references)

  // Over quota with references in hand is not a dead end: the approved answer is
  // still the answer. Falling back to it beats refusing a question the knowledge
  // bank can already answer.
  const groundedQuotaRetryAfter = await enforceAiQuota(event, sessionId)
  if (groundedQuotaRetryAfter) return knowledgeOrSituation(settings, dependencies, query, history, references)

  try {
    const grounded = await askProvider(references)
    if (grounded === 'replaced') return replaced
    if (grounded) {
      // Bài viết / ảnh / video do model tự gọi công cụ rồi dệt vào câu trả lời; không
      // có block nào được ép thêm ở đây (sẽ làm chào hỏi cũng kèm link thừa).
      return {
        answer: grounded.text,
        // "Nguồn tham khảo" chỉ liệt kê trích dẫn kho kiến thức (chatbot_knowledge).
        // Bài viết / ảnh / video (kind: 'evidence') đã nằm trong thân câu trả lời do
        // model dệt từ kết quả công cụ — liệt kê lại ở đây là trùng lặp.
        sources: references.filter(ref => ref.source && ref.kind !== 'evidence'),
        toolCalls: grounded.toolCalls,
        kind: 'provider',
        followUps: await providerFollowUps(dependencies, query, grounded, references),
        streamed: Boolean(onChunk),
      }
    }
    return knowledgeOrSituation(settings, dependencies, query, history, references)
  } catch (error) {
    logWarn({
      event: 'chatbot.grounded_provider_failed',
      error,
      consequence: 'falling back to approved knowledge answer',
    })
    return knowledgeOrSituation(settings, dependencies, query, history, references)
  }
}
