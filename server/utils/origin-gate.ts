/**
 * Quyết định của cổng chặn yêu cầu ghi từ trang khác (spec csrf-protection,
 * design D-CSRF). Middleware ở `server/middleware/00.origin-gate.ts`.
 *
 * Vì sao cần: cookie phiên (`cdkt_admin`, phiên reader) là `SameSite=Lax`, và
 * "same-site" tính theo tên miền đăng ký — production chia `delify.vn` với các
 * trang khác, nên một trang trên tên miền con anh em được trình duyệt gửi kèm
 * cookie của cán bộ trong một `<form method=post>` tới cổng. Lax không chặn được
 * thứ đó; trình duyệt thì có nói ra yêu cầu tới từ đâu.
 *
 * Thứ tự (hàm thuần `decideOriginGate`, bảng test ở
 * `tests/csrf-origin-gate-behavior.test.ts`):
 *  1. `Sec-Fetch-Site` có mặt → chỉ `same-origin` và `none` qua. Trình duyệt tự
 *     tính header này, trang web không ghi đè được (tên header bị cấm).
 *  2. Không có → `Origin` có mặt: `null` hoặc không đọc được → chặn; host không
 *     nằm trong tập host được phép → chặn.
 *  3. Không có cả hai → cho qua (quyết định D-CSRF): mọi trình duyệt đang dùng gửi
 *     ít nhất một trong hai trên POST khác site; cron, curl, client E2E thì không.
 *
 * Tập host được phép: host của `PUBLIC_BASE_URL` ∪ `PUBLIC_HOST_ALLOWLIST` ∪ host
 * của CHÍNH request — nhưng cái sau chỉ khi peer là proxy đã khai
 * (`peerIsTrustedProxy`; khi đó `requestBase` đọc `X-Forwarded-Host` rồi `Host` mà
 * proxy chuyển). Không bao giờ là `Host` thô từ một peer lạ (design D-CSRF):
 * header đó do client ghi. E2E/dev (peer loopback, mặc định tin) và production sau
 * nginx (`TRUSTED_PROXY_IPS`) có host request; app mở thẳng ra ngoài thì chỉ các
 * host đã cấu hình được chấp nhận làm `Origin`.
 */
import type { H3Event } from 'h3'
import { peerIsTrustedProxy } from './client-ip'
import { configuredBaseUrl, requestBase } from './google-oauth/config'
import { configuredHostAllowlist } from './public-link-base'

/** Phương thức đổi trạng thái. GET/HEAD/OPTIONS không bao giờ bị cổng này chặn. */
export const STATE_CHANGING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** `Sec-Fetch-Site` được phép: cùng origin, hoặc người dùng tự gõ/đánh dấu trang. */
const ALLOWED_FETCH_SITES: ReadonlySet<string> = new Set(['same-origin', 'none'])

export type OriginGateRefusal = 'fetch-site' | 'origin-null' | 'origin-unparsable' | 'origin-host'

export type OriginGateDecision =
  | { allow: true }
  | { allow: false, reason: OriginGateRefusal, originHost: string | null }

/**
 * Chuẩn hoá một host để so: chữ thường, bỏ dấu chấm cuối, bỏ cổng mặc định
 * (`:443`/`:80` — trình duyệt bỏ cổng mặc định khỏi `Origin`, một proxy có thể giữ
 * nó trong `Host`). `''` khi không có gì.
 */
export function normalizeGateHost(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/:(?:443|80)$/, '')
    .replace(/\.+$/, '')
}

/** Host (kèm cổng không mặc định) của một chuỗi gốc `scheme://host[:port]`; `''` nếu không đọc được. */
function hostOf(base: string): string {
  if (!base) return ''
  try {
    const url = new URL(base)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    return normalizeGateHost(url.host)
  } catch {
    return ''
  }
}

/** Hàm thuần: cho qua hay chặn. */
export function decideOriginGate(input: {
  method: string
  secFetchSite: string | null | undefined
  origin: string | null | undefined
  allowedHosts: ReadonlySet<string>
}): OriginGateDecision {
  if (!STATE_CHANGING_METHODS.has(String(input.method || '').toUpperCase())) return { allow: true }

  const fetchSite = input.secFetchSite
  if (fetchSite !== null && fetchSite !== undefined) {
    // Có mặt là trình duyệt đã tự phân loại: mọi giá trị khác hai giá trị được phép
    // (kể cả giá trị lạ của một chuẩn sau này) bị chặn — fail closed.
    return ALLOWED_FETCH_SITES.has(fetchSite.trim().toLowerCase())
      ? { allow: true }
      : { allow: false, reason: 'fetch-site', originHost: originHostForLog(input.origin) }
  }

  const origin = input.origin
  if (origin === null || origin === undefined) return { allow: true }

  const trimmed = origin.trim()
  if (trimmed.toLowerCase() === 'null') return { allow: false, reason: 'origin-null', originHost: null }
  const host = hostOf(trimmed)
  if (!host) return { allow: false, reason: 'origin-unparsable', originHost: null }
  return input.allowedHosts.has(host) ? { allow: true } : { allow: false, reason: 'origin-host', originHost: host }
}

/** Chỉ host của `Origin` đi vào log — không đường dẫn, không query. */
function originHostForLog(origin: string | null | undefined): string | null {
  if (!origin) return null
  const host = hostOf(origin.trim())
  return host || null
}

/** Tập host được phép cho request này (xem đầu tệp). */
export function allowedOriginHosts(event: H3Event): Set<string> {
  const hosts = new Set<string>()
  // Host của chính request CHỈ khi peer là proxy đã khai (design D-CSRF: không bao
  // giờ là `Host` thô từ một peer lạ). Sau proxy tin cậy, `requestBase` đọc
  // `X-Forwarded-Host` (rồi `Host`) mà proxy chuyển — đúng host trình duyệt thấy.
  // Peer lạ (app mở thẳng ra ngoài, proxy chưa khai): chỉ các host đã cấu hình.
  if (peerIsTrustedProxy(event)) {
    const requestHost = hostOf(requestBase(event))
    if (requestHost) hosts.add(requestHost)
  }
  const configured = hostOf(configuredBaseUrl())
  if (configured) hosts.add(configured)
  for (const host of configuredHostAllowlist()) {
    const normalized = normalizeGateHost(host)
    if (normalized) hosts.add(normalized)
  }
  return hosts
}
