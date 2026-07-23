import { createError, type H3Event } from 'h3'
import { checkPermission } from './auth'
import { isAnalyticsLiveScopeType, type AnalyticsLiveScopeType } from './analytics-live'

const DAY_MS = 86_400_000
const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export const ANALYTICS_DIMENSIONS = ['source_category', 'device_class', 'country_code', 'region_code'] as const
export type AnalyticsDimension = typeof ANALYTICS_DIMENSIONS[number]

export const ANALYTICS_LIVE_WINDOWS = [5, 15, 30, 60] as const
export type AnalyticsLiveWindow = typeof ANALYTICS_LIVE_WINDOWS[number]
export type AnalyticsBreakdownScope = Exclude<AnalyticsLiveScopeType, 'total'>
export const ANALYTICS_LIVE_POINT_CAP = 60
export const ANALYTICS_BREAKDOWN_ROW_CAP = 50
export const ANALYTICS_NOC_ROW_CAP = 100
export const ANALYTICS_NEXT_POLL_AFTER_SECONDS = 15

export type AnalyticsNocCursor = {
  bucketStart: Date
  id: number
}

export type AnalyticsRange = {
  start: string
  end: string
  days: number
}

export type AnalyticsReportingConfig = {
  defaultRangeDays: number
  maxRangeDays: number
  freshnessThresholdHours: number
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

export function getAnalyticsReportingConfig(): AnalyticsReportingConfig {
  const runtime = typeof globalThis.useRuntimeConfig === 'function' ? globalThis.useRuntimeConfig() : undefined
  const analytics = runtime?.analytics || {}
  const maxRangeDays = boundedInteger(analytics.maxRangeDays ?? process.env.ANALYTICS_MAX_RANGE_DAYS, 366, 1, 366)
  const defaultRangeDays = boundedInteger(analytics.defaultRangeDays ?? process.env.ANALYTICS_DEFAULT_RANGE_DAYS, 30, 1, maxRangeDays)
  return {
    defaultRangeDays,
    maxRangeDays,
    freshnessThresholdHours: boundedInteger(analytics.freshnessThresholdHours ?? process.env.ANALYTICS_FRESHNESS_THRESHOLD_HOURS, 48, 1, 168),
  }
}

function parseIsoDay(value: unknown, name: string): number {
  if (typeof value !== 'string' || !ISO_DAY_PATTERN.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${name} must be an ISO date (YYYY-MM-DD)` })
  }
  const [year, month, day] = value.split('-').map(Number)
  const timestamp = Date.UTC(year, month - 1, day)
  const date = new Date(timestamp)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw createError({ statusCode: 400, statusMessage: `${name} must be a valid UTC calendar date` })
  }
  return timestamp
}

function isoDay(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10)
}

export function parseAnalyticsRange(
  query: Record<string, unknown>,
  options: { now?: Date; defaultRangeDays?: number; maxRangeDays?: number } = {},
): AnalyticsRange {
  const config = getAnalyticsReportingConfig()
  const now = options.now || new Date()
  if (!Number.isFinite(now.getTime())) throw new Error('now must be a valid date')

  const maxRangeDays = boundedInteger(options.maxRangeDays, config.maxRangeDays, 1, 366)
  const defaultRangeDays = boundedInteger(options.defaultRangeDays, config.defaultRangeDays, 1, maxRangeDays)
  const todayTimestamp = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const hasStart = query.start !== undefined
  const hasEnd = query.end !== undefined
  if (hasStart !== hasEnd) {
    throw createError({ statusCode: 400, statusMessage: 'start and end must be provided together' })
  }

  let startTimestamp: number
  let endTimestamp: number
  if (!hasStart) {
    endTimestamp = todayTimestamp
    startTimestamp = endTimestamp - (defaultRangeDays - 1) * DAY_MS
  } else {
    startTimestamp = parseIsoDay(query.start, 'start')
    endTimestamp = parseIsoDay(query.end, 'end')
  }

  if (startTimestamp > endTimestamp) {
    throw createError({ statusCode: 400, statusMessage: 'start must not be after end' })
  }
  if (endTimestamp > todayTimestamp) {
    throw createError({ statusCode: 400, statusMessage: 'analytics ranges cannot include future dates' })
  }

  const days = Math.floor((endTimestamp - startTimestamp) / DAY_MS) + 1
  if (days > maxRangeDays) {
    throw createError({ statusCode: 400, statusMessage: `analytics range must not exceed ${maxRangeDays} inclusive days` })
  }

  return { start: isoDay(startTimestamp), end: isoDay(endTimestamp), days }
}

export function requireAnalyticsRead(event: H3Event) {
  const adminUser = event.context.adminUser
  if (!adminUser) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  if (!checkPermission(adminUser.permissions || [], 'analytics', 'read', adminUser.isSuperAdmin === true)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }
  return adminUser
}

export function parsePositiveInteger(value: unknown, name: string, fallback: number, maximum: number) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${name} must be a positive integer` })
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw createError({ statusCode: 400, statusMessage: `${name} must be between 1 and ${maximum}` })
  }
  return parsed
}

export function parseAnalyticsLiveWindow(value: unknown, fallback: AnalyticsLiveWindow = 60): AnalyticsLiveWindow {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !(ANALYTICS_LIVE_WINDOWS as readonly number[]).includes(Number(value))) {
    throw createError({ statusCode: 400, statusMessage: 'window must be one of 5, 15, 30, or 60 completed minutes' })
  }
  return Number(value) as AnalyticsLiveWindow
}

export function parseAnalyticsBreakdownScope(value: unknown): AnalyticsBreakdownScope {
  if (!isAnalyticsLiveScopeType(value) || value === 'total') {
    throw createError({ statusCode: 400, statusMessage: 'scope must be path or an allowlisted analytics dimension' })
  }
  return value
}

export function assertAnalyticsQueryKeys(query: Record<string, unknown>, allowed: readonly string[]) {
  const unsupported = Object.keys(query).find(key => !allowed.includes(key))
  if (unsupported) throw createError({ statusCode: 400, statusMessage: `unsupported analytics query parameter: ${unsupported}` })
}

function queryString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) throw createError({ statusCode: 400, statusMessage: `${name} must be a string` })
  return value
}

export function encodeAnalyticsNocCursor(cursor: AnalyticsNocCursor): string {
  return Buffer.from(JSON.stringify([cursor.bucketStart.toISOString(), cursor.id]), 'utf8').toString('base64url')
}

export function parseAnalyticsNocCursor(value: unknown): AnalyticsNocCursor | null {
  const encoded = queryString(value, 'cursor')
  if (encoded === undefined) return null
  try {
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(decoded[0]) || !Number.isSafeInteger(decoded[1]) || decoded[1] < 1) throw new Error('invalid')
    const bucketStart = new Date(decoded[0])
    if (!Number.isFinite(bucketStart.getTime())) throw new Error('invalid')
    return { bucketStart, id: decoded[1] }
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'cursor is invalid' })
  }
}

export function parseAnalyticsScopeValue(scope: AnalyticsBreakdownScope, value: unknown): string | null {
  if (value === undefined) return null
  return scope === 'path' ? normalizePageFilter(value) : normalizeDimensionFilter(scope, value)
}

export function utcMinuteStart(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000)
}

export function completedLiveWindow(now: Date, minutes: AnalyticsLiveWindow) {
  const latestBucketStart = new Date(utcMinuteStart(now).getTime() - 60_000)
  const start = new Date(latestBucketStart.getTime() - (minutes - 1) * 60_000)
  return { start, endExclusive: new Date(latestBucketStart.getTime() + 60_000), latestBucketStart }
}

export function serializeAnalyticsDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string') {
    const date = new Date(value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
  }
  return null
}

export function safeAnalyticsCounter(value: unknown): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

export function safeAnalyticsRatio(value: number, total: number): number {
  return total > 0 ? Number((value / total).toFixed(6)) : 0
}

export function normalizeAnalyticsSafeDetails(value: unknown): Record<string, number | boolean | string> | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const safe: Record<string, number | boolean | string> = {}
    for (const [key, item] of Object.entries(parsed)) {
      if (!['scopeCount', 'reasonCode', 'windowMinutes', 'rowCount', 'processedDays', 'stale', 'purgedLiveBuckets', 'purgedDedupRows', 'purgedNocRows', 'liveRetentionHours', 'nocRetentionDays'].includes(key)) continue
      if (typeof item === 'number' || typeof item === 'boolean' || typeof item === 'string') safe[key] = item
    }
    return Object.keys(safe).length ? safe : null
  } catch {
    return null
  }
}

export function reportingWindowMinutes(window: number) {
  return Math.max(1, Math.min(60, Math.floor(window)))
}

export function reportingErrorCode(error: unknown): 'query_failed' | 'unknown' {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return message.includes('query') || message.includes('sql') || message.includes('database') ? 'query_failed' : 'unknown'
}

export function assertAnalyticsLiveScope(value: unknown): AnalyticsLiveScopeType {
  if (!isAnalyticsLiveScopeType(value)) throw createError({ statusCode: 400, statusMessage: 'unsupported live analytics scope' })
  return value
}

export function parseAnalyticsNocLimit(value: unknown): number {
  return parsePositiveInteger(value, 'limit', 20, ANALYTICS_NOC_ROW_CAP)
}

export function parseAnalyticsDimension(value: unknown): AnalyticsDimension {
  if (typeof value !== 'string' || !(ANALYTICS_DIMENSIONS as readonly string[]).includes(value)) {
    throw createError({ statusCode: 400, statusMessage: 'unsupported analytics dimension' })
  }
  return value as AnalyticsDimension
}

export function normalizeDimensionFilter(dimension: AnalyticsDimension, value: unknown): string | null {
  if (value === undefined) return null
  if (typeof value !== 'string') throw createError({ statusCode: 400, statusMessage: 'filter must be a string' })
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 128 || [...trimmed].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid analytics filter' })
  }
  if (dimension === 'source_category') {
    const normalized = trimmed.toLowerCase()
    if (!['direct', 'search', 'social', 'referral', 'email', 'other'].includes(normalized)) throw createError({ statusCode: 400, statusMessage: 'invalid source category filter' })
    return normalized
  }
  if (dimension === 'device_class') {
    const normalized = trimmed.toLowerCase()
    if (!['desktop', 'mobile', 'tablet', 'bot', 'unknown', 'other'].includes(normalized)) throw createError({ statusCode: 400, statusMessage: 'invalid device class filter' })
    return normalized
  }
  if (dimension === 'country_code') {
    const normalized = trimmed.toUpperCase()
    if (normalized !== 'OTHER' && !/^[A-Z]{2}$/.test(normalized)) throw createError({ statusCode: 400, statusMessage: 'invalid country code filter' })
    return normalized === 'OTHER' ? 'other' : normalized
  }
  if (trimmed !== 'other' && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/.test(trimmed)) throw createError({ statusCode: 400, statusMessage: 'invalid region code filter' })
  return trimmed
}

export function normalizePageFilter(value: unknown): string | null {
  if (value === undefined) return null
  if (typeof value !== 'string') throw createError({ statusCode: 400, statusMessage: 'path filter must be a string' })
  const trimmed = value.trim().split(/[?#]/, 1)[0]
  if (!trimmed || trimmed.length > 512 || !trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\') || [...trimmed].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid path filter' })
  }
  return trimmed
}

export function computeFreshness(lastAggregatedDay: string | null, now: Date, thresholdHours: number) {
  if (!lastAggregatedDay) return { lastAggregatedDay: null, stale: true }
  const completedDayEnd = Date.parse(`${lastAggregatedDay}T23:59:59.999Z`)
  return {
    lastAggregatedDay,
    stale: !Number.isFinite(completedDayEnd) || now.getTime() - completedDayEnd > thresholdHours * 3_600_000,
  }
}
