/**
 * Sinh bộ favicon mặc định từ `public/Logo.png`.
 *
 * Lý do script này tồn tại, chứ không phải ba tệp nhị phân được commit vào rồi
 * không ai biết từ đâu ra: tệp `public/favicon.ico` cũ **không phải một icon**.
 * Nó là một trang HTML (4 byte đầu là `3c 21 44 4f` — `<!DO`, mở đầu một
 * `<!DOCTYPE html>`), lọt vào từ commit đầu tiên của dự án và nằm đó cho tới khi
 * được đo. Máy chủ vẫn trả `200` kèm `content-type: image/vnd.microsoft.icon`,
 * thẻ `<link rel="icon">` vẫn có trong HTML, không có lỗi nào ở đâu — nên cổng
 * chạy nhiều tháng **không có favicon nào hoạt động** mà không có gì chỉ ra.
 *
 * Một tệp nhị phân trong git không nói được nó là gì. Một script thì nói được, và
 * chạy lại được khi logo đổi:
 *
 *     npm run make:favicon
 *
 * Ghi ra ba tệp, và **cả ba đều có nơi gọi thật** (không có tệp dự phòng):
 *  - `public/favicon-32.png`  — thẻ `<link rel="icon">`
 *  - `public/favicon-180.png` — `apple-touch-icon`, màn hình chính iOS
 *  - `public/favicon-default.ico` — bộ mặc định cho tuyến `/favicon.ico`
 *
 * ⚠️ **Tên `favicon-default.ico` là bắt buộc, không phải tuỳ ý.** Đã đo trên bản
 * build: một tệp tĩnh ở `public/favicon.ico` **thắng** route handler, nên đặt tên
 * đó là làm tuyến `/favicon.ico` không bao giờ chạy — favicon cán bộ cấu hình sẽ
 * bị bỏ qua ở đúng đường dẫn mà máy quét và đầu đọc RSS gọi tới. Tệ hơn: nếu tệp
 * có lúc build rồi mất lúc chạy, manifest tĩnh vẫn khai nó còn và `readFile` ném
 * `ENOENT` → **500**, không phải 404.
 *
 * Phần dựng ảnh nằm ở `server/utils/favicon-image.ts` để script này và endpoint
 * quản trị dùng **một** bản. Hai bản là hai chỗ để làm sai một biên little-endian
 * trong vỏ ICO, và lỗi đó im lặng: trình duyệt bỏ qua tệp mà không báo gì.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_ICO_FILENAME, buildFaviconSet } from '../server/utils/favicon-image'

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const SOURCE = join(PUBLIC_DIR, 'Logo.png')

const main = async () => {
  if (!existsSync(SOURCE)) {
    console.error(`✗ không tìm thấy ${SOURCE}`)
    process.exit(1)
  }

  // `buildFaviconSet` nhận **byte**, không nhận đường dẫn: endpoint quản trị luôn
  // đã có buffer trong tay (từ multipart, hoặc từ tệp trong Thư viện Media), nên
  // một chữ ký nhận đường dẫn sẽ buộc nơi gọi đó ghi ra tệp tạm chỉ để đọc lại.
  const { png32, png180, ico } = await buildFaviconSet(readFileSync(SOURCE))

  const outputs: Array<[string, Buffer]> = [
    ['favicon-32.png', png32],
    ['favicon-180.png', png180],
    [DEFAULT_ICO_FILENAME, ico],
  ]

  for (const [file, bytes] of outputs) {
    writeFileSync(join(PUBLIC_DIR, file), bytes)
    console.log(`✓ ${file} (${bytes.length} byte)`)
  }

  console.log('\nXong. `server/plugins/favicon.ts` chèn thẻ; `server/routes/favicon.ico.ts` phục vụ đường dẫn trực tiếp.')
}

main().catch((err) => {
  console.error('✗ sinh favicon thất bại:', err)
  process.exit(1)
})
