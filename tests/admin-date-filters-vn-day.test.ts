import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { DAY_MS, vietnamDayEndExclusive, vietnamDayStart } from '../server/utils/vn-day-range'

/**
 * "Từ ngày / Đến ngày" on /admin/chatbot/sessions and /admin/users/activity.
 *
 * Both pages use `<input type="date">` (a Vietnamese calendar day). Before:
 *  - chatbot sessions: `to=2026-10-14` was read by `new Date()` as 00:00 UTC of the
 *    14th, so the end day was excluded entirely and both bounds were 7 h off;
 *  - activity logs: the page sent `…T00:00:00` / `…T23:59:59` with no zone and the
 *    server parsed them in the PROCESS time zone, so the audited period moved with
 *    the container's TZ.
 * Now both take bare `YYYY-MM-DD`, read as [00:00 +07, next day 00:00 +07) through
 * the shared helper (server/utils/vn-day-range.ts), whatever TZ says, and anything
 * else is a 400 (both endpoints already refused bad dates rather than ignoring them).
 *
 * Runs the real handlers (tests/_admin-date-filters-probe.ts) in child processes
 * under three time zones and compares the parameters Drizzle sends to MySQL — UTC
 * strings, matching how `activity_logs.created_at` (TIMESTAMP) and
 * `chat_sessions.started_at` (DATETIME written with UTC_TIMESTAMP()) are stored.
 */

function probe(tz: string) {
  const r = spawnSync(process.execPath, [
    '--experimental-strip-types', '--experimental-test-module-mocks', '--no-warnings',
    '--import', './scripts/ts-resolver.mjs', 'tests/_admin-date-filters-probe.ts',
  ], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', env: { ...process.env, TZ: tz }, timeout: 60_000 })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout) as Record<string, string[] | { status: number }>
}

const zones = ['UTC', 'Asia/Ho_Chi_Minh', 'America/New_York']
const results = Object.fromEntries(zones.map((tz) => [tz, probe(tz)]))
const COLUMNS = { sessions: '`chat_sessions`.`started_at`', activity: '`activity_logs`.`created_at`' } as const

for (const tz of zones) {
  for (const [name, column] of Object.entries(COLUMNS)) {
    const r = results[tz]!
    test(`TZ=${tz} ${name}: a one-day filter covers exactly that Vietnam calendar day (end day included)`, () => {
      const [sql, start, end] = r[`${name}:oneDay`] as string[]
      assert.ok(sql!.includes(`${column} >= ?`), sql)
      assert.ok(sql!.includes(`${column} < ?`), `end is exclusive (lt, not lte): ${sql}`)
      assert.equal(start, '2026-10-13 17:00:00.000', '00:00 on 14/10 in Vietnam')
      assert.equal(end, '2026-10-14 17:00:00.000', '00:00 on 15/10 in Vietnam — exclusive')
    })

    test(`TZ=${tz} ${name}: a month range and an end-only filter include their end day`, () => {
      const [, start, end] = r[`${name}:range`] as string[]
      assert.equal(start, '2026-09-30 17:00:00.000')
      assert.equal(end, '2026-10-31 17:00:00.000')
      const [, toOnly] = r[`${name}:toOnly`] as string[]
      assert.equal(toOnly, '2026-12-31 17:00:00.000', 'year boundary rolls into 2027-01-01 00:00 +07')
    })

    test(`TZ=${tz} ${name}: impossible dates, zone-less times, ISO instants and reversed ranges are 400`, () => {
      for (const label of ['impossible', 'zonelessTime', 'isoInstant', 'reversed']) {
        assert.deepEqual(r[`${name}:${label}`], { status: 400 }, label)
      }
    })
  }
}

test('the bounds do not depend on the process time zone', () => {
  assert.deepEqual(results.UTC, results['Asia/Ho_Chi_Minh'])
  assert.deepEqual(results.UTC, results['America/New_York'])
})

test('vn-day-range helper: start/end-exclusive and rejection of non-dates', () => {
  assert.equal(vietnamDayStart('2026-10-14')!.toISOString(), '2026-10-13T17:00:00.000Z')
  assert.equal(vietnamDayEndExclusive('2026-10-14')!.toISOString(), '2026-10-14T17:00:00.000Z')
  assert.equal(vietnamDayEndExclusive('2026-10-14')!.getTime() - vietnamDayStart('2026-10-14')!.getTime(), DAY_MS)
  assert.equal(vietnamDayStart(' 2026-10-14 ')!.toISOString(), '2026-10-13T17:00:00.000Z')
  for (const bad of ['2026-02-30', '2026-13-01', '2026-10-14T00:00:00', 'yesterday', '', 20261014, null, undefined, ['2026-10-14']]) {
    assert.equal(vietnamDayStart(bad), null, String(bad))
    assert.equal(vietnamDayEndExclusive(bad), null, String(bad))
  }
  assert.equal(vietnamDayStart('2028-02-29')!.toISOString(), '2028-02-28T17:00:00.000Z', 'leap day is real')
})
