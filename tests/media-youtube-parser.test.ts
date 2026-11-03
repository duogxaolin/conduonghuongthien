/**
 * Địa chỉ video nền tảng ngoài — bóc định danh, dựng địa chỉ nhúng, và chặn máy
 * chủ ảnh của họ tiếp cận trình duyệt người đọc.
 *
 * Đây là test **gọi hàm thật**, không soi văn bản mã nguồn. Lý do: ba hàm trong
 * `youtube-parser.ts` là hàm thuần, nên câu hỏi "địa chỉ này có bóc ra định danh
 * không" trả lời được bằng cách chạy nó. Một khẳng định về ký tự trong mã nguồn
 * chỉ chứng minh cấu trúc, không bao giờ chứng minh hành vi.
 *
 * Bảng địa chỉ dưới đây lấy từ các dạng **thật** mà YouTube phát ra khi bấm
 * "Chia sẻ" / "Sao chép địa chỉ" / "Nhúng", cộng thêm các dạng người dùng gõ tay
 * (thiếu `www`, thêm dấu chấm cuối, kèm tham số thời gian). Một dạng thật bị từ
 * chối là cán bộ dán đúng địa chỉ họ đang có và nhận câu "không nhận ra video".
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, it } from 'node:test'

import {
  YOUTUBE_EMBED_HOST,
  YOUTUBE_THUMBNAIL_HOST,
  buildMediaThumbnailPath,
  buildYouTubeEmbedUrl,
  buildYouTubeThumbnailUpstreamUrl,
  extractYouTubeVideoId,
} from '../server/utils/youtube-parser.ts'

/** Một định danh thật, 11 ký tự, để bảng dưới đây không tự bịa ra định danh. */
const ID = 'dQw4w9WgXcQ'

describe('extractYouTubeVideoId — những dạng địa chỉ phải nhận', () => {
  const accepted: Array<[string, string]> = [
    ['địa chỉ đầy đủ khi bấm Chia sẻ', `https://www.youtube.com/watch?v=${ID}`],
    ['không có www', `https://youtube.com/watch?v=${ID}`],
    ['giao thức http', `http://www.youtube.com/watch?v=${ID}`],
    ['dạng rút gọn youtu.be', `https://youtu.be/${ID}`],
    ['dạng rút gọn kèm tham số thời gian', `https://youtu.be/${ID}?t=42`],
    ['đoạn /embed/ của mã nhúng', `https://www.youtube.com/embed/${ID}`],
    ['đoạn /shorts/ của video dọc', `https://www.youtube.com/shorts/${ID}`],
    ['đoạn /live/ của buổi phát trực tiếp', `https://www.youtube.com/live/${ID}`],
    ['dạng cũ /v/', `https://www.youtube.com/v/${ID}`],
    ['miền mobile', `https://m.youtube.com/watch?v=${ID}`],
    ['miền không cookie (địa chỉ đã nhúng của cổng khác)', `https://www.youtube-nocookie.com/embed/${ID}`],
    ['định danh trần, không phải địa chỉ', ID],
    ['định danh trần có khoảng trắng quanh nó', `  ${ID}  `],
    ['dấu chấm cuối — dạng FQDN đầy đủ của cùng một miền', `https://www.youtube.com./watch?v=${ID}`],
    ['tham số thời gian đứng trước v', `https://www.youtube.com/watch?t=42&v=${ID}`],
  ]

  for (const [label, input] of accepted) {
    it(`nhận: ${label}`, () => {
      assert.equal(extractYouTubeVideoId(input), ID, `bị từ chối: ${input}`)
    })
  }

  it('tham số thời gian trong địa chỉ không lọt vào định danh', () => {
    // Nếu định danh được cắt bằng chuỗi thay vì phân tích URL, `?t=42` hoặc `&list=…`
    // sẽ nằm trong giá trị lưu và địa chỉ nhúng sau đó không phát được.
    assert.equal(extractYouTubeVideoId(`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`), ID)
    assert.equal(extractYouTubeVideoId(`https://www.youtube.com/watch?v=${ID}&list=PLabcdefghijklmnop`), ID)
  })

  it('đoạn đường dẫn được ưu tiên hơn tham số khi cả hai cùng có', () => {
    // `/embed/<id>?v=<khac>` là địa chỉ do người gửi ghép; phần YouTube thật sự
    // phát ra là đoạn đường dẫn.
    assert.equal(extractYouTubeVideoId(`https://www.youtube.com/embed/${ID}?v=aaaaaaaaaaa`), ID)
  })

  it('định danh dài hơn 11 ký tự trong /embed/ bị từ chối, không bị cắt bớt', () => {
    // Cắt bớt sẽ biến một giá trị không nhận ra thành một định danh trông hợp lệ
    // — và một video khác được phát cho người đọc.
    assert.equal(extractYouTubeVideoId(`https://www.youtube.com/embed/${ID}extra`), null)
  })
})

describe('extractYouTubeVideoId — những giá trị phải bị từ chối', () => {
  const rejected: Array<[string, unknown]> = [
    ['chuỗi rỗng', ''],
    ['chỉ khoảng trắng', '   '],
    ['định danh quá ngắn', 'abc123'],
    ['định danh quá dài', `${ID}xyz`],
    ['định danh chứa ký tự ngoài bảng chữ URL-safe', 'dQw4w9WgXc!'],
    ['địa chỉ YouTube không mang định danh nào', 'https://www.youtube.com/'],
    ['địa chỉ kênh', 'https://www.youtube.com/@somechannel'],
    ['địa chỉ trang chủ có tham số lạ', 'https://www.youtube.com/watch?list=PLabcdefghijklmnop'],
    ['miền khác hoàn toàn', `https://vimeo.com/${ID}`],
    ['giao thức javascript', `javascript:alert('${ID}')`],
    ['giao thức data', `data:text/html,${ID}`],
    ['số', 12345],
    ['null', null],
    ['undefined', undefined],
    ['mảng', [ID]],
    ['đối tượng', { v: ID }],
  ]

  for (const [label, input] of rejected) {
    it(`từ chối: ${label}`, () => {
      assert.equal(extractYouTubeVideoId(input), null, `được nhận: ${String(input)}`)
    })
  }

  it('từ chối miền giả mạo YouTube bằng hậu tố chuỗi', () => {
    // `'evil-youtube.com'.endsWith('youtube.com')` là `true`, nên một phép kiểm
    // hậu tố trần đọc một miền do kẻ tấn công đăng ký thành YouTube. Đây là dạng
    // hỏng mà phép so khớp theo nhãn tồn tại để chặn.
    for (const host of ['evil-youtube.com', 'youtube.com.evil.test', 'notyoutube.com', 'youtube.co']) {
      assert.equal(extractYouTubeVideoId(`https://${host}/watch?v=${ID}`), null, `được nhận: ${host}`)
    }
  })

  it('địa chỉ không phân tích được cú pháp bị từ chối chứ không ném ra', () => {
    // Giá trị này đến từ thân request; ném ở đây là biến một đầu vào hỏng thành
    // một lỗi 500 thay vì một câu trả lời nói rằng video không nhận ra được.
    assert.equal(extractYouTubeVideoId('khong-phai-dia-chi'), null)
    assert.equal(extractYouTubeVideoId('http://[::1'), null)
  })
})

describe('buildYouTubeEmbedUrl — miền nhúng', () => {
  it('dựng địa chỉ nhúng trên miền KHÔNG cookie', () => {
    assert.equal(buildYouTubeEmbedUrl(ID), `https://${YOUTUBE_EMBED_HOST}/embed/${ID}?modestbranding=1&rel=0&playsinline=1`)
  })

  it('không bao giờ dựng địa chỉ trên miền youtube.com có cookie', () => {
    // Miền thường đặt cookie theo dõi trước khi người đọc bấm play. Đây là ràng
    // buộc về quyền riêng tư, không phải sở thích.
    const url = buildYouTubeEmbedUrl(ID)!
    assert.doesNotMatch(url, /(^|\/\/)(www\.)?youtube\.com\//)
    assert.match(url, /youtube-nocookie\.com/)
  })

  it('giảm logo YouTube — modestbranding=1 và rel=0', () => {
    // ToS YouTube (Section 4.f) cấm che hoàn toàn logo, nên đây là mức giảm tối đa
    // YouTube cho phép. Che hoàn toàn bằng CSS overlay là vi phạm, và cổng Bộ Công
    // an không nên hack giao diện.
    const url = buildYouTubeEmbedUrl(ID)!
    assert.match(url, /modestbranding=1/)
    assert.match(url, /rel=0/)
    assert.match(url, /playsinline=1/)
  })

  it('từ chối định danh không hợp lệ thay vì ghép bừa', () => {
    // Hàm này chạy trên giá trị đã lưu trong CSDL; một hàng sửa tay không được
    // phép sinh ra một `src` không ai kiểm.
    for (const bad of ['', 'short', `${ID}x`, null, undefined, 42, '<script>']) {
      assert.equal(buildYouTubeEmbedUrl(bad), null, `được nhận: ${String(bad)}`)
    }
  })

  it('định danh không thể đổi miền đích, vì miền là hằng số', () => {
    // `../` và `@` là hai cách thường dùng để đổi phần thẩm quyền của một URL
    // được ghép bằng chuỗi. Cả hai đều không qua được phép kiểm 11 ký tự.
    for (const attack of ['../../../evil', `${ID}@evil.com`, `${ID}#@evil.com`]) {
      assert.equal(buildYouTubeEmbedUrl(attack), null, `được nhận: ${attack}`)
    }
  })
})

describe('ảnh thu nhỏ — không hot-link', () => {
  it('đường dẫn công khai nằm trên chính cổng này', () => {
    const path = buildMediaThumbnailPath('tin-tuc-moi')
    assert.equal(path, '/api/public/media/tin-tuc-moi/thumb')
    // Đường dẫn tương đối, cùng origin — không có tên miền nào để rò rỉ.
    assert.doesNotMatch(path, /^[a-z]+:\/\//)
  })

  it('đường dẫn công khai KHÔNG chứa máy chủ ảnh của nền tảng', () => {
    // Đây là điều duy nhất ngăn mỗi lượt tải trang gửi IP và referrer của người
    // đọc tới một máy chủ ảnh của bên thứ ba.
    const path = buildMediaThumbnailPath('bat-ky')
    assert.doesNotMatch(path, /ytimg/)
    assert.doesNotMatch(path, /google/)
  })

  it('slug được mã hoá, nên một slug lạ không ghép được thêm đoạn đường dẫn', () => {
    assert.equal(buildMediaThumbnailPath('a/b'), '/api/public/media/a%2Fb/thumb')
    assert.equal(buildMediaThumbnailPath('../admin'), '/api/public/media/..%2Fadmin/thumb')
  })

  it('địa chỉ thượng nguồn dùng máy chủ ảnh của nền tảng, và chỉ nơi gọi phía máy chủ dùng nó', () => {
    assert.equal(
      buildYouTubeThumbnailUpstreamUrl(ID),
      `https://${YOUTUBE_THUMBNAIL_HOST}/vi/${ID}/hqdefault.jpg`,
    )
    assert.equal(buildYouTubeThumbnailUpstreamUrl('short'), null)
  })

  it('máy chủ ảnh của nền tảng chỉ được NÊU TÊN trong youtube-parser.ts — không tệp nào khác của server/ hay app/', async () => {
    // Hằng số tồn tại để địa chỉ đó chỉ có một bản sao trong toàn dự án. Một bản
    // thứ hai chỉ được đối chiếu khi một trong hai đã lọt ra ngoài.
    const parser = readFileSync(new URL('../server/utils/youtube-parser.ts', import.meta.url), 'utf8')
    assert.match(parser, /i\.ytimg\.com/)

    // Các bề mặt công khai phải nạp ảnh qua đường dẫn của cổng, không qua máy chủ
    // của nền tảng.
    //
    // Cố ý KHÔNG bọc `try/catch` quanh lượt đọc. Bản trước bọc rồi `continue` khi
    // đọc hỏng, và đường dẫn thì sai (`../app/components/media/MediaPlayer.vue` —
    // thư mục `media/` không tồn tại; tệp thật là `app/components/MediaPlayer.vue`).
    // Hệ quả: `readFileSync` ném, `continue` nuốt lượt đọc, và guard **xanh suốt
    // vòng đời vì không tìm thấy tệp**, không phải vì tệp sạch — một guard kiểm
    // rỗng mà không có gì nói ra. Đổi tên hay di chuyển một tệp trong danh sách bắt
    // buộc bên dưới nay làm ĐỎ test này, và đó đúng là điều nên xảy ra: guard phải nói được rằng nó vừa
    // thôi bảo vệ thứ nó khai, thay vì im lặng thu về không kiểm gì.
    //
    // Tập quét là TOÀN BỘ `server/` và `app/`, không phải một danh sách tên.
    //
    // Hai lần trước guard này thu hẹp âm thầm. Lần đầu: danh sách tên viết tay chỉ
    // kiểm barrel `media-portal.ts` + vài tệp con, nên sau khi tách cổng media
    // (5.3) chuỗi máy chủ ảnh đặt vào `media-portal-stream.ts`/`-admin-write.ts`
    // vẫn xanh — trong khi trước khi tách cả 1208 dòng đều bị quét. Lần hai: suy
    // từ thư mục nhưng chỉ `media-portal*.ts`, nên `media-validation.ts` (barrel
    // xuất lại nó) và mọi tệp khác của máy chủ vẫn nằm ngoài. Câu hỏi thật của
    // guard là "có nơi nào ngoài hằng số kia nêu tên máy chủ ảnh không", nên tập
    // quét là mọi tệp mã nguồn của hai phía, và chỉ `youtube-parser.ts` được phép.
    //
    // Mẫu bắt cả các máy chủ anh em (`i9.ytimg.com`, `img.youtube.com`): chúng
    // phục vụ cùng ảnh thu nhỏ, và rò IP/referrer người đọc y như nhau.
    const IMAGE_HOST = /(?:[a-z0-9-]+\.)?ytimg\.com|img\.youtube\.com/i
    const ALLOWED = new Set(['server/utils/youtube-parser.ts'])
    const repoRoot = new URL('../', import.meta.url)
    const scanned: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(new URL(dir, repoRoot), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) walk(rel)
        else if (entry.isFile() && /\.(?:[cm]?[jt]s|vue|json|css|html)$/.test(entry.name)) scanned.push(rel)
      }
    }
    walk('server')
    walk('app')

    // Tập quét không được rỗng hay teo lại, và phải chứa các tệp từng lọt khỏi
    // guard — đổi tên/di chuyển một tệp làm ĐỎ ở đây, không âm thầm thu hẹp.
    assert.ok(scanned.length >= 800, `tập quét chỉ có ${scanned.length} tệp — guard đang kiểm gần như rỗng`)
    for (const expected of [
      'server/services/media-portal.ts',
      'server/services/media-portal-admin-read.ts',
      'server/services/media-portal-admin-write.ts',
      'server/services/media-portal-assets.ts',
      'server/services/media-portal-public.ts',
      'server/services/media-portal-stream.ts',
      'server/services/media-portal-thumbnail.ts',
      'server/services/media-portal-thumbnail-override.ts',
      'server/services/media-validation.ts',
      'server/api/public/media/[shortId]/thumb.get.ts',
      'app/components/MediaPlayer.vue',
      'app/pages/media/index.vue',
    ]) {
      assert.ok(scanned.includes(expected), `${expected} vắng khỏi tập quét`)
    }
    for (const allowed of ALLOWED) assert.ok(scanned.includes(allowed), `${allowed} vắng khỏi tập quét`)

    const offenders = scanned
      .filter(file => !ALLOWED.has(file))
      .filter(file => IMAGE_HOST.test(readFileSync(new URL(file, repoRoot), 'utf8')))
    assert.deepEqual(offenders, [], 'các tệp này nêu thẳng máy chủ ảnh của nền tảng — dùng YOUTUBE_THUMBNAIL_HOST / buildMediaThumbnailPath')
  })
})
