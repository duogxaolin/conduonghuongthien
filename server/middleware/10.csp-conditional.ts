/**
 * Yêu cầu CÓ ĐIỀU KIỆN (`If-None-Match` / `If-Modified-Since`) không mang header
 * `Content-Security-Policy-Report-Only` mặc định của route rule.
 *
 * Vì sao (CSP giai đoạn 3, đo trên bản docker): trang `swr` trả `304 Not Modified` cho yêu cầu có
 * điều kiện, và bộ bọc đệm của Nitro kết thúc phản hồi 304 NGAY — chỉ với header route rule, tức
 * header Report-Only MẶC ĐỊNH (không hash). Trình duyệt giữ thân HTML cũ nhưng cập nhật header từ
 * 304, nên script inline của chính cổng lại bị báo ở console mỗi lần tải lại sau 60 giây. Không có
 * header này trong 304 thì trình duyệt giữ header ĐÃ LƯU từ lượt 200 (có hash,
 * `server/plugins/csp-inline-hashes.ts`). Nếu yêu cầu có điều kiện rốt cuộc là 200: render mới thì
 * plugin ghi lại header có hash; mục đệm thì replay header đã lưu của nó. Header THỰC THI không
 * đụng tới. Chạy sau route rule (tên tệp `10.` > route rule), trước handler. Chỉ GET/HEAD.
 */
import { defineEventHandler, getRequestHeader, removeResponseHeader } from 'h3'

export default defineEventHandler((event) => {
  const method = String(event.method || '').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return
  if (!getRequestHeader(event, 'if-none-match') && !getRequestHeader(event, 'if-modified-since')) return
  removeResponseHeader(event, 'content-security-policy-report-only')
})
