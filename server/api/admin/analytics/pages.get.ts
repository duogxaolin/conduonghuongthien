import { getQuery } from 'h3'
import { getAnalyticsPages } from '../../../services/analytics-reporting'
import {
  normalizePageFilter,
  parseAnalyticsRange,
  parsePositiveInteger,
  requireAnalyticsRead,
} from '../../../utils/analytics-reporting'

export default defineEventHandler(async (event) => {
  requireAnalyticsRead(event)
  const query = getQuery(event)
  const range = parseAnalyticsRange(query)
  const page = parsePositiveInteger(query.page, 'page', 1, 10_000)
  const perPage = parsePositiveInteger(query.perPage ?? query.limit, 'perPage', 20, 100)
  const path = normalizePageFilter(query.path)
  return { ok: true, ...await getAnalyticsPages(range, { page, perPage, path }) }
})
