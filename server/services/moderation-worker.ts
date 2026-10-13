import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import {
  aiModerationQueue,
  articleComments,
  chatMessages,
  livestreamMessages,
} from '../db/schema'
import { callAi } from './ai-gateway'
import { logWarn, logInfo } from '../utils/logger'
import { getActiveModerationRules } from './moderation-rules-cache'
import { workerStats } from './moderation-stats'
import {
  INSTANT_PROFANITY,
  INSTANT_HOSTILE,
  INSTANT_SPAM_GAMBLING,
  recordInstantBlock,
  type FastPreModerateResult,
} from './moderation-instant'

// Cache luật, số đo worker và chặn tức thì đã tách file; re-export để mọi import cũ
// từ './moderation-worker' (endpoint, comments, livestream-chat, chatbot) không đổi.
export { getActiveModerationRules, invalidateModerationRulesCache } from './moderation-rules-cache'
export { getWorkerStats, resetWorkerStats } from './moderation-stats'
export type { FastPreModerateResult } from './moderation-instant'

export interface ModerationCheckInput {
  content: string
  targetType: 'comment' | 'chat' | 'article' | 'livestream_chat'
  targetId?: number
  authorName?: string
  authorIp?: string
  contextTitle?: string
  contextUrl?: string
  sessionId?: string
}

export interface ModerationCheckOutput {
  flagged: boolean
  action: "allow" | "auto_hide" | "flag_only" | "block"
  severity: 'low' | 'medium' | 'high' | 'critical'
  reasons: string[]
  matchedRules: string[]
}



/**
 * Fast synchronous pre-moderator: scans built-in dictionaries + active database rules.
 * Runs in < 1ms without external network or AI delay.
 */
export async function fastPreModerate(
  content: string,
  context?: {
    authorName?: string
    authorIp?: string
    targetType?: 'comment' | 'chat' | 'livestream_chat' | 'article'
    sessionId?: string
    contextTitle?: string
    contextUrl?: string
  },
): Promise<FastPreModerateResult> {
  const trimmed = (content || '').trim()
  if (!trimmed) {
    return { blocked: false, action: "allow", severity: 'low', reason: '', matchedRule: '' }
  }

  workerStats.totalScanned++
  workerStats.lastScannedAt = new Date().toISOString()

  // 1. Built-in high-confidence rules
  for (const item of INSTANT_PROFANITY) {
    if (item.pattern.test(trimmed)) {
      return recordInstantBlock(trimmed, 'profanity', 'high', item.label, context)
    }
  }

  for (const item of INSTANT_HOSTILE) {
    if (item.pattern.test(trimmed)) {
      return recordInstantBlock(trimmed, 'anti_state', 'critical', item.label, context)
    }
  }

  for (const item of INSTANT_SPAM_GAMBLING) {
    if (item.pattern.test(trimmed)) {
      return recordInstantBlock(trimmed, 'spam_fraud', 'high', item.label, context)
    }
  }

  // 2. Active custom rules from database
  try {
    const rules = await getActiveModerationRules()
    const lower = trimmed.toLowerCase()
    for (const rule of rules) {
      if (rule.ruleType === 'keyword') {
        if (lower.includes(rule.pattern.toLowerCase().trim())) {
          return recordInstantBlock(
            trimmed,
            rule.category,
            (rule.severity as 'low' | 'medium' | 'high' | 'critical') || 'high',
            `Từ khóa: ${rule.pattern}`,
            context,
          )
        }
      } else {
        try {
          const regex = new RegExp(rule.pattern, 'iu')
          if (regex.test(trimmed)) {
            return recordInstantBlock(
              trimmed,
              rule.category,
              (rule.severity as 'low' | 'medium' | 'high' | 'critical') || 'high',
              `Mẫu regex: ${rule.pattern}`,
              context,
            )
          }
        } catch {
          // Skip invalid regex
        }
      }
    }
  } catch {
    // If DB read fails, built-in instant rules still secure the entrance
  }

  workerStats.allowedCount++
  return { blocked: false, action: "allow", severity: 'low', reason: '', matchedRule: '' }
}

/**
 * Scan content against active security rules & AI moderation model.
 * If flagged:
 * - Automatically records to `ai_moderation_queue`
 * - Automatically marks `is_hidden = true` or `is_deleted = true`
 */
export async function checkAndModerateContent(input: ModerationCheckInput): Promise<ModerationCheckOutput> {
  const content = (input.content || '').trim()
  if (!content) {
    return { flagged: false, action: "allow", severity: 'low', reasons: [], matchedRules: [] }
  }

  // First check fast pre-moderator
  const fast = await fastPreModerate(content, input)
  if (fast.blocked) {
    // Already flagged by pre-moderator, auto-hide database target row if targetId provided
    if (input.targetId) {
      const db = getDb()
      try {
        if (input.targetType === 'comment') {
          await db
            .update(articleComments)
            .set({ isHidden: true, flagReason: fast.reason.slice(0, 255) })
            .where(eq(articleComments.id, input.targetId))
        } else if (input.targetType === 'chat') {
          await db
            .update(chatMessages)
            .set({ isFlagged: true, flagReason: fast.reason.slice(0, 255) })
            .where(eq(chatMessages.id, input.targetId))
        } else if (input.targetType === 'livestream_chat') {
          await db
            .update(livestreamMessages)
            .set({ isDeleted: true })
            .where(eq(livestreamMessages.id, input.targetId))
        }
      } catch {
        // Non-blocking
      }
    }

    return {
      flagged: true,
      action: "auto_hide",
      severity: fast.severity,
      reasons: [fast.reason],
      matchedRules: [fast.matchedRule],
    }
  }

  const db = getDb()
  const rules = await getActiveModerationRules()

  const matchedKeywords: Array<{ pattern: string; category: string; severity: string; action: string }> = []
  const lowerContent = content.toLowerCase()

  for (const rule of rules) {
    const pattern = rule.pattern.toLowerCase().trim()
    let isMatch = false

    if (rule.ruleType === 'keyword') {
      if (lowerContent.includes(pattern)) isMatch = true
    } else {
      try {
        const regex = new RegExp(pattern, 'iu')
        if (regex.test(content)) isMatch = true
      } catch {
        if (lowerContent.includes(pattern)) isMatch = true
      }
    }

    if (isMatch) {
      matchedKeywords.push({
        pattern: rule.pattern,
        category: rule.category,
        severity: rule.severity,
        action: rule.action,
      })
    }
  }

  // Context-Aware AI Moderation — every non-empty comment is scanned.
  // Người dùng yêu cầu MỌI bình luận đều qua AI một lược, kể cả bình luận
  // ngắn 1-4 ký tự: "ls", "wow", "đjt"... Comment ngắn từng bị bỏ qua vì "không
  // đủ ngữ cảnh", nhưng đúng loại đó là nơi từ lóng/tục tĩu rút gọn lọt qua
  // sàn 5 ký tự. AI trả verdict trên bất kỳ độ dài nào; nếu quá ngắn để phân
  // tích, AI sẽ trả "safe" và không ẩn gì.
  let isFlagged = false
  let finalAction: 'allow' | 'auto_hide' | 'flag_only' | 'block' = 'allow'
  let highestSeverity: 'low' | 'medium' | 'high' | 'critical' = 'low'
  const reasons: string[] = []
  const matchedRules: string[] = []

  const severityWeight = { low: 1, medium: 2, high: 3, critical: 4 }

  // Luôn chạy AI cho mọi content không rỗng (bỏ ngưỡng độ dài cũ).
  // `content.length > 0` đã được đảm bảo ở đầu hàm, giữ lại làm bảo vệ.
  if (content.length > 0) {
    const detectedStr = matchedKeywords.length > 0
      ? `\nTừ khóa / chuyên đề nhạy cảm phát hiện trong câu: ${matchedKeywords.map(k => `"${k.pattern}" (${k.category})`).join(', ')}`
      : ''

    const aiPrompt = `Bạn là sĩ quan an ninh mạng phụ trách kiểm duyệt nội dung trên Cổng thông tin Cục C11 - Bộ Công an.
Hãy đọc hiểu ngữ cảnh toàn bộ nội dung sau đây:
"${content.slice(0, 1000)}"${detectedStr}

YÊU CẦU PHÂN TÍCH NGỮ CẢNH:
1. Phân biệt rõ ràng giữa:
   - TÍCH CỰC / CẢNH GIÁC: Người dân/cán bộ nhắc đến từ khóa nhằm mục đích cảnh giác, lên án, phản bác luận điệu thù địch, giải thích pháp luật hoặc chia sẻ thông tin đúng đắn -> Đánh giá: "safe" (An toàn, KHÔNG ẩn).
   - TIÊU CỰC / VI PHẠM: Tuyên truyền cho tổ chức phản động, kích động bạo loạn, lôi kéo lật đổ chính quyền, bôi nhọ lãnh đạo Đảng/Nhà nước, xuyên tạc chính sách, phát tán link cờ bạc, lừa đảo, dùng từ ngữ thô tục xúc phạm -> Đánh giá: "violation" hoặc "spam" (Vi phạm, CẦN ẨN).

CÁC TRƯỜNG HỢP ĐẶC BIỆT PHẢI NHẬN DIỆN ĐÚNG BÊN TÍCH CỰC (KHÔNG ẨN):
- Ca ngợi Đảng Cộng sản Việt Nam, Nhà nước XHCN Việt Nam, Bác Hồ, lãnh đạo, chính quyền, lực lượng công an, quân đội -> "safe". Từ viết tắt hợp lệ cho Đảng Cộng sản: "đcs", "dcs", "đảng", "DCS", "ĐCS".
- Câu phản biện, mỉa mai, bất bình với những kẻ tôn vinh chế độ cũ (VNCH, "việt nam cộng hòa"), chống đối, bôi nhọ -> "safe" (vì đang bênh vực chế độ hiện tại, không phải tuyên truyền phản động).
- Nhắc đến "xã hội chủ nghĩa", "cộng hòa", "việt nam cộng hòa" trong ngữ cảnh ca ngợi, giải thích, phản bác luận điệu thù địch -> "safe".
- Chỉ ẩn khi câu ĐỐI LẬP/công khai tôn vinh khẩu hiệu chế độ cũ ("việt nam cộng hòa muôn năm", "đả đảo", "lật đổ", "chống phá đảng") với chủ đích chống phá, không phải khi nhắc đến để phản bác.

2. Trả về đúng định dạng JSON thuần túy (không kèm markdown):
{
  "verdict": "safe" | "spam" | "violation",
  "intent": "propaganda" | "denunciation" | "educational" | "spam" | "neutral",
  "riskLevel": "low" | "medium" | "high" | "critical",
  "reason": "Giải thích ngắn gọn 1 câu phân tích ngữ cảnh và ý đồ của người viết"
}`

    const startAi = Date.now()
    try {
      const aiResult = await callAi('moderation', {
        prompt: aiPrompt,
        variables: { content: content.slice(0, 500), author: input.authorName || 'User' },
      })
      workerStats.lastAiLatencyMs = Date.now() - startAi

      if (aiResult.ok && aiResult.text) {
        const clean = aiResult.text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim()
        const parsed = JSON.parse(clean) as {
          verdict?: string
          intent?: string
          riskLevel?: string
          reason?: string
        }

        if (parsed.verdict === 'violation' || parsed.verdict === 'spam') {
          isFlagged = true
          finalAction = 'auto_hide'
          const s = (parsed.riskLevel || 'high') as keyof typeof severityWeight
          if (severityWeight[s] > severityWeight[highestSeverity]) {
            highestSeverity = s
          }
          matchedRules.push(`[AI Ngữ cảnh] ${parsed.intent || parsed.verdict}`)
          for (const k of matchedKeywords) {
            matchedRules.push(`[${k.category}] ${k.pattern}`)
          }
          reasons.push(parsed.reason || 'AI phân tích ngữ cảnh: Phát hiện ý đồ vi phạm tiêu chuẩn an ninh.')
          workerStats.blockedAi++
        } else {
          isFlagged = false
          finalAction = 'allow'
          workerStats.allowedCount++
        }
      } else {
        // Fallback on AI error. Phân biệt hai nhóm lý do:
        //  - AI CHƯA CẤU HÌNH (service_not_found / service_inactive / no_api_key):
        //    admin chưa bật nhà cung cấp cho service 'moderation'. Không có AI
        //    domestically đối soát → đưa vào hàng đợi `pending` để con người duyệt.
        //    KHÔNG tự ẩn nội dung (chỉ `flag_only`) — ẩn khi chưa ai xem là buộc
        //    công dân phải tự chứng minh mình trong sáng.
        //  - Lỗi tạm thời (provider_error / parse_error / budget_exceeded): chỉ
        //    flag khi có critical keyword, không flood queue bằng lỗi tạm thời.
        const aiUnavailable =
          aiResult.error === 'service_not_found' ||
          aiResult.error === 'service_inactive' ||
          aiResult.error === 'no_api_key'

        if (aiUnavailable) {
          isFlagged = true
          finalAction = 'flag_only'
          highestSeverity = 'medium'
          for (const k of matchedKeywords) {
            matchedRules.push(`[${k.category}] ${k.pattern}`)
            const s = k.severity as keyof typeof severityWeight
            if (severityWeight[s] > severityWeight[highestSeverity]) {
              highestSeverity = s
            }
          }
          reasons.push(
            matchedKeywords.length > 0
              ? `AI kiểm duyệt chưa cấu hình; khớp từ khóa nhạy cảm: ${matchedKeywords.map(k => `"${k.pattern}"`).join(', ')} — cần con người đối soát`
              : 'AI kiểm duyệt chưa cấu hình — cần con người đối soát nội dung',
          )
        } else if (matchedKeywords.some(k => k.severity === 'critical')) {
          isFlagged = true
          finalAction = 'auto_hide'
          highestSeverity = 'critical'
          matchedRules.push(...matchedKeywords.map(k => `[${k.category}] ${k.pattern}`))
          reasons.push(`Khớp từ khóa an ninh: ${matchedKeywords.map(k => `"${k.pattern}"`).join(', ')} (Dự phòng lỗi AI)`)
        }
      }
    } catch (err) {
      workerStats.errorCount++
      workerStats.lastError = err instanceof Error ? err.message : String(err)
      workerStats.lastErrorAt = new Date().toISOString()
      if (matchedKeywords.some(k => k.severity === 'critical')) {
        isFlagged = true
        finalAction = 'auto_hide'
        highestSeverity = 'critical'
        matchedRules.push(...matchedKeywords.map(k => `[${k.category}] ${k.pattern}`))
        reasons.push(`Khớp từ khóa an ninh: ${matchedKeywords.map(k => `"${k.pattern}"`).join(', ')} (Dự phòng lỗi AI)`)
      }
    }
  }

  // 3. Automated Action: Record to queue & hide content
  if (isFlagged) {
    try {
      await db.insert(aiModerationQueue).values({
        targetType: input.targetType,
        targetId: input.targetId ? Number(input.targetId) : null,
        authorName: input.authorName || 'Khách',
        authorIp: input.authorIp || null,
        contextTitle: input.contextTitle || null,
        contextUrl: input.contextUrl || null,
        sessionId: input.sessionId || null,
        contentSnippet: content.slice(0, 1000),
        flaggedReason: reasons.join('; '),
        matchedRules,
        severity: highestSeverity,
        status: 'pending',
      })
    } catch {
      // Non-blocking queue insert
    }

    if (finalAction === 'auto_hide' && input.targetId) {
      try {
        if (input.targetType === 'comment') {
          await db
            .update(articleComments)
            .set({ isHidden: true, flagReason: reasons.join('; ').slice(0, 255) })
            .where(eq(articleComments.id, input.targetId))
        } else if (input.targetType === 'chat') {
          await db
            .update(chatMessages)
            .set({ isFlagged: true, flagReason: reasons.join('; ').slice(0, 255) })
            .where(eq(chatMessages.id, input.targetId))
        } else if (input.targetType === 'livestream_chat') {
          await db
            .update(livestreamMessages)
            .set({ isDeleted: true })
            .where(eq(livestreamMessages.id, input.targetId))
        }
      } catch {
        // Non-blocking update
      }
    }
  }

  // Ghi log mỗi lần check — kể cả khi safe — để traces được "moderation đã chạy
  // cho bình luận id X". Trước đây chỉ log khi flagged, nên một bình luận không bị
  // ẩn đọc ra y hệt "chưa ai check". Audit dùng logInfo (không phải logWarn) khi
  // safe — đây là hoạt động bình thường, không phải cảnh báo.
  if (isFlagged) {
    logWarn({
      event: 'ai_moderation.flagged',
      targetType: input.targetType,
      targetId: input.targetId,
      action: finalAction,
      severity: highestSeverity,
      reasons,
    })
  } else {
    logInfo({
      event: 'ai_moderation.checked_safe',
      targetType: input.targetType,
      targetId: input.targetId,
      contentLength: content.length,
      matchedKeywordsCount: matchedKeywords.length,
    })
  }

  return {
    flagged: isFlagged,
    action: finalAction,
    severity: highestSeverity,
    reasons,
    matchedRules,
  }
}

/**
 * Retroactive cleaner: scans all existing non-hidden comments & non-deleted livestream messages.
 * Uses `checkAndModerateContent` for article comments so the AI context pass also
 * runs — `fastPreModerate` alone only catches built-in regex/keyword matches and
 * lets subtle defamation or distortion through, which read as "moderation stopped
 * filtering". Livestream chat stays on `fastPreModerate` because it is a live
 * stream: sub-second latency matters more than a context pass, and the entry
 * path already moderates each message in real time.
 */
export async function rescanExistingContent(): Promise<{
  scannedComments: number
  hiddenComments: number
  scannedMessages: number
  deletedMessages: number
}> {
  const db = getDb()
  let hiddenComments = 0
  let deletedMessages = 0

  // 1. Scan article_comments — full context pass (fast pre-moderator + AI)
  const comments = await db
    .select({ id: articleComments.id, body: articleComments.body })
    .from(articleComments)
    .where(eq(articleComments.isHidden, false))

  for (const c of comments) {
    const result = await checkAndModerateContent({
      content: c.body,
      targetType: 'comment',
      targetId: c.id,
      contextTitle: `Quét lại bình luận #${c.id}`,
    })
    if (result.flagged && result.action === 'auto_hide') {
      hiddenComments++
    }
  }

  // 2. Scan livestream_messages — fast path only (live stream, latency-sensitive)
  const liveMsgs = await db
    .select({ id: livestreamMessages.id, content: livestreamMessages.content })
    .from(livestreamMessages)
    .where(eq(livestreamMessages.isDeleted, false))

  for (const m of liveMsgs) {
    const check = await fastPreModerate(m.content, {
      targetType: 'livestream_chat',
      contextTitle: `Quét lại tin chat trực tiếp #${m.id}`,
    })
    if (check.blocked) {
      await db
        .update(livestreamMessages)
        .set({ isDeleted: true })
        .where(eq(livestreamMessages.id, m.id))
      deletedMessages++
    }
  }

  logInfo({
    event: 'ai_moderation.rescan_completed',
    scannedComments: comments.length,
    hiddenComments,
    scannedMessages: liveMsgs.length,
    deletedMessages,
  })

  return {
    scannedComments: comments.length,
    hiddenComments,
    scannedMessages: liveMsgs.length,
    deletedMessages,
  }
}
