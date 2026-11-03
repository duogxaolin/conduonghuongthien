/**
 * Trạng thái buổi phát trực tiếp đang diễn ra, cho trang công khai hỏi sau mount.
 *
 * ## KHÔNG đọc cookie người đọc — và đây là yêu cầu, không phải lựa chọn

 * Task 13.4 nói thẳng: endpoint này **không** gọi `optionalReader` lẫn
 * `requireReader`, và phải trả **cùng một phản hồi** dù request có phiên người
 * đọc hay không. Trạng thái một buổi phát là thông tin công khai như chính buổi
 * phát đó; đọc thêm một phiên vào đây là thêm một lượt truy vấn cho mỗi lượt tải
 * trang chỉ để không dùng tới kết quả, và tệ hơn là mở một đường để sau này ai đó
 * "cá nhân hoá" khối này — trên một tuyến đang chạy `swr: 60`.
 *
 * ## Vì sao tuyến này không nằm trong `routeRules`

 * Mọi trang công khai phục vụ qua `swr: 60`, và một buổi phát trực tiếp là thứ
 * có thể bắt đầu hoặc kết thúc **bên trong** cửa sổ 60 giây đó. Một phản hồi được
 * đệm ở tầng trang sẽ nói "đang phát" trong tối đa một phút sau khi buổi phát đã
 * dừng, và ngược lại. Giao diện hỏi endpoint này từ trình duyệt sau mount, nên
 * `Cache-Control: no-store` ở đây là thứ giữ cho câu trả lời đúng.
 *
 * ## `youtubeVideoId` không đi ra ngoài

 * `embedUrl` là địa chỉ nhúng **đã dựng từ hằng số miền không cookie**, không
 * phải định danh trần. Trả định danh trần rồi để giao diện tự ghép URL là đặt
 * quyết định "miền nào" vào tay template — đúng chỗ mà `youtube-parser.ts` ra đời
 * để không đặt nó. `storagePath` cũng vậy: nó là **vị trí lưu trữ trên máy chủ**,
 * và một đường dẫn kho đi vào phản hồi công khai là tiết lộ cấu trúc thư mục của
 * cơ quan. Không trường nào trong hai trường đó có mặt ở đầu ra.
 */
import { defineEventHandler, setHeader } from 'h3'

import { buildYouTubeEmbedUrl } from '../../../utils/youtube-parser'
import { reportPublicReadFailure } from '../../../utils/public-read-failure'
// Cached 3 s in-process (design D20): every public page polls this. Start/stop
// in this process invalidate it on commit.
import { getActiveLivestreamCached } from '../../../services/livestream'

/** Địa chỉ phát của buổi phát, **trên chính cổng này**. Xem `buildMediaStreamPath`
 *  (`server/services/media-portal-public.ts`) cho cùng lý do: đưa vị trí kho cho
 *  trình duyệt là đưa luôn cấu trúc kho. */
const LIVESTREAM_STREAM_PATH = '/api/public/livestream'

export default defineEventHandler(async (event) => {
  // Không có gì để đệm: câu trả lời đúng chỉ có giá trị ở thời điểm nó được hỏi.
  setHeader(event, 'Cache-Control', 'no-store')

  try {
    const session = await getActiveLivestreamCached()
    if (!session) {
      // `active: false` là một câu trả lời **thành công**, không phải 404: giao
      // diện phân biệt được "chưa có buổi phát" với "không hỏi được", và chỉ nhánh
      // sau mới đáng hiện một cảnh báo. Trả 404 ở đây sẽ bắt giao diện coi một
      // trạng thái bình thường như một lượt hỏng.
      return { ok: true, active: false, session: null }
    }

    return {
      ok: true,
      active: true,
      session: {
        id: session.id,
        title: session.title,
        description: session.description ?? null,
        source: session.source,
        // `null` khi nguồn là bản tự lưu trữ, hoặc khi định danh đã lưu không qua
        // được phép kiểm — cùng quy tắc như `serializePublicMedia`.
        embedUrl: session.youtubeVideoId ? buildYouTubeEmbedUrl(session.youtubeVideoId) : null,
        streamUrl: session.source === 'upload' ? `${LIVESTREAM_STREAM_PATH}/${session.id}/stream` : '',
        thumbnailUrl: session.thumbnailUrl ?? null,
        startedAt: session.startedAt ?? null,
      },
    }
  } catch (error: unknown) {
    // 503 + `no-store` + log `error`: hợp đồng chung của lượt đọc công khai hỏng
    // (`public-read-failure.ts`). `LiveHero`/`LiveTickerBar` bắt lỗi `$fetch` và
    // lùi về hero mặc định; trang quản trị hiện thông báo lỗi.
    reportPublicReadFailure(event, 'public.livestream_active_failed', error)
    // Cùng hình dạng với nhánh thành công, khác đúng trường `ok`: nơi gọi nào đọc
    // thân phản hồi lỗi vẫn thấy "không có buổi phát", không phải một object rỗng.
    return { ok: false, active: false, session: null }
  }
})
