import type { ChatbotKnowledge, ChatbotSettings } from '../../db/schema'
import type { CitationReference } from './retrieval'
import { DEFAULT_CHATBOT_SYSTEM_PROMPT } from './prompt-defaults'
import { CHATBOT_PROVIDER_PRESETS, resolveProviderPolicy } from './providers'

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
    providerPolicy: resolveProviderPolicy(settings.providerPolicy),
    baseUrl: settings.baseUrl,
    model: settings.model,
    systemPromptConfigured: Boolean(settings.systemPrompt?.trim()),
    systemPromptLength: settings.systemPrompt?.length ?? 0,
    // The stored prompt stays hidden; the SHIPPED DEFAULT is not a secret, and
    // the form needs it to pre-fill an unconfigured deployment and to power
    // "restore default" without keeping a second copy of the text in the client.
    defaultSystemPrompt: DEFAULT_CHATBOT_SYSTEM_PROMPT,
    providerPresets: CHATBOT_PROVIDER_PRESETS,
    allowedHosts: settings.allowedHosts ?? [],
    mode: settings.mode ?? 'knowledge',
    outOfScopeBehavior: settings.outOfScopeBehavior ?? 'knowledge_only',
    knowledgeGreeting: settings.knowledgeGreeting ?? '',
    fallbackMessage: settings.fallbackMessage ?? '',
    leadCaptureEnabled: settings.leadCaptureEnabled ?? true,
    leadCaptureEmail: settings.leadCaptureEmail ?? '',
    smallTalkEnabled: settings.smallTalkEnabled ?? true,
    smallTalkSemanticEnabled: settings.smallTalkSemanticEnabled ?? false,
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

/**
 * Trích dẫn gửi xuống TRÌNH DUYỆT — chỉ những gì danh sách "Nguồn tham khảo" vẽ ra.
 *
 * `PublicKnowledgeReference` mang cả `question` và `answer` vì prompt cần chúng. Gửi
 * nguyên hình dạng đó xuống client thì mỗi câu trả lời kèm toàn văn điều luật mà widget
 * KHÔNG dùng: đo trên production 2026-11-04, câu "Thủ tục xóa án tích như thế nào?" có
 * payload 13 309 ký tự, riêng `sources` 5 772 ký tự (43,4%) với 5 079 ký tự là `answer`
 * của 3 nguồn — `normalizeSource` phía client vứt hết, chỉ giữ `entryId`, `label`,
 * `reference`, `url`. Bấm "Xem" mới gọi `/api/public/chatbot/sources?id=…` để lấy toàn văn.
 *
 * Bỏ hai trường đó ở BIÊN giới mạng, không phải khỏi prompt: `references` phía máy chủ
 * vẫn nguyên vẹn cho model đọc và cho `retrieval` tính ngân sách ký tự.
 */
export function toCitationReferences(
  references: readonly CitationReference[],
): CitationReference[] {
  return references.map(({ id, kind, source }) => ({ id, kind, source }))
}
