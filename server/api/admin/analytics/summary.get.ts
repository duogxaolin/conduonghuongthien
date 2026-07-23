import { getQuery } from 'h3'
import { getAnalyticsSummary } from '../../../services/analytics-reporting'
import { parseAnalyticsRange, requireAnalyticsRead } from '../../../utils/analytics-reporting'

export default defineEventHandler(async (event) => {
  requireAnalyticsRead(event)
  const range = parseAnalyticsRange(getQuery(event))
  return { ok: true, ...await getAnalyticsSummary(range) }
})
