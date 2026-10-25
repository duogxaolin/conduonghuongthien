/**
 * `POST /api/csp-report` — nơi trình duyệt gửi báo cáo vi phạm Content-Security-Policy
 * (`report-uri` của header Report-Only, `shared/csp-policy.ts`; openspec
 * `wave3-long-term`, design D-CSP giai đoạn 1, spec content-security-policy).
 *
 * Hợp đồng:
 *  - LUÔN 204, không thân — kể cả sai Content-Type, thân hỏng, quá cỡ, bị giới hạn hay
 *    lỗi bất ngờ. Không có gì ở đây được phép làm hỏng trang, và mã lỗi không cho người
 *    gửi biết thêm điều gì.
 *  - Không lưu gì vào CSDL ngoài bộ đếm giới hạn tần suất dùng chung
 *    (`rate_limit_counters`); mỗi báo cáo hợp lệ là MỘT dòng log
 *    `security.csp_violation` mang directive / blocked / path / disposition (cách rút
 *    gọn và trần độ dài: `server/utils/csp-report.ts`). Mức `info` cho báo cáo
 *    Report-Only; `warn` khi trình duyệt đã thật sự chặn (`disposition: enforce`).
 *  - Giới hạn theo nguồn: `CSP_REPORTS_LOGGED_PER_WINDOW` (60) báo cáo / 60 giây cho mỗi
 *    IP (IPv6 theo /64 — `ipBucket`), đếm theo BÁO CÁO. Nguồn đã quá trần chỉ tốn một
 *    lượt đọc bộ đếm: không đọc thân, không ghi.
 *  - Thân đọc qua `readBoundedUploadBody` (trần theo byte thật, kể cả khi không có
 *    Content-Length) rồi `JSON.parse` trong try: `application/csp-report` không phải
 *    `+json` nên `readJsonBody` (`request-body.ts`) sẽ từ chối nó, và một 400 thì trái
 *    hợp đồng "luôn 204".
 *
 * Cổng chặn yêu cầu ghi khác site (`00.origin-gate.ts`) miễn ĐÚNG đường dẫn này (lý do
 * và phép so đường dẫn: `isOriginGateExemptPath` trong `server/utils/origin-gate.ts`).
 * Không đọc cookie hay phiên. Không bị cache: `/api/**` là `cache: false`.
 */
import { defineEventHandler, getRequestHeader, sendNoContent, type H3Event } from 'h3'
import { readBoundedUploadBody } from '../utils/bounded-upload-body'
import { getClientIp } from '../utils/client-ip'
import { CSP_REPORT_MAX_BODY_BYTES, CSP_REPORT_RATE_RULE, cspReportFormat, parseCspReportBody } from '../utils/csp-report'
import { ipBucket } from '../utils/ip-bucket'
import { logInfo, logWarn, SECURITY_EVENTS } from '../utils/logger'
import { rateLimitDeps } from '../utils/rate-limit-deps'
import { peekRateLimit, recordRateLimitHit } from '../utils/rate-limit-store'

async function receiveReports(event: H3Event): Promise<void> {
  const format = cspReportFormat(getRequestHeader(event, 'content-type'))
  if (!format) return

  const bucket = `csp-report:${ipBucket(getClientIp(event))}`
  const deps = rateLimitDeps()
  if ((await peekRateLimit(bucket, CSP_REPORT_RATE_RULE, deps)).blocked) return

  let text: string
  try {
    text = (await readBoundedUploadBody(event, CSP_REPORT_MAX_BODY_BYTES)).toString('utf8')
  } catch {
    // Quá cỡ (khai báo hay thật) hoặc kết nối bị ngắt: không có gì để quan sát. Bộ đọc đã
    // dừng nhận và hẹn đóng kết nối sau phản hồi.
    return
  }

  for (const report of parseCspReportBody(format, text)) {
    // Mỗi báo cáo một lượt: trần là số dòng log, dù báo cáo đến lẻ hay theo lô.
    const state = await recordRateLimitHit(bucket, CSP_REPORT_RATE_RULE, deps)
    if (state.blocked) return
    const fields = { event: SECURITY_EVENTS.cspViolation, ...report }
    if (report.disposition === 'enforce') logWarn(fields)
    else logInfo(fields)
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
