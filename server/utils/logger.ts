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

/**
 * Marks a line written BY the ops-alert path (`ops-alert.ts`): it is never itself
 * dispatched as an alert, whatever its event name — the logger cannot recurse
 * through its own alerting. A symbol, so it never reaches the JSON line (`scrub`
 * walks string keys only) and no caller-supplied field can set it by accident.
 */
export const SKIP_OPS_ALERT: unique symbol = Symbol('cdkt.skipOpsAlert')

export type LogFields = Record<string, unknown> & { event: string, [SKIP_OPS_ALERT]?: true }

/** Build the record without emitting it — the shape the tests assert on. */
export function buildLogRecord(level: LogLevel, fields: LogFields, at: Date): Record<string, unknown> {
  const { event, ...rest } = fields
  return { level, time: at.toISOString(), event, ...(scrub(rest) as Record<string, unknown>) }
}

const pendingOpsAlerts = new Set<Promise<void>>()

/**
 * Hand an allowlisted event to `ops-alert.ts` (wave2 D-ALERT), fire-and-forget.
 * Decided BEFORE the LOG_LEVEL filter: verbosity is about what is printed, not about
 * what an operator must hear of. With OPS_ALERT_EMAIL unset nothing is imported and
 * no database is touched. The import is dynamic so this module stays free of the
 * mailer/database graph that every other module imports it alongside.
 */
function dispatchOpsAlert(level: LogLevel, fields: LogFields, at: Date): void {
  if (fields[SKIP_OPS_ALERT] === true) return
  if (!ALERT_EVENT_SET.has(fields.event)) return
  if (!(process.env.OPS_ALERT_EMAIL ?? '').trim()) return
  const record = buildLogRecord(level, fields, at)
  const pending: Promise<void> = import('./ops-alert')
    .then(({ opsAlerts }) => opsAlerts.dispatch(record))
    .catch((error: unknown) => {
      log('error', { event: 'ops.alert_failed', stage: 'load', alertEvent: fields.event, error, [SKIP_OPS_ALERT]: true })
    })
    .finally(() => { pendingOpsAlerts.delete(pending) })
  pendingOpsAlerts.add(pending)
}

/**
 * Resolves once every alert started so far has finished. Alerts are fire-and-forget
 * for the request that logged them; this is for whoever must not exit first (tests,
 * a shutdown hook).
 */
export async function settleOpsAlerts(): Promise<void> {
  while (pendingOpsAlerts.size > 0) await Promise.allSettled([...pendingOpsAlerts])
}

export function log(level: LogLevel, fields: LogFields): void {
  const at = new Date()
  dispatchOpsAlert(level, fields, at)
  if (LEVEL_ORDER[level] < activeLevel()) return
  const line = JSON.stringify(buildLogRecord(level, fields, at))
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
  // Database restore replaces every table, including users and roles: each
  // attempt leaves a trail, and a refusal (not super-admin, invalid file, safety
  // backup failed) is the one worth alerting on.
  backupRestoreStarted: 'backup.restore_started',
  backupRestoreSucceeded: 'backup.restore_succeeded',
  backupRestoreFailed: 'backup.restore_failed',
  backupRestoreRefused: 'backup.restore_refused',
  // Email links: Host header not in PUBLIC_HOST_ALLOWLIST / PUBLIC_BASE_URL (rejected),
  // or neither is configured so the Host is used unchecked (logged once per process).
  linkHostRejected: 'security.link_host_rejected',
  linkHostUnchecked: 'security.link_host_unchecked',
  // A state-changing request a browser sent on behalf of another site
  // (`server/middleware/00.origin-gate.ts`). Payload: path (no query), origin
  // host, reason — never cookies or the full Origin URL.
  crossSiteRefused: 'security.cross_site_refused',
  // A browser reported a Content-Security-Policy violation (`server/api/csp-report.post.ts`,
  // wave3 D-CSP). Aggregated in memory (`csp-report-log.ts`): `kind: "first"` once per key
  // per process, `kind: "repeats"` with `count` and `sources` at the end of each hour.
  // Payload: directive name, blocked host or tag (`inline`, `eval`, `data`), page path
  // without query (or `foreign:<host>`), path group, disposition, a 12-hex SHA-256 prefix of
  // the script sample — never URLs, sample text, IPs or user agents.
  // Deliberately NOT in ALERT_EVENTS: the Report-Only phase reports every inline script
  // on every page view by design, and the endpoint is public — a report flood must
  // never become an e-mail flood. Bounded by aggregation and a per-source limit instead.
  cspViolation: 'security.csp_violation',
} as const

/**
 * Events from the schema migrations that run on every container start
 * (`init.ts` → `migrations-additive.ts`). Kept apart from SECURITY_EVENTS: they
 * mean "the schema could not reach its intended shape without destroying data",
 * not an attack. Error level, one line per boot, counts only — never row data.
 */
export const BOOT_MIGRATION_EVENTS = {
  // `media_items.category_id` has no correct FK and some rows point at no
  // `media_categories` row. The FK is left as it is (adding it would fail and
  // crash-loop the container) and the values are kept (clearing them is the
  // 2026-09-22 boot-wipe bug). Payload: `{ danglingRows }`.
  mediaCategoryFkBlocked: 'db.migration.media_category_fk_blocked',
  // A stored credential (`smtp_pass`, `r2_secret_key`, `backup_drive_service_account`)
  // is an envelope this CHATBOT_ENCRYPTION_SECRET cannot open. Left untouched; it
  // must be re-entered on its settings page. Payload: `{ keys }` — names only.
  settingsSecretUnreadable: 'db.migration.settings_secret_unreadable',
  // A credential is still plaintext but the process has no usable encryption key,
  // so it could not be converted this boot. Payload: `{ keys }`.
  settingsSecretNoKey: 'db.migration.settings_secret_no_key',
  // `repairLegacyMediaUrls` left `…/uploads/migrated/media/<name>` links alone
  // because more than one `media` row carries that file name (wave2 D-SCAN) —
  // pointing them at either row could show the wrong picture. Payload:
  // `{ filenames (≤ 20), filenameCount, articles }`.
  legacyMediaAmbiguous: 'db.migration.legacy_media_ambiguous',
  // `media.url` rows still carry a `localhost:3000/` prefix but no R2 public
  // domain is configured (`settings.r2_public_url`), so the steps that need the
  // domain were skipped. Payload: none.
  legacyMediaDomainUnknown: 'db.migration.legacy_media_domain_unknown',
} as const

/**
 * Events e-mailed to OPS_ALERT_EMAIL (wave2 D-ALERT; `ops-alert.ts`, at most one per
 * event per window). Kept short on purpose: each one means an operator must act —
 * a restore failed or was refused, someone holding a valid password is guessing
 * second factors, an e-mail link was asked for on a forged Host, a browser posted to
 * the API on behalf of another site (the origin gate, wave2 2A), a scheduled backup
 * slot was given up, the boot migration cannot reach its schema without losing data.
 * Routine noise (failed logins, throttled forms) stays in the log.
 *
 * `backup.slot_abandoned` is a literal in `services/backup-scheduler.ts`;
 * tests/ops-alert.test.ts checks every name here is really emitted under server/.
 * To add one: append it here (and give it a window in `OPS_ALERT_WINDOW_SECONDS` if
 * 15 minutes is wrong for it — `security.cross_site_refused` has six hours there).
 */
export const ALERT_EVENTS: readonly string[] = [
  SECURITY_EVENTS.backupRestoreFailed,
  SECURITY_EVENTS.backupRestoreRefused,
  SECURITY_EVENTS.mfaChallengeLocked,
  SECURITY_EVENTS.linkHostRejected,
  SECURITY_EVENTS.crossSiteRefused,
  'backup.slot_abandoned',
  BOOT_MIGRATION_EVENTS.mediaCategoryFkBlocked,
]
const ALERT_EVENT_SET: ReadonlySet<string> = new Set(ALERT_EVENTS)
