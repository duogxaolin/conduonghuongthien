/**
 * Kiểm duyệt nội dung — cửa vào công khai duy nhất.
 *
 * Tệp này là barrel: xuất lại ĐÚNG những tên nó luôn xuất (9 giá trị + 11 kiểu) cộng
 * `matchInstantRuleBatch` và `earlierTurnsToWithhold` thêm có chủ đích sau khi tách (lượt cũ của
 * chat quét trong một lượt `vm`; lượt cũ mà hạn mức request không tới được cũng bị giữ khỏi model;
 * ghim ở `tests/service-split-boundaries.test.ts` luật 5), nên mọi nơi gọi — 6 endpoint,
 * `comments-posting.ts`, `comments-reply-email.ts`, `livestream-chat.ts`, hai endpoint
 * chatbot, `moderation-rescan-job.ts` — giữ một đường import. Bảy tệp test
 * `mock.module` đúng đường này: nơi gọi import thẳng một tệp con sẽ lọt khỏi mock đó
 * (luật 6 của cùng guard chặn).
 *
 * Mã nằm ở các tệp con (wave3 D-SPLIT, tách nguyên văn — không đổi hành vi):
 *
 *   - moderation-worker-types.ts     kiểu vào/ra của một lượt kiểm
 *   - moderation-worker-prescreen.ts `matchInstantRule` (+ `…Batch`, `earlierTurnsToWithhold`) +
 *                                    `fastPreModerate` (chặn tức thì)
 *   - moderation-worker-check.ts     `checkAndModerateContent` (luật + AI + ghi)
 *   - moderation-worker-persist.ts   hàng chờ duyệt + ẩn hàng đích (KHÔNG xuất lại)
 *   - moderation-worker-rescan.ts    quét lại theo lô có trần
 *
 * và ở ba tệp tách từ trước: `moderation-rules-cache.ts` (cache luật),
 * `moderation-stats.ts` (số đo `workerStats`), `moderation-instant.ts` (từ điển chặn
 * tức thì + ghi hàng chờ của một lượt chặn). Tệp con import lẫn nhau, không bao giờ
 * import barrel này.
 */

// Cache luật, số đo worker và chặn tức thì đã tách file; re-export để mọi import cũ
// từ './moderation-worker' (endpoint, comments, livestream-chat, chatbot) không đổi.
export { getActiveModerationRules, invalidateModerationRulesCache } from './moderation-rules-cache'
export { getWorkerStats, resetWorkerStats } from './moderation-stats'
export type { FastPreModerateResult } from './moderation-instant'

export type {
  ModerationCheckInput,
  ModerationCheckOutput,
  ModerationCheckOptions,
  ModerationPersistFailure,
} from './moderation-worker-types'

export { matchInstantRule, matchInstantRuleBatch, earlierTurnsToWithhold, fastPreModerate } from './moderation-worker-prescreen'
export type { InstantRuleMatch } from './moderation-worker-prescreen'

export { checkAndModerateContent } from './moderation-worker-check'

export { MODERATION_RESCAN_LIMITS, rescanExistingContent } from './moderation-worker-rescan'
export type {
  RescanCursor,
  RescanCounts,
  RescanProgress,
  RescanSummary,
  RescanOptions,
} from './moderation-worker-rescan'
