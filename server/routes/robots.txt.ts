import { requestBase } from '../utils/google-oauth/config'

/**
 * `/robots.txt` — route động thay cho tệp tĩnh.
 *
 * Lý do đổi sang route: dòng `Sitemap:` phải khớp domain đang chạy, và cổng có
 * thể phục vụ nhiều domain (tiền lệ Google OAuth + email đã xử lý multi-domain).
 * Tệp tĩnh `public/robots.txt` không biết domain request → hoặc ghi cứng một
 * domain (sai cho domain còn lại), hoặc không có dòng Sitemap (máy quệt phải đoán).
 *
 * Giữ nguyên logic Disallow cũ: chặn `/admin` và `/api/admin` (không mang lại gì
 * cho công dân, bộc lộ cấu trúc admin). Phần công khai (`/news`, `/role-models`,
 * `/qa-documents`, ...) không Disallow.
 *
 * Format chuẩn RFC: `User-agent` viết thường, không comment inline giữa các
 * directive — parser nghiêm (Lighthouse `robots-txt` audit) phàn nàn comment
 * xen vào. Comment Only ở cuối file hoặc đầu khối.
 */
export default defineEventHandler((event) => {
  const base = requestBase(event).replace(/\/+$/, '')
  const body = [
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /api/admin',
    '',
    `Sitemap: ${base}/sitemap.xml`,
  ].join('\n')

  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  return body
})
