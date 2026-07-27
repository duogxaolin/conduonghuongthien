import { validateChatbotEncryptionSecret } from './crypto'

export type ChatbotStartupEnvironment = Readonly<{
  NODE_ENV?: string | undefined
  CHATBOT_ENCRYPTION_SECRET?: string | undefined
  // Callers pass process.env, whose index signature admits any other key; a
  // closed shape would reject it outright under exactOptionalPropertyTypes.
  [key: string]: string | undefined
}>

/** Validate the server-only credential key before production accepts traffic. */
export function validateChatbotStartupEnvironment(environment: ChatbotStartupEnvironment = process.env): boolean {
  return validateChatbotEncryptionSecret({
    secret: environment.CHATBOT_ENCRYPTION_SECRET ?? '',
    production: environment.NODE_ENV === 'production',
  })
}
