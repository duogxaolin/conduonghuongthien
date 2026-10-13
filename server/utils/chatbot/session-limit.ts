import type { H3Event } from 'h3'
import { getClientIp } from '../client-ip'
import { rateLimitDeps } from '../rate-limit-deps'
import { recordRateLimitHit, type RateLimitDeps } from '../rate-limit-store'

/**
 * Giới hạn tần suất cấp token phiên chat (`/api/public/chatbot/session`).
 *
 * Token ký bằng HMAC, không tốn DB nên việc cấp nó rẻ — hạn mức AI không còn dựa
 * vào việc token khan hiếm (đã có trần theo IP, xem `AI_IP_CEILING_RULE`). Giới hạn
 * này là phòng thủ chiều sâu: một script không thể dội endpoint và làm ngập log.
 *
 * 60 token/giờ/IP: mỗi khách lưu tối đa 10 cuộc trò chuyện (mỗi cuộc một token),
 * nên đủ cho một văn phòng nhỏ dùng chung một địa chỉ. Bị từ chối thì client coi
 * như "không có token" và rơi về hạn mức theo IP (`ensureSessionToken` trả `null`).
 */
export const CHAT_SESSION_MINT_ALLOWED = 60
export const CHAT_SESSION_MINT_WINDOW_SECONDS = 60 * 60

/** Trả số giây cần chờ khi bị từ chối, hoặc `null` nếu còn lượt. */
export async function enforceSessionMintLimit(event: H3Event, deps: RateLimitDeps = rateLimitDeps()): Promise<number | null> {
  // The store blocks once `count >= limit`, so "N allowed" is a limit of N + 1.
  const state = await recordRateLimitHit(
    `chat-session:${getClientIp(event)}`,
    { limit: CHAT_SESSION_MINT_ALLOWED + 1, windowSeconds: CHAT_SESSION_MINT_WINDOW_SECONDS },
    deps,
  )
  return state.blocked ? Math.max(1, state.retryAfterSeconds) : null
}
