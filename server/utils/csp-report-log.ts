/**
 * Gộp báo cáo vi phạm CSP trong bộ nhớ rồi mới ghi log (`server/api/csp-report.post.ts`;
 * openspec `wave3-long-term`, design D-CSP giai đoạn 1).
 *
 * Vì sao: ở giai đoạn 1 MỌI lượt xem trang sinh vài báo cáo giống hệt nhau (script inline
 * của Nuxt, failsafe, mã theo dõi). Một dòng log + ba câu SQL cho mỗi báo cáo thì log tăng
 * theo lượt xem — máy lùi về json-file (3 × 10 MB) mất hết log khác sau vài nghìn lượt xem
 * mỗi ngày, đúng trong hai tuần cần quan sát. Nay:
 *  - khoá gộp = chỉ thị + nguồn bị chặn + disposition + nhóm đường dẫn + tiền tố mẫu
 *    (`cspAggregateKey`, `csp-report.ts`);
 *  - LẦN ĐẦU của một khoá trong cửa sổ: log NGAY một dòng `kind: "first"` (`count: 1`) —
 *    một vi phạm mới hay lạ không bao giờ bị mất hay bị chậm. Chỉ lượt này mới hỏi bộ giới
 *    hạn theo nguồn (CSDL) — nơi gọi quyết định, lớp này không làm I/O;
 *  - LẶP LẠI: chỉ cộng đếm trong bộ nhớ — không log, không CSDL;
 *  - hết cửa sổ (10 phút, hẹn giờ `unref` — không giữ tiến trình sống; cũng xả ở hook
 *    `close` của Nitro, `server/plugins/csp-report-flush.ts`): mỗi khoá có lặp lại một dòng
 *    `kind: "repeats"` với `count` và một đường dẫn mẫu (lần cuối thấy), rồi bản đồ về rỗng.
 *    Tổng `count` của mọi dòng = số báo cáo đã nhận;
 *  - bản đồ có trần `CSP_REPORT_MAX_KEYS` khoá: khoá mới khi đã đầy chỉ được đếm
 *    (`overflow`), cùng số lần-đầu bị bộ giới hạn theo nguồn từ chối (`limited`), trong MỘT
 *    dòng `csp_report.dropped` cuối cửa sổ.
 * Log mỗi cửa sổ vì thế có trần: ≤ 2 × `CSP_REPORT_MAX_KEYS` + 1 dòng, bất kể lưu lượng.
 *
 * Bộ nhớ trong tiến trình là đủ: `docker-compose.yml` ghim ĐÚNG MỘT bản sao app
 * (`container_name: cdkt_app` — hai bản sao thì mỗi bản gộp riêng, vẫn đúng, chỉ gấp đôi
 * số dòng). Khởi động lại mất phần đếm của cửa sổ đang mở — chấp nhận: đây là quan sát, không
 * phải sổ sách.
 */
import { logInfo, logWarn, SECURITY_EVENTS, type LogFields } from './logger'
import { cspAggregateKey, type CspLogEntry } from './csp-report'

/** Độ dài một cửa sổ gộp. */
export const CSP_REPORT_SUMMARY_WINDOW_SECONDS = 600

/** Số khoá tối đa trong một cửa sổ. Lưu lượng thật dùng vài chục; vượt trần là bị dội. */
export const CSP_REPORT_MAX_KEYS = 500

export type CspLogEmit = (level: 'info' | 'warn', fields: LogFields) => void

type Bucket = { entry: CspLogEntry, repeats: number, lastPath: string }

const defaultEmit: CspLogEmit = (level, fields) => {
  if (level === 'warn') logWarn(fields)
  else logInfo(fields)
}

/** Trình duyệt đã THẬT SỰ chặn (`enforce`) là cảnh báo; báo cáo Report-Only thì không. */
const levelOf = (entry: CspLogEntry): 'info' | 'warn' => (entry.disposition === 'enforce' ? 'warn' : 'info')

export class CspViolationAggregator {
  readonly #windowMs: number
  readonly #maxKeys: number
  readonly #now: () => number
  readonly #emit: CspLogEmit
  readonly #buckets = new Map<string, Bucket>()
  #overflow = 0
  #limited = 0
  #windowStartedAt: number | null = null
  #timer: ReturnType<typeof setTimeout> | null = null

  constructor(options: { windowMs: number, maxKeys: number, now?: () => number, emit?: CspLogEmit }) {
    this.#windowMs = options.windowMs
    this.#maxKeys = options.maxKeys
    this.#now = options.now ?? Date.now
    this.#emit = options.emit ?? defaultEmit
  }

  /** Hẹn giờ xả của cửa sổ đang mở (`null` khi không có cửa sổ nào). */
  get flushTimer(): ReturnType<typeof setTimeout> | null {
    return this.#timer
  }

  /**
   * Phân loại một báo cáo, chỉ trong bộ nhớ: `repeat` (đã đếm — xong), `overflow` (bản đồ
   * đầy, đã đếm — xong), `new` (nơi gọi hỏi bộ giới hạn theo nguồn rồi gọi `logFirst` hoặc
   * `countLimited`). Khoá `new` CHƯA được ghi vào bản đồ.
   */
  observe(entry: CspLogEntry): 'repeat' | 'new' | 'overflow' {
    this.#openWindow()
    const bucket = this.#buckets.get(cspAggregateKey(entry))
    if (bucket) {
      bucket.repeats += 1
      bucket.lastPath = entry.path
      return 'repeat'
    }
    if (this.#buckets.size >= this.#maxKeys) {
      this.#overflow += 1
      return 'overflow'
    }
    return 'new'
  }

  /**
   * Ghi lần-đầu-thấy của một khoá và log nó ngay. `false` khi một yêu cầu chạy song song
   * đã ghi khoá này trong lúc nơi gọi chờ bộ giới hạn (lượt này thành một lần lặp) hoặc
   * bản đồ vừa đầy (`overflow`) — không bao giờ log hai dòng "first" cho một khoá.
   */
  logFirst(entry: CspLogEntry): boolean {
    this.#openWindow()
    const key = cspAggregateKey(entry)
    const bucket = this.#buckets.get(key)
    if (bucket) {
      bucket.repeats += 1
      bucket.lastPath = entry.path
      return false
    }
    if (this.#buckets.size >= this.#maxKeys) {
      this.#overflow += 1
      return false
    }
    this.#buckets.set(key, { entry, repeats: 0, lastPath: entry.path })
    this.#emit(levelOf(entry), { event: SECURITY_EVENTS.cspViolation, kind: 'first', ...entry, count: 1 })
    return true
  }

  /** Một lần-đầu bị bộ giới hạn theo nguồn từ chối: chỉ đếm. */
  countLimited(): void {
    this.#openWindow()
    this.#limited += 1
  }

  /** Kết thúc cửa sổ: một dòng cho mỗi khoá có lặp lại, một dòng cho phần bị bỏ, rồi về rỗng. */
  flush(): void {
    const windowSeconds = this.#windowMs / 1000
    for (const { entry, repeats, lastPath } of this.#buckets.values()) {
      if (repeats === 0) continue
      this.#emit(levelOf(entry), { event: SECURITY_EVENTS.cspViolation, kind: 'repeats', ...entry, path: lastPath, count: repeats, windowSeconds })
    }
    if (this.#overflow > 0 || this.#limited > 0) {
      this.#emit(this.#overflow > 0 ? 'warn' : 'info', { event: 'csp_report.dropped', overflow: this.#overflow, limited: this.#limited, windowSeconds })
    }
    this.#buckets.clear()
    this.#overflow = 0
    this.#limited = 0
    this.#windowStartedAt = null
    this.stop()
  }

  /** Huỷ hẹn giờ (không xả). */
  stop(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
  }

  /**
   * Mở cửa sổ ở báo cáo đầu tiên sau lần xả trước. Cửa sổ đã quá hạn (hẹn giờ trễ, hay đồng
   * hồ lùi) thì xả trước — một báo cáo không bao giờ bị cộng vào cửa sổ đã hết.
   */
  #openWindow(): void {
    const now = this.#now()
    const started = this.#windowStartedAt
    if (started !== null && (now < started || now - started >= this.#windowMs)) this.flush()
    if (this.#windowStartedAt !== null) return
    this.#windowStartedAt = now
    this.#timer = setTimeout(() => this.flush(), this.#windowMs)
    this.#timer.unref()
  }
}

/** Bộ gộp của tiến trình. */
export const cspViolationLog = new CspViolationAggregator({
  windowMs: CSP_REPORT_SUMMARY_WINDOW_SECONDS * 1000,
  maxKeys: CSP_REPORT_MAX_KEYS,
})

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
