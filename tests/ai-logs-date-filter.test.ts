import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'

/**
 * GET /api/admin/ai/logs — the startDate/endDate filter from AiLogsTab's two
 * `<input type="date">` fields.
 *
 * The old handler read the start as UTC midnight and closed the end with
 * `setHours(23, 59, 59, 999)` in the PROCESS time zone. The container runs
 * TZ=Asia/Ho_Chi_Minh, where 2026-10-14..2026-10-14 meant 00:00Z → 16:59:59Z: 17
 * hours, the first 7 hours of the Vietnamese day missing. Now both bounds are the
 * Vietnam calendar day, [00:00 +07, next day 00:00 +07), whatever TZ says.
 *
 * Runs the real handler (tests/_ai-logs-date-probe.ts) in child processes under
 * two time zones and compares the bound parameters Drizzle sends to MySQL — UTC
 * strings, since `created_at` is a TIMESTAMP and the session runs in UTC.
 */

function probe(tz: string) {
  const r = spawnSync(process.execPath, [
    '--experimental-strip-types', '--experimental-test-module-mocks', '--no-warnings',
    '--import', './scripts/ts-resolver.mjs', 'tests/_ai-logs-date-probe.ts',
  ], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', env: { ...process.env, TZ: tz }, timeout: 60_000 })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout) as Record<string, string[]>
}

const zones = ['UTC', 'Asia/Ho_Chi_Minh', 'America/New_York']
const results = Object.fromEntries(zones.map((tz) => [tz, probe(tz)]))

for (const tz of zones) {
  test(`TZ=${tz}: a one-day filter covers exactly that Vietnam calendar day`, () => {
    const [sql, start, end] = results[tz]!.oneDay!
    assert.match(sql!, /`created_at` >= \? and `ai_usage_logs`\.`created_at` < \?/)
    assert.equal(start, '2026-10-13 17:00:00.000', '00:00 on 14/10 in Vietnam')
    assert.equal(end, '2026-10-14 17:00:00.000', '00:00 on 15/10 in Vietnam — exclusive')
  })

  test(`TZ=${tz}: a month range is inclusive of both end days`, () => {
    const [, start, end] = results[tz]!.range!
    assert.equal(start, '2026-09-30 17:00:00.000')
    assert.equal(end, '2026-10-31 17:00:00.000')
  })

  test(`TZ=${tz}: impossible or non-date values are ignored, not rolled over`, () => {
    for (const label of ['impossible', 'notADate']) {
      const [sql, ...params] = results[tz]![label]!
      assert.deepEqual(params, [], `${label}: ${sql}`)
    }
  })
}

test('the bounds do not depend on the process time zone', () => {
  assert.deepEqual(results.UTC, results['Asia/Ho_Chi_Minh'])
  assert.deepEqual(results.UTC, results['America/New_York'])
})
