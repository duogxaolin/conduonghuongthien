/**
 * Chốt chặn theo nguồn cho LẦN ĐẦU của một khoá báo cáo CSP (`server/api/csp-report.post.ts`;
 * luật `CSP_REPORT_RATE_RULE`, bảng dùng chung `rate_limit_counters` — sống qua khởi động
 * lại). Giới hạn thường ngày là ngân sách theo mạng trong `csp-report-log.ts`; đây là tầng
 * thứ hai.
 *
 * Nguồn đã bị từ chối được nhớ trong tiến trình tới hết `retryAfterSeconds` của nó: một nguồn
 * liên tục chế khoá mới chỉ tốn một lượt CSDL cho tới khi hết hạn, rồi được hỏi lại (không
 * bị câm mãi). Hàm ghi (`record`) và đồng hồ được truyền vào, nên kiểm được không cần CSDL.
 */

export type CspLimiterVerdict = { blocked: boolean, retryAfterSeconds: number }

export class CspSourceLimiter {
  readonly #record: (source: string) => Promise<CspLimiterVerdict>
  readonly #now: () => number
  readonly #maxSources: number
  readonly #refusedUntil = new Map<string, number>()

  constructor(options: { record: (source: string) => Promise<CspLimiterVerdict>, now?: () => number, maxSources?: number }) {
    this.#record = options.record
    this.#now = options.now ?? Date.now
    this.#maxSources = options.maxSources ?? 10_000
  }

  async allow(source: string): Promise<boolean> {
    const until = this.#refusedUntil.get(source)
    if (until !== undefined) {
      if (until > this.#now()) return false
      this.#refusedUntil.delete(source)
    }
    const verdict = await this.#record(source)
    if (!verdict.blocked) return true
    this.#refusedUntil.set(source, this.#now() + verdict.retryAfterSeconds * 1000)
    if (this.#refusedUntil.size > this.#maxSources) {
      const oldest = this.#refusedUntil.keys().next().value
      if (oldest !== undefined) this.#refusedUntil.delete(oldest)
    }
    return false
  }
}
