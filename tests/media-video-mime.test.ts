/**
 * Nhận diện thùng chứa video theo **nội dung**, không theo tên tệp.
 *
 * Test này gọi hàm thật trên byte thật. Nó tồn tại vì một khẳng định về tên tệp
 * không bao giờ chứng minh được điều ngược lại: điều cần chứng minh là **tên tệp
 * không có tiếng nói nào** trong quyết định này. Cách duy nhất để nói ra điều đó
 * là đưa vào một tệp có nội dung hợp lệ nhưng tên nói dối, và một tệp có tên hợp
 * lệ nhưng nội dung nói dối, rồi đòi hai câu trả lời khác nhau.
 *
 * Byte ở đây được **dựng tay** theo đặc tả, không lấy từ tệp media thật: một
 * fixture nhị phân trong repo là thứ không ai đọc được và không ai dám sửa. Mỗi
 * buffer dưới đây tự nói nó đang mô phỏng cấu trúc gì.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  EXT_BY_VIDEO_MIME,
  SUPPORTED_VIDEO_MIMES,
  UNSUPPORTED_VIDEO_MESSAGE,
  VIDEO_SNIFF_BYTES,
  detectVideoMime,
} from '../server/utils/video-mime.ts'

/** Hộp ISO: 4 byte kích thước big-endian + 4 byte tên + thân. */
function isoBox(name: string, body: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(8 + body.length, 0)
  header.write(name, 4, 'ascii')
  return Buffer.concat([header, body])
}

/** Tệp ISO base media: `ftyp` với nhãn thương hiệu, rồi `moov` rỗng. */
function isoFile(brand: string): Buffer {
  return Buffer.concat([
    isoBox('ftyp', Buffer.from(brand, 'ascii')),
    isoBox('moov'),
    isoBox('mdat', Buffer.alloc(16)),
  ])
}

/** Tệp EBML với DocType cho trước, theo đúng cách phần tử `EBML` mã hoá nó. */
function ebmlFile(docType: string): Buffer {
  const magic = Buffer.from([0x1A, 0x45, 0xDF, 0xA3])
  // Độ dài phần tử, mã hoá VINT một byte (đủ cho phần thân nhỏ dưới đây).
  const length = Buffer.from([0x80 | (4 + docType.length)])
  // DocType (0x4282) + độ dài (0x80 | n) + chuỗi ascii.
  const docTypeElement = Buffer.concat([
    Buffer.from([0x42, 0x82, 0x80 | docType.length]),
    Buffer.from(docType, 'ascii'),
  ])
  const body = Buffer.concat([
    Buffer.from([0x42, 0x86, 0x81, 0x01]), // EBMLVersion = 1
    docTypeElement,
  ])
  return Buffer.concat([magic, length, body])
}

const MP4 = isoFile('isom')
const MP4_AVC = isoFile('avc1')
const QUICKTIME = isoFile('qt  ')
const MOV_LEGACY = Buffer.concat([isoBox('moov'), isoBox('mdat', Buffer.alloc(32))])
const WEBM = ebmlFile('webm')
const MATROSKA = ebmlFile('matroska')

describe('detectVideoMime — những thùng chứa phải nhận', () => {
  const accepted: Array<[string, Buffer, string]> = [
    ['MP4 nhãn isom', MP4, 'video/mp4'],
    ['MP4 nhãn avc1', MP4_AVC, 'video/mp4'],
    ['QuickTime có hộp ftyp nhãn "qt  "', QUICKTIME, 'video/quicktime'],
    ['QuickTime đời cũ, mở đầu thẳng bằng moov, không có ftyp', MOV_LEGACY, 'video/quicktime'],
    ['WebM', WEBM, 'video/webm'],
    ['Matroska', MATROSKA, 'video/x-matroska'],
  ]

  for (const [label, buffer, expected] of accepted) {
    it(`nhận: ${label}`, () => {
      assert.equal(detectVideoMime(buffer), expected)
    })
  }

  it('nhận được khi buffer dài hơn cửa sổ cần đọc', () => {
    // Nơi gọi đọc `VIDEO_SNIFF_BYTES` byte đầu của một tệp hàng GB. Hàm không
    // được phụ thuộc vào việc buffer kết thúc ngay sau phần đầu.
    const padded = Buffer.concat([MP4, Buffer.alloc(4096, 0x11)])
    assert.equal(detectVideoMime(padded), 'video/mp4')
  })
})

describe('detectVideoMime — nội dung quyết định, tên tệp không', () => {
  it('nội dung MP4 được nhận dù tên tệp nói .mkv', () => {
    // Chữ ký hàm chỉ nhận `Buffer`, nên tên tệp không thể lọt vào — và đó chính
    // là điều test này khẳng định: thứ duy nhất đi vào là byte.
    assert.equal(detectVideoMime(MP4), 'video/mp4')
    assert.equal(EXT_BY_VIDEO_MIME['video/mp4'], '.mp4', 'đuôi tệp phải suy từ nội dung')
  })

  it('tệp tên .mp4 mang nội dung không phải video bị TỪ CHỐI', () => {
    // Ca mà tính năng này tồn tại để chặn: đường tải lên không được tin đuôi tệp
    // hay `Content-Type` client khai. Nếu tệp này lọt qua, nó chiếm chỗ trong thư
    // mục làm việc, một hàng media_items được tạo, và FFmpeg mới thất bại — lúc
    // đó cán bộ đã thấy một mục "đang xử lý" không bao giờ xong.
    const notAVideo = Buffer.from('%PDF-1.7\n' + 'x'.repeat(200), 'ascii')
    assert.equal(detectVideoMime(notAVideo), null)
  })

  it('tệp ZIP đổi tên thành .mp4 bị TỪ CHỐI', () => {
    // ZIP bắt đầu bằng `PK\x03\x04`. Byte thứ 4-7 là `\x04` và ký tự khác, nên
    // không có nhánh nào khớp.
    const zip = Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.alloc(60, 0x00)])
    assert.equal(detectVideoMime(zip), null)
  })

  it('một tệp PNG đổi tên thành .mp4 bị TỪ CHỐI', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64, 0x00)])
    assert.equal(detectVideoMime(png), null)
  })

  it('một tệp HTML đổi tên thành .mp4 bị TỪ CHỐI', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>', 'ascii')
    assert.equal(detectVideoMime(html), null)
  })
})

describe('detectVideoMime — những giá trị phải bị từ chối', () => {
  it('buffer rỗng và buffer ngắn hơn một hộp ISO bị từ chối', () => {
    // Không được ném ra: đây là giá trị đến từ một lượt ghép tệp, và một lỗi ném
    // ở đây biến "tệp không hợp lệ" thành một lỗi 500 ở tầng trên.
    for (const length of [0, 1, 4, 8, 11]) {
      assert.equal(detectVideoMime(Buffer.alloc(length)), null, `độ dài ${length}`)
    }
  })

  it('EBML đúng magic nhưng không có DocType trong cửa sổ đọc bị từ chối', () => {
    // Đoán "webm" ở đây là nhận một thứ chưa nhận diện được. Một tệp EBML không
    // rõ loại có thể là tài liệu chứ không phải video.
    const magicOnly = Buffer.concat([
      Buffer.from([0x1A, 0x45, 0xDF, 0xA3]),
      Buffer.alloc(VIDEO_SNIFF_BYTES, 0x00),
    ])
    assert.equal(detectVideoMime(magicOnly), null)
  })

  it('chuỗi ftyp xuất hiện ở offset 4 nhưng kích thước hộp vô lý bị từ chối', () => {
    // Bốn ký tự `ftyp` một mình là một phép kiểm quá yếu: một tệp văn bản có thể
    // chứa đúng chuỗi đó. Kích thước hộp là phần thứ hai, và nó phải hợp lệ.
    const fake = Buffer.alloc(64)
    fake.writeUInt32BE(3, 0) // nhỏ hơn 8 — không thể là một hộp
    fake.write('ftyp', 4, 'ascii')
    fake.write('isom', 8, 'ascii')
    assert.equal(detectVideoMime(fake), null)
  })

  it('nhãn thương hiệu không in được bị từ chối', () => {
    const fake = Buffer.alloc(64)
    fake.writeUInt32BE(32, 0)
    fake.write('ftyp', 4, 'ascii')
    fake[8] = 0x00
    fake[9] = 0x01
    fake[10] = 0x02
    fake[11] = 0x03
    assert.equal(detectVideoMime(fake), null)
  })

  it('Matroska được nhận trước WebM khi cửa sổ chứa cả hai chuỗi', () => {
    // Thứ tự này là quyết định, không phải tình cờ: DocType của một tệp chỉ có
    // một giá trị, nên chuỗi dài hơn là chuỗi cụ thể hơn.
    const both = Buffer.concat([
      Buffer.from([0x1A, 0x45, 0xDF, 0xA3]),
      Buffer.from('matroska', 'ascii'),
      Buffer.from('webm', 'ascii'),
      Buffer.alloc(8, 0x00),
    ])
    assert.equal(detectVideoMime(both), 'video/x-matroska')
  })
})

describe('hai đầu allowlist phải khớp nhau', () => {
  it('mọi thùng chứa được nhận đều có đuôi tệp và ngược lại', () => {
    // Dự án đã trả giá cho đúng hình dạng này ở `.ico`: đường tải lên nhận một
    // định dạng trong khi đường phục vụ không, tệp lưu thành công rồi không bao
    // giờ hiện được. Ở đây hai đầu là "nhận vào" và "đặt tên trên đĩa", và bảng
    // đuôi tệp là phép đối chiếu duy nhất giữ chúng khớp.
    assert.deepEqual(
      [...SUPPORTED_VIDEO_MIMES].sort(),
      Object.keys(EXT_BY_VIDEO_MIME).sort(),
    )
    for (const mime of SUPPORTED_VIDEO_MIMES) {
      assert.match(EXT_BY_VIDEO_MIME[mime], /^\.[a-z0-9]+$/, `${mime} có đuôi tệp không hợp lệ`)
    }
    // Không hai định dạng nào dùng chung một đuôi: nếu có, đuôi tệp thôi phân
    // biệt được hai thứ khác nhau trên đĩa.
    const extensions = Object.values(EXT_BY_VIDEO_MIME)
    assert.equal(new Set(extensions).size, extensions.length)
  })

  it('câu thông báo nói rõ đuôi tệp không được dùng để nhận diện', () => {
    // Cán bộ sẽ thử lại bằng cách đổi đuôi tệp. Câu này tồn tại để họ không làm
    // điều đó hai lần.
    assert.match(UNSUPPORTED_VIDEO_MESSAGE, /đuôi tệp/i)
    assert.match(UNSUPPORTED_VIDEO_MESSAGE, /MP4/)
  })
})
