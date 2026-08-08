/**
 * Favicon do quản trị viên cấu hình — biên tin cậy và cách nhúng nó vào `<head>`.
 *
 * Giá trị này đi từ một ô nhập ở `/admin/settings/general`, qua cột `settings`,
 * rồi vào **thuộc tính `href` của một thẻ `<link>` trên mọi trang của cổng** —
 * kể cả `/admin`. Nên quy tắc ở đây không phải "làm sạch" mà là **chỉ nhận đúng
 * một hình dạng hẹp**, cùng lối `isSafeReturnPath` đã dùng cho đường về OAuth.
 *
 * Hai hình dạng được nhận, và cả hai đều bắt buộc phải có:
 *  - đường dẫn tương đối (`/favicon-32.png`, `/uploads/2026/08/x.png`) — đây là
 *    thứ `uploadLocalFile` sinh ra;
 *  - `https://…` — đây là thứ `uploadR2File` sinh ra khi cổng dùng Cloudflare R2.
 *
 * Bỏ nhánh thứ hai là làm tính năng này hỏng đúng trên những deployment đã bật
 * R2, và hỏng theo hướng im lặng: cán bộ chọn một tệp từ Thư viện Media, lưu
 * thành công, rồi favicon lùi về mặc định mà không có gì giải thích.
 *
 * Hàm thuần, không đọc CSDL, không đọc đồng hồ — nên kiểm được không cần dựng
 * máy chủ HTTP, đúng lối `resolveClientIp` / `isRunDue` / `validateIdTokenClaims`.
 */

/** Đủ cho mọi URL thật, đủ ngắn để một giá trị rác không đi xa hơn được. */
const MAX_FAVICON_URL_LENGTH = 512

/**
 * Favicon mặc định — sinh từ `public/Logo.png` bởi `scripts/make-favicon.mjs`.
 *
 * Có mặt trong mã nguồn, **không** chỉ nằm trong CSDL: một cơ sở dữ liệu rỗng,
 * một lượt truy vấn hỏng, hay một giá trị bị từ chối đều phải còn favicon. Nguồn
 * duy nhất trong CSDL nghĩa là mọi cách hỏng đó đều dẫn tới một tab trắng.
 */
export const DEFAULT_FAVICON_URL = '/favicon-32.png'

/** Icon màn hình chính iOS. Cùng lý do như trên: luôn có một giá trị dùng được. */
export const DEFAULT_APPLE_ICON_URL = '/favicon-180.png'

/**
 * URL favicon dùng được, hoặc `null`.
 *
 * Bị từ chối, và vì sao từng thứ đáng kể:
 *  - `javascript:alert(1)` — `href` của `<link rel="icon">` là một ngữ cảnh URL;
 *    một scheme thực thi được ở đây là stored XSS trên **mọi** trang của cổng.
 *  - `data:image/svg+xml,…` — SVG là tài liệu thực thi được. Dự án đã có quy tắc
 *    "không bao giờ phục vụ SVG inline" (`sanitize-html.ts`, `upload.post.ts`);
 *    nhận nó ở đây là mở lại đúng cửa đó bằng một đường khác.
 *  - `//evil.com/x.png` — URL tương đối giao thức. Trình duyệt đọc là **tuyệt
 *    đối**, nên kiểm một dấu gạch chéo đầu là **không đủ**. Đây là ca dễ bỏ sót
 *    nhất trong cả hàm.
 *  - `http://…` — nội dung không mã hoá trên một trang HTTPS bị trình duyệt chặn
 *    như mixed content, nên nó không hiện ra; nhận nó là lưu một giá trị chắc
 *    chắn không hoạt động.
 *  - `\` — một số trình duyệt chuẩn hoá dấu gạch chéo ngược thành `/`, đưa
 *    `/\evil.com` trở lại đúng ca tương đối giao thức ở trên.
 *  - `"` và `'` — chúng đóng thuộc tính `href` và cho phép thêm thuộc tính mới
 *    (`onerror=…`) hoặc thoát khỏi thẻ.
 *  - `<` và `>` — thoát khỏi thẻ.
 *  - ký tự điều khiển (gồm CR/LF và TAB) — vừa để chèn header, vừa để nhét
 *    `java\tscript:` qua phép kiểm scheme.
 *
 * Trả `null` chứ **không** trả chuỗi rỗng: nơi gọi phải phân biệt được "không có
 * giá trị dùng được, hãy lùi về mặc định" với "cán bộ cố ý để trống".
 */
export function safeFaviconUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const candidate = value.trim()
  if (!candidate || candidate.length > MAX_FAVICON_URL_LENGTH) return null

  // Ký tự điều khiển và khoảng trắng bên trong: kiểm TRƯỚC mọi phép so scheme,
  // vì `java\tscript:` chỉ lộ ra là một scheme sau khi tab bị bỏ.
  for (let index = 0; index < candidate.length; index += 1) {
    const code = candidate.charCodeAt(index)
    if (code <= 0x20 || code === 0x7f) return null
  }

  if (candidate.includes('\\')) return null
  if (candidate.includes('"') || candidate.includes("'")) return null
  if (candidate.includes('<') || candidate.includes('>')) return null

  // Nhánh 1: đường dẫn tương đối. Đúng MỘT dấu gạch chéo đầu.
  if (candidate[0] === '/') {
    if (candidate[1] === '/') return null
    // Không cho scheme lẫn vào sau dấu gạch đầu, và không cho userinfo.
    if (candidate.includes(':') || candidate.includes('@')) return null
    return candidate
  }

  // Nhánh 2: HTTPS tuyệt đối — thứ mà lưu trữ R2 sinh ra.
  // So bằng chữ thường vì scheme không phân biệt hoa thường; phần còn lại của
  // URL thì có, nên giá trị **gốc** mới là giá trị được trả về.
  const lowered = candidate.toLowerCase()
  if (!lowered.startsWith('https://')) return null

  // `https://` mà không có host là một URL không dẫn tới đâu.
  const afterScheme = candidate.slice('https://'.length)
  if (!afterScheme || afterScheme[0] === '/' || afterScheme[0] === '@') return null

  // Một `@` trong phần host biến phần trước nó thành userinfo, tức là host thật
  // nằm ở chỗ khác so với chỗ người đọc cấu hình tưởng.
  const hostEnd = afterScheme.search(/[/?#]/)
  const host = hostEnd === -1 ? afterScheme : afterScheme.slice(0, hostEnd)
  if (!host || host.includes('@')) return null

  return candidate
}

/**
 * Thuộc tính `type` cho thẻ `<link>`, hoặc `null` để **bỏ hẳn** thuộc tính đó.
 *
 * Trả `null` thay vì đoán một giá trị mặc định: một `type` khai sai còn tệ hơn
 * không khai gì cả, vì trình duyệt dùng nó để chọn giữa nhiều thẻ icon và một
 * nhãn sai sẽ khiến nó bỏ qua đúng tệp đang dùng được. Không có `type`, trình
 * duyệt tự dò theo nội dung — đó là hành vi đúng khi mình không biết chắc.
 *
 * Đuôi tệp đọc sau khi đã cắt query và fragment: `/x.png?v=2` vẫn là PNG.
 */
export function faviconMimeType(url: string): string | null {
  const withoutQuery = url.split(/[?#]/)[0] ?? ''
  const lowered = withoutQuery.toLowerCase()

  if (lowered.endsWith('.png')) return 'image/png'
  if (lowered.endsWith('.ico')) return 'image/x-icon'
  if (lowered.endsWith('.gif')) return 'image/gif'
  if (lowered.endsWith('.jpg') || lowered.endsWith('.jpeg')) return 'image/jpeg'
  if (lowered.endsWith('.webp')) return 'image/webp'

  // Cố ý KHÔNG có nhánh `.svg`: một favicon SVG là một tài liệu thực thi được,
  // và `safeFaviconUrl` đã không nhận `data:image/svg+xml`. Khai `type` cho nó ở
  // đây sẽ là mời một lần refactor sau này nhận luôn cả tệp .svg.
  return null
}

/** Một thẻ `<link>` icon, ở dạng dữ liệu — nơi gọi mới dựng ra chuỗi HTML. */
export interface FaviconTag {
  rel: string
  href: string
  type?: string
  sizes?: string
}

/**
 * Bộ thẻ icon cho một giá trị `favicon_url` **bất kỳ**.
 *
 * **Tự gọi `safeFaviconUrl`, không tin nơi gọi đã gọi.** Bản đầu nhận một URL "đã
 * được chấp nhận" và điều đó là một hợp đồng chỉ tồn tại trong lời văn: nơi gọi
 * thứ hai — một endpoint, một script, một trang sinh HTML nào đó về sau — không có
 * gì nhắc nó phải validate trước. Hàm này là chỗ **duy nhất** dựng ra thẻ icon,
 * nên đặt phép kiểm ở đây khiến mọi đường đi tới HTML đều đã qua nó. Nhận mọi đầu
 * vào và luôn trả giá trị an toàn, nên không có cách gọi sai.
 *
 * Trả **dữ liệu**, không trả chuỗi HTML: phần quyết định "những thẻ nào, mang
 * thuộc tính gì" kiểm được bằng một phép so object thay vì dò chuỗi, và phần nội
 * suy vào HTML (kèm `escapeHtml`) nằm gọn ở nơi gọi.
 *
 * **Icon iOS đi theo favicon đã cấu hình**, không cố định vào tệp mặc định. Cán bộ
 * đặt icon riêng thì màn hình chính iOS phải hiện đúng icon đó — một cổng mang hai
 * bộ nhận diện khác nhau tuỳ chỗ nhìn là điều không có gì trên trang cài đặt nói
 * ra được. iOS tự co giãn, và biểu mẫu đã khuyên dùng ảnh 512×512; một icon hơi
 * mờ vẫn là icon đúng, còn một icon mặc định nằm cạnh logo mới của cơ quan thì
 * không. Bản 180×180 chỉ dùng khi favicon **vẫn là mặc định**, vì lúc đó ta biết
 * chắc mình có sẵn bản đúng cỡ trên đĩa.
 */
export function buildFaviconTags(value: unknown): FaviconTag[] {
  const url = safeFaviconUrl(value) ?? DEFAULT_FAVICON_URL

  // Icon iOS đi theo favicon đã cấu hình. Chỉ khi cổng còn dùng bộ mặc định thì
  // mới trỏ sang bản 180×180 — đó là lúc duy nhất ta BIẾT CHẮC có tệp đúng cỡ
  // trên đĩa. Với icon cán bộ tải lên, một ảnh 32px bị iOS phóng to sẽ hơi mờ,
  // nhưng bỏ thẻ này đi thì màn hình chính lùi về icon mặc định — tức là logo cũ
  // của cổng nằm cạnh logo mới của cơ quan, và không có gì trên trang cài đặt
  // nói ra điều đó. Icon hơi mờ vẫn là icon đúng.
  const appleHref = url === DEFAULT_FAVICON_URL ? DEFAULT_APPLE_ICON_URL : url

  const icon: FaviconTag = { rel: 'icon', href: url }
  const iconType = faviconMimeType(url)
  if (iconType) icon.type = iconType

  const apple: FaviconTag = { rel: 'apple-touch-icon', href: appleHref, sizes: '180x180' }

  return [icon, apple]
}
