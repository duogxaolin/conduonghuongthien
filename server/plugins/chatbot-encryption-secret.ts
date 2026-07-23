import { validateChatbotStartupEnvironment } from '../utils/chatbot/startup'

export default defineNitroPlugin(() => {
  validateChatbotStartupEnvironment()
})
