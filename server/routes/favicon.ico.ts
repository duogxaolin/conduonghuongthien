import { createReadStream, statSync } from 'node:fs'
import path from 'node:path'

import { DEFAULT_ICO_FILENAME } from '../utils/favicon-image'
import { loadFaviconSetting } from '../utils/favicon-setting'

/**
 * `/favicon.ico` — đường dẫn mà máy quét gọi TRỰC TIẾP, không đọc thẻ `<link>`.
 *
 * Thẻ `<link rel="icon">` do `server/plugins/favicon.ts` chèn chỉ phục vụ những
 * nơi phân tích HTML. Trình duyệt cũ, đầu đọc RSS, phần mềm gom tin và phần lớn
 * bộ dò liên kết thì gọi thẳng `/favicon.ico`. Không có tuyến này, đường dẫn đó
 * phục vụ **một thứ cố định** trong khi cán bộ đã cấu hình icon khác — và favicon
 * bị đệm rất lâu nên lần đọc sai đó đọng lại rất dai.
 *
 * ⚠️ **KHÔNG được để một tệp tên `favicon.ico` trong `public/`.** Đã đo trên bản
 * build, và cả hai kết quả đều phản trực giác:
 *
 *  - Tệp tĩnh có mặt lúc build → middleware tài nguyên tĩnh **thắng** tuyến này,
 *    nên hàm dưới đây **không bao giờ chạy** và cấu hình bị bỏ qua trong im lặng.
 *  - Tệp có lúc build rồi mất lúc chạy → manifest tĩnh vẫn khai nó còn, `readFile`
 *    ném `ENOENT`, và khách nhận **500**, không phải 404.
 *
 * Vì vậy bộ mặc định mang tên `favicon-default.ico` (xem `DEFAULT_ICO_FILENAME`),
 * và `scripts/make-favicon.ts` ghi ra đúng tên đó.
 *
 * Không bao giờ ném ra ngoài: mọi nhánh lỗi lùi về tệp mặc định. Một favicon
 * không có tư cách trả lỗi cho khách.
 */

/**
 * Đúng **một** kiểu ra khỏi tuyến này: ICO.
 *
 * Từng có thêm `PNG_MIME` cho nhánh "icon cục bộ bất kỳ", và nhánh đó là lỗi đo
 * được — xem lời giải thích ở chỗ chọn ứng viên bên dưới. Một đường dẫn tên `.ico`
 * phục vụ đúng một định dạng thì không có gì để chọn sai.
 */
const ICO_MIME = 'image/vnd.microsoft.icon'

/**
 * Đệm ngắn, KHÔNG `immutable`.
 *
 * Đường dẫn này là cố định trong khi nội dung nó phục vụ **đổi được từ trang quản
 * trị**, nên `max-age=31536000, immutable` (đúng cho `/uploads/**`, nơi tên tệp có
 * dấu thời gian) sẽ ghim icon cũ trong máy khách suốt một năm. Một giờ là đủ để
 * không phải đọc CSDL mỗi lượt, và đủ ngắn để một lần đổi icon còn tới được người
 * đã ghé qua.
 */
const CACHE_CONTROL = 'public, max-age=3600'

/** Đường dẫn tuyệt đối của một URL cục bộ dạng `/uploads/...` hoặc `/favicon-*`. */
function resolvePublicPath(url: string): string | null {
  if (!url.startsWith('/')) return null

  // Bỏ query/fragment trước khi ghép đường dẫn: `?v=2` là một phần của URL, không
  // phải một phần của tên tệp trên đĩa.
  const clean = url.split(/[?#]/)[0] ?? ''
  if (!clean || clean.includes('..')) return null

  const publicRoot = path.resolve(process.cwd(), 'public')
  const resolved = path.resolve(publicRoot, `.${clean}`)

  // Cùng phép kiểm mà `server/routes/uploads/[...path].ts` dùng: một đường dẫn đã
  // resolve phải còn nằm trong thư mục gốc, nếu không thì nó đã đi ra ngoài.
  if (!resolved.startsWith(publicRoot + path.sep)) return null

  return resolved
}

export default defineEventHandler(async (event) => {
  const publicRoot = path.resolve(process.cwd(), 'public')
  const fallback = path.join(publicRoot, DEFAULT_ICO_FILENAME)

  /** Ứng viên theo thứ tự ưu tiên: bản `.ico` đã cấu hình, rồi bộ mặc định. */
  const candidates: Array<{ file: string, mime: string }> = []

  try {
    const { icoUrl, iconUrl } = await loadFaviconSetting()

    // Bản `.ico` do endpoint sinh ra là ứng viên đầu — đúng định dạng cho đường
    // dẫn này, và là thứ mọi máy quét mong đợi ở đây.
    const icoPath = icoUrl ? resolvePublicPath(icoUrl) : null
    if (icoPath) candidates.push({ file: icoPath, mime: ICO_MIME })

    /**
     * Icon cục bộ chỉ là ứng viên khi nó **thật là `.ico`** — ví dụ cán bộ tải một
     * tệp `.ico` qua Thư viện Media rồi dán URL vào ô.
     *
     * ⚠️ Nhận cả PNG ở đây là một lỗi ĐO ĐƯỢC, không phải một khả năng lý thuyết.
     * Bản đầu phục vụ bất kỳ icon cục bộ nào và tự gắn `image/png` khi cần; với
     * hàng seed `favicon_url = '/favicon-32.png'` thì `/favicon.ico` trả
     * `content-type: image/png`, 2213 byte. Máy quét, đầu đọc RSS và trình duyệt cũ
     * gọi đường dẫn này **để lấy ICO**; phần lớn chấp nhận PNG, nhưng chính những
     * chương trình cũ là lý do tuyến này tồn tại thì không.
     *
     * Bộ mặc định `favicon-default.ico` luôn là lưới cuối, nên thu hẹp ở đây không
     * dẫn tới nhánh "không có icon nào" — nó chỉ đổi một ICO **sai định dạng**
     * thành một ICO đúng định dạng nhưng là logo mặc định của cổng. Muốn `.ico`
     * khớp với icon đã đặt thì dùng nút "Tải ảnh & tự tạo": nó sinh cả ba tệp và
     * ghi `favicon_ico_url`, tức ứng viên đầu ở trên.
     */
    const iconPath = resolvePublicPath(iconUrl)
    if (iconPath && iconPath.toLowerCase().endsWith('.ico')) {
      candidates.push({ file: iconPath, mime: ICO_MIME })
    }
  } catch {
    // Lỗi CSDL: bỏ qua phần cấu hình và đi tiếp tới tệp mặc định bên dưới.
  }

  candidates.push({ file: fallback, mime: ICO_MIME })

  for (const candidate of candidates) {
    let size: number
    try {
      const stat = statSync(candidate.file)
      if (!stat.isFile()) continue
      size = stat.size
    } catch {
      // Cấu hình trỏ tới một tệp đã bị xoá khỏi Thư viện Media. Đi tiếp tới ứng
      // viên sau thay vì trả 404 — cổng vẫn còn một icon dùng được trên đĩa.
      continue
    }

    setResponseHeaders(event, {
      'Content-Type': candidate.mime,
      'Content-Length': String(size),
      'Cache-Control': CACHE_CONTROL,
      // Byte ở đây là ảnh; không cho trình duyệt diễn giải lại thành gì khác.
      'X-Content-Type-Options': 'nosniff',
    })

    return sendStream(event, createReadStream(candidate.file))
  }

  // Tới được đây nghĩa là cả tệp mặc định cũng không có — bản build thiếu tệp,
  // chứ không phải một lượt request sai. Nói ra thay vì trả một tệp rỗng dưới
  // nhãn ảnh, vì đúng cái đó là lỗi gốc mà cả việc này ra đời để dứt điểm.
  throw createError({
    statusCode: 404,
    statusMessage: `Thiếu ${DEFAULT_ICO_FILENAME} — chạy: npm run make:favicon`,
  })
})
