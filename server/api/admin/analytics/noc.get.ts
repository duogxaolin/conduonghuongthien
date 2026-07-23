import { defineEventHandler, getQuery } from 'h3'
import { getAnalyticsNocReport } from '../../../services/analytics-reporting'
import { assertAnalyticsQueryKeys, parseAnalyticsNocCursor, parseAnalyticsNocLimit, requireAnalyticsRead } from '../../../utils/analytics-reporting'

export default defineEventHandler(async (event) => {
  requireAnalyticsRead(event)
  const query = getQuery(event)
  assertAnalyticsQueryKeys(query, ['limit', 'cursor'])
  const limit = parseAnalyticsNocLimit(query.limit)
  const cursor = parseAnalyticsNocCursor(query.cursor)
  const report = await getAnalyticsNocReport({ limit, cursor })
  return {
    ok: true,
    rows: report.rows,
    nextCursor: report.nextCursor,
    generatedAt: report.meta.generatedAt,
    latestBucketStart: report.meta.latestBucketStart,
    nextPollAfterSeconds: report.meta.nextPollAfterSeconds,
    freshness: report.meta.freshness,
    stale: report.meta.stale,
  }
})
