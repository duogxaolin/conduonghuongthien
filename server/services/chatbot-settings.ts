import { eq } from 'drizzle-orm'
import { activityLogs, chatbotSettings, type ChatbotSettings } from '../db/schema'
import { getDb } from '../utils/db'
import { buildChatbotSettingsAudit } from '../utils/chatbot/audit'
import { decryptChatbotSecret } from '../utils/chatbot/crypto'
import { buildChatbotApiKeyClearPatch, buildChatbotSettingsPatch, CHATBOT_SETTINGS_ID, CHATBOT_DEFAULTS, validateChatbotSettingsUpdate, type ChatbotSettingsUpdate } from '../utils/chatbot/settings'
import { serializeChatbotSettings } from '../utils/chatbot/serializers'

export async function getChatbotSettings(): Promise<ChatbotSettings> {
  const db = getDb()
  const [row] = await db.select().from(chatbotSettings).where(eq(chatbotSettings.id, CHATBOT_SETTINGS_ID)).limit(1)
  if (row) return row
  await db.insert(chatbotSettings).values({ id: CHATBOT_SETTINGS_ID, ...CHATBOT_DEFAULTS })
  const [created] = await db.select().from(chatbotSettings).where(eq(chatbotSettings.id, CHATBOT_SETTINGS_ID)).limit(1)
  if (!created) throw new Error('Chatbot settings unavailable')
  return created
}

export function publicChatbotSettings(settings: ChatbotSettings) { return serializeChatbotSettings(settings) }

function auditRequestId(event?: { context?: { requestId?: unknown } }): unknown { return event?.context?.requestId }

export async function updateChatbotSettings(actorId: number, input: ChatbotSettingsUpdate, requestId?: unknown) {
  validateChatbotSettingsUpdate(input)
  const db = getDb(); const current = await getChatbotSettings()
  validateChatbotSettingsUpdate({ ...input, baseUrl: input.baseUrl === undefined ? current.baseUrl : input.baseUrl, allowedHosts: input.allowedHosts === undefined ? current.allowedHosts : input.allowedHosts })
  const patch = buildChatbotSettingsPatch(input, process.env.CHATBOT_ENCRYPTION_SECRET)
  if (Object.keys(patch).length === 0) return current
  patch.updatedBy = actorId
  await db.update(chatbotSettings).set(patch).where(eq(chatbotSettings.id, CHATBOT_SETTINGS_ID))
  await db.insert(activityLogs).values(buildChatbotSettingsAudit({ actorId, operation: input.apiKey !== undefined ? 'rotate_key' : 'update', changedFields: Object.keys(input), configured: input.apiKey !== undefined, outcome: 'success', requestId }))
  return getChatbotSettings()
}

export async function clearChatbotApiKey(actorId: number, requestId?: unknown) {
  const db = getDb(); const current = await getChatbotSettings()
  await db.update(chatbotSettings).set({ ...buildChatbotApiKeyClearPatch(), updatedBy: actorId }).where(eq(chatbotSettings.id, CHATBOT_SETTINGS_ID))
  await db.insert(activityLogs).values(buildChatbotSettingsAudit({ actorId, operation: 'clear_key', configured: false, outcome: 'success', requestId }))
  return current
}

export function configuredChatbotSecret(settings: ChatbotSettings, secret = process.env.CHATBOT_ENCRYPTION_SECRET): string | null {
  if (!settings.apiKeyCiphertext || !settings.apiKeyNonce || !settings.apiKeyAuthTag || !settings.apiKeyVersion || !settings.apiKeyKeyId) return null
  try { return decryptChatbotSecret({ ciphertext: settings.apiKeyCiphertext, nonce: settings.apiKeyNonce, authTag: settings.apiKeyAuthTag, version: settings.apiKeyVersion, keyId: settings.apiKeyKeyId, lastFour: settings.apiKeyLastFour || '' }, secret) } catch { return null }
}

export { auditRequestId }
