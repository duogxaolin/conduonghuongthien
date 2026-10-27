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
import { logWarn, SECURITY_EVENTS } from '../utils/logger'
import { MODERATION_PATTERN_MAX_LENGTH } from './moderation-regex-limits'

/** Thời gian một luật chậm bị tắt (tự bật lại sau đó). */
export const MODERATION_RULE_COOLDOWN_MS = 10 * 60_000
/** Tổng thời gian khớp một luật được dùng mỗi chu kỳ — ~10⁴× chi phí một cửa sổ của luật lành mạnh. */
export const MODERATION_RULE_CUMULATIVE_BUDGET_MS = 1000
export const MODERATION_RULE_CUMULATIVE_PERIOD_MS = 60_000
/** Tổng thời gian khớp luật mặc định của một request (chat: câu mới + tối đa 29 lượt cũ; bình luận). */
export const MODERATION_REQUEST_BUDGET_MS = 250
/**
 * Mức 2 tính cho mỗi cửa sổ thời gian CPU của chính luồng đã chạy nó (kẹp bởi giờ thật), và chỉ khi
 * phần đó ≥ mức này — kiểm chứng 4.3c tiếp, W6.
 *
 * Giờ THẬT của một cửa sổ gồm cả lúc tiến trình không chạy: container bị bóp CPU (`--cpus 0,5`: hết
 * hạn ngạch thì đứng tới hết chu kỳ CFS, tới ~50 ms), GC, luồng khác. Tính giờ thật thì một khoảng
 * dừng rơi vào cửa sổ µs của luật lành mạnh bị ghi thành vài chục ms cho luật đó: 10 000 request chat
 * cỡ tối đa vô hại từng tắt 1 luật lành mạnh ở 2 CPU, 4 luật ở 0,5 CPU (chỉ thêm ngưỡng 1 ms trên giờ
 * thật: vẫn 2 ở 0,5 CPU — khoảng dừng làm cửa sổ ≥ 1 ms). Thời gian CPU của luồng
 * (`process.threadCpuUsage`) không chạy trong lúc dừng, nên không bị thổi phồng; cửa sổ của kẻ tấn
 * công thì toàn CPU (đầu vào dựng sẵn làm chậm một luật: C1 158–184 ms), CPU ≈ giờ thật — không
 * lọt. Dưới 1 ms (luật lành mạnh: ≤ 69 µs mỗi cửa sổ trên văn bản thường) là nhiễu, không tính.
 * Mức 1 (ngắt cứng mỗi cửa sổ) và mức 3 (hạn mức request) vẫn đo GIỜ THẬT — chúng giới hạn độ
 * trễ, và mức 3 tính trọn lời gọi nên nhiều cửa sổ dưới 1 ms vẫn bị chặn ở 250 ms mỗi request.
 * Runtime không có đồng hồ CPU của luồng (Node < 22.19 / 23.9) thì lùi về giờ thật.
 */
export const MODERATION_RULE_MIN_CHARGED_WINDOW_MS = 1

/** Thời gian CPU (ms) của luồng đang chạy, hay `undefined` khi runtime không có. */
const threadCpuMs: (() => number) | undefined = typeof process.threadCpuUsage === 'function'
  ? () => { const { user, system } = process.threadCpuUsage(); return (user + system) / 1000 }
  : undefined

/**
 * `elapsed`: đồng hồ đo khoảng; `now`: hạn tắt luật và chu kỳ ngân sách. Cả hai mặc định là
 * `performance.now()` — ĐƠN ĐIỆU (W6): trên `Date.now` một lần chỉnh giờ hệ thống lùi làm
 * `now < periodStart` → chu kỳ coi như hết, sổ của luật bị xoá; chỉnh tiến thì luật đang tắt bật lại
 * sớm. Sổ chỉ sống trong một tiến trình, nên không cần giờ treo tường. `cpu`: thời gian CPU của
 * luồng (ms) cho mức 2; đồng hồ không có `cpu` (đồng hồ giả của test) thì mức 2 tính giờ `elapsed`.
 */
export interface RegexTiming { elapsed: () => number, now: () => number, cpu?: () => number }
const defaultTiming: RegexTiming = { elapsed: () => performance.now(), now: () => performance.now(), ...(threadCpuMs ? { cpu: threadCpuMs } : {}) }
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

/** Thời gian CPU hiện tại của luồng (ms), hay `NaN` khi đồng hồ không có `cpu` — chỉ dùng để lấy hiệu. */
export function regexCpu(): number {
  return timing.cpu ? timing.cpu() : Number.NaN
}

/**
 * Phần của một cửa sổ được tính vào chu kỳ của luật (`MODERATION_RULE_MIN_CHARGED_WINDOW_MS`):
 * thời gian CPU của nó, kẹp bởi giờ thật (`NaN` → giờ thật), hay 0 khi dưới ngưỡng.
 */
export function chargeableWindowMs(wallMs: number, cpuMs: number): number {
  const ms = Number.isNaN(cpuMs) ? wallMs : Math.min(wallMs, cpuMs)
  return ms >= MODERATION_RULE_MIN_CHARGED_WINDOW_MS ? ms : 0
}

/** Đồng hồ CPU cho các cửa sổ liên tiếp của MỘT lượt `vm` — `openWindowMeter`. */
export interface WindowMeter {
  /** Thời gian CPU (ước, ms) lúc cửa sổ kế bắt đầu — mốc cho phần đã chạy của cửa sổ bị ngắt. */
  cpuAt: () => number
  /** Phần mức 2 tính cho cửa sổ vừa chạy `wallMs` giờ thật (`chargeableWindowMs`). */
  charge: (wallMs: number) => number
}

/**
 * Mở đồng hồ CPU cho một lượt `vm`, đọc `regexCpu()` ít nhất có thể (~230 ns mỗi lần): lúc mở, và
 * sau cửa sổ có thể bị tính (≥ 1 ms giờ thật). Cửa sổ ngắn hơn bị tính 0 dù CPU bao nhiêu, và CPU
 * của nó ≤ giờ thật của nó: giờ thật đó cộng dồn vào `unreadWall` rồi trừ khỏi lần đọc kế — sai số
 * chỉ là phần giờ thật mà các cửa sổ ngắn không dùng CPU (µs). Đọc sau MỌI cửa sổ tốn ~0,2 ms mỗi
 * request chat 30 lượt × 30 luật (900 cửa sổ).
 */
export function openWindowMeter(): WindowMeter {
  let mark = regexCpu()
  let unreadWall = 0
  return {
    cpuAt: () => mark + unreadWall,
    charge: (wallMs) => {
      if (wallMs < MODERATION_RULE_MIN_CHARGED_WINDOW_MS) {
        unreadWall += wallMs
        return 0
      }
      const now = regexCpu()
      const cpuMs = Math.max(0, now - mark - unreadWall)
      mark = now
      unreadWall = 0
      return chargeableWindowMs(wallMs, cpuMs)
    },
  }
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

/** Chu kỳ ngân sách đang mở của mẫu, hay `undefined` khi đã hết hạn (đồng hồ — chỉ đồng hồ giả của test — lùi cũng tính là hết). */
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
  logWarn({ event: SECURITY_EVENTS.moderationRuleSlowDisabled, pattern: pattern.slice(0, MODERATION_PATTERN_MAX_LENGTH), ...fields, disabledForMs: MODERATION_RULE_COOLDOWN_MS })
}

/** Cửa sổ quá ngân sách cửa sổ (chạy xong mà đo quá, hay bị ngắt cứng): luật của nó tắt, `reason: 'window'`. */
export interface WindowOffender { pattern: string, elapsedMs: number, inputLength: number, interrupted: boolean }
/**
 * Thời gian một mẫu đã dùng trong một lời gọi (theo thứ tự lần đầu chạy): `spentMs` giờ thật (cho
 * dòng log hạn mức request), `chargedMs` phần tính vào chu kỳ (CPU của cửa sổ ≥ 1 ms —
 * `chargeableWindowMs`); `inputLength` của văn bản cuối của nó.
 */
export interface PatternSpend { pattern: string, spentMs: number, chargedMs: number, inputLength: number }

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
  for (const { pattern, spentMs: callSpentMs, chargedMs, inputLength } of input.spend) {
    state?.byPattern.set(pattern, (state.byPattern.get(pattern) ?? 0) + callSpentMs)
    if (disabledNow.has(pattern)) continue
    const period = currentPeriod(pattern, now)
    const spentMs = (period?.spentMs ?? 0) + chargedMs
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
      event: SECURITY_EVENTS.moderationRequestBudgetExhausted,
      budgetMs: budget.limitMs,
      spentMs: Math.round(state.spentMs),
      topPattern: topPattern.slice(0, MODERATION_PATTERN_MAX_LENGTH),
      topPatternMs: Math.round(topMs),
      texts,
    })
  }
}
