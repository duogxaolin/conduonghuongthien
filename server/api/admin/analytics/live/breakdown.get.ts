import { defineEventHandler, getQuery } from 'h3'
import { getAnalyticsLiveBreakdown } from '../../../../services/analytics-reporting'
import {
  ANALYTICS_BREAKDOWN_ROW_CAP,
  assertAnalyticsQueryKeys,
  parseAnalyticsBreakdownScope,
  parseAnalyticsLiveWindow,
  parseAnalyticsScopeValue,
  parsePositiveInteger,
  requireAnalyticsRead,
} from '../../../../utils/analytics-reporting'

export default defineEventHandler(async (event) => {
  requireAnalyticsRead(event)
  const query = getQuery(event)
  assertAnalyticsQueryKeys(query, ['scope', 'window', 'limit', 'value'])
  const scope = parseAnalyticsBreakdownScope(query.scope)
  const windowMinutes = parseAnalyticsLiveWindow(query.window, 60)
  const limit = parsePositiveInteger(query.limit, 'limit', 10, ANALYTICS_BREAKDOWN_ROW_CAP)
  const value = parseAnalyticsScopeValue(scope, query.value)
  const report = await getAnalyticsLiveBreakdown(scope, windowMinutes, { limit, value })
  return {
    ok: true,
    scope: report.scope,
    windowMinutes: report.windowMinutes,
    rows: report.rows,
    totalPageViews: report.totalPageViews,
    generatedAt: report.meta.generatedAt,
    latestBucketStart: report.meta.latestBucketStart,
    nextPollAfterSeconds: report.meta.nextPollAfterSeconds,
    freshness: report.meta.freshness,
    stale: report.meta.stale,
  }
})
