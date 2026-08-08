/**
 * Nhận diện định dạng ảnh theo **magic byte**, không theo tên tệp hay header client.
 *
 * Tách ra vì có **hai** đường ghi cần đúng phép kiểm này: `/api/admin/media/upload`
 * (Thư viện Media) và `/api/admin/settings/favicon` (sinh bộ favicon). Hai bản
 * riêng là hai danh sách định dạng sẽ lệch nhau, và dự án vừa trả giá cho đúng
 * hình dạng đó ở `.ico`: đường tải lên nhận nó trong khi đường phục vụ không —
 * tệp lưu thành công rồi không bao giờ hiện được.
 *
 * Tên tệp và `Content-Type` do client gửi đều **không** được tin: một request khai
 * `application/pdf` với tên `x.svg` mà được lưu theo tên sẽ phục vụ lại dưới
 * `image/svg+xml`, tức một tài liệu chạy được trên origin của cổng.
 */

/** Định dạng ảnh được nhận, và **cố ý không có `image/svg+xml`**.
 *
 *  SVG là tài liệu chạy được (nó chứa `<script>` được); ICO là thùng chứa ảnh
 *  raster. Đó là tiêu chí phân biệt — không phải "định dạng nào quen hơn" — và nó
 *  được ghi lại vì lần nới tiếp theo sẽ được lập luận bằng chính tiền lệ `.ico`. */
export type DetectedImageMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp'
  | 'image/x-icon'

/**
 * MIME thật của một buffer ảnh, hoặc `null` nếu không nhận ra.
 *
 * `null` nghĩa là "không nhận ra", **không** phải "hỏng" — nơi gọi quyết định trả
 * 415 hay đi nhánh khác. Không đoán tiếp: một định dạng không nhận ra mà vẫn được
 * lưu là đúng chỗ mà phép kiểm này ra đời để chặn.
 */
export function detectImageMime(buf: Buffer): DetectedImageMime | null {
  if (buf.length < 4) return null

  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg'

  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png'

  // GIF: 47 49 46
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'

  // WebP: 52 49 46 46 ... 57 45 42 50 (RIFF....WEBP)
  if (buf.length >= 12
      && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp'

  // ICO: 00 00 01 00 (reserved=0, type=1 "icon" — type 2 là con trỏ chuột).
  // Nhận vì với cán bộ đang cầm một tệp favicon thì "favicon" **là** tệp `.ico`,
  // và từ chối đúng tệp họ có bằng câu "không phải là ảnh hợp lệ" là một ngõ cụt
  // không có đường ra.
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image/x-icon'

  return null
}

/**
 * Đuôi tệp suy từ MIME **đã kiểm**, không bao giờ từ tên tệp client gửi.
 *
 * Bảng này là lý do đuôi tệp trên đĩa không thể nói khác nội dung của nó.
 */
export const EXT_BY_IMAGE_MIME: Record<DetectedImageMime, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/x-icon': '.ico',
}

/**
 * sharp giải mã được định dạng này hay không.
 *
 * `image/x-icon` là `false`: sharp **không** đọc được ICO (đã kiểm — `ico` không có
 * trong `sharp.format`). Đưa một ICO vào sharp thì lời gọi "chạy được" vì khối
 * `try/catch` quanh nó nuốt lỗi giải mã, và đó là dạng no-op mời một lần refactor
 * sau này dời logic thật vào một nhánh không bao giờ chạy.
 */
export function isSharpDecodable(mime: DetectedImageMime): boolean {
  return mime !== 'image/x-icon'
}
