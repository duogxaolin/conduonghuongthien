/**
 * Anonymous SSE chat subscription. All frames use the bounded Node transport;
 * ready identifies the session, and send() flushes headers immediately.
 */
import { defineEventHandler, setResponseHeader, setResponseStatus } from 'h3'
import { createNodeSseStream } from '../../../../utils/node-sse-stream'
import { getActiveLivestream } from '../../../../services/livestream'
import { logWarn } from '../../../../utils/logger'
import { getClientIp } from '../../../../utils/client-ip'
import { recordRateLimitHit } from '../../../../utils/rate-limit-store'
import { rateLimitDeps } from '../../../../utils/rate-limit-deps'
import {
  isShuttingDown,
  registerStream,
  SSE_EVENT_READY,
  SSE_EVENT_SHUTDOWN,
} from '../../../../utils/sse-manager'

const SHUTDOWN_REASON = 'Máy chủ đang khởi động lại. Vui lòng tải lại trang sau ít giây.'

/**
 * Giới hạn số kết nối SSE mở đồng thời từ một địa chỉ. Một EventSource mở 1
 * kết nối; tab thứ 2 là 2; botnet xoay IP thì mỗi IP vẫn chỉ 10. Đây là biên
 * **đầu tiên** — cap toàn cục MAX_STREAMS trong sse-manager là biên cuối khi
 * attacker quay IP.
 */
const SSE_CONNECTION_RULE = { limit: 10, windowSeconds: 60 }

export default defineEventHandler(async (event) => {
  const session = await getActiveLivestream()
  if (!session) {
    logWarn({ event: 'public.livestream_stream_miss', reason: 'no_active_session' })
    setResponseStatus(event, 404)
    return { ok: false, message: 'Hiện không có buổi phát trực tiếp nào đang diễn ra.' }
  }

  // Rate limit per-IP TRƯỚC khi mở stream — một socket mở là tài nguyên bị
  // giữ, nên trừ sau khi mở là trừ sau khi đã tiêu thụ. Cùng khuôn với đường
  // ghi bình luận: trừ NGAY TRƯỚC lượt ghi.
  const ip = getClientIp(event)
  const ipKey = `ls:sse:${ip}`
  const state = await recordRateLimitHit(ipKey, SSE_CONNECTION_RULE, rateLimitDeps())
  if (state.count > SSE_CONNECTION_RULE.limit) {
    setResponseStatus(event, 429)
    setResponseHeader(event, 'retry-after', state.retryAfterSeconds || SSE_CONNECTION_RULE.windowSeconds)
    return { ok: false, message: 'Quá nhiều kết nối từ địa chỉ của bạn. Vui lòng thử lại sau ít giây.' }
  }

  const stream = createNodeSseStream(event)
  if (isShuttingDown()) {
    void stream.push({ event: SSE_EVENT_SHUTDOWN, data: SHUTDOWN_REASON }).catch(stream.abort)
    void stream.close()
    return stream.send()
  }

  const registered = registerStream(stream, session.id)
  if (!registered) {
    // Cap toàn cục đã đạt — không phải lỗi của người xem, là sức chứa cổng.
    void stream.close().catch(() => undefined)
    setResponseStatus(event, 503)
    setResponseHeader(event, 'retry-after', 30)
    return { ok: false, message: 'Số người xem đang ở mức tối đa. Vui lòng thử lại sau ít giây.' }
  }

  void stream.push({
    event: SSE_EVENT_READY,
    data: JSON.stringify({ sessionId: session.id, title: session.title }),
  }).catch(stream.abort)
  return stream.send()
})
