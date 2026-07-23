import { getQuery } from 'h3'
import { getAnalyticsDimension } from '../../../../services/analytics-reporting'
import {
  normalizeDimensionFilter,
  parseAnalyticsDimension,
  parseAnalyticsRange,
  parsePositiveInteger,
  requireAnalyticsRead,
} from '../../../../utils/analytics-reporting'

export default defineEventHandler(async (event) => {
  requireAnalyticsRead(event)
  const query = getQuery(event)
  const dimension = parseAnalyticsDimension(getRouterParam(event, 'dimension'))
  const range = parseAnalyticsRange(query)
  const page = parsePositiveInteger(query.page, 'page', 1, 10_000)
  const perPage = parsePositiveInteger(query.perPage ?? query.limit, 'perPage', 20, 100)
  const filter = normalizeDimensionFilter(dimension, query.filter)
  return { ok: true, ...await getAnalyticsDimension(range, { page, perPage, dimension, filter }) }
})
