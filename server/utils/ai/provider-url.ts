/**
 * Chính sách địa chỉ nhà cung cấp AI (`ai_providers.base_url`, `chatbot_settings.base_url`).
 *
 * Mỗi lệnh gọi AI gửi kèm `Authorization: Bearer <API key>` tới đúng địa chỉ này.
 * Trước đây địa chỉ được lưu không kiểm, và danh sách "máy chủ được phép" lại suy
 * ra từ chính địa chỉ đó — nên nó không chặn được gì: ai có quyền `ai.update` đặt
 * `http://attacker` hoặc một IP nội bộ là lần gọi chatbot/dịch kế tiếp mang khoá
 * API tới đó.
 *
 * Một hàm thuần, dùng ở ba chỗ để ba chỗ không lệch nhau:
 *   - lúc GHI (tạo/sửa nhà cung cấp, PATCH cấu hình chatbot) → 400 kèm lời tiếng Việt;
 *   - lúc GỌI (`callAi` kiểm trước khi dựng request — lệnh gọi bị chặn không chạm mạng);
 *   - trong `normalizeProviderUrl` (`server/utils/chatbot/outbound.ts`) — cửa chung
 *     của mọi đường ra mạng tới nhà cung cấp.
 *
 * Phần tên miền→IP công khai KHÔNG kiểm được ở đây (cần DNS, và DNS đổi theo thời
 * gian): nó được kiểm lúc gọi, trong `resolvePublicProviderAddresses`, và IP đã
 * kiểm được ghim vào chính kết nối (`createPinnedLookup`).
 */
import { isIP } from 'node:net'

export const PROVIDER_BASE_URL_MAX_LENGTH = 1024

export type ProviderUrlViolation =
  | 'invalid'
  | 'not_https'
  | 'credentials'
  | 'port'
  | 'query_or_fragment'
  | 'ip_literal'
  | 'internal_name'

export type ProviderUrlCheck =
  | { ok: true, url: string, hostname: string }
  | { ok: false, violation: ProviderUrlViolation, message: string }

/**
 * Hậu tố tên miền chỉ có nghĩa trong mạng nội bộ (RFC 6761/6762/8375 và các quy
 * ước phổ biến). `metadata.google.internal` — máy chủ metadata đám mây — rơi vào
 * `.internal`.
 */
const INTERNAL_SUFFIXES = ['localhost', 'local', 'internal', 'localdomain', 'home.arpa', 'lan', 'intranet'] as const

const MESSAGES: Record<ProviderUrlViolation, string> = {
  invalid: 'Địa chỉ nhà cung cấp (Base URL) không hợp lệ.',
  not_https: 'Địa chỉ nhà cung cấp phải dùng https://.',
  credentials: 'Địa chỉ nhà cung cấp không được chứa tên đăng nhập hoặc mật khẩu.',
  port: 'Địa chỉ nhà cung cấp chỉ được dùng cổng 443 (cổng mặc định của https).',
  query_or_fragment: 'Địa chỉ nhà cung cấp không được chứa tham số truy vấn (?…) hoặc phân đoạn (#…).',
  ip_literal: 'Địa chỉ nhà cung cấp phải là tên miền công khai, không dùng địa chỉ IP.',
  internal_name: 'Địa chỉ nhà cung cấp phải là tên miền công khai — không dùng localhost, tên nội bộ (.local, .internal…) hay tên không có dấu chấm.',
}

export function providerUrlViolationMessage(violation: ProviderUrlViolation): string {
  return MESSAGES[violation]
}

/**
 * Tên máy (đã qua bộ phân tích URL WHATWG) có được phép làm đích gọi nhà cung cấp
 * không. Trả về lý do từ chối, hoặc `null`.
 *
 * Mọi IP viết thẳng đều bị từ chối, không riêng IP nội bộ: `normalizeProviderUrl`
 * vốn đã từ chối chúng lúc gọi, và chứng chỉ TLS cho một IP gần như không bao giờ
 * hợp lệ. Bộ phân tích URL đã quy các dạng thập phân/hex/bát phân/rút gọn
 * (`2130706433`, `0x7f.1`, `127.1`) về dạng chấm chuẩn và giữ IPv6 trong `[...]`,
 * nên một phép `isIP` sau khi bỏ ngoặc bắt được hết.
 */
export function providerHostnameViolation(hostname: string): 'invalid' | 'ip_literal' | 'internal_name' | null {
  const unwrapped = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  const host = unwrapped.trim().toLowerCase().replace(/\.+$/, '')
  if (!host) return 'invalid'
  if (isIP(host) !== 0 || host.includes(':')) return 'ip_literal'
  // Tên một nhãn (`mysql`, `cdkt_app`, `router`) là tên dịch vụ docker/mạng LAN,
  // không bao giờ là một nhà cung cấp công khai.
  if (!host.includes('.')) return 'internal_name'
  if (INTERNAL_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`))) return 'internal_name'
  return null
}

/**
 * Kiểm một Base URL nhà cung cấp. Thành công trả về dạng chuẩn hoá để lưu:
 * `https://<host thường>/<đường dẫn không gạch chéo cuối>` — cùng cách
 * `normalizeProviderUrl` chuẩn hoá lúc gọi, nên so sánh "có đổi không" là so chuỗi.
 */
export function checkProviderBaseUrl(input: unknown): ProviderUrlCheck {
  if (typeof input !== 'string') return reject('invalid')
  const raw = input.trim()
  if (!raw || raw.length > PROVIDER_BASE_URL_MAX_LENGTH) return reject('invalid')

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return reject('invalid')
  }

  if (url.protocol !== 'https:') return reject('not_https')
  if (url.username || url.password) return reject('credentials')
  // Bộ phân tích bỏ `:443` (cổng mặc định) nên `port` rỗng nghĩa là 443.
  if (url.port && url.port !== '443') return reject('port')
  // `raw.includes` bắt cả `?`/`#` trơ trọi mà `url.search`/`url.hash` để rỗng.
  if (url.search || url.hash || raw.includes('?') || raw.includes('#')) return reject('query_or_fragment')

  const hostnameViolation = providerHostnameViolation(url.hostname)
  if (hostnameViolation) return reject(hostnameViolation)

  const hostname = url.hostname.toLowerCase().replace(/\.+$/, '')
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')
  return { ok: true, url: `https://${hostname}${path}`, hostname }
}

/** Dạng chuẩn hoá của một giá trị đã lưu, hoặc `null` nếu nó không qua chính sách. */
export function normalizedProviderBaseUrl(input: unknown): string | null {
  const result = checkProviderBaseUrl(input)
  return result.ok ? result.url : null
}

function reject(violation: ProviderUrlViolation): ProviderUrlCheck {
  return { ok: false, violation, message: MESSAGES[violation] }
}
