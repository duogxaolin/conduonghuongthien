import { requireChatbotSettingsPermission } from '../../../../utils/permissions'
import { clearChatbotApiKey, getChatbotSettings, publicChatbotSettings } from '../../../../services/chatbot-settings'

export default defineEventHandler(async (event) => {
  const user = requireChatbotSettingsPermission(event, 'clear')
  await clearChatbotApiKey(user.id, event.context.requestId)
  return { ok: true, settings: publicChatbotSettings(await getChatbotSettings()) }
})
