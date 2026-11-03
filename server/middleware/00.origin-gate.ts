/**
 * Chặn yêu cầu GHI mà trình duyệt gửi thay cho một trang khác (spec
 * csrf-protection, design D-CSRF). Luật và lý do: `server/utils/origin-gate.ts`.
 *
 * Tên tệp bắt đầu bằng `00.` có chủ đích: Nitro đăng ký middleware theo thứ tự
 * `localeCompare` của tên tệp (`scanDir` trong nitropack), nên cổng này chạy TRƯỚC
 * `admin-auth.ts` — yêu cầu khác site bị từ chối trước khi phiên được đọc, và trước
 * khi handler nào đọc body (kể cả multipart). Test thứ tự nằm ở
 * `tests/csrf-origin-gate-behavior.test.ts`.
 *
 * Áp cho MỌI POST/PUT/PATCH/DELETE, không phân loại đường dẫn. Phạm vi của spec là
 * `/api/**`, và mọi handler ghi đều nằm ở đó (`server/routes/` chỉ phục vụ đọc),
 * nên không cần — và không nên — có một bộ phân loại đường dẫn: `admin-auth` từng
 * lệch pha với router đúng ở chỗ đó (`/api/%61dmin/…`). Không phân loại thì không
 * có cách viết đường dẫn nào lọt qua.
 *
 * MỘT ngoại lệ có tên, khớp chính xác chứ không theo tiền tố, và chỉ cho POST:
 * `POST /api/csp-report` (báo cáo vi phạm CSP do trình duyệt tự gửi, không đổi trạng thái
 * gì). Lý do và phép so đường dẫn — cùng quy tắc "mọi dạng đã giải mã" của `admin-auth` — ở
 * `isOriginGateExempt`; test: `tests/csp-report-endpoint-behavior.test.ts`.
 */
import { createError, defineEventHandler, getRequestHeader } from 'h3'
import { allowedOriginHosts, decideOriginGate, isOriginGateExempt, STATE_CHANGING_METHODS } from '../utils/origin-gate'
import { logWarn, SECURITY_EVENTS } from '../utils/logger'

export default defineEventHandler((event) => {
  const method = String(event.method || '').toUpperCase()
  if (!STATE_CHANGING_METHODS.has(method)) return
  if (isOriginGateExempt(method, String(event.path || '/'), String(event.node.req.originalUrl || event.node.req.url || '/'))) return

  const secFetchSite = getRequestHeader(event, 'sec-fetch-site')
  const origin = getRequestHeader(event, 'origin')
  // Không có cả hai header thì quyết định không cần tập host — khỏi suy host.
  if ((secFetchSite === undefined || secFetchSite === null) && (origin === undefined || origin === null)) return

  const decision = decideOriginGate({
    method,
    secFetchSite,
    origin,
    allowedHosts: secFetchSite === undefined || secFetchSite === null ? allowedOriginHosts(event) : new Set(),
  })
  if (decision.allow) return

  const path = String(event.path || '/')
  logWarn({
    event: SECURITY_EVENTS.crossSiteRefused,
    method,
    // Không query: nó có thể mang mã/token.
    path: path.split('?')[0]!.slice(0, 256),
    originHost: decision.originHost,
    reason: decision.reason,
  })
  throw createError({ statusCode: 403, statusMessage: 'Yêu cầu từ trang khác bị từ chối.' })
})
