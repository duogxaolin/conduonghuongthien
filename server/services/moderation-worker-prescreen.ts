/**
 * Lớp chặn tức thì đứng trước AI: `matchInstantRule` (quyết định thuần — từ điển dựng
 * sẵn rồi luật đang bật trong CSDL) và `fastPreModerate` (cùng quyết định + ghi hàng
 * chờ duyệt + đếm). Tách nguyên văn từ moderation-worker.ts (wave3 D-SPLIT); barrel
 * `moderation-worker.ts` xuất lại. Từ điển và việc ghi hàng chờ của một lượt chặn ở
 * `moderation-instant.ts`.
 */
import { getActiveModerationRules } from './moderation-rules-cache'
import { compileModerationRegex, isRegexRuleType, testModerationRegexes, type ModerationRegexRule } from './moderation-regex'
import { workerStats } from './moderation-stats'
import {
  INSTANT_PROFANITY,
  INSTANT_HOSTILE,
  INSTANT_SPAM_GAMBLING,
  recordInstantBlock,
  type FastPreModerateResult,
  type InstantBlockContext,
} from './moderation-instant'

/** The instant rule a text trips: what `recordInstantBlock` needs to file it. */
export interface InstantRuleMatch {
  category: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  label: string
}

/**
 * Which instant rule `content` trips, if any — built-in dictionaries first, then
 * the active database rules. Files no review-queue row and touches no worker
 * counters (the regex helper still keeps its own slow-rule state and cache).
 *
 * Split out of `fastPreModerate` for the chat history (rà soát 2026-10-23): an
 * EARLIER visitor turn that trips a rule added after it was accepted must be kept
 * from the model, but refusing the new question for it locked the conversation
 * (the widget only drops the newest turn) and filed the old line again on every
 * message. The chat endpoints withhold such turns instead — see `chat-turns.ts`.
 */
export async function matchInstantRule(content: string): Promise<InstantRuleMatch | null> {
  const trimmed = (content || '').trim()
  if (!trimmed) return null

  // 1. Built-in high-confidence rules
  for (const item of INSTANT_PROFANITY) {
    if (item.pattern.test(trimmed)) return { category: 'profanity', severity: 'high', label: item.label }
  }
  for (const item of INSTANT_HOSTILE) {
    if (item.pattern.test(trimmed)) return { category: 'anti_state', severity: 'critical', label: item.label }
  }
  for (const item of INSTANT_SPAM_GAMBLING) {
    if (item.pattern.test(trimmed)) return { category: 'spam_fraud', severity: 'high', label: item.label }
  }

  // 2. Active custom rules from database — the first rule, in order, that matches.
  try {
    const rules = await getActiveModerationRules()
    const lower = trimmed.toLowerCase()
    // Keyword rules are a substring test. Regex rules before the first keyword hit run in ONE
    // bounded pass (`testModerationRegexes`: one `vm` call with a hard timeout per text, not one
    // per rule), stopping at the first regex hit — the rules the old in-order loop would reach.
    // Compiled through the helper shared with checkAndModerateContent: flag `iu`, the pattern
    // never lower-cased, broken/too long/catastrophic patterns skipped.
    const keywordHit = rules.findIndex(rule => !isRegexRuleType(rule.ruleType) && lower.includes(rule.pattern.toLowerCase().trim()))
    const regexRules: Array<ModerationRegexRule & { index: number }> = []
    for (const [index, rule] of rules.entries()) {
      if (keywordHit !== -1 && index >= keywordHit) break
      if (!isRegexRuleType(rule.ruleType)) continue
      const regex = compileModerationRegex(rule.pattern)
      if (regex) regexRules.push({ index, pattern: rule.pattern, regex })
    }
    const hits = testModerationRegexes(regexRules, trimmed, { stopAtFirstMatch: true })
    const regexHit = regexRules.find((_, k) => hits[k])
    const hitIndex = regexHit ? regexHit.index : keywordHit
    const rule = hitIndex === -1 ? undefined : rules[hitIndex]
    if (rule) {
      const severity = (rule.severity as InstantRuleMatch['severity']) || 'high'
      return { category: rule.category, severity, label: `${regexHit ? 'Mẫu regex' : 'Từ khóa'}: ${rule.pattern}` }
    }
  } catch {
    // If DB read fails, built-in instant rules still secure the entrance
  }
  return null
}

/**
 * Fast synchronous pre-moderator: scans built-in dictionaries + active database rules.
 * Runs in < 1ms without external network or AI delay. A hit is filed in the review
 * queue (`recordInstantBlock`); `matchInstantRule` is the same decision without that.
 */
export async function fastPreModerate(
  content: string,
  /** `capQueuePerSource` caps review-queue rows per source (MODERATION_QUEUE_CAP) — public inbound flows. */
  context?: InstantBlockContext,
): Promise<FastPreModerateResult> {
  const trimmed = (content || '').trim()
  if (!trimmed) {
    return { blocked: false, action: "allow", severity: 'low', reason: '', matchedRule: '' }
  }

  workerStats.totalScanned++
  workerStats.lastScannedAt = new Date().toISOString()

  const match = await matchInstantRule(trimmed)
  if (match) return recordInstantBlock(trimmed, match.category, match.severity, match.label, context)

  workerStats.allowedCount++
  return { blocked: false, action: "allow", severity: 'low', reason: '', matchedRule: '' }
}
