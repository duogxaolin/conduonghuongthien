/**
 * Lớp chặn tức thì đứng trước AI: `matchInstantRule` (quyết định thuần — từ điển dựng
 * sẵn rồi luật đang bật trong CSDL) và `fastPreModerate` (cùng quyết định + ghi hàng
 * chờ duyệt + đếm). Tách nguyên văn từ moderation-worker.ts (wave3 D-SPLIT); barrel
 * `moderation-worker.ts` xuất lại. Từ điển và việc ghi hàng chờ của một lượt chặn ở
 * `moderation-instant.ts`.
 */
import type { AiModerationRule } from '../db/schema'
import { logWarn } from '../utils/logger'
import { getActiveModerationRules } from './moderation-rules-cache'
import {
  compileModerationRegex,
  isRegexRuleType,
  scanModerationRegexBatch,
  type ModerationRegexBatchScan,
  type ModerationRegexBudget,
  type ModerationRegexRule,
} from './moderation-regex'
import { describeError } from './moderation-worker-persist'
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
export async function matchInstantRule(
  content: string,
  /** `regexBudget`: the request's matching budget (`createModerationRegexBudget`) — see `fastPreModerate`. */
  options: { regexBudget?: ModerationRegexBudget } = {},
): Promise<InstantRuleMatch | null> {
  return (await matchInstantRuleBatch([content], options))[0]!
}

function builtInMatch(trimmed: string): InstantRuleMatch | null {
  for (const item of INSTANT_PROFANITY) {
    if (item.pattern.test(trimmed)) return { category: 'profanity', severity: 'high', label: item.label }
  }
  for (const item of INSTANT_HOSTILE) {
    if (item.pattern.test(trimmed)) return { category: 'anti_state', severity: 'critical', label: item.label }
  }
  for (const item of INSTANT_SPAM_GAMBLING) {
    if (item.pattern.test(trimmed)) return { category: 'spam_fraud', severity: 'high', label: item.label }
  }
  return null
}

/** The database rules one text reaches: its first keyword hit, and the regex rules before it. */
function databaseRulesFor(rules: AiModerationRule[], trimmed: string) {
  const lower = trimmed.toLowerCase()
  const keywordHit = rules.findIndex(rule => !isRegexRuleType(rule.ruleType) && lower.includes(rule.pattern.toLowerCase().trim()))
  const regexRules: Array<ModerationRegexRule & { index: number }> = []
  for (const [index, rule] of rules.entries()) {
    if (keywordHit !== -1 && index >= keywordHit) break
    if (!isRegexRuleType(rule.ruleType)) continue
    const regex = compileModerationRegex(rule.pattern)
    if (regex) regexRules.push({ index, pattern: rule.pattern, regex })
  }
  return { keywordHit, regexRules }
}

/** The instant decision for several texts, and which of them the request budget left half-screened. */
interface InstantRuleScan {
  matches: Array<InstantRuleMatch | null>
  /** No match, but an enabled regex rule never judged the text — the request budget ran out first. */
  unscanned: boolean[]
}

async function instantRuleScan(contents: readonly string[], regexBudget: ModerationRegexBudget | undefined): Promise<InstantRuleScan> {
  const matches: Array<InstantRuleMatch | null> = []
  const unscanned = contents.map(() => false)
  const pending: Array<{ at: number, trimmed: string }> = []
  for (const [at, content] of contents.entries()) {
    const trimmed = (content || '').trim()
    // 1. Built-in high-confidence rules
    matches.push(trimmed ? builtInMatch(trimmed) : null)
    if (trimmed && !matches[at]) pending.push({ at, trimmed })
  }
  if (!pending.length) return { matches, unscanned }

  // 2. Active custom rules from database — per text, the first rule, in order, that matches.
  try {
    const rules = await getActiveModerationRules()
    // Keyword rules are a substring test. Regex rules before a text's first keyword hit run in
    // ONE bounded pass for the whole batch, stopping at that text's first regex hit — the rules
    // the old in-order loop would reach. Compiled through the helper shared with
    // checkAndModerateContent: flag `iu`, the pattern never lower-cased, broken/too
    // long/catastrophic patterns skipped.
    const scans = pending.map(({ trimmed }) => databaseRulesFor(rules, trimmed))
    let regex: ModerationRegexBatchScan
    try {
      regex = scanModerationRegexBatch(
        scans.map(({ regexRules }, k) => ({ rules: regexRules, text: pending[k]!.trimmed })),
        { stopAtFirstMatch: true, budget: regexBudget },
      )
    } catch (err: unknown) {
      // A pass that THROWS (a timeout never does — the runtime handles it) must not take the
      // keyword hits of the whole batch with it: those texts are still decided by their keyword
      // rule; a text whose regex rules never ran is unscanned, not clean. Logged, never silent.
      logWarn({ event: 'ai_moderation.instant_regex_failed', texts: pending.length, error: describeError(err) })
      regex = { hits: scans.map(({ regexRules }) => regexRules.map(() => false)), unscanned: scans.map(({ regexRules }) => regexRules.length > 0) }
    }
    for (const [k, { keywordHit, regexRules }] of scans.entries()) {
      const regexHit = regexRules.find((_, r) => regex.hits[k]![r])
      const hitIndex = regexHit ? regexHit.index : keywordHit
      const rule = hitIndex === -1 ? undefined : rules[hitIndex]
      if (!rule) {
        unscanned[pending[k]!.at] = regex.unscanned[k]!
        continue
      }
      const severity = (rule.severity as InstantRuleMatch['severity']) || 'high'
      matches[pending[k]!.at] = { category: rule.category, severity, label: `${regexHit ? 'Mẫu regex' : 'Từ khóa'}: ${rule.pattern}` }
    }
  } catch {
    // If DB read fails, built-in instant rules still secure the entrance
  }
  return { matches, unscanned }
}

/**
 * `matchInstantRule` for several texts — exactly `texts.map(matchInstantRule)`, but every regex
 * rule of every text runs in ONE bounded pass (`scanModerationRegexBatch`: one `vm` call with a
 * hard timeout for the whole batch, not one per text). A text the request budget left
 * half-screened reads as no match here, as in `matchInstantRule` (the newest chat turn, a
 * comment: fail-open, logged) — `earlierTurnsToWithhold` does NOT read it that way.
 */
export async function matchInstantRuleBatch(
  contents: readonly string[],
  options: { regexBudget?: ModerationRegexBudget } = {},
): Promise<Array<InstantRuleMatch | null>> {
  return (await instantRuleScan(contents, options.regexBudget)).matches
}

/**
 * The EARLIER user turns of a chat request that must not reach the model: those that trip an
 * instant rule — and those the request's regex budget ran out before (verify of 4.3c follow-up,
 * W5). Slow crafted turns used to spend the budget so that an older turn behind them went to the
 * model unscreened, `lô đề` and all. Both kinds are only withheld (`withoutUserTurns`): no
 * refusal, no review-queue row — the visitor's new question is still answered. All earlier turns
 * run in ONE batched pass on the request's budget, after the newest turn's check (which has the
 * whole budget first and keeps its own, fail-open, reading of a cut — `fastPreModerate`).
 */
export async function earlierTurnsToWithhold(
  turns: readonly string[],
  options: { regexBudget?: ModerationRegexBudget } = {},
): Promise<Set<string>> {
  const { matches, unscanned } = await instantRuleScan(turns, options.regexBudget)
  return new Set(turns.filter((_, index) => matches[index] !== null || unscanned[index]))
}

/**
 * Fast synchronous pre-moderator: scans built-in dictionaries + active database rules.
 * Runs in < 1ms without external network or AI delay. A hit is filed in the review
 * queue (`recordInstantBlock`); `matchInstantRule` is the same decision without that.
 */
export async function fastPreModerate(
  content: string,
  /**
   * `capQueuePerSource` caps review-queue rows per source (MODERATION_QUEUE_CAP) — public inbound
   * flows. `regexBudget` bounds the regex matching of the whole request it belongs to (pass the
   * same one to every moderation call of that request); without it only the per-window and
   * per-rule bounds apply.
   */
  context?: InstantBlockContext,
): Promise<FastPreModerateResult> {
  const trimmed = (content || '').trim()
  if (!trimmed) {
    return { blocked: false, action: "allow", severity: 'low', reason: '', matchedRule: '' }
  }

  workerStats.totalScanned++
  workerStats.lastScannedAt = new Date().toISOString()

  const match = await matchInstantRule(trimmed, { regexBudget: context?.regexBudget })
  if (match) return recordInstantBlock(trimmed, match.category, match.severity, match.label, context)

  workerStats.allowedCount++
  return { blocked: false, action: "allow", severity: 'low', reason: '', matchedRule: '' }
}
