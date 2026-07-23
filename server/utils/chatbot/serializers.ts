import type { ChatbotKnowledge, ChatbotSettings } from '../../db/schema'

function hasCompleteEncryptedKey(settings: ChatbotSettings): boolean {
  return Boolean(
    settings.apiKeyCiphertext
    && settings.apiKeyNonce
    && settings.apiKeyAuthTag
    && settings.apiKeyVersion
    && settings.apiKeyKeyId,
  )
}

export function serializeChatbotSettings(settings: ChatbotSettings) {
  const hasApiKey = hasCompleteEncryptedKey(settings)
  return {
    id: settings.id,
    enabled: settings.enabled,
    providerPolicy: settings.providerPolicy,
    baseUrl: settings.baseUrl,
    model: settings.model,
    systemPromptConfigured: Boolean(settings.systemPrompt?.trim()),
    systemPromptLength: settings.systemPrompt?.length ?? 0,
    allowedHosts: settings.allowedHosts ?? [],
    requestTimeoutMs: settings.requestTimeoutMs,
    maxResponseBytes: settings.maxResponseBytes,
    maxInputChars: settings.maxInputChars,
    maxHistoryMessages: settings.maxHistoryMessages,
    retrievalTopK: settings.retrievalTopK,
    referenceCharBudget: settings.referenceCharBudget,
    rateLimitRequests: settings.rateLimitRequests,
    rateLimitWindowSeconds: settings.rateLimitWindowSeconds,
    hasApiKey,
    apiKeyStatus: hasApiKey ? 'configured' : 'not_configured',
    apiKeyMasked: hasApiKey ? `••••${settings.apiKeyLastFour || ''}` : null,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  }
}

export function safePublicSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null
  } catch { return null }
}

export function serializePublicKnowledge(entry: ChatbotKnowledge) {
  const sourceUrl = safePublicSourceUrl(entry.sourceUrl)
  return {
    id: entry.id,
    question: entry.canonicalQuestion,
    answer: entry.approvedAnswer,
    topic: entry.topic,
    source: entry.sourceLabel || entry.sourceReference || sourceUrl
      ? { label: entry.sourceLabel, reference: entry.sourceReference, url: sourceUrl }
      : null,
  }
}

export function serializeAdminKnowledge(entry: ChatbotKnowledge) {
  return {
    id: entry.id,
    canonicalQuestion: entry.canonicalQuestion,
    approvedAnswer: entry.approvedAnswer,
    topic: entry.topic,
    sourceLabel: entry.sourceLabel,
    sourceUrl: entry.sourceUrl,
    sourceReference: entry.sourceReference,
    internalNotes: entry.internalNotes,
    status: entry.status,
    priority: entry.priority,
    isQuickQuestion: entry.isQuickQuestion,
    authorId: entry.authorId,
    reviewerId: entry.reviewerId,
    reviewedAt: entry.reviewedAt,
    publishedAt: entry.publishedAt,
    archivedAt: entry.archivedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}
