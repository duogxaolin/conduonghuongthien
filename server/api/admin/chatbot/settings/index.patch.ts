import { ChatbotSettingsValidationError, type ChatbotSettingsUpdate } from '../../../../utils/chatbot/settings'
import { requireChatbotSettingsPermission } from '../../../../utils/permissions'
import { publicChatbotSettings, updateChatbotSettings } from '../../../../services/chatbot-settings'

const FIELDS = new Set(['enabled', 'providerPolicy', 'baseUrl', 'model', 'systemPrompt', 'allowedHosts', 'mode', 'outOfScopeBehavior', 'knowledgeGreeting', 'fallbackMessage', 'leadCaptureEnabled', 'leadCaptureEmail', 'requestTimeoutMs', 'maxResponseBytes', 'maxInputChars', 'maxHistoryMessages', 'retrievalTopK', 'referenceCharBudget', 'rateLimitRequests', 'rateLimitWindowSeconds', 'apiKey'])

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !FIELDS.has(key))) throw createError({ statusCode: 400, statusMessage: 'Invalid settings payload' })
  const user = requireChatbotSettingsPermission(event, 'apiKey' in body ? 'rotate_key' : 'update')
  try {
    const settings = await updateChatbotSettings(user.id, body as ChatbotSettingsUpdate, event.context.requestId)
    return { ok: true, settings: publicChatbotSettings(settings) }
  } catch (error) {
    if (error instanceof ChatbotSettingsValidationError) throw createError({ statusCode: 400, statusMessage: error.message })
    throw error
  }
})
