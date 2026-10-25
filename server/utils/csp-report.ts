/**
 * Đọc báo cáo vi phạm CSP (`server/api/csp-report.post.ts`; openspec `wave3-long-term`,
 * design D-CSP giai đoạn 1). Mã thuần: không đọc request, không log, không ném lỗi.
 *
 * Hai định dạng trình duyệt gửi:
 *  - `application/csp-report` (chỉ thị `report-uri`): `{"csp-report": {…}}`, khoá
 *    gạch nối (`document-uri`, `effective-directive`, `violated-directive`,
 *    `blocked-uri`, `disposition`);
 *  - `application/reports+json` (Reporting API, chỉ thị `report-to`): MẢNG
 *    `{type: "csp-violation", url, body: {documentURL, effectiveDirective, blockedURL,
 *    disposition}}`; mục khác `csp-violation` (deprecation, intervention…) bị bỏ qua.
 *
 * Mỗi vi phạm rút về đúng bốn trường, mỗi trường có trần độ dài:
 *  - `directive` — TÊN chỉ thị (`script-src-elem`), không bao giờ phần chính sách theo
 *    sau (CSP2 gửi `violated-directive` kèm toàn bộ giá trị);
 *  - `blocked` — host (`www.googletagmanager.com`, kèm cổng nếu khác mặc định) cho URL
 *    http(s)/ws(s); tên lược đồ (`data`, `blob`, `chrome-extension`) cho URL khác — không
 *    bao giờ phần sau lược đồ (một `data:` URL là chính nội dung script); nhãn
 *    (`inline`, `eval`, `wasm-eval`…) cho từ khoá; `none` khi trống; `other` khi đọc
 *    không được. Không bao giờ đường dẫn, query hay fragment;
 *  - `path` — pathname của trang (không query, không fragment — query có thể mang mã/
 *    token); trang không phải http(s) chỉ ghi lược đồ (`about:`);
 *  - `disposition` — `enforce`/`report`, giá trị khác bị bỏ.
 * Không bao giờ: `script-sample`/`sample`, `source-file`, `referrer`, `original-policy`,
 * user agent, IP. Báo cáo không có tên chỉ thị hợp lệ bị bỏ (không gì để quan sát).
 */
import type { RateLimitRule } from './rate-limit-store'

/** Trần thân yêu cầu. Một báo cáo kiểu cũ ~1,6 KB (mang cả `original-policy`). */
export const CSP_REPORT_MAX_BODY_BYTES = 64 * 1024

/** Số báo cáo tối đa được đọc trong MỘT yêu cầu (Reporting API gửi theo lô). */
export const CSP_REPORT_MAX_PER_REQUEST = 20

/**
 * Số báo cáo được LOG tối đa cho mỗi nguồn (IP, IPv6 theo /64) trong một cửa sổ. Đếm
 * theo báo cáo, không theo yêu cầu: một lô 20 báo cáo tốn 20 lượt. Một lượt xem trang
 * ở giai đoạn 1 sinh vài báo cáo (script inline của Nuxt, failsafe, mã theo dõi), nên
 * 60/phút đủ cho một người đọc thật; quá trần thì im lặng — báo cáo trùng không thêm
 * bằng chứng, và một nguồn không được làm ngập log.
 */
export const CSP_REPORTS_LOGGED_PER_WINDOW = 60
export const CSP_REPORT_WINDOW_SECONDS = 60

/**
 * Luật cho kho dùng chung (`rate-limit-store.ts`): `blocked` nghĩa là "lượt này chạm
 * trần" (`count >= limit`), nên `limit` là số lượt NHẬN + 1 — cùng quy ước với
 * `analytics/page-view`.
 */
export const CSP_REPORT_RATE_RULE: RateLimitRule = {
  limit: CSP_REPORTS_LOGGED_PER_WINDOW + 1,
  windowSeconds: CSP_REPORT_WINDOW_SECONDS,
}

const MAX_DIRECTIVE_CHARS = 40
const MAX_TAG_CHARS = 32
const MAX_BLOCKED_CHARS = 128
const MAX_PATH_CHARS = 200

export type CspReportFormat = 'csp-report' | 'reports+json'

export type CspViolation = {
  directive: string
  blocked: string
  path: string
  disposition?: 'enforce' | 'report'
}

/** Định dạng theo `Content-Type` (bỏ tham số, không phân biệt hoa thường); `null` = không phải báo cáo CSP. */
export function cspReportFormat(contentType: string | null | undefined): CspReportFormat | null {
  const mediaType = String(contentType ?? '').split(';', 1)[0]!.trim().toLowerCase()
  if (mediaType === 'application/csp-report') return 'csp-report'
  if (mediaType === 'application/reports+json') return 'reports+json'
  return null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Tên chỉ thị, chữ thường, `[a-z][a-z0-9-]*` ≤ 40 ký tự; khác → null. `effective-directive`
 * là ĐÚNG một tên; chỉ `violated-directive` của CSP2 mang giá trị chính sách phía sau
 * (`withPolicyTail`), và khi đó chỉ lấy token đầu.
 */
function directiveName(value: unknown, withPolicyTail: boolean): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  const name = withPolicyTail ? text.split(/\s+/, 1)[0]! : text
  return name.length <= MAX_DIRECTIVE_CHARS && /^[a-z][a-z0-9-]*$/.test(name) ? name : null
}

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'ws:', 'wss:'])

/** Lược đồ (`data:` → `data`) nếu là tên lược đồ hợp lệ ≤ 32 ký tự; khác → `other`. */
function schemeTag(protocol: string): string {
  const scheme = protocol.replace(/:$/, '').toLowerCase()
  return scheme.length <= MAX_TAG_CHARS && /^[a-z][a-z0-9+.-]*$/.test(scheme) ? scheme : 'other'
}

function blockedSource(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'none'
  const text = value.trim()
  // Từ khoá: `inline`, `eval`, `wasm-eval`, `trusted-types-sink`, `self` (Firefox cũ),
  // `data`/`blob` (Chrome rút URL không cùng nguồn về lược đồ).
  const keyword = text.toLowerCase()
  if (keyword.length <= MAX_TAG_CHARS && /^[a-z][a-z0-9-]*$/.test(keyword)) return keyword
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return 'other'
  }
  if (!WEB_PROTOCOLS.has(url.protocol)) return schemeTag(url.protocol)
  return url.host ? url.host.slice(0, MAX_BLOCKED_CHARS) : 'other'
}

function pagePath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'unknown'
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return 'unknown'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `${schemeTag(url.protocol)}:`
  return url.pathname.slice(0, MAX_PATH_CHARS)
}

function dispositionOf(value: unknown): CspViolation['disposition'] {
  return value === 'enforce' || value === 'report' ? value : undefined
}

/** Tên chỉ thị: `effective` (một tên) trước, rồi `violated` (CSP2: tên + giá trị). */
function reportedDirective(effective: unknown, violated: unknown): string | null {
  return directiveName(effective, false) ?? directiveName(violated, true)
}

function violation(directive: string | null, blocked: unknown, documentUrl: unknown, disposition: unknown): CspViolation | null {
  if (!directive) return null
  const result: CspViolation = { directive, blocked: blockedSource(blocked), path: pagePath(documentUrl) }
  const kind = dispositionOf(disposition)
  if (kind) result.disposition = kind
  return result
}

function fromLegacy(body: unknown): CspViolation[] {
  if (!isPlainObject(body)) return []
  const report = body['csp-report']
  if (!isPlainObject(report)) return []
  const directive = reportedDirective(report['effective-directive'], report['violated-directive'])
  const found = violation(directive, report['blocked-uri'], report['document-uri'], report.disposition)
  return found ? [found] : []
}

function fromReportingApi(body: unknown): CspViolation[] {
  if (!Array.isArray(body)) return []
  const found: CspViolation[] = []
  for (const entry of body.slice(0, CSP_REPORT_MAX_PER_REQUEST)) {
    if (!isPlainObject(entry) || entry.type !== 'csp-violation' || !isPlainObject(entry.body)) continue
    const report = entry.body
    const item = violation(
      reportedDirective(report.effectiveDirective, report.violatedDirective),
      report.blockedURL,
      report.documentURL ?? entry.url,
      report.disposition,
    )
    if (item) found.push(item)
  }
  return found
}

/**
 * Các vi phạm trong thân yêu cầu, theo thứ tự gửi, tối đa `CSP_REPORT_MAX_PER_REQUEST`.
 * Thân không phải JSON, hay JSON sai hình dạng → `[]`. Không bao giờ ném lỗi.
 */
export function parseCspReportBody(format: CspReportFormat, text: string): CspViolation[] {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return []
  }
  return format === 'csp-report' ? fromLegacy(body) : fromReportingApi(body)
}
