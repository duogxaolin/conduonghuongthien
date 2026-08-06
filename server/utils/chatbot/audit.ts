import { CHATBOT_RESOURCES } from '../permissions'

export type ChatbotAuditOutcome = 'success' | 'failure'

const SETTINGS_CHANGE_FIELDS = Object.freeze({
  enabled: 'enabled',
  providerPolicy: 'provider_policy',
  baseUrl: 'base_url',
  model: 'model',
  systemPrompt: 'system_prompt',
  allowedHosts: 'allowed_hosts',
  requestTimeoutMs: 'request_timeout_ms',
  maxResponseBytes: 'max_response_bytes',
  maxInputChars: 'max_input_chars',
  maxHistoryMessages: 'max_history_messages',
  retrievalTopK: 'retrieval_top_k',
  referenceCharBudget: 'reference_char_budget',
  rateLimitRequests: 'rate_limit_requests',
  rateLimitWindowSeconds: 'rate_limit_window_seconds',
  apiKey: 'api_key',
} as const)

const KNOWLEDGE_CHANGE_FIELDS = Object.freeze({
  canonicalQuestion: 'canonical_question',
  approvedAnswer: 'approved_answer',
  aliases: 'aliases',
  keywords: 'keywords',
  topic: 'topic',
  sourceLabel: 'source_label',
  sourceUrl: 'source_url',
  sourceReference: 'source_reference',
  internalNotes: 'internal_notes',
  priority: 'priority',
  isQuickQuestion: 'is_quick_question',
  reviewerId: 'reviewer_id',
  status: 'status',
} as const)

type SettingsInputField = keyof typeof SETTINGS_CHANGE_FIELDS
type KnowledgeInputField = keyof typeof KNOWLEDGE_CHANGE_FIELDS

export type ChatbotAuditValues = {
  userId: number
  action: string
  resource: typeof CHATBOT_RESOURCES.settings | typeof CHATBOT_RESOURCES.knowledge
  resourceId?: number
  meta: Record<string, string | number | boolean | string[]>
}

type AuditContext = {
  actorId: number
  requestId?: unknown
  outcome?: unknown
}

type SettingsAuditInput = AuditContext & {
  operation: 'read' | 'update' | 'clear_key' | 'rotate_key' | 'test_connection'
  changedFields?: unknown
  configured?: unknown
  statusCode?: unknown
  durationMs?: unknown
}

export type KnowledgeAuditInput = AuditContext & {
  operation: 'read' | 'create' | 'update' | 'delete' | 'publish' | 'archive'
  knowledgeId?: unknown
  changedFields?: unknown
  fromStatus?: unknown
  toStatus?: unknown
  termCount?: unknown
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const KNOWLEDGE_STATUSES = new Set(['draft', 'published', 'archived'])

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined
}

function nonNegativeInteger(value: unknown, maximum: number): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum
    ? Number(value)
    : undefined
}

function safeRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : undefined
}

function safeOutcome(value: unknown): ChatbotAuditOutcome {
  return value === 'failure' ? 'failure' : 'success'
}

function safeStatus(value: unknown): string | undefined {
  return typeof value === 'string' && KNOWLEDGE_STATUSES.has(value) ? value : undefined
}

function allowlistedFields<T extends string>(
  value: unknown,
  allowlist: Readonly<Record<T, string>>,
): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap((field) => {
    if (typeof field !== 'string' || !Object.hasOwn(allowlist, field)) return []
    const safeName = allowlist[field as T]
    return typeof safeName === 'string' ? [safeName] : []
  }))].sort()
}

function baseMeta(context: AuditContext): Record<string, string | number | boolean | string[]> {
  const meta: Record<string, string | number | boolean | string[]> = {
    outcome: safeOutcome(context.outcome),
  }
  const requestId = safeRequestId(context.requestId)
  if (requestId) meta.requestId = requestId
  return meta
}

export function buildChatbotSettingsAudit(input: SettingsAuditInput): ChatbotAuditValues {
  const actorId = positiveInteger(input.actorId)
  if (!actorId) throw new TypeError('actorId must be a positive integer')

  const meta = baseMeta(input)
  if (input.operation === 'update' || input.operation === 'rotate_key') {
    meta.changedFields = allowlistedFields<SettingsInputField>(input.changedFields, SETTINGS_CHANGE_FIELDS)
  }
  if ((input.operation === 'clear_key' || input.operation === 'rotate_key') && typeof input.configured === 'boolean') {
    meta.configured = input.configured
  }
  if (input.operation === 'test_connection') {
    const statusCode = nonNegativeInteger(input.statusCode, 599)
    const durationMs = nonNegativeInteger(input.durationMs, 60_000)
    if (statusCode !== undefined) meta.statusCode = statusCode
    if (durationMs !== undefined) meta.durationMs = durationMs
  }

  return {
    userId: actorId,
    action: input.operation,
    resource: CHATBOT_RESOURCES.settings,
    resourceId: 1,
    meta,
  }
}

export function buildChatbotKnowledgeAudit(input: KnowledgeAuditInput): ChatbotAuditValues {
  const actorId = positiveInteger(input.actorId)
  if (!actorId) throw new TypeError('actorId must be a positive integer')

  const knowledgeId = positiveInteger(input.knowledgeId)
  const meta = baseMeta(input)
  if (input.operation === 'create' || input.operation === 'update') {
    meta.changedFields = allowlistedFields<KnowledgeInputField>(input.changedFields, KNOWLEDGE_CHANGE_FIELDS)
  }
  if (input.operation === 'publish' || input.operation === 'archive') {
    const fromStatus = safeStatus(input.fromStatus)
    const toStatus = safeStatus(input.toStatus)
    if (fromStatus) meta.fromStatus = fromStatus
    if (toStatus) meta.toStatus = toStatus
  }
  const termCount = nonNegativeInteger(input.termCount, 10_000)
  if (termCount !== undefined) meta.termCount = termCount

  return {
    userId: actorId,
    action: input.operation,
    resource: CHATBOT_RESOURCES.knowledge,
    ...(knowledgeId ? { resourceId: knowledgeId } : {}),
    meta,
  }
}
