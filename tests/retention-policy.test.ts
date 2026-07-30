import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import {
  buildRetentionPolicy,
  parseBooleanSetting,
  parseMaxRows,
  parseRunHour,
  RetentionPolicyValidationError,
  RETENTION_DEFAULTS,
  RETENTION_SETTING_KEYS,
  MAX_ROWS_BOUNDS,
} from '../server/services/retention-policy'
import { isRunDue, STALE_RUN_MS } from '../server/services/retention-scheduler'
import type { RetentionPolicy } from '../server/services/retention-policy'

/**
 * The retention policy decides what gets deleted, so the two questions these
 * tests answer are "which value wins" and "when does a purge fire". Both are
 * pure functions on purpose: a schedule that can only be tested by waiting for
 * 3am, or a precedence rule that needs a live database, is a rule nobody checks.
 */

const K = RETENTION_SETTING_KEYS

function source(url: string) {
  return readFileSync(new URL(url, import.meta.url), 'utf8')
}
/** Strip comments so a doc comment naming a call cannot satisfy an assertion. */
function codeOnly(text: string) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// ─── Field parsing ───────────────────────────────────────────────────────────
test('a row cap is 0 or a real capacity, never a typo that empties the table', () => {
  assert.equal(parseMaxRows('cap', '0', 5), 0, '0 has to mean "no cap", not "keep nothing"')
  assert.equal(parseMaxRows('cap', '50000', 0), 50_000)
  // 10 would be read as "keep 10 rows" and delete the rest of the audit log, so
  // anything under the floor is refused rather than applied.
  for (const bad of ['10', '999', '-1', '1.5', 'abc', String(MAX_ROWS_BOUNDS.max + 1)]) {
    assert.throws(() => parseMaxRows('cap', bad, 0), RetentionPolicyValidationError, `accepted: ${bad}`)
  }
})

test('an unset field falls back instead of being read as 0', () => {
  for (const empty of [undefined, null, '']) {
    assert.equal(parseMaxRows('cap', empty, 25_000), 25_000)
    assert.equal(parseRunHour(empty, 3), 3)
    assert.equal(parseBooleanSetting(empty, true), true)
  }
})

test('the run hour is a whole hour of the day', () => {
  assert.equal(parseRunHour('0', 3), 0)
  assert.equal(parseRunHour(23, 3), 23)
  for (const bad of ['24', '-1', '3.5', 'three']) {
    assert.throws(() => parseRunHour(bad, 3), RetentionPolicyValidationError, `accepted: ${bad}`)
  }
})

test('an unreadable stored switch falls back rather than defaulting to deleting', () => {
  assert.equal(parseBooleanSetting('1', false), true)
  assert.equal(parseBooleanSetting('off', true), false)
  // The fallback is what the caller passes; garbage must not be read as "on".
  assert.equal(parseBooleanSetting('maybe', false), false)
})

// ─── Precedence ──────────────────────────────────────────────────────────────
test('with nothing stored and nothing in the environment, every value is a default', () => {
  const policy = buildRetentionPolicy({}, {})
  assert.equal(policy.autoEnabled, RETENTION_DEFAULTS.autoEnabled)
  assert.equal(policy.runHour, RETENTION_DEFAULTS.runHour)
  assert.equal(policy.autoEnabledSource, 'default')
  assert.equal(policy.runHourSource, 'default')
  for (const scope of policy.scopes) {
    assert.equal(scope.daysSource, 'default')
    assert.equal(scope.maxRowsSource, 'default')
    assert.equal(scope.maxRows, 0, 'a row cap nobody asked for would delete rows nobody expected')
  }
})

test('the environment is reported as the environment, not as a default', () => {
  const policy = buildRetentionPolicy({}, {
    ACTIVITY_LOG_RETENTION_DAYS: '90',
    RETENTION_RUN_HOUR: '4',
    RETENTION_AUTO_ENABLED: '0',
  })
  const logs = policy.scopes.find(s => s.scope === 'activity_logs')!
  assert.equal(logs.days, 90)
  assert.equal(logs.daysSource, 'environment')
  assert.equal(policy.runHour, 4)
  assert.equal(policy.runHourSource, 'environment')
  assert.equal(policy.autoEnabled, false)
  assert.equal(policy.autoEnabledSource, 'environment')
})

test('a stored value wins over the environment and says so', () => {
  // Without the source, an operator edits .env, sees nothing change, and has no
  // way to discover the form is overriding the file.
  const policy = buildRetentionPolicy(
    { [K.activityLogDays]: '30', [K.runHour]: '2', [K.autoEnabled]: '0' },
    { ACTIVITY_LOG_RETENTION_DAYS: '365', RETENTION_RUN_HOUR: '5', RETENTION_AUTO_ENABLED: '1' },
  )
  const logs = policy.scopes.find(s => s.scope === 'activity_logs')!
  assert.equal(logs.days, 30)
  assert.equal(logs.daysSource, 'database')
  assert.equal(policy.runHour, 2)
  assert.equal(policy.runHourSource, 'database')
  assert.equal(policy.autoEnabled, false)
  assert.equal(policy.autoEnabledSource, 'database')
})

test('an empty stored row is treated as absent, so clearing a field restores the fallback', () => {
  const policy = buildRetentionPolicy(
    { [K.activityLogDays]: '', [K.runHour]: null },
    { ACTIVITY_LOG_RETENTION_DAYS: '120' },
  )
  const logs = policy.scopes.find(s => s.scope === 'activity_logs')!
  assert.equal(logs.days, 120)
  assert.equal(logs.daysSource, 'environment')
  assert.equal(policy.runHour, RETENTION_DEFAULTS.runHour)
})

test('the two scopes are configured independently', () => {
  const policy = buildRetentionPolicy({
    [K.activityLogDays]: '365', [K.activityLogMaxRows]: '500000',
    [K.submissionDays]: '0', [K.submissionMaxRows]: '0',
  }, {})
  const logs = policy.scopes.find(s => s.scope === 'activity_logs')!
  const subs = policy.scopes.find(s => s.scope === 'submissions')!
  assert.deepEqual([logs.days, logs.maxRows], [365, 500_000])
  // Citizen correspondence keeps its "no automatic deletion" stance even while
  // the audit log is capped: the records schedule is not a capacity decision.
  assert.deepEqual([subs.days, subs.maxRows], [0, 0])
})

test('a stored value outside the bounds is refused in Vietnamese, for the admin form', () => {
  assert.throws(
    () => buildRetentionPolicy({ [K.activityLogDays]: '7' }, {}),
    (error: unknown) => error instanceof RetentionPolicyValidationError && /Số ngày lưu/.test((error as Error).message),
  )
})

test('0 days is accepted as "keep indefinitely" rather than rejected', () => {
  const policy = buildRetentionPolicy({ [K.activityLogDays]: '0' }, {})
  assert.equal(policy.scopes.find(s => s.scope === 'activity_logs')!.days, 0)
})

// ─── The schedule ────────────────────────────────────────────────────────────
function policyAt(hour: number, autoEnabled = true): RetentionPolicy {
  return buildRetentionPolicy({ [K.runHour]: String(hour), [K.autoEnabled]: autoEnabled ? '1' : '0' }, {})
}
const AT_3AM = new Date(2026, 6, 30, 3, 5, 0)

test('the switch being off stops the purge, and says that is why', () => {
  const decision = isRunDue(policyAt(3, false), AT_3AM, null)
  assert.equal(decision.due, false)
  assert.equal(decision.reason, 'disabled')
})

test('a deployment that has never purged runs at the first opportunity', () => {
  // Not made to wait for the configured hour: the first run is usually the one
  // clearing years of accumulated rows, and it should not need a night's wait.
  const decision = isRunDue(policyAt(3), new Date(2026, 6, 30, 14, 0, 0), null)
  assert.equal(decision.due, true)
  assert.equal(decision.reason, 'never-run')
})

test('outside the configured hour nothing fires', () => {
  const decision = isRunDue(policyAt(3), new Date(2026, 6, 30, 14, 0, 0), new Date(2026, 6, 29, 3, 5, 0))
  assert.equal(decision.due, false)
  assert.equal(decision.reason, 'not-due')
})

test('at the configured hour the day after the last run, it fires once', () => {
  const yesterday = new Date(2026, 6, 29, 3, 5, 0)
  assert.equal(isRunDue(policyAt(3), AT_3AM, yesterday).due, true)
  // Having just run, the remaining ticks in the same hour must not purge again.
  const justRan = new Date(2026, 6, 30, 3, 0, 30)
  assert.equal(isRunDue(policyAt(3), new Date(2026, 6, 30, 3, 50, 0), justRan).due, false)
})

test('a missed night is caught up instead of waiting for the next one', () => {
  // A server down over the window would otherwise skip a whole day silently.
  const stale = new Date(AT_3AM.getTime() - STALE_RUN_MS - 1000)
  const decision = isRunDue(policyAt(3), new Date(2026, 6, 30, 17, 0, 0), stale)
  assert.equal(decision.due, true)
  assert.equal(decision.reason, 'stale')
})

test('the staleness catch-up still obeys the switch', () => {
  const stale = new Date(AT_3AM.getTime() - STALE_RUN_MS - 1000)
  assert.equal(isRunDue(policyAt(3, false), AT_3AM, stale).reason, 'disabled')
})

// ─── Source contracts ────────────────────────────────────────────────────────
test('saving the policy validates everything before writing anything', () => {
  const policySource = codeOnly(source('../server/services/retention-policy.ts'))
  // One bad field must not leave half a policy applied — a saved run hour with a
  // rejected window would delete on a schedule nobody configured.
  const save = policySource.slice(policySource.indexOf('export async function saveRetentionPolicy'))
  const firstWrite = save.search(/db\s*\.\s*(insert|update)|\.onDuplicateKeyUpdate/)
  assert.ok(firstWrite > 0, 'saveRetentionPolicy no longer writes; this contract needs rewriting')
  for (const parser of ['parseRunHour', 'parseMaxRows', 'parseRetentionDays']) {
    const at = save.indexOf(parser)
    assert.ok(at > 0 && at < firstWrite, `${parser} must run before the first write`)
  }
  // The switch is checked as a real boolean here, not read leniently: on the way
  // in there is no reason to guess at "off", and a guess would be a guess about
  // whether to keep deleting.
  const guard = save.indexOf("typeof input.autoEnabled !== 'boolean'")
  assert.ok(guard > 0 && guard < firstWrite, 'the switch is written without being validated')
})

test('the read endpoint is gated on settings and never deletes', () => {
  const get = source('../server/api/admin/settings/retention.get.ts')
  assert.match(get, /requireResourcePermission\(admin, 'settings', 'read'\)/)
  assert.doesNotMatch(codeOnly(get), /runDataRetention|runRetentionPass|\.delete\(|DELETE FROM/)
  // The banked counter plus the live count is the lifetime figure.
  assert.match(get, /lifetimeTotal: total \+ purgedTotal/)
})

test('changing what gets deleted needs an update grant and leaves an audit trail', () => {
  const put = codeOnly(source('../server/api/admin/settings/retention.put.ts'))
  assert.match(put, /requireResourcePermission\(admin, 'settings', 'update'\)/)
  // "Who shortened the audit-log window, and from what" is exactly the question
  // this table has to be able to answer about itself.
  assert.match(put, /activityLogs\)|insert\(activityLogs/)
  assert.match(put, /resource: 'data_retention'/)
  assert.match(put, /RetentionPolicyValidationError/)
  assert.match(put, /statusCode: 400/)
})

test('the manual run is a POST that needs explicit confirmation and reports a collision', () => {
  const run = codeOnly(source('../server/api/admin/settings/retention-run.post.ts'))
  assert.match(run, /requireResourcePermission\(admin, 'settings', 'update'\)/)
  // Never reachable by a link, a prefetch or a refresh.
  assert.match(run, /confirm/)
  assert.match(run, /statusCode: 400/)
  // A declined forced pass can only mean the lock was held. Reporting success
  // with zero deletions would read as "nothing to delete", which is a lie.
  assert.match(run, /statusCode: 409/)
  assert.match(run, /force: true/)
  // The operator triggers a run; they do not get to pass a window as a parameter.
  assert.doesNotMatch(run, /activityLogDays:\s*(body|Number\(body)/)
})

test('the retention keys stay out of the generic settings form', () => {
  // Values that decide what is deleted get their own gated endpoint, not a slot
  // in the free-form key/value writer.
  const general = source('../server/api/admin/settings/index.put.ts')
  for (const key of Object.values(RETENTION_SETTING_KEYS)) {
    assert.doesNotMatch(general, new RegExp(key), `${key} is writable through the generic form`)
  }
})

test('cron and the scheduler share one lock, so neither can purge twice', () => {
  const scheduler = codeOnly(source('../server/services/retention-scheduler.ts'))
  assert.match(scheduler, /GET_LOCK/)
  assert.match(scheduler, /RELEASE_LOCK/)
  assert.match(scheduler, /cdkt:data:retention/)
  // A zero timeout means a second runner declines instead of queueing behind the
  // first and then purging again the moment it finishes.
  assert.match(scheduler, /LOCK_TIMEOUT_SECONDS = 0/)
})

test('the scheduler cannot take the worker down and does not hold it up', () => {
  const scheduler = codeOnly(source('../server/services/retention-scheduler.ts'))
  // A rejected timer callback would be an unhandled rejection in the request
  // worker, so failures are logged instead of thrown.
  assert.match(scheduler, /retention\.scheduler_failed/)
  // Unref'd: a background purge timer must not keep the process alive.
  assert.equal((scheduler.match(/\.unref\?\.\(\)/g) ?? []).length, 2, 'both the interval and the warm-up must be unref\'d')
  // Deferred first pass: at boot the database may not be reachable and init/seed
  // are still running, so an immediate tick would just log a failure.
  assert.match(scheduler, /setTimeout\(tick/)
})

test('the page reads and writes only the retention endpoints and confirms the purge', () => {
  const pageSource = source('../app/pages/admin/settings/data-retention.vue')
  const descriptor = parse(pageSource, { filename: 'data-retention.vue' })
  assert.equal(descriptor.errors.length, 0)
  const script = descriptor.descriptor.scriptSetup?.content ?? ''
  const template = descriptor.descriptor.template?.content ?? ''

  assert.match(script, /'\/api\/admin\/settings\/retention'/)
  assert.match(script, /'\/api\/admin\/settings\/retention-run'/)
  // Irreversible, so it asks first — and sends the flag the endpoint requires.
  assert.match(script, /confirm\(/)
  assert.match(script, /confirm: true/)
  // The three figures the operator reasons about: live, banked, and the sum.
  for (const field of [/scope\.total/, /scope\.purgedTotal/, /scope\.lifetimeTotal/]) {
    assert.match(template, field)
  }
  // "On but no condition set" deletes nothing; saying "all good" would be wrong.
  assert.match(script, /nothingWillBeDeleted/)
  // Operator- and citizen-supplied text; interpolation only.
  assert.doesNotMatch(template, /v-html/)
})

test('the menu entry is hidden without the grant the endpoint requires', () => {
  const layout = source('../app/layouts/admin.vue')
  assert.match(layout, /hasPermission\('settings', 'read'\).*\/admin\/settings\/data-retention/s)
})
