import { eq, inArray } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { settings, dataRetentionState } from '../db/schema'
import {
  DATA_RETENTION_BOUNDS,
  parseRetentionDays,
  resolveDataRetentionConfig,
} from '../utils/data-retention-config'

/**
 * The retention policy an operator can edit, layered over the environment.
 *
 * Precedence is database → environment → code default, and the resolved policy
 * reports which layer each value came from. Without that, an operator who sets
 * ACTIVITY_LOG_RETENTION_DAYS in `.env` and then edits the form has no way to
 * see that the form now wins, and would keep changing a file with no effect.
 *
 * Two conditions trigger deletion, and they answer different questions:
 *   • age  — "this is older than we are allowed to keep it" (a policy limit)
 *   • rows — "the table is bigger than this box can carry" (a capacity limit)
 * Age alone cannot bound a table that gains rows faster than a year passes, and
 * a row cap alone would delete this morning's audit trail on a busy day. Either
 * one can be disabled with 0; both disabled means nothing is ever deleted.
 */

export const RETENTION_SCOPES = ['activity_logs', 'submissions', 'chat_sessions'] as const
export type RetentionScope = typeof RETENTION_SCOPES[number]

export const RETENTION_TRIGGERS = ['scheduler', 'cron', 'manual'] as const
export type RetentionTrigger = typeof RETENTION_TRIGGERS[number]

/** Row caps are a capacity guard, not a policy one — a tiny cap is a mistake. */
export const MAX_ROWS_BOUNDS = { min: 1_000, max: 100_000_000 } as const

/** Settings keys. Namespaced so the generic settings form cannot reach them. */
export const RETENTION_SETTING_KEYS = {
  autoEnabled: 'retention_auto_enabled',
  runHour: 'retention_run_hour',
  activityLogDays: 'retention_activity_log_days',
  activityLogMaxRows: 'retention_activity_log_max_rows',
  submissionDays: 'retention_submission_days',
  submissionMaxRows: 'retention_submission_max_rows',
  chatSessionDays: 'retention_chat_session_days',
  chatSessionMaxRows: 'retention_chat_session_max_rows',
} as const

export const RETENTION_DEFAULTS = {
  /** On by default: the documented window was never enforced without a cron. */
  autoEnabled: true,
  /** Local hour, 0–23. Off-peak, and off the top of the hour by habit. */
  runHour: 3,
  /** 0 = no cap. A cap has to be chosen against the box, so it is not guessed. */
  activityLogMaxRows: 0,
  submissionMaxRows: 0,
  chatSessionMaxRows: 0,
} as const

/**
 * Everything that differs per scope, in one table keyed by the scope itself.
 *
 * This was three parallel ternary chains (`scope === 'activity_logs' ? … : …`),
 * which read as a coin flip and quietly meant "submissions" for any scope that
 * was not the audit log. Adding a third scope to that shape would have given
 * chat history the submissions keys — a purge window silently editing the wrong
 * table. Keyed by `RetentionScope`, the compiler now refuses an incomplete map.
 */
const SCOPE_SETTINGS: Record<RetentionScope, {
  daysKey: string
  maxRowsKey: string
  envKey: string
  envField: 'activityLogDays' | 'submissionDays' | 'chatSessionDays'
  /** Field names on RetentionPolicyInput — what the admin form sends. */
  inputDaysField: 'activityLogDays' | 'submissionDays' | 'chatSessionDays'
  inputMaxRowsField: 'activityLogMaxRows' | 'submissionMaxRows' | 'chatSessionMaxRows'
  bounds: { min: number; max: number }
  maxRowsDefault: number
}> = {
  activity_logs: {
    daysKey: RETENTION_SETTING_KEYS.activityLogDays,
    maxRowsKey: RETENTION_SETTING_KEYS.activityLogMaxRows,
    envKey: 'ACTIVITY_LOG_RETENTION_DAYS',
    envField: 'activityLogDays',
    inputDaysField: 'activityLogDays',
    inputMaxRowsField: 'activityLogMaxRows',
    bounds: DATA_RETENTION_BOUNDS.activityLogDays,
    maxRowsDefault: RETENTION_DEFAULTS.activityLogMaxRows,
  },
  submissions: {
    daysKey: RETENTION_SETTING_KEYS.submissionDays,
    maxRowsKey: RETENTION_SETTING_KEYS.submissionMaxRows,
    envKey: 'SUBMISSION_RETENTION_DAYS',
    envField: 'submissionDays',
    inputDaysField: 'submissionDays',
    inputMaxRowsField: 'submissionMaxRows',
    bounds: DATA_RETENTION_BOUNDS.submissionDays,
    maxRowsDefault: RETENTION_DEFAULTS.submissionMaxRows,
  },
  chat_sessions: {
    daysKey: RETENTION_SETTING_KEYS.chatSessionDays,
    maxRowsKey: RETENTION_SETTING_KEYS.chatSessionMaxRows,
    envKey: 'CHAT_SESSION_RETENTION_DAYS',
    envField: 'chatSessionDays',
    inputDaysField: 'chatSessionDays',
    inputMaxRowsField: 'chatSessionMaxRows',
    bounds: DATA_RETENTION_BOUNDS.chatSessionDays,
    maxRowsDefault: RETENTION_DEFAULTS.chatSessionMaxRows,
  },
}

export type PolicySource = 'database' | 'environment' | 'default'

export type ScopePolicy = {
  scope: RetentionScope
  days: number
  daysSource: PolicySource
  maxRows: number
  maxRowsSource: PolicySource
}

export type RetentionPolicy = {
  autoEnabled: boolean
  autoEnabledSource: PolicySource
  runHour: number
  runHourSource: PolicySource
  scopes: ScopePolicy[]
}

export class RetentionPolicyValidationError extends Error {}

function fail(message: string): never {
  throw new RetentionPolicyValidationError(message)
}

/** Row caps: 0 disables, otherwise it must be inside the capacity bounds. */
export function parseMaxRows(name: string, value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail(`${name} phải là 0 (không giới hạn) hoặc số nguyên dương.`)
  }
  if (parsed === 0) return 0
  if (parsed < MAX_ROWS_BOUNDS.min || parsed > MAX_ROWS_BOUNDS.max) {
    fail(`${name} phải là 0 hoặc từ ${MAX_ROWS_BOUNDS.min} đến ${MAX_ROWS_BOUNDS.max}.`)
  }
  return parsed
}

export function parseRunHour(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 23) {
    fail('Giờ chạy phải là số nguyên từ 0 đến 23.')
  }
  return parsed
}

/**
 * '1'/'true'/'on' are all true and anything else stored is false. A stored value
 * we cannot read must not silently mean "keep deleting".
 */
export function parseBooleanSetting(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback
  const text = String(value).trim().toLowerCase()
  if (['1', 'true', 'on', 'yes'].includes(text)) return true
  if (['0', 'false', 'off', 'no'].includes(text)) return false
  return fallback
}

/**
 * Merge stored settings over environment defaults. Pure, so the precedence
 * rules are testable without a database.
 */
export function buildRetentionPolicy(
  stored: Record<string, string | null | undefined>,
  env: Record<string, unknown> = process.env,
): RetentionPolicy {
  const fromEnv = resolveDataRetentionConfig(env)
  const has = (key: string) => {
    const value = stored[key]
    return value !== undefined && value !== null && value !== ''
  }

  const daysFor = (scope: RetentionScope) => {
    const { daysKey: key, envKey, envField, bounds } = SCOPE_SETTINGS[scope]
    const envValue = fromEnv[envField]

    if (!has(key)) {
      return {
        days: envValue,
        source: (env[envKey] === undefined || env[envKey] === '' ? 'default' : 'environment') as PolicySource,
      }
    }
    // Reuse the env parser so a stored value gets the same bounds, and translate
    // its English message — this one surfaces in an admin form.
    try {
      const days = parseRetentionDays(key, stored[key], envValue, bounds.min, bounds.max)
      return { days, source: 'database' as PolicySource }
    } catch {
      fail(`Số ngày lưu phải là 0 (giữ vô thời hạn) hoặc từ ${bounds.min} đến ${bounds.max}.`)
    }
  }

  const maxRowsFor = (scope: RetentionScope) => {
    const { maxRowsKey: key, maxRowsDefault: fallback } = SCOPE_SETTINGS[scope]
    if (!has(key)) return { maxRows: fallback, source: 'default' as PolicySource }
    return { maxRows: parseMaxRows('Số bản ghi tối đa', stored[key], fallback), source: 'database' as PolicySource }
  }

  const autoStored = has(RETENTION_SETTING_KEYS.autoEnabled)
  const hourStored = has(RETENTION_SETTING_KEYS.runHour)

  return {
    autoEnabled: autoStored
      ? parseBooleanSetting(stored[RETENTION_SETTING_KEYS.autoEnabled], RETENTION_DEFAULTS.autoEnabled)
      : parseBooleanSetting(env.RETENTION_AUTO_ENABLED, RETENTION_DEFAULTS.autoEnabled),
    autoEnabledSource: autoStored
      ? 'database'
      : (env.RETENTION_AUTO_ENABLED === undefined || env.RETENTION_AUTO_ENABLED === '' ? 'default' : 'environment'),
    runHour: hourStored
      ? parseRunHour(stored[RETENTION_SETTING_KEYS.runHour], RETENTION_DEFAULTS.runHour)
      : parseRunHour(env.RETENTION_RUN_HOUR, RETENTION_DEFAULTS.runHour),
    runHourSource: hourStored
      ? 'database'
      : (env.RETENTION_RUN_HOUR === undefined || env.RETENTION_RUN_HOUR === '' ? 'default' : 'environment'),
    scopes: RETENTION_SCOPES.map((scope) => {
      const { days, source: daysSource } = daysFor(scope)
      const { maxRows, source: maxRowsSource } = maxRowsFor(scope)
      return { scope, days, daysSource, maxRows, maxRowsSource }
    }),
  }
}

const RETENTION_KEY_LIST = Object.values(RETENTION_SETTING_KEYS)

/** Read the stored half of the policy. Missing rows are simply absent keys. */
export async function loadStoredRetentionSettings(): Promise<Record<string, string | null>> {
  const db = getDb()
  const rows = await db.select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, RETENTION_KEY_LIST as string[]))
  const out: Record<string, string | null> = {}
  for (const row of rows) out[row.key] = row.value
  return out
}

export async function resolveRetentionPolicy(): Promise<RetentionPolicy> {
  return buildRetentionPolicy(await loadStoredRetentionSettings())
}

export type RetentionPolicyInput = {
  autoEnabled?: unknown
  runHour?: unknown
  activityLogDays?: unknown
  activityLogMaxRows?: unknown
  submissionDays?: unknown
  submissionMaxRows?: unknown
  chatSessionDays?: unknown
  chatSessionMaxRows?: unknown
}

/**
 * Persist the policy. Every field is validated before anything is written, so a
 * form with one bad value cannot leave half a policy applied.
 */
export async function saveRetentionPolicy(input: RetentionPolicyInput): Promise<string[]> {
  const pending: Array<[string, string]> = []

  if (input.autoEnabled !== undefined) {
    if (typeof input.autoEnabled !== 'boolean') fail('Công tắc tự động dọn phải là true hoặc false.')
    pending.push([RETENTION_SETTING_KEYS.autoEnabled, input.autoEnabled ? '1' : '0'])
  }
  if (input.runHour !== undefined) {
    pending.push([RETENTION_SETTING_KEYS.runHour, String(parseRunHour(input.runHour, RETENTION_DEFAULTS.runHour))])
  }

  // Driven from RETENTION_SCOPES rather than a hand-written pair of lists: those
  // lists were the reason chat history could be purged on a 90-day window that no
  // form could see or change. A scope added to RETENTION_SCOPES is now saveable
  // by construction, and SCOPE_SETTINGS makes the compiler supply its field names.
  for (const scope of RETENTION_SCOPES) {
    const { daysKey, inputDaysField, bounds } = SCOPE_SETTINGS[scope]
    const value = input[inputDaysField]
    if (value === undefined) continue
    let parsed: number
    try {
      parsed = parseRetentionDays(daysKey, value, 0, bounds.min, bounds.max)
    } catch {
      fail(`Số ngày lưu phải là 0 (giữ vô thời hạn) hoặc từ ${bounds.min} đến ${bounds.max}.`)
    }
    pending.push([daysKey, String(parsed)])
  }

  for (const scope of RETENTION_SCOPES) {
    const { maxRowsKey, inputMaxRowsField } = SCOPE_SETTINGS[scope]
    const value = input[inputMaxRowsField]
    if (value === undefined) continue
    pending.push([maxRowsKey, String(parseMaxRows('Số bản ghi tối đa', value, 0))])
  }

  if (pending.length === 0) fail('Không có giá trị nào để lưu.')

  const db = getDb()
  for (const [key, value] of pending) {
    await db.insert(settings).values({ key, value, type: 'string', group: 'retention' })
      .onDuplicateKeyUpdate({ set: { value, type: 'string', group: 'retention' } })
  }
  return pending.map(([key]) => key)
}

export type ScopeState = {
  scope: RetentionScope
  purgedTotal: number
  lastRunAt: Date | null
  lastDeleted: number
  lastTrigger: string | null
  lastStatus: string | null
  lastMessage: string | null
}

export async function loadRetentionState(): Promise<ScopeState[]> {
  const db = getDb()
  const rows = await db.select().from(dataRetentionState)
  const byScope = new Map(rows.map(row => [row.scope, row]))
  return RETENTION_SCOPES.map((scope) => {
    const row = byScope.get(scope)
    return {
      scope,
      purgedTotal: Number(row?.purgedTotal ?? 0),
      lastRunAt: row?.lastRunAt ?? null,
      lastDeleted: Number(row?.lastDeleted ?? 0),
      lastTrigger: row?.lastTrigger ?? null,
      lastStatus: row?.lastStatus ?? null,
      lastMessage: row?.lastMessage ?? null,
    }
  })
}

/** The most recent run across all scopes — what the scheduler checks. */
export async function lastRetentionRunAt(): Promise<Date | null> {
  const db = getDb()
  const rows = await db.select({ lastRunAt: dataRetentionState.lastRunAt }).from(dataRetentionState)
  let latest: Date | null = null
  for (const row of rows) {
    if (row.lastRunAt && (!latest || row.lastRunAt > latest)) latest = row.lastRunAt
  }
  return latest
}

export async function clearRetentionScopeState(scope: RetentionScope): Promise<void> {
  const db = getDb()
  await db.delete(dataRetentionState).where(eq(dataRetentionState.scope, scope))
}
