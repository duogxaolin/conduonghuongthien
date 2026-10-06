/**
 * Hằng số chia sẻ giữa các file con của cổng media (validation, public read,
 * admin read, views, write, stream/thumbnail resolution). Tách riêng để tránh
 * vòng import: `media-validation` cần hằng số (độ dài tiêu đề, danh sách nguồn),
 * `media-portal-public` cần `PUBLISHED_MEDIA_STATUS`, `media-views` cần
 * quy tắc khử trùng. File này không import gì từ Drizzle hay schema — chỉ hằng
 * số và type, không có logic.
 */
import type { RateLimitRule } from '../utils/rate-limit-store'

/**
 * Trạng thái biên tập. `processing_status` **không** nằm ở đây: một cái là quyết
 * định của cán bộ, cái kia là trạng thái của máy, và gộp chúng làm "đã xuất bản
 * nhưng chuyển mã hỏng" trở thành một trạng thái không diễn đạt được.
 */
export const MEDIA_ITEM_STATUSES = ['draft', 'published', 'archived'] as const
export type MediaItemStatus = typeof MEDIA_ITEM_STATUSES[number]

/** Nguồn: tệp cổng tự giữ và chuyển mã, hoặc một tham chiếu ra nền tảng ngoài. */
export const MEDIA_SOURCES = ['upload', 'youtube'] as const
export type MediaSource = typeof MEDIA_SOURCES[number]

/** Chỉ mục ở trạng thái này mới ra tới người đọc. Một chỗ, không rải rác. */
export const PUBLISHED_MEDIA_STATUS: MediaItemStatus = 'published'

export const MEDIA_TITLE_MAX_LENGTH = 512
export const MEDIA_DESCRIPTION_MAX_LENGTH = 5000
export const MEDIA_SEARCH_MAX_LENGTH = 200
/** Trần số bản ghi một trang. Giữ ở đây để endpoint và bộ đếm dùng chung một số. */
export const MEDIA_LIST_MAX_LIMIT = 50

/**
 * Đệm cho manifest ngắn, cho phân đoạn thì gần như vĩnh viễn.
 *
 * `master.m3u8` **đổi** trong lúc một mục đang được chuyển mã: mỗi bản xong lại
 * được ghi vào đó. Đệm nó một năm như đệm phân đoạn sẽ khoá trình phát vào bản
 * đầu tiên và một bản mới công bố xong sẽ không bao giờ tới được người đọc —
 * triệu chứng là "video chỉ chạy ở 360p", không có lỗi ở đâu cả.
 */
export const MANIFEST_CACHE_SECONDS = 60
export const SEGMENT_CACHE_SECONDS = 31_536_000

/**
 * Khung chống đếm trùng: **10 phút** — cùng cửa sổ với `article-views.ts`.
 *
 * Cùng một người xem lại video sau 10 phút thì vẫn tính +1 lượt xem. Đủ dài để
 * hấp thụ một lần F5, đủ ngắn để một lượt quay lại thật (sau 10p01s) được tính
 * là một lượt xem mới. Trước đây cửa sổ là 24 giờ, nhưng anh yêu muốn đồng bộ
 * với bài viết: cùng người, cùng cửa sổ 10 phút cho cả hai loại nội dung.
 *
 * Token vẫn sinh theo ngày nên khoá tự đổi lúc nửa đêm UTC — điều này chỉ ảnh
 * hưởng đến ranh giới ngày, không đến cửa sổ khử trùng.
 */
export const MEDIA_VIEW_DEDUPE_WINDOW_SECONDS = 10 * 60

/**
 * Quy tắc khử trùng lặp, khai **cạnh hàm dựng khoá** chứ không trong endpoint.
 *
 * `limit: 1` để `count === 1` là quyết định "lần đầu" — và để nó kiểm được: một
 * hằng số nằm trong thân handler thì không nơi nào import được, nên "một lượt mỗi
 * khách mỗi ngày" chỉ còn được bảo vệ bằng chính dòng văn mô tả nó.
 */
export const MEDIA_VIEW_DEDUPE_RULE: RateLimitRule = {
  limit: 1,
  windowSeconds: MEDIA_VIEW_DEDUPE_WINDOW_SECONDS,
}
/** `bucket_key` là VARCHAR(191) và là khoá chính — xem `article-views.ts`. */
export const MEDIA_VIEW_DEDUPE_KEY_MAX_LENGTH = 191
/** 128 bit của một HMAC. Hai khách trùng nhau trên một video trong một ngày là
 *  chuyện không đáng lo; một khoá dài hơn thì chỉ tốn chỗ. */
export const MEDIA_VIEW_DEDUPE_TOKEN_LENGTH = 32
