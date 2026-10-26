/**
 * Các câu trả lời KHÔNG qua AI: câu của kho đã duyệt, câu kể hoàn cảnh (small-talk
 * hỗ trợ), small-talk thường nhật, và lời mời để lại liên hệ khi ngoài phạm vi. Tách
 * nguyên văn từ `server/utils/chatbot/chat-policy.ts` (wave3 D-SPLIT).
 */
import type { ChatbotSettings } from '../db/schema'
import type { PublicKnowledgeReference } from '../utils/chatbot/retrieval'
import { selectSmallTalk } from '../utils/chatbot/small-talk-semantic'
import { classifySmallTalk, isSituationStatement, matchSituationStatement, type SmallTalkContext, type SmallTalkEntry } from '../utils/chatbot/small-talk'
import { logWarn } from '../utils/logger'
import { FOLLOW_UP_LIMIT, selectFollowUps } from '../utils/chatbot/follow-ups'
import { chatTurnText } from '../utils/chatbot/chat-turns'
import { HOTLINE, type ChatDependencies, type ChatMessage, type ChatResult } from './chat-policy-contract'

export function approvedFallback(references: PublicKnowledgeReference[]): ChatResult {
  if (references[0]) return { answer: references[0].answer, sources: references[0].source ? references.slice(0, 1) : [], kind: 'curated' }
  return { answer: `Hiện chưa có thông tin phù hợp trong kho dữ liệu đã được phê duyệt. Vui lòng liên hệ đường dây nóng ${HOTLINE} hoặc Công an xã/phường gần nhất để được hướng dẫn.`, sources: [], kind: 'not_found' }
}

function friendlyKnowledgeAnswer(settings: ChatbotSettings, references: PublicKnowledgeReference[]): ChatResult {
  const top = references[0]!
  const greeting = settings.knowledgeGreeting?.trim()
  const answer = greeting ? `${greeting}\n\n${top.answer}` : top.answer
  // The other approved rows that matched are the natural next questions: each one
  // is a question the bank answers word for word.
  const followUps = selectFollowUps({
    proposals: [],
    entries: [],
    userQuery: top.question,
    fallback: references.slice(1, 1 + FOLLOW_UP_LIMIT).map(ref => ({ id: ref.id, question: ref.question })),
  })
  return { answer, sources: top.source ? references.slice(0, 1) : [], kind: 'curated', followUps }
}

/**
 * Select an answer from the DB-backed everyday-reply store. Context is derived
 * server-side from only the immediately preceding validated user turn. It is a
 * disambiguation hint after a current-turn match, never a matching bypass.
 */
async function smallTalkResult(settings: ChatbotSettings, dependencies: ChatDependencies, query: string, history: ChatMessage[], options: { statementOnly?: boolean } = {}): Promise<ChatResult | null> {
  if ((settings.smallTalkEnabled ?? true) === false) return null
  let entries: SmallTalkEntry[]
  try {
    entries = await dependencies.loadSmallTalkEntries()
  } catch (error) {
    logWarn({
      event: 'chatbot.small_talk_load_failed',
      error,
      consequence: 'small-talk unavailable for this request',
    })
    return null
  }
  const previous = history.length > 1
    ? chatTurnText(history[history.length - 2])
    : ''
  const previousMatch = previous ? classifySmallTalk(entries, previous) : null
  const context: SmallTalkContext = previousMatch ? { previousIntent: previousMatch.intent } : {}
  const statementOnly = options.statementOnly === true
  const selection = await selectSmallTalk({
    businessReferences: [],
    entries,
    query,
    ruleMatcher: statementOnly
      ? (candidateEntries, value) => matchSituationStatement(candidateEntries, value)
      : (candidateEntries, value) => classifySmallTalk(candidateEntries, value, context),
    // Chế độ câu kể chỉ dùng luật tất định; không bao giờ để ngữ nghĩa chen vào trước câu trả lời của kho.
    semanticProvider: statementOnly ? null : dependencies.semanticSmallTalkProvider,
    semanticConfig: dependencies.semanticSmallTalkConfig,
  })
  if (!selection) return null

  // The selector returns only a trusted ID/metadata tuple. Resolve the answer
  // from the original DB row so a semantic provider can never supply content.
  const matchedEntry = entries.find(entry => entry.id === selection.entryId)
  if (!matchedEntry) return null
  const greeting = settings.knowledgeGreeting?.trim()
  const answer = greeting && matchedEntry.category !== 'social' ? `${greeting}\n\n${matchedEntry.answer}` : matchedEntry.answer
  return { answer, sources: [], kind: 'small_talk' }
}

/**
 * Đường KHÔNG có câu trả lời của AI mà kho có tham chiếu khớp: trả câu của kho — trừ khi người dùng chỉ KỂ
 * hoàn cảnh ("tôi vừa đi tù về"). Khi đó trả hàng hỗ trợ (lời khuyên việc đầu tiên) thay vì định nghĩa khớp từ khoá.
 * Câu hỏi thật vẫn luôn nhận câu trả lời của kho (xem `matchSituationStatement`).
 */
async function knowledgeOrSituation(
  settings: ChatbotSettings,
  dependencies: ChatDependencies,
  query: string,
  history: ChatMessage[],
  references: PublicKnowledgeReference[],
): Promise<ChatResult> {
  // Kiểm thuần, không chạm DB: câu hỏi/nghiệp vụ không bao giờ nạp kho small-talk ("kho luôn thắng").
  if (!isSituationStatement(query)) return friendlyKnowledgeAnswer(settings, references)
  const situation = await smallTalkResult(settings, dependencies, query, history, { statementOnly: true })
  return situation ?? friendlyKnowledgeAnswer(settings, references)
}

function outOfScopeResult(settings: ChatbotSettings): ChatResult {
  const base = settings.fallbackMessage?.trim() || 'Xin lỗi, hiện tôi chưa tìm thấy thông tin phù hợp trong kho dữ liệu đã được phê duyệt.'
  if (settings.leadCaptureEnabled ?? true) {
    return { answer: `${base}\n\nAnh/chị vui lòng để lại thông tin liên hệ bên dưới, cán bộ sẽ phản hồi trong thời gian sớm nhất ạ. Hoặc gọi hotline ${HOTLINE}.`, sources: [], kind: 'not_found', askContact: true }
  }
  return { answer: `${base} Vui lòng liên hệ đường dây nóng ${HOTLINE} hoặc Công an xã/phường gần nhất để được hướng dẫn.`, sources: [], kind: 'not_found' }
}

/** Dùng bởi `chat-policy-answer.ts`; barrel chỉ xuất lại `approvedFallback`. */
export { smallTalkResult, knowledgeOrSituation, outOfScopeResult }
