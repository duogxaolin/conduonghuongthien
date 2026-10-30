/**
 * Responses the admin dashboard (`/admin`, `pages/admin/index.vue`) reads: the four stat
 * cards and the analytics block — and, since D-FETCH lot H, the analytics page
 * (`/admin/analytics`) and its real-time panel, which read the same endpoints and two more.
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
type PagesHandler = typeof import('~~/server/api/admin/analytics/pages.get').default
type DimensionHandler = typeof import('~~/server/api/admin/analytics/dimensions/[dimension].get').default
type NocHandler = typeof import('~~/server/api/admin/analytics/noc.get').default

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

// ─── /admin/analytics (D-FETCH lot H) ────────────────────────────────────────
// The historical report (`pages/admin/analytics.vue`) reads the summary above and a ranking; the
// real-time panel (`AnalyticsLiveDashboard.client.vue`) the live summary and breakdown above and
// the NOC events. The hand-written shapes these replace lacked `ok` (and the live/breakdown
// `windowMinutes`, the NOC `nextCursor`), none of them displayed.
/**
 * `GET /api/admin/analytics/pages` or `…/dimensions/<dimension>` — the ranking table. Both handlers
 * answer `{ ok, ...AnalyticsDrillDown }` (server/services/analytics-reporting.ts); one table reads either.
 */
export type AnalyticsDrillDownResponse = Payload<PagesHandler> | Payload<DimensionHandler>
/** `GET /api/admin/analytics/noc?limit=` — the NOC panel; its rows are what `useAnalyticsNocTable` takes. */
export type AnalyticsNocResponse = Payload<NocHandler>
