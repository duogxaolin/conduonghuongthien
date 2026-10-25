/**
 * Đọc báo cáo vi phạm CSP (`server/api/csp-report.post.ts`; openspec `wave3-long-term`,
 * design D-CSP giai đoạn 1). Mã thuần: không đọc request, không log, không ném lỗi. Gộp
 * và ghi log: `csp-report-log.ts`.
 *
 * Hai định dạng trình duyệt gửi:
 *  - `application/csp-report` (chỉ thị `report-uri`): `{"csp-report": {…}}`, khoá
 *    gạch nối (`document-uri`, `effective-directive`, `violated-directive`,
 *    `blocked-uri`, `disposition`, `script-sample`);
 *  - `application/reports+json` (Reporting API, chỉ thị `report-to`): MẢNG
 *    `{type: "csp-violation", url, body: {documentURL, effectiveDirective, blockedURL,
 *    disposition, sample}}`; mục khác `csp-violation` (deprecation, intervention…) bị bỏ qua.
 *
 * Mỗi vi phạm rút về các trường sau, mỗi trường có trần độ dài:
 *  - `directive` — TÊN chỉ thị (`script-src-elem`), không bao giờ phần chính sách theo
 *    sau (CSP2 gửi `violated-directive` kèm toàn bộ giá trị);
 *  - `blocked` — host (`www.googletagmanager.com`, kèm cổng nếu khác mặc định) cho URL
 *    http(s)/ws(s); tên lược đồ (`data`, `blob`, `chrome-extension`) cho URL khác — không
 *    bao giờ phần sau lược đồ (một `data:` URL là chính nội dung script); nhãn
 *    (`inline`, `eval`, `wasm-eval`…) cho từ khoá; `none` khi trống; `other` khi đọc
 *    không được. Không bao giờ đường dẫn, query hay fragment;
 *  - `path` — pathname của trang (không query, không fragment — query có thể mang mã/
 *    token); trang không phải http(s) chỉ ghi lược đồ (`about:`); trang trên host KHÔNG phải
 *    của cổng → `foreign:<host>` (`cspLogEntry`) — bất kỳ trang nào cũng trỏ được
 *    `report-uri` của nó về đây, và đường dẫn của nó không phải đường dẫn của cổng;
 *  - `disposition` — `enforce`/`report`, giá trị khác bị bỏ;
 *  - `sampleSha256` — 12 ký tự hex đầu của SHA-256 của `script-sample`/`sample` (40 ký tự
 *    đầu của script inline bị chặn, nhờ `'report-sample'`), để phân biệt các script inline
 *    với nhau; KHÔNG BAO GIỜ chính mẫu. Không phải băm CSP của cả script (giai đoạn 3 tự
 *    băm script của cổng). Tên trường cố ý tránh chữ `hash` — logger che mọi khoá chứa nó.
 * Không bao giờ: `source-file`, `referrer`, `original-policy`, user agent, IP. Báo cáo không
 * có tên chỉ thị hợp lệ bị bỏ (không gì để quan sát).
 */
import { createHash } from 'node:crypto'
import type { RateLimitRule } from './rate-limit-store'

/** Trần thân yêu cầu. Một báo cáo kiểu cũ ~1,6 KB (mang cả `original-policy`). */
export const CSP_REPORT_MAX_BODY_BYTES = 64 * 1024

/** Số báo cáo tối đa được đọc trong MỘT yêu cầu (Reporting API gửi theo lô). */
export const CSP_REPORT_MAX_PER_REQUEST = 20

/**
 * Số lần-đầu-thấy được LOG tối đa cho mỗi nguồn (IP, IPv6 theo /64) trong một cửa sổ.
 * Báo cáo lặp lại một khoá đã thấy KHÔNG tốn lượt nào (chỉ được đếm trong bộ nhớ —
 * `csp-report-log.ts`); trần này chặn một nguồn tự chế vô hạn khoá mới, mỗi khoá một dòng
 * log và một lượt ghi CSDL. Đếm theo báo cáo, không theo yêu cầu: một lô 20 khoá mới tốn
 * 20 lượt.
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
const MAX_FOREIGN_HOST_CHARS = 100
const SAMPLE_PREFIX_HEX = 12

export type CspReportFormat = 'csp-report' | 'reports+json'

export type CspViolation = {
  directive: string
  blocked: string
  /** Host[:cổng] của trang (chữ thường, bỏ dấu chấm cuối); `null` khi trang không phải http(s). */
  documentHost: string | null
  path: string
  disposition?: 'enforce' | 'report'
  sampleSha256?: string
}

/** Đúng những trường đi vào log và khoá gộp. */
export type CspLogEntry = {
  directive: string
  blocked: string
  path: string
  pathGroup: string
  disposition?: 'enforce' | 'report'
  sampleSha256?: string
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

function documentOf(value: unknown): { host: string | null, path: string } {
  if (typeof value !== 'string' || !value.trim()) return { host: null, path: 'unknown' }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return { host: null, path: 'unknown' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { host: null, path: `${schemeTag(url.protocol)}:` }
  const hostname = url.hostname.replace(/\.+$/, '')
  return { host: url.port ? `${hostname}:${url.port}` : hostname, path: url.pathname.slice(0, MAX_PATH_CHARS) }
}

function dispositionOf(value: unknown): CspViolation['disposition'] {
  return value === 'enforce' || value === 'report' ? value : undefined
}

function samplePrefix(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, SAMPLE_PREFIX_HEX)
}

/** Tên chỉ thị: `effective` (một tên) trước, rồi `violated` (CSP2: tên + giá trị). */
function reportedDirective(effective: unknown, violated: unknown): string | null {
  return directiveName(effective, false) ?? directiveName(violated, true)
}

function violation(directive: string | null, blocked: unknown, documentUrl: unknown, disposition: unknown, sample: unknown): CspViolation | null {
  if (!directive) return null
  const page = documentOf(documentUrl)
  const result: CspViolation = { directive, blocked: blockedSource(blocked), documentHost: page.host, path: page.path }
  const kind = dispositionOf(disposition)
  if (kind) result.disposition = kind
  const prefix = samplePrefix(sample)
  if (prefix) result.sampleSha256 = prefix
  return result
}

function fromLegacy(body: unknown): CspViolation[] {
  if (!isPlainObject(body)) return []
  const report = body['csp-report']
  if (!isPlainObject(report)) return []
  const directive = reportedDirective(report['effective-directive'], report['violated-directive'])
  const found = violation(directive, report['blocked-uri'], report['document-uri'], report.disposition, report['script-sample'])
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
      report.sample,
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

/**
 * Các khu của ứng dụng: tên tệp/thư mục cấp đầu của `app/pages/` (trừ `index` và trang
 * động `[slug]`). `server/` không được import `app/`, nên danh sách viết tay ở đây và
 * `tests/csp-report-aggregate.test.ts` đối chiếu nó với `app/pages/` — thêm một khu mà
 * quên ở đây thì test đỏ.
 */
export const CSP_PAGE_SECTIONS: ReadonlySet<string> = new Set([
  'about',
  'admin',
  'assistant',
  'contact',
  'documents',
  'in-bai',
  'legal-qa',
  'media',
  'news',
  'profile',
  'qa-documents',
  'reintegration-models',
  'role-models',
  'search',
])

/** Nhóm của mọi trang không thuộc khu nào: trang Page Builder `/[slug]`, đường dẫn gõ sai (404). */
export const CSP_OTHER_PAGES_GROUP = '/:page'

/**
 * Nhóm đường dẫn cho khoá gộp: giữ đoạn đầu NẾU nó là một khu của ứng dụng
 * (`CSP_PAGE_SECTIONS`), phần còn lại thành `*` — `/news/tin-tuc/bai-a` → `/news/*`,
 * `/admin/content/articles/12` → `/admin/*`, `/about` → `/about`, `/` → `/`. Đoạn đầu
 * KHÔNG phải một khu (trang Page Builder `/gioi-thieu`, mọi đường dẫn gõ sai) → `/:page`
 * (hay `/:page/*`): nếu không, mỗi slug và mỗi lỗi 404 thành một nhóm riêng, nhân số khoá
 * theo số trang và làm đầy bản đồ gộp không cần ai tấn công. Không phải đường dẫn
 * (`about:`, `unknown`, `foreign:…`) → giữ nguyên.
 */
export function cspPathGroup(path: string): string {
  if (!path.startsWith('/')) return path
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0) return '/'
  const first = CSP_PAGE_SECTIONS.has(segments[0]!) ? `/${segments[0]!}` : CSP_OTHER_PAGES_GROUP
  return segments.length === 1 ? first : `${first}/*`
}

/**
 * Trường log của một vi phạm. `isOwnHost` trả lời "host này có phải của cổng không";
 * `null` = chưa khai host nào → mọi trang tính là của cổng (nơi gọi báo điều đó một lần).
 * Trang trên host khác → `path` = `pathGroup` = `foreign:<host>` (cắt 100 ký tự).
 */
export function cspLogEntry(report: CspViolation, isOwnHost: ((host: string) => boolean) | null): CspLogEntry {
  const foreign = isOwnHost !== null && report.documentHost !== null && !isOwnHost(report.documentHost)
  const path = foreign ? `foreign:${report.documentHost!.slice(0, MAX_FOREIGN_HOST_CHARS)}` : report.path
  const entry: CspLogEntry = {
    directive: report.directive,
    blocked: report.blocked,
    path,
    pathGroup: foreign ? path : cspPathGroup(path),
  }
  if (report.disposition) entry.disposition = report.disposition
  if (report.sampleSha256) entry.sampleSha256 = report.sampleSha256
  return entry
}

/** Khoá gộp: chỉ thị, nguồn bị chặn, disposition, nhóm đường dẫn, tiền tố mẫu. */
export function cspAggregateKey(entry: CspLogEntry): string {
  return [entry.directive, entry.blocked, entry.disposition ?? '-', entry.pathGroup, entry.sampleSha256 ?? '-'].join('|')
}

/** `pathGroup` của khoá thô: mọi trang. */
export const CSP_COARSE_GROUP = '*'

/**
 * Khoá THÔ — chỉ chỉ thị + nguồn bị chặn + disposition (nhóm đường dẫn `*`, không tiền tố
 * mẫu): nơi ĐẾM báo cáo khi bản đồ chính không còn chỗ. Chỉ để đếm — danh tính của một khoá
 * mới vẫn nằm ở dòng `first` đầy đủ của nó (`csp-report-log.ts`). `path` giữ trang mẫu.
 */
export function cspCoarseEntry(entry: CspLogEntry): CspLogEntry {
  const coarse: CspLogEntry = { directive: entry.directive, blocked: entry.blocked, path: entry.path, pathGroup: CSP_COARSE_GROUP }
  if (entry.disposition) coarse.disposition = entry.disposition
  return coarse
}
