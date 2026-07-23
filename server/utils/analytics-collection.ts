import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'

export const ANALYTICS_PATH_MAX_LENGTH = 512
export const ANALYTICS_SOURCE_MAX_LENGTH = 32
export const ANALYTICS_DEVICE_MAX_LENGTH = 16
export const ANALYTICS_COUNTRY_MAX_LENGTH = 2
export const ANALYTICS_REGION_MAX_LENGTH = 16
export const VISITOR_TOKEN_LENGTH = 64

export const SOURCE_CATEGORIES = ['direct', 'search', 'social', 'referral', 'email', 'other'] as const
export type SourceCategory = typeof SOURCE_CATEGORIES[number]

export const DEVICE_CLASSES = ['desktop', 'mobile', 'tablet', 'bot', 'unknown'] as const
export type DeviceClass = typeof DEVICE_CLASSES[number]

const BODY_FIELDS = new Set(['path', 'sourceCategory', 'deviceClass', 'countryCode', 'regionCode'])
const COUNTRY_RE = /^[A-Z]{2}$/
const REGION_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/

export type AnalyticsPayload = {
  path: string
  sourceCategory?: string
  deviceClass?: string
  countryCode?: string | null
  regionCode?: string | null
}

export type NormalizedAnalyticsEvent = {
  path: string
  sourceCategory: SourceCategory
  deviceClass: DeviceClass
  countryCode: string | null
  regionCode: string | null
}

export type TrustedGeography = {
  countryCode?: unknown
  regionCode?: unknown
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : null
}

export function normalizePublicPath(value: unknown): string | null {
  const path = stringValue(value)?.trim()
  if (!path || path.length > ANALYTICS_PATH_MAX_LENGTH || !path.startsWith('/') || path.startsWith('//')) return null
  const withoutQuery = path.split(/[?#]/, 1)[0]
  if (!withoutQuery || [...withoutQuery].some(char => char === '\\' || char.charCodeAt(0) < 32) || !withoutQuery.startsWith('/')) return null
  if (withoutQuery === '/admin' || withoutQuery.startsWith('/admin/') || withoutQuery === '/api' || withoutQuery.startsWith('/api/')) return null
  if (withoutQuery.startsWith('/_nuxt/') || withoutQuery.startsWith('/assets/') || withoutQuery.startsWith('/uploads/')) return null
  return withoutQuery
}

export function normalizeSourceCategory(value: unknown): SourceCategory {
  return (typeof value === 'string' && (SOURCE_CATEGORIES as readonly string[]).includes(value.trim().toLowerCase()))
    ? value.trim().toLowerCase() as SourceCategory
    : 'direct'
}

export function normalizeDeviceClass(value: unknown): DeviceClass {
  return (typeof value === 'string' && (DEVICE_CLASSES as readonly string[]).includes(value.trim().toLowerCase()))
    ? value.trim().toLowerCase() as DeviceClass
    : 'unknown'
}

export function normalizeTrustedGeography(geo?: TrustedGeography): Pick<NormalizedAnalyticsEvent, 'countryCode' | 'regionCode'> {
  const country = stringValue(geo?.countryCode)?.trim().toUpperCase() || null
  const region = stringValue(geo?.regionCode)?.trim() || null
  if (country && (!COUNTRY_RE.test(country) || country.length > ANALYTICS_COUNTRY_MAX_LENGTH)) throw new Error('invalid trusted country code')
  if (region && (!REGION_RE.test(region) || region.length > ANALYTICS_REGION_MAX_LENGTH)) throw new Error('invalid trusted region code')
  return { countryCode: country, regionCode: region }
}

export function validateAnalyticsPayload(value: unknown, trustedGeography?: TrustedGeography): NormalizedAnalyticsEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid analytics payload')
  const body = value as Record<string, unknown>
  for (const key of Object.keys(body)) if (!BODY_FIELDS.has(key)) throw new Error('unknown analytics field')
  const path = normalizePublicPath(body.path)
  if (!path) throw new Error('invalid analytics path')
  const source = typeof body.sourceCategory === 'undefined' ? 'direct' : body.sourceCategory
  if (typeof source !== 'string' || source.length > ANALYTICS_SOURCE_MAX_LENGTH || !(SOURCE_CATEGORIES as readonly string[]).includes(source.trim().toLowerCase())) throw new Error('invalid source category')
  const device = typeof body.deviceClass === 'undefined' ? 'unknown' : body.deviceClass
  if (typeof device !== 'string' || device.length > ANALYTICS_DEVICE_MAX_LENGTH || !(DEVICE_CLASSES as readonly string[]).includes(device.trim().toLowerCase())) throw new Error('invalid device class')
  if ('countryCode' in body || 'regionCode' in body) throw new Error('geography must come from trusted infrastructure')
  return { path, sourceCategory: normalizeSourceCategory(source), deviceClass: normalizeDeviceClass(device), ...normalizeTrustedGeography(trustedGeography) }
}

export function canonicalNetworkPrefix(address: string): string {
  const value = address.trim().replace(/^::ffff:/i, '')
  const version = isIP(value)
  if (version === 4) return value.split('.').slice(0, 3).join('.') + '.0/24'
  if (version === 6) return value.split(':').slice(0, 4).join(':').toLowerCase() + '::/56'
  return 'unknown'
}

export function coarseUserAgentFamily(userAgent: string): string {
  const value = userAgent.toLowerCase()
  const browser = value.includes('edg/') ? 'edge'
    : value.includes('firefox/') ? 'firefox'
      : value.includes('chrome/') || value.includes('crios/') ? 'chromium'
        : value.includes('safari/') ? 'safari'
          : 'other'
  const platform = /bot|crawler|spider|slurp/.test(value) ? 'bot'
    : /ipad|tablet/.test(value) ? 'tablet'
      : /android|iphone|mobile/.test(value) ? 'mobile'
        : 'desktop'
  return `${browser}:${platform}`
}

export function deriveDailyVisitorToken(secret: unknown, input: { ip: string; userAgent: string; day: string }): string {
  if (typeof secret !== 'string' || secret.trim().length < 32) throw new Error('analytics visitor token secret is unavailable')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) throw new Error('invalid analytics token day')
  const canonical = `${input.day}\n${canonicalNetworkPrefix(input.ip)}\n${coarseUserAgentFamily(input.userAgent)}`
  return createHmac('sha256', secret.trim()).update(canonical).digest('hex').slice(0, VISITOR_TOKEN_LENGTH)
}

export type MinimalPageViewRow = NormalizedAnalyticsEvent & {
  occurredAt: Date
  eventDay: string
  visitorToken: string
}

export function buildMinimalPageViewRow(options: {
  payload: unknown
  secret: unknown
  ip: string
  userAgent: string
  now?: Date
  trustedGeography?: TrustedGeography
}): MinimalPageViewRow {
  const occurredAt = options.now || new Date()
  const eventDay = occurredAt.toISOString().slice(0, 10)
  return {
    occurredAt,
    eventDay,
    ...validateAnalyticsPayload(options.payload, options.trustedGeography),
    visitorToken: deriveDailyVisitorToken(options.secret, { ip: options.ip, userAgent: options.userAgent, day: eventDay }),
  }
}
