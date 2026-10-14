import { ChatbotSettingsValidationError, type ChatbotSettingsUpdate } from '../../../../utils/chatbot/settings'
import { requireChatbotSettingsPermission } from '../../../../utils/permissions'
import { ChatbotDestinationChangeForbiddenError, publicChatbotSettings, updateChatbotSettings } from '../../../../services/chatbot-settings'

const FIELDS = new Set(['enabled', 'providerPolicy', 'provider', 'baseUrl', 'model', 'systemPrompt', 'allowedHosts', 'mode', 'outOfScopeBehavior', 'knowledgeGreeting', 'fallbackMessage', 'leadCaptureEnabled', 'smallTalkEnabled', 'leadCaptureEmail', 'requestTimeoutMs', 'maxResponseBytes', 'maxInputChars', 'maxHistoryMessages', 'retrievalTopK', 'referenceCharBudget', 'rateLimitRequests', 'rateLimitWindowSeconds', 'apiKey'])

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !FIELDS.has(key))) throw createError({ statusCode: 400, statusMessage: 'Invalid settings payload' })
  const user = requireChatbotSettingsPermission(event, 'apiKey' in body ? 'rotate_key' : 'update')
  try {
    // Đổi đích gọi (baseUrl/allowedHosts) đòi siêu quản trị như xoay khoá — service
    // so với giá trị đang lưu và từ chối nếu thực sự đổi.
    const settings = await updateChatbotSettings(user.id, body as ChatbotSettingsUpdate, event.context.requestId, { mayChangeDestination: user.isSuperAdmin === true })
    return { ok: true, settings: publicChatbotSettings(settings) }
  } catch (error) {
    if (error instanceof ChatbotSettingsValidationError) throw createError({ statusCode: 400, statusMessage: error.message })
    if (error instanceof ChatbotDestinationChangeForbiddenError) throw createError({ statusCode: 403, statusMessage: error.message })
    throw error
  }
})
