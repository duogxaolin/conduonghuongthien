import { eq, desc } from 'drizzle-orm'
import { getDb } from '../utils/db'
import {
  aiModerationRules,
  aiModerationQueue,
  articleComments,
  chatMessages,
  type AiModerationRule,
} from '../db/schema'
import { callAi } from './ai-gateway'
import { logWarn, logInfo } from '../utils/logger'

export interface ModerationCheckInput {
  content: string
  targetType: 'comment' | 'chat' | 'article'
  targetId?: number
  authorName?: string
  authorIp?: string
}

export interface ModerationCheckOutput {
  flagged: boolean
  action: "allow" | "auto_hide" | "flag_only" | "block"
  severity: 'low' | 'medium' | 'high' | 'critical'
  reasons: string[]
  matchedRules: string[]
}

// ── In-memory Rule Cache (TTL 60s for sub-millisecond matching) ────────────
let cachedRules: AiModerationRule[] | null = null
let cacheExpiresAt = 0

export async function getActiveModerationRules(): Promise<AiModerationRule[]> {
  const now = Date.now()
  if (cachedRules && now < cacheExpiresAt) {
    return cachedRules
  }

  const db = getDb()
  const rows = await db
    .select()
    .from(aiModerationRules)
    .where(eq(aiModerationRules.isEnabled, true))

  cachedRules = rows
  cacheExpiresAt = now + 60_000
  return rows
}

export function invalidateModerationRulesCache(): void {
  cachedRules = null
  cacheExpiresAt = 0
}

/**
 * Scan content against active security rules & AI moderation model.
 * If flagged:
 * - Automatically records to `ai_moderation_queue`
 * - Automatically marks `is_hidden = true` or `is_flagged = true`
 */
export async function checkAndModerateContent(input: ModerationCheckInput): Promise<ModerationCheckOutput> {
  const content = (input.content || '').trim()
  if (!content) {
    return { flagged: false, action: "allow", severity: 'low', reasons: [], matchedRules: [] }
  }

  const db = getDb()
  const rules = await getActiveModerationRules()

  const matchedKeywords: Array<{ pattern: string; category: string; severity: string; action: string }> = []
  const lowerContent = content.toLowerCase()

  // 1. Scan for sensitive keywords and rules in content
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

  // 2. Intelligent Context-Aware AI Moderation
  // When sensitive keywords appear OR content has substantial length (>= 20 chars),
  // the AI reads the FULL context to distinguish between:
  // - Positive / vigilance / educational (safe -> DO NOT hide)
  // - Negative / hostile / propaganda / scam (violation -> auto-hide)
  let isFlagged = false
  let finalAction: "allow" | "auto_hide" | "flag_only" | "block" = "allow"
  let highestSeverity: 'low' | 'medium' | 'high' | 'critical' = 'low'
  const reasons: string[] = []
  const matchedRules: string[] = []

  const severityWeight = { low: 1, medium: 2, high: 3, critical: 4 }

  if (matchedKeywords.length > 0 || content.length >= 20) {
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
2. Trả về đúng định dạng JSON thuần túy (không kèm markdown):
{
  "verdict": "safe" | "spam" | "violation",
  "intent": "propaganda" | "denunciation" | "educational" | "spam" | "neutral",
  "riskLevel": "low" | "medium" | "high" | "critical",
  "reason": "Giải thích ngắn gọn 1 câu phân tích ngữ cảnh và ý đồ của người viết"
}`

    try {
      const aiResult = await callAi('moderation', {
        prompt: aiPrompt,
        variables: { content: content.slice(0, 500), author: input.authorName || 'User' },
      })

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
          finalAction = "auto_hide"
          const s = (parsed.riskLevel || 'high') as keyof typeof severityWeight
          if (severityWeight[s] > severityWeight[highestSeverity]) {
            highestSeverity = s
          }
          matchedRules.push(`[AI Ngữ cảnh] ${parsed.intent || parsed.verdict}`)
          for (const k of matchedKeywords) {
            matchedRules.push(`[${k.category}] ${k.pattern}`)
          }
          reasons.push(parsed.reason || 'AI phân tích ngữ cảnh: Phát hiện ý đồ vi phạm tiêu chuẩn an ninh.')
        } else {
          // Safe intent: allow even if keyword was present
          isFlagged = false
          finalAction = "allow"
        }
      } else {
        // Fallback on AI error: auto-hide if critical hostile keyword is present
        if (matchedKeywords.some(k => k.severity === 'critical')) {
          isFlagged = true
          finalAction = "auto_hide"
          highestSeverity = 'critical'
          matchedRules.push(...matchedKeywords.map(k => `[${k.category}] ${k.pattern}`))
          reasons.push(`Khớp từ khóa an ninh: ${matchedKeywords.map(k => `"${k.pattern}"`).join(', ')} (Dự phòng lỗi AI)`)
        }
      }
    } catch {
      if (matchedKeywords.some(k => k.severity === 'critical')) {
        isFlagged = true
        finalAction = "auto_hide"
        highestSeverity = 'critical'
        matchedRules.push(...matchedKeywords.map(k => `[${k.category}] ${k.pattern}`))
        reasons.push(`Khớp từ khóa an ninh: ${matchedKeywords.map(k => `"${k.pattern}"`).join(', ')} (Dự phòng lỗi AI)`)
      }
    }
  }
  // 3. Automated Action: Record to queue & hide content
  if (isFlagged) {
    logWarn({
      event: 'ai_moderation.flagged',
      targetType: input.targetType,
      targetId: input.targetId,
      action: finalAction,
      severity: highestSeverity,
      reasons,
    })

    // Insert into moderation queue for administrative review
    try {
      await db.insert(aiModerationQueue).values({
        targetType: input.targetType,
        targetId: input.targetId ? Number(input.targetId) : null,
        authorName: input.authorName || 'Khách',
        authorIp: input.authorIp || null,
        contentSnippet: content.slice(0, 1000),
        flaggedReason: reasons.join('; '),
        matchedRules,
        severity: highestSeverity,
        status: 'pending',
      })
    } catch (e) {
      // Don't crash caller if queue insert fails
    }

    // Auto-hide target row in database if action is auto_hide
    if (finalAction === 'auto_hide' && input.targetId) {
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
      }
    }
  }

  return {
    flagged: isFlagged,
    action: finalAction,
    severity: highestSeverity,
    reasons,
    matchedRules,
  }
}
