import { eq, inArray, asc } from 'drizzle-orm'
import { chatbotKnowledge, chatbotKnowledgeTerms, chatbotSmallTalk, type ChatbotSettings } from '../../db/schema'
import { getDb } from '../db'
import { configuredChatbotSecret } from '../../services/chatbot-settings'
import type { RetrievalEntry } from './retrieval'
import type { SmallTalkEntry } from './small-talk'
import { safeProviderRequest } from './outbound'
import { answerGroundedChat } from './chat-policy'
import {
  getSmallTalkSemanticProvider,
  installSmallTalkSemanticProvider,
  projectSemanticEntry,
  readSmallTalkSemanticConfig,
} from './small-talk-semantic'
import { SMALL_TALK_TRIGRAM_DEFAULTS, createTrigramRanker } from './small-talk-semantic-trigram'

let publishedCache: { data: RetrievalEntry[]; at: number } | null = null
const PUBLISHED_TTL_MS = 60_000

/**
 * Load every published knowledge entry together with its alias/keyword terms.
 *
 * Terms are fetched in ONE query and grouped in memory. The previous version
 * issued a separate query per entry (an N+1), so a bank of 200 published
 * questions cost 201 round-trips on every single chat message.
 * Result is cached 60s — a chat burst would otherwise full-scan both tables
 * on every message even though the knowledge bank rarely changes.
 */
async function publishedEntries(): Promise<RetrievalEntry[]> {
  if (publishedCache && Date.now() - publishedCache.at < PUBLISHED_TTL_MS) return publishedCache.data
  const db = getDb()
  const entries = await db.select().from(chatbotKnowledge).where(eq(chatbotKnowledge.status, 'published'))
  if (entries.length === 0) {
    publishedCache = { data: [], at: Date.now() }
    return []
  }

  const termRows = await db
    .select({
      knowledgeId: chatbotKnowledgeTerms.knowledgeId,
      kind: chatbotKnowledgeTerms.kind,
      value: chatbotKnowledgeTerms.value,
      normalizedValue: chatbotKnowledgeTerms.normalizedValue,
    })
    .from(chatbotKnowledgeTerms)
    .where(inArray(chatbotKnowledgeTerms.knowledgeId, entries.map(entry => entry.id)))

  const termsByKnowledge = new Map<number, { kind: typeof termRows[number]['kind']; value: string; normalizedValue: string }[]>()
  for (const row of termRows) {
    const list = termsByKnowledge.get(row.knowledgeId)
    const term = { kind: row.kind, value: row.value, normalizedValue: row.normalizedValue }
    if (list) list.push(term)
    else termsByKnowledge.set(row.knowledgeId, [term])
  }

  const data = entries.map(entry => ({ ...entry, terms: termsByKnowledge.get(entry.id) || [] }))
  publishedCache = { data, at: Date.now() }
  return data
}

/**
 * Load the enabled everyday-reply rows for the small-talk matcher, projecting
 * only the columns matching/answering needs. Called lazily by the policy — only
 * when the approved bank matched nothing and the global switch is on — so a
 * message the knowledge bank can answer never touches this table.
 */
async function loadSmallTalkEntries(): Promise<SmallTalkEntry[]> {
  const db = getDb()
  const rows = await db
    .select({
      id: chatbotSmallTalk.id,
      category: chatbotSmallTalk.category,
      answer: chatbotSmallTalk.answer,
      patterns: chatbotSmallTalk.patterns,
      normalizedQuestion: chatbotSmallTalk.normalizedQuestion,
      isEnabled: chatbotSmallTalk.isEnabled,
      displayOrder: chatbotSmallTalk.displayOrder,
    })
    .from(chatbotSmallTalk)
    .where(eq(chatbotSmallTalk.isEnabled, true))
    .orderBy(asc(chatbotSmallTalk.displayOrder), asc(chatbotSmallTalk.id))
  const entries = rows.map(row => ({ ...row, patterns: row.patterns ?? [] }))
  // Cùng chuyến đi này cũng làm mới chỉ mục trigram (khi bật) — nếu tách thành một
  // truy vấn riêng thì mỗi câu chào hỏi tốn thêm một lượt đọc bảng vô ích.
  installTrigramRanker(entries)
  return entries
}

type ToolCallEvent = { name: string; query?: string; status: 'calling' | 'done'; count?: number }

/**
 * Mục đã chiếu để dựng ranker trigram, và dấu vân của chính danh sách đó.
 *
 * Ranker là chỉ mục trong bộ nhớ, nên ai đó phải dựng lại nó khi quản trị viên thêm /
 * sửa / xoá một mục small-talk. Dấu vân dưới đây là `id + normalizedQuestion` của mọi
 * mục đang bật: đổi câu hỏi chuẩn của một mục (thứ quyết định cả patterns lẫn ví dụ
 * ngữ nghĩa), bật/tắt hay thêm/xoá mục đều làm nó đổi. Sửa CÂU TRẢ LỜI thì không — đúng
 * ý: ranker không đọc `answer`.
 */
let trigramIndexFingerprint: string | null = null
function installTrigramRanker(entries: readonly SmallTalkEntry[]): void {
  // Không kiểm công tắc ở đây: chỉ mục dựng rẻ (0,49 ms cho 122 mục) và chỉ khi kho
  // small-talk đã phải nạp, còn việc CÓ DÙNG nó hay không do `selectSmallTalk` quyết
  // định qua `config.enabled`. Kiểm ở đây sẽ cần một biến toàn cục đọc settings của
  // lượt gọi — trạng thái dùng chung giữa các request, không đáng.
  const projected = entries.map(entry => projectSemanticEntry(entry))
  const fingerprint = projected.map(entry => `${entry.id}:${entry.semanticExamples[0] ?? ''}`).join('|')
  if (fingerprint === trigramIndexFingerprint) return
  installSmallTalkSemanticProvider(createTrigramRanker(projected))
  trigramIndexFingerprint = fingerprint
}

export async function answerChat(
  event: Parameters<typeof answerGroundedChat>[0],
  settings: ChatbotSettings,
  messages: unknown,
  onChunk?: (chunk: string) => void | Promise<void>,
  onToolEvent?: (evt: ToolCallEvent) => void | Promise<void>,
  onReplace?: (answer: string) => void | Promise<void>,
) {
  return answerGroundedChat(event, settings, messages, {
    loadPublishedEntries: publishedEntries,
    loadSmallTalkEntries,
    configuredSecret: configuredChatbotSecret,
    providerRequest: safeProviderRequest,
    semanticSmallTalkProvider: getSmallTalkSemanticProvider(),
    // Ngưỡng mặc định đi kèm ranker, không phải của khung: 0.82 dành cho một ranker ngữ
    // nghĩa thật, trigram đo được ở 0.65 (xem `small-talk-semantic-trigram.ts`). Biến môi
    // trường vẫn ghi đè được — đó là lý do hai thứ này tách nhau.
    semanticSmallTalkConfig: readSmallTalkSemanticConfig(process.env, settings),
    semanticSmallTalkDefaults: {
      confidenceThreshold: SMALL_TALK_TRIGRAM_DEFAULTS.confidenceThreshold,
      top1Top2Margin: SMALL_TALK_TRIGRAM_DEFAULTS.top1Top2Margin,
      timeoutMs: SMALL_TALK_TRIGRAM_DEFAULTS.timeoutMs,
    },
  }, onChunk, onToolEvent, onReplace)
}
