/**
 * E-mail an operator when an allowlisted event is logged (wave2 D-ALERT, spec
 * `ops-logging`). `logger.ts` hands every `ALERT_EVENTS` line here — fire-and-forget,
 * only when OPS_ALERT_EMAIL is set — and nothing in this file can fail the request
 * that logged it: `dispatch` never rejects.
 *
 * Rate limit: at most ONE e-mail per event name per window (15 minutes by default,
 * `OPS_ALERT_WINDOW_SECONDS`). Two layers:
 *  - an in-memory mark per process, taken SYNCHRONOUSLY before any await, so a burst
 *    (a probe hammering one endpoint) costs one dispatch, not one database round trip
 *    per line;
 *  - the shared `rate_limit_counters` row (`ops-alert:<event>`), so a restart or a
 *    second process inside the window does not send again. Database unreachable →
 *    the store's own memory fallback.
 * One attempt per window even when it fails: a dead SMTP server is not retried on
 * every repeat of the event (each try would hold a socket for seconds).
 *
 * Why a short-lived connection and not the shared pool: the boot migrations run in a
 * CLI process (`server/db/init.ts`, the container CMD), and one of the alert events
 * (`db.migration.media_category_fk_blocked`) is logged there. Creating `db.ts`'s pool
 * from that process would keep its event loop alive forever — the container would
 * never get past `init.ts` to start the server. So every dispatch opens one
 * connection with the SAME options as the pool (`dbConnectionOptions`), reads the
 * SMTP settings through the mailer's own resolution, and closes it — in the server
 * and in the CLI alike.
 *
 * No recursion: every line written here carries `[SKIP_OPS_ALERT]: true`, which the
 * logger never dispatches. Message content: event name, time, host and the
 * record's top-level primitive fields — already scrubbed by `buildLogRecord`; redacted
 * keys, nested objects and stack traces are dropped, long values cut.
 */
import { hostname } from 'node:os'
import mysql from 'mysql2/promise'

import { SKIP_OPS_ALERT, REDACTED, logInfo, logWarn } from './logger'
import { SMTP_KEYS, getSmtpConfig, sendMail, type SendMailArgs, type SmtpConfig } from './mailer'
import { recordRateLimitHit, type RateLimitExecutor } from './rate-limit-store'
import { dbConnectionOptions } from './db'

/** Window per event name, in seconds; `default` for every event not listed. */
export const OPS_ALERT_WINDOW_SECONDS: Readonly<Record<string, number>> = {
  default: 15 * 60,
  // The origin gate (wave2 2A, `server/middleware/00.origin-gate.ts`) refuses a
  // browser posting on behalf of another site — a probe repeats it for hours, a
  // misconfigured integration on every request. The first refusal is the signal (the
  // e-mail counts the rest); every one stays in the log. D-ALERT: rate-limited harder.
  'security.cross_site_refused': 6 * 60 * 60,
}

const windowFor = (event: string) => OPS_ALERT_WINDOW_SECONDS[event] ?? OPS_ALERT_WINDOW_SECONDS.default!

export interface OpsAlertSession {
  /** The shared rate-limit store; null → the store's in-memory fallback. */
  execute: RateLimitExecutor | null
  smtpConfig: () => Promise<SmtpConfig | null>
  close: () => Promise<void>
}

export interface OpsAlertDeps {
  recipients: () => string | undefined
  now: () => number
  host: () => string
  openSession: () => Promise<OpsAlertSession>
  sendMail: (args: SendMailArgs) => Promise<void>
}

const ADDRESS = /^[^\s@,;<>"'()]+@[^\s@,;<>"'()]+\.[^\s@,;<>"'()]+$/

/**
 * OPS_ALERT_EMAIL → addresses. `null` = unset/blank (alerts off). `[]` = set but not
 * a list of plain addresses (one bad entry voids the lot — a header injection must
 * not half-work).
 */
export function parseAlertRecipients(value: string | undefined): string[] | null {
  const raw = (value ?? '').trim()
  if (!raw) return null
  const parts = raw.split(/[,;]/).map(part => part.trim()).filter(Boolean)
  return parts.length > 0 && parts.every(part => ADDRESS.test(part)) ? parts : []
}

const SKIPPED_KEYS = new Set(['level', 'time', 'event'])
const MAX_CONTEXT_FIELDS = 20
const MAX_VALUE_CHARS = 200

function contextValue(value: unknown): string | null {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value)
    if (text === REDACTED) return null
    return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text
  }
  // A scrubbed Error ({ name, message, stack }): the message, never the stack.
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { message?: unknown }).message === 'string') {
    return contextValue((value as { message: string }).message)
  }
  if (Array.isArray(value) && value.every(item => ['string', 'number', 'boolean'].includes(typeof item))) {
    return contextValue(value.join(', '))
  }
  return null
}

/** Subject + plain-text body. Pure, for the tests. */
export function buildOpsAlertMessage(
  record: Record<string, unknown>,
  meta: { host: string, suppressed: number, windowSeconds: number },
): { subject: string, text: string } {
  const event = String(record.event)
  const context: string[] = []
  for (const [key, value] of Object.entries(record)) {
    if (SKIPPED_KEYS.has(key)) continue
    const text = contextValue(value)
    if (text === null) continue
    context.push(`  ${key}: ${text.replace(/\s+/g, ' ')}`)
    if (context.length >= MAX_CONTEXT_FIELDS) break
  }
  const minutes = Math.round(meta.windowSeconds / 60)
  const lines = [
    `Sự kiện: ${event}`,
    `Thời điểm: ${String(record.time)} (UTC)`,
    `Máy chủ: ${meta.host}`,
    `Mức: ${String(record.level)}`,
    '',
    'Ngữ cảnh:',
    ...(context.length > 0 ? context : ['  (không có)']),
  ]
  if (meta.suppressed > 0) {
    lines.push('', `Trong ${minutes} phút trước đó còn ${meta.suppressed} lần cùng sự kiện không gửi thư.`)
  }
  lines.push(
    '',
    `Thư tự động của cổng thông tin — tối đa một thư cho mỗi sự kiện trong ${minutes} phút.`,
    'Chi tiết đầy đủ nằm trong log của máy chủ (journalctl CONTAINER_TAG=cdkt-app).',
  )
  return { subject: `[CDKT ${meta.host}] Cảnh báo vận hành: ${event}`, text: lines.join('\n') }
}

export interface OpsAlertDispatcher {
  dispatch: (record: Record<string, unknown>) => Promise<void>
}

export function createOpsAlertDispatcher(deps: OpsAlertDeps): OpsAlertDispatcher {
  /** Per event: end of the current window, and repeats dropped inside it. */
  const marks = new Map<string, { until: number, suppressed: number }>()
  let misconfigurationReported = false

  async function dispatch(record: Record<string, unknown>): Promise<void> {
    const event = String(record.event)
    let session: OpsAlertSession | null = null
    try {
      const recipients = parseAlertRecipients(deps.recipients())
      if (recipients === null) return
      if (recipients.length === 0) {
        if (!misconfigurationReported) {
          misconfigurationReported = true
          logWarn({ event: 'ops.alert_misconfigured', reason: 'OPS_ALERT_EMAIL is not a list of e-mail addresses', alertEvent: event, [SKIP_OPS_ALERT]: true })
        }
        return
      }

      // In-memory mark, synchronously — before the first await.
      const now = deps.now()
      const windowSeconds = windowFor(event)
      const mark = marks.get(event)
      if (mark && mark.until > now) {
        mark.suppressed += 1
        return
      }
      const suppressed = mark?.suppressed ?? 0
      marks.set(event, { until: now + windowSeconds * 1000, suppressed: 0 })

      session = await deps.openSession()
      // No shared store in this session → the in-memory mark above is the whole limit
      // (the store's own memory fallback would only repeat it).
      const shared = session.execute
        ? await recordRateLimitHit(`ops-alert:${event}`, { limit: 1, windowSeconds }, { execute: session.execute, now: deps.now })
        : null
      // `limit: 1` reports `blocked` on the FIRST hit too: only count === 1 means "ours".
      if (shared && shared.count > 1) {
        marks.set(event, { until: now + Math.max(1, shared.retryAfterSeconds) * 1000, suppressed: suppressed + 1 })
        return
      }

      const config = await session.smtpConfig()
      if (!config) throw new Error('SMTP chưa được cấu hình — không gửi được cảnh báo')
      const message = buildOpsAlertMessage(record, { host: deps.host(), suppressed, windowSeconds })
      await deps.sendMail({ to: recipients.join(', '), subject: message.subject, text: message.text, config })
      logInfo({ event: 'ops.alert_sent', alertEvent: event, recipients: recipients.length, [SKIP_OPS_ALERT]: true })
    } catch (error: unknown) {
      logWarn({ event: 'ops.alert_failed', alertEvent: event, error: error instanceof Error ? error.message : String(error), [SKIP_OPS_ALERT]: true })
    } finally {
      if (session) await session.close().catch(() => {})
    }
  }

  return { dispatch }
}

/** One connection for one alert: rate-limit row + SMTP settings, then closed. */
async function openShortLivedSession(): Promise<OpsAlertSession> {
  const connection = await mysql.createConnection({ ...dbConnectionOptions(), connectTimeout: 5_000 })
  return {
    execute: (sql, params) => connection.query(sql, params),
    smtpConfig: () => getSmtpConfig(async () => {
      const [rows] = await connection.query('SELECT `key`, `value` FROM `settings` WHERE `key` IN (?)', [[...SMTP_KEYS]])
      const map: Record<string, string> = {}
      for (const row of rows as Array<{ key: string, value: string | null }>) map[row.key] = row.value ?? ''
      return map
    }),
    close: () => connection.end(),
  }
}

/** Which portal sent it: the public host when configured, else the machine name. */
function alertHost(): string {
  const base = (process.env.PUBLIC_BASE_URL || '').trim()
  if (base) {
    try { return new URL(base).host } catch { /* fall through */ }
  }
  return hostname()
}

/** The dispatcher `logger.ts` uses. */
export const opsAlerts = createOpsAlertDispatcher({
  recipients: () => process.env.OPS_ALERT_EMAIL,
  now: () => Date.now(),
  host: alertHost,
  openSession: openShortLivedSession,
  sendMail,
})
