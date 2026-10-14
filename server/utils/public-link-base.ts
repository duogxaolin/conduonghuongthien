/**
 * Gốc địa chỉ (scheme + host) cho liên kết TUYỆT ĐỐI gửi ra ngoài trang — liên kết
 * trong email thông báo.
 *
 * `requestBase()` suy gốc từ chính request (Host, hoặc `X-Forwarded-Host` khi peer
 * là proxy đã khai) để một mã nguồn phục vụ nhiều tên miền. Với redirect URI của
 * Google thế là đủ: Google so từng ký tự với danh sách đã đăng ký, Host giả chỉ
 * nhận `redirect_uri_mismatch`. Với email thì KHÔNG: không ai kiểm liên kết trong
 * thư. Một người đọc gửi trả lời kèm `Host: evil.example` (hay `X-Forwarded-Host`
 * qua một nginx không ghi đè header đó) là cổng thông tin gửi email THẬT, từ địa
 * chỉ thật, chứa liên kết tới `evil.example` — lừa đảo hoàn hảo.
 *
 * Nên host của request chỉ được dùng khi nằm trong danh sách khai báo:
 *   `PUBLIC_HOST_ALLOWLIST` (phẩy ngăn cách) ∪ host của `PUBLIC_BASE_URL`.
 * Không khớp → rơi về `PUBLIC_BASE_URL` (hoặc host đầu tiên của allowlist).
 * Cả hai đều trống → giữ hành vi cũ (đa tên miền không cấu hình vẫn chạy) nhưng
 * ghi MỘT cảnh báo bảo mật mỗi tiến trình.
 */
import type { H3Event } from 'h3'
import { configuredBaseUrl, requestBase } from './google-oauth/config'
import { logWarn, SECURITY_EVENTS } from './logger'
import { tryRuntimeConfig } from './runtime-config'

export type LinkBaseSource = 'request' | 'public-base-url' | 'allowlist-default' | 'request-unchecked'

export interface LinkBaseDecision {
  base: string
  source: LinkBaseSource
  /** Chưa cấu hình gì: host của request được dùng mà không kiểm. */
  warn: boolean
  /** Host của request bị từ chối (để ghi log), nếu có. */
  rejectedHost?: string
}

/**
 * `PUBLIC_HOST_ALLOWLIST`. runtimeConfig trước rồi tới biến môi trường — bằng `||`,
 * không `??`: image dựng ở CI không có biến này nên giá trị dựng sẵn trong
 * runtimeConfig là `''` (không phải nullish), và `??` sẽ không bao giờ đọc tới
 * `PUBLIC_HOST_ALLOWLIST` đặt lúc chạy trong docker-compose.
 */
export function configuredHostAllowlist(): string[] {
  const raw = tryRuntimeConfig()?.publicHostAllowlist || process.env.PUBLIC_HOST_ALLOWLIST || ''
  return parseHostAllowlist(raw)
}

/** Mỗi mục là `host` hoặc `host:port`; chấp nhận cả dạng có `https://` và đường dẫn. */
export function parseHostAllowlist(raw: string): string[] {
  const hosts = raw
    .split(',')
    .map(entry => normalizeHost(entry.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0] ?? ''))
    .filter((host): host is string => Boolean(host))
  return [...new Set(hosts)]
}

/** Hàm thuần: chọn gốc liên kết. Bảng test ở `tests/public-link-base.test.ts`. */
export function selectLinkBase(input: { requestBase: string, publicBaseUrl: string, allowlist: readonly string[] }): LinkBaseDecision {
  const configured = parseOrigin(input.publicBaseUrl)
  const allowlist = input.allowlist.map(normalizeHost).filter((host): host is string => Boolean(host))
  const request = parseOrigin(input.requestBase)

  if (!configured && allowlist.length === 0) {
    return { base: input.requestBase, source: 'request-unchecked', warn: true }
  }

  const allowed = new Set(allowlist)
  if (configured) allowed.add(configured.host)
  if (request && allowed.has(request.host)) {
    return { base: request.origin, source: 'request', warn: false }
  }

  const rejectedHost = (request?.host ?? input.requestBase).slice(0, 255)
  if (configured) return { base: configured.origin, source: 'public-base-url', warn: false, rejectedHost }
  return { base: `https://${allowlist[0]}`, source: 'allowlist-default', warn: false, rejectedHost }
}

let warnedUnconfigured = false

/** Gốc liên kết cho email: host của request nếu được khai báo, không thì địa chỉ đã cấu hình. */
export function publicLinkBase(event: H3Event): string {
  const decision = selectLinkBase({
    requestBase: requestBase(event),
    publicBaseUrl: configuredBaseUrl(),
    allowlist: configuredHostAllowlist(),
  })
  if (decision.warn && !warnedUnconfigured) {
    warnedUnconfigured = true
    logWarn({
      event: SECURITY_EVENTS.linkHostUnchecked,
      reason: 'PUBLIC_HOST_ALLOWLIST và PUBLIC_BASE_URL đều trống — liên kết trong email lấy theo Host của request mà không kiểm.',
    })
  }
  if (decision.rejectedHost) {
    logWarn({ event: SECURITY_EVENTS.linkHostRejected, host: decision.rejectedHost, fallback: decision.source })
  }
  return decision.base
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.+(?=:\d+$|$)/, '')
}

function parseOrigin(value: string): { origin: string, host: string } | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password) return null
    const host = normalizeHost(url.host)
    if (!host) return null
    return { origin: `${url.protocol}//${host}`, host }
  } catch {
    return null
  }
}
