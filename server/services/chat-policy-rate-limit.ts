/**
 * Giới hạn tần suất chat theo địa chỉ và hạn mức gọi AI (theo phiên + trần theo địa
 * chỉ). Tách nguyên văn từ `server/utils/chatbot/chat-policy.ts` (wave3 D-SPLIT). Hai
 * luật hạn mức (`AI_QUOTA_RULE`, `AI_IP_CEILING_RULE`) chỉ khai ở đây — một chủ (guard
 * ranh giới tách tệp, luật 4).
 */
import { createHash } from 'node:crypto'
import { getClientIp } from '../utils/client-ip'
import { recordRateLimitHit, type RateLimitDeps, type RateLimitRule } from '../utils/rate-limit-store'
import type { ChatbotSettings } from '../db/schema'
import { CHATBOT_HOTLINE } from '../utils/chatbot/prompt-defaults'
import { rateLimitDeps } from '../utils/rate-limit-deps'
import type { ChatEvent } from './chat-policy-contract'

const RATE_LIMIT_NAMESPACE = 'cdkt-chat-rate-limit-v1'

/** AI provider calls per browser session. Guards spend, not abuse of the portal. */
export const AI_QUOTA_RULE: RateLimitRule = { limit: 20, windowSeconds: 60 * 60 }

/**
 * Ceiling on AI provider calls per client address, charged **alongside** the
 * session quota — not instead of it.
 *
 * The session quota alone is a per-token allowance, and a token costs nothing:
 * `/api/public/chatbot/session` signs a fresh one for anybody (stateless HMAC, no
 * database row), so asking for a new token resets the 20-call allowance to zero.
 * The only thing left between that and the AI bill was the 10-requests-a-minute
 * chat limit, i.e. up to 600 provider calls an hour from one address — thirty
 * times the intended allowance. This ceiling is the missing bound.
 *
 * 100 an hour is five sessions' worth: room for a family or a small office
 * behind one address, an order of magnitude under what token-farming reached.
 * Visitors past it still get the approved-bank answer (see `answerGroundedChat`).
 */
export const AI_IP_CEILING_RULE: RateLimitRule = { limit: 100, windowSeconds: 60 * 60 }

const AI_QUOTA_MESSAGE = `Bạn đã dùng hết lượt hỏi trợ lý AI trong giờ này. Vui lòng thử lại sau, hoặc liên hệ đường dây nóng ${CHATBOT_HOTLINE} để được hỗ trợ ngay.`

function clientKey(event: ChatEvent): string {
  // Behind nginx every visitor shares one peer address, so keying on it made the
  // 10/minute limit global: visitor eleven was refused because of ten strangers.
  const clientAddress = getClientIp(event).normalize('NFKC').trim().toLowerCase()
  const identity = clientAddress && clientAddress !== 'unknown' ? clientAddress : 'anonymous'
  return `chat:${createHash('sha256').update(RATE_LIMIT_NAMESPACE).update('\0').update(identity).digest('hex')}`
}

/**
 * Translates "allow N requests per window" into the store's rule shape.
 *
 * The store increments first and then blocks on `count >= rule.limit`, so
 * passing N straight through would refuse the very first request when N is 1.
 * The limit the admin configures means *requests allowed*, so the rule handed
 * to the store is one higher: the (N+1)-th request is the one that blocks.
 */
function storeRule(allowedRequests: number, windowSeconds: number): RateLimitRule {
  return { limit: Math.max(1, allowedRequests) + 1, windowSeconds }
}

/**
 * Records a hit and returns retry-after seconds when the caller is over the
 * limit, else null.
 *
 * Counters live in `rate_limit_counters`, so a restart no longer wipes every
 * window and two replicas no longer grant double the allowance. If the database
 * is unreachable the store falls back to an in-process counter — still a limit,
 * just per worker, which is exactly the behaviour this replaced.
 */
export async function enforceChatRateLimit(key: string, limit: number, windowSeconds: number): Promise<number | null> {
  const state = await recordRateLimitHit(key, storeRule(limit, windowSeconds), rateLimitDeps())
  return state.blocked ? Math.max(1, state.retryAfterSeconds) : null
}

export const CHAT_RATE_LIMITED_MESSAGE = 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.'

/**
 * Charge the per-address chat limit (`settings.rateLimitRequests` per window)
 * for this request — exactly once — and return retry-after seconds when over it.
 *
 * The chat endpoints call this BEFORE the instant moderation check: every message
 * that moderation blocks writes a review-queue row (and, with a session, a chat
 * turn), so a limit charged only inside `answerGroundedChat` — after moderation —
 * let an anonymous script flood the review queue with no limit at all. The
 * decision is memoised on `event.context`, so the later call inside
 * `answerGroundedChat` reuses it instead of counting the same request twice.
 * Not the AI quota: `enforceAiQuota` is still charged only where a provider call
 * is imminent.
 */
export async function chargeChatRateLimit(event: ChatEvent, settings: ChatbotSettings): Promise<number | null> {
  const context = event.context as { chatRateLimit?: { retryAfter: number | null } } | undefined
  if (context?.chatRateLimit) return context.chatRateLimit.retryAfter
  const retryAfter = await enforceChatRateLimit(clientKey(event), settings.rateLimitRequests, settings.rateLimitWindowSeconds)
  if (context) context.chatRateLimit = { retryAfter }
  return retryAfter
}

/**
 * Per-session quota on AI provider calls, checked only when a provider call is
 * actually about to happen.
 *
 * Keyed on the session rather than the IP on purpose: a family or an office
 * shares one address, and one person's long conversation should not spend the
 * next person's allowance. Sessions without a verified token fall back to the
 * IP key — otherwise dropping the header would be a way to opt out of the quota.
 */
export async function enforceAiQuota(
  event: ChatEvent,
  sessionId: string | null,
  deps: RateLimitDeps = rateLimitDeps(),
): Promise<number | null> {
  const key = sessionId ? `chat-ai:${sessionId}` : `chat-ai-ip:${clientKey(event)}`
  const state = await recordRateLimitHit(key, storeRule(AI_QUOTA_RULE.limit, AI_QUOTA_RULE.windowSeconds), deps)
  if (state.blocked) return Math.max(1, state.retryAfterSeconds)

  // A visitor with no token is already counted per address above, at the
  // stricter limit; only a token holder needs the address ceiling on top.
  if (!sessionId) return null
  const ceiling = await recordRateLimitHit(
    `chat-ai-ip-ceiling:${clientKey(event)}`,
    storeRule(AI_IP_CEILING_RULE.limit, AI_IP_CEILING_RULE.windowSeconds),
    deps,
  )
  return ceiling.blocked ? Math.max(1, ceiling.retryAfterSeconds) : null
}

/** Câu trả lời khi hết hạn mức AI ở nhánh hỏi tự do — chỉ `chat-policy-answer.ts` dùng. */
export { AI_QUOTA_MESSAGE }
