import { eq, inArray } from 'drizzle-orm'
import { chatbotKnowledge, chatbotKnowledgeTerms, type ChatbotSettings } from '../../db/schema'
import { getDb } from '../db'
import { configuredChatbotSecret } from '../../services/chatbot-settings'
import type { RetrievalEntry } from './retrieval'
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

export async function answerChat(event: Parameters<typeof answerGroundedChat>[0], settings: ChatbotSettings, messages: unknown) {
  return answerGroundedChat(event, settings, messages, {
    loadPublishedEntries: publishedEntries,
    configuredSecret: configuredChatbotSecret,
    providerRequest: safeProviderRequest,
  })
}
