/**
 * Sổ thời gian khớp của lớp 2 — tệp con của nhóm `moderation-regex` (wave3-long-term 4.3c tiếp,
 * D-SPLIT: tách khỏi `moderation-regex-runtime.ts` khi tệp đó chạm 398/400 dòng; nơi gọi import
 * barrel `moderation-regex.ts`). Tệp chạy đo và quyết trong lượt `vm`; tệp này GHI SỔ, sau lượt:
 *
 *  - đồng hồ (`timing`): `elapsed` đo khoảng (đơn điệu), `now` cho hạn tắt luật và chu kỳ ngân sách;
 *  - sổ luật đang tắt (`disabledUntil`): luật chậm (mức 1, mức 2 của tệp chạy) tắt
 *    `MODERATION_RULE_COOLDOWN_MS`, log `ai_moderation.rule_slow_disabled`;
 *  - sổ ngân sách chu kỳ mỗi luật (`ruleSpend`, mức 2): mili-giây khớp của mẫu trong chu kỳ
 *    `MODERATION_RULE_CUMULATIVE_PERIOD_MS` mở ở lần tính đầu; chạm
 *    `MODERATION_RULE_CUMULATIVE_BUDGET_MS` thì luật tắt, `reason: 'cumulative'`;
 *  - hạn mức mỗi request (`budgets`, mức 3): chỉ tạo bằng `createModerationRegexBudget`, chỉ tệp này
 *    đọc/đổi phần đã dùng; hết thì log `ai_moderation.request_budget_exhausted` một lần.
 *
 * Tệp này là chủ DUY NHẤT của bốn trạng thái đó (không `export`;
 * `tests/service-split-boundaries.test.ts`, luật 4): tệp chạy chỉ đọc đồng hồ (`regexElapsed`), hỏi
 * phần ngân sách còn lại (`ruleAllowances`, `requestDeadline`) và nộp kết quả một lượt
 * (`settleRegexSpend`). Không import `node:vm` (guard S4 ở `tests/moderation-regex-budget.test.ts`).
 */
import { logWarn } from '../utils/logger'
import { MODERATION_PATTERN_MAX_LENGTH } from './moderation-regex-limits'

/** Thời gian một luật chậm bị tắt (tự bật lại sau đó). */
export const MODERATION_RULE_COOLDOWN_MS = 10 * 60_000
/** Tổng thời gian khớp một luật được dùng mỗi chu kỳ — ~10⁴× chi phí một cửa sổ của luật lành mạnh. */
export const MODERATION_RULE_CUMULATIVE_BUDGET_MS = 1000
export const MODERATION_RULE_CUMULATIVE_PERIOD_MS = 60_000
/** Tổng thời gian khớp luật mặc định của một request (chat: câu mới + tối đa 29 lượt cũ; bình luận). */
export const MODERATION_REQUEST_BUDGET_MS = 250

/** `elapsed`: đồng hồ đo khoảng (ms, đơn điệu); `now`: giờ thực (ms) — hạn tắt luật, chu kỳ ngân sách. */
export interface RegexTiming { elapsed: () => number, now: () => number }
const defaultTiming: RegexTiming = { elapsed: () => performance.now(), now: () => Date.now() }
let timing: RegexTiming = defaultTiming
const disabledUntil = new Map<string, number>()
/** Thời gian đã tính cho mỗi mẫu trong chu kỳ hiện tại của nó. */
const ruleSpend = new Map<string, { periodStart: number, spentMs: number }>()
const RULE_SPEND_PRUNE_AT = 1000

/** Hạn mức thời gian khớp của MỘT request. Chỉ tạo bằng `createModerationRegexBudget`; chỉ tệp này đọc/đổi. */
export interface ModerationRegexBudget { readonly limitMs: number }
/** `byPattern`: ms mỗi mẫu đã dùng trong request — cho dòng log khi hết hạn mức. */
interface BudgetState { spentMs: number, byPattern: Map<string, number>, logged: boolean }
const budgets = new WeakMap<ModerationRegexBudget, BudgetState>()

/** Đồng hồ đo khoảng hiện tại — tệp chạy gọi đúng một lần trước và một lần sau mỗi cửa sổ. */
export function regexElapsed(): number {
  return timing.elapsed()
}

/** Chỉ cho test: thay đồng hồ để không phải đo thời gian thật. `null` = khôi phục. */
export function setModerationRegexTimingForTests(next: RegexTiming | null): void {
  timing = next ?? defaultTiming
}

/**
 * Bật lại mọi luật đã bị tắt vì chậm và xoá sổ ngân sách chu kỳ (gọi cùng lúc với xoá cache
 * luật — thao tác của cán bộ). Không gọi thì luật tự bật lại sau `MODERATION_RULE_COOLDOWN_MS`.
 */
export function resetSlowModerationRules(): void {
  disabledUntil.clear()
  ruleSpend.clear()
}

/** Luật này có đang bị tắt vì chậm không. */
export function isModerationRuleDisabled(pattern: string): boolean {
  const until = disabledUntil.get(pattern)
  if (until === undefined) return false
  if (until > timing.now()) return true
  disabledUntil.delete(pattern)
  return false
}

/** Một hạn mức thời gian khớp mới cho MỘT request (mặc định `MODERATION_REQUEST_BUDGET_MS`). */
export function createModerationRegexBudget(limitMs: number = MODERATION_REQUEST_BUDGET_MS): ModerationRegexBudget {
  if (!(limitMs >= 0)) throw new RangeError(`moderation regex budget must be ≥ 0 ms, got ${String(limitMs)}`)
  const budget: ModerationRegexBudget = Object.freeze({ limitMs })
  budgets.set(budget, { spentMs: 0, byPattern: new Map(), logged: false })
  return budget
}

/** Ném `TypeError` khi `budget` không do `createModerationRegexBudget` tạo (`undefined` thì không sao). */
export function assertModerationRegexBudget(budget: ModerationRegexBudget | undefined): void {
  if (budget !== undefined && !budgets.has(budget)) throw new TypeError('budget must come from createModerationRegexBudget()')
}

/** Hạn của request trên `regexElapsed()` cho lời gọi bắt đầu ở `startedAt`: phần hạn mức còn lại tính từ đó. */
export function requestDeadline(budget: ModerationRegexBudget, startedAt: number): number {
  return startedAt + budget.limitMs - budgets.get(budget)!.spentMs
}

/** Chu kỳ ngân sách đang mở của mẫu, hay `undefined` khi đã hết hạn (đồng hồ lùi cũng tính là hết). */
function currentPeriod(pattern: string, now: number): { periodStart: number, spentMs: number } | undefined {
  const entry = ruleSpend.get(pattern)
  return entry && now >= entry.periodStart && now - entry.periodStart < MODERATION_RULE_CUMULATIVE_PERIOD_MS ? entry : undefined
}

/** ms mỗi mẫu còn được dùng trong chu kỳ của nó — chụp lúc bắt đầu một lời gọi, chỉ đọc trong `vm`. */
export function ruleAllowances(patterns: Iterable<string>): Map<string, number> {
  const now = timing.now()
  const allowance = new Map<string, number>()
  for (const pattern of patterns) allowance.set(pattern, MODERATION_RULE_CUMULATIVE_BUDGET_MS - (currentPeriod(pattern, now)?.spentMs ?? 0))
  return allowance
}

function disable(pattern: string, fields: Record<string, unknown>): void {
  disabledUntil.set(pattern, timing.now() + MODERATION_RULE_COOLDOWN_MS)
  ruleSpend.delete(pattern) // bật lại sau thời gian chờ thì bắt đầu một chu kỳ mới
  logWarn({ event: 'ai_moderation.rule_slow_disabled', pattern: pattern.slice(0, MODERATION_PATTERN_MAX_LENGTH), ...fields, disabledForMs: MODERATION_RULE_COOLDOWN_MS })
}

/** Cửa sổ quá ngân sách cửa sổ (chạy xong mà đo quá, hay bị ngắt cứng): luật của nó tắt, `reason: 'window'`. */
export interface WindowOffender { pattern: string, elapsedMs: number, inputLength: number, interrupted: boolean }
/** Thời gian một mẫu đã dùng trong một lời gọi (theo thứ tự lần đầu chạy), `inputLength` của văn bản cuối của nó. */
export interface PatternSpend { pattern: string, spentMs: number, inputLength: number }

/**
 * Ghi sổ kết quả MỘT lời gọi của tệp chạy, sau lượt `vm`: tắt luật quá ngân sách cửa sổ, cộng
 * thời gian vào chu kỳ của mỗi mẫu còn lại (chạm ngân sách → tắt, `reason: 'cumulative'`), tính
 * `callMs` vào hạn mức request và log một lần khi request hết hạn mức.
 */
export function settleRegexSpend(input: {
  offenders: readonly WindowOffender[]
  spend: readonly PatternSpend[]
  request?: { budget: ModerationRegexBudget, callMs: number, exhausted: boolean, texts: number }
}): void {
  const disabledNow = new Set<string>()
  for (const { pattern, elapsedMs, inputLength, interrupted } of input.offenders) {
    disabledNow.add(pattern)
    disable(pattern, { elapsedMs: Math.round(elapsedMs), inputLength, reason: 'window', ...(interrupted ? { interrupted: true } : {}) })
  }
  const state = input.request && budgets.get(input.request.budget)!
  const now = timing.now()
  if (ruleSpend.size > RULE_SPEND_PRUNE_AT) for (const [pattern] of ruleSpend) if (!currentPeriod(pattern, now)) ruleSpend.delete(pattern)
  for (const { pattern, spentMs: callSpentMs, inputLength } of input.spend) {
    state?.byPattern.set(pattern, (state.byPattern.get(pattern) ?? 0) + callSpentMs)
    if (disabledNow.has(pattern)) continue
    const period = currentPeriod(pattern, now)
    const spentMs = (period?.spentMs ?? 0) + callSpentMs
    ruleSpend.set(pattern, { periodStart: period?.periodStart ?? now, spentMs })
    if (spentMs >= MODERATION_RULE_CUMULATIVE_BUDGET_MS) {
      disable(pattern, { elapsedMs: Math.round(spentMs), inputLength, reason: 'cumulative', periodMs: MODERATION_RULE_CUMULATIVE_PERIOD_MS })
    }
  }
  if (!input.request || !state) return
  const { budget, callMs, exhausted, texts } = input.request
  state.spentMs += callMs
  if (exhausted && !state.logged) {
    state.logged = true
    const [topPattern, topMs] = [...state.byPattern].reduce((top, entry) => (entry[1] > top[1] ? entry : top), ['', 0])
    logWarn({
      event: 'ai_moderation.request_budget_exhausted',
      budgetMs: budget.limitMs,
      spentMs: Math.round(state.spentMs),
      topPattern: topPattern.slice(0, MODERATION_PATTERN_MAX_LENGTH),
      topPatternMs: Math.round(topMs),
      texts,
    })
  }
}
