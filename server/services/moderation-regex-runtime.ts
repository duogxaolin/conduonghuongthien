/**
 * Chạy mẫu luật kiểm duyệt có giới hạn CỨNG — tệp con của nhóm `moderation-regex`
 * (wave3-long-term 4.3, D-SPLIT; nơi gọi import barrel `moderation-regex.ts`).
 *
 * Lớp 2 — bảo đảm lúc CHẠY. Lớp 1 (phân tích lúc lưu) chỉ là ước lượng tốt-nhất-có-thể: phép
 * xét lúc lưu không thể đúng trọn trong trường hợp tổng quát (`日*日*日*$` lọt vì chữ ngoài
 * bảng mẫu — `FINDING moderation-regex-4`), nên mọi giới hạn thật nằm ở đây.
 *
 *  - Cửa sổ: mỗi lượt khớp chạy trên tối đa `MODERATION_REGEX_WINDOW` ký tự; văn bản dài hơn
 *    được quét theo cửa sổ chồng nhau `MODERATION_REGEX_WINDOW_OVERLAP` ký tự (không lách được
 *    bằng cách đặt nội dung sau ký tự thứ N). Hệ quả: `^`/`$` khớp cả ở đầu/cuối mỗi cửa sổ
 *    khi văn bản dài hơn N, và một lần khớp dài hơn phần chồng nhau đúng ở ranh giới cửa sổ có
 *    thể bị bỏ sót.
 *  - Ngắt cứng: lượt quét chạy trong `node:vm` với `timeout` = `MODERATION_RULE_WINDOW_BUDGET_MS`.
 *    Watchdog của `vm` dừng mã JS đang chạy ở bất kỳ realm nào — kể cả `RegExp` của realm
 *    chính, đúng đối tượng `compileModerationRegex` dựng (cache lớp 1 giữ nguyên). Cửa sổ bị
 *    ngắt tính là KHÔNG khớp (mở khi lỗi, như mọi luật bị bỏ qua), luật bị TẮT
 *    `MODERATION_RULE_COOLDOWN_MS` và ghi `ai_moderation.rule_slow_disabled` một lần (thêm
 *    `interrupted: true`); luật đó không quét thêm cửa sổ nào của văn bản này — y như cửa sổ
 *    chậm mà chạy xong trước đây. Các luật khác vẫn chạy tiếp.
 *  - Một lượt `vm` cho MỌI luật của một văn bản (`testModerationRegexes`), không phải một lượt
 *    mỗi luật: mỗi lượt `vm` có hạn giờ tốn ~25–50 µs (dựng luồng watchdog), nên 30 luật mỗi
 *    luật một lượt là ~0,8–1,6 ms mỗi tin, gộp lại là một lần ~25–50 µs. Hạn giờ của lượt gộp
 *    tính từ đầu lượt, nên cửa sổ đang chạy khi hết giờ chỉ bị quy là kẻ phạm khi nó có trọn
 *    ngân sách: nó là bước đầu của lượt, hoặc đã chạy ≥ ngân sách. Không thì lượt mới chạy lại
 *    từ chính cửa sổ đó (lần này là bước đầu, có trọn ngân sách) rồi đi tiếp — luật vô tội
 *    không bao giờ bị tắt vì các luật trước đã tiêu gần hết giờ. Tệ nhất một luật xấu chặn
 *    vòng sự kiện ~2 × ngân sách một lần mỗi khoảng chờ.
 *  - Cửa sổ chạy XONG mà đo > ngân sách (đồng hồ thật trễ, hay đồng hồ giả của test) vẫn đi
 *    đường cũ: tắt luật, ghi log, trả kết quả của chính cửa sổ đó.
 *  - Đo theo cửa sổ chứ không cộng dồn, để một văn bản dài không biến thành công tắc tắt luật.
 *    Tổng thời gian một luật dùng cho một văn bản bị chặn ở `MODERATION_RULE_CALL_BUDGET_MS`:
 *    vượt thì phần còn lại của văn bản đó KHÔNG được quét bằng luật ấy (log
 *    `ai_moderation.rule_scan_truncated`, tối đa một lần mỗi luật mỗi khoảng chờ).
 *
 * Trong `vm` chỉ có phép khớp và việc ghi kết quả vào đối tượng của lượt quét (`ScanJob`); mọi
 * thay đổi trạng thái dùng chung — sổ luật tắt, log — làm SAU khi lượt `vm` trả về hay bị ngắt,
 * vì lệnh ngắt có thể rơi vào giữa bất kỳ câu lệnh JS nào. Vị trí đang quét được ghi bằng MỘT
 * phép gán (`job.at = { … }`) trước mỗi cửa sổ, nên không bao giờ đọc được nửa cũ nửa mới.
 * `lastIndex`: gọi đúng `regex.test(cửa sổ)` như trước, không đặt lại, không khôi phục.
 *
 * Tệp này là chủ DUY NHẤT của trạng thái lúc chạy — đồng hồ (`timing`), luật đang bị tắt 10
 * phút (`disabledUntil`), mốc log cắt quét (`truncationLoggedUntil`), ngữ cảnh `vm` và script
 * dựng một lần (`scanContext`, `scanScript`): không `export`, chỉ đổi qua các hàm dưới đây
 * (`tests/service-split-boundaries.test.ts`, luật 4). Văn bản và luật vào `vm` qua thuộc tính
 * của ngữ cảnh, không bao giờ ghép vào mã script.
 */
import vm from 'node:vm'
import { logWarn } from '../utils/logger'
import {
  MODERATION_PATTERN_MAX_LENGTH,
  MODERATION_REGEX_WINDOW,
  MODERATION_REGEX_WINDOW_OVERLAP,
} from './moderation-regex-limits'

/**
 * Hạn giờ CỨNG của một cửa sổ (ms). Cửa sổ chạy tới mức này thì bị ngắt và luật bị TẮT tạm;
 * chạy xong mà đo hơn mức này cũng vậy. Đo theo TỪNG cửa sổ, không cộng dồn: cộng dồn thì một
 * tin chatbot dài (hàng trăm cửa sổ) làm cả một luật rẻ vượt ngưỡng — tức là ai cũng tắt được
 * luật bằng một tin dài. Mẫu đã qua lớp 1 tốn cỡ 10–40 ms một cửa sổ trên máy phát triển;
 * ngưỡng chừa biên cho VPS yếu.
 */
export const MODERATION_RULE_WINDOW_BUDGET_MS = 200
/**
 * Tổng thời gian một luật được dùng cho MỘT văn bản. Vượt thì dừng quét phần còn lại của văn
 * bản đó (không tắt luật — văn bản dài không phải lỗi của luật), để một văn bản rất dài không
 * chặn vòng sự kiện quá lâu.
 */
export const MODERATION_RULE_CALL_BUDGET_MS = 1000
/** Thời gian một luật chậm bị tắt (và khoảng tối thiểu giữa hai dòng log cùng loại). */
export const MODERATION_RULE_COOLDOWN_MS = 10 * 60_000

interface RegexTiming {
  /** Đồng hồ đo khoảng (ms, đơn điệu). */
  elapsed: () => number
  /** Giờ thực (ms) — cho hạn tắt luật. */
  now: () => number
}
const defaultTiming: RegexTiming = { elapsed: () => performance.now(), now: () => Date.now() }
let timing: RegexTiming = defaultTiming
const disabledUntil = new Map<string, number>()
const truncationLoggedUntil = new Map<string, number>()

/** Một luật regex đã biên dịch (`compileModerationRegex`) cùng chuỗi mẫu làm khoá tắt/log. */
export interface ModerationRegexRule {
  pattern: string
  regex: RegExp
}

type Outcome =
  | { kind: 'match' }
  | { kind: 'clean' }
  /** Cửa sổ chạy xong nhưng đo quá ngân sách: giữ kết quả của chính nó. */
  | { kind: 'slow'; matched: boolean; elapsedMs: number }
  /** Cửa sổ bị ngắt cứng: không có kết quả. */
  | { kind: 'interrupted'; elapsedMs: number }
  | { kind: 'truncated'; scannedChars: number }

interface RuleScan {
  /** Mốc bắt đầu quét luật này (cho trần mỗi văn bản), `null` khi chưa tới lượt. */
  start: number | null
  outcome: Outcome | null
  /** Đang bị tắt từ trước lượt quét: không chạy. */
  skip: boolean
}

/** Cửa sổ đang (hoặc vừa) chạy — ghi bằng một phép gán trước mỗi cửa sổ. */
interface Cursor {
  rule: number
  from: number
  /** `timing.elapsed()` ngay trước cửa sổ; `null` khi lượt chưa tới cửa sổ nào. */
  startedAt: number | null
  /** Bước đầu tiên của lượt `vm` này — có trọn ngân sách. */
  first: boolean
}

interface ScanJob {
  rules: readonly ModerationRegexRule[]
  text: string
  scans: RuleScan[]
  stopAtFirstMatch: boolean
  /** Lượt `vm` kế tiếp bắt đầu từ đây. */
  next: { rule: number; from: number }
  at: Cursor
  firstStep: boolean
  /** Mẫu đã bị tắt TRONG lượt này — luật trùng mẫu phía sau không chạy, như khi tắt ngay. */
  slowPatterns: Set<string>
}

const matchedBy = (outcome: Outcome | null): boolean =>
  outcome?.kind === 'match' || (outcome?.kind === 'slow' && outcome.matched)

/**
 * Vòng quét — mã của realm chính, gọi TỪ script `vm` để watchdog của `vm` ngắt được nó. Mỗi
 * luật: `timing.elapsed()` một lần lúc bắt đầu, rồi đúng một lần ngay trước và một lần ngay sau
 * mỗi cửa sổ (đồng hồ giả của test dựa vào nhịp này).
 */
function scan(job: ScanJob): void {
  const step = MODERATION_REGEX_WINDOW - MODERATION_REGEX_WINDOW_OVERLAP
  for (let index = job.next.rule; index < job.rules.length; index += 1) {
    const state = job.scans[index]!
    const { pattern, regex } = job.rules[index]!
    if (state.skip || job.slowPatterns.has(pattern)) continue
    if (state.start === null) state.start = timing.elapsed()
    for (let from = index === job.next.rule ? job.next.from : 0; ; from += step) {
      const before = timing.elapsed()
      job.at = { rule: index, from, startedAt: before, first: job.firstStep }
      job.firstStep = false
      const matched = regex.test(job.text.slice(from, from + MODERATION_REGEX_WINDOW))
      const after = timing.elapsed()
      if (after - before > MODERATION_RULE_WINDOW_BUDGET_MS) {
        state.outcome = { kind: 'slow', matched, elapsedMs: after - before }
        job.slowPatterns.add(pattern)
        break
      }
      if (matched) {
        state.outcome = { kind: 'match' }
        break
      }
      if (from + MODERATION_REGEX_WINDOW >= job.text.length) {
        state.outcome = { kind: 'clean' }
        break
      }
      if (after - state.start > MODERATION_RULE_CALL_BUDGET_MS) {
        state.outcome = { kind: 'truncated', scannedChars: from + MODERATION_REGEX_WINDOW }
        break
      }
    }
    if (job.stopAtFirstMatch && matchedBy(state.outcome)) return
  }
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

/** Chạy `scan` trong các lượt `vm` có hạn giờ cho tới khi mọi luật xong (xem đầu tệp). */
function runScan(job: ScanJob): void {
  for (let idle = 0; ;) {
    job.at = { rule: job.next.rule, from: job.next.from, startedAt: null, first: true }
    job.firstStep = true
    scanContext.job = job
    try {
      scanScript.runInContext(scanContext, { timeout: MODERATION_RULE_WINDOW_BUDGET_MS })
      return
    } catch (err: unknown) {
      if (!isScriptTimeout(err)) throw err
    } finally {
      scanContext.job = null
    }
    const at = job.at
    if (at.startedAt === null) {
      // Hết giờ trước cả cửa sổ đầu (một lần dừng GC dài): không ai để quy, thử lại một lần;
      // lần nữa thì thôi quét — phần còn lại không chạy, như luật bị bỏ qua.
      if ((idle += 1) > 1) return
      continue
    }
    idle = 0
    const ranFor = timing.elapsed() - at.startedAt
    if (at.first || ranFor >= MODERATION_RULE_WINDOW_BUDGET_MS) {
      job.scans[at.rule]!.outcome = { kind: 'interrupted', elapsedMs: ranFor }
      job.slowPatterns.add(job.rules[at.rule]!.pattern)
      job.next = { rule: at.rule + 1, from: 0 }
    } else {
      job.next = { rule: at.rule, from: at.from }
    }
  }
}

/** Ghi hậu quả của một luật đã quét (tắt, log) và trả kết quả khớp của nó. */
function settle(rule: ModerationRegexRule, state: RuleScan, inputLength: number): boolean {
  const outcome = state.outcome
  if (outcome?.kind === 'slow' || outcome?.kind === 'interrupted') {
    disabledUntil.set(rule.pattern, timing.now() + MODERATION_RULE_COOLDOWN_MS)
    logWarn({
      event: 'ai_moderation.rule_slow_disabled',
      pattern: rule.pattern.slice(0, MODERATION_PATTERN_MAX_LENGTH),
      elapsedMs: Math.round(outcome.elapsedMs),
      inputLength,
      disabledForMs: MODERATION_RULE_COOLDOWN_MS,
      ...(outcome.kind === 'interrupted' ? { interrupted: true } : {}),
    })
  } else if (outcome?.kind === 'truncated') {
    const now = timing.now()
    if ((truncationLoggedUntil.get(rule.pattern) ?? 0) <= now) {
      truncationLoggedUntil.set(rule.pattern, now + MODERATION_RULE_COOLDOWN_MS)
      logWarn({
        event: 'ai_moderation.rule_scan_truncated',
        pattern: rule.pattern.slice(0, MODERATION_PATTERN_MAX_LENGTH),
        scannedChars: outcome.scannedChars,
        inputLength,
      })
    }
  }
  return matchedBy(outcome)
}

/** Chỉ cho test: thay đồng hồ để không phải đo thời gian thật. `null` = khôi phục. */
export function setModerationRegexTimingForTests(next: RegexTiming | null): void {
  timing = next ?? defaultTiming
}

/** Bật lại mọi luật đã bị tắt vì chậm (gọi cùng lúc với xoá cache luật). */
export function resetSlowModerationRules(): void {
  disabledUntil.clear()
  truncationLoggedUntil.clear()
}

/** Luật này có đang bị tắt vì chậm không. */
export function isModerationRuleDisabled(pattern: string): boolean {
  const until = disabledUntil.get(pattern)
  if (until === undefined) return false
  if (until > timing.now()) return true
  disabledUntil.delete(pattern)
  return false
}

/**
 * Khớp từng luật (đã qua `compileModerationRegex`) trên `text` có giới hạn cứng — xem "Lớp 2" ở
 * đầu tệp — trong MỘT lượt `vm` cho cả danh sách. Trả kết quả theo đúng thứ tự `rules`: `false`
 * cho luật đang bị tắt, bị ngắt, bị cắt quét, hay không tới lượt. `stopAtFirstMatch`: dừng ở
 * luật đầu tiên khớp (luật sau nó không chạy) — cho nơi gọi chỉ cần luật khớp đầu tiên.
 */
export function testModerationRegexes(
  rules: readonly ModerationRegexRule[],
  text: string,
  options: { stopAtFirstMatch?: boolean } = {},
): boolean[] {
  const scans: RuleScan[] = rules.map(rule => ({ start: null, outcome: null, skip: isModerationRuleDisabled(rule.pattern) }))
  if (scans.every(state => state.skip)) return scans.map(() => false)
  const job: ScanJob = {
    rules,
    text,
    scans,
    stopAtFirstMatch: options.stopAtFirstMatch === true,
    next: { rule: 0, from: 0 },
    at: { rule: 0, from: 0, startedAt: null, first: true },
    firstStep: true,
    slowPatterns: new Set(),
  }
  let results: boolean[] = []
  try {
    runScan(job)
  } finally {
    // Cả khi một lượt khớp ném lỗi: luật đã quét xong vẫn bị tắt/ghi log như trước.
    results = rules.map((rule, index) => settle(rule, scans[index]!, text.length))
  }
  return results
}

/** Một luật trên một văn bản — `testModerationRegexes` với danh sách một phần tử. */
export function testModerationRegex(pattern: string, regex: RegExp, text: string): boolean {
  return testModerationRegexes([{ pattern, regex }], text)[0]!
}
