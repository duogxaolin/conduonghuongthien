import { validateChatbotEncryptionSecret } from './crypto'

export type ChatbotStartupEnvironment = Readonly<{
  NODE_ENV?: string
  CHATBOT_ENCRYPTION_SECRET?: string
}>

/** Validate the server-only credential key before production accepts traffic. */
export function validateChatbotStartupEnvironment(environment: ChatbotStartupEnvironment = process.env): boolean {
  return validateChatbotEncryptionSecret({
    secret: environment.CHATBOT_ENCRYPTION_SECRET ?? '',
    production: environment.NODE_ENV === 'production',
  })
}
