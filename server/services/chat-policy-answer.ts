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
import {
  answerCacheKey,
  discardCachedAnswer,
  readCachedAnswer,
  writeCachedAnswer,
  type CachedAnswer,
} from './chatbot-answer-cache'
import { callProvider, providerFollowUps } from './chat-policy-provider'
import { toCitationReferences } from '../utils/chatbot/serializers'

type ProviderReply = NonNullable<Awaited<ReturnType<typeof callProvider>>>

function aiProviderReady(settings: ChatbotSettings): boolean {
  return Boolean(settings.enabled && settings.baseUrl && settings.model && settings.allowedHosts?.length)
}

/**
 * Câu trả lời lấy từ cache qua lại lớp chặn đầu ra của chủ quyền — đúng bộ máy mà câu trả lời
 * trực tiếp đi qua, chạy trên cả câu (một chunk, rồi bước kiểm cuối). Cache phát lại không gọi
 * model, nên không có lớp này thì: (a) mỗi lần nâng bộ khớp không áp cho hàng đã cache (tới 30
 * ngày), (b) một lần lọt hiếm hoi thành câu phát lại y nguyên cho MỌI người hỏi cùng câu.
 */
async function cachedAnswerBreaksStance(answer: string, question: string): Promise<boolean> {
  const guard = createSovereigntyOutputGuard({ forward: () => undefined, replace: () => undefined, question })
  await guard.push?.(answer)
  return guard.finish(answer)
}

export async function answerGroundedChat(
  event: ChatEvent,
  settings: ChatbotSettings,
  messages: unknown,
  givenDependencies: ChatDependencies,
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

  /**
   * Cache câu trả lời — tra trước khi chạm model, sau rate limit và sau kiểm chủ quyền.
   *
   * Thứ tự này là bắt buộc, không phải tuỳ ý:
   *   - SAU rate limit: một câu lặp lại vẫn phải qua giới hạn tần suất, nếu không nó thành
   *     đường vòng miễn phí.
   *   - SAU kiểm chủ quyền: câu chạm chủ quyền biển đảo có lập trường viết sẵn, không qua
   *     model, và không bao giờ được phát lại từ cache của bản khác.
   *   - `answerCacheKey` tự trả `null` cho lượt có lịch sử nhiều hơn một câu, vì câu trả
   *     lời khi đó phụ thuộc ngữ cảnh.
   *   - Phiên bản lấy từ CHÍNH hàng `chatbot_settings` mà endpoint đã đọc (`settings`), không đọc lại:
   *     cấu hình (cả phần không nằm trong khoá: topK, ngân sách tham chiếu, câu lùi) và phiên bản khi đó
   *     là một ảnh chụp. Đọc phiên bản riêng, sau đó, thì một lần PATCH xen giữa sẽ ghi câu dựng từ
   *     cấu hình cũ dưới khoá còn sống (verifier 2026-11-06). Không có phiên bản ⇒ không tra, không ghi:
   *     lùi về một số mặc định sẽ trùng khoá của dữ liệu cũ.
   *   - Câu lấy ra vẫn qua lớp chặn chủ quyền (`cachedAnswerBreaksStance`); bị bắt thì hàng bị
   *     bỏ và khách nhận lập trường chính thức, như khi lớp chặn bắt câu trả lời trực tiếp.
   */
  const dataVersion = typeof settings.answerCacheVersion === 'number' && Number.isSafeInteger(settings.answerCacheVersion)
    ? settings.answerCacheVersion
    : null
  // MỌI lượt tra kho trong lượt hỏi này (truy xuất, câu hỏi gợi ý, công cụ search_c11_knowledge) dùng cùng
  // phiên bản: một lượt tra không kèm phiên bản sẽ nhận bất kỳ bản nào còn tươi — kể cả bản cũ mà một lượt
  // hỏi chậm vừa ghi đè lên — rồi câu trả lời dựng từ đó được ghi dưới khoá của phiên bản này.
  const dependencies: ChatDependencies = dataVersion === null
    ? givenDependencies
    : { ...givenDependencies, loadPublishedEntries: () => givenDependencies.loadPublishedEntries(dataVersion) }
  const cacheKey = dataVersion === null
    ? null
    : answerCacheKey({ question: query, settings, version: dataVersion, historyLength: history.length })
  if (cacheKey) {
    const cached = await readCachedAnswer(cacheKey).catch((): CachedAnswer | null => null)
    if (cached && await cachedAnswerBreaksStance(cached.answer, query)) {
      logWarn({ event: 'chatbot.sovereignty_cached_answer_replaced', consequence: 'cached answer withheld and discarded, fixed official answer sent instead' })
      await discardCachedAnswer(cacheKey).catch(() => false)
      return { answer: sovereigntyAnswer(query), sources: [], kind: 'curated' }
    }
    if (cached) {
      logInfo({ event: 'chatbot.answer_cache_hit', consequence: 'provider not called, answer replayed' })
      return {
        answer: cached.answer,
        sources: cached.sources,
        kind: cached.kind as ChatResult['kind'],
        // Như câu hỏi gợi ý của lượt trực tiếp (lọc ở `askProvider`); hàng sửa tay chưa từng qua bộ lọc đó.
        followUps: cached.followUps.filter(followUp => !mentionsSovereignty(followUp, { output: true })),
        streamed: Boolean(onChunk),
      }
    }
  }

  let references: PublicKnowledgeReference[]
  try {
    // Bản kho trong bộ nhớ phải thuộc ĐÚNG phiên bản đã dùng cho khoá — nếu không, câu trả lời từ kho cũ
    // được ghi dưới khoá của phiên bản mới (xem `publishedEntries`).
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
          const followUps = await providerFollowUps(dependencies, query, freeform, [])
          if (cacheKey) {
            await writeCachedAnswer({ key: cacheKey, question: query, answer: freeform.text, sources: [], followUps, kind: 'provider' }).catch(() => false)
          }
          return {
            answer: freeform.text,
            sources: [],
            toolCalls: freeform.toolCalls,
            kind: 'provider',
            followUps,
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
      //
      // "Nguồn tham khảo" chỉ liệt kê trích dẫn kho kiến thức (chatbot_knowledge).
      // Bài viết / ảnh / video (kind: 'evidence') đã nằm trong thân câu trả lời do
      // model dệt từ kết quả công cụ — liệt kê lại ở đây là trùng lặp.
      // Trích dẫn đưa vào KẾT QUẢ và vào cache dưới dạng RÚT GỌN (id + nhãn nguồn), không
      // kèm toàn văn `answer`: client chỉ vẽ danh sách, và toàn văn được tải khi khách
      // bấm "Xem". Giữ toàn văn ở đây thì mỗi câu trả lời (kể cả bản phát lại từ cache)
      // mang thêm ~5 KB điều luật mà không ai đọc tới.
      const sources = toCitationReferences(references.filter(ref => ref.source && ref.kind !== 'evidence'))
      const followUps = await providerFollowUps(dependencies, query, grounded, references)
      if (cacheKey) {
        await writeCachedAnswer({ key: cacheKey, question: query, answer: grounded.text, sources, followUps, kind: 'provider' }).catch(() => false)
      }
      return {
        answer: grounded.text,
        sources,
        toolCalls: grounded.toolCalls,
        kind: 'provider',
        followUps,
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
