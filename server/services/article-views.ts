/**
 * Per-article view counting: recording, aggregation and administrator-driven
 * inflation.
 *
 * The number this file produces has to survive a question nobody can ask of a
 * marketing counter: "is that figure real?" A Cục C11 portal cannot answer with
 * a shrug, so the honest total is kept recoverable by two independent
 * separations rather than one:
 *
 *   1. `real_views` and `fabricated_views` are different columns.
 *   2. Every fabricated row also carries `source_category = 'boost'`, a value
 *      the public allowlist does not contain.
 *
 * Either alone would keep `SUM(real_views)` truthful. Both together mean a
 * future refactor has to break two unrelated things at once before the record
 * becomes ambiguous.
 *
 * Deliberately not joined to `analytics_daily_pages`: that table is keyed on URL
 * path and answers "how busy was this URL". Slugs move, and four route prefixes
 * carry the same content types, so joining the two would create two numbers
 * that drift apart and a permanent argument about which one is right.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { articleViewDaily } from '../db/schema'
import { SOURCE_CATEGORIES, type SourceCategory } from '../utils/analytics-collection'

/**
 * The source category reserved for fabrication. Nothing arriving from a public
 * request may ever hold this value — see `normalizeViewSource`.
 */
export const BOOST_SOURCE_CATEGORY = 'boost'

/**
 * The guard is executed at import time rather than written in a comment: if
 * someone ever adds `boost` to the public allowlist, the server refuses to boot
 * instead of quietly letting crafted requests write into fabrication rows.
 */
if ((SOURCE_CATEGORIES as readonly string[]).includes(BOOST_SOURCE_CATEGORY)) {
  throw new Error('BOOST_SOURCE_CATEGORY must not be a member of the public SOURCE_CATEGORIES allowlist')
}

/** The dedupe window. See design D4 — long enough to absorb a reload sitting, short enough that an afternoon return visit is a second genuine read. */
export const VIEW_DEDUPE_WINDOW_SECONDS = 30 * 60

/** `bucket_key` in `rate_limit_counters` is VARCHAR(191) and is the primary key. */
export const VIEW_DEDUPE_KEY_MAX_LENGTH = 191

/** 128 bits of an HMAC. Collision between two visitors on one article in one day is not a practical concern. */
export const VIEW_DEDUPE_TOKEN_LENGTH = 32

export const BOOST_MAX_AMOUNT = 1_000_000
/** Seven days. */
export const BOOST_MAX_MINUTES = 10_080

export const VIEW_STATS_DEFAULT_DAYS = 30
export const VIEW_STATS_MAX_DAYS = 366

/**
 * Client-declared source categories are unverifiable, so the only job here is to
 * bound the damage: an allowlisted value passes, everything else becomes
 * `other`. Nothing is inferred — guessing a more specific category from a value
 * we already decided not to trust would be worse than admitting we do not know.
 *
 * `'boost'` is not on the allowlist, so a request naming it lands in `other` and
 * can never reach a fabrication row.
 */
export function normalizeViewSource(value: unknown): SourceCategory {
  if (typeof value !== 'string') return 'other'
  const candidate = value.trim().toLowerCase()
  return (SOURCE_CATEGORIES as readonly string[]).includes(candidate) ? candidate as SourceCategory : 'other'
}

/**
 * `av:<articleId>:<first 32 hex of the visitor token>`.
 *
 * At most `av:` + 10 digits + `:` + 32 hex = 46 characters, comfortably inside
 * the column. The assertion is a tripwire for a future change to either bound,
 * not a runtime concern: a silently truncated key would merge two visitors into
 * one bucket and suppress a genuine view.
 */
export function buildViewDedupeKey(articleId: number, visitorToken: string): string {
  const key = `av:${articleId}:${visitorToken.slice(0, VIEW_DEDUPE_TOKEN_LENGTH)}`
  if (key.length > VIEW_DEDUPE_KEY_MAX_LENGTH) {
    throw new Error(`view dedupe key exceeds ${VIEW_DEDUPE_KEY_MAX_LENGTH} characters`)
  }
  return key
}

/** UTC day, matching the day the visitor token was derived under. */
export function viewDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10)
}

/**
 * One real view. The upsert is a single statement so two concurrent readers of
 * the same article cannot both insert the day's first row.
 */
export async function recordArticleView(input: { articleId: number; sourceCategory: SourceCategory; day?: string }): Promise<void> {
  const db = getDb()
  await db
    .insert(articleViewDaily)
    .values({
      day: input.day ?? viewDay(),
      articleId: input.articleId,
      sourceCategory: input.sourceCategory,
      realViews: 1,
      fabricatedViews: 0,
    })
    .onDuplicateKeyUpdate({ set: { realViews: sql`${articleViewDaily.realViews} + 1` } })
}

/**
 * Fabricated views, always into the `boost` row for the day. `fabricatedViews`
 * is the only column this function touches — a fabricated write physically
 * cannot land in `real_views`.
 */
export async function addFabricatedViews(input: { articleId: number; amount: number; day?: string }): Promise<void> {
  if (!Number.isInteger(input.amount) || input.amount < 1) {
    throw new Error('fabricated view amount must be a positive integer')
  }
  const db = getDb()
  await db
    .insert(articleViewDaily)
    .values({
      day: input.day ?? viewDay(),
      articleId: input.articleId,
      sourceCategory: BOOST_SOURCE_CATEGORY,
      realViews: 0,
      fabricatedViews: input.amount,
    })
    .onDuplicateKeyUpdate({ set: { fabricatedViews: sql`${articleViewDaily.fabricatedViews} + ${input.amount}` } })
}

export type ArticleViewStats = {
  articleId: number
  days: number
  totalReal: number
  totalFabricated: number
  totalDisplayed: number
  /** Real views only. `boost` never appears here — it is not a traffic source. */
  bySource: Array<{ sourceCategory: string; views: number }>
  daily: Array<{ day: string; real: number; fabricated: number; total: number }>
}

/**
 * Totals are lifetime; the breakdown and the series are bounded by `days`.
 *
 * The split matters: an operator asking "how many views does this article have"
 * means all of them, but an unbounded per-day series would grow one row per day
 * forever. Clamping the window without clamping the total keeps both answers
 * correct.
 */
export async function getArticleViewStats(articleId: number, options: { days?: number } = {}): Promise<ArticleViewStats> {
  const requested = Number(options.days)
  const days = Number.isInteger(requested) && requested >= 1
    ? Math.min(requested, VIEW_STATS_MAX_DAYS)
    : VIEW_STATS_DEFAULT_DAYS

  const db = getDb()

  const [totals] = await db
    .select({
      real: sql<number>`COALESCE(SUM(${articleViewDaily.realViews}), 0)`,
      fabricated: sql<number>`COALESCE(SUM(${articleViewDaily.fabricatedViews}), 0)`,
    })
    .from(articleViewDaily)
    .where(eq(articleViewDaily.articleId, articleId))

  const since = viewDay(new Date(Date.now() - (days - 1) * 86_400_000))

  const bySourceRows = await db
    .select({
      sourceCategory: articleViewDaily.sourceCategory,
      views: sql<number>`COALESCE(SUM(${articleViewDaily.realViews}), 0)`,
    })
    .from(articleViewDaily)
    .where(and(eq(articleViewDaily.articleId, articleId), gte(articleViewDaily.day, since)))
    .groupBy(articleViewDaily.sourceCategory)

  const dailyRows = await db
    .select({
      day: articleViewDaily.day,
      real: sql<number>`COALESCE(SUM(${articleViewDaily.realViews}), 0)`,
      fabricated: sql<number>`COALESCE(SUM(${articleViewDaily.fabricatedViews}), 0)`,
    })
    .from(articleViewDaily)
    .where(and(eq(articleViewDaily.articleId, articleId), gte(articleViewDaily.day, since)))
    .groupBy(articleViewDaily.day)
    .orderBy(desc(articleViewDaily.day))

  const totalReal = Number(totals?.real ?? 0)
  const totalFabricated = Number(totals?.fabricated ?? 0)

  return {
    articleId,
    days,
    totalReal,
    totalFabricated,
    totalDisplayed: totalReal + totalFabricated,
    // The `boost` bucket is dropped rather than shown as a traffic source: it is
    // not one, and the fabricated figure is already reported on its own.
    bySource: bySourceRows
      .filter(row => row.sourceCategory !== BOOST_SOURCE_CATEGORY)
      .map(row => ({ sourceCategory: String(row.sourceCategory), views: Number(row.views) }))
      .sort((a, b) => b.views - a.views),
    daily: dailyRows.map((row) => {
      const real = Number(row.real)
      const fabricated = Number(row.fabricated)
      return { day: String(row.day), real, fabricated, total: real + fabricated }
    }),
  }
}

export type BoostValidationResult =
  | { ok: true; mode: 'instant'; amount: number }
  | { ok: true; mode: 'gradual'; amount: number; minutes: number }
  | { ok: false; message: string }

/**
 * Pure input validation, kept away from every write so a rejected request
 * cannot have already changed a count. Unrecognised values are rejected, never
 * coerced: silently reading an unknown mode as "instant" would apply an
 * inflation the operator did not authorise.
 */
export function validateBoostInput(body: unknown): BoostValidationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Dữ liệu không hợp lệ.' }
  }
  const input = body as Record<string, unknown>

  const mode = typeof input.mode === 'string' ? input.mode.trim() : ''
  if (mode !== 'instant' && mode !== 'gradual') {
    return { ok: false, message: 'Chế độ tăng lượt xem phải là "instant" hoặc "gradual".' }
  }

  const amount = input.amount
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > BOOST_MAX_AMOUNT) {
    return { ok: false, message: `Số lượt xem phải là số nguyên từ 1 đến ${BOOST_MAX_AMOUNT.toLocaleString('vi-VN')}.` }
  }

  if (mode === 'instant') return { ok: true, mode, amount }

  const minutes = input.minutes
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > BOOST_MAX_MINUTES) {
    return { ok: false, message: `Thời lượng phải là số nguyên phút từ 1 đến ${BOOST_MAX_MINUTES.toLocaleString('vi-VN')} (7 ngày).` }
  }
  return { ok: true, mode, amount, minutes }
}
