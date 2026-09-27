import { getClientIp } from '../../../utils/client-ip'
import { createCaptcha } from '../../../utils/captcha-store'
import {
  peekRateLimit,
  recordRateLimitHit,
  type RateLimitRule,
} from '../../../utils/rate-limit-store'
import { rateLimitDeps } from '../../../utils/rate-limit-deps'

/**
 * Sinh captcha SVG cho login.
 *
 * Rate limit 10 / 1 phút per IP — chặn flood captcha image (mỗi image ~2KB SVG,
 * 1000 request/giây là 2MB/s RAM cho kho in-memory). Không cần ghi vào DB —
 * bucket `captcha:ip:<ip>` dùng cùng bảng `rate_limit_counters` với login.
 */
const CAPTCHA_RULE: RateLimitRule = { limit: 10, windowSeconds: 60 }

export default defineEventHandler(async (event) => {
  const ip = getClientIp(event)
  const bucket = `captcha:ip:${ip}`
  const deps = rateLimitDeps()

  const state = await peekRateLimit(bucket, CAPTCHA_RULE, deps)
  if (state.blocked) {
    setResponseHeader(event, 'Retry-After', state.retryAfterSeconds)
    throw createError({ statusCode: 429, statusMessage: 'Quá nhiều yêu cầu captcha. Thử lại sau 1 phút.' })
  }
  await recordRateLimitHit(bucket, CAPTCHA_RULE, deps)

  const { captchaId, svg } = createCaptcha()
  return { captchaId, svg }
})
