/**
 * Đường ĐỌC quản trị của cổng media — `listAllMediaForAdmin`/`getMediaItemForAdmin`
 * và hình dạng quản trị (`AdminMediaItem`). Tách khỏi `media-portal.ts` để hai
 * đường đọc (công khai vs quản trị) không chung một tệp nhưng chia sẻ rõ ràng
 * tập cột công khai qua `publicMediaSelection` (re-export từ file public).
 *
 * Khác đường công khai ở ba điểm có chủ đích:
 *  1. **Không lọc `status`** — cán bộ vận hành cần thấy draft, đang xử lý, đã
 *     gỡ, và đã xuất bản cùng lúc.
 *  2. **Trả `processingError`, `storagePath`, `status`** — đúng ba thứ đường
 *     công khai cố ý loại ra.
 *  3. **Sắp xếp mặc định theo `updatedAt`** — một mục vừa được sửa hoặc vừa nhận
 *     heartbeat từ pipeline là mục cán bộ cần thấy đầu tiên.
 */
import { and, asc, count, desc, eq, like } from 'drizzle-orm'

import { mediaCategories, mediaItems } from '../db/schema'
import { getDb, type Database } from '../utils/db'
import { likeContains } from '../utils/like-pattern'
import {
  MEDIA_SEARCH_MAX_LENGTH,
  type MediaItemStatus,
  type MediaSource,
} from './media-portal-constants'
import { coerceResolutionsReady } from './media-portal-public'

/**
 * Tập cột mà **đường quản trị** được phép chọn. Thêm so với đường công khai:
 *  `status`, `processingError`, `storagePath`, `createdBy`,
 *  `createdAt`, `updatedAt` — tất cả đều là thông tin mà cán bộ vận hành cần để
 *  quyết định xuất bản / gỡ / kiểm tra tiến trình, và **không** là thông tin mà
 *  công dân đọc được. (`isFeatured` giờ đã thuộc đường công khai — nó quyết định
 *  thứ tự danh sách và công dân thấy huy hiệu.) Việc đặt chúng trong một selection
 *  tường minh (không `...mediaItems`) nghĩa là một cột mới thêm sau này phải được
 *  **đưa vào** mới thoát ra được, thay vì ngược lại.
 *
 *  Không re-export `publicMediaSelection` từ file public vì nó là const nội bộ;
 *  admin selection mở rộng nó bằng cách liệt kê lại + thêm cột. Sự trùng lặp
 *  là cố ý: hai selection tách rời cho phép đường công khai thay đổi không kéo
 *  theo đường quản trị, và ngược lại.
 */
const adminMediaSelection = {
  id: mediaItems.id,
  slug: mediaItems.slug,
  shortId: mediaItems.shortId,
  title: mediaItems.title,
  description: mediaItems.description,
  source: mediaItems.source,
  youtubeVideoId: mediaItems.youtubeVideoId,
  durationSeconds: mediaItems.durationSeconds,
  width: mediaItems.width,
  height: mediaItems.height,
  categoryId: mediaItems.categoryId,
  categoryName: mediaCategories.name,
  categorySlug: mediaCategories.slug,
  publishedAt: mediaItems.publishedAt,
  commentsEnabled: mediaItems.commentsEnabled,
  viewCount: mediaItems.viewCount,
  isFeatured: mediaItems.isFeatured,
  processingStatus: mediaItems.processingStatus,
  resolutionsReady: mediaItems.resolutionsReady,
  // ── Thêm so với đường công khai ──
  status: mediaItems.status,
  processingError: mediaItems.processingError,
  storagePath: mediaItems.storagePath,
  // Cán bộ vận hành cần biết video nằm trên đĩa local hay R2 — để biết nút "Chuyển
  // mã" sẽ chạy trên máy này hay đẩy lên nhà cung cấp, và để chẩn đoán một mục đã
  // xuất bản mà không xem được (target sai tầng lưu trữ). Cột này KHÔNG thuộc
  // `publicMediaSelection` — công dân không cần (và không được) biết video nằm đâu.
  storageProvider: mediaItems.storageProvider,
  thumbnailUrl: mediaItems.thumbnailUrl,
  createdBy: mediaItems.createdBy,
  createdAt: mediaItems.createdAt,
  updatedAt: mediaItems.updatedAt,
  // Tiến trình FFmpeg thật — 3 cột để UI vẽ thanh % cho bản đang nén.
  processingRendition: mediaItems.processingRendition,
  processingPercent: mediaItems.processingPercent,
  processingPhase: mediaItems.processingPhase,
} as const

export type AdminMediaRow = {
  id:              number
  slug:            string
  shortId:         string
  title:           string
  description:     string | null
  source:          string
  youtubeVideoId:  string | null
  durationSeconds: number | null
  width:           number | null
  height:          number | null
  categoryId:      number | null
  categoryName:    string | null
  categorySlug:    string | null
  status:          string
  processingStatus: string
  processingError: string | null
  storagePath:     string | null
  storageProvider: string | null
  thumbnailUrl:    string | null
  isFeatured:      boolean | null
  commentsEnabled: boolean | null
  viewCount:       number | string | null
  publishedAt:     Date | null
  createdBy:       number | null
  createdAt:       Date | null
  updatedAt:       Date | null
  resolutionsReady: string[] | null
  processingRendition: string | null
  processingPercent: number | null
  processingPhase: string | null
}

export type AdminMediaItem = {
  id:              number
  slug:            string
  /** Định danh URL công khai — `/media/<shortId>`. Admin cần xem để chia sẻ link. */
  shortId:         string
  title:           string
  description:     string | null
  source:          MediaSource
  youtubeVideoId:  string | null
  durationSeconds: number | null
  width:           number | null
  height:          number | null
  categoryId:      number | null
  categoryName:    string | null
  categorySlug:    string | null
  status:          MediaItemStatus
  processingStatus: string
  processingError: string | null
  storagePath:     string | null
  /** 'r2' | 'local' | null — nơi video đang nằm, để cán bộ chẩn đoán/khởi động transcode đúng. */
  storageProvider: 'r2' | 'local' | null
  thumbnailUrl:    string | null
  isFeatured:      boolean
  commentsEnabled: boolean
  viewCount:       number
  publishedAt:     string | null
  createdBy:       number | null
  createdAt:       string | null
  updatedAt:       string | null
  /** Các bản đã chuyển mã xong — UI đọc để vẽ timeline + quyết định nút transcode. */
  resolutionsReady: string[] | null
  /** Bản đang nén ('360p'/'720p'/'1080p') hoặc null — để UI vẽ thanh % cho bản hiện tại. */
  processingRendition: string | null
  /** % nén của bản hiện tại (0–100) hoặc null. */
  processingPercent: number | null
  /** Giai đoạn pipeline ('probe'|'transcode'|'thumbnail'|'sync') hoặc null. */
  processingPhase: string | null
}

/**
 * Chuyển hàng nội bộ sang hình dạng dành cho quản trị viên.
 *
 * Tách khỏi `serializePublicMedia` vì hai hình dạng phục vụ hai câu hỏi khác nhau:
 *  đường công khai hỏi "công dân được thấy gì", đường quản trị hỏi "cán bộ vận
 *  hành cần biết gì để xuất bản/gỡ/kiểm tra". Trộn chúng là một trường `status`
 *  hoặc `processingError` rò ra đường công khai, và không có gì đỏ cho tới khi
 *  ai đó soi payload của một API công khai.
 */
export function serializeAdminMedia(row: AdminMediaRow): AdminMediaItem {
  const source: MediaSource = row.source === 'youtube' ? 'youtube' : 'upload'
  return {
    id:              Number(row.id),
    slug:            String(row.slug),
    shortId:         String(row.shortId),
    title:           String(row.title),
    description:     row.description ?? null,
    source,
    youtubeVideoId:  row.youtubeVideoId ?? null,
    durationSeconds: row.durationSeconds ?? null,
    width:           row.width ?? null,
    height:          row.height ?? null,
    categoryId:      row.categoryId ?? null,
    categoryName:    row.categoryName ?? null,
    categorySlug:    row.categorySlug ?? null,
    status:          (row.status === 'published' || row.status === 'archived' ? row.status : 'draft') as MediaItemStatus,
    processingStatus: String(row.processingStatus),
    processingError:  row.processingError ?? null,
    storagePath:     row.storagePath ?? null,
    // `storage_provider` chỉ nhận 'r2' hoặc 'local' ở tầng ghi; null là mục chưa
    // transcode (passthrough mới hoàn tất) — đọc thành 'local' ở giao diện gây
    // hiểu nhầm, nên giữ nguyên null để badge suy diễn.
    storageProvider:  (row.storageProvider === 'r2' || row.storageProvider === 'local') ? row.storageProvider : null,
    thumbnailUrl:    row.thumbnailUrl ?? null,
    isFeatured:      row.isFeatured === true,
    commentsEnabled: row.commentsEnabled === true,
    viewCount:       Number(row.viewCount ?? 0),
    publishedAt:     row.publishedAt ? row.publishedAt.toISOString() : null,
    createdBy:       row.createdBy ?? null,
    createdAt:       row.createdAt ? row.createdAt.toISOString() : null,
    updatedAt:       row.updatedAt ? row.updatedAt.toISOString() : null,
    // `resolutions_ready` là json() — driver thật parse sẵn, pool giả thì chuỗi.
    // `coerceResolutionsReady` thống nhất cả hai; trả null khi rỗng ("chưa có bản
    // nào" và "chưa transcode" đọc giống nhau ở UI, và đó là đúng: cả hai đều
    // chưa có bản nào để vẽ).
    resolutionsReady: coerceResolutionsReady(row.resolutionsReady),
    processingRendition: row.processingRendition ?? null,
    // Giới hạn 0–100 — FFmpeg thỉnh thoảng báo >100 do rounding; UI không vẽ >100.
    processingPercent: typeof row.processingPercent === 'number'
      ? Math.min(100, Math.max(0, row.processingPercent))
      : null,
    processingPhase: row.processingPhase ?? null,
  }
}

/** Khoá sắp xếp hợp lệ cho danh sách quản trị. */
const ADMIN_SORT_KEYS = new Set(['updatedAt', 'createdAt', 'publishedAt', 'title', 'viewCount'])

export type AdminMediaQuery = {
  page:            number
  limit:           number
  search?:         string
  status?:         MediaItemStatus
  source?:         MediaSource
  categoryId?:     number | null
  processingStatus?: string
  sort?:           string
  order?:          'asc' | 'desc'
}

export type AdminMediaPage = {
  items: AdminMediaItem[]
  total: number
  page:  number
  limit: number
}

/**
 * Danh sách **mọi** mục media cho màn hình quản trị — bao gồm `draft`,
 * `published`, `archived`, và mục đang xử lý.
 *
 * khác `listPublishedMedia` ở ba điểm có chủ đích:
 *  1. **Không lọc `status`** — cán bộ vận hành cần thấy draft, đang xử lý, đã
 *     gỡ, và đã xuất bản cùng lúc trên cùng một màn hình. Lọc theo `status` là
 *     một tuỳ chọn (tham số `status`), không phải mặc định.
 *  2. **Trả `processingError`, `storagePath`, `status`** — đúng ba thứ đường
 *     công khai cố ý loại ra. Một mục `failed` mà danh sách quản trị không cho
 *     thấy lý do là mục mà cán bộ không có cách nào biết vì sao nó hỏng.
 *  3. **Sắp xếp mặc định theo `updatedAt`** — một mục vừa được sửa hoặc vừa nhận
 *     heartbeat từ pipeline là mục cán bộ cần thấy đầu tiên, khác với đường
 *     công khai sắp theo `publishedAt` vì ở đó "mới đăng" mới là thông tin hữu ích
 *     nhất cho công dân.
 *
 * `categoryId` nhận **một số** (không phải slug): màn hình quản trị đã có id của
 * danh mục trong tay và không cần đường dẫn công khai. Hàm `resolveCategoryIds`
 * của đường công khai giải slug → ids để công dân có thể chia sẻ liên kết theo
 * tên danh mục; ở đây đó là một truy vấn phụ không cần thiết.
 */
export async function listAllMediaForAdmin(
  query: AdminMediaQuery,
  deps: { db?: Database } = {},
): Promise<AdminMediaPage> {
  const db = deps.db ?? getDb()

  const conditions = []

  const search = typeof query.search === 'string' ? query.search.trim().slice(0, MEDIA_SEARCH_MAX_LENGTH) : ''
  if (search) conditions.push(like(mediaItems.title, likeContains(search)))

  if (query.status) conditions.push(eq(mediaItems.status, query.status))
  if (query.source) conditions.push(eq(mediaItems.source, query.source))
  if (query.processingStatus) conditions.push(eq(mediaItems.processingStatus, query.processingStatus))
  if (typeof query.categoryId === 'number' && query.categoryId > 0) {
    conditions.push(eq(mediaItems.categoryId, query.categoryId))
  }

  const where = conditions.length ? and(...conditions) : undefined
  const offset = Math.max(0, (query.page - 1) * query.limit)

  const sortKey = query.sort && ADMIN_SORT_KEYS.has(query.sort) ? query.sort : 'updatedAt'
  const sortOrder = query.order === 'asc' ? asc : desc
  const orderColumn = sortKey === 'title'
    ? mediaItems.title
    : sortKey === 'createdAt'
      ? mediaItems.createdAt
      : sortKey === 'publishedAt'
        ? mediaItems.publishedAt
        : sortKey === 'viewCount'
          ? mediaItems.viewCount
          : mediaItems.updatedAt

  const [rows, totals] = await Promise.all([
    db
      .select(adminMediaSelection)
      .from(mediaItems)
      .leftJoin(mediaCategories, eq(mediaItems.categoryId, mediaCategories.id))
      .where(where)
      .orderBy(sortOrder(orderColumn), desc(mediaItems.id))
      .limit(query.limit)
      .offset(offset),
    db.select({ total: count() }).from(mediaItems).where(where),
  ])

  return {
    items: rows.map(row => serializeAdminMedia(row)),
    total: Number(totals[0]?.total ?? 0),
    page:  query.page,
    limit: query.limit,
  }
}

/**
 * Một mục theo id cho màn hình quản trị, hoặc `null`.
 *
 * Khác `getPublishedMediaByShortId` ở chỗ: không lọc `status`, và trả đủ các trường
 * đường công khai loại ra (`status`, `processingError`, `storagePath`). Đây là
 * hình dạng mà 7.6 cần: một mục `failed` phải hiện ra cùng lý do, không bị ẩn
 * đi chỉ vì nó không thuộc tập "đã xuất bản".
 */
export async function getMediaItemForAdmin(
  id: number,
  deps: { db?: Database } = {},
): Promise<AdminMediaItem | null> {
  const db = deps.db ?? getDb()
  const [row] = await db
    .select(adminMediaSelection)
    .from(mediaItems)
    .leftJoin(mediaCategories, eq(mediaItems.categoryId, mediaCategories.id))
    .where(eq(mediaItems.id, id))
    .limit(1)
  return row ? serializeAdminMedia(row) : null
}
