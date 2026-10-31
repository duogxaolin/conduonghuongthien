import assert from 'node:assert/strict'
import test, { after, afterEach, beforeEach, mock } from 'node:test'

/**
 * "This month" and "this day" of AI spend: `GET /api/admin/ai/usage`
 * (server/api/admin/ai/usage.get.ts — the AI dashboard), `GET /api/admin/ai/budget`
 * (`budget/index.get.ts`) and the budget guard every AI call goes through
 * (`checkBudget`, server/utils/ai-budget.ts).
 *
 * Where the time zone actually enters (checked, not assumed — slice R5):
 *  - Drizzle binds a `Date` compared with a TIMESTAMP column as a UTC string
 *    (`mapToDriverValue` = `toISOString()`), and reads dates as strings (its mysql2
 *    session sets `typeCast` to `field.string()`). The pool's `timezone: '+07:00'` is
 *    therefore not involved in any of these queries.
 *  - MySQL reads that string, and evaluates `DATE(created_at)`, in the SESSION time
 *    zone — `SYSTEM` = UTC on the deployed container (docker-compose.yml, the
 *    `vn-day-range.ts` convention; `mysql-tz-evidence.log` in the slice's proof
 *    folder: MySQL 8.0.46, `@@session.time_zone = SYSTEM`, `@@system_time_zone = UTC`).
 *    That convention is kept, not changed.
 *  - The month start was `new Date(now.getFullYear(), now.getMonth(), 1)` — the
 *    PROCESS time zone. The Docker image and compose set `TZ=Asia/Ho_Chi_Minh`;
 *    the PM2 path (`ecosystem.config.cjs`) does not. Under a UTC process, from 00:00
 *    to 07:00 on the 1st (Vietnam time) "this month" is still the previous month in
 *    UTC: the whole of last month's spend counts against the new month's budget (AI
 *    calls blocked at the month start when last month ended near the cap) and the
 *    dashboard shows last month's total as this month's (FINDING-R5-3).
 *  - The daily breakdown grouped by `DATE(created_at)` — the UTC day, whatever the
 *    process — so every call between 00:00 and 07:00 Vietnam time landed on the
 *    previous day, and a call on the 1st at 02:00 showed on the last day of the
 *    previous month while counted in this month's total. The window was a rolling
 *    `now − 30 days`, so its first bar was a partial day (FINDING-R5-4).
 *
 * The invariants:
 *   - both routes need `ai.read`;
 *   - "this month" is the Vietnam calendar month of now, whatever the process TZ —
 *     for the dashboard and for `checkBudget`;
 *   - a day of the daily breakdown is a Vietnam calendar day; the window is the 30
 *     Vietnam days ending today, whole days;
 *   - `budget` creates the default row when the seed has not run yet.
 *
 * Real h3 app + `admin-auth`, SQL on SQLite (`_ai-route-harness.ts`). SQLite runs
 * `DATE()` as MySQL does for a UTC session; `CONVERT_TZ` with two numeric offsets — a
 * pure shift — is registered as a function that accepts only the one form the
 * handler uses (`'+00:00'` → `'+07:00'`) and throws on anything else. The same
 * compiled query was replayed on MySQL 8.0.46 (`mysql-usage-daily-replay.log`). The
 * clock is pinned with `mock.timers` (Date only); the process time zone is switched
 * per case through `process.env.TZ`, which Node applies at once.
 */

const { startAiRouteHarness } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  routes: async load => [
    { method: 'get', path: '/api/admin/ai/usage', handler: await load('../server/api/admin/ai/usage.get') },
    { method: 'get', path: '/api/admin/ai/budget', handler: await load('../server/api/admin/ai/budget/index.get') },
  ],
})
after(() => h.server.close())
const { aiUsageLogs, aiBudgetSettings } = h.schema
const { checkBudget } = await import('../server/utils/ai-budget')

const ORIGINAL_TZ = process.env.TZ
/** `YYYY-MM-DDTHH:MM` in Vietnam time → the instant. */
const vn = (local: string) => new Date(`${local}:00+07:00`)

function modelConvertTz() {
  h.harness.sqlite.function('convert_tz', { deterministic: true }, (value, from, to) => {
    if (from !== '+00:00' || to !== '+07:00') throw new Error(`CONVERT_TZ(${String(from)}, ${String(to)}) is not modelled`)
    if (value === null) return null
    const instant = Date.parse(`${String(value).replace(' ', 'T')}Z`)
    if (!Number.isFinite(instant)) throw new Error(`CONVERT_TZ of a non-datetime: ${String(value)}`)
    return new Date(instant + 7 * 3600_000).toISOString().slice(0, 19).replace('T', ' ')
  })
}

let reader: Awaited<ReturnType<typeof h.account>>
beforeEach(async () => {
  h.reset()
  modelConvertTz()
  reader = await h.account([{ resource: 'ai', canRead: true }], 'xemai')
  await h.harness.db.insert(aiBudgetSettings).values({ id: 1, monthlyBudgetVnd: 1000, warningThresholdPct: 80 })
})
afterEach(() => {
  mock.timers.reset()
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

function at(now: Date, timeZone: string) {
  process.env.TZ = timeZone
  mock.timers.reset()
  mock.timers.enable({ apis: ['Date'], now })
}
async function spend(when: Date, costVnd: number, serviceKey = 'translation_article', success = true) {
  await h.harness.db.insert(aiUsageLogs).values({
    serviceKey, provider: 'openai', model: 'gpt-4o-mini', promptTokens: 10, completionTokens: 5, totalTokens: 15,
    costVnd: costVnd.toFixed(2), success, createdAt: when,
  })
}
const usage = async () => {
  const response = await h.request('GET', '/api/admin/ai/usage', reader)
  assert.equal(response.status, 200, JSON.stringify(response.body))
  return response.body as { usage: Record<string, number>, byService: Array<Record<string, unknown>>, daily: Array<{ day: string, costVnd: number, requests: number }>, budget: Record<string, number> }
}

/** October uses the whole budget (1 000 VND), the first of it at 00:30 on the 1st (= 30 Sep 17:30 UTC). */
async function seedOctober() {
  await spend(vn('2026-10-01T00:30'), 5)
  await spend(vn('2026-10-31T20:00'), 995)
}
/** A little spent since 00:00 on 1 November (Vietnam time) — before 07:00, i.e. still 31 October in UTC. */
async function seedNovemberStart() {
  await spend(vn('2026-11-01T00:00'), 4)
  await spend(vn('2026-11-01T02:00'), 6)
}

test('without ai.read: no session → 401, another resource → 403, for both routes', async () => {
  const editor = await h.account([{ resource: 'news', canRead: true, canUpdate: true }], 'bientap')
  for (const path of ['/api/admin/ai/usage', '/api/admin/ai/budget']) {
    assert.equal((await h.request('GET', path, null)).status, 401, path)
    assert.equal((await h.request('GET', path, editor)).status, 403, path)
  }
})

test('the dashboard: this month\'s cost, tokens, requests by service, success rate and budget use', async () => {
  at(vn('2026-10-28T10:00'), 'Asia/Ho_Chi_Minh')
  await spend(vn('2026-09-30T23:00'), 999) // September: not this month
  await spend(vn('2026-10-02T09:00'), 100, 'translation_article')
  await spend(vn('2026-10-20T09:00'), 150, 'moderation')
  await spend(vn('2026-10-27T09:00'), 50, 'moderation', false)
  const body = await usage()
  assert.deepEqual(body.usage, { monthlyCostVnd: 300, totalPromptTokens: 30, totalCompletionTokens: 15, totalRequests: 3, successRate: (2 / 3) * 100 })
  assert.deepEqual(body.byService.map(row => [row.serviceKey, row.costVnd, row.requests]).sort(), [['moderation', 200, 2], ['translation_article', 100, 1]])
  assert.deepEqual(body.budget, { monthlyBudgetVnd: 1000, warningThresholdPct: 80, usagePercent: 30 })
})

test('an empty month: zero cost, a 100 % success rate, no budget row → 0 %', async () => {
  at(vn('2026-10-28T10:00'), 'Asia/Ho_Chi_Minh')
  h.harness.sqlite.prepare('DELETE FROM ai_budget_settings').run()
  const body = await usage()
  assert.deepEqual(body.usage, { monthlyCostVnd: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalRequests: 0, successRate: 100 })
  assert.deepEqual(body.budget, { monthlyBudgetVnd: 0, warningThresholdPct: 80, usagePercent: 0 })
})

for (const timeZone of ['Asia/Ho_Chi_Minh', 'UTC']) {
  test(`${timeZone === 'UTC' ? 'FINDING-R5-3: ' : ''}the dashboard's "this month" is the Vietnam calendar month — process TZ ${timeZone}`, async () => {
    await seedOctober()
    at(vn('2026-10-31T23:30'), timeZone)
    assert.equal((await usage()).usage.monthlyCostVnd, 1000, 'all of October, from 00:30 on the 1st')
    await seedNovemberStart()
    at(vn('2026-11-01T03:00'), timeZone)
    assert.equal((await usage()).usage.monthlyCostVnd, 10, 'November so far: 4 + 6, nothing of October')
  })

  test(`${timeZone === 'UTC' ? 'FINDING-R5-3: ' : ''}checkBudget's month is the Vietnam calendar month — process TZ ${timeZone}`, async () => {
    await seedOctober()
    at(vn('2026-10-31T23:30'), timeZone)
    const october = await checkBudget(h.harness.db as never, 'translation_article')
    assert.deepEqual([october.allowed, october.monthlySpendVnd], [false, 1000], 'October\'s budget is used up')
    await seedNovemberStart()
    at(vn('2026-11-01T03:00'), timeZone)
    const november = await checkBudget(h.harness.db as never, 'translation_article')
    assert.deepEqual([november.allowed, november.monthlySpendVnd], [true, 10], 'October\'s spend does not block November')
  })
}

test('FINDING-R5-4: a day of the daily breakdown is a Vietnam calendar day', async () => {
  at(vn('2026-11-01T03:00'), 'Asia/Ho_Chi_Minh')
  await seedOctober()
  await seedNovemberStart()
  await spend(vn('2026-10-28T03:00'), 20) // 27 Oct 20:00 UTC
  await spend(vn('2026-10-27T23:00'), 30)
  const body = await usage()
  assert.deepEqual(body.daily, [
    { day: '2026-11-01', costVnd: 10, requests: 2 },
    { day: '2026-10-31', costVnd: 995, requests: 1 },
    { day: '2026-10-28', costVnd: 20, requests: 1 },
    { day: '2026-10-27', costVnd: 30, requests: 1 },
  ])
  // The bars of this month's days add up to the month's total.
  const novemberDays = body.daily.filter(row => row.day.startsWith('2026-11-'))
  assert.equal(novemberDays.reduce((total, row) => total + row.costVnd, 0), body.usage.monthlyCostVnd)
})

test('FINDING-R5-4: the daily window is the 30 Vietnam days ending today, whole days', async () => {
  at(vn('2026-10-28T10:00'), 'Asia/Ho_Chi_Minh')
  await spend(vn('2026-09-28T23:00'), 1) // 30 days before today: outside
  await spend(vn('2026-09-29T00:00'), 2) // 29 days before today, first second: inside
  await spend(vn('2026-10-28T09:59'), 3) // today
  const body = await usage()
  // What the window takes in; which day each row is labelled with is the test above.
  assert.equal(body.daily.reduce((total, row) => total + row.costVnd, 0), 5)
  assert.equal(body.daily.reduce((total, row) => total + row.requests, 0), 2)
})

test('a database failure is a 500, nothing half-written', async () => {
  at(vn('2026-10-28T10:00'), 'Asia/Ho_Chi_Minh')
  h.harness.failNext(/from `ai_usage_logs`/)
  assert.equal((await h.request('GET', '/api/admin/ai/usage', reader)).status, 500)
})

test('budget: the stored row as it is', async () => {
  h.harness.sqlite.prepare('UPDATE ai_budget_settings SET monthly_budget_vnd = 2500000, warning_threshold_pct = 90').run()
  const response = await h.request('GET', '/api/admin/ai/budget', reader)
  assert.equal(response.status, 200)
  const budget = response.body.budget as Record<string, unknown>
  assert.deepEqual([budget.id, budget.monthlyBudgetVnd, budget.warningThresholdPct], [1, 2500000, 90])
  assert.equal(h.harness.rows(aiBudgetSettings).length, 1)
})

test('budget: before the seed has run, the default row (0 = no monthly cap, warn at 80 %) is created and returned', async () => {
  h.harness.sqlite.prepare('DELETE FROM ai_budget_settings').run()
  const response = await h.request('GET', '/api/admin/ai/budget', reader)
  assert.equal(response.status, 200)
  const budget = response.body.budget as Record<string, unknown>
  assert.deepEqual([budget.id, budget.monthlyBudgetVnd, budget.warningThresholdPct], [1, 0, 80])
  assert.deepEqual(h.harness.rows(aiBudgetSettings).map(row => [row.id, row.monthlyBudgetVnd, row.warningThresholdPct]), [[1, 0, 80]])
})
