/**
 * Kiểu bản ghi mà các trang **công khai** nhận từ API.
 *
 * Cùng lối với `admin-api.ts` và cùng một lý do: **suy ra từ chính handler**, không
 * viết tay. Một interface viết tay thì đúng đúng một lần — vào ngày nó được viết.
 * Thêm một trường vào projection mà quên sửa interface thì TypeScript vẫn xanh
 * trong khi trang không biết trường mới tồn tại; bỏ một trường đi thì tệ hơn, vì
 * mã đọc trường đã biến mất vẫn biên dịch được rồi hiện `undefined` cho người đọc.
 *
 * Tệp này ra đời khi bật `lang="ts"` cho các tệp `.vue` công khai. Trước đó 43 tệp
 * không có `lang="ts"`, nên **toàn bộ** dữ liệu công khai đi qua giao diện dưới
 * dạng implicit `any` — kể cả luồng bình luận, tức đúng phần chạm chữ của công dân.
 * `ref([])` trong một tệp không typed là `any[]`; trong một tệp typed nó là
 * `never[]`, và **mọi** phép đọc trường trên phần tử của nó thành lỗi. Đó là dấu
 * hiệu cho thấy hình dạng chưa bao giờ được khai ở đâu, không phải một bất tiện
 * của trình kiểm kiểu.
 *
 * Chỉ khai những kiểu **có nơi dùng thật**. Một kiểu dự phòng không ai import là
 * một lời khẳng định chưa bao giờ được đối chiếu với gì.
 */
import type { Serialize } from 'nitropack/types'

type Payload<T> = Serialize<Awaited<ReturnType<T extends (...args: never[]) => unknown ? T : never>>>

// ─── Luồng bình luận công khai ───────────────────────────────────────────────
type CommentThreadHandler = typeof import('~~/server/api/public/comments/[articleSlug].get').default

/**
 * Phản hồi **sau khi đi qua JSON**, không phải giá trị handler trả về.
 *
 * `Serialize` mô phỏng đúng phép biến đổi của JSON (`Date → string`, `undefined`
 * biến mất). Với luồng bình luận thì khác biệt đó là thật: `createdAt` đã được
 * `serializePublicComment` chuyển sang chuỗi ISO, và một kiểu khai `Date` sẽ để
 * `.getTime()` biên dịch trót lọt rồi hỏng lúc chạy.
 */
export type CommentThreadPayload = Payload<CommentThreadHandler>

/**
 * Một bình luận như trang công khai nhận được.
 *
 * Lấy từ phần tử của `comments` chứ không import `PublicComment` từ
 * `server/services/comments`: kiểu bên đó là hình dạng **trước** khi qua JSON, nên
 * dùng thẳng sẽ khai `createdAt: string | null` đúng nhưng bỏ mất phép biến đổi mà
 * `Serialize` áp cho các trường khác nếu sau này có thêm.
 *
 * `replies` là **tuỳ chọn** ở đây vì nó tuỳ chọn ở nguồn: chỉ bình luận gốc mang
 * mảng đó (đúng một cấp trả lời — xem `checkParentEligibility`), còn một phản hồi
 * thì không bao giờ có. Khai nó bắt buộc sẽ để mã đọc `reply.replies.length` biên
 * dịch được trên đúng những node không bao giờ có trường đó.
 */
export type PublicCommentItem = CommentThreadPayload['comments'][number]

// ─── Trang cá nhân người đọc ─────────────────────────────────────────────────
// Hai endpoint này chỉ đọc dữ liệu của **chính** người đang đăng nhập (danh tính
// lấy từ vé, không có tham số `readerId` ở đâu), và cả hai cố ý không ghi audit —
// quy tắc audit nhắm vào cán bộ đọc dữ liệu công dân, không phải công dân xem
// trang của chính họ.

type ReaderCommentsHandler = typeof import('~~/server/api/public/reader/comments.get').default
export type ReaderCommentsPayload = Payload<ReaderCommentsHandler>

type ReaderChatsHandler = typeof import('~~/server/api/public/reader/chats.get').default
export type ReaderChatsPayload = Payload<ReaderChatsHandler>
