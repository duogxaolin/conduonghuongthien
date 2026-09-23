import { eq } from 'drizzle-orm'
import { requireChatbotSettingsPermission } from '../../../../utils/permissions'
import { getChatbotSettings } from '../../../../services/chatbot-settings'
import { getDb } from '../../../../utils/db'
import { aiServiceConfigs, aiProviders } from '../../../../db/schema'
import { serializeChatbotSettings } from '../../../../utils/chatbot/serializers'

/**
 * Chatbot settings — spec R11.4 backward compatibility.
 *
 * Non-AI fields (mode, knowledge_greeting, small_talk, rate limits, etc.) are
 * read from `chatbot_settings` as before. AI-related fields (systemPrompt,
 * model, provider, baseUrl, hasApiKey) are overlaid from the new
 * `ai_service_configs` + `ai_providers` tables when the chatbot service config
 * exists and is active. This lets the existing settings page work while the
 * underlying call path routes through the AI gateway.
 */
export default defineEventHandler(async (event) => {
  requireChatbotSettingsPermission(event, 'read')
  const settings = await getChatbotSettings()

  // Overlay AI fields from new tables (spec R11.4)
  const db = getDb()
  const [chatbotConfig] = await db.select().from(aiServiceConfigs)
    .where(eq(aiServiceConfigs.serviceKey, 'chatbot')).limit(1)

  if (chatbotConfig) {
    const [providerRow] = await db.select().from(aiProviders)
      .where(eq(aiProviders.provider, chatbotConfig.provider)).limit(1)

    if (providerRow) {
      // Overlay new AI config onto the settings object
      settings.model = chatbotConfig.model ?? settings.model
      settings.systemPrompt = chatbotConfig.systemPrompt ?? settings.systemPrompt
      settings.providerPolicy = chatbotConfig.provider === 'anthropic' ? 'anthropic' : 'openai-compatible'
      settings.baseUrl = providerRow.baseUrl ?? settings.baseUrl
      settings.enabled = chatbotConfig.isActive && providerRow.isActive
      settings.apiKeyCiphertext = providerRow.apiKeyCiphertext ?? settings.apiKeyCiphertext
      settings.apiKeyNonce = providerRow.apiKeyNonce ?? settings.apiKeyNonce
      settings.apiKeyAuthTag = providerRow.apiKeyAuthTag ?? settings.apiKeyAuthTag
      settings.apiKeyVersion = providerRow.apiKeyVersion ?? settings.apiKeyVersion
      settings.apiKeyKeyId = providerRow.apiKeyKeyId ?? settings.apiKeyKeyId
      settings.apiKeyLastFour = providerRow.apiKeyLastFour ?? settings.apiKeyLastFour
      settings.allowedHosts = providerRow.baseUrl ? [new URL(providerRow.baseUrl).hostname] : settings.allowedHosts
    }
  }

  return {
    ok: true,
    settings: serializeChatbotSettings(settings),
    currentSystemPrompt: chatbotConfig?.systemPrompt ?? settings.systemPrompt ?? '',
    currentProvider: chatbotConfig?.provider ?? 'delify',
    currentModel: chatbotConfig?.model ?? settings.model ?? 'delify-5.5',
  }
})
