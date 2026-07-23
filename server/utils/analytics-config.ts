export const ANALYTICS_RETENTION_DEFAULTS = {
  liveRetentionHours: 48,
  nocRetentionDays: 30,
} as const

export const ANALYTICS_RETENTION_BOUNDS = {
  liveRetentionHours: { min: 24, max: 168 },
  nocRetentionDays: { min: 7, max: 90 },
} as const

export function parseBoundedAnalyticsInteger(
  name: string,
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return parsed
}

export function resolveAnalyticsRetentionConfig(env: Record<string, unknown> = process.env) {
  return {
    liveRetentionHours: parseBoundedAnalyticsInteger(
      'ANALYTICS_LIVE_RETENTION_HOURS',
      env.ANALYTICS_LIVE_RETENTION_HOURS,
      ANALYTICS_RETENTION_DEFAULTS.liveRetentionHours,
      ANALYTICS_RETENTION_BOUNDS.liveRetentionHours.min,
      ANALYTICS_RETENTION_BOUNDS.liveRetentionHours.max,
    ),
    nocRetentionDays: parseBoundedAnalyticsInteger(
      'ANALYTICS_NOC_RETENTION_DAYS',
      env.ANALYTICS_NOC_RETENTION_DAYS,
      ANALYTICS_RETENTION_DEFAULTS.nocRetentionDays,
      ANALYTICS_RETENTION_BOUNDS.nocRetentionDays.min,
      ANALYTICS_RETENTION_BOUNDS.nocRetentionDays.max,
    ),
  }
}
