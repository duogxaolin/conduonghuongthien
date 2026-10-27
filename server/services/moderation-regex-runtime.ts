/**
 * Chạy mẫu luật kiểm duyệt có giới hạn CỨNG — tệp con của nhóm `moderation-regex`
 * (wave3-long-term 4.3, D-SPLIT; nơi gọi import barrel `moderation-regex.ts`).
 *
 * Lớp 2 — giới hạn lúc CHẠY. Lớp 1 (phân tích lúc lưu) chỉ là ước lượng tốt-nhất-có-thể
 * (`日*日*日*$` lọt — `FINDING moderation-regex-4`). Lớp này giới hạn TỔNG thời gian khớp ở ba
 * mức (con số đo: `docs/decisions/realm-safety.md` § "Lớp 1 giữ khe hở…"):
 *
 *  1. Mỗi cửa sổ (`MODERATION_REGEX_WINDOW` ký tự, chồng nhau `…_OVERLAP`): lượt quét chạy trong
 *     `node:vm`, watchdog NGẮT CỨNG ở `MODERATION_RULE_WINDOW_BUDGET_MS` (dừng mã JS ở mọi realm,
 *     kể cả `RegExp` của realm chính). Cửa sổ bị ngắt = không khớp (mở khi lỗi), luật bị tắt
 *     `MODERATION_RULE_COOLDOWN_MS`, log `ai_moderation.rule_slow_disabled` `reason: 'window'`
 *     (`interrupted: true`). Cửa sổ chạy XONG mà đo > ngân sách cũng vậy, giữ kết quả của nó.
 *  2. Mỗi luật: mọi mili-giây khớp được cộng vào sổ của mẫu theo chu kỳ
 *     `MODERATION_RULE_CUMULATIVE_PERIOD_MS` (chu kỳ mở ở lần tính đầu); chạm
 *     `MODERATION_RULE_CUMULATIVE_BUDGET_MS` thì luật tắt như trên, `reason: 'cumulative'` —
 *     mẫu bậc ba dưới ngân sách cửa sổ (`[а-я]+[а-я]+\d`, ~160 ms/1000 ký tự) không còn chạy
 *     mãi. Một luật dùng tối đa ngân sách + một cửa sổ mỗi chu kỳ (~2× qua ranh giới chu kỳ).
 *  3. Mỗi request: nơi gọi truyền một `ModerationRegexBudget` (`createModerationRegexBudget`,
 *     `MODERATION_REQUEST_BUDGET_MS`) cho mọi lượt khớp của request; hết thì phần chưa quét là
 *     KHÔNG khớp (mở khi lỗi), log `ai_moderation.request_budget_exhausted` một lần, kèm mẫu
 *     dùng nhiều nhất — thời gian của nó (cả cửa sổ đang chạy bị ngắt) đã tính vào mức 2.
 *     Không truyền thì không có trần này (hành vi cũ).
 *
 * Quy lỗi: nhiều văn bản × nhiều luật chạy trong MỘT lượt `vm` (mỗi lượt tốn ~25–50 µs dựng
 * watchdog), hạn giờ tính từ đầu lượt. Trước mỗi cửa sổ không phải đầu lượt, lượt đã chạy quá
 * `PASS_SLACK_MS` thì nhường cho lượt mới: mọi cửa sổ bắt đầu ≤ 20 ms sau đầu lượt, nên cửa sổ
 * bị ngắt trong lượt đủ ngân sách đã tự chạy ≥ 180 ms — luôn là kẻ phạm, không bao giờ chạy lại
 * (mỗi cửa sổ gọi `test()` đúng một lần; `lastIndex` của cờ g/y y như một lời gọi trực tiếp).
 * Không quy cho ai khi ngắt rơi GIỮA hai cửa sổ (luật đã có kết quả) hay khi lượt bị cắt vì hết
 * hạn mức request.
 *
 * Trong `vm` chỉ có phép khớp và việc ghi vào `ScanJob`, mỗi lần bằng MỘT phép gán (`job.at =`,
 * `ledger.set`) vì lệnh ngắt rơi vào giữa bất kỳ câu lệnh nào; sổ tắt luật, sổ chu kỳ, hạn mức
 * và log đổi SAU khi lượt `vm` trả về hay bị ngắt. Tệp này là chủ DUY NHẤT của trạng thái lúc
 * chạy (`timing`, `disabledUntil`, `ruleSpend`, `budgets`, `scanContext`, `scanScript` — không
 * `export`; `tests/service-split-boundaries.test.ts`, luật 4). Văn bản và luật vào `vm` qua thuộc
 * tính của ngữ cảnh; script là hằng `'scan(job)'` (`vm` không phải hộp cát — guard ở
 * `tests/moderation-regex-budget.test.ts`).
 */
import vm from 'node:vm'
import { logWarn } from '../utils/logger'
import { MODERATION_PATTERN_MAX_LENGTH, MODERATION_REGEX_WINDOW, MODERATION_REGEX_WINDOW_OVERLAP } from './moderation-regex-limits'

/**
 * Hạn giờ CỨNG của một cửa sổ (ms). Mẫu lành mạnh tốn µs một cửa sổ 2000 ký tự (đo 30 luật
 * tiếng Việt: ≤ 69 µs trên văn bản thường, ≤ 30 ms trên đầu vào dựng sẵn tệ nhất).
 */
export const MODERATION_RULE_WINDOW_BUDGET_MS = 200
/** Thời gian một luật chậm bị tắt (tự bật lại sau đó). */
export const MODERATION_RULE_COOLDOWN_MS = 10 * 60_000
/** Tổng thời gian khớp một luật được dùng mỗi chu kỳ — ~10⁴× chi phí một cửa sổ của luật lành mạnh. */
export const MODERATION_RULE_CUMULATIVE_BUDGET_MS = 1000
export const MODERATION_RULE_CUMULATIVE_PERIOD_MS = 60_000
/** Tổng thời gian khớp luật mặc định của một request (chat: câu mới + tối đa 29 lượt cũ; bình luận). */
export const MODERATION_REQUEST_BUDGET_MS = 250
/** Lượt `vm` đã chạy quá mức này thì nhường trước cửa sổ kế (xem "Quy lỗi"). */
const PASS_SLACK_MS = 20

/** `elapsed`: đồng hồ đo khoảng (ms, đơn điệu); `now`: giờ thực (ms) — hạn tắt luật, chu kỳ ngân sách. */
interface RegexTiming { elapsed: () => number, now: () => number }
const defaultTiming: RegexTiming = { elapsed: () => performance.now(), now: () => Date.now() }
let timing: RegexTiming = defaultTiming
const disabledUntil = new Map<string, number>()
/** Thời gian đã tính cho mỗi mẫu trong chu kỳ hiện tại của nó. */
const ruleSpend = new Map<string, { periodStart: number, spentMs: number }>()
const RULE_SPEND_PRUNE_AT = 1000

/** Một luật regex đã biên dịch (`compileModerationRegex`) cùng chuỗi mẫu làm khoá tắt/log. */
export interface ModerationRegexRule { pattern: string, regex: RegExp }
/** Một văn bản cùng các luật quét nó — một phần tử của `testModerationRegexBatch`. */
export interface ModerationRegexBatchItem { rules: readonly ModerationRegexRule[], text: string }

/** Hạn mức thời gian khớp của MỘT request. Chỉ tạo bằng `createModerationRegexBudget`; chỉ tệp này đọc/đổi. */
export interface ModerationRegexBudget { readonly limitMs: number }
/** `byPattern`: ms mỗi mẫu đã dùng trong request — cho dòng log khi hết hạn mức. */
interface BudgetState { spentMs: number, byPattern: Map<string, number>, logged: boolean }
const budgets = new WeakMap<ModerationRegexBudget, BudgetState>()

type Outcome =
  | { kind: 'match' } | { kind: 'clean' }
  /** Cửa sổ chạy xong nhưng đo quá ngân sách cửa sổ: giữ kết quả của chính nó. */
  | { kind: 'slow', matched: boolean, elapsedMs: number }
  /** Cửa sổ bị ngắt cứng: không có kết quả. */
  | { kind: 'interrupted', elapsedMs: number }
  /** Dừng trước một cửa sổ: hết ngân sách chu kỳ (`spent`) hay hết hạn mức request (`deadline`). */
  | { kind: 'spent' } | { kind: 'deadline' }

interface RuleScan { outcome: Outcome | null, skip: boolean }
interface ItemScan { rules: readonly ModerationRegexRule[], text: string, scans: RuleScan[] }
interface Position { item: number, rule: number, from: number }
/**
 * Cửa sổ đang (hoặc vừa) chạy — một phép gán trước mỗi cửa sổ. `startedAt`: `timing.elapsed()`
 * ngay trước nó (`null`: lượt chưa tới cửa sổ nào); `charged`: số cửa sổ của mẫu đã vào `ledger`.
 */
interface Cursor extends Position { startedAt: number | null, charged: number }
interface Ledger { windows: number, spentMs: number, item: number }
const NOTHING_CHARGED = Object.freeze({ windows: 0, spentMs: 0, item: 0 })

interface ScanJob {
  items: ItemScan[]
  stopAtFirstMatch: boolean
  /** Lượt `vm` kế tiếp bắt đầu từ đây. */
  next: Position
  at: Cursor
  /** `before` của cửa sổ đầu của lượt `vm` hiện tại. */
  passStart: number | null
  done: boolean
  /** Hạn của request trên `timing.elapsed()`; `Infinity` khi không có hạn mức. */
  deadlineAt: number
  exhausted: boolean
  /** ms mỗi mẫu còn được dùng trong chu kỳ (chụp lúc bắt đầu, chỉ đọc trong `vm`). */
  allowance: ReadonlyMap<string, number>
  /** Thời gian lượt này đã dùng cho mỗi mẫu. */
  ledger: Map<string, Ledger>
  /** Mẫu đã bị tắt hay dừng TRONG lượt này — luật trùng mẫu phía sau không chạy. */
  slowPatterns: Set<string>
}

const matchedBy = (outcome: Outcome | null): boolean =>
  outcome?.kind === 'match' || (outcome?.kind === 'slow' && outcome.matched)

/**
 * Vòng quét — mã của realm chính, gọi TỪ script `vm` để watchdog ngắt được nó. Đúng một lần
 * `timing.elapsed()` ngay trước và một lần ngay sau mỗi cửa sổ (đồng hồ giả của test dựa vào nhịp này).
 */
function scan(job: ScanJob): void {
  const step = MODERATION_REGEX_WINDOW - MODERATION_REGEX_WINDOW_OVERLAP
  const start = job.next
  for (let i = start.item; i < job.items.length; i += 1) {
    const item = job.items[i]!
    for (let r = i === start.item ? start.rule : 0; r < item.rules.length; r += 1) {
      const state = item.scans[r]!
      const { pattern, regex } = item.rules[r]!
      if (state.skip || state.outcome !== null || job.slowPatterns.has(pattern)) continue
      for (let from = i === start.item && r === start.rule ? start.from : 0; ; from += step) {
        const ledger = job.ledger.get(pattern) ?? NOTHING_CHARGED
        if (ledger.spentMs >= job.allowance.get(pattern)!) {
          state.outcome = { kind: 'spent' }
          job.slowPatterns.add(pattern)
          break
        }
        const before = timing.elapsed()
        if (before >= job.deadlineAt) {
          state.outcome = { kind: 'deadline' }
          job.exhausted = true
          return
        }
        if (job.passStart === null) job.passStart = before
        else if (before - job.passStart > PASS_SLACK_MS) {
          job.next = { item: i, rule: r, from } // nhường: cửa sổ này mở lượt mới, có trọn hạn giờ
          return
        }
        job.at = { item: i, rule: r, from, startedAt: before, charged: ledger.windows }
        const matched = regex.test(item.text.slice(from, from + MODERATION_REGEX_WINDOW))
        const after = timing.elapsed()
        job.ledger.set(pattern, { windows: ledger.windows + 1, spentMs: ledger.spentMs + (after - before), item: i })
        if (after - before > MODERATION_RULE_WINDOW_BUDGET_MS) {
          state.outcome = { kind: 'slow', matched, elapsedMs: after - before }
          job.slowPatterns.add(pattern)
          break
        }
        if (matched) {
          state.outcome = { kind: 'match' }
          break
        }
        if (from + MODERATION_REGEX_WINDOW >= item.text.length) {
          state.outcome = { kind: 'clean' }
          break
        }
      }
      if (job.stopAtFirstMatch && matchedBy(state.outcome)) break
    }
  }
  job.done = true
}

// Dựng MỘT lần lúc nạp, dùng lại cho mọi lượt: ngữ cảnh không được sinh mã từ chuỗi; script cố
// định chỉ gọi `scan` với lượt quét đặt ở thuộc tính `job` (không có dữ liệu nào trong mã).
const scanContext = vm.createContext({ scan, job: null as ScanJob | null }, {
  name: 'moderation-regex-runtime',
  codeGeneration: { strings: false, wasm: false },
})
const scanScript = new vm.Script('scan(job)', { filename: 'moderation-regex-runtime.ts#scan' })

const isScriptTimeout = (err: unknown): boolean =>
  (err as { code?: unknown } | null)?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'

/** Vị trí đầu tiên còn luật để quét từ `next`, hay `null` khi không còn gì. */
function normalized(job: ScanJob, next: Position): Position | null {
  for (let item = next.item, rule = next.rule; item < job.items.length; item += 1, rule = 0) {
    if (rule < job.items[item]!.rules.length) return { item, rule, from: item === next.item && rule === next.rule ? next.from : 0 }
  }
  return null
}

/** Chạy `scan` trong các lượt `vm` có hạn giờ cho tới khi xong, hay hết hạn mức (xem đầu tệp). */
function runScan(job: ScanJob): void {
  for (let idle = 0; ;) {
    const next = normalized(job, job.next)
    if (next === null) return
    job.next = next
    let timeout = MODERATION_RULE_WINDOW_BUDGET_MS
    if (job.deadlineAt !== Infinity) {
      const remaining = Math.floor(job.deadlineAt - timing.elapsed())
      if (remaining < 1) { job.exhausted = true; return } // `vm` chỉ nhận số nguyên dương
      timeout = Math.min(timeout, remaining)
    }
    job.at = { ...next, startedAt: null, charged: 0 }
    job.passStart = null
    scanContext.job = job
    try {
      scanScript.runInContext(scanContext, { timeout })
      if (job.done || job.exhausted) return
      idle = 0
      continue // đã nhường: lượt mới từ `job.next`
    } catch (err: unknown) {
      if (!isScriptTimeout(err)) throw err
    } finally {
      scanContext.job = null
    }
    const cutByDeadline = timeout < MODERATION_RULE_WINDOW_BUDGET_MS
    const at = job.at
    if (at.startedAt === null) {
      if (cutByDeadline) { job.exhausted = true; return }
      // Hết giờ trước cả cửa sổ đầu (một lần dừng GC dài): thử lại một lần; lần nữa thì thôi —
      // phần còn lại không chạy (mở khi lỗi), và ghi log, không im lặng.
      if ((idle += 1) <= 1) continue
      const stalled = job.items[next.item]!
      logWarn({ event: 'ai_moderation.rule_scan_stalled', pattern: stalled.rules[next.rule]!.pattern.slice(0, MODERATION_PATTERN_MAX_LENGTH), inputLength: stalled.text.length })
      return
    }
    idle = 0
    const item = job.items[at.item]!
    const { pattern } = item.rules[at.rule]!
    const ranFor = timing.elapsed() - at.startedAt
    const ledger = job.ledger.get(pattern) ?? NOTHING_CHARGED
    // Cửa sổ đang chạy chưa vào sổ (ngắt rơi trước `ledger.set`): tính phần nó đã chạy.
    if (ledger.windows === at.charged) job.ledger.set(pattern, { windows: ledger.windows + 1, spentMs: ledger.spentMs + ranFor, item: at.item })
    const state = item.scans[at.rule]!
    if (state.outcome === null) {
      if (cutByDeadline) {
        state.outcome = { kind: 'deadline' }
        job.exhausted = true
        return
      }
      state.outcome = { kind: 'interrupted', elapsedMs: ranFor }
      job.slowPatterns.add(pattern)
    } // còn không: ngắt rơi GIỮA hai cửa sổ — luật đã có kết quả, không quy cho ai
    const itemDone = job.stopAtFirstMatch && matchedBy(state.outcome)
    job.next = itemDone ? { item: at.item + 1, rule: 0, from: 0 } : { item: at.item, rule: at.rule + 1, from: 0 }
  }
}

/** Chu kỳ ngân sách đang mở của mẫu, hay `undefined` khi đã hết hạn (đồng hồ lùi cũng tính là hết). */
function currentPeriod(pattern: string, now: number): { periodStart: number, spentMs: number } | undefined {
  const entry = ruleSpend.get(pattern)
  return entry && now >= entry.periodStart && now - entry.periodStart < MODERATION_RULE_CUMULATIVE_PERIOD_MS ? entry : undefined
}

function disable(pattern: string, fields: Record<string, unknown>): void {
  disabledUntil.set(pattern, timing.now() + MODERATION_RULE_COOLDOWN_MS)
  ruleSpend.delete(pattern) // bật lại sau thời gian chờ thì bắt đầu một chu kỳ mới
  logWarn({ event: 'ai_moderation.rule_slow_disabled', pattern: pattern.slice(0, MODERATION_PATTERN_MAX_LENGTH), ...fields, disabledForMs: MODERATION_RULE_COOLDOWN_MS })
}

/** Ghi hậu quả của lượt quét (tắt luật, sổ chu kỳ, hạn mức request, log) và trả kết quả. */
function settle(job: ScanJob, budget: { limitMs: number, state: BudgetState } | undefined, callMs: number): boolean[][] {
  const disabledNow = new Set<string>()
  for (const item of job.items) {
    item.scans.forEach((state, index) => {
      const outcome = state.outcome
      if (outcome?.kind !== 'slow' && outcome?.kind !== 'interrupted') return
      const pattern = item.rules[index]!.pattern
      disabledNow.add(pattern)
      disable(pattern, { elapsedMs: Math.round(outcome.elapsedMs), inputLength: item.text.length, reason: 'window', ...(outcome.kind === 'interrupted' ? { interrupted: true } : {}) })
    })
  }
  const now = timing.now()
  if (ruleSpend.size > RULE_SPEND_PRUNE_AT) for (const [pattern] of ruleSpend) if (!currentPeriod(pattern, now)) ruleSpend.delete(pattern)
  for (const [pattern, ledger] of job.ledger) {
    budget?.state.byPattern.set(pattern, (budget.state.byPattern.get(pattern) ?? 0) + ledger.spentMs)
    if (disabledNow.has(pattern)) continue
    const period = currentPeriod(pattern, now)
    const spentMs = (period?.spentMs ?? 0) + ledger.spentMs
    ruleSpend.set(pattern, { periodStart: period?.periodStart ?? now, spentMs })
    if (spentMs >= MODERATION_RULE_CUMULATIVE_BUDGET_MS) {
      disable(pattern, { elapsedMs: Math.round(spentMs), inputLength: job.items[ledger.item]!.text.length, reason: 'cumulative', periodMs: MODERATION_RULE_CUMULATIVE_PERIOD_MS })
    }
  }
  if (budget) {
    const { state } = budget
    state.spentMs += callMs
    if (job.exhausted && !state.logged) {
      state.logged = true
      const [topPattern, topMs] = [...state.byPattern].reduce((top, entry) => (entry[1] > top[1] ? entry : top), ['', 0])
      logWarn({
        event: 'ai_moderation.request_budget_exhausted',
        budgetMs: budget.limitMs,
        spentMs: Math.round(state.spentMs),
        topPattern: topPattern.slice(0, MODERATION_PATTERN_MAX_LENGTH),
        topPatternMs: Math.round(topMs),
        texts: job.items.length,
      })
    }
  }
  return job.items.map(item => item.scans.map(state => matchedBy(state.outcome)))
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

/**
 * Khớp mọi luật của MỖI văn bản (luật đã qua `compileModerationRegex`) trong MỘT lượt `vm` cho
 * cả lô — xem đầu tệp. Trả kết quả theo đúng thứ tự: `false` cho luật đang bị tắt, bị ngắt, bị
 * dừng vì hết ngân sách hay hạn mức, hay không tới lượt. `stopAtFirstMatch`: mỗi văn bản dừng ở
 * luật đầu tiên khớp. `budget`: hạn mức của request, dùng chung cho mọi lời gọi của request đó.
 * Một lô bằng đúng chuỗi lời gọi `testModerationRegexes` lần lượt trên từng văn bản.
 */
export function testModerationRegexBatch(
  input: readonly ModerationRegexBatchItem[],
  options: { stopAtFirstMatch?: boolean, budget?: ModerationRegexBudget } = {},
): boolean[][] {
  const budgetState = options.budget === undefined ? undefined : budgets.get(options.budget)
  if (options.budget !== undefined && budgetState === undefined) throw new TypeError('budget must come from createModerationRegexBudget()')
  const disabled = new Map<string, boolean>()
  const isDisabled = (pattern: string) => disabled.get(pattern) ?? disabled.set(pattern, isModerationRuleDisabled(pattern)).get(pattern)!
  const items: ItemScan[] = input.map(({ rules, text }) => ({ rules, text, scans: rules.map(rule => ({ outcome: null, skip: isDisabled(rule.pattern) })) }))
  if (items.every(item => item.scans.every(state => state.skip))) return items.map(item => item.scans.map(() => false))
  const now = timing.now()
  const allowance = new Map<string, number>()
  for (const [pattern, off] of disabled) if (!off) allowance.set(pattern, MODERATION_RULE_CUMULATIVE_BUDGET_MS - (currentPeriod(pattern, now)?.spentMs ?? 0))
  const startedAt = budgetState ? timing.elapsed() : 0
  const job: ScanJob = {
    items,
    stopAtFirstMatch: options.stopAtFirstMatch === true,
    next: { item: 0, rule: 0, from: 0 },
    at: { item: 0, rule: 0, from: 0, startedAt: null, charged: 0 },
    passStart: null,
    done: false,
    deadlineAt: budgetState ? startedAt + options.budget!.limitMs - budgetState.spentMs : Infinity,
    exhausted: false,
    allowance,
    ledger: new Map(),
    slowPatterns: new Set(),
  }
  let results: boolean[][] = []
  try {
    runScan(job)
  } finally {
    // Cả khi một lượt khớp ném lỗi: luật đã quét vẫn bị tắt/tính giờ/ghi log như trước.
    const callMs = budgetState ? timing.elapsed() - startedAt : 0
    results = settle(job, budgetState && { limitMs: options.budget!.limitMs, state: budgetState }, callMs)
  }
  return results
}

/** Mọi luật trên một văn bản — `testModerationRegexBatch` với một phần tử. */
export function testModerationRegexes(
  rules: readonly ModerationRegexRule[],
  text: string,
  options: { stopAtFirstMatch?: boolean, budget?: ModerationRegexBudget } = {},
): boolean[] {
  return testModerationRegexBatch([{ rules, text }], options)[0]!
}

/** Một luật trên một văn bản — `testModerationRegexes` với danh sách một phần tử. */
export function testModerationRegex(pattern: string, regex: RegExp, text: string): boolean {
  return testModerationRegexes([{ pattern, regex }], text)[0]!
}
