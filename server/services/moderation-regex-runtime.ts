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
 * Sổ của mức 1–3 (đồng hồ, luật đang tắt, chu kỳ mỗi luật, hạn mức request) ở
 * `moderation-regex-budget.ts` — chủ duy nhất của chúng; tệp này đo, quyết và nộp kết quả một lượt
 * (`settleRegexSpend`).
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
 * và log đổi SAU khi lượt `vm` trả về hay bị ngắt. Tệp này là chủ DUY NHẤT của ngữ cảnh + script
 * `vm` (`scanContext`, `scanScript` — không `export`; `tests/service-split-boundaries.test.ts`,
 * luật 4). Văn bản và luật vào `vm` qua thuộc tính của ngữ cảnh; script là hằng `'scan(job)'`
 * (`vm` không phải hộp cát — guard ở `tests/moderation-regex-budget.test.ts`).
 */
import vm from 'node:vm'
import { logWarn } from '../utils/logger'
import { MODERATION_PATTERN_MAX_LENGTH, MODERATION_REGEX_WINDOW, MODERATION_REGEX_WINDOW_OVERLAP } from './moderation-regex-limits'
import {
  assertModerationRegexBudget,
  isModerationRuleDisabled,
  regexElapsed,
  requestDeadline,
  ruleAllowances,
  settleRegexSpend,
  type ModerationRegexBudget,
  type PatternSpend,
  type WindowOffender,
} from './moderation-regex-budget'

/**
 * Hạn giờ CỨNG của một cửa sổ (ms). Mẫu lành mạnh tốn µs một cửa sổ 2000 ký tự (đo 30 luật
 * tiếng Việt: ≤ 69 µs trên văn bản thường, ≤ 30 ms trên đầu vào dựng sẵn tệ nhất).
 */
export const MODERATION_RULE_WINDOW_BUDGET_MS = 200
/** Lượt `vm` đã chạy quá mức này thì nhường trước cửa sổ kế (xem "Quy lỗi"). */
const PASS_SLACK_MS = 20

/** Một luật regex đã biên dịch (`compileModerationRegex`) cùng chuỗi mẫu làm khoá tắt/log. */
export interface ModerationRegexRule { pattern: string, regex: RegExp }
/** Một văn bản cùng các luật quét nó — một phần tử của `testModerationRegexBatch`. */
export interface ModerationRegexBatchItem { rules: readonly ModerationRegexRule[], text: string }

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
 * Cửa sổ đang (hoặc vừa) chạy — một phép gán trước mỗi cửa sổ. `startedAt`: `regexElapsed()`
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
  /** Hạn của request trên `regexElapsed()`; `Infinity` khi không có hạn mức. */
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
 * `regexElapsed()` ngay trước và một lần ngay sau mỗi cửa sổ (đồng hồ giả của test dựa vào nhịp này).
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
        const before = regexElapsed()
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
        const after = regexElapsed()
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
      const remaining = Math.floor(job.deadlineAt - regexElapsed())
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
    const ranFor = regexElapsed() - at.startedAt
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

/** Nộp hậu quả của lượt quét cho sổ (`settleRegexSpend`: tắt luật, chu kỳ, hạn mức request, log). */
function settle(job: ScanJob, budget: ModerationRegexBudget | undefined, callMs: number): void {
  const offenders: WindowOffender[] = []
  for (const item of job.items) {
    item.scans.forEach((state, index) => {
      const outcome = state.outcome
      if (outcome?.kind !== 'slow' && outcome?.kind !== 'interrupted') return
      offenders.push({ pattern: item.rules[index]!.pattern, elapsedMs: outcome.elapsedMs, inputLength: item.text.length, interrupted: outcome.kind === 'interrupted' })
    })
  }
  const spend: PatternSpend[] = [...job.ledger].map(([pattern, ledger]) => ({ pattern, spentMs: ledger.spentMs, inputLength: job.items[ledger.item]!.text.length }))
  settleRegexSpend({ offenders, spend, ...(budget ? { request: { budget, callMs, exhausted: job.exhausted, texts: job.items.length } } : {}) })
}

/**
 * Văn bản này có luật ĐANG BẬT chưa xét không — hạn mức request hết trước nó (`deadline`, hay chưa
 * tới lượt), hay lượt quét kẹt (`rule_scan_stalled`). Khác "không khớp": luật đang tắt, luật vừa bị
 * tắt/dừng trong lời gọi này (mẫu ở `slowPatterns`) là đã có quyết định — mở khi lỗi theo luật.
 * Văn bản đã khớp khi `stopAtFirstMatch` thì đã quét đủ.
 */
function unscanned(job: ScanJob, item: ItemScan): boolean {
  if (job.stopAtFirstMatch && item.scans.some(state => matchedBy(state.outcome))) return false
  return item.scans.some((state, r) => state.outcome?.kind === 'deadline'
    || (state.outcome === null && !state.skip && !job.slowPatterns.has(item.rules[r]!.pattern)))
}

/** Kết quả một lô: `hits` như `testModerationRegexBatch`; `unscanned[i]`: văn bản i còn luật đang bật chưa xét. */
export interface ModerationRegexBatchScan { hits: boolean[][], unscanned: boolean[] }

/**
 * Khớp mọi luật của MỖI văn bản (luật đã qua `compileModerationRegex`) trong MỘT lượt `vm` cho
 * cả lô — xem đầu tệp. `hits` theo đúng thứ tự: `false` cho luật đang bị tắt, bị ngắt, bị dừng vì
 * hết ngân sách hay hạn mức, hay không tới lượt — `unscanned` tách hai trường hợp cuối (hạn mức
 * request hết, lượt kẹt) khỏi "không khớp", cho nơi gọi không được coi văn bản chưa xét là sạch
 * (lượt cũ của chat). `stopAtFirstMatch`: mỗi văn bản dừng ở luật đầu tiên khớp. `budget`: hạn
 * mức của request, dùng chung cho mọi lời gọi của request đó. Một lô bằng đúng chuỗi lời gọi
 * `testModerationRegexes` lần lượt trên từng văn bản.
 */
export function scanModerationRegexBatch(
  input: readonly ModerationRegexBatchItem[],
  options: { stopAtFirstMatch?: boolean, budget?: ModerationRegexBudget } = {},
): ModerationRegexBatchScan {
  const { budget } = options
  assertModerationRegexBudget(budget)
  const disabled = new Map<string, boolean>()
  const isDisabled = (pattern: string) => disabled.get(pattern) ?? disabled.set(pattern, isModerationRuleDisabled(pattern)).get(pattern)!
  const items: ItemScan[] = input.map(({ rules, text }) => ({ rules, text, scans: rules.map(rule => ({ outcome: null, skip: isDisabled(rule.pattern) })) }))
  if (items.every(item => item.scans.every(state => state.skip))) return { hits: items.map(item => item.scans.map(() => false)), unscanned: items.map(() => false) }
  const allowance = ruleAllowances([...disabled].filter(([, off]) => !off).map(([pattern]) => pattern))
  const startedAt = budget ? regexElapsed() : 0
  const job: ScanJob = {
    items,
    stopAtFirstMatch: options.stopAtFirstMatch === true,
    next: { item: 0, rule: 0, from: 0 },
    at: { item: 0, rule: 0, from: 0, startedAt: null, charged: 0 },
    passStart: null,
    done: false,
    deadlineAt: budget ? requestDeadline(budget, startedAt) : Infinity,
    exhausted: false,
    allowance,
    ledger: new Map(),
    slowPatterns: new Set(),
  }
  try {
    runScan(job)
  } finally {
    // Cả khi một lượt khớp ném lỗi: luật đã quét vẫn bị tắt/tính giờ/ghi log như trước.
    const callMs = budget ? regexElapsed() - startedAt : 0
    settle(job, budget, callMs)
  }
  return { hits: items.map(item => item.scans.map(state => matchedBy(state.outcome))), unscanned: items.map(item => unscanned(job, item)) }
}

/** `scanModerationRegexBatch` chỉ lấy kết quả khớp — văn bản chưa xét đọc như không khớp (mở khi lỗi). */
export function testModerationRegexBatch(
  input: readonly ModerationRegexBatchItem[],
  options: { stopAtFirstMatch?: boolean, budget?: ModerationRegexBudget } = {},
): boolean[][] {
  return scanModerationRegexBatch(input, options).hits
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
