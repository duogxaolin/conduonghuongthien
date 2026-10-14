import { createError, defineEventHandler, readRawBody, setResponseStatus } from 'h3'
import { ingestAnalyticsPageView } from '../../../services/analytics-ingestion'
import { getClientIp } from '../../../utils/client-ip'
import { rateLimitDeps } from '../../../utils/rate-limit-deps'
import { recordRateLimitHit } from '../../../utils/rate-limit-store'
import { analyticsConfig } from '../../../utils/runtime-config'

const MAX_BODY_BYTES = 1024

/** Lượt xem được nhận trong một cửa sổ, cho mỗi IP. */
const PAGE_VIEW_ACCEPTED_PER_WINDOW = 120
const PAGE_VIEW_WINDOW_SECONDS = 60

/**
 * Each accepted page-view fans out to ~13 database writes, so an unthrottled
 * public endpoint can inflate the metrics and amplify DB load. Cap per peer IP
 * (generous enough for a real browsing session, low enough to stop flooding).
 *
 * Bộ đếm nằm ở kho dùng chung (`rate_limit_counters`, lùi về bộ nhớ khi mất CSDL)
 * thay vì một `Map` riêng của handler: sống qua khởi động lại và giữ đúng trần
 * khi có nhiều bản sao. `blocked` của kho nghĩa là "lượt này chạm trần"
 * (`count >= limit`), nên `limit` là số lượt NHẬN + 1 — lượt thứ 121 trong cửa sổ
 * bị chặn, như bản cũ. Khác biệt có chủ đích: kho dùng cửa sổ cố định (60 giây
 * kể từ lượt đầu), bản cũ là cửa sổ trượt — ở mép cửa sổ một IP có thể được
 * nhận tối đa ~2×120 lượt trong 60 giây liên tiếp. Cái giá: thêm hai truy vấn
 * nhỏ (upsert + đọc lại) mỗi lượt xem, cạnh ~13 lượt ghi của chính lượt xem đó.
 */
const PAGE_VIEW_RATE_RULE = { limit: PAGE_VIEW_ACCEPTED_PER_WINDOW + 1, windowSeconds: PAGE_VIEW_WINDOW_SECONDS }

export default defineEventHandler(async (event) => {
  const config = analyticsConfig(event)
  if (config.collectionEnabled !== true) {
    setResponseStatus(event, 202)
    return { accepted: false }
  }

  // Silently accept (202) when throttled: analytics must never disturb browsing.
  const throttle = await recordRateLimitHit(`analytics-page-view:${getClientIp(event)}`, PAGE_VIEW_RATE_RULE, rateLimitDeps())
  if (throttle.blocked) {
    setResponseStatus(event, 202)
    return { accepted: false }
  }

  const contentLength = Number(event.node.req.headers['content-length'] || 0)
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_BODY_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Analytics payload too large' })
  }

  let payload: unknown
  try {
    const rawBody = await readRawBody(event, 'utf8')
    if (!rawBody || Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      throw createError({ statusCode: rawBody ? 413 : 400, statusMessage: rawBody ? 'Analytics payload too large' : 'Invalid analytics payload' })
    }
    payload = JSON.parse(rawBody)
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({ statusCode: 400, statusMessage: 'Invalid analytics payload' })
  }

  try {
    const result = await ingestAnalyticsPageView({ event, payload, config })
    setResponseStatus(event, 202)
    return { accepted: result === 'accepted' }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('secret is unavailable')) {
      throw createError({ statusCode: 503, statusMessage: 'Analytics collection unavailable' })
    }
    if (message.startsWith('invalid ') || message.startsWith('unknown ') || message.includes('trusted infrastructure')) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid analytics payload' })
    }
    throw error
  }
})
