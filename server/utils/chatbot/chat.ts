import { eq } from 'drizzle-orm'
import { chatbotKnowledge, chatbotKnowledgeTerms, type ChatbotSettings } from '../../db/schema'
import { getDb } from '../db'
import { configuredChatbotSecret } from '../../services/chatbot-settings'
import type { RetrievalEntry } from './retrieval'
import { safeProviderRequest } from './outbound'
import { answerGroundedChat } from './chat-policy'

async function publishedEntries(): Promise<RetrievalEntry[]> {
  const db = getDb()
  const entries = await db.select().from(chatbotKnowledge).where(eq(chatbotKnowledge.status, 'published'))
  return Promise.all(entries.map(async entry => ({ ...entry, terms: await db.select({ kind: chatbotKnowledgeTerms.kind, value: chatbotKnowledgeTerms.value, normalizedValue: chatbotKnowledgeTerms.normalizedValue }).from(chatbotKnowledgeTerms).where(eq(chatbotKnowledgeTerms.knowledgeId, entry.id)) })))
}

export async function answerChat(event: Parameters<typeof answerGroundedChat>[0], settings: ChatbotSettings, messages: unknown) {
  return answerGroundedChat(event, settings, messages, {
    loadPublishedEntries: publishedEntries,
    configuredSecret: configuredChatbotSecret,
    providerRequest: safeProviderRequest,
  })
}
