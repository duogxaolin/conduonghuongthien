/**
 * Host được phép phục vụ ảnh cho trang — MỘT nguồn cho:
 *   - chỉ thị CSP `img-src` của cả hai header (`shared/csp-policy.ts` dựng bằng
 *     `cspImgSrcDirective()`, `nuxt.config.ts` gắn);
 *   - `image.domains` của @nuxt/image (IPX chỉ tải ảnh từ host có tên ở đây, so đúng
 *     tên host — `node_modules/ipx`: `domains.has(url.hostname)`);
 *   - phép kiểm của lượt đổi domain R2 (`server/services/media-repoint.ts`, wave2 2B W2):
 *     đổi URL ảnh sang một host ngoài `img-src` là trình duyệt chặn MỌI ảnh vừa đổi trên
 *     toàn site; ngoài `image.domains` là NuxtImg hiện ảnh dự phòng thay ảnh thật.
 *
 * Thêm CDN mới cho ảnh: thêm host vào đây (cả hai danh sách nếu NuxtImg cũng dùng),
 * deploy, rồi mới đổi domain. Mã thuần, không import `app/` hay `server/`.
 */

/** Nguồn ảnh ngoài `'self' data:` — đúng thứ tự trong header. */
export const CSP_IMG_SRC_HOSTS = [
  '*.delify.vn',
  '*.conduonghuongthien.vn',
  'www.facebook.com',
  'www.googletagmanager.com',
  '*.gov.vn',
] as const

/** Host IPX (NuxtImg) được tải ảnh để resize/WebP — `image.domains`. */
export const IMAGE_PROXY_DOMAINS = ['cdn1.delify.vn'] as const

/** Chỉ thị CSP `img-src` hoàn chỉnh. */
export function cspImgSrcDirective(): string {
  return ["img-src 'self' data:", ...CSP_IMG_SRC_HOSTS.map(host => `https://${host}`)].join(' ')
}

/**
 * Host-source của CSP (không cổng, không đường dẫn) có cho phép `host` không:
 * `*.x.y` khớp mọi subdomain của `x.y` nhưng không khớp chính `x.y`; host cụ thể khớp
 * đúng nó. `host` mang cổng (`a.x.y:8443`) không khớp mẫu không cổng — CSP khi đó chỉ
 * cho cổng mặc định của scheme. So không phân biệt hoa thường.
 */
export function cspHostAllows(pattern: string, host: string): boolean {
  const target = host.toLowerCase()
  if (target.includes(':')) return false
  const source = pattern.toLowerCase()
  if (source.startsWith('*.')) return target.endsWith(source.slice(1)) && target.length > source.length - 1
  return target === source
}

/**
 * Vì sao `host` không phục vụ ảnh được: `csp` = ngoài `img-src` (trình duyệt chặn),
 * `ipx` = trong `img-src` nhưng ngoài `image.domains` (NuxtImg không tải được); `null`
 * = dùng được.
 */
export function mediaHostProblem(host: string): 'csp' | 'ipx' | null {
  if (!CSP_IMG_SRC_HOSTS.some(pattern => cspHostAllows(pattern, host))) return 'csp'
  if (!(IMAGE_PROXY_DOMAINS as readonly string[]).includes(host.toLowerCase())) return 'ipx'
  return null
}
