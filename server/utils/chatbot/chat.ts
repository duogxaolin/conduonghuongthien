import { eq, inArray, asc } from 'drizzle-orm'
import { chatbotKnowledge, chatbotKnowledgeTerms, chatbotSmallTalk, type ChatbotSettings } from '../../db/schema'
import { getDb } from '../db'
import { configuredChatbotSecret } from '../../services/chatbot-settings'
import type { RetrievalEntry } from './retrieval'
import type { SmallTalkEntry } from './small-talk'
import { safeProviderRequest } from './outbound'
import { answerGroundedChat } from './chat-policy'

/**
 * Load every published knowledge entry together with its alias/keyword terms.
 *
 * Terms are fetched in ONE query and grouped in memory. The previous version
 * issued a separate query per entry (an N+1), so a bank of 200 published
 * questions cost 201 round-trips on every single chat message.
 */
async function publishedEntries(): Promise<RetrievalEntry[]> {
  const db = getDb()
  const entries = await db.select().from(chatbotKnowledge).where(eq(chatbotKnowledge.status, 'published'))
  if (entries.length === 0) return []

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

  return entries.map(entry => ({ ...entry, terms: termsByKnowledge.get(entry.id) || [] }))
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
  return rows.map(row => ({ ...row, patterns: row.patterns ?? [] }))
}

export async function answerChat(event: Parameters<typeof answerGroundedChat>[0], settings: ChatbotSettings, messages: unknown) {
  return answerGroundedChat(event, settings, messages, {
    loadPublishedEntries: publishedEntries,
    loadSmallTalkEntries,
    configuredSecret: configuredChatbotSecret,
    providerRequest: safeProviderRequest,
  })
}
