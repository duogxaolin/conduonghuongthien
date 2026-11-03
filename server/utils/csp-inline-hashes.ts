/**
 * Hash SHA-256 của mọi script inline THỰC THI được trong một trang HTML đã dựng — thứ mà
 * `script-src 'sha256-…'` cần (CSP giai đoạn 3, design D-CSP). Mã thuần: không đọc request,
 * không đụng header; `server/plugins/csp-inline-hashes.ts` gọi nó sau khi trang dựng xong.
 *
 * Tính trên HTML CUỐI (sau khi `server/plugins/tracking.ts` chèn mã theo dõi và mã tuỳ chỉnh):
 * trình duyệt băm đúng chuỗi giữa hai thẻ, từng byte, nên hash phải lấy từ chính chuỗi sẽ gửi
 * đi. Nội dung script đổi theo mỗi bản build (importmap có tên tệp entry) và theo cấu hình
 * chạy (`window.__NUXT__.config`), nên không thể ghi cứng — tính lúc phản hồi, trang swr giữ
 * header cùng thân.
 *
 * Bỏ qua: script có `src` (nguồn ngoài do host quyết định) và khối dữ liệu không chạy
 * (`application/json`, `application/ld+json`, `text/template`…). Giữ: không có `type`,
 * `text/javascript`, `module`, `importmap`, `speculationrules` (importmap/speculationrules
 * bị CSP kiểm như script).
 */
import { createHash } from 'node:crypto'

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
const SRC_ATTR_RE = /(?:^|\s)src\s*=/i
const TYPE_ATTR_RE = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i

/** `type` của khối chạy được (hoặc bị CSP kiểm như script); rỗng/không có = JavaScript. */
const CHECKED_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module', 'importmap', 'speculationrules'])

function isCheckedInline(attributes: string, content: string): boolean {
  if (SRC_ATTR_RE.test(attributes)) return false
  if (!content.trim()) return false
  const match = TYPE_ATTR_RE.exec(attributes)
  const type = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim().toLowerCase()
  return CHECKED_TYPES.has(type)
}

/** `'sha256-<base64>'` của một chuỗi script — đúng dạng mà trình duyệt so. */
export function inlineScriptHash(content: string): string {
  return `'sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}'`
}

/** Hash (không trùng, theo thứ tự xuất hiện) của mọi script inline kiểm được trong `html`. */
export function inlineScriptHashes(html: string): string[] {
  const seen = new Set<string>()
  for (const match of html.matchAll(SCRIPT_RE)) {
    const [, attributes = '', content = ''] = match
    if (isCheckedInline(attributes, content)) seen.add(inlineScriptHash(content))
  }
  return [...seen]
}
