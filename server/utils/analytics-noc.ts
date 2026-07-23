export const ANALYTICS_NOC_EVENT_TYPES = [
  'ingestion_accepted',
  'ingestion_rejected',
  'ingestion_bot_filtered',
  'reporting_success',
  'reporting_failure',
  'maintenance_complete',
  'maintenance_warning',
  'maintenance_failure',
  'maintenance_lock_contention',
  'retention_cleanup',
] as const
export type AnalyticsNocEventType = typeof ANALYTICS_NOC_EVENT_TYPES[number]

export const ANALYTICS_NOC_SEVERITIES = ['info', 'warning', 'error', 'critical'] as const
export type AnalyticsNocSeverity = typeof ANALYTICS_NOC_SEVERITIES[number]

export const ANALYTICS_NOC_COMPONENTS = ['collector', 'reporting', 'maintenance', 'retention'] as const
export type AnalyticsNocComponent = typeof ANALYTICS_NOC_COMPONENTS[number]

export const ANALYTICS_NOC_STATUSES = ['accepted', 'rejected', 'filtered', 'success', 'warning', 'failure', 'locked', 'complete'] as const
export type AnalyticsNocStatus = typeof ANALYTICS_NOC_STATUSES[number]

export const ANALYTICS_NOC_ERROR_CODES = [
  'none',
  'invalid_payload',
  'bot_filtered',
  'storage_unavailable',
  'transaction_failed',
  'invalid_request',
  'unauthorized',
  'forbidden',
  'query_failed',
  'lock_unavailable',
  'retention_warning',
  'maintenance_failed',
  'unknown',
] as const
export type AnalyticsNocErrorCode = typeof ANALYTICS_NOC_ERROR_CODES[number]

const NOC_DETAILS_MAX_BYTES = 1024
const MAX_SAFE_COUNTER = 1_000_000_000
const DETAIL_FIELDS = {
  ingestion_accepted: ['scopeCount'],
  ingestion_rejected: ['reasonCode'],
  ingestion_bot_filtered: ['reasonCode'],
  reporting_success: ['windowMinutes', 'rowCount'],
  reporting_failure: ['windowMinutes', 'reasonCode'],
  maintenance_complete: ['processedDays', 'stale'],
  maintenance_warning: ['processedDays', 'stale', 'reasonCode'],
  maintenance_failure: ['processedDays', 'reasonCode'],
  maintenance_lock_contention: ['reasonCode'],
  retention_cleanup: ['purgedLiveBuckets', 'purgedDedupRows', 'purgedNocRows', 'liveRetentionHours', 'nocRetentionDays'],
} as const satisfies Record<AnalyticsNocEventType, readonly string[]>

const INTEGER_DETAIL_FIELDS = new Set([
  'scopeCount',
  'windowMinutes',
  'rowCount',
  'processedDays',
  'purgedLiveBuckets',
  'purgedDedupRows',
  'purgedNocRows',
  'liveRetentionHours',
  'nocRetentionDays',
])

export type AnalyticsNocDetails = Record<string, number | boolean | AnalyticsNocErrorCode>

function includes<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value as T[number])
}

export function isAnalyticsNocEventType(value: unknown): value is AnalyticsNocEventType {
  return includes(ANALYTICS_NOC_EVENT_TYPES, value)
}

export function isAnalyticsNocSeverity(value: unknown): value is AnalyticsNocSeverity {
  return includes(ANALYTICS_NOC_SEVERITIES, value)
}

export function isAnalyticsNocComponent(value: unknown): value is AnalyticsNocComponent {
  return includes(ANALYTICS_NOC_COMPONENTS, value)
}

export function isAnalyticsNocStatus(value: unknown): value is AnalyticsNocStatus {
  return includes(ANALYTICS_NOC_STATUSES, value)
}

export function normalizeAnalyticsNocErrorCode(value: unknown): AnalyticsNocErrorCode {
  if (includes(ANALYTICS_NOC_ERROR_CODES, value)) return value
  return 'unknown'
}

function validateIntegerDetail(key: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAX_SAFE_COUNTER) {
    throw new Error(`invalid NOC detail: ${key}`)
  }
  const number = Number(value)
  if (key === 'scopeCount' && number > 6) throw new Error(`invalid NOC detail: ${key}`)
  if (key === 'windowMinutes' && (number < 1 || number > 60)) throw new Error(`invalid NOC detail: ${key}`)
  if (key === 'liveRetentionHours' && (number < 24 || number > 168)) throw new Error(`invalid NOC detail: ${key}`)
  if (key === 'nocRetentionDays' && (number < 7 || number > 90)) throw new Error(`invalid NOC detail: ${key}`)
  return number
}

export function serializeAnalyticsNocDetails(eventType: AnalyticsNocEventType, value?: unknown): string | null {
  if (value === undefined || value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid NOC details')

  const input = value as Record<string, unknown>
  const allowed = DETAIL_FIELDS[eventType] as readonly string[]
  const keys = Object.keys(input).sort()
  for (const key of keys) {
    if (!allowed.includes(key)) throw new Error(`unsupported NOC detail: ${key}`)
  }

  const output: AnalyticsNocDetails = {}
  for (const key of keys) {
    const detail = input[key]
    if (key === 'reasonCode') output[key] = normalizeAnalyticsNocErrorCode(detail)
    else if (key === 'stale') {
      if (typeof detail !== 'boolean') throw new Error(`invalid NOC detail: ${key}`)
      output[key] = detail
    } else if (INTEGER_DETAIL_FIELDS.has(key)) output[key] = validateIntegerDetail(key, detail)
    else throw new Error(`unsupported NOC detail: ${key}`)
  }

  const serialized = JSON.stringify(output)
  if (Buffer.byteLength(serialized, 'utf8') > NOC_DETAILS_MAX_BYTES) throw new Error('NOC details exceed safe limit')
  return serialized === '{}' ? null : serialized
}

export type NormalizedAnalyticsNocEvent = {
  eventType: AnalyticsNocEventType
  severity: AnalyticsNocSeverity
  component: AnalyticsNocComponent
  status: AnalyticsNocStatus
  errorCode: AnalyticsNocErrorCode
  detailsJson: string | null
}

export function normalizeAnalyticsNocEvent(value: {
  eventType: unknown
  severity: unknown
  component: unknown
  status: unknown
  errorCode?: unknown
  details?: unknown
}): NormalizedAnalyticsNocEvent {
  if (!isAnalyticsNocEventType(value.eventType)) throw new Error('invalid NOC event type')
  if (!isAnalyticsNocSeverity(value.severity)) throw new Error('invalid NOC severity')
  if (!isAnalyticsNocComponent(value.component)) throw new Error('invalid NOC component')
  if (!isAnalyticsNocStatus(value.status)) throw new Error('invalid NOC status')
  return {
    eventType: value.eventType,
    severity: value.severity,
    component: value.component,
    status: value.status,
    errorCode: value.errorCode === undefined ? 'none' : normalizeAnalyticsNocErrorCode(value.errorCode),
    detailsJson: serializeAnalyticsNocDetails(value.eventType, value.details),
  }
}
