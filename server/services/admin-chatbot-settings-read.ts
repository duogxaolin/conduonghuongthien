/**
 * The AI overlay of the chatbot settings page (`GET /api/admin/chatbot/settings`) — its two reads
 * of the AI gateway tables, moved out of the handler verbatim (2026-11-08: no `server/api` file
 * calls getDb() itself). Reading `chatbot_settings` (`getChatbotSettings`, which creates the row
 * with its defaults on the first read), overlaying the fields, serialising them (no key material
 * leaves the server — `serializeChatbotSettings`) and the response stay in the handler.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { aiServiceConfigs, aiProviders } from '../db/schema'

/** The `chatbot` row of `ai_service_configs`, if any. */
export async function findChatbotServiceConfig() {
  const db = getDb()
  const [chatbotConfig] = await db.select().from(aiServiceConfigs)
    .where(eq(aiServiceConfigs.serviceKey, 'chatbot')).limit(1)
  return chatbotConfig
}

/** The `ai_providers` row named `provider`, if any (whole row: the handler overlays its key envelope). */
export async function findChatbotProviderRow(provider: string) {
  const db = getDb()
  const [providerRow] = await db.select().from(aiProviders)
    .where(eq(aiProviders.provider, provider)).limit(1)
  return providerRow
}
