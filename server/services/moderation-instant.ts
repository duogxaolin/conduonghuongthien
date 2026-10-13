/**
 * Chặn tức thì: mẫu regex dựng sẵn (thô tục / chống phá / cờ bạc) và ghi hàng đợi duyệt.
 * Tách nguyên văn từ moderation-worker.ts.
 */
import { getDb } from '../utils/db'
import { aiModerationQueue } from '../db/schema'
import { workerStats } from './moderation-stats'

export interface FastPreModerateResult {
  blocked: boolean
  action: "allow" | "block"
  severity: 'low' | 'medium' | 'high' | 'critical'
  reason: string
  matchedRule: string
}

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
  context?: {
    authorName?: string
    authorIp?: string
    targetType?: 'comment' | 'chat' | 'livestream_chat' | 'article'
    sessionId?: string
    contextTitle?: string
    contextUrl?: string
  },
): Promise<FastPreModerateResult> {
  workerStats.blockedInstant++

  // Record asynchronously into queue for administrative review
  try {
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
  } catch {
    // Queue logging is non-blocking
  }

  return {
    blocked: true,
    action: "block",
    severity,
    reason: `Nội dung vi phạm tiêu chuẩn an ninh và quy định cộng đồng (${reason}).`,
    matchedRule: reason,
  }
}
