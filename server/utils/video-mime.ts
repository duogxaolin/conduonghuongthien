/**
 * Nhận diện **thùng chứa video** theo magic byte, không theo tên tệp hay
 * `Content-Type` client khai.
 *
 * Tách ra vì có **hai** đường cần đúng phép kiểm này: đường nhận từng phần của
 * tải lên (ghép xong mới kiểm, xem `server/services/chunked-upload.ts`) và đường
 * xử lý nền trước khi gọi FFmpeg. Hai bản riêng là hai danh sách định dạng sẽ
 * lệch nhau — và dự án vừa trả giá cho đúng hình dạng đó ở `.ico`: đường tải lên
 * nhận nó trong khi đường phục vụ không, tệp lưu thành công rồi không bao giờ
 * hiện được.
 *
 * Tên tệp và `Content-Type` do client gửi đều **không** được tin. Một tệp tên
 * `phim.mp4` mang nội dung khác không phải một video hỏng — nó là một tệp không
 * phải video, và câu trả lời đúng là từ chối nó **trước** khi nó chiếm chỗ trong
 * thư mục làm việc và trước khi một hàng `media_items` được tạo cho nó.
 *
 * **Tiêu chí nhận một định dạng là "FFmpeg đọc được nó và nó là thùng chứa
 * video", không phải "định dạng nào quen hơn".** Đây là điểm khác với
 * `image-mime.ts`, nơi tiêu chí là "tài liệu chạy được hay không" (lý do `.svg`
 * bị loại). Khi `MEDIA_AUTO_TRANSCODE=true` (mặc định), tệp gốc chỉ được FFmpeg
 * đọc để đóng gói lại thành HLS — không bao giờ được phục vụ trực tiếp. Khi
 * `autoTranscode=false`, tệp gốc **được phục vụ** qua stream endpoint (byte-range),
 * nên câu hỏi "trình duyệt có chạy được nó không" nay có đặt ra — nhưng FFmpeg
 * vẫn là tiêu chí nhận ở cổng vào. Matroska nằm trong danh sách vì FFmpeg đọc
 * được nó; `.mkv` gốc có thể trình duyệt không phát được, nhưng nhận nó vào để
 * transcode HLS là hợp lệ.
 */

/** Thùng chứa video được nhận. */
export type DetectedVideoMime =
  | 'video/mp4'
  | 'video/quicktime'
  | 'video/webm'
  | 'video/x-matroska'

/**
 * Số byte đầu cần đọc để nhận diện.
 *
 * Hằng số này tồn tại vì tệp ở đây nặng hàng trăm MB tới vài GB: `readFile` để
 * lấy 12 byte đầu là nạp cả tệp vào bộ nhớ, trên đúng loại VPS 1–2 GB mà dự án
 * nhắm tới. Nơi gọi mở một luồng và đọc **đúng** ngần này byte.
 *
 * 64 đủ cho cả hai họ: `ftyp` nằm ở byte 4–7, còn DocType của EBML nằm trong
 * khoảng 40 byte đầu của phần tử `EBML` (kích thước của nó rất nhỏ trong thực tế).
 */
export const VIDEO_SNIFF_BYTES = 64

/** Byte mở đầu của mọi tệp EBML — WebM và Matroska đều là EBML. */
const EBML_MAGIC = [0x1A, 0x45, 0xDF, 0xA3]

/**
 * Các nguyên tử (atom) cấp cao nhất của QuickTime đời cũ.
 *
 * Tệp `.mov` do công cụ cũ sinh ra **không có** hộp `ftyp`: chúng mở đầu thẳng
 * bằng `moov` hoặc `mdat`. Từ chối chúng vì thiếu `ftyp` là từ chối những tệp
 * quay bằng máy ảnh và điện thoại vài năm trước — đúng nhóm tệp mà cán bộ đang
 * có sẵn trong tay.
 *
 * `mdat`, `free`, `skip` là những tên nguyên tử chung, nên chúng chỉ được nhận
 * khi **kèm** cấu trúc hộp hợp lệ ở `hasValidBoxSize` — bốn ký tự ở offset 4 một
 * mình là một phép kiểm quá yếu để đứng độc lập.
 */
const QUICKTIME_ATOMS = ['moov', 'mdat', 'wide', 'free', 'skip', 'pnot']

/** Kích thước hộp (4 byte đầu) có hợp lệ không.
 *
 *  Một hộp ISO/QuickTime mang kích thước 32-bit big-endian ở bốn byte đầu, và
 *  giá trị đó phải là `1` (kích thước mở rộng 64-bit theo sau), `0` (hộp chạy tới
 *  hết tệp), hoặc ít nhất `8` (bốn byte kích thước + bốn byte tên). Bất cứ giá
 *  trị nào khác nghĩa là bốn ký tự ta vừa đọc không phải một tên nguyên tử mà chỉ
 *  là một chuỗi trùng ngẫu nhiên. */
function hasValidBoxSize(buf: Buffer): boolean {
  const size = buf.readUInt32BE(0)
  return size === 0 || size === 1 || size >= 8
}

/** Bốn byte tại `offset` có đúng bằng chuỗi ascii này không. */
function matchesAscii(buf: Buffer, offset: number, text: string): boolean {
  if (buf.length < offset + text.length) return false
  for (let i = 0; i < text.length; i++) {
    if (buf[offset + i] !== text.charCodeAt(i)) return false
  }
  return true
}

/** Mọi byte trong khoảng đều là ascii in được — dùng cho nhãn thương hiệu. */
function isPrintableAscii(buf: Buffer, offset: number, length: number): boolean {
  if (buf.length < offset + length) return false
  for (let i = offset; i < offset + length; i++) {
    const byte = buf[i]!
    if (byte < 0x20 || byte > 0x7E) return false
  }
  return true
}

/**
 * MIME thật của một buffer video, hoặc `null` nếu không nhận ra.
 *
 * `null` nghĩa là "không nhận ra", **không** phải "hỏng" — nơi gọi quyết định
 * thông báo nào hiện cho cán bộ. Không đoán tiếp: một thùng chứa không nhận ra mà
 * vẫn được đưa vào FFmpeg là đúng thứ phép kiểm này ra đời để chặn, vì lời gọi
 * đó thất bại **sau** khi đã chiếm chỗ đĩa và đã tạo một hàng media.
 */
export function detectVideoMime(buf: Buffer): DetectedVideoMime | null {
  // Ngắn hơn một hộp ISO nhỏ nhất thì không thể là thùng chứa nào ở đây.
  if (buf.length < 12) return null

  // ── Họ EBML: WebM và Matroska ─────────────────────────────────────────────
  if (EBML_MAGIC.every((byte, index) => buf[index] === byte)) {
    // DocType nằm trong phần tử `EBML` ngay sau magic, dưới dạng ascii thô. Quét
    // trong cửa sổ đã đọc thay vì giải mã EBML đầy đủ: điều cần phân biệt chỉ là
    // hai chuỗi, và một bộ giải mã EBML là một phụ thuộc lớn hơn nhiều so với giá
    // trị nó mang lại ở đây.
    const window = buf.subarray(0, Math.min(buf.length, VIDEO_SNIFF_BYTES))
    // `matroska` kiểm trước `webm`: một tệp Matroska có thể chứa chuỗi `webm`
    // trong tên TrackCodec, còn DocType thì chỉ có một.
    if (window.includes('matroska')) return 'video/x-matroska'
    if (window.includes('webm')) return 'video/webm'
    // Magic EBML đúng nhưng không có DocType trong cửa sổ: không kết luận. Một
    // tệp EBML không rõ loại có thể là tài liệu chứ không phải video, và đoán
    // "webm" ở đây là nhận một thứ ta chưa nhận diện được.
    return null
  }

  // ── Họ ISO base media: MP4 và QuickTime ───────────────────────────────────
  if (matchesAscii(buf, 4, 'ftyp') && hasValidBoxSize(buf)) {
    // Nhãn thương hiệu ở byte 8–11. Phải in được: một tệp ngẫu nhiên chứa đúng
    // chuỗi `ftyp` ở offset 4 mà nhãn là byte nhị phân không phải một tệp media.
    if (!isPrintableAscii(buf, 8, 4)) return null
    // `qt  ` (có hai dấu cách đệm) là nhãn của QuickTime. Mọi nhãn ISO khác —
    // `isom`, `mp42`, `avc1`, `dash`, `M4V `, và cả những nhãn ra đời sau này —
    // đều là MP4: chúng chia cùng cấu trúc hộp, và một danh sách nhãn đóng sẽ từ
    // chối những thương hiệu hợp lệ mới mà FFmpeg đọc được.
    return matchesAscii(buf, 8, 'qt  ') ? 'video/quicktime' : 'video/mp4'
  }

  // QuickTime đời cũ, không có hộp `ftyp`.
  if (hasValidBoxSize(buf)) {
    for (const atom of QUICKTIME_ATOMS) {
      if (matchesAscii(buf, 4, atom)) return 'video/quicktime'
    }
  }

  return null
}

/**
 * Đuôi tệp suy từ MIME **đã kiểm**, không bao giờ từ tên tệp client gửi.
 *
 * Bảng này là lý do đuôi tệp trên đĩa không thể nói khác nội dung của nó — và ở
 * đây điều đó còn quan trọng hơn ở ảnh, vì FFmpeg chọn bộ giải mã theo **nội
 * dung**, nhưng con người đọc nhật ký và thư mục làm việc thì đọc theo đuôi tệp.
 * Một tệp `.mov` chứa MP4 nằm trong nhật ký dưới tên `.mp4` là một sự thật, không
 * phải một lời nói dối tiện lợi.
 */
export const EXT_BY_VIDEO_MIME: Record<DetectedVideoMime, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
}

/**
 * Nội dung phục vụ cho mỗi thùng chứa — bảng thứ hai của cùng một allowlist.
 *
 * Hai cổng ra, không phải một:
 *   • **HLS** (mặc định, `MEDIA_AUTO_TRANSCODE=true`): FFmpeg phát `video/mp2t` +
 *     `application/vnd.apple.mpegurl`, bảng này đối chiếu được với cổng vào.
 *   • **Tệp gốc** (`MEDIA_AUTO_TRANSCODE=false`): stream endpoint phục vụ
 *     `original.<ext>` trực tiếp qua byte-range khi không có rendition. Định dạng
 *     nhận ở cổng vào mà thiếu loại nội dung ở cổng ra là định dạng chưa thật sự
 *     được nhận — đúng dạng hỏng đã xảy ra với `.ico` (nhận `.mov`/`.mkv` ở upload
 *     nhưng `STREAM_CONTENT_TYPES` không có chúng → `octet-stream` + `nosniff` =
 *     trình duyệt tải về thay vì phát).
 *
 * Bảng này ghi lại nội dung phục vụ của **cả hai** cổng ra, không phải chỉ HLS.
 */
export const STREAM_CONTENT_TYPE = 'application/vnd.apple.mpegurl'
export const SEGMENT_CONTENT_TYPE = 'video/mp2t'

/** Danh sách thùng chứa được nhận, để nơi khác (thông báo lỗi, tài liệu) không
 *  phải viết lại lần thứ hai — bản sao thứ hai là bản sẽ lệch. */
export const SUPPORTED_VIDEO_MIMES: readonly DetectedVideoMime[] = Object.keys(EXT_BY_VIDEO_MIME) as DetectedVideoMime[]

/** Câu thông báo cho cán bộ khi nội dung không nhận ra. Một chỗ duy nhất, để
 *  đường tải lên và đường xử lý nền nói cùng một câu. */
export const UNSUPPORTED_VIDEO_MESSAGE =
  'Tệp không phải là định dạng video được hỗ trợ (MP4, MOV, WebM, MKV). '
  + 'Kiểm tra lại tệp — đuôi tệp không được dùng để nhận diện.'
