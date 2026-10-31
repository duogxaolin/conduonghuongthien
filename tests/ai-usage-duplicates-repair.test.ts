import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { beforeEach } from 'node:test'

/**
 * `npm run db:repair-ai-usage-duplicates` — the one-off cleanup of the `delify_router`
 * rows the Delify "Đồng bộ" wrote into `ai_usage_logs` before 2026-10-31 (each copied a
 * request the gateway had already logged: the spend counted twice; before R5-8 every sync
 * on MySQL inserted the history again).
 *
 * What is pinned:
 *   - only `delify_router` rows are ever deleted — a gateway or test-call row never is,
 *     even when it is the twin;
 *   - `exact` = one twin inside the clock-skew band, one to one (equal tokens, or the
 *     gateway's prompt + 2000 for rows logged before 5adab79a), and identical copies of
 *     such a row; `review` = identical copies of a row that is kept; everything else is
 *     kept with its reason (tokens that differ, a tool loop's two requests, a failed
 *     request, two twins, a twin away from the skew, another model, another provider);
 *   - the band is the anchors' median offset ± 30 s, so retries of one paragraph pair
 *     with the right twin and a lone pair far from the skew is not taken;
 *   - preview reads only; `--apply` deletes and audits in ONE transaction under the named
 *     lock, refuses when the lock is held, deletes nothing when the audit fails; a second
 *     run has nothing left; the spend drops by exactly the deleted cost.
 *
 * Drizzle's MySQL dialect builds the SQL; it runs on SQLite (`_sqlite-mysql-db.ts`).
 */

const { aiUsageLogs, activityLogs } = await import('../server/db/schema')
const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const repair = await import('../server/services/ai-usage-duplicates-repair')
const { planAiUsageDuplicateRepair, runAiUsageDuplicateRepair, REPAIR_LOCK_NAME } = repair

const harness = createSqliteMysqlDb([aiUsageLogs, activityLogs])
const db = harness.db as never

type Json = Record<string, unknown>
const T0 = Date.parse('2026-09-25T11:36:00.000Z')
const at = (seconds: number) => new Date(T0 + seconds * 1000)
/** The gateway logs a request 150 s after the router's timestamp — the skew measured on dev (137–152 s). */
const SKEW = 150

type Row = { id: number, serviceKey?: string, provider?: string, model?: string, at: number, prompt: number, completion: number, success?: boolean, cost?: string, userId?: number | null, executionMs?: number }
const row = (r: Row) => ({
  id: r.id,
  serviceKey: r.serviceKey ?? 'delify_router',
  provider: r.provider ?? 'delify',
  model: r.model ?? 'delify-5.5',
  promptTokens: r.prompt,
  completionTokens: r.completion,
  totalTokens: r.prompt + r.completion,
  costUsd: r.cost ?? '0.001000',
  costVnd: (Number(r.cost ?? '0.001000') * 25500).toFixed(2),
  executionMs: r.executionMs ?? 1200,
  userId: r.userId ?? null,
  success: r.success ?? true,
  errorMessage: r.success === false ? 'HTTP 429' : null,
  createdAt: at(r.at),
})
const gw = (r: Row) => row({ serviceKey: 'translation_article', ...r })

/** The router rows and the gateway rows of one afternoon — one case per id, explained inline. */
const FIXTURE = [
  // 100 and 102: the same paragraph (82/7) translated twice, five minutes apart. Each has
  // two candidates within the window; the band pairs each with its own twin (3 and 2).
  row({ id: 100, at: -212, prompt: 82, completion: 7 }), gw({ id: 3, at: -212 + SKEW, prompt: 82, completion: 7 }),
  row({ id: 102, at: 20, prompt: 82, completion: 7 }), gw({ id: 2, at: 20 + SKEW, prompt: 82, completion: 7 }),
  // 101: one twin. 104: an identical copy of 101 written by a later sync (another officer).
  row({ id: 101, at: 0, prompt: 185, completion: 573, userId: 1 }), gw({ id: 1, at: SKEW, prompt: 185, completion: 573 }),
  row({ id: 104, at: 0, prompt: 185, completion: 573, userId: 2 }),
  // 103: a gateway row of before 5adab79a (the day before) still holds delify's 2000-token
  // overhead. 119 (A18 of the verifier): the same shape a day later — the gateway already
  // took the overhead off, so the router row is another request, not this one.
  row({ id: 103, at: -100_000, prompt: 30, completion: 10 }), gw({ id: 4, at: -100_000 + SKEW, prompt: 2030, completion: 10, serviceKey: 'chatbot' }),
  row({ id: 119, at: 280, prompt: 640, completion: 64 }), gw({ id: 17, at: 280 + SKEW, prompt: 2640, completion: 64, serviceKey: 'chatbot' }),
  // 105: the router counted the prompt 128 tokens higher (same completion) — a near twin, for
  // review. 111: a copy of it. 117: the gateway's prompt is the larger one; 118: 300 tokens
  // apart — neither is a near twin.
  row({ id: 105, at: 60, prompt: 2781, completion: 1536 }), gw({ id: 5, at: 60 + SKEW + 2, prompt: 2653, completion: 1536 }),
  row({ id: 111, at: 60, prompt: 2781, completion: 1536, userId: 2 }),
  row({ id: 117, at: 240, prompt: 800, completion: 80 }), gw({ id: 15, at: 240 + SKEW, prompt: 820, completion: 80 }),
  row({ id: 118, at: 260, prompt: 1300, completion: 130 }), gw({ id: 16, at: 260 + SKEW, prompt: 1000, completion: 130 }),
  // 106 + 107: one tool-loop turn — two router requests, one gateway row with their sum.
  row({ id: 106, at: 80, prompt: 2744, completion: 44 }), row({ id: 107, at: 90, prompt: 2323, completion: 65 }),
  gw({ id: 6, at: 90 + SKEW + 5, prompt: 5067, completion: 109, serviceKey: 'chatbot' }),
  // 108: a request the router refused (429); the gateway row with the same tokens is another request.
  row({ id: 108, at: 100, prompt: 500, completion: 100, success: false, cost: '0.000000' }), gw({ id: 7, at: 100 + SKEW, prompt: 500, completion: 100 }),
  // 109: two gateway rows fit (two identical requests two seconds apart, the router listed one).
  row({ id: 109, at: 120, prompt: 700, completion: 70 }), gw({ id: 8, at: 120 + SKEW, prompt: 700, completion: 70 }), gw({ id: 9, at: 120 + SKEW - 2, prompt: 700, completion: 70 }),
  // 110: a lone pair 400 s the other way — an anchor, but far from the skew of every other pair.
  row({ id: 110, at: 140, prompt: 900, completion: 90 }), gw({ id: 10, at: 140 - 400, prompt: 900, completion: 90 }),
  // 112: another model. 113: the twin is logged under another provider.
  row({ id: 112, at: 160, prompt: 333, completion: 33, model: 'other-model' }), gw({ id: 11, at: 160 + SKEW, prompt: 333, completion: 33 }),
  row({ id: 113, at: 180, prompt: 444, completion: 44 }), gw({ id: 12, at: 180 + SKEW, prompt: 444, completion: 44, provider: 'openai' }),
  // 114: the twin is a "Gọi thử" row — a twin like any other, and never deleted itself.
  row({ id: 114, at: 200, prompt: 555, completion: 55 }), gw({ id: 13, at: 200 + SKEW, prompt: 555, completion: 55, serviceKey: 'test_call' }),
  // 115 + 116: two router requests (not copies: another cost) and ONE gateway row — which one is it?
  row({ id: 115, at: 220, prompt: 600, completion: 60 }), row({ id: 116, at: 221, prompt: 600, completion: 60, cost: '0.002000' }),
  gw({ id: 14, at: 220 + SKEW, prompt: 600, completion: 60 }),
]
const GATEWAY_IDS = FIXTURE.filter(r => r.serviceKey !== 'delify_router').map(r => r.id).sort((a, b) => a - b)

const EXACT = [[100, 'gateway_twin', 3, null], [101, 'gateway_twin', 1, null], [102, 'gateway_twin', 2, null], [103, 'gateway_twin_overhead', 4, null], [104, 'repeat_import', null, 101], [114, 'gateway_twin', 13, null]]
const REVIEW = [[105, 'near_twin', 5, null], [111, 'repeat_import', null, 105]]
const KEPT = [[106, 'no_twin'], [107, 'no_twin'], [108, 'failed_request'], [109, 'ambiguous'], [110, 'outside_band'], [112, 'no_twin'], [113, 'no_twin'], [115, 'ambiguous'], [116, 'ambiguous'], [117, 'no_twin'], [118, 'no_twin'], [119, 'no_twin']]

const ids = () => harness.rows(aiUsageLogs).map(r => r.id as number).sort((a, b) => a - b)
const spend = () => harness.rows(aiUsageLogs).reduce((total, r) => total + Number(r.costVnd), 0)
const audits = () => harness.rows(activityLogs)

/** A mysql2 pool as `withNamedLock` sees it: GET_LOCK answers `held ? 0 : 1`. */
function fakePool(held = false) {
  const lockCalls: Array<[string, unknown[]]> = []
  const pool = {
    getConnection: async () => ({
      query: async (sql: string, params: unknown[]) => {
        lockCalls.push([sql, params])
        return [[{ acquired: held ? 0 : 1 }]]
      },
      release: () => {},
    }),
  }
  return { pool: pool as never, lockCalls }
}

beforeEach(async () => {
  harness.reset()
  await harness.db.insert(aiUsageLogs).values(FIXTURE)
})

test('the plan: one in-band twin each way → exact; copies follow their row; everything uncertain is kept with its reason', async () => {
  const report = await runAiUsageDuplicateRepair({ db })
  assert.deepEqual(report.exact.map(p => [p.id, p.reason, p.twinId, p.copyOf]), EXACT)
  assert.deepEqual(report.review.map(p => [p.id, p.reason, p.twinId, p.copyOf]), REVIEW)
  assert.deepEqual(report.kept.map(k => [k.id, k.reason]), KEPT)
  // The band: the anchors' median, not their mean — the lone -400 s pair does not move it.
  assert.deepEqual(report.band, { centerSeconds: 150, toleranceSeconds: 30, anchors: 4, anchorsInBand: 3 })
  assert.deepEqual([report.bandSource, report.anchorHistogram], ['anchors', { '-400': 1, '150': 3 }])
  assert.deepEqual(report.exact.filter(p => p.offsetSeconds !== null).map(p => p.offsetSeconds), [150, 150, 150, 150, 150])
  // Kept rows show what was considered, for the operator.
  assert.deepEqual(report.kept.find(k => k.id === 109)!.candidates, [{ id: 8, serviceKey: 'translation_article', offsetSeconds: 150 }, { id: 9, serviceKey: 'translation_article', offsetSeconds: 148 }])
  assert.deepEqual(report.kept.find(k => k.id === 110)!.candidates, [{ id: 10, serviceKey: 'translation_article', offsetSeconds: -400 }])
  assert.equal(report.routerRows, 20)
  assert.deepEqual(report.exact.map(p => p.promptDelta), [0, 0, 0, -2000, null, 0])
  assert.deepEqual(report.review.map(p => [p.promptDelta, p.offsetSeconds]), [[128, 152], [null, null]])
  assert.deepEqual(report.costVnd, { exact: 153, review: 51, kept: 306 })
  // Never a gateway row in a bucket.
  for (const planned of [...report.exact, ...report.review, ...report.kept]) assert.ok(!GATEWAY_IDS.includes(planned.id), String(planned.id))
})

test('preview reads only: nothing deleted, no audit row', async () => {
  const before = harness.statements.length
  const report = await runAiUsageDuplicateRepair({ db })
  assert.equal(report.applied, false)
  assert.equal(report.written, 0)
  assert.equal(ids().length, FIXTURE.length)
  assert.deepEqual(audits(), [])
  assert.ok(harness.statements.slice(before).every(sql => /^\s*select/i.test(sql)), harness.statements.slice(before).join('\n'))
})

test('--apply deletes exactly the exact rows, in one transaction with one audit row; the spend drops by exactly their cost', async () => {
  const { pool, lockCalls } = fakePool()
  const spendBefore = spend()
  const report = await runAiUsageDuplicateRepair({ apply: true, db, pool })
  assert.deepEqual([report.applied, report.includeReview, report.written, report.skipped], [true, false, 6, 0])
  const deleted = EXACT.map(([id]) => id)
  assert.deepEqual(ids(), FIXTURE.map(r => r.id).filter(id => !deleted.includes(id)).sort((a, b) => a - b))
  // Every gateway and test-call row is still there — the twins included.
  for (const id of GATEWAY_IDS) assert.ok(ids().includes(id), `gateway row ${id}`)
  assert.equal(Math.round((spendBefore - spend()) * 100) / 100, report.costVnd.exact)
  assert.equal(report.costVnd.exact, 153)

  assert.deepEqual(audits().map(a => [a.userId, a.action, a.resource, a.resourceId]), [[null, 'delete', 'ai', null]])
  assert.deepEqual(audits()[0]!.meta, {
    action: 'repair-ai-usage-duplicates', includeReview: false, deleted: 6, skipped: 0, costVnd: 153,
    band: { centerSeconds: 150, toleranceSeconds: 30, anchors: 4, anchorsInBand: 3 }, ids: deleted,
  })
  // The deletes and the audit row in the same transaction; every DELETE names the router rows' key.
  assert.equal(harness.transactionsBegun, 1)
  const deletes = harness.txStatements.filter(sql => /^\s*delete/i.test(sql))
  assert.ok(deletes.length > 0)
  for (const sql of deletes) assert.match(sql, /`ai_usage_logs`\.`service_key` = \?.*`ai_usage_logs`\.`provider` = \?/, sql)
  assert.ok(/^\s*insert into `activity_logs`/i.test(harness.txStatements.at(-1)!))
  // The named lock: taken without waiting, released.
  assert.deepEqual(lockCalls.map(([sql, params]) => [sql, params]), [['SELECT GET_LOCK(?, ?) AS acquired', [REPAIR_LOCK_NAME, 0]], ['SELECT RELEASE_LOCK(?)', [REPAIR_LOCK_NAME]]])

  // A second run: nothing certain left, nothing written, no second audit row. Its anchors
  // were deleted: it pairs in the band the first run recorded — the lone -400 s pair (now
  // the only anchor) does not become a band, 110 is still outside it.
  const again = await runAiUsageDuplicateRepair({ apply: true, db, pool: fakePool().pool })
  assert.deepEqual([again.exact.length, again.written, audits().length], [0, 0, 1])
  assert.deepEqual([again.band, again.bandSource, again.anchorHistogram], [report.band, 'previous_run', { '-400': 1 }])
  assert.equal(again.kept.find(k => k.id === 110)!.reason, 'outside_band')
  // `review` waits for --include-review: the near twin and its copy are still listed.
  assert.deepEqual(again.review.map(p => [p.id, p.reason, p.copyOf]), [[105, 'near_twin', null], [111, 'repeat_import', 105]])

  // README step 4 after step 3: the review rows go, in the first run's band.
  const step4 = await runAiUsageDuplicateRepair({ apply: true, includeReview: true, db, pool: fakePool().pool })
  assert.deepEqual([step4.written, audits().length, (audits()[1]!.meta as Json).ids], [2, 2, [105, 111]])
  for (const id of GATEWAY_IDS) assert.ok(ids().includes(id), `gateway row ${id}`)
})

test('--apply --include-review also deletes the review rows (the near twin and its copy) — and still no gateway row', async () => {
  const report = await runAiUsageDuplicateRepair({ apply: true, includeReview: true, db, pool: fakePool().pool })
  assert.deepEqual([report.written, report.skipped], [8, 0])
  const kept = KEPT.map(([id]) => id as number)
  assert.deepEqual(ids(), [...GATEWAY_IDS, ...kept].sort((a, b) => a - b))
  assert.deepEqual((audits()[0]!.meta as Json).ids, [100, 101, 102, 103, 104, 114, 105, 111])
  assert.equal((audits()[0]!.meta as Json).costVnd, 204)
})

test('a failed audit insert deletes nothing', async () => {
  harness.failNext(/^insert into `activity_logs`/)
  await assert.rejects(runAiUsageDuplicateRepair({ apply: true, db, pool: fakePool().pool }))
  assert.equal(ids().length, FIXTURE.length)
  assert.deepEqual(audits(), [])
})

test('the lock held by another run → refused before any read or write', async () => {
  const before = harness.statements.length
  await assert.rejects(runAiUsageDuplicateRepair({ apply: true, db, pool: fakePool(true).pool }), new RegExp(REPAIR_LOCK_NAME))
  assert.equal(harness.statements.length, before)
  assert.equal(ids().length, FIXTURE.length)
})

const asUsage = (r: ReturnType<typeof row>) => ({ ...r, serviceKey: r.serviceKey, createdAt: r.createdAt })
/** Three anchors at +150 s far from the rows under test — enough for a band of 150 ± 30. */
const anchorPairs = (from: number) => [0, 1, 2].flatMap(i => [
  row({ id: 900 + i, at: from + i * 1000, prompt: 9000 + i, completion: 9 }), gw({ id: 800 + i, at: from + i * 1000 + SKEW, prompt: 9000 + i, completion: 9 }),
])
const planOf = (rows: Array<ReturnType<typeof row>>) => planAiUsageDuplicateRepair(
  rows.filter(r => r.serviceKey === 'delify_router').map(asUsage), rows.filter(r => r.serviceKey !== 'delify_router').map(asUsage),
)
const reasonOf = (plan: ReturnType<typeof planOf>, id: number) => [...plan.exact, ...plan.review, ...plan.kept].find(p => p.id === id)?.reason

test('the +2000 overhead pairs only a gateway row logged BEFORE 5adab79a — one second before: paired; at the commit and after: not (verifier A18)', () => {
  // `git show -s --format=%cI 5adab79a` → 2026-09-24T11:51:36+01:00.
  assert.equal(repair.LEGACY_OVERHEAD_UNTIL.toISOString(), '2026-09-24T10:51:36.000Z')
  const cut = (repair.LEGACY_OVERHEAD_UNTIL.getTime() - T0) / 1000
  const plan = planOf([
    ...anchorPairs(-300_000),
    row({ id: 1, at: cut - 1 - SKEW, prompt: 500, completion: 100 }), gw({ id: 11, at: cut - 1, prompt: 2500, completion: 100 }),
    row({ id: 2, at: cut - SKEW, prompt: 600, completion: 100 }), gw({ id: 12, at: cut, prompt: 2600, completion: 100 }),
    row({ id: 3, at: cut + 86_400 - SKEW, prompt: 700, completion: 100 }), gw({ id: 13, at: cut + 86_400, prompt: 2700, completion: 100 }),
  ])
  assert.deepEqual([1, 2, 3].map(id => reasonOf(plan, id)), ['gateway_twin_overhead', 'no_twin', 'no_twin'])
})

test('pure planner: no anchor at all → no band, nothing deleted; a twin with success = false is not a twin', () => {
  // Each router row has two candidates: no pair is an anchor, so there is no band.
  const plan = planAiUsageDuplicateRepair(
    [row({ id: 1, at: 0, prompt: 10, completion: 1 })].map(asUsage),
    [gw({ id: 2, at: 150, prompt: 10, completion: 1 }), gw({ id: 3, at: 160, prompt: 10, completion: 1 })].map(asUsage),
  )
  assert.deepEqual([plan.band, plan.exact, plan.kept.map(k => [k.id, k.reason])], [null, [], [[1, 'no_band']]])
  const failedTwin = planAiUsageDuplicateRepair(
    [row({ id: 1, at: 0, prompt: 10, completion: 1 })].map(asUsage),
    [gw({ id: 2, at: 150, prompt: 10, completion: 1, success: false })].map(asUsage),
  )
  assert.deepEqual([failedTwin.exact, failedTwin.kept.map(k => [k.id, k.reason])], [[], [[1, 'no_twin']]])
  // A band needs MIN_ANCHORS (3) anchors, and most of them inside it.
  const pairs = (offsets: number[], previous: Parameters<typeof planAiUsageDuplicateRepair>[2] = null) => planAiUsageDuplicateRepair(
    offsets.map((_, i) => row({ id: 100 + i, at: i * 1000, prompt: 10 + i, completion: 1 })).map(asUsage),
    offsets.map((offset, i) => gw({ id: 1 + i, at: i * 1000 + offset, prompt: 10 + i, completion: 1 })).map(asUsage),
    previous,
  )
  const two = pairs([150, 150])
  assert.deepEqual([two.band, two.bandSource, two.anchorHistogram, two.exact, two.kept.map(k => k.reason)], [null, null, { '150': 2 }, [], ['no_band', 'no_band']])
  // An earlier run's band is used as is (its own anchors are gone), and wins over the data's.
  const previous = { centerSeconds: 140, toleranceSeconds: 30, anchors: 76, anchorsInBand: 76 }
  const withPrevious = pairs([150, 175, 600, 600, 600], previous)
  assert.deepEqual([withPrevious.band, withPrevious.bandSource, withPrevious.exact.map(p => p.id)], [previous, 'previous_run', [100]])
  const split = pairs([150, 150, 600, 600])
  assert.deepEqual([split.band, split.exact], [null, []])
  const three = pairs([150, 152, 600])
  assert.deepEqual(three.band, { centerSeconds: 152, toleranceSeconds: 30, anchors: 3, anchorsInBand: 2 })
  assert.deepEqual([three.exact.map(p => p.id), three.kept.map(k => [k.id, k.reason])], [[100, 101], [[102, 'outside_band']]])
  // A router row handed in among the "gateway" rows is never a twin.
  const routerAsTwin = planAiUsageDuplicateRepair(
    [row({ id: 1, at: 0, prompt: 10, completion: 1 })].map(asUsage),
    [row({ id: 2, at: 150, prompt: 10, completion: 1 })].map(asUsage),
  )
  assert.deepEqual(routerAsTwin.kept.map(k => [k.id, k.reason]), [[1, 'no_twin']])
})

test('more rows than one DELETE batch are all deleted, in one transaction', async () => {
  harness.reset()
  const many = []
  for (let i = 0; i < 1203; i++) {
    many.push(row({ id: 10_000 + i, at: i * 3, prompt: 1000 + i, completion: 7 }), gw({ id: 1 + i, at: i * 3 + SKEW, prompt: 1000 + i, completion: 7 }))
  }
  await harness.db.insert(aiUsageLogs).values(many)
  const report = await runAiUsageDuplicateRepair({ apply: true, db, pool: fakePool().pool })
  assert.deepEqual([report.exact.length, report.written, report.skipped], [1203, 1203, 0])
  assert.equal(ids().length, 1203)
  assert.ok(ids().every(id => id <= 1203))
  assert.equal(harness.transactionsBegun, 1)
  assert.equal(harness.txStatements.filter(sql => /^\s*delete/i.test(sql)).length, 3)
})

test('operator wiring: npm run db:repair-ai-usage-duplicates runs the script, preview unless --apply, review only with --include-review', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> }
  assert.equal(pkg.scripts['db:repair-ai-usage-duplicates'], 'node --experimental-strip-types --import ./scripts/ts-resolver.mjs scripts/repair-ai-usage-duplicates.ts')
  const script = readFileSync(new URL('../scripts/repair-ai-usage-duplicates.ts', import.meta.url), 'utf8')
  assert.match(script, /const apply = process\.argv\.includes\('--apply'\)/)
  assert.match(script, /const includeReview = process\.argv\.includes\('--include-review'\)/)
  assert.match(script, /runAiUsageDuplicateRepair\(\{ apply, includeReview \}\)/)
  // The sync that wrote these rows points the operator here.
  assert.match(readFileSync(new URL('../server/api/admin/ai/delify/sync.post.ts', import.meta.url), 'utf8'), /npm run db:repair-ai-usage-duplicates/)
})
