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

  const matchedRules: string[] = []
  const reasons: string[] = []
  let highestSeverity: 'low' | 'medium' | 'high' | 'critical' = 'low'
  let finalAction: "allow" | "auto_hide" | "flag_only" | "block" = "allow"

  const severityWeight = { low: 1, medium: 2, high: 3, critical: 4 }

  const lowerContent = content.toLowerCase()

  // 1. Fast-path: Keyword & Pattern matching
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
      matchedRules.push(`[${rule.category}] ${rule.pattern}`)
      reasons.push(`Khớp từ khóa/quy tắc: "${rule.pattern}" (Nhóm: ${rule.category})`)

      const s = (rule.severity || 'high') as keyof typeof severityWeight
      if (severityWeight[s] > severityWeight[highestSeverity]) {
        highestSeverity = s
      }

      if (rule.action === 'auto_hide' || rule.action === 'block') {
        finalAction = 'auto_hide'
      } else if (finalAction !== 'auto_hide' && rule.action === 'flag_only') {
        finalAction = 'flag_only'
      }
    }
  }

  // 2. Deep-path: AI Semantic Analysis if not matched by keywords but content is substantial
  if (matchedRules.length === 0 && content.length >= 20) {
    try {
      const aiPrompt = `Phân tích kiểm duyệt an ninh nội dung sau trên Cổng thông tin Cục C11 - Bộ Công an:
"${content.slice(0, 1000)}"

Yêu cầu nhận diện:
- Tư tưởng thù địch, chống phá Đảng/Nhà nước, bạo loạn, lật đổ
- Xuyên tạc chính sách nhân đạo tái hòa nhập cộng đồng
- Lừa đảo, cờ bạc, nội dung xấu độc hại
Trả về JSON thuần (không kèm markdown):
{
  "verdict": "safe" | "spam" | "violation",
  "riskLevel": "low" | "medium" | "high",
  "reason": "Giải thích ngắn 1 câu nếu vi phạm"
}`

      const aiResult = await callAi('moderation', {
        prompt: aiPrompt,
        variables: { content: content.slice(0, 500), author: input.authorName || 'User' },
      })

      if (aiResult.ok && aiResult.text) {
        const clean = aiResult.text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim()
        const parsed = JSON.parse(clean) as { verdict?: string; riskLevel?: string; reason?: string }
        if (parsed.verdict === 'violation' || parsed.verdict === 'spam') {
          matchedRules.push(`[AI Semantic] ${parsed.verdict}`)
          reasons.push(parsed.reason || 'AI phát hiện nội dung có dấu hiệu vi phạm tiêu chuẩn an ninh.')
          highestSeverity = parsed.riskLevel === 'high' ? 'high' : 'medium'
          finalAction = 'auto_hide'
        }
      }
    } catch {
      // Ignore AI failure in background worker
    }
  }

  const isFlagged = matchedRules.length > 0

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
