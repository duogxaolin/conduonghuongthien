/**
 * Kiểu bản ghi mà các trang quản trị nhận từ API.
 *
 * **Suy ra từ chính handler, không viết tay.** Đó là điểm mấu chốt: các endpoint
 * này gần như đều dùng projection (`db.select({ ... })`) chứ không trả nguyên
 * một hàng, và nhiều cái còn có trường ghép từ `leftJoin` — `users` trả kèm
 * `roleName` vốn không tồn tại trong bảng `users`. Nên dùng thẳng
 * `typeof users.$inferSelect` từ `schema.ts` sẽ **sai theo hai hướng cùng lúc**:
 * thừa cột không được trả về, thiếu cột được trả về.
 *
 * Một interface viết tay thì đúng đúng một lần — vào ngày nó được viết. Thêm
 * một cột vào projection mà quên sửa interface, và TypeScript vẫn xanh trong
 * khi trang không biết trường mới tồn tại; bỏ một cột đi thì tệ hơn, vì mã đọc
 * trường đã biến mất vẫn biên dịch được rồi hiện `undefined` cho cán bộ.
 * `Awaited<ReturnType<typeof handler>>` không có khoảng cách đó: đổi projection
 * là kiểu đổi theo, và mọi nơi đọc sai sẽ đỏ ngay ở lượt typecheck kế tiếp.
 *
 * Lối này đã có tiền lệ trong dự án — `adminKnowledge()` ở
 * `server/services/chatbot-knowledge.ts` dùng đúng kỹ thuật này.
 *
 * Chỉ khai những kiểu **có nơi dùng thật**. Một kiểu dự phòng không ai import
 * là một lời khẳng định chưa bao giờ được đối chiếu với gì.
 */

/**
 * Phản hồi **sau khi đi qua JSON**, không phải giá trị handler trả về.
 *
 * Khác biệt này là thật và cổng typecheck đã bắt được ngay: handler trả `Date`
 * cho các cột thời gian, nhưng `$fetch` nhận về **chuỗi** — JSON không có kiểu
 * ngày. Suy thẳng `Awaited<ReturnType<...>>` sẽ khai `createdAt: Date`, nên mã
 * gọi `.getTime()` trên một chuỗi vẫn biên dịch trót lọt rồi hỏng lúc chạy.
 * `Serialize` của Nitro mô phỏng đúng phép biến đổi đó (`Date → string`,
 * `Map`/`Set → {}`, `undefined` biến mất), nên kiểu ở đây khớp với **thứ trình
 * duyệt thật sự cầm trên tay**.
 */
import type { Serialize } from 'nitropack/types'

type Payload<T> = Serialize<Awaited<ReturnType<T extends (...args: never[]) => unknown ? T : never>>>

/** Lấy phần tử của một mảng nằm trong phản hồi, ví dụ `{ ok, users: [...] }`. */
type ItemOf<T> = T extends readonly (infer U)[] ? U : never

// ─── Người dùng & phân quyền ─────────────────────────────────────────────────
type UsersHandler = typeof import('~~/server/api/admin/users/index.get').default
export type AdminUserRow = ItemOf<Payload<UsersHandler>['users']>

type RolesHandler = typeof import('~~/server/api/admin/roles/index.get').default
export type AdminRoleRow = ItemOf<Payload<RolesHandler>['roles']>

// ─── Nội dung ────────────────────────────────────────────────────────────────
type CategoriesHandler = typeof import('~~/server/api/admin/categories/index.get').default
export type AdminCategoryRow = ItemOf<Payload<CategoriesHandler>['items']>

type ContentTypesHandler = typeof import('~~/server/api/admin/content-types/index.get').default
export type AdminContentTypeRow = ItemOf<Payload<ContentTypesHandler>['items']>

type PagesHandler = typeof import('~~/server/api/admin/pages/index.get').default
export type AdminPageRow = ItemOf<Payload<PagesHandler>['items']>

// ─── Đơn đăng ký ─────────────────────────────────────────────────────────────
type SubmissionsHandler = typeof import('~~/server/api/admin/submissions/index.get').default
export type AdminSubmissionRow = ItemOf<Payload<SubmissionsHandler>['submissions']>

/**
 * Chi tiết một đơn và nhật ký xử lý của nó. **Không** dùng lại
 * `AdminSubmissionRow`: hai endpoint có projection khác nhau — trang danh sách
 * không trả nhật ký, trang chi tiết không trả cột dùng để sắp xếp bảng. Gộp kiểu
 * là khai một trường tồn tại ở nơi nó không tồn tại.
 */
type SubmissionDetailHandler = typeof import('~~/server/api/admin/submissions/[id]/index.get').default
export type AdminSubmissionDetail = Payload<SubmissionDetailHandler>['submission']
export type AdminSubmissionEvent = ItemOf<Payload<SubmissionDetailHandler>['events']>

// ─── Bài viết & kho kiến thức ────────────────────────────────────────────────
type ArticlesHandler = typeof import('~~/server/api/admin/articles/index.get').default
export type AdminArticleRow = ItemOf<Payload<ArticlesHandler>['items']>

type KnowledgeHandler = typeof import('~~/server/api/admin/chatbot/knowledge/index.get').default
export type AdminKnowledgeRow = ItemOf<Payload<KnowledgeHandler>['items']>

type PageVersionsHandler = typeof import('~~/server/api/admin/pages/[id]/versions/index.get').default
export type PageVersionRow = ItemOf<Payload<PageVersionsHandler>['versions']>

type PageDetailHandler = typeof import('~~/server/api/admin/pages/[id].get').default
export type AdminPageDetail = Payload<PageDetailHandler>

type PageUpdateHandler = typeof import('~~/server/api/admin/pages/[id].put').default
export type AdminPageUpdateResult = Payload<PageUpdateHandler>

// ─── Người đọc ───────────────────────────────────────────────────────────────
type ReaderDetailHandler = typeof import('~~/server/api/admin/readers/[id].get').default
export type AdminReaderDetail = Payload<ReaderDetailHandler>

type ReaderImpactHandler = typeof import('~~/server/api/admin/readers/[id]/impact.get').default
export type AdminReaderImpact = Payload<ReaderImpactHandler>

// ─── Kho kiến thức (một mục) ─────────────────────────────────────────────────
type KnowledgeDetailHandler = typeof import('~~/server/api/admin/chatbot/knowledge/[id].get').default
export type AdminKnowledgeDetail = Payload<KnowledgeDetailHandler>

// ─── Nhập Excel & thống kê lượt xem ──────────────────────────────────────────
type KnowledgeImportHandler = typeof import('~~/server/api/admin/chatbot/knowledge/import.post').default
export type AdminKnowledgeImportResult = Payload<KnowledgeImportHandler>
export type AdminKnowledgeImportError = ItemOf<AdminKnowledgeImportResult['errors']>

type ArticleStatsHandler = typeof import('~~/server/api/admin/articles/[id]/stats.get').default
export type AdminArticleStatsResult = Payload<ArticleStatsHandler>
/** Chỉ khối `stats` — modal giữ đúng nhánh này, không giữ cả phản hồi. */
export type AdminArticleStats = AdminArticleStatsResult['stats']
export type AdminArticleBoost = AdminArticleStatsResult['boost']

type ArticleAuthorsHandler = typeof import('~~/server/api/admin/articles/authors.get').default
export type AdminArticleAuthorRow = ItemOf<Payload<ArticleAuthorsHandler>['items']>

type SmallTalkHandler = typeof import('~~/server/api/admin/chatbot/small-talk/index.get').default
export type AdminSmallTalkRow = ItemOf<Payload<SmallTalkHandler>['items']>

type ReaderBanHandler = typeof import('~~/server/api/admin/readers/[id]/ban.post').default
export type AdminReaderBanResult = Payload<ReaderBanHandler>

type ReaderCommentsDeleteHandler = typeof import('~~/server/api/admin/readers/[id]/comments.delete').default
export type AdminReaderCommentsDeleteResult = Payload<ReaderCommentsDeleteHandler>

// ─── Lịch sử hoạt động ───────────────────────────────────────────────────────
type ActivityRetentionHandler = typeof import('~~/server/api/admin/activity-logs/retention.get').default
export type ActivityRetentionStatus = Payload<ActivityRetentionHandler>

// ─── Thư viện ảnh ────────────────────────────────────────────────────────────
type MediaUploadHandler = typeof import('~~/server/api/admin/media/upload.post').default
export type AdminMediaUploadResult = Payload<MediaUploadHandler>

type MediaListHandler = typeof import('~~/server/api/admin/media/index.get').default
export type AdminMediaRow = ItemOf<Payload<MediaListHandler>['items']>
