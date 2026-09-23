/**
 * Địa chỉ video của nền tảng ngoài: bóc định danh, dựng địa chỉ nhúng, và chặn
 * máy chủ ảnh của họ tiếp cận trình duyệt người đọc.
 *
 * Ba việc nằm chung một tệp vì chúng là **một** quyết định. Một mục media nguồn
 * ngoài có đúng hai chỗ mà trình duyệt người đọc có thể bị trỏ sang một miền của
 * bên thứ ba: khung nhúng và ảnh thu nhỏ. Cả hai đều phải đi qua đây.
 *
 *   • **Nhúng qua miền không cookie** (`www.youtube-nocookie.com`). Miền
 *     `www.youtube.com` đặt cookie theo dõi trước khi người đọc bấm play.
 *   • **Ảnh thu nhỏ KHÔNG hot-link.** `i.ytimg.com` là một máy chủ ảnh của bên
 *     thứ ba: mỗi lượt tải trang là gửi IP và referrer của người đọc tới đó, trên
 *     đúng những trang công dân đang tra cứu vị thế pháp lý của chính mình.
 *     `buildMediaThumbnailPath` trả về đường dẫn **trên chính cổng này**; địa chỉ
 *     thượng nguồn (`buildYouTubeThumbnailUpstreamUrl`) chỉ được dùng phía máy
 *     chủ, bởi endpoint proxy, và **không bao giờ** đi vào một phản hồi. Cùng lý
 *     do dự án tự chủ webfont và không lưu URL ảnh đại diện Google.
 *
 * Tên tệp nói "youtube" vì đó là nền tảng **duy nhất** được nhận. Mở thêm nền
 * tảng thứ hai là thêm một nhánh vào `extractYouTubeVideoId`, và điều kiện để mở
 * không phải "nền tảng nào phổ biến hơn" mà là "nền tảng đó có miền nhúng không
 * cookie hay không" — một miền nhúng không tồn tại thì mọi thứ còn lại của việc
 * mở rộng đều vô nghĩa.
 */

/** Miền nhúng. Đây là miền Google **duy nhất** được phép xuất hiện trong HTML
 *  gửi cho người đọc; có test chặn mọi miền Google khác trong mã công khai. */
export const YOUTUBE_EMBED_HOST = 'www.youtube-nocookie.com'

/** Máy chủ ảnh thượng nguồn. **Chỉ dùng phía máy chủ** — xem doc đầu tệp. */
export const YOUTUBE_THUMBNAIL_HOST = 'i.ytimg.com'

/**
 * Định danh video: đúng 11 ký tự trong bảng chữ URL-safe.
 *
 * Chặt chẽ là chủ đích, không phải khắt khe: đây là giá trị duy nhất từ đầu vào
 * của cán bộ đi thẳng vào một `src` của iframe trên trang công khai, và một phép
 * kiểm lỏng ("là chuỗi không rỗng") biến trường đó thành một chỗ để đặt bất cứ
 * thứ gì vào đường dẫn. YouTube luôn dùng 11 ký tự; một định danh dài hơn không
 * phải một định danh mới mà là một giá trị không nhận ra được.
 */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

/** Các miền thuộc nền tảng. So khớp theo **nhãn**, không theo hậu tố chuỗi —
 *  xem `isPlatformHostname`. */
const PLATFORM_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com']

/** Tiền tố đường dẫn mang định danh ở đoạn thứ hai: `/embed/<id>`, `/shorts/<id>`… */
const ID_PATH_PREFIXES = new Set(['embed', 'v', 'shorts', 'live'])

/**
 * Tên máy chủ này có thuộc nền tảng không?
 *
 * So khớp theo nhãn chứ không phải `hostname.endsWith('youtube.com')` trần: hậu tố
 * chuỗi nhận cả `evil-youtube.com`, vì `'evil-youtube.com'.endsWith('youtube.com')`
 * là `true` — một miền do kẻ tấn công đăng ký sẽ được đọc là YouTube. `youtu.be`
 * và `youtube-nocookie.com` không phải hậu tố của nhau nên phải khai riêng.
 *
 * Dấu chấm cuối bị cắt: `youtube.com.` là dạng FQDN đầy đủ hợp lệ của cùng một
 * miền, và để nó trượt là từ chối một địa chỉ thật.
 */
function isPlatformHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return PLATFORM_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`))
}

/** Bóc định danh từ phần đường dẫn: `/embed/<id>`, `/shorts/<id>`, `/v/<id>`, `/live/<id>`. */
function idFromPath(pathname: string): string | null {
  const [prefix, id] = pathname.split('/').filter(Boolean)
  if (!prefix || !id) return null
  if (!ID_PATH_PREFIXES.has(prefix)) return null
  return VIDEO_ID_PATTERN.test(id) ? id : null
}

/**
 * Định danh video từ **bất kỳ dạng địa chỉ thường gặp nào**, hoặc `null` nếu
 * không nhận ra.
 *
 * `null` là câu trả lời cho "giá trị này không phải một video", và nơi gọi phải
 * nói ra điều đó với cán bộ — im lặng lưu một hàng không phát được là để họ phát
 * hiện ra ở trang công khai.
 *
 * Nhận cả **định danh trần** (không phải địa chỉ): đó chính là thứ nằm trong
 * tham số `v` của địa chỉ cán bộ đang có, và bắt họ ghép lại thành một URL đầy
 * đủ chỉ để rồi bóc nó ra là một bước không mang lại gì.
 *
 * Nhận `unknown` chứ không `string`: giá trị đến từ thân request, nên "không
 * phải chuỗi" là một dạng đầu vào thật cần bị từ chối ở đây thay vì ném ra ở
 * một tầng khác với một thông báo không liên quan.
 */
export function extractYouTubeVideoId(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.trim()
  if (!raw) return null

  // Định danh trần. Kiểm TRƯỚC khi thử `new URL`: chuỗi 11 ký tự này cũng là một
  // URL hợp lệ về mặt cú pháp (`new URL('dQw4w9WgXcQ')` ném, nhưng nhiều chuỗi
  // khác thì không), nên thứ tự này giữ cho định danh trần không bị phân tích
  // như một đường dẫn tương đối.
  if (VIDEO_ID_PATTERN.test(raw)) return raw

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  // Chỉ http/https. `javascript:` và `data:` có `hostname` rỗng nên chúng rơi ở
  // phép kiểm miền bên dưới, nhưng chốt tường minh ở đây để lần nới sau không
  // phải suy luận về thứ tự hai phép kiểm.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!isPlatformHostname(url.hostname)) return null

  const host = url.hostname.toLowerCase().replace(/\.$/, '')

  // `youtu.be/<id>` — định danh nằm ngay đoạn đường dẫn đầu tiên, không có tiền tố.
  if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
    const [id] = url.pathname.split('/').filter(Boolean)
    return id && VIDEO_ID_PATTERN.test(id) ? id : null
  }

  // Đường dẫn trước, tham số sau: `/embed/<id>?v=<khac>` là một địa chỉ do người
  // gửi ghép, và đoạn đường dẫn là phần YouTube thật sự phát ra.
  const fromPath = idFromPath(url.pathname)
  if (fromPath) return fromPath

  // `/watch?v=<id>`. `searchParams.get` trả giá trị **đầu tiên** khi tham số lặp
  // lại — hành vi đúng, cùng lý do trên.
  const fromQuery = url.searchParams.get('v')
  if (fromQuery && VIDEO_ID_PATTERN.test(fromQuery)) return fromQuery

  return null
}

/**
 * Địa chỉ nhúng không cookie, hoặc `null` nếu định danh không hợp lệ.
 *
 * Trả `null` thay vì ghép bừa: hàm này được gọi trên giá trị **đã lưu** trong
 * cột `youtube_video_id`, và một hàng bị sửa tay trong CSDL không được phép sinh
 * ra một `src` không ai kiểm. Nơi gọi bỏ hẳn khung nhúng và nói ra là video không
 * phát được — một iframe trắng không nói lên điều gì với người đọc.
 *
 * Miền là hằng số, không suy từ giá trị lưu: đó là lý do cột chỉ giữ định danh
 * trần (xem `schema.ts`), nên một giá trị hỏng vẫn không thể trở thành một origin
 * tuỳ ý trong trình duyệt người đọc.
 */
export function buildYouTubeEmbedUrl(videoId: unknown): string | null {
  if (typeof videoId !== 'string' || !VIDEO_ID_PATTERN.test(videoId)) return null
  // `modestbranding=1` — giảm logo YouTube (chuyển logo lớn góc phải thành nút nhỏ).
  // `rel=0` — không hiện video liên quan từ channel khác khi hết video.
  // `playsinline=1` — iOS phát inline thay vì fullscreen cưỡng bức.
  // Không che hoàn toàn logo: ToS YouTube (Section 4.f) cấm "obscure branding",
  // và cổng Bộ Công an không nên hack giao diện. Đây là mức giảm tối đa YouTube cho phép.
  return `https://${YOUTUBE_EMBED_HOST}/embed/${videoId}?modestbranding=1&rel=0&playsinline=1`
}

/**
 * Địa chỉ ảnh thu nhỏ **thượng nguồn** — chỉ endpoint proxy phía máy chủ gọi.
 *
 * Không có nơi nào khác được gọi hàm này, và giá trị nó trả về không bao giờ
 * được đưa vào một phản hồi công khai. Nó tồn tại để máy chủ ảnh của bên thứ ba
 * được **nêu tên đúng một lần** trong toàn dự án — hai bản sao của một địa chỉ
 * như thế chỉ được đối chiếu khi một trong hai đã lọt ra ngoài.
 */
export function buildYouTubeThumbnailUpstreamUrl(videoId: unknown): string | null {
  if (typeof videoId !== 'string' || !VIDEO_ID_PATTERN.test(videoId)) return null
  return `https://${YOUTUBE_THUMBNAIL_HOST}/vi/${videoId}/hqdefault.jpg`
}

/**
 * Đường dẫn ảnh thu nhỏ **trên chính cổng này** — thứ duy nhất được trả cho
 * người đọc.
 *
 * Khoá theo `slug` của mục media chứ không theo định danh video, và đó là một
 * khác biệt an ninh chứ không phải chuyện đặt tên: tra theo slug buộc endpoint
 * proxy phải tìm thấy một mục **đã xuất bản** trước khi nó đi lấy ảnh. Khoá theo
 * định danh video thì bất kỳ ai cũng biến được cổng này thành một proxy ảnh mở
 * cho mọi video trên nền tảng, kể cả những cái cổng chưa từng đăng.
 *
 * Nằm cùng tệp với `buildYouTubeEmbedUrl` vì hai hàm này là hai nửa của cùng một
 * câu hỏi: trình duyệt người đọc được trỏ tới đâu. Tách chúng ra hai tệp là để
 * một nửa của câu trả lời nằm chỗ không ai nghĩ tới khi sửa nửa kia.
 */
export function buildMediaThumbnailPath(slug: string): string {
  return `/api/public/media/${encodeURIComponent(slug)}/thumb`
}
