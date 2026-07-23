import { defineEventHandler, getQuery } from 'h3'
import { getAnalyticsLiveSummary } from '../../../services/analytics-reporting'
import { assertAnalyticsQueryKeys, parseAnalyticsLiveWindow, requireAnalyticsRead } from '../../../utils/analytics-reporting'

export default defineEventHandler(async (event) => {
  requireAnalyticsRead(event)
  const query = getQuery(event)
  assertAnalyticsQueryKeys(query, ['window'])
  const windowMinutes = parseAnalyticsLiveWindow(query.window, 60)
  const report = await getAnalyticsLiveSummary(windowMinutes)
  return {
    ok: true,
    windowMinutes: report.windowMinutes,
    points: report.points,
    fiveMinuteTotals: report.fiveMinuteTotals,
    generatedAt: report.meta.generatedAt,
    latestBucketStart: report.meta.latestBucketStart,
    nextPollAfterSeconds: report.meta.nextPollAfterSeconds,
    freshness: report.meta.freshness,
    stale: report.meta.stale,
  }
})
