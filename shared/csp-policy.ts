/**
 * Content-Security-Policy của cổng — MỘT nguồn cho hai header mà `nuxt.config.ts` gắn
 * lên mọi phản hồi (`routeRules['/**'].headers`):
 *
 *  - `Content-Security-Policy` (`CONTENT_SECURITY_POLICY`) — chính sách đang THỰC THI.
 *    `script-src` còn `'unsafe-inline'`: Nuxt phát script inline lúc khởi động (cấu hình
 *    `window.__NUXT__`), lớp phủ tải đầu có failsafe inline (`app/app.vue`), và
 *    `server/plugins/tracking.ts` chèn đoạn mã theo dõi inline. Bỏ nó là giai đoạn 5.
 *  - `Content-Security-Policy-Report-Only` (`CONTENT_SECURITY_POLICY_REPORT_ONLY`) — chính
 *    sách ĐÍCH (openspec `wave3-long-term`, design D-CSP giai đoạn 1): cùng mọi chỉ thị,
 *    trừ `script-src` = `'self' 'report-sample'` + `CSP_TARGET_SCRIPT_SRC_HOSTS` (không
 *    `'unsafe-inline'`, không `cdnjs`, không `*.gov.vn`), cộng `report-uri /api/csp-report`.
 *    Trình duyệt không chặn gì theo header này — chỉ báo về `server/api/csp-report.post.ts`
 *    (log `security.csp_violation`). Nó CỐ Ý báo mọi script inline ở trên và mọi lượt tải
 *    từ host ngoài danh sách đích: đó là bằng chứng cho giai đoạn 2 (thu hẹp host ở header
 *    thực thi) và danh sách sẽ băm ở giai đoạn 3. Đọc log → `docs/decisions/realm-safety.md`.
 *    Chỉ `script-src` khác: các chỉ thị khác (style/font/frame/img/media/connect) vẫn chép
 *    nguyên bản thực thi, kể cả `cdnjs`/`*.gov.vn` — giai đoạn 1 chỉ quan sát script.
 *
 * Không có `report-to` (+ header `Reporting-Endpoints`) ở giai đoạn này: Chromium BỎ
 * `report-uri` khi chính sách có `report-to` (đo trên Chromium 151 — trang có cả hai không
 * gửi báo cáo kiểu cũ nào, trang chỉ có `report-uri` gửi ngay), và đường Reporting API
 * chưa kiểm được ngoài production. Thêm nó lúc này là đặt toàn bộ báo cáo của Chrome lên
 * một đường chưa kiểm. Endpoint đã đọc cả `application/reports+json`, nên bật sau chỉ là
 * sửa header — sau khi thấy báo cáo tới thật trên HTTPS.
 *
 * `style-src 'unsafe-inline'` ở lại trong cả hai (D-CSP3: style inline không chạy script,
 * bỏ nó đụng 67 tệp). Host ảnh: `shared/media-hosts.ts`. Mã thuần — `nuxt.config.ts` nạp
 * được, test đọc được mà không cần Nuxt; không import `app/` hay `server/`.
 */
import { cspImgSrcDirective } from './media-hosts'

/** Đường dẫn nhận báo cáo vi phạm — `server/api/csp-report.post.ts`. */
export const CSP_REPORT_PATH = '/api/csp-report'

/**
 * Host được chạy script ở header THỰC THI, ngoài `'self'` — đúng thứ tự trong header (giữ
 * nguyên từng byte ở giai đoạn 1). Giai đoạn 2 thu hẹp danh sách này về
 * `CSP_TARGET_SCRIPT_SRC_HOSTS` theo bằng chứng báo cáo (`*.gov.vn`; `cdnjs` chỉ khi
 * đường CDN của TinyMCE đã chết).
 */
export const CSP_SCRIPT_SRC_HOSTS = [
  'static.cloudflareinsights.com',
  'cdnjs.cloudflare.com',
  'www.youtube.com',
  'www.youtube-nocookie.com',
  'www.googletagmanager.com',
  'connect.facebook.net',
  'analytics.tiktok.com',
  'www.clarity.ms',
  '*.gov.vn',
] as const

/**
 * Host ĐÍCH của `script-src` (design D-CSP, "Target `script-src`") — dùng cho header
 * Report-Only. Là tập con của `CSP_SCRIPT_SRC_HOSTS`, KHÔNG có `cdnjs.cloudflare.com` và
 * `*.gov.vn`: một chính sách chỉ-báo mà còn cho phép host nào thì trình duyệt không bao
 * giờ báo lượt tải từ host đó, nên chỉ khi vắng chúng ở đây hai tuần quan sát mới cho
 * bằng chứng để giai đoạn 2 bỏ (hay giữ) chúng ở header thực thi. Không wildcard.
 */
export const CSP_TARGET_SCRIPT_SRC_HOSTS = [
  'www.googletagmanager.com',
  'connect.facebook.net',
  'analytics.tiktok.com',
  'www.clarity.ms',
  'static.cloudflareinsights.com',
  'www.youtube.com',
  'www.youtube-nocookie.com',
] as const

const scriptHosts = CSP_SCRIPT_SRC_HOSTS.map(host => `https://${host}`)

/** Mọi chỉ thị theo thứ tự header; chỉ `script-src` khác nhau giữa hai chính sách. */
function directives(scriptSrc: readonly string[]): string[] {
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://*.delify.vn https://*.conduonghuongthien.vn https://*.gov.vn",
    cspImgSrcDirective(),
    "media-src 'self' blob: https://*.delify.vn https://*.conduonghuongthien.vn https://*.gov.vn",
    "font-src 'self' https://cdnjs.cloudflare.com https://*.delify.vn https://*.conduonghuongthien.vn https://*.gov.vn",
    'frame-src https://www.youtube-nocookie.com https://*.delify.vn https://*.conduonghuongthien.vn https://www.googletagmanager.com https://*.gov.vn',
    "connect-src 'self' https://static.cloudflareinsights.com https://*.delify.vn https://*.conduonghuongthien.vn https://www.google-analytics.com https://*.facebook.com https://analytics.tiktok.com https://www.clarity.ms https://*.gov.vn",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ]
}

/** Header `Content-Security-Policy` — chính sách đang thực thi. */
export const CONTENT_SECURITY_POLICY = directives(["'self'", "'unsafe-inline'", ...scriptHosts]).join('; ')

/**
 * Header `Content-Security-Policy-Report-Only` — chính sách đích, chỉ báo cáo. `'report-sample'`
 * để trình duyệt gửi 40 ký tự đầu của script inline bị chặn: endpoint chỉ ghi tiền tố
 * SHA-256 của nó (không bao giờ nội dung) để phân biệt các script inline với nhau.
 */
export const CONTENT_SECURITY_POLICY_REPORT_ONLY = [
  ...directives(["'self'", "'report-sample'", ...CSP_TARGET_SCRIPT_SRC_HOSTS.map(host => `https://${host}`)]),
  `report-uri ${CSP_REPORT_PATH}`,
].join('; ')
