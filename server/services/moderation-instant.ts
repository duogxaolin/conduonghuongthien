/**
 * Chặn tức thì: mẫu regex dựng sẵn (thô tục / chống phá / cờ bạc) và ghi hàng đợi duyệt.
 * Tách nguyên văn từ moderation-worker.ts.
 */
import { createHash } from 'node:crypto'
import { getDb } from '../utils/db'
import { aiModerationQueue } from '../db/schema'
import { ipBucket } from '../utils/ip-bucket'
import { logError } from '../utils/logger'
import { rateLimitDeps } from '../utils/rate-limit-deps'
import { recordRateLimitHit, type RateLimitRule } from '../utils/rate-limit-store'
import { workerStats } from './moderation-stats'
import type { ModerationRegexBudget } from './moderation-regex'

/** Ngữ cảnh một lượt chặn tức thì — chung cho `fastPreModerate` và `recordInstantBlock`. */
export interface InstantBlockContext {
  /** Hạn mức thời gian khớp regex của request (`createModerationRegexBudget`); chỉ `fastPreModerate` đọc. */
  regexBudget?: ModerationRegexBudget
  authorName?: string
  authorIp?: string
  targetType?: 'comment' | 'chat' | 'livestream_chat' | 'article'
  sessionId?: string
  contextTitle?: string
  contextUrl?: string
  /** Người đọc đã đăng nhập (bình luận, chat livestream) — thêm một khoá trần theo tài khoản. */
  readerId?: number
  /** See MODERATION_QUEUE_CAP. Set by public inbound flows; never by rescans. */
  capQueuePerSource?: boolean
}

/**
 * Trần số hàng `ai_moderation_queue` một nguồn được ghi trong một giờ.
 *
 * Chặn tức thì đứng ở cửa các luồng công khai (chatbot ẩn danh, bình luận và chat
 * livestream của người đọc). Mỗi tin bị chặn từng ghi một hàng chờ duyệt, nên một
 * script gửi lặp một câu thô tục làm ngập hàng đợi của cán bộ — hàng thật bị chôn
 * dưới hàng nghìn bản sao. Trần này chỉ giới hạn việc GHI NHẬN: tin vẫn bị chặn y
 * như cũ, chỉ không thêm hàng mới sau khi nguồn đó đã có đủ bằng chứng trong giờ.
 *
 * "Nguồn" là MỌI khoá áp dụng, và một hàng chỉ được ghi khi CẢ các khoá còn dưới trần:
 * - địa chỉ (IPv6 tính theo /64 — `ipBucket`), vì token phiên chatbot xin lại được
 *   miễn phí (cùng lý do với `AI_IP_CEILING_RULE`) và một tài khoản Google mới cũng
 *   rẻ: nhiều tài khoản sau một địa chỉ vẫn chung một trần;
 * - tài khoản người đọc khi có `readerId`: một tài khoản đổi địa chỉ liên tục vẫn
 *   chung một trần;
 * - phiên — chỉ khi không có địa chỉ lẫn tài khoản (giữ nguyên hành vi chatbot).
 */
export const MODERATION_QUEUE_CAP: { inserts: number, windowSeconds: number } = { inserts: 20, windowSeconds: 60 * 60 }
const MODERATION_QUEUE_NAMESPACE = 'cdkt-moderation-queue-cap-v1'

function hashedCapKey(identity: string): string {
  const digest = createHash('sha256').update(MODERATION_QUEUE_NAMESPACE).update('\0').update(identity).digest('hex')
  return `modq:${digest}`
}

function queueCapKeys(context: InstantBlockContext): string[] {
  const identities: string[] = []
  const ip = (context.authorIp ?? '').normalize('NFKC').trim().toLowerCase()
  if (ip && ip !== 'unknown') identities.push(`ip:${ipBucket(ip)}`)
  if (Number.isSafeInteger(context.readerId) && context.readerId! > 0) identities.push(`reader:${context.readerId}`)
  if (identities.length === 0) identities.push(context.sessionId ? `session:${context.sessionId}` : 'anonymous')
  return identities.map(hashedCapKey)
}

/**
 * True khi mọi khoá của nguồn này còn được ghi thêm hàng chờ duyệt trong cửa sổ.
 *
 * Mọi khoá đều được tính (không dừng ở khoá đầu đã đầy): mỗi khoá là một bộ đếm
 * nguyên tử của store, nên một hàng chỉ được ghi khi chính lượt tăng của từng khoá
 * còn ≤ trần — số hàng mỗi khoá không bao giờ vượt `inserts` dù có đua. Đánh đổi có
 * chủ đích: lượt bị khoá địa chỉ chặn vẫn tính vào khoá tài khoản (và ngược lại),
 * nên trần có thể đến SỚM hơn với một nguồn, không bao giờ muộn hơn.
 */
async function withinQueueCap(context: InstantBlockContext): Promise<boolean> {
  // Store chặn khi count >= limit sau khi tăng, nên "cho N lượt" là limit N + 1.
  const rule: RateLimitRule = { limit: MODERATION_QUEUE_CAP.inserts + 1, windowSeconds: MODERATION_QUEUE_CAP.windowSeconds }
  const deps = rateLimitDeps()
  let within = true
  for (const key of queueCapKeys(context)) {
    const state = await recordRateLimitHit(key, rule, deps)
    if (state.blocked) within = false
  }
  return within
}

/**
 * Lỗi ghi hàng chờ duyệt, ở dạng ghi log được.
 *
 * KHÔNG dùng `message` của lỗi ngoài cùng: `DrizzleQueryError` của drizzle-orm nhúng
 * nguyên mọi tham số của câu lệnh vào message — tức nội dung tin nhắn, địa chỉ IP
 * và tên người gửi. Lấy lỗi của driver bên dưới (`cause`), và cả message của nó
 * cũng che các đoạn trong nháy (MySQL trích giá trị: "Incorrect string value: '…'",
 * "Duplicate entry '…'").
 */
function describeQueueInsertError(err: unknown): { errorClass: string, errorCode?: string, error: string } {
  const root = err instanceof Error && err.cause instanceof Error ? err.cause : err
  if (!(root instanceof Error)) return { errorClass: typeof root, error: 'non-error value thrown' }
  const code = (root as { code?: unknown }).code
  const errno = (root as { errno?: unknown }).errno
  const errorCode = typeof code === 'string' ? code : typeof errno === 'number' ? String(errno) : undefined
  // Lỗi bọc câu lệnh mà không có `cause` thì message của nó chính là câu lệnh + tham số.
  const carriesParams = root === err && 'params' in root
  const error = carriesParams
    ? 'query failed (message withheld: it embeds the statement parameters)'
    : root.message.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "'…'").slice(0, 300)
  return { errorClass: root.constructor.name, ...(errorCode ? { errorCode } : {}), error }
}

export interface FastPreModerateResult {
  blocked: boolean
  action: "allow" | "block"
  severity: 'low' | 'medium' | 'high' | 'critical'
  /** For admins (review-queue row, hide reason): names the rule — `Mẫu regex: <mẫu>`, `Từ khóa: …`. */
  reason: string
  matchedRule: string
  /** What the SUBMITTER may be told — `INSTANT_BLOCK_PUBLIC_MESSAGE` when blocked, never the rule; `''` when allowed. */
  publicMessage: string
}

/**
 * The refusal a reader sees when the instant check blocks a comment or a livestream message
 * (verify of 4.3c follow-up, W8). It used to be `reason` — `… (Mẫu regex: <mẫu>).` — so the
 * submitter learnt the exact pattern that matched: enough to step around it, or to craft input
 * that makes THAT rule slow (`moderation-regex-runtime.ts`) until it is disabled for everyone. The
 * detail stays with the admins: the review-queue row and the hide reason carry `reason`.
 */
export const INSTANT_BLOCK_PUBLIC_MESSAGE = 'Nội dung vi phạm tiêu chuẩn an ninh và quy định cộng đồng nên không được đăng.'

// ── Built-in Instant Reject Patterns (< 1ms, zero latency) ────────────────
/**
 * Khớp CẢ TỪ với ranh giới Unicode. `\b` của JS chỉ hiểu ASCII, nên `\b(đcm|địt|đụ|...)\b`
 * không bao giờ khớp từ bắt đầu/kết thúc bằng chữ có dấu (`đ`, `ụ`, `ẻ`...): chỉ các biến thể
 * thuần ASCII (`dcm`, `djt`...) bị chặn. Lookaround `\p{L}\p{N}_` là ranh giới đúng cho tiếng Việt.
 */
const wholeWord = (alternatives: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{N}_])`, 'iu')

export const INSTANT_PROFANITY: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(f+u+c+k+|s+h+i+t+|b+i+t+c+h+|a+s+s+h+o+l+e*|d+i+c+k+|c+u+n+t+)\b/i, label: 'Tiếng Anh thô tục tục tĩu' },
  { pattern: wholeWord('địt|djt|dcm|đcm|đm|đmm|dmm|đyt|dyt|đệt|đẹt'), label: 'Chửi thề thô tục' },
  // `ỉa` và `đái` KHÔNG có trong danh sách: chúng chưa từng khớp (lỗi `\b`), và nếu khớp thì sẽ
  // chặn nhầm thuật ngữ y khoa ("đái tháo đường", "ỉa chảy") trong tin sức khoẻ.
  { pattern: wholeWord('lồn|cặc|buồi|đụ|đù|đĩ|đỹ|dái|hãm lồn'), label: 'Từ ngữ khiêu dâm / thô tục' },
  { pattern: wholeWord('liếm đít|bú cu|bú cặc|thủ dâm|súc vật|chó đẻ|óc chó|chó dại'), label: 'Xúc phạm nhân phẩm thô bạo' },
]

export const INSTANT_HOSTILE: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(việt tân|viet tan|triều đại việt|chính phủ quốc gia việt nam lâm thời)/i, label: 'Tổ chức phản động / khủng bố' },
  { pattern: /(lật đổ chính quyền|lật đổ chế độ|biểu tình bạo loạn|chống phá đảng|đả đảo đảng|đả đảo chính quyền)/i, label: 'Tuyên truyền chống phá Nhà nước' },
  { pattern: /(phản thanh phục minh.*thề giết|thề giết.*ngô tam quế|tiêu diệt cộng sản|diệt cộng)/i, label: 'Kích động bạo lực / lật đổ' },
  { pattern: /(liếm đít trung cộng|bò đỏ.*liếm|cộng phỉ|bọn việt cộng)/i, label: 'Xúc phạm chính trị / ngôn từ thù địch' },
]

export const INSTANT_SPAM_GAMBLING: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(tài xỉu|cá độ bóng đá|cờ bạc online|ku bet|thabet|kubet|nổ hũ|game đổi thưởng)/i, label: 'Cờ bạc / Đánh bạc trực tuyến' },
  { pattern: /(vay tiền nóng|vay lãi ngày|bốc bát họ|vay không cần thế chấp.*zalo)/i, label: 'Tín dụng đen / Vay nặng lãi' },
]

export async function recordInstantBlock(
  content: string,
  category: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  reason: string,
  context?: InstantBlockContext,
): Promise<FastPreModerateResult> {
  workerStats.blockedInstant++

  // Record into queue for administrative review. Public inbound flows opt in
  // to MODERATION_QUEUE_CAP rows per source per window; the block itself
  // (returned below) is unconditional, only the review row is skipped past the
  // cap. Admin rescans do not opt in — every hit there is a distinct stored row.
  try {
    if (context?.capQueuePerSource && !(await withinQueueCap(context))) return blockedResult(severity, reason)
    const db = getDb()
    await db.insert(aiModerationQueue).values({
      targetType: context?.targetType || 'chat',
      targetId: null,
      authorName: context?.authorName || 'Khách',
      authorIp: context?.authorIp || null,
      contextTitle: context?.contextTitle || null,
      contextUrl: context?.contextUrl || null,
      sessionId: context?.sessionId || null,
      contentSnippet: content.slice(0, 1000),
      flaggedReason: reason,
      matchedRules: [`[Chặn tức thì - ${category}] ${reason}`],
      severity,
      status: 'pending',
    })
  } catch (err: unknown) {
    // The block decision stands either way — a review row is evidence, not the
    // gate. But a lost row is a blocked message nobody can review, so it must
    // leave a trace. Ids and error shape only: never the content, IP or name.
    logError({
      event: 'ai_moderation.queue_insert_failed',
      targetType: context?.targetType || 'chat',
      category,
      severity,
      ...(context?.readerId !== undefined ? { readerId: context.readerId } : {}),
      ...(context?.sessionId ? { sessionId: context.sessionId } : {}),
      ...describeQueueInsertError(err),
    })
  }

  return blockedResult(severity, reason)
}

function blockedResult(severity: 'low' | 'medium' | 'high' | 'critical', reason: string): FastPreModerateResult {
  return {
    blocked: true,
    action: "block",
    severity,
    reason: `Nội dung vi phạm tiêu chuẩn an ninh và quy định cộng đồng (${reason}).`,
    matchedRule: reason,
    publicMessage: INSTANT_BLOCK_PUBLIC_MESSAGE,
  }
}
