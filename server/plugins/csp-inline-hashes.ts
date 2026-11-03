/**
 * Gắn hash của các script inline THẬT SỰ trong trang vào header `Content-Security-Policy-Report-Only`
 * (CSP giai đoạn 3, openspec `wave3-long-term` design D-CSP). Chỉ header Report-Only: header
 * THỰC THI không đổi một byte — vẫn `'unsafe-inline'`, không chặn gì (bỏ nó là giai đoạn 5, sau
 * hai tuần dữ liệu báo cáo thật).
 *
 * Vì sao: header Report-Only mặc định cố ý báo MỌI script inline để lấy bằng chứng (giai đoạn 1).
 * Có bằng chứng rồi, ba script của chính cổng — importmap của Nuxt, `window.__NUXT__.config` và
 * failsafe của lớp phủ tải đầu — cùng mã theo dõi `tracking.ts` chèn vào, được đưa vào danh sách
 * hash; console và `/api/csp-report` từ đó chỉ còn báo thứ KHÔNG nằm trong danh sách (script lạ,
 * script của tiện ích không phải của cổng, inline event handler — hash không áp cho handler).
 *
 * Hook `render:response` (như `security-headers.ts`): thân HTML đã cuối cùng. Đo trên bản build
 * Nuxt 4: `response.headers` là `undefined` ở đây (renderer đặt header thẳng lên event, kể cả
 * `content-type`) — bản đầu của plugin đọc/ghi `response.headers` nên không bao giờ chạy. Nay đọc
 * `content-type` và ghi header qua `event`; `response.headers` (nếu có) cũng được ghi cùng giá trị.
 * Trang `swr` giữ cả header lẫn thân trong cùng một mục đệm, nên hash luôn đi cùng đúng thân nó
 * tính ra. Phản hồi không phải HTML dạng chuỗi (luồng, API, tệp) không đụng tới.
 */
import { getResponseHeader, setResponseHeader, type H3Event } from 'h3'
import { cspReportOnlyWithInlineHashes } from '../../shared/csp-policy'
import { inlineScriptHashes } from '../utils/csp-inline-hashes'

const HEADER = 'content-security-policy-report-only'

type RenderResponse = { body?: unknown, headers?: Record<string, unknown> }

/**
 * Giá trị header Report-Only cho một phản hồi, hoặc `null` khi không có gì để đổi (không phải HTML
 * dạng chuỗi, hoặc HTML không có script inline). `contentType` rỗng = chưa biết: nhận HTML theo thân.
 */
export function inlineScriptPolicyFor(body: unknown, contentType: string): string | null {
  if (typeof body !== 'string') return null
  const isHtml = contentType
    ? /text\/html/i.test(contentType)
    : /^\s*<(?:!doctype\s+html|html)\b/i.test(body)
  if (!isHtml) return null
  const hashes = inlineScriptHashes(body)
  return hashes.length ? cspReportOnlyWithInlineHashes(hashes) : null
}

function headerValue(headers: Record<string, unknown> | undefined, name: string): string {
  if (!headers) return ''
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return String(value ?? '')
  }
  return ''
}

export function applyInlineScriptHashes(response: RenderResponse, event?: H3Event): void {
  const contentType = String(event ? getResponseHeader(event, 'content-type') ?? '' : '') || headerValue(response?.headers, 'content-type')
  const policy = inlineScriptPolicyFor(response?.body, contentType)
  if (!policy) return
  if (response.headers) response.headers[HEADER] = policy
  if (event) setResponseHeader(event, HEADER, policy)
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response: RenderResponse, ctx?: { event?: H3Event }) => {
    try {
      applyInlineScriptHashes(response, ctx?.event)
    } catch {
      // Chỉ là header quan sát: lỗi ở đây không bao giờ làm hỏng một trang.
    }
  })
})
