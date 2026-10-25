/**
 * `POST /api/csp-report` — nơi trình duyệt gửi báo cáo vi phạm Content-Security-Policy
 * (`report-uri` của header Report-Only, `shared/csp-policy.ts`; openspec
 * `wave3-long-term`, design D-CSP giai đoạn 1, spec content-security-policy).
 *
 * Hợp đồng:
 *  - LUÔN 204, không thân — kể cả sai Content-Type, thân hỏng, quá cỡ, bị giới hạn hay
 *    lỗi bất ngờ. Không có gì ở đây được phép làm hỏng trang, và mã lỗi không cho người
 *    gửi biết thêm điều gì.
 *  - Không lưu gì vào CSDL ngoài bộ đếm giới hạn tần suất dùng chung (`rate_limit_counters`).
 *  - Mỗi báo cáo hợp lệ đi qua bộ gộp trong bộ nhớ (`server/utils/csp-report-log.ts`):
 *    khoá đã thấy trong cửa sổ → chỉ đếm (không log, không CSDL, không cả tra IP); khoá mới
 *    → hỏi bộ giới hạn theo nguồn rồi log NGAY một dòng `security.csp_violation`
 *    `kind: "first"`; hết cửa sổ 10 phút → một dòng `kind: "repeats"` mỗi khoá.
 *  - Giới hạn theo nguồn chỉ áp cho LẦN ĐẦU: `CSP_REPORTS_LOGGED_PER_WINDOW` (60) / 60 giây
 *    cho mỗi IP (IPv6 theo /64 — `ipBucket`), đếm theo báo cáo. Nguồn đã bị từ chối được nhớ
 *    trong tiến trình tới hết hạn của nó, nên một nguồn tự chế khoá mới liên tục chỉ tốn MỘT
 *    lượt CSDL mỗi cửa sổ.
 *  - Trang không thuộc cổng (host của `document-uri` ngoài tập host của cổng — cùng tập mà
 *    cổng chặn khác site dùng, `allowedOriginHosts`: `PUBLIC_BASE_URL`, `PUBLIC_HOST_ALLOWLIST`,
 *    host của request sau proxy đã khai) → `foreign:<host>`, không bao giờ như đường dẫn của
 *    cổng: bất kỳ trang nào cũng trỏ được `report-uri` về đây. Tập rỗng → mọi trang tính là
 *    của cổng, báo một lần (`csp_report.hosts_unconfigured`).
 *  - Thân đọc qua `readBoundedUploadBody` (trần theo byte thật, kể cả khi không có
 *    Content-Length) rồi `JSON.parse` trong try: `application/csp-report` không phải
 *    `+json` nên `readJsonBody` (`request-body.ts`) sẽ từ chối nó, và một 400 thì trái
 *    hợp đồng "luôn 204".
 *
 * Cổng chặn yêu cầu ghi khác site (`00.origin-gate.ts`) miễn ĐÚNG `POST` vào đường dẫn này
 * (lý do và phép so đường dẫn: `isOriginGateExempt` trong `server/utils/origin-gate.ts`).
 * Không đọc cookie hay phiên. Không bị cache: `/api/**` là `cache: false`.
 */
import { defineEventHandler, getRequestHeader, sendNoContent, type H3Event } from 'h3'
import { readBoundedUploadBody } from '../utils/bounded-upload-body'
import { getClientIp } from '../utils/client-ip'
import { CSP_REPORT_MAX_BODY_BYTES, CSP_REPORT_RATE_RULE, cspLogEntry, cspReportFormat, parseCspReportBody } from '../utils/csp-report'
import { cspViolationLog, noteCspHostsUnconfigured } from '../utils/csp-report-log'
import { ipBucket } from '../utils/ip-bucket'
import { logWarn } from '../utils/logger'
import { allowedOriginHosts, normalizeGateHost } from '../utils/origin-gate'
import { rateLimitDeps } from '../utils/rate-limit-deps'
import { recordRateLimitHit } from '../utils/rate-limit-store'

/** Nguồn đã bị bộ giới hạn từ chối → mốc hết hạn (ms). Có trần; mục cũ nhất ra trước. */
const refusedSources = new Map<string, number>()
const REFUSED_SOURCES_MAX = 10_000

async function firstSightingAllowed(source: string): Promise<boolean> {
  const now = Date.now()
  const until = refusedSources.get(source)
  if (until !== undefined) {
    if (until > now) return false
    refusedSources.delete(source)
  }
  const state = await recordRateLimitHit(source, CSP_REPORT_RATE_RULE, rateLimitDeps())
  if (!state.blocked) return true
  refusedSources.set(source, now + state.retryAfterSeconds * 1000)
  if (refusedSources.size > REFUSED_SOURCES_MAX) {
    const oldest = refusedSources.keys().next().value
    if (oldest !== undefined) refusedSources.delete(oldest)
  }
  return false
}

/** "Host này có phải của cổng?" — `null` khi chưa khai host nào (mọi trang tính là của cổng). */
function ownHostCheck(event: H3Event): ((host: string) => boolean) | null {
  const hosts = allowedOriginHosts(event)
  if (hosts.size === 0) {
    noteCspHostsUnconfigured()
    return null
  }
  return host => hosts.has(normalizeGateHost(host))
}

async function receiveReports(event: H3Event): Promise<void> {
  const format = cspReportFormat(getRequestHeader(event, 'content-type'))
  if (!format) return

  let text: string
  try {
    text = (await readBoundedUploadBody(event, CSP_REPORT_MAX_BODY_BYTES)).toString('utf8')
  } catch {
    // Quá cỡ (khai báo hay thật) hoặc kết nối bị ngắt: không có gì để quan sát. Bộ đọc đã
    // dừng nhận và hẹn đóng kết nối sau phản hồi.
    return
  }

  const reports = parseCspReportBody(format, text)
  if (reports.length === 0) return

  const isOwnHost = ownHostCheck(event)
  let source: string | null = null
  for (const report of reports) {
    const entry = cspLogEntry(report, isOwnHost)
    // Lặp lại hay bản đồ đầy: đã đếm trong bộ nhớ — xong, không CSDL.
    if (cspViolationLog.observe(entry) !== 'new') continue
    source ??= `csp-report:${ipBucket(getClientIp(event))}`
    if (await firstSightingAllowed(source)) cspViolationLog.logFirst(entry)
    else cspViolationLog.countLimited()
  }
}

export default defineEventHandler(async (event) => {
  try {
    await receiveReports(event)
  } catch (error) {
    // Chỉ một lỗi lập trình tới được đây (bộ đếm và bộ đọc đã tự xử lý lỗi của chúng).
    // Ghi lại để thấy, nhưng trả lời vẫn như mọi lần.
    logWarn({ event: 'csp_report.failed', error })
  }
  return sendNoContent(event, 204)
})
