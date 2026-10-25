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
 *  - Mỗi báo cáo hợp lệ đi qua bộ gộp trong bộ nhớ (`server/utils/csp-report-log.ts` — quy
 *    tắc và bảo đảm đầy đủ ở đó): khoá chưa từng thấy → một dòng `security.csp_violation`
 *    `kind: "first"` NGAY (một lần cho cả tiến trình); mọi báo cáo khác → chỉ đếm (không log,
 *    không CSDL); hết cửa sổ 1 giờ → một dòng `kind: "repeats"` mỗi khoá có báo cáo.
 *  - Khoá mới bị giới hạn hai tầng: ngân sách theo MẠNG trong bộ nhớ (20 khoá mới / mạng
 *    /24 hay /48 / giờ — giới hạn thường ngày, không tốn CSDL), rồi chốt chặn theo nguồn /64
 *    trên bảng dùng chung (`CSP_REPORTS_LOGGED_PER_WINDOW` = 60 / 60 giây — sống qua khởi
 *    động lại). Nguồn đã bị chốt chặn từ chối được nhớ tới hết hạn (`CspSourceLimiter`).
 *  - Một lỗi bất ngờ giữa lô: báo cáo đang xử lý và phần còn lại đếm vào `failed`.
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
import { CspSourceLimiter } from '../utils/csp-report-source-limiter'
import { ipBucket, ipNetworkBucket } from '../utils/ip-bucket'
import { logWarn } from '../utils/logger'
import { allowedOriginHosts, normalizeGateHost } from '../utils/origin-gate'
import { rateLimitDeps } from '../utils/rate-limit-deps'
import { recordRateLimitHit } from '../utils/rate-limit-store'

/** Chốt chặn theo nguồn /64 trên bảng dùng chung — chỉ được hỏi cho lần đầu của một khoá. */
const sourceLimiter = new CspSourceLimiter({
  record: source => recordRateLimitHit(`csp-report:${source}`, CSP_REPORT_RATE_RULE, rateLimitDeps()),
})

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

  let processed = 0
  try {
    const ip = getClientIp(event)
    const origin = { source: ipBucket(ip), network: ipNetworkBucket(ip) }
    const isOwnHost = ownHostCheck(event)
    for (const report of reports) {
      const result = cspViolationLog.classify(cspLogEntry(report, isOwnHost), origin)
      // `counted`/`dropped`: đã đếm trong bộ nhớ — xong, không CSDL.
      if (result.outcome === 'new') {
        if (await sourceLimiter.allow(origin.source)) cspViolationLog.logFirst(result.pending, origin)
        else cspViolationLog.countLimited()
      }
      processed += 1
    }
  } catch (error) {
    // Tổng phải khớp: báo cáo đang xử lý và phần còn lại của lô vào `failed`.
    cspViolationLog.countFailed(reports.length - processed)
    throw error
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
