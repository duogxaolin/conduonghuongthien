export const ANALYTICS_LIVE_SCOPE_TYPES = [
  'total',
  'path',
  'source_category',
  'device_class',
  'country_code',
  'region_code',
] as const

export type AnalyticsLiveScopeType = typeof ANALYTICS_LIVE_SCOPE_TYPES[number]

export function isAnalyticsLiveScopeType(value: unknown): value is AnalyticsLiveScopeType {
  return typeof value === 'string' && (ANALYTICS_LIVE_SCOPE_TYPES as readonly string[]).includes(value)
}
