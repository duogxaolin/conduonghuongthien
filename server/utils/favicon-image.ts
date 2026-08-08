/**
 * Dựng bộ favicon từ một ảnh nguồn — phần chạm byte ảnh.
 *
 * **Cố ý tách khỏi `server/utils/favicon.ts`.** Tệp kia là logic thuần về URL và
 * thẻ `<link>`, và nó được `server/plugins/favicon.ts` import trên **mọi** lượt
 * dựng trang. Gộp hai phần lại là kéo `sharp` (một thư viện ảnh gốc, nặng) vào
 * đồ thị import của một plugin chỉ cần nối hai chuỗi.
 *
 * Hai nơi gọi dùng **cùng** mã ở đây: `scripts/make-favicon.ts` sinh bộ mặc định
 * đi kèm mã nguồn, và endpoint quản trị sinh bộ từ ảnh cán bộ tải lên. Hai bản
 * riêng là hai chỗ để viết sai một biên little-endian, và một vỏ ICO sai thứ tự
 * byte thì trình duyệt **lặng lẽ bỏ qua** — đúng loại hỏng mà cả việc này ra đời
 * để dứt điểm.
 */
import sharp from 'sharp'

/**
 * 32px là cỡ tab/bookmark; 180px là cỡ `apple-touch-icon`.
 *
 * Chỉ hai cỡ, không phải một dải đầy đủ: mỗi cỡ thêm vào là một thẻ `<link>` nữa
 * trên **mọi** trang của cổng, và không cỡ nào trong dải đó được đối chiếu với
 * một bề mặt thật đang cần nó.
 */
export const FAVICON_PNG_SIZE = 32
export const FAVICON_APPLE_SIZE = 180

/**
 * Tên tệp của bộ `.ico` mặc định đi kèm mã nguồn.
 *
 * ⚠️ **KHÔNG được đổi thành `favicon.ico`.** Đã đo trên bản build: một tệp tĩnh ở
 * `public/favicon.ico` **thắng** route handler cùng đường dẫn, nên đặt tên đó là
 * làm tuyến `/favicon.ico` không bao giờ chạy — và favicon cán bộ cấu hình bị bỏ
 * qua ở đúng đường dẫn mà máy quét, đầu đọc RSS và trình duyệt cũ gọi **trực
 * tiếp** (chúng không đọc thẻ `<link>`).
 *
 * Còn một cách hỏng tệ hơn: tệp có mặt lúc build rồi mất lúc chạy thì manifest
 * tĩnh vẫn khai nó còn, `readFile` ném `ENOENT`, và khách nhận **500** chứ không
 * phải 404.
 *
 * Hằng số này là lý do tên đó chỉ tồn tại ở **một** chỗ: script sinh tệp và
 * tuyến đọc tệp cùng đọc từ đây, nên chúng không thể lệch nhau.
 */
export const DEFAULT_ICO_FILENAME = 'favicon-default.ico'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Kích thước thật của một PNG, đọc từ chunk IHDR.
 *
 * Có hàm này để `wrapPngAsIco` **không nhận** kích thước làm tham số. Một lời gọi
 * `wrapPngAsIco(png180, 32)` sẽ dựng ra tệp ICO khai 32×32 mà bên trong là ảnh
 * 180×180 — trình duyệt thường vẫn vẽ được nên không có gì báo, và tệp thì sai.
 * Đọc từ chính byte ảnh khiến cách gọi sai đó không tồn tại.
 *
 * IHDR nằm ở vị trí cố định: 8 byte chữ ký, 4 byte độ dài chunk, 4 byte tên
 * chunk, rồi chiều rộng và chiều cao ở dạng số nguyên **big-endian** (PNG dùng
 * big-endian; vỏ ICO ngay dưới thì dùng little-endian — hai chuẩn khác nhau
 * trong cùng một tệp là chỗ dễ lẫn nhất ở đây).
 */
function readPngSize(png: Buffer): { width: number, height: number } {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Không phải PNG: không đọc được kích thước để dựng vỏ ICO.')
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/**
 * Bọc một PNG vào vỏ ICO một-ảnh.
 *
 * Cấu trúc ICO: tiêu đề 6 byte, một mục thư mục 16 byte cho mỗi ảnh, rồi phần dữ
 * liệu ảnh. Cả tiêu đề và mục thư mục là số nguyên **little-endian**.
 *
 * 4 byte đầu của kết quả là `00 00 01 00`, khớp đúng phép kiểm magic-byte mà
 * `server/api/admin/media/upload.post.ts` dùng để nhận `.ico` — nên bộ mặc định
 * đi kèm mã nguồn và tệp cán bộ tải lên được nhận diện bằng **cùng một** phép
 * kiểm, không phải hai đường riêng.
 *
 * Bọc thẳng PNG vào (không mã hoá lại sang BMP) là hợp lệ từ Windows Vista /
 * IE7, và mọi trình duyệt còn nhận bản cập nhật bảo mật đều đọc được. Không dựng
 * lại một bộ mã hoá BMP cho những trình duyệt đã hết được hỗ trợ.
 */
export function wrapPngAsIco(png: Buffer): Buffer {
  const { width, height } = readPngSize(png)

  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved, luôn 0
  header.writeUInt16LE(1, 2) // type 1 = icon (2 = con trỏ chuột)
  header.writeUInt16LE(1, 4) // số ảnh trong tệp

  const entry = Buffer.alloc(16)
  // 0 nghĩa là 256 trong đặc tả ICO — một byte không chứa nổi 256.
  entry.writeUInt8(width >= 256 ? 0 : width, 0)
  entry.writeUInt8(height >= 256 ? 0 : height, 1)
  entry.writeUInt8(0, 2)  // số màu bảng màu — 0 với ảnh true-color
  entry.writeUInt8(0, 3)  // reserved
  entry.writeUInt16LE(1, 4)   // số mặt phẳng màu
  entry.writeUInt16LE(32, 6)  // bit mỗi điểm ảnh (RGBA)
  entry.writeUInt32LE(png.length, 8)                     // dung lượng dữ liệu ảnh
  entry.writeUInt32LE(header.length + entry.length, 12)  // vị trí bắt đầu dữ liệu

  return Buffer.concat([header, entry, png])
}

/**
 * Một ảnh nguồn đưa về PNG vuông đúng cỡ.
 *
 * `fit: 'contain'` + nền trong suốt, **không** `cover`: logo của cổng không vuông
 * (170×144), nên `cover` sẽ cắt mất mép. Một icon bị cắt trông như một icon sai,
 * không như một icon được thu nhỏ.
 *
 * Đầu ra **luôn** là PNG, kể cả khi nguồn là JPEG. JPEG không có kênh alpha, nên
 * giữ nguyên định dạng sẽ biến nền trong suốt thành nền đen — trên một icon
 * 32px thì đó là một ô vuông đen ở mọi tab.
 */
async function renderSquarePng(source: Buffer, size: number): Promise<Buffer> {
  return sharp(source)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

export interface FaviconSet {
  /** Thẻ `rel="icon"` — bản mọi tab dùng. */
  png32: Buffer
  /** `apple-touch-icon` — màn hình chính iOS. */
  png180: Buffer
  /** `/favicon.ico` — đường dẫn mà máy quét và đầu đọc RSS gọi trực tiếp. */
  ico: Buffer
}

/**
 * Bộ ba dẫn xuất từ một ảnh nguồn.
 *
 * Sinh ra thay vì lưu thẳng tệp cán bộ đưa vào, vì một ảnh 1200×800 nặng 400 KB
 * dùng làm favicon là **400 KB tải trên mọi trang** của cổng, và tỉ lệ không
 * vuông thì trình duyệt bóp méo. Cả hai đều không có gì báo.
 *
 * `ico` dùng lại **chính** `png32` làm phần thân, không render lần thứ hai: hai
 * lượt render là hai kết quả có thể lệch nhau, và người phát hiện sẽ là người
 * thấy tab hiện một icon khác với bookmark.
 *
 * Không nhận ICO làm nguồn — sharp không giải mã được định dạng đó (đã kiểm:
 * `ico` không có trong `sharp.format`). Nơi gọi phải chặn trước; xem endpoint
 * `server/api/admin/settings/favicon.post.ts`.
 */
export async function buildFaviconSet(source: Buffer): Promise<FaviconSet> {
  const png32 = await renderSquarePng(source, FAVICON_PNG_SIZE)
  const png180 = await renderSquarePng(source, FAVICON_APPLE_SIZE)
  return { png32, png180, ico: wrapPngAsIco(png32) }
}
