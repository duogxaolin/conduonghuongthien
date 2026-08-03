/**
 * One structured line per event, on stdout.
 *
 * Before this, the server's only diagnostics were three bare `console.error`
 * calls carrying a message and a stack. Nothing recorded a failed login, a
 * lockout, or a rejected session, so the answer to "is someone attacking the
 * admin panel?" was unavailable — `docker logs` showed nothing at all until a
 * request threw.
 *
 * JSON lines rather than prose so `docker logs | jq` works today and any log
 * shipper works later, without adding a dependency.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function activeLevel(): number {
  const configured = String(process.env.LOG_LEVEL || '').toLowerCase() as LogLevel
  if (configured in LEVEL_ORDER) return LEVEL_ORDER[configured]
  return process.env.NODE_ENV === 'production' ? LEVEL_ORDER.info : LEVEL_ORDER.debug
}

/**
 * Keys whose values must never reach a log file. Matched case-insensitively on
 * substrings, so `passwordHash`, `x-api-key` and `Authorization` are all caught.
 */
const SECRET_KEY_PATTERN = /pass|secret|token|authorization|cookie|api[-_]?key|credential|hash/i

export const REDACTED = '[redacted]'

/**
 * A conservative scrub. Anything that looks like a credential by key name is
 * replaced wholesale; long strings are truncated so one hostile field cannot
 * flood the log.
 */
function scrub(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value.length > 512 ? `${value.slice(0, 512)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack?.split('\n').slice(0, 5).join('\n') }
  }
  if (depth >= 4) return '[deep]'
  if (Array.isArray(value)) return value.slice(0, 20).map(item => scrub(item, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : scrub(nested, depth + 1)
    }
    return out
  }
  return String(value)
}

export type LogFields = Record<string, unknown> & { event: string }

/** Build the record without emitting it — the shape the tests assert on. */
export function buildLogRecord(level: LogLevel, fields: LogFields, at: Date): Record<string, unknown> {
  const { event, ...rest } = fields
  return { level, time: at.toISOString(), event, ...(scrub(rest) as Record<string, unknown>) }
}

export function log(level: LogLevel, fields: LogFields): void {
  if (LEVEL_ORDER[level] < activeLevel()) return
  const line = JSON.stringify(buildLogRecord(level, fields, new Date()))
  // error and warn to stderr so a container runtime can split the streams.
  if (level === 'error' || level === 'warn') console.error(line)
  else console.log(line)
}

export const logInfo = (fields: LogFields) => log('info', fields)
export const logWarn = (fields: LogFields) => log('warn', fields)
export const logError = (fields: LogFields) => log('error', fields)

/**
 * Security-relevant events, kept as one enumerated list so an operator can
 * write a single alert rule against `event` and know what to look for.
 */
export const SECURITY_EVENTS = {
  loginFailed: 'auth.login_failed',
  loginLocked: 'auth.login_rate_limited',
  loginSucceeded: 'auth.login_succeeded',
  sessionRevoked: 'auth.session_revoked',
  permissionDenied: 'auth.permission_denied',
  submissionThrottled: 'public.submission_rate_limited',
  // Second-factor lifecycle. The failure and lockout events are the ones worth
  // alerting on: they mean someone holds a valid password and is guessing codes.
  mfaChallengeFailed: 'auth.mfa_challenge_failed',
  mfaChallengeLocked: 'auth.mfa_challenge_locked',
  mfaRecoveryCodeUsed: 'auth.mfa_recovery_code_used',
  mfaFactorEnabled: 'auth.mfa_factor_enabled',
  mfaFactorDisabled: 'auth.mfa_factor_disabled',
  // Break-glass: a SuperAdmin stripping another account's factors.
  mfaFactorsCleared: 'auth.mfa_factors_cleared',
  passwordChanged: 'auth.password_changed',
} as const
