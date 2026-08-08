#!/usr/bin/env node
/**
 * Sinh favicon PNG từ `public/Logo.png`.
 *
 * Lý do script này tồn tại, chứ không phải hai tệp nhị phân được commit vào rồi
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
 *     node scripts/make-favicon.mjs
 *
 * Ghi ra `public/favicon-32.png` (tab, bookmark), `public/favicon-180.png`
 * (apple-touch-icon, màn hình chính iOS) và `public/favicon.ico`.
 *
 * **`.ico` là bắt buộc, không phải để cho đủ bộ.** Thẻ `<link rel="icon">` chỉ
 * phục vụ những nơi đọc HTML; máy quét, đầu đọc RSS, phần mềm gom tin và trình
 * duyệt cũ gọi `/favicon.ico` **trực tiếp**, không đọc thẻ nào. Nếu đường dẫn đó
 * không có tệp thật thì Nitro trả về placeholder có sẵn của nó
 * (`nitropack/dist/runtime/internal/renderer.mjs`): `200` kèm
 * `content-type: image/x-icon`, nhưng thân là **chuỗi văn bản**
 * `data:image/gif;base64,…` chứ không phải byte ảnh. Tức là cùng một kiểu hỏng
 * như tệp HTML cũ — trạng thái đúng, nhãn đúng, byte sai — và favicon bị trình
 * duyệt cache rất lâu, nên một lần đọc sai đọng lại rất dai.
 *
 * sharp **không xuất được** `.ico` (đã kiểm: `ico` không có trong `sharp.format`),
 * nên phần vỏ ICO dựng tay ở `wrapPngAsIco`. Nó bọc thẳng PNG 32×32 vào — đúng
 * chuẩn từ thời Windows Vista / IE7, và mọi trình duyệt còn được hỗ trợ đều đọc
 * được. Không dựng lại một bộ mã hoá BMP cho những trình duyệt không còn nhận
 * bản cập nhật bảo mật nào.
 *
 * Cán bộ **vẫn tải lên được** `.ico` của riêng mình qua Thư viện Media; đây chỉ
 * là bộ mặc định đi kèm mã nguồn.
 */
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const SOURCE = join(PUBLIC_DIR, 'Logo.png')

/**
 * 32px là cỡ tab/bookmark; 180px là cỡ apple-touch-icon.
 *
 * Chỉ hai cỡ, không phải một dải đầy đủ: mỗi cỡ thêm vào là một thẻ `<link>` nữa
 * trên **mọi** trang, và không có cỡ nào trong dải đó được đối chiếu với một bề
 * mặt thật đang cần nó.
 */
const SIZES = [
  { size: 32, file: 'favicon-32.png' },
  { size: 180, file: 'favicon-180.png' },
]

/**
 * Bọc một PNG vào vỏ ICO một-ảnh.
 *
 * Cấu trúc ICO là một tiêu đề 6 byte, rồi một mục thư mục 16 byte cho mỗi ảnh,
 * rồi phần dữ liệu ảnh. Cả tiêu đề và mục thư mục đều là số nguyên
 * **little-endian** — viết ngược thứ tự byte cho ra một tệp mà trình duyệt lặng
 * lẽ bỏ qua, đúng loại hỏng mà cả việc này ra đời để dứt điểm.
 *
 * 4 byte đầu ra là `00 00 01 00`, khớp đúng phép kiểm magic-byte mà
 * `server/api/admin/media/upload.post.ts` dùng để nhận `.ico` — nên bộ mặc định
 * đi kèm mã nguồn và tệp cán bộ tải lên được nhận diện bằng **cùng một** phép
 * kiểm, không phải hai đường riêng.
 */
const wrapPngAsIco = (png, size) => {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved, luôn 0
  header.writeUInt16LE(1, 2) // type 1 = icon (2 = con trỏ chuột)
  header.writeUInt16LE(1, 4) // số ảnh trong tệp

  const entry = Buffer.alloc(16)
  // 0 nghĩa là 256 trong đặc tả ICO; 32 thì ghi thẳng được.
  entry.writeUInt8(size >= 256 ? 0 : size, 0) // chiều rộng
  entry.writeUInt8(size >= 256 ? 0 : size, 1) // chiều cao
  entry.writeUInt8(0, 2) // số màu bảng màu — 0 với ảnh true-color
  entry.writeUInt8(0, 3) // reserved
  entry.writeUInt16LE(1, 4) // số mặt phẳng màu
  entry.writeUInt16LE(32, 6) // bit mỗi điểm ảnh (RGBA)
  entry.writeUInt32LE(png.length, 8) // dung lượng phần dữ liệu ảnh
  entry.writeUInt32LE(header.length + entry.length, 12) // vị trí bắt đầu dữ liệu

  return Buffer.concat([header, entry, png])
}

const main = async () => {
  if (!existsSync(SOURCE)) {
    console.error(`✗ không tìm thấy ${SOURCE}`)
    process.exit(1)
  }

  /** PNG 32×32 dùng lại cho cả `favicon-32.png` và phần thân của `favicon.ico`. */
  let png32 = null

  for (const { size, file } of SIZES) {
    const target = join(PUBLIC_DIR, file)
    const png = await sharp(SOURCE)
      // `contain` + nền trong suốt: logo là 170×144 (không vuông), nên `cover`
      // sẽ cắt mất mép. Một icon bị cắt trông như một icon sai, không như một
      // icon được thu nhỏ.
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer()

    writeFileSync(target, png)
    if (size === 32) png32 = png
    console.log(`✓ ${file} (${size}×${size})`)
  }

  if (!png32) {
    console.error('✗ thiếu bản 32px — không dựng được .ico')
    process.exit(1)
  }

  const ico = wrapPngAsIco(png32, 32)
  writeFileSync(join(PUBLIC_DIR, 'favicon.ico'), ico)
  console.log(`✓ favicon.ico (32×32, ${ico.length} byte)`)

  console.log('\nXong. `server/plugins/favicon.ts` phục vụ chúng khi chưa cấu hình favicon riêng.')
}

main().catch((err) => {
  console.error('✗ sinh favicon thất bại:', err)
  process.exit(1)
})
