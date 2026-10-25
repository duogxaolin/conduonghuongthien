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
 *  - `first`: MỘT dòng cho mỗi khoá CHƯA TỪNG THẤY kể từ khi tiến trình chạy (tập "đã thấy"
 *    `CSP_REPORT_SEEN_KEYS` khoá, khoá ít dùng nhất bị quên trước — khoá bị quên chỉ log
 *    `first` lại một lần). Ghi NGAY: vi phạm mới không phải đợi.
 *  - `repeats`: hết mỗi cửa sổ (1 giờ, hẹn giờ `unref`; cũng xả ở hook `close` của Nitro —
 *    `server/plugins/csp-report-flush.ts`), mỗi khoá có báo cáo trong cửa sổ một dòng với
 *    `count` (báo cáo chưa nằm trong dòng `first`), đường dẫn mẫu (lần cuối thấy) và
 *    `sources` (số nguồn /64 khác nhau, trần `CSP_REPORT_SOURCES_PER_KEY` — "50" đọc là
 *    "50 trở lên": một nguồn tự bơm số đếm thì lộ ra ở đây). Tổng `count` của mọi dòng =
 *    số báo cáo được ghi nhận.
 *  - Ngân sách KHOÁ MỚI theo MẠNG (IPv4 /24, IPv6 /48 — `ipNetworkBucket`):
 *    `CSP_REPORT_NEW_KEYS_PER_NETWORK` mỗi cửa sổ. Quá ngân sách → chỉ đếm (`budget`),
 *    không bao giờ vào bản đồ. Một bên giữ cả một /48 (65 536 nguồn /64) vẫn chỉ có một
 *    ngân sách.
 *  - Bản đồ chính `CSP_REPORT_MAX_KEYS` khoá mỗi cửa sổ, trong đó khoá ĐÃ BIẾT chỉ được
 *    chiếm tối đa `CSP_REPORT_KNOWN_KEYS_MAX` — phần còn lại để dành cho khoá chưa từng
 *    thấy, để rác đã đúc ở cửa sổ trước không lấp lại bản đồ mỗi giờ. Đầy (theo loại khoá)
 *    → khoá THÔ (chỉ thị + nguồn bị chặn + disposition, nhóm `*`) trong bản đồ phụ
 *    `CSP_REPORT_COARSE_KEYS` (khoá đã biết tối đa `CSP_REPORT_COARSE_KNOWN_MAX`): một host
 *    bị chặn MỚI vẫn có dòng `first`. Bản đồ phụ cũng đầy → chỉ đếm (`overflow`).
 *  - Một dòng `csp_report.dropped` cuối cửa sổ: `overflow`, `budget`, `limited` (lần đầu bị
 *    bộ giới hạn CSDL theo nguồn từ chối), `failed` (lỗi bất ngờ giữa lô) — chỉ số đếm,
 *    không bao giờ IP.
 *
 * Bảo đảm: một vi phạm mới mất danh tính (chỉ còn là một số đếm) khi mạng của nó đã tiêu hết
 * ngân sách trong giờ đó, hoặc khi cả 100 chỗ dành riêng của bản đồ chính lẫn 20 chỗ dành
 * riêng của bản đồ phụ đã bị khoá mới chiếm — tức là ít nhất 6 mạng /24 hay /48 KHÁC NHAU
 * tiêu đủ ngân sách trong cùng một giờ. Log mỗi cửa sổ có trần: ≤ 600 dòng `first`, ≤ 600
 * dòng `repeats`, 1 dòng `dropped`.
 *
 * Bộ nhớ trong tiến trình là đủ: `docker-compose.yml` ghim ĐÚNG MỘT bản sao app
 * (`container_name: cdkt_app` — hai bản sao thì mỗi bản gộp riêng, vẫn đúng, chỉ gấp đôi
 * số dòng). Khởi động lại quên tập "đã thấy" (mỗi khoá đang hoạt động log `first` lại một
 * lần mỗi lượt deploy) và số đếm của cửa sổ đang mở nếu tiến trình không tắt êm.
 */
import { createHash } from 'node:crypto'
import { logInfo, logWarn, SECURITY_EVENTS, type LogFields } from './logger'
import { cspAggregateKey, cspCoarseEntry, type CspLogEntry } from './csp-report'

/**
 * Độ dài một cửa sổ. Lần đầu luôn ghi ngay, nên cửa sổ chỉ quyết định nhịp các dòng tổng
 * kết: 1 giờ là đủ mịn cho hai tuần quan sát, và giữ ~24 dòng/khoá/ngày — 100 khoá hoạt
 * động vẫn vừa 14 ngày trong 30 MB json-file.
 */
export const CSP_REPORT_SUMMARY_WINDOW_SECONDS = 3600
/** Khoá tối đa của bản đồ chính trong một cửa sổ. */
export const CSP_REPORT_MAX_KEYS = 500
/** Khoá ĐÃ BIẾT được chiếm tối đa chừng này chỗ của bản đồ chính (100 chỗ để dành cho khoá mới). */
export const CSP_REPORT_KNOWN_KEYS_MAX = 400
/** Khoá thô tối đa (bản đồ phụ, khi bản đồ chính đầy). */
export const CSP_REPORT_COARSE_KEYS = 100
/** Khoá thô ĐÃ BIẾT được chiếm tối đa chừng này chỗ (20 chỗ để dành cho host mới). */
export const CSP_REPORT_COARSE_KNOWN_MAX = 80
/**
 * Tập "đã thấy" (khoá đã có dòng `first`) — giữ qua các cửa sổ. Mỗi khoá mịn chiếm hai chỗ
 * (nó và khoá thô của nó), nên đây là ~2 500 khoá mịn — gấp nhiều lần số khoá hoạt động thật.
 */
export const CSP_REPORT_SEEN_KEYS = 5000
/** Khoá mới tối đa mỗi mạng (/24, /48) mỗi cửa sổ. */
export const CSP_REPORT_NEW_KEYS_PER_NETWORK = 20
/** Trần của `sources` trong dòng `repeats`. */
export const CSP_REPORT_SOURCES_PER_KEY = 50

const NETWORKS_TRACKED_MAX = 10_000
const COARSE_PREFIX = 'coarse|'

export type CspLogEmit = (level: 'info' | 'warn', fields: LogFields) => void

/** Nơi gửi: nguồn (`ipBucket`, /64) để đếm nguồn khác nhau; mạng (`ipNetworkBucket`) cho ngân sách. */
export type CspReportOrigin = { source: string, network: string }

export type CspPending = { key: string, entry: CspLogEntry, tier: 'main' | 'coarse' }

export type CspClassification =
  | { outcome: 'counted' }
  | { outcome: 'dropped' }
  | { outcome: 'new', pending: CspPending }

export type CspAggregatorLimits = {
  windowMs: number
  maxKeys: number
  knownKeysMax: number
  coarseKeys: number
  coarseKnownMax: number
  seenKeys: number
  newKeysPerNetwork: number
  sourcesPerKey: number
}

const DEFAULT_LIMITS: CspAggregatorLimits = {
  windowMs: CSP_REPORT_SUMMARY_WINDOW_SECONDS * 1000,
  maxKeys: CSP_REPORT_MAX_KEYS,
  knownKeysMax: CSP_REPORT_KNOWN_KEYS_MAX,
  coarseKeys: CSP_REPORT_COARSE_KEYS,
  coarseKnownMax: CSP_REPORT_COARSE_KNOWN_MAX,
  seenKeys: CSP_REPORT_SEEN_KEYS,
  newKeysPerNetwork: CSP_REPORT_NEW_KEYS_PER_NETWORK,
  sourcesPerKey: CSP_REPORT_SOURCES_PER_KEY,
}

type Bucket = { entry: CspLogEntry, count: number, loggedFirst: boolean, lastPath: string, sources: Set<string> }

const defaultEmit: CspLogEmit = (level, fields) => {
  if (level === 'warn') logWarn(fields)
  else logInfo(fields)
}

/** Trình duyệt đã THẬT SỰ chặn (`enforce`) là cảnh báo; báo cáo Report-Only thì không. */
const levelOf = (entry: CspLogEntry): 'info' | 'warn' => (entry.disposition === 'enforce' ? 'warn' : 'info')

/**
 * Khoá thô của một khoá mịn. Khi một khoá mịn đã có dòng `first`, khoá thô của nó cũng tính
 * là "đã thấy": host đó không còn mới, nên khi tràn sang bản đồ phụ nó chỉ được đếm (trong
 * phần dành cho khoá đã biết) và không chiếm chỗ dành cho host mới thật sự.
 */
const coarseKeyOf = (entry: CspLogEntry) => COARSE_PREFIX + cspAggregateKey(cspCoarseEntry(entry))

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
  #overflow = 0
  #budget = 0
  #limited = 0
  #failed = 0
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
   * `dropped` (đã đếm vào `overflow`/`budget` — xong), `new` (khoá chưa từng thấy, còn chỗ
   * và còn ngân sách: nơi gọi hỏi bộ giới hạn theo nguồn rồi gọi `logFirst` hoặc
   * `countLimited`; khoá chưa được ghi vào bản đồ).
   */
  classify(entry: CspLogEntry, origin: CspReportOrigin): CspClassification {
    this.#openWindow()
    const key = cspAggregateKey(entry)
    const inWindow = this.#main.get(key)
    if (inWindow) return this.#count(inWindow, entry, origin)
    const known = this.#seen.has(key)
    if (this.#main.size < (known ? this.#limits.knownKeysMax : this.#limits.maxKeys)) {
      return known ? this.#reenter(this.#main, key, entry, origin) : this.#candidate(key, entry, 'main', origin)
    }

    const coarseEntry = cspCoarseEntry(entry)
    const coarseKey = coarseKeyOf(entry)
    const coarseInWindow = this.#coarse.get(coarseKey)
    if (coarseInWindow) return this.#count(coarseInWindow, entry, origin)
    const coarseKnown = this.#seen.has(coarseKey)
    if (this.#coarse.size < (coarseKnown ? this.#limits.coarseKnownMax : this.#limits.coarseKeys)) {
      return coarseKnown ? this.#reenter(this.#coarse, coarseKey, coarseEntry, origin) : this.#candidate(coarseKey, coarseEntry, 'coarse', origin)
    }
    this.#overflow += 1
    return { outcome: 'dropped' }
  }

  /**
   * Ghi và log NGAY lần đầu của một khoá. `false` khi trong lúc nơi gọi chờ bộ giới hạn, một
   * yêu cầu song song đã ghi khoá này (lượt này thành một lần đếm), bản đồ vừa đầy, hoặc
   * ngân sách của mạng vừa hết — không bao giờ hai dòng `first` cho một khoá.
   */
  logFirst(pending: CspPending, origin: CspReportOrigin): boolean {
    this.#openWindow()
    const tier = pending.tier === 'main' ? this.#main : this.#coarse
    const existing = tier.get(pending.key)
    if (existing) {
      this.#count(existing, pending.entry, origin)
      return false
    }
    if (tier.size >= (pending.tier === 'main' ? this.#limits.maxKeys : this.#limits.coarseKeys)) {
      this.#overflow += 1
      return false
    }
    if (this.#seen.has(pending.key)) {
      this.#reenter(tier, pending.key, pending.entry, origin)
      return false
    }
    if ((this.#budgets.get(origin.network) ?? 0) >= this.#limits.newKeysPerNetwork) {
      this.#budget += 1
      return false
    }
    tier.set(pending.key, { entry: pending.entry, count: 1, loggedFirst: true, lastPath: pending.entry.path, sources: new Set([sourceTag(origin.source)]) })
    this.#spendBudget(origin.network)
    this.#remember(pending.key)
    if (pending.tier === 'main') this.#remember(coarseKeyOf(pending.entry))
    this.#emit(levelOf(pending.entry), { event: SECURITY_EVENTS.cspViolation, kind: 'first', ...pending.entry, count: 1 })
    return true
  }

  /** Một lần đầu bị bộ giới hạn theo nguồn (CSDL) từ chối: chỉ đếm. */
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
      const repeats = bucket.count - (bucket.loggedFirst ? 1 : 0)
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
    if (this.#overflow + this.#budget + this.#limited + this.#failed > 0) {
      this.#emit(this.#overflow > 0 ? 'warn' : 'info', {
        event: 'csp_report.dropped',
        overflow: this.#overflow,
        budget: this.#budget,
        limited: this.#limited,
        failed: this.#failed,
        windowSeconds,
      })
    }
    this.#main.clear()
    this.#coarse.clear()
    this.#budgets.clear()
    this.#overflow = 0
    this.#budget = 0
    this.#limited = 0
    this.#failed = 0
    this.#windowStartedAt = null
    this.stop()
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
    this.#main.clear()
    this.#coarse.clear()
    this.#budgets.clear()
    this.#overflow = 0
    this.#budget = 0
    this.#limited = 0
    this.#failed = 0
    this.#windowStartedAt = null
    this.stop()
  }

  #count(bucket: Bucket, entry: CspLogEntry, origin: CspReportOrigin): CspClassification {
    bucket.count += 1
    bucket.lastPath = entry.path
    if (bucket.sources.size < this.#limits.sourcesPerKey) bucket.sources.add(sourceTag(origin.source))
    return { outcome: 'counted' }
  }

  /** Một khoá đã biết vào cửa sổ này: đếm, không dòng `first`, làm mới vị trí trong tập "đã thấy". */
  #reenter(tier: Map<string, Bucket>, key: string, entry: CspLogEntry, origin: CspReportOrigin): CspClassification {
    tier.set(key, { entry, count: 1, loggedFirst: false, lastPath: entry.path, sources: new Set([sourceTag(origin.source)]) })
    this.#remember(key)
    if (tier === this.#main) this.#remember(coarseKeyOf(entry))
    return { outcome: 'counted' }
  }

  #candidate(key: string, entry: CspLogEntry, tier: 'main' | 'coarse', origin: CspReportOrigin): CspClassification {
    if ((this.#budgets.get(origin.network) ?? 0) >= this.#limits.newKeysPerNetwork) {
      this.#budget += 1
      return { outcome: 'dropped' }
    }
    return { outcome: 'new', pending: { key, entry, tier } }
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

  /** Ghi (hay làm mới) một khoá vào tập "đã thấy"; vượt trần thì quên khoá lâu không dùng nhất. */
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
