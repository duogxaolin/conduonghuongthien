/**
 * Retention policy for the operational tables — the ones holding personal data
 * that analytics maintenance never touched.
 *
 * `activity_logs` gains a row on every login and every create/update/delete,
 * and its `meta` column carries the caller's IP and User-Agent.
 * `submissions` holds what citizens type into the public forms: full name,
 * phone, email, address, free-text message.
 *
 * Both were kept forever. A default of "forever" is a decision nobody made, so
 * these values make it explicit and configurable.
 *
 * `0` means "keep indefinitely" and disables the purge for that table. It is
 * the default for `submissions` on purpose: a public authority's records
 * schedule decides how long citizen correspondence is held, and this code is
 * not the place to guess it. Set SUBMISSION_RETENTION_DAYS once that schedule
 * is known.
 */

export const DATA_RETENTION_DEFAULTS = {
  /** Audit trail. One year covers the usual review window without hoarding IPs. */
  activityLogDays: 365,
  /** 0 = disabled. Enable deliberately, per the agency's records schedule. */
  submissionDays: 0,
} as const

export const DATA_RETENTION_BOUNDS = {
  activityLogDays: { min: 30, max: 3650 },
  submissionDays: { min: 30, max: 3650 },
} as const

/**
 * Parse a retention window. Unlike the analytics parser, `0` is meaningful
 * here — it disables the purge rather than being an out-of-range value — so
 * the bounds are only applied to non-zero settings.
 */
export function parseRetentionDays(
  name: string,
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be 0 (keep indefinitely) or a positive integer`)
  }
  if (parsed === 0) return 0
  if (parsed < min || parsed > max) {
    throw new Error(`${name} must be 0 or an integer between ${min} and ${max}`)
  }
  return parsed
}

export function resolveDataRetentionConfig(env: Record<string, unknown> = process.env) {
  return {
    activityLogDays: parseRetentionDays(
      'ACTIVITY_LOG_RETENTION_DAYS',
      env.ACTIVITY_LOG_RETENTION_DAYS,
      DATA_RETENTION_DEFAULTS.activityLogDays,
      DATA_RETENTION_BOUNDS.activityLogDays.min,
      DATA_RETENTION_BOUNDS.activityLogDays.max,
    ),
    submissionDays: parseRetentionDays(
      'SUBMISSION_RETENTION_DAYS',
      env.SUBMISSION_RETENTION_DAYS,
      DATA_RETENTION_DEFAULTS.submissionDays,
      DATA_RETENTION_BOUNDS.submissionDays.min,
      DATA_RETENTION_BOUNDS.submissionDays.max,
    ),
  }
}
