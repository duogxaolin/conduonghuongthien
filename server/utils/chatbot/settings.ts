import type { ChatbotSettings } from '../../db/schema'
import { encryptChatbotSecret } from './crypto'
import { normalizeProviderUrl } from './outbound'

export const CHATBOT_SETTINGS_ID = 1
export const CHATBOT_DEFAULTS = Object.freeze({
  enabled: false,
  providerPolicy: 'openai-compatible',
  requestTimeoutMs: 10_000,
  maxResponseBytes: 262_144,
  maxInputChars: 2_000,
  maxHistoryMessages: 8,
  retrievalTopK: 3,
  referenceCharBudget: 6_000,
  rateLimitRequests: 10,
  rateLimitWindowSeconds: 60,
})

export type ChatbotSettingsUpdate = Partial<Pick<ChatbotSettings,
  | 'enabled' | 'providerPolicy' | 'baseUrl' | 'model' | 'systemPrompt' | 'allowedHosts'
  | 'requestTimeoutMs' | 'maxResponseBytes' | 'maxInputChars' | 'maxHistoryMessages'
  | 'retrievalTopK' | 'referenceCharBudget' | 'rateLimitRequests' | 'rateLimitWindowSeconds'
>> & { apiKey?: string }

const INTEGER_LIMITS = {
  requestTimeoutMs: [1_000, 30_000],
  maxResponseBytes: [1_024, 1_048_576],
  maxInputChars: [1, 10_000],
  maxHistoryMessages: [0, 20],
  retrievalTopK: [1, 10],
  referenceCharBudget: [500, 20_000],
  rateLimitRequests: [1, 100],
  rateLimitWindowSeconds: [10, 3_600],
} as const

export class ChatbotSettingsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatbotSettingsValidationError'
  }
}

export function validateChatbotSettingsUpdate(input: ChatbotSettingsUpdate): ChatbotSettingsUpdate {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ChatbotSettingsValidationError('Invalid settings payload')
  if ('apiKey' in input && typeof input.apiKey !== 'string') throw new ChatbotSettingsValidationError('API key must be a string')
  if (input.apiKey === '') throw new ChatbotSettingsValidationError('Use the explicit clear operation to remove the API key')
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new ChatbotSettingsValidationError('enabled must be boolean')
  if (input.baseUrl != null && (typeof input.baseUrl !== 'string' || input.baseUrl.length > 1024)) throw new ChatbotSettingsValidationError('Invalid base URL')
  if (input.model != null && (typeof input.model !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.model.trim()))) throw new ChatbotSettingsValidationError('Invalid model')
  if (input.systemPrompt != null && (typeof input.systemPrompt !== 'string' || input.systemPrompt.length > 20_000 || !input.systemPrompt.trim())) throw new ChatbotSettingsValidationError('Invalid system prompt')
  if (input.baseUrl && input.allowedHosts?.length) {
    try { normalizeProviderUrl(input.baseUrl, { allowedHosts: input.allowedHosts }) }
    catch { throw new ChatbotSettingsValidationError('Provider URL is not approved') }
  }
  if (input.providerPolicy != null && (typeof input.providerPolicy !== 'string' || !/^[a-z0-9-]{1,64}$/u.test(input.providerPolicy))) throw new ChatbotSettingsValidationError('Invalid provider policy')
  if (input.allowedHosts != null && (!Array.isArray(input.allowedHosts) || input.allowedHosts.length > 20 || input.allowedHosts.some(host => typeof host !== 'string' || host.length > 253))) throw new ChatbotSettingsValidationError('Invalid allowed host list')

  for (const [field, [minimum, maximum]] of Object.entries(INTEGER_LIMITS)) {
    const value = input[field as keyof ChatbotSettingsUpdate]
    if (value !== undefined && (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum)) {
      throw new ChatbotSettingsValidationError(`${field} must be an integer between ${minimum} and ${maximum}`)
    }
  }
  return input
}

export function buildChatbotSettingsPatch(input: ChatbotSettingsUpdate, secret?: string): Partial<ChatbotSettings> {
  const validated = validateChatbotSettingsUpdate(input)
  const { apiKey, ...ordinary } = validated
  const patch: Partial<ChatbotSettings> = { ...ordinary }
  if (apiKey !== undefined) {
    const encrypted = encryptChatbotSecret(apiKey, secret)
    Object.assign(patch, {
      apiKeyCiphertext: encrypted.ciphertext,
      apiKeyNonce: encrypted.nonce,
      apiKeyAuthTag: encrypted.authTag,
      apiKeyVersion: encrypted.version,
      apiKeyKeyId: encrypted.keyId,
      apiKeyLastFour: encrypted.lastFour,
    })
  }
  return patch
}

export function buildChatbotApiKeyClearPatch(): Partial<ChatbotSettings> {
  return {
    apiKeyCiphertext: null,
    apiKeyNonce: null,
    apiKeyAuthTag: null,
    apiKeyVersion: null,
    apiKeyKeyId: null,
    apiKeyLastFour: null,
  }
}
