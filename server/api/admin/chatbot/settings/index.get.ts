import { requireChatbotSettingsPermission } from '../../../../utils/permissions'
import { getChatbotSettings, publicChatbotSettings } from '../../../../services/chatbot-settings'

export default defineEventHandler(async (event) => {
  requireChatbotSettingsPermission(event, 'read')
  return { ok: true, settings: publicChatbotSettings(await getChatbotSettings()) }
})
