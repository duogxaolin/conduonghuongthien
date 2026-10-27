/**
 * Responses the admin dashboard (`/admin`, `pages/admin/index.vue`) reads: the four stat
 * cards and the analytics block.
 *
 * DERIVED FROM THE HANDLERS (`Payload<…>`, app/types/handler-payload.ts), so a changed
 * response changes the type. Differences from the hand-written shapes these replace (wave3
 * 7.1, batch B), none of them displayed:
 *   - the stat cards' answers are the whole list answers (`items`, `pagination.page`…);
 *     `counts` is a `Record` — a status with no rows has NO key, which is why the pending
 *     card reads `counts.new ?? 0`;
 *   - the live summary also carries `points`/`windowMinutes`/freshness fields, a
 *     breakdown row `uniqueVisitorSemantics`.
 */
import type { Payload } from './handler-payload'

type ArticlesHandler = typeof import('~~/server/api/admin/articles/index.get').default
type SubmissionsHandler = typeof import('~~/server/api/admin/submissions/index.get').default
type MediaHandler = typeof import('~~/server/api/admin/media/index.get').default
type SummaryHandler = typeof import('~~/server/api/admin/analytics/summary.get').default
type LiveHandler = typeof import('~~/server/api/admin/analytics/live.get').default
type BreakdownHandler = typeof import('~~/server/api/admin/analytics/live/breakdown.get').default

// ─── Stat cards ──────────────────────────────────────────────────────────────
/** `GET /api/admin/articles` (page 1; the card reads `pagination.total`). */
export type DashboardArticlesResponse = Payload<ArticlesHandler>
/** `GET /api/admin/submissions` (the card reads `counts.new`). */
export type DashboardSubmissionsResponse = Payload<SubmissionsHandler>
/** `GET /api/admin/media` (page 1; the card reads `pagination.total`). */
export type DashboardMediaResponse = Payload<MediaHandler>

// ─── Analytics ───────────────────────────────────────────────────────────────
/** `GET /api/admin/analytics/summary?start&end`. */
export type AnalyticsSummaryResponse = Payload<SummaryHandler>
export type AnalyticsTrafficPoint = AnalyticsSummaryResponse['traffic'][number]
/** `GET /api/admin/analytics/live`. */
export type AnalyticsLiveResponse = Payload<LiveHandler>
/** `GET /api/admin/analytics/live/breakdown?scope&window`. */
export type AnalyticsBreakdownResponse = Payload<BreakdownHandler>
export type AnalyticsBreakdownRow = AnalyticsBreakdownResponse['rows'][number]
