/**
 * Định tuyến một lượt chat: kiểm request → rate limit (một lần mỗi request) → kho
 * tri thức đã duyệt (luôn thắng) → small-talk → AI (chỉ trừ hạn mức ngay trước lời
 * gọi provider) → các đường lùi. Tách nguyên văn từ `server/utils/chatbot/chat-policy.ts`
 * (wave3 D-SPLIT).
 */
import type { ChatbotSettings } from '../db/schema'
import { retrieveKnowledge, type PublicKnowledgeReference } from '../utils/chatbot/retrieval'
import { logWarn } from '../utils/logger'
import { chatTurnText } from '../utils/chatbot/chat-turns'
import type { ChatDependencies, ChatEvent, ChatResult } from './chat-policy-contract'
import { AI_QUOTA_MESSAGE, CHAT_RATE_LIMITED_MESSAGE, chargeChatRateLimit, enforceAiQuota } from './chat-policy-rate-limit'
import { validateChatMessages, validateChatRequestBody } from './chat-policy-request'
import { knowledgeOrSituation, outOfScopeResult, smallTalkResult } from './chat-policy-fallbacks'
import { callProvider, providerFollowUps } from './chat-policy-provider'

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
): Promise<ChatResult & { streamed?: boolean }> {
  validateChatRequestBody({ messages })
  const history = validateChatMessages(messages, settings)
  const retryAfter = await chargeChatRateLimit(event, settings)
  if (retryAfter) return { answer: CHAT_RATE_LIMITED_MESSAGE, sources: [], kind: 'rate_limited', retryAfter }

  const query = chatTurnText(history[history.length - 1])
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

  if (references.length === 0) {
    const smallTalk = await smallTalkResult(settings, dependencies, query, history)
    if (smallTalk) return smallTalk
    if (settings.outOfScopeBehavior === 'ai_freeform' && aiProviderReady(settings)) {
      const quotaRetryAfter = await enforceAiQuota(event, sessionId)
      if (quotaRetryAfter) return { answer: AI_QUOTA_MESSAGE, sources: [], kind: 'rate_limited', retryAfter: quotaRetryAfter }
      try {
        const freeform = await callProvider(settings, dependencies, [], history, onChunk, onToolCall)
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
    const grounded = await callProvider(settings, dependencies, references, history, onChunk, onToolCall)
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
