/**
 * Gộp báo cáo vi phạm CSP trong bộ nhớ rồi mới ghi log (`server/api/csp-report.post.ts`;
 * openspec `wave3-long-term`, design D-CSP giai đoạn 1).
 *
 * Vì sao: ở giai đoạn 1 mọi lượt xem trang sinh vài báo cáo (script inline của Nuxt,
 * importmap, failsafe, mã theo dõi — mỗi cái một khoá nhờ `'report-sample'`). Một dòng cho
 * mỗi báo cáo thì log tăng theo lượt xem; máy lùi về json-file (3 × 10 MB) mất log khác
 * đúng trong hai tuần cần quan sát.
 *
 * Khoá = chỉ thị + nguồn bị chặn + disposition + nhóm đường dẫn + tiền tố mẫu
 * (`cspAggregateKey`). Quy tắc:
 *  - `first`: MỘT dòng, NGAY, cho mỗi khoá CHƯA TỪNG THẤY kể từ khi tiến trình chạy, với đủ
 *    danh tính (chỉ thị, nguồn bị chặn, đường dẫn, nhóm, tiền tố mẫu). Tập "đã thấy" giữ
 *    `CSP_REPORT_SEEN_KEYS` khoá, khoá ít được báo nhất bị quên trước (mỗi báo cáo làm mới
 *    khoá của nó); khoá bị quên chỉ log `first` lại một lần.
 *  - `repeats`: hết mỗi cửa sổ (1 giờ, hẹn giờ `unref`; cũng xả ở hook `close` của Nitro —
 *    `server/plugins/csp-report-flush.ts`), một dòng cho mỗi khoá có báo cáo chưa nằm trong
 *    dòng `first`, với `count`, một đường dẫn mẫu và `sources` (số nguồn /64 khác nhau, trần
 *    `CSP_REPORT_SOURCES_PER_KEY` — "50" đọc là "50 trở lên").
 *  - Ngân sách khoá mới theo MẠNG (IPv4 /24, IPv6 /48 — `ipNetworkBucket`):
 *    `CSP_REPORT_NEW_KEYS_PER_NETWORK` mỗi cửa sổ. Quá ngân sách → chỉ đếm (`budget`).
 *  - Bản đồ đếm chính `CSP_REPORT_MAX_KEYS` khoá mỗi cửa sổ; khoá ĐÃ BIẾT chiếm tối đa
 *    `CSP_REPORT_KNOWN_KEYS_MAX` (phần còn lại để dành cho khoá chưa từng thấy). Báo cáo không
 *    vào được bản đồ chính được ĐẾM vào khoá THÔ (chỉ thị + nguồn bị chặn + disposition,
 *    `pathGroup: "*"`) trong bản đồ phụ `CSP_REPORT_COARSE_KEYS`; phụ cũng đầy → `overflow`.
 *    Bản đồ phụ chỉ ĐẾM — danh tính không bao giờ phụ thuộc vào nó.
 *  - Bản đồ chính đầy mà một khoá chưa từng thấy được nhận (còn ngân sách): nó VẪN có dòng
 *    `first` với đủ danh tính, chỉ phần đếm đi vào khoá thô. Những dòng "first khi đầy" này có
 *    trần riêng `CSP_REPORT_FIRSTS_WHILE_FULL` mỗi cửa sổ; quá trần → báo cáo chỉ được đếm
 *    vào khoá thô và `collapsed` tăng (theo BÁO CÁO) — mất danh tính luôn LỘ RA.
 *  - Một dòng `csp_report.dropped` cuối cửa sổ: `overflow`, `budget`, `limited` (chốt chặn
 *    CSDL theo nguồn từ chối), `failed` (lỗi bất ngờ giữa lô), `collapsed` — chỉ số đếm.
 *
 * Bảo đảm (đúng như mã; `tests/csp-report-aggregate.test.ts` kiểm từng vế):
 *  - SỐ ĐẾM không bao giờ mất: tổng `count` của các dòng `first`/`repeats` + `overflow` +
 *    `budget` + `limited` + `failed` = số báo cáo nhận được. (`collapsed` không cộng thêm: nó
 *    đếm những BÁO CÁO của khoá chưa từng thấy bị gộp không có dòng `first`, đã nằm trong
 *    một dòng `repeats` thô hay trong `overflow`.)
 *  - DANH TÍNH: một khoá chưa từng thấy có dòng `first` với đủ danh tính, trừ khi (a) mạng
 *    của nó đã dùng hết ngân sách trong giờ (`budget`), (b) chốt chặn theo nguồn /64 từ chối
 *    (`limited`), hoặc (c) bản đồ chính đã đầy VÀ `CSP_REPORT_FIRSTS_WHILE_FULL` dòng "first
 *    khi đầy" của giờ đó đã dùng hết (`collapsed`). Vì khoá đã biết chiếm tối đa 400 chỗ, (c)
 *    chỉ xảy ra sau ≥ 200 dòng `first` của khoá chưa từng thấy trong CÙNG giờ (≥ 100 để lấp
 *    bản đồ chính + 100 khi đầy) — tức ≥ 10 mạng /24 hay /48 khác nhau tiêu ngân sách, dù kẻ
 *    tấn công đã nuôi sẵn bao nhiêu khoá rác "đã biết". Ở cả ba trường hợp danh tính bị HOÃN
 *    chứ không mất hẳn: khoá không vào tập "đã thấy", nên nếu còn xuất hiện ở giờ sau (ngân
 *    sách, trần làm mới) nó có dòng `first` khi đó.
 *  - Log có trần: ≤ 600 dòng `first`, ≤ 600 dòng `repeats`, 1 dòng `dropped` mỗi giờ.
 *
 * Khoá rác nuôi sẵn rồi gửi lại mỗi giờ vẫn "đã biết" mãi (mỗi báo cáo làm mới nó): không
 * phân biệt được với lưu lượng thật nếu không đếm mạng của từng khoá, và luật như thế làm hỏng
 * số đếm của khoá thật chỉ từ một mạng. Bảo đảm trên không dựa vào chuyện đó: khoá đã biết ≤ 400
 * chỗ, mất danh tính có trần riêng và bộ đếm `collapsed`.
 *
 * Bộ nhớ trong tiến trình là đủ: compose ghim ĐÚNG MỘT bản sao app (`container_name:
 * cdkt_app`). Khởi động lại quên tập "đã thấy" (mỗi khoá hoạt động log `first` lại một lần mỗi
 * lượt deploy) và số đếm của cửa sổ đang mở nếu tiến trình không tắt êm.
 */
import { createHash } from 'node:crypto'
import { logInfo, logWarn, SECURITY_EVENTS, type LogFields } from './logger'
import { cspAggregateKey, cspCoarseEntry, type CspLogEntry } from './csp-report'

/**
 * Độ dài một cửa sổ — chỉ quyết định nhịp dòng tổng kết (lần đầu luôn ghi ngay): ~24 dòng/
 * khoá/ngày, 100 khoá hoạt động vẫn vừa 14 ngày trong 30 MB json-file.
 */
export const CSP_REPORT_SUMMARY_WINDOW_SECONDS = 3600
/** Khoá tối đa của bản đồ đếm chính trong một cửa sổ. */
export const CSP_REPORT_MAX_KEYS = 500
/** Khoá ĐÃ BIẾT được chiếm tối đa chừng này chỗ của bản đồ chính (100 chỗ để dành cho khoá mới). */
export const CSP_REPORT_KNOWN_KEYS_MAX = 400
/** Khoá thô tối đa (bản đồ phụ, chỉ để đếm khi bản đồ chính không còn chỗ). */
export const CSP_REPORT_COARSE_KEYS = 100
/** Dòng `first` tối đa mỗi cửa sổ cho khoá chưa từng thấy đến khi bản đồ chính đã đầy. */
export const CSP_REPORT_FIRSTS_WHILE_FULL = 100
/** Tập "đã thấy" (khoá đã có dòng `first`) — giữ qua các cửa sổ, ít được báo nhất bị quên trước. */
export const CSP_REPORT_SEEN_KEYS = 5000
/** Khoá mới tối đa mỗi mạng (/24, /48) mỗi cửa sổ. */
export const CSP_REPORT_NEW_KEYS_PER_NETWORK = 20
/** Trần của `sources` trong dòng `repeats`. */
export const CSP_REPORT_SOURCES_PER_KEY = 50

const NETWORKS_TRACKED_MAX = 10_000

export type CspLogEmit = (level: 'info' | 'warn', fields: LogFields) => void

/** Nơi gửi: nguồn (`ipBucket`, /64) để đếm nguồn khác nhau; mạng (`ipNetworkBucket`) cho ngân sách. */
export type CspReportOrigin = { source: string, network: string }

export type CspPending = { key: string, entry: CspLogEntry }

export type CspClassification =
  | { outcome: 'counted' }
  | { outcome: 'dropped' }
  | { outcome: 'new', pending: CspPending }

export type CspAggregatorLimits = {
  windowMs: number
  maxKeys: number
  knownKeysMax: number
  coarseKeys: number
  firstsWhileFull: number
  seenKeys: number
  newKeysPerNetwork: number
  sourcesPerKey: number
}

const DEFAULT_LIMITS: CspAggregatorLimits = {
  windowMs: CSP_REPORT_SUMMARY_WINDOW_SECONDS * 1000,
  maxKeys: CSP_REPORT_MAX_KEYS,
  knownKeysMax: CSP_REPORT_KNOWN_KEYS_MAX,
  coarseKeys: CSP_REPORT_COARSE_KEYS,
  firstsWhileFull: CSP_REPORT_FIRSTS_WHILE_FULL,
  seenKeys: CSP_REPORT_SEEN_KEYS,
  newKeysPerNetwork: CSP_REPORT_NEW_KEYS_PER_NETWORK,
  sourcesPerKey: CSP_REPORT_SOURCES_PER_KEY,
}

/** `logged` = số báo cáo của bucket đã nằm trong dòng `first` (dòng `repeats` ghi phần còn lại). */
type Bucket = { entry: CspLogEntry, count: number, logged: number, lastPath: string, sources: Set<string> }

const defaultEmit: CspLogEmit = (level, fields) => {
  if (level === 'warn') logWarn(fields)
  else logInfo(fields)
}

/** Trình duyệt đã THẬT SỰ chặn (`enforce`) là cảnh báo; báo cáo Report-Only thì không. */
const levelOf = (entry: CspLogEntry): 'info' | 'warn' => (entry.disposition === 'enforce' ? 'warn' : 'info')

/** Nguồn được giữ dưới dạng 8 hex của SHA-256 — chỉ để đếm, không bao giờ ghi ra. */
const sourceTag = (source: string) => createHash('sha256').update(source, 'utf8').digest('hex').slice(0, 8)

export class CspViolationAggregator {
  readonly #limits: CspAggregatorLimits
  readonly #now: () => number
  readonly #emit: CspLogEmit
  readonly #main = new Map<string, Bucket>()
  readonly #coarse = new Map<string, Bucket>()
  readonly #seen = new Map<string, true>()
  readonly #budgets = new Map<string, number>()
  #firstsWhileFull = 0
  #overflow = 0
  #budget = 0
  #limited = 0
  #failed = 0
  #collapsed = 0
  #windowStartedAt: number | null = null
  #timer: ReturnType<typeof setTimeout> | null = null

  constructor(options: Partial<CspAggregatorLimits> & { now?: () => number, emit?: CspLogEmit } = {}) {
    const { now, emit, ...limits } = options
    this.#limits = { ...DEFAULT_LIMITS, ...limits }
    this.#now = now ?? Date.now
    this.#emit = emit ?? defaultEmit
  }

  /** Hẹn giờ xả của cửa sổ đang mở (`null` khi không có cửa sổ nào). */
  get flushTimer(): ReturnType<typeof setTimeout> | null {
    return this.#timer
  }

  /**
   * Phân loại một báo cáo, chỉ trong bộ nhớ (không I/O): `counted` (đã đếm — xong),
   * `dropped` (đã đếm vào `overflow`/`budget` — xong), `new` (khoá chưa từng thấy, còn ngân
   * sách và còn đường có dòng `first`: nơi gọi hỏi chốt chặn theo nguồn rồi gọi `logFirst`
   * hoặc `countLimited`; khoá chưa được ghi).
   */
  classify(entry: CspLogEntry, origin: CspReportOrigin): CspClassification {
    this.#openWindow()
    const key = cspAggregateKey(entry)
    const inMain = this.#main.get(key)
    if (inMain) {
      this.#remember(key)
      return this.#count(inMain, entry, origin)
    }
    if (this.#seen.has(key)) return this.#countKnown(key, entry, origin)
    if (this.#overBudget(origin.network)) {
      this.#budget += 1
      return { outcome: 'dropped' }
    }
    if (this.#main.size >= this.#limits.maxKeys && this.#firstsWhileFull >= this.#limits.firstsWhileFull) {
      // Không còn đường nào cho một dòng `first`: không hỏi CSDL, gộp và để lộ ra.
      this.#collapsed += 1
      return this.#countCoarse(entry, origin, false)
    }
    return { outcome: 'new', pending: { key, entry } }
  }

  /**
   * Ghi và log NGAY lần đầu của một khoá, đủ danh tính. Còn chỗ trong bản đồ chính → đếm ở đó;
   * đã đầy (kể cả khi chỗ cuối vừa bị yêu cầu song song lấy) → vẫn log, phần đếm vào khoá thô,
   * trong trần "first khi đầy". `false` khi yêu cầu song song đã ghi khoá này, ngân sách vừa hết,
   * hoặc trần vừa hết (`collapsed`) — không hai dòng `first` cho một khoá, không vượt ngân sách.
   */
  logFirst(pending: CspPending, origin: CspReportOrigin): boolean {
    this.#openWindow()
    const inMain = this.#main.get(pending.key)
    if (inMain) {
      this.#count(inMain, pending.entry, origin)
      return false
    }
    if (this.#seen.has(pending.key)) {
      this.#countKnown(pending.key, pending.entry, origin)
      return false
    }
    // Kiểm lại: các yêu cầu song song cùng chờ CSDL đều đã qua `classify` trước khi ai tiêu.
    if (this.#overBudget(origin.network)) {
      this.#budget += 1
      return false
    }
    if (this.#main.size < this.#limits.maxKeys) {
      this.#main.set(pending.key, this.#bucket(pending.entry, origin, 1))
    } else if (this.#firstsWhileFull < this.#limits.firstsWhileFull) {
      this.#firstsWhileFull += 1
      this.#countCoarse(pending.entry, origin, true)
    } else {
      this.#collapsed += 1
      this.#countCoarse(pending.entry, origin, false)
      return false
    }
    this.#spendBudget(origin.network)
    this.#remember(pending.key)
    this.#emit(levelOf(pending.entry), { event: SECURITY_EVENTS.cspViolation, kind: 'first', ...pending.entry, count: 1 })
    return true
  }

  /** Một lần đầu bị chốt chặn theo nguồn (CSDL) từ chối: chỉ đếm. */
  countLimited(): void {
    this.#openWindow()
    this.#limited += 1
  }

  /** Báo cáo không xử lý được vì một lỗi bất ngờ (báo cáo đang xử lý và phần còn lại của lô). */
  countFailed(reports: number): void {
    if (reports <= 0) return
    this.#openWindow()
    this.#failed += reports
  }

  /** Kết thúc cửa sổ: một dòng cho mỗi khoá có báo cáo chưa được ghi, một dòng cho phần bị bỏ. */
  flush(): void {
    const windowSeconds = this.#limits.windowMs / 1000
    for (const bucket of [...this.#main.values(), ...this.#coarse.values()]) {
      const repeats = bucket.count - bucket.logged
      if (repeats <= 0) continue
      this.#emit(levelOf(bucket.entry), {
        event: SECURITY_EVENTS.cspViolation,
        kind: 'repeats',
        ...bucket.entry,
        path: bucket.lastPath,
        count: repeats,
        sources: bucket.sources.size,
        windowSeconds,
      })
    }
    if (this.#overflow + this.#budget + this.#limited + this.#failed + this.#collapsed > 0) {
      this.#emit(this.#overflow > 0 || this.#collapsed > 0 ? 'warn' : 'info', {
        event: 'csp_report.dropped',
        overflow: this.#overflow,
        budget: this.#budget,
        limited: this.#limited,
        failed: this.#failed,
        collapsed: this.#collapsed,
        windowSeconds,
      })
    }
    this.#clearWindow()
  }

  /** Huỷ hẹn giờ (không xả). */
  stop(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
  }

  /**
   * CHỈ DÀNH CHO TEST: bỏ mọi trạng thái (cửa sổ, tập "đã thấy", ngân sách) mà không ghi
   * gì. Mã chạy thật không bao giờ gọi — `tests/csp-report-aggregate.test.ts` chặn mọi lời
   * gọi trong `server/`.
   */
  reset(): void {
    this.#seen.clear()
    this.#clearWindow()
  }

  #clearWindow(): void {
    this.#main.clear()
    this.#coarse.clear()
    this.#budgets.clear()
    this.#firstsWhileFull = 0
    this.#overflow = 0
    this.#budget = 0
    this.#limited = 0
    this.#failed = 0
    this.#collapsed = 0
    this.#windowStartedAt = null
    this.stop()
  }

  #bucket(entry: CspLogEntry, origin: CspReportOrigin, logged: number): Bucket {
    return { entry, count: 1, logged, lastPath: entry.path, sources: new Set([sourceTag(origin.source)]) }
  }

  #count(bucket: Bucket, entry: CspLogEntry, origin: CspReportOrigin): CspClassification {
    bucket.count += 1
    bucket.lastPath = entry.path
    if (bucket.sources.size < this.#limits.sourcesPerKey) bucket.sources.add(sourceTag(origin.source))
    return { outcome: 'counted' }
  }

  /** Khoá đã biết, chưa vào cửa sổ này: bản đồ chính nếu còn phần của khoá đã biết, không thì khoá thô. */
  #countKnown(key: string, entry: CspLogEntry, origin: CspReportOrigin): CspClassification {
    this.#remember(key)
    if (this.#main.size < this.#limits.knownKeysMax) {
      this.#main.set(key, this.#bucket(entry, origin, 0))
      return { outcome: 'counted' }
    }
    return this.#countCoarse(entry, origin, false)
  }

  /**
   * Đếm vào khoá thô. `logged` = báo cáo này đã có dòng `first` (khi đầy): nó vẫn được đếm ở
   * đây (dòng `repeats` thô trừ nó ra), và nếu bản đồ phụ cũng đầy thì KHÔNG vào `overflow`
   * — dòng `first` đã ghi nó.
   */
  #countCoarse(entry: CspLogEntry, origin: CspReportOrigin, logged: boolean): CspClassification {
    const coarseEntry = cspCoarseEntry(entry)
    const key = cspAggregateKey(coarseEntry)
    const bucket = this.#coarse.get(key)
    if (bucket) {
      this.#count(bucket, entry, origin)
      if (logged) bucket.logged += 1
      return { outcome: 'counted' }
    }
    if (this.#coarse.size < this.#limits.coarseKeys) {
      this.#coarse.set(key, { ...this.#bucket(coarseEntry, origin, logged ? 1 : 0), lastPath: entry.path })
      return { outcome: 'counted' }
    }
    if (logged) return { outcome: 'counted' }
    this.#overflow += 1
    return { outcome: 'dropped' }
  }

  #overBudget(network: string): boolean {
    return (this.#budgets.get(network) ?? 0) >= this.#limits.newKeysPerNetwork
  }

  #spendBudget(network: string): void {
    const spent = (this.#budgets.get(network) ?? 0) + 1
    this.#budgets.delete(network)
    this.#budgets.set(network, spent)
    if (this.#budgets.size > NETWORKS_TRACKED_MAX) {
      const oldest = this.#budgets.keys().next().value
      if (oldest !== undefined) this.#budgets.delete(oldest)
    }
  }

  /** Ghi (hay làm mới) một khoá vào tập "đã thấy"; vượt trần thì quên khoá lâu không được báo nhất. */
  #remember(key: string): void {
    this.#seen.delete(key)
    this.#seen.set(key, true)
    if (this.#seen.size > this.#limits.seenKeys) {
      const oldest = this.#seen.keys().next().value
      if (oldest !== undefined) this.#seen.delete(oldest)
    }
  }

  /**
   * Mở cửa sổ ở báo cáo đầu tiên sau lần xả trước. Cửa sổ đã quá hạn (hẹn giờ trễ, hay đồng
   * hồ lùi) thì xả trước — một báo cáo không bao giờ bị cộng vào cửa sổ đã hết.
   */
  #openWindow(): void {
    const now = this.#now()
    const started = this.#windowStartedAt
    if (started !== null && (now < started || now - started >= this.#limits.windowMs)) this.flush()
    if (this.#windowStartedAt !== null) return
    this.#windowStartedAt = now
    this.#timer = setTimeout(() => this.flush(), this.#limits.windowMs)
    this.#timer.unref()
  }
}

/** Bộ gộp của tiến trình. */
export const cspViolationLog = new CspViolationAggregator()

let hostsUnconfiguredNoticed = false

/**
 * Chưa khai host nào của cổng (`PUBLIC_BASE_URL`, `PUBLIC_HOST_ALLOWLIST`, và request không
 * qua proxy đã khai): không phân biệt được trang của cổng với trang lạ, nên mọi báo cáo được
 * tính là của cổng. Nói điều đó MỘT lần mỗi tiến trình.
 */
export function noteCspHostsUnconfigured(): void {
  if (hostsUnconfiguredNoticed) return
  hostsUnconfiguredNoticed = true
  logWarn({
    event: 'csp_report.hosts_unconfigured',
    consequence: 'every CSP report is attributed to the portal; set PUBLIC_BASE_URL or PUBLIC_HOST_ALLOWLIST to tell foreign pages apart',
  })
}
