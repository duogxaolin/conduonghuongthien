import { and, asc, between, desc, eq, inArray, ne } from 'drizzle-orm'
import type { Pool } from 'mysql2/promise'
import { getDb, getPool, type Database } from '../utils/db'
import { activityLogs, aiUsageLogs } from '../db/schema'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { withNamedLock } from '../utils/named-lock'

/**
 * One-off repair (`npm run db:repair-ai-usage-duplicates`) of the `delify_router` rows the
 * Delify "Đồng bộ" wrote into `ai_usage_logs` until 2026-10-31. Each one copied a request
 * the gateway had already logged under its real service key, so the spend was counted
 * twice — by `checkBudget` (`loadTotalSpend` sums every row when the key's budget is the
 * cap), the dashboard and the key card — and, before R5-8 (0e1e9158), every sync on MySQL
 * inserted the whole history again. The sync no longer imports (`delify/sync.post.ts`);
 * this removes what it wrote, only where the pairing is certain.
 *
 * Only rows with `service_key = 'delify_router'` and `provider = 'delify'` are ever deleted —
 * never a gateway or test-call row (every DELETE says so again). A router row and the
 * gateway's row of the same request share no id, so the pairing rests on: same model, same
 * prompt AND completion tokens — or the gateway's prompt + 2000 for a row logged before
 * 5adab79a (2026-09-24), when the gateway still kept delify's overhead — both successful, a
 * time offset inside the clock-skew band, and ONE to ONE.
 *
 * The band: the router's clock is not the server's (dev: the gateway row lands 137–152 s
 * after the router's timestamp). Its centre is the median offset of the "anchors" — pairs
 * where each side has exactly one candidate within ±`CANDIDATE_WINDOW_SECONDS` — and a pair
 * counts only within ±`BAND_TOLERANCE_SECONDS` of it. No band (nothing paired) unless at
 * least `MIN_ANCHORS` anchors exist and most of them lie inside it: a lone pair far from the
 * skew must not become the band of a later run, once the real pairs are gone. Applying the
 * band BEFORE the one-to-one check is what tells retries of one paragraph apart (the same
 * 82/7 tokens four times in ten minutes): each has one twin at the skew, several within the
 * window.
 *
 * Buckets:
 *   - `exact` (deleted by `--apply`): the one in-band twin, one to one (`gateway_twin`,
 *     `gateway_twin_overhead`), and the identical copies of such a row (`repeat_import`:
 *     with one gateway twin, the copies cannot be other requests of this app).
 *   - `review` (deleted only by `--apply --include-review`): a `near_twin` — no equal-token
 *     candidate, but one gateway row in the band with the same completion and a prompt a
 *     little smaller (the router counted its overhead below the 2000 the gateway removes),
 *     one to one; the copies of a near twin or of a kept row (`repeat_import`).
 *   - `kept` (never deleted), each with its reason: `failed_request`, `no_twin`,
 *     `outside_band`, `ambiguous`, `no_band`. A tool-loop turn (two router requests, one
 *     gateway row) lands here.
 *
 * Same shape as `translation-null-repair.ts`: a pure planner, preview by default. `--apply`
 * runs under the named lock, deletes and writes the audit row (ids, cost, band) in ONE
 * transaction. Nothing else writes `delify_router` rows any more, so a second run finds no
 * more `exact` rows; it pairs in the band the first `--apply` recorded, so `review` is still
 * there for `--include-review`. Only a backup undoes it (`scripts/backup-db.sh` first).
 */

export const ROUTER_SERVICE_KEY = 'delify_router'
export const REPAIR_LOCK_NAME = 'cdkt:ai:usage-duplicates-repair'
/** A gateway row further than this from a router row is never its twin (seconds). */
export const CANDIDATE_WINDOW_SECONDS = 900
/** Half-width of the clock-skew band around the anchors' median offset (seconds). */
export const BAND_TOLERANCE_SECONDS = 30
/** Fewer anchors than this, and there is no band: nothing is paired. */
export const MIN_ANCHORS = 3
/** delify's prompt overhead (`ai-gateway-tokens.ts`), still in gateway rows logged before 5adab79a. */
export const LEGACY_OVERHEAD_TOKENS = 2000
/**
 * The commit time of 5adab79a ("normalize Delify 2000-token proxy offset"): `git show -s
 * --format=%cI 5adab79a` → 2026-09-24T11:51:36+01:00. Only a gateway row logged BEFORE it
 * can still hold the overhead; after it, a router row 2000 below a gateway row is another
 * request (verifier A18: an outside request 500/100 next to an October gateway row
 * 2500/100 was deleted). A row logged between the commit and its deploy that still holds
 * the overhead is not paired by this rule — kept, the safe side.
 */
export const LEGACY_OVERHEAD_UNTIL = new Date('2026-09-24T10:51:36.000Z')
/** A near twin (`review`): the router's prompt count at most this many tokens above the gateway's. */
export const NEAR_PROMPT_DELTA_MAX = 256
const DELETE_BATCH = 500
const MAX_LISTED_CANDIDATES = 5

export type UsageRow = {
  id: number
  serviceKey: string
  createdAt: Date | null
  model: string | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: string
  costVnd: string
  executionMs: number
  success: boolean
  errorMessage: string | null
}

type RowSummary = { id: number, createdAt: string | null, model: string | null, promptTokens: number, completionTokens: number, costVnd: number }
export type PlannedDeletion = RowSummary & {
  bucket: 'exact' | 'review'
  reason: 'gateway_twin' | 'gateway_twin_overhead' | 'near_twin' | 'repeat_import'
  /** The gateway row it copies (`gateway_twin*`, `near_twin`). */
  twinId: number | null
  /** Twin's `created_at` − this row's, in seconds. */
  offsetSeconds: number | null
  /** This row's prompt tokens − the twin's (0, −2000 for the overhead, 1…NEAR_PROMPT_DELTA_MAX for a near twin). */
  promptDelta: number | null
  /** The router row it is an identical copy of (`repeat_import`). */
  copyOf: number | null
}
export type KeptReason = 'failed_request' | 'no_twin' | 'outside_band' | 'ambiguous' | 'no_band'
export type KeptRow = RowSummary & { reason: KeptReason, candidates: Array<{ id: number, serviceKey: string, offsetSeconds: number }> }
export type SkewBand = { centerSeconds: number, toleranceSeconds: number, anchors: number, anchorsInBand: number }
export type AiUsageRepairPlan = {
  /** null: no earlier run's band, and fewer than MIN_ANCHORS anchors or most of them away from their median — nothing is paired. */
  band: SkewBand | null
  /** `previous_run`: the band an earlier `--apply` measured (its audit row) — its anchors are deleted rows now. */
  bandSource: 'anchors' | 'previous_run' | null
  /** Every anchor's offset, by 10-second bucket — what the band was read from, for the operator. */
  anchorHistogram: Record<string, number>
  exact: PlannedDeletion[]
  review: PlannedDeletion[]
  kept: KeptRow[]
}

type Edge = { rep: UsageRow, twin: UsageRow, offset: number, overhead: boolean }
type NearEdge = { twin: UsageRow, offset: number, promptDelta: number }

const summary = (row: UsageRow): RowSummary => ({
  id: row.id,
  createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  model: row.model,
  promptTokens: row.promptTokens,
  completionTokens: row.completionTokens,
  costVnd: Number(row.costVnd),
})

/** Everything a repeated sync wrote the same — not `id`, not `user_id` (whoever pressed the button). */
const copyKey = (row: UsageRow) => JSON.stringify([row.createdAt?.getTime() ?? null, row.model, row.promptTokens, row.completionTokens,
  row.totalTokens, row.costUsd, row.costVnd, row.executionMs, row.success, row.errorMessage])

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/**
 * Thuần. `routerRows`: the `delify_router` rows; `gatewayRows`: every other successful
 * `delify` row near them; `previousBand`: the band of an earlier `--apply`, if any.
 */
export function planAiUsageDuplicateRepair(routerRows: readonly UsageRow[], gatewayRows: readonly UsageRow[], previousBand: SkewBand | null = null): AiUsageRepairPlan {
  const plan: AiUsageRepairPlan = { band: null, bandSource: null, anchorHistogram: {}, exact: [], review: [], kept: [] }

  // 1. Identical copies (R5-8 re-imports): one representative per group, the lowest id.
  const byCopyKey = new Map<string, UsageRow[]>()
  for (const row of [...routerRows].sort((a, b) => a.id - b.id)) push(byCopyKey, copyKey(row), row)
  const groups = [...byCopyKey.values()].map(([rep, ...copies]) => ({ rep: rep!, copies }))

  // 2. Candidate twins of each successful representative, within the window.
  const gatewayByShape = new Map<string, UsageRow[]>()
  for (const row of gatewayRows) {
    if (row.success && row.createdAt && row.model !== null && row.serviceKey !== ROUTER_SERVICE_KEY) push(gatewayByShape, `${row.model}\u0000${row.completionTokens}`, row)
  }
  const edgesByRep = new Map<number, Edge[]>()
  const edgesByTwin = new Map<number, Edge[]>()
  for (const { rep } of groups) {
    const repAt = rep.createdAt
    if (!rep.success || !repAt || rep.model === null) continue
    for (const twin of gatewayByShape.get(`${rep.model}\u0000${rep.completionTokens}`) ?? []) {
      const overhead = twin.promptTokens === rep.promptTokens + LEGACY_OVERHEAD_TOKENS && twin.createdAt!.getTime() < LEGACY_OVERHEAD_UNTIL.getTime()
      if (twin.promptTokens !== rep.promptTokens && !overhead) continue
      const offset = Math.round((twin.createdAt!.getTime() - repAt.getTime()) / 1000)
      if (Math.abs(offset) > CANDIDATE_WINDOW_SECONDS) continue
      const edge = { rep, twin, offset, overhead }
      push(edgesByRep, rep.id, edge)
      push(edgesByTwin, twin.id, edge)
    }
  }

  // 3. The clock-skew band: the anchors' median offset ± the tolerance — only when at least
  //    MIN_ANCHORS anchors agree and most of them fall inside it. A lone pair far from the
  //    skew is an anchor too; once the real pairs are deleted it would be all that is left,
  //    and must not become the band of the next run. The band an earlier `--apply` measured
  //    wins: it was read from every pair, the ones it deleted included — without it, the
  //    `review` rows left after `--apply` would have no band to be paired in.
  const anchors = [...edgesByRep.values()].filter(edges => edges.length === 1 && edgesByTwin.get(edges[0]!.twin.id)!.length === 1).map(edges => edges[0]!.offset)
  anchors.sort((a, b) => a - b)
  for (const offset of anchors) {
    const bucket = String(Math.floor(offset / 10) * 10)
    plan.anchorHistogram[bucket] = (plan.anchorHistogram[bucket] ?? 0) + 1
  }
  if (anchors.length >= MIN_ANCHORS) {
    const centerSeconds = anchors[Math.floor((anchors.length - 1) / 2)]!
    const anchorsInBand = anchors.filter(offset => Math.abs(offset - centerSeconds) <= BAND_TOLERANCE_SECONDS).length
    if (anchorsInBand * 2 > anchors.length) Object.assign(plan, { band: { centerSeconds, toleranceSeconds: BAND_TOLERANCE_SECONDS, anchors: anchors.length, anchorsInBand }, bandSource: 'anchors' })
  }
  if (previousBand) Object.assign(plan, { band: previousBand, bandSource: 'previous_run' })
  const band = plan.band
  const inBand = (offset: number) => band !== null && Math.abs(offset - band.centerSeconds) <= band.toleranceSeconds
  const inBandByTwin = new Map<number, number>()
  for (const edges of edgesByRep.values()) {
    for (const edge of edges.filter(e => inBand(e.offset))) inBandByTwin.set(edge.twin.id, (inBandByTwin.get(edge.twin.id) ?? 0) + 1)
  }

  // 4. Near twins (`review` only): no equal-token candidate in the band, but ONE gateway row
  //    there with the same model and completion and a prompt up to NEAR_PROMPT_DELTA_MAX
  //    tokens SMALLER (the gateway takes a fixed 2000 off; dev: 77 rows at exactly 96 or 128
  //    less, 151–152 s) — and that row is no other router row's candidate of either kind.
  const nearByRep = new Map<number, NearEdge[]>()
  const nearByTwin = new Map<number, number>()
  for (const { rep } of groups) {
    const repAt = rep.createdAt
    if (!band || !rep.success || !repAt || rep.model === null || (edgesByRep.get(rep.id) ?? []).some(e => inBand(e.offset))) continue
    for (const twin of gatewayByShape.get(`${rep.model}\u0000${rep.completionTokens}`) ?? []) {
      const promptDelta = rep.promptTokens - twin.promptTokens
      const offset = Math.round((twin.createdAt!.getTime() - repAt.getTime()) / 1000)
      if (promptDelta < 1 || promptDelta > NEAR_PROMPT_DELTA_MAX || !inBand(offset) || inBandByTwin.has(twin.id)) continue
      push(nearByRep, rep.id, { twin, offset, promptDelta })
      nearByTwin.set(twin.id, (nearByTwin.get(twin.id) ?? 0) + 1)
    }
  }

  // 5. Decide each representative; its copies follow it.
  for (const { rep, copies } of groups) {
    const edges = edgesByRep.get(rep.id) ?? []
    const banded = edges.filter(e => inBand(e.offset))
    const match = banded.length === 1 && inBandByTwin.get(banded[0]!.twin.id) === 1 ? banded[0]! : null
    const nears = nearByRep.get(rep.id) ?? []
    const near = nears.length === 1 && nearByTwin.get(nears[0]!.twin.id) === 1 ? nears[0]! : null
    if (match) {
      plan.exact.push({ ...summary(rep), bucket: 'exact', reason: match.overhead ? 'gateway_twin_overhead' : 'gateway_twin', twinId: match.twin.id, offsetSeconds: match.offset, promptDelta: match.overhead ? -LEGACY_OVERHEAD_TOKENS : 0, copyOf: null })
    } else if (near) {
      plan.review.push({ ...summary(rep), bucket: 'review', reason: 'near_twin', twinId: near.twin.id, offsetSeconds: near.offset, promptDelta: near.promptDelta, copyOf: null })
    } else {
      const reason: KeptReason = !rep.success ? 'failed_request'
        : edges.length === 0 ? 'no_twin'
        : band === null ? 'no_band'
        : banded.length === 0 ? 'outside_band'
        : 'ambiguous'
      const candidates = edges.slice(0, MAX_LISTED_CANDIDATES).map(edge => ({ id: edge.twin.id, serviceKey: edge.twin.serviceKey, offsetSeconds: edge.offset }))
      plan.kept.push({ ...summary(rep), reason, candidates })
    }
    const bucket = match ? 'exact' : 'review'
    for (const copy of copies) plan[bucket].push({ ...summary(copy), bucket, reason: 'repeat_import', twinId: null, offsetSeconds: null, promptDelta: null, copyOf: rep.id })
  }
  for (const list of [plan.exact, plan.review, plan.kept]) list.sort((a, b) => a.id - b.id)
  return plan
}

export type AiUsageRepairReport = AiUsageRepairPlan & {
  applied: boolean
  includeReview: boolean
  /** `delify_router` rows found. */
  routerRows: number
  /** Rows deleted (apply only). */
  written: number
  /** Planned rows already gone at the DELETE. */
  skipped: number
  costVnd: { exact: number, review: number, kept: number }
}

const sumVnd = (rows: ReadonlyArray<{ costVnd: number }>) => Math.round(rows.reduce((total, row) => total + row.costVnd, 0) * 100) / 100

const ROW_FIELDS = {
  id: aiUsageLogs.id, serviceKey: aiUsageLogs.serviceKey, createdAt: aiUsageLogs.createdAt, model: aiUsageLogs.model,
  promptTokens: aiUsageLogs.promptTokens, completionTokens: aiUsageLogs.completionTokens, totalTokens: aiUsageLogs.totalTokens,
  costUsd: aiUsageLogs.costUsd, costVnd: aiUsageLogs.costVnd, executionMs: aiUsageLogs.executionMs,
  success: aiUsageLogs.success, errorMessage: aiUsageLogs.errorMessage,
}

const AUDIT_ACTION = 'repair-ai-usage-duplicates'

/** The band the latest `--apply` of this repair recorded in its audit row, if its shape is intact. */
async function previousRunBand(db: Database): Promise<SkewBand | null> {
  const audits = await db.select({ meta: activityLogs.meta }).from(activityLogs)
    .where(and(eq(activityLogs.action, 'delete'), eq(activityLogs.resource, 'ai')))
    .orderBy(desc(activityLogs.id))
  for (const { meta } of audits) {
    if (!meta || typeof meta !== 'object' || (meta as { action?: unknown }).action !== AUDIT_ACTION) continue
    const band = (meta as { band?: unknown }).band as Partial<Record<keyof SkewBand, unknown>> | null | undefined
    const numbers = band ? [band.centerSeconds, band.toleranceSeconds, band.anchors, band.anchorsInBand] : []
    if (numbers.length === 4 && numbers.every(value => typeof value === 'number' && Number.isFinite(value))) {
      const [centerSeconds, toleranceSeconds, anchors, anchorsInBand] = numbers as number[]
      return { centerSeconds: centerSeconds!, toleranceSeconds: toleranceSeconds!, anchors: anchors!, anchorsInBand: anchorsInBand! }
    }
  }
  return null
}

async function buildReport(db: Database, apply: boolean, includeReview: boolean): Promise<AiUsageRepairReport> {
  const routerRows: UsageRow[] = await db.select(ROW_FIELDS).from(aiUsageLogs)
    .where(and(eq(aiUsageLogs.serviceKey, ROUTER_SERVICE_KEY), eq(aiUsageLogs.provider, 'delify')))
    .orderBy(asc(aiUsageLogs.id))
  const times = routerRows.flatMap(row => (row.createdAt ? [row.createdAt.getTime()] : []))
  const gatewayRows: UsageRow[] = times.length === 0 ? [] : await db.select(ROW_FIELDS).from(aiUsageLogs)
    .where(and(
      ne(aiUsageLogs.serviceKey, ROUTER_SERVICE_KEY),
      eq(aiUsageLogs.provider, 'delify'),
      eq(aiUsageLogs.success, true),
      between(aiUsageLogs.createdAt, new Date(Math.min(...times) - CANDIDATE_WINDOW_SECONDS * 1000), new Date(Math.max(...times) + CANDIDATE_WINDOW_SECONDS * 1000)),
    ))
    .orderBy(asc(aiUsageLogs.id))
  const plan = planAiUsageDuplicateRepair(routerRows, gatewayRows, await previousRunBand(db))
  return {
    applied: apply,
    includeReview,
    routerRows: routerRows.length,
    written: 0,
    skipped: 0,
    costVnd: { exact: sumVnd(plan.exact), review: sumVnd(plan.review), kept: sumVnd(plan.kept) },
    ...plan,
  }
}

export async function runAiUsageDuplicateRepair(
  options: { apply?: boolean, includeReview?: boolean, db?: Database, pool?: Pool } = {},
): Promise<AiUsageRepairReport> {
  const apply = options.apply === true
  const includeReview = options.includeReview === true
  const db = options.db ?? getDb()
  if (!apply) return buildReport(db, false, includeReview)

  const pool = options.pool ?? getPool()
  if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')
  const outcome = await withNamedLock(pool, REPAIR_LOCK_NAME, 0, async () => {
    const report = await buildReport(db, true, includeReview)
    const doomed = [...report.exact, ...(includeReview ? report.review : [])]
    if (doomed.length === 0) return report
    await db.transaction(async (tx) => {
      for (let start = 0; start < doomed.length; start += DELETE_BATCH) {
        const ids = doomed.slice(start, start + DELETE_BATCH).map(row => row.id)
        const result = await tx.delete(aiUsageLogs).where(and(
          inArray(aiUsageLogs.id, ids),
          eq(aiUsageLogs.serviceKey, ROUTER_SERVICE_KEY),
          eq(aiUsageLogs.provider, 'delify'),
        ))
        report.written += affectedRowsOrZero(result)
      }
      report.skipped = doomed.length - report.written
      await tx.insert(activityLogs).values({
        userId: null,
        action: 'delete',
        resource: 'ai',
        resourceId: null,
        meta: {
          action: AUDIT_ACTION,
          includeReview,
          deleted: report.written,
          skipped: report.skipped,
          costVnd: sumVnd(doomed),
          band: report.band,
          ids: doomed.map(row => row.id),
        },
      })
    })
    return report
  })
  if (!outcome.acquired) throw new Error(`Một lượt dọn khác đang giữ khoá ${REPAIR_LOCK_NAME} — chờ nó xong rồi chạy lại.`)
  return outcome.value
}
