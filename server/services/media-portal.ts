/**
 * Cổng media — hai nửa của cùng một bảng `media_items`: đường ĐỌC công khai và
 * đường GHI của quản trị.
 *
 * Hai nửa nằm chung một tệp vì chúng chia sẻ đúng một thứ dễ sai nhất: **tập cột
 * nào được ra khỏi máy chủ**. `media_items` mang theo `processing_status`,
 * `resolutions_ready`, `is_featured`, `status`, `created_by`, `claimed_by` và
 * `processing_error`; chuỗi cuối cùng chứa **đường dẫn tệp và thông báo FFmpeg**,
 * tức là nó mô tả cấu trúc đĩa của máy chủ cho bất kỳ ai gọi endpoint. Một lượt
 * `select()` trần rồi trả thẳng hàng sẽ đẩy hết nhóm đó ra ngoài, và nó **trông
 * đúng** — không có gì đỏ ở đâu cả.
 *
 * Nên `serializePublicMedia` **liệt kê từng trường** thay vì chép hàng. Hệ quả
 * cố ý: thêm một cột vào `media_items` sau này **không** tự động xuất hiện trong
 * phản hồi công khai; người thêm phải tự viết nó vào đây, và đó là bước duy nhất
 * trong toàn bộ thay đổi mà việc "quên" là an toàn theo hướng đúng.
 *
 * Ba đường đọc riêng biệt, không phải một đường tham số hoá:
 *   • `listPublishedMedia` / `getPublishedMediaBySlug` — chọn **tập cột công
 *     khai**, không hề chạm tới `storage_path`.
 *   • `resolveStreamTarget` / `resolveThumbnailTarget` — chọn **tập cột nội bộ**
 *     (cần `storage_path`, `source`, `youtube_video_id`) và **không bao giờ** trả
 *     một hàng cho nơi gọi: chúng trả về một đường dẫn tệp đã kiểm, hoặc `null`.
 *     Đây là ranh giới thật — một hàm trả hàng rồi để nơi gọi tự lọc là một hàm
 *     sẽ có nơi gọi thứ hai quên lọc.
 */
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import path from 'node:path'

import { and, asc, count, desc, eq, inArray, like, sql } from 'drizzle-orm'

import { activityLogs, categories, mediaAssetCleanup, mediaItems } from '../db/schema'
import { getDb, type Database } from '../utils/db'
import type { MediaConfig } from '../utils/media-config'
import { resolveMediaConfig } from '../utils/media-config'
import { likeContains } from '../utils/like-pattern'
import type { RateLimitRule } from '../utils/rate-limit-store'
import { uniqueMediaSlug } from '../utils/unique-media-slug'
import {
  buildMediaThumbnailPath,
  buildYouTubeEmbedUrl,
  buildYouTubeThumbnailUpstreamUrl,
  extractYouTubeVideoId,
} from '../utils/youtube-parser'
import { abortProcessingClaim, isPlayable, mediaAssetRoot } from './video-processing'

// ─── Hằng số ─────────────────────────────────────────────────────────────────

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
 * Khung chống đếm trùng: **trọn một ngày**.
 *
 * Khác `article-views.ts` (30 phút, vì ở đó một buổi chiều quay lại là một lượt
 * đọc thật thứ hai). Ở đây đặc tả nói thẳng "một lượt mỗi khách mỗi ngày", nên
 * khung phải phủ hết ngày; token bên dưới cũng sinh theo ngày nên khoá tự đổi
 * lúc nửa đêm UTC.
 */
export const MEDIA_VIEW_DEDUPE_WINDOW_SECONDS = 24 * 60 * 60

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

const MEDIA_THUMBNAIL_FILE = 'thumb.jpg'
const MEDIA_MASTER_PLAYLIST = 'master.m3u8'
const MEDIA_SUBDIR = 'media'
/** Trần độ dài một đường dẫn tài nguyên trong cây đã công bố. */
const MAX_ASSET_PATH_LENGTH = 512

/**
 * Đuôi tệp → kiểu nội dung, cho cây HLS đã công bố.
 *
 * `.m3u8` và `.ts` là hai đuôi thật sự được phục vụ. Danh sách **không** mở rộng
 * theo kiểu "thêm cho đủ": một đuôi không nhận ra đi ra dưới
 * `application/octet-stream` kèm `Content-Disposition: attachment`, đúng như
 * `server/routes/uploads/[...path].ts` làm — nội dung không rõ loại thì tải về,
 * không hiển thị.
 */
const STREAM_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.vtt': 'text/vtt',
}

// ─── Kiểm dữ liệu vào ────────────────────────────────────────────────────────

/** Lỗi dữ liệu vào, tách khỏi lỗi hệ thống để endpoint trả 400 thay vì 500. */
export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaValidationError'
  }
}

export function requireMediaTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title) throw new MediaValidationError('Tiêu đề không được để trống.')
  if (title.length > MEDIA_TITLE_MAX_LENGTH) {
    throw new MediaValidationError(`Tiêu đề tối đa ${MEDIA_TITLE_MAX_LENGTH} ký tự.`)
  }
  return title
}

/** Văn bản tuỳ chọn. Quá dài thì **từ chối**, không cắt ngầm — người gõ không có
 *  cách nào biết mình vừa mất đoạn cuối. */
export function optionalMediaText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new MediaValidationError(`${label} không hợp lệ.`)
  const text = value.trim()
  if (!text) return null
  if (text.length > max) throw new MediaValidationError(`${label} tối đa ${max} ký tự.`)
  return text
}

export function requireMediaSource(value: unknown): MediaSource {
  const source = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!(MEDIA_SOURCES as readonly string[]).includes(source)) {
    throw new MediaValidationError(`Nguồn phải là một trong: ${MEDIA_SOURCES.join(', ')}.`)
  }
  return source as MediaSource
}

export function requireMediaStatus(value: unknown): MediaItemStatus {
  const status = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!(MEDIA_ITEM_STATUSES as readonly string[]).includes(status)) {
    throw new MediaValidationError(`Trạng thái phải là một trong: ${MEDIA_ITEM_STATUSES.join(', ')}.`)
  }
  return status as MediaItemStatus
}

/**
 * `Boolean('false')` là `true`.
 *
 * Giá trị này đến từ thân request, nên một chuỗi `"false"` sẽ **bật** đúng cờ mà
 * cán bộ vừa tắt — cùng lớp lỗi đã làm rơi `openNewTab` của cấu hình điều hướng.
 * Chỉ nhận boolean thật, hoặc `1`/`0`.
 */
export function requireMediaBoolean(value: unknown, label: string): boolean {
  if (value === true || value === 1 || value === '1') return true
  if (value === false || value === 0 || value === '0') return false
  throw new MediaValidationError(`${label} phải là true hoặc false.`)
}

export function optionalMediaId(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new MediaValidationError(`${label} không hợp lệ.`)
  return id
}

// ─── Hình dạng công khai ─────────────────────────────────────────────────────

/** Tập cột mà đường đọc công khai **được phép** chọn. `storage_path`,
 *  `processing_error`, `status`, `created_by` và `claimed_by` không có mặt ở đây,
 *  nên chúng không thể rò ra qua một lượt `select` bị sửa sau này. */
const publicMediaSelection = {
  id: mediaItems.id,
  slug: mediaItems.slug,
  title: mediaItems.title,
  description: mediaItems.description,
  source: mediaItems.source,
  youtubeVideoId: mediaItems.youtubeVideoId,
  durationSeconds: mediaItems.durationSeconds,
  width: mediaItems.width,
  height: mediaItems.height,
  categoryId: mediaItems.categoryId,
  categoryName: categories.name,
  categorySlug: categories.slug,
  publishedAt: mediaItems.publishedAt,
  commentsEnabled: mediaItems.commentsEnabled,
  viewCount: mediaItems.viewCount,
  // Hai cột dưới đây **được chọn nhưng không được trả**: chúng quyết định
  // `playable`, và `playable` là câu trả lời duy nhất người đọc cần.
  processingStatus: mediaItems.processingStatus,
  resolutionsReady: mediaItems.resolutionsReady,
} as const

export type PublicMediaRow = {
  id: number
  slug: string
  title: string
  description: string | null
  source: string
  youtubeVideoId: string | null
  durationSeconds: number | null
  width: number | null
  height: number | null
  categoryId: number | null
  categoryName: string | null
  categorySlug: string | null
  publishedAt: Date | string | null
  commentsEnabled: boolean | null
  viewCount: number | string | null
  processingStatus: string | null
  resolutionsReady: string[] | null
}

export type PublicMediaItem = {
  id: number
  slug: string
  title: string
  description: string | null
  source: MediaSource
  categoryId: number | null
  categoryName: string | null
  categorySlug: string | null
  durationSeconds: number | null
  width: number | null
  height: number | null
  publishedAt: Date | string | null
  thumbnailUrl: string | null
  embedUrl: string | null
  streamUrl: string | null
  playable: boolean
  commentsEnabled: boolean
  viewCount: number
}

/** Đường dẫn phát, **trên chính cổng này**. Xem `buildMediaThumbnailPath` cho
 *  cùng lý do ở phía ảnh thu nhỏ: một địa chỉ kho ký sẵn đưa cho trình duyệt là
 *  đưa luôn vị trí kho, và nó nằm lại trong lịch sử cùng log của mọi trung gian. */
export function buildMediaStreamPath(slug: string): string {
  return `/api/public/media/${encodeURIComponent(slug)}/stream`
}

/**
 * Chép **từng trường** từ hàng nội bộ sang hình dạng công khai.
 *
 * Không dùng `...row` và không trả `row` đã bỏ vài khoá: cả hai đều là dạng
 * "cho qua rồi trừ đi", và dạng đó chỉ đúng cho tới khi có người thêm một cột.
 * Ở đây danh sách là **cho vào**, nên một cột mới mặc định là riêng tư.
 */
export function serializePublicMedia(row: PublicMediaRow): PublicMediaItem {
  const source: MediaSource = row.source === 'youtube' ? 'youtube' : 'upload'

  // `embedUrl` là `null` khi định danh đã lưu không qua được phép kiểm: một hàng
  // bị sửa tay trong CSDL không được phép sinh ra một `src` cho iframe.
  const embedUrl = source === 'youtube' ? buildYouTubeEmbedUrl(row.youtubeVideoId) : null

  // Ảnh thu nhỏ **luôn** dựng từ slug, không bao giờ đọc `thumbnail_url` đã lưu:
  // cột đó là một chuỗi tự do, và trả thẳng nó cho người đọc là để một giá trị
  // trong CSDL trở thành một origin tuỳ ý trong trình duyệt của công dân.
  const hasThumbnail = source === 'youtube' ? embedUrl !== null : true

  const playable = source === 'youtube' ? embedUrl !== null : isPlayable(row)

  return {
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    description: row.description ?? null,
    source,
    categoryId: row.categoryId ?? null,
    categoryName: row.categoryName ?? null,
    categorySlug: row.categorySlug ?? null,
    durationSeconds: row.durationSeconds ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    publishedAt: row.publishedAt ?? null,
    thumbnailUrl: hasThumbnail ? buildMediaThumbnailPath(String(row.slug)) : null,
    embedUrl,
    streamUrl: source === 'upload' && playable ? buildMediaStreamPath(String(row.slug)) : null,
    playable,
    commentsEnabled: row.commentsEnabled === true,
    viewCount: Number(row.viewCount ?? 0),
  }
}

// ─── Đọc công khai ───────────────────────────────────────────────────────────

export type PublishedMediaQuery = {
  page: number
  limit: number
  search?: string
  categorySlug?: string
}

export type PublishedMediaPage = {
  items: PublicMediaItem[]
  total: number
}

/**
 * Danh mục và **các danh mục con của nó** — gốc bao gồm con, đúng như
 * `server/api/public/articles.get.ts`. Một danh mục gốc không có mục nào nhưng
 * con nó có thì bấm vào gốc phải ra kết quả, không phải một trang trống.
 *
 * `null` nghĩa là **không có danh mục nào mang slug đó**. Nơi gọi đọc `null`
 * thành "kết quả rỗng", không phải "lỗi": bộ lọc nằm trong URL mà khách sửa được
 * và chia sẻ được, nên một liên kết cũ phải hiện trang trống chứ không phải một
 * thông báo lỗi — một liên kết hỏng đọc ra là cổng bị hỏng.
 */
async function resolveCategoryIds(db: Database, slug: string): Promise<number[] | null> {
  const [target] = await db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1)

  if (!target) return null
  if (target.parentId === null) {
    const children = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.parentId, target.id))
    return [target.id, ...children.map(child => child.id)]
  }
  return [target.id]
}

export async function listPublishedMedia(
  query: PublishedMediaQuery,
  deps: { db?: Database } = {},
): Promise<PublishedMediaPage> {
  const db = deps.db ?? getDb()

  const conditions = [eq(mediaItems.status, PUBLISHED_MEDIA_STATUS)]

  const search = typeof query.search === 'string' ? query.search.trim().slice(0, MEDIA_SEARCH_MAX_LENGTH) : ''
  if (search) conditions.push(like(mediaItems.title, likeContains(search)))

  const categorySlug = typeof query.categorySlug === 'string' ? query.categorySlug.trim() : ''
  if (categorySlug) {
    const ids = await resolveCategoryIds(db, categorySlug)
    if (ids === null) return { items: [], total: 0 }
    conditions.push(ids.length === 1 ? eq(mediaItems.categoryId, ids[0]!) : inArray(mediaItems.categoryId, ids))
  }

  const where = and(...conditions)
  const offset = Math.max(0, (query.page - 1) * query.limit)

  // Đếm và đọc chạy **cùng lúc**, không nối đuôi: hai truy vấn độc lập trên cùng
  // một `where`, nên thời gian chờ là lượt chậm hơn chứ không phải tổng hai lượt.
  const [rows, totals] = await Promise.all([
    db
      .select(publicMediaSelection)
      .from(mediaItems)
      .leftJoin(categories, eq(mediaItems.categoryId, categories.id))
      .where(where)
      // Cùng thứ tự với danh sách bài viết: ngày đăng, rồi ngày tạo. Mục chưa có
      // `published_at` (dữ liệu cũ) rơi xuống cuối thay vì lên đầu.
      .orderBy(desc(mediaItems.publishedAt), desc(mediaItems.createdAt))
      .limit(query.limit)
      .offset(offset),
    db.select({ total: count() }).from(mediaItems).where(where),
  ])

  return { items: rows.map(serializePublicMedia), total: Number(totals[0]?.total ?? 0) }
}

// ─── Danh sách quản trị ─────────────────────────────────────────────────────

/** Tập cột mà **đường quản trị** được phép chọn. Thêm so với đường công khai:
 *  `status`, `processingError`, `storagePath`, `isFeatured`, `createdBy`,
 *  `createdAt`, `updatedAt` — tất cả đều là thông tin mà cán bộ vận hành cần để
 *  quyết định xuất bản / gỡ / kiểm tra tiến trình, và **không** là thông tin mà
 *  công dân đọc được. Việc đặt chúng trong một selection tường minh (không
 *  `...mediaItems`) nghĩa là một cột mới thêm sau này phải được **đưa vào** mới
 *  thoát ra được, thay vì ngược lại.
 */
const adminMediaSelection = {
  ...publicMediaSelection,
  status:           mediaItems.status,
  processingError:  mediaItems.processingError,
  storagePath:      mediaItems.storagePath,
  thumbnailUrl:     mediaItems.thumbnailUrl,
  isFeatured:       mediaItems.isFeatured,
  createdBy:        mediaItems.createdBy,
  createdAt:        mediaItems.createdAt,
  updatedAt:        mediaItems.updatedAt,
} as const

export type AdminMediaRow = {
  id:              number
  slug:            string
  title:           string
  description:      string | null
  source:          string
  youtubeVideoId:  string | null
  durationSeconds: number | null
  width:           number | null
  height:          number | null
  categoryId:      number | null
  categoryName:    string | null
  categorySlug:   string | null
  status:          string
  processingStatus: string
  processingError:  string | null
  storagePath:      string | null
  thumbnailUrl:    string | null
  isFeatured:      boolean | null
  commentsEnabled: boolean | null
  viewCount:       number | string | null
  publishedAt:     Date | null
  createdBy:       number | null
  createdAt:       Date | null
  updatedAt:       Date | null
  resolutionsReady: string[] | null
}

export type AdminMediaItem = {
  id:              number
  slug:            string
  title:           string
  description:      string | null
  source:          MediaSource
  youtubeVideoId:  string | null
  durationSeconds: number | null
  width:           number | null
  height:          number | null
  categoryId:      number | null
  categoryName:    string | null
  categorySlug:   string | null
  status:          MediaItemStatus
  processingStatus: string
  processingError:  string | null
  storagePath:     string | null
  thumbnailUrl:     string | null
  isFeatured:      boolean
  commentsEnabled: boolean
  viewCount:       number
  publishedAt:     string | null
  createdBy:       number | null
  createdAt:       string | null
  updatedAt:       string | null
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
    thumbnailUrl:    row.thumbnailUrl ?? null,
    isFeatured:      row.isFeatured === true,
    commentsEnabled: row.commentsEnabled === true,
    viewCount:       Number(row.viewCount ?? 0),
    publishedAt:     row.publishedAt ? row.publishedAt.toISOString() : null,
    createdBy:       row.createdBy ?? null,
    createdAt:       row.createdAt ? row.createdAt.toISOString() : null,
    updatedAt:       row.updatedAt ? row.updatedAt.toISOString() : null,
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
  categoryId?:    number | null
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
      .leftJoin(categories, eq(mediaItems.categoryId, categories.id))
      .where(where)
      .orderBy(sortOrder(orderColumn), desc(mediaItems.id))
      .limit(query.limit)
      .offset(offset),
    db.select({ total: count() }).from(mediaItems).where(where),
  ])

  return {
    items: rows.map(row => serializeAdminMedia(row as unknown as AdminMediaRow)),
    total: Number(totals[0]?.total ?? 0),
    page:  query.page,
    limit: query.limit,
  }
}

/**
 * Một mục theo id cho màn hình quản trị, hoặc `null`.
 *
 * Khác `getPublishedMediaBySlug` ở chỗ: không lọc `status`, và trả đủ các trường
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
    .leftJoin(categories, eq(mediaItems.categoryId, categories.id))
    .where(eq(mediaItems.id, id))
    .limit(1)
  return row ? serializeAdminMedia(row as unknown as AdminMediaRow) : null
}

export type PublicMediaCategory = {
  id: number
  name: string
  slug: string
  count: number
}

/**
 * Số mục **đã xuất bản** theo từng danh mục.
 *
 * `innerJoin` chứ không `leftJoin`, và điều kiện `status = 'published'` nằm ngay
 * trong mệnh đề join: một danh mục hiện ra với số 0 là một danh mục bấm vào thấy
 * trống, mà không có gì trên màn hình giải thích vì sao. Bộ đếm và bộ lọc phải
 * đếm cùng một tập, nếu không con số tự nó nói dối.
 */
export async function countPublishedMediaByCategory(
  deps: { db?: Database } = {},
): Promise<PublicMediaCategory[]> {
  const db = deps.db ?? getDb()

  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      total: count(mediaItems.id),
    })
    .from(categories)
    .innerJoin(
      mediaItems,
      and(eq(mediaItems.categoryId, categories.id), eq(mediaItems.status, PUBLISHED_MEDIA_STATUS)),
    )
    .groupBy(categories.id, categories.name, categories.slug, categories.displayOrder)
    .orderBy(asc(categories.displayOrder), asc(categories.id))

  return rows.map(row => ({
    id: Number(row.id),
    name: String(row.name),
    slug: String(row.slug),
    count: Number(row.total),
  }))
}

/**
 * Một mục đã xuất bản theo slug, hoặc `null`.
 *
 * `null` cho **cả** slug không tồn tại **lẫn** slug của một mục `draft`/`archived`
 * — nơi gọi không được phân biệt hai trường hợp đó, vì một phản hồi khác nhau
 * giữa chúng là cách liệt kê ra những slug chưa xuất bản.
 */
export async function getPublishedMediaBySlug(
  slug: string,
  deps: { db?: Database } = {},
): Promise<PublicMediaItem | null> {
  const db = deps.db ?? getDb()
  const [row] = await db
    .select(publicMediaSelection)
    .from(mediaItems)
    .leftJoin(categories, eq(mediaItems.categoryId, categories.id))
    .where(and(eq(mediaItems.slug, slug), eq(mediaItems.status, PUBLISHED_MEDIA_STATUS)))
    .limit(1)

  return row ? serializePublicMedia(row) : null
}

/**
 * Id của một mục đã xuất bản theo slug, hoặc `null`.
 *
 * Một truy vấn **chỉ lấy id**, không phải `getPublishedMediaBySlug`: đường đếm
 * lượt xem chạy một lần mỗi lượt mở trang, và nó không cần tiêu đề, mô tả, tên
 * danh mục hay bất cứ thứ gì khác. Đi qua hàm kia sẽ kéo theo một phép join và
 * mười sáu cột cho một con số.
 */
export async function resolvePublishedMediaId(
  slug: string,
  deps: { db?: Database } = {},
): Promise<number | null> {
  const db = deps.db ?? getDb()
  const [row] = await db
    .select({ id: mediaItems.id })
    .from(mediaItems)
    .where(and(eq(mediaItems.slug, slug), eq(mediaItems.status, PUBLISHED_MEDIA_STATUS)))
    .limit(1)

  return row ? Number(row.id) : null
}

// ─── Đích phục vụ tệp (đường dẫn nội bộ) ─────────────────────────────────────

/** Tập cột nội bộ, chỉ dùng cho hai endpoint phục vụ tệp. Không có `select()`
 *  trần nào ở đây, cùng lý do như tập cột công khai. */
const assetMediaSelection = {
  id: mediaItems.id,
  slug: mediaItems.slug,
  source: mediaItems.source,
  youtubeVideoId: mediaItems.youtubeVideoId,
  storagePath: mediaItems.storagePath,
  storageProvider: mediaItems.storageProvider,
  status: mediaItems.status,
} as const

/**
 * Thư mục đã công bố của một mục: `<workdir>/media/<slug>`.
 *
 * Dựng từ `storage_path` khi có, và **luôn** kiểm lại rằng kết quả nằm trong
 * `<workdir>/media/`. `storage_path` là một chuỗi trong CSDL; một giá trị chứa
 * `../..` sẽ trỏ ra ngoài cây media, và chốt chặn không thể là "giá trị đó do
 * máy chủ ghi nên nó đúng".
 */
export function resolveMediaDirectory(
  config: MediaConfig,
  item: { slug: string, storagePath?: string | null },
): string | null {
  const root = path.resolve(config.workdir, MEDIA_SUBDIR)
  const stored = typeof item.storagePath === 'string' ? item.storagePath.trim() : ''
  const relative = stored || `${MEDIA_SUBDIR}/${item.slug}`
  const resolved = path.resolve(config.workdir, relative)
  if (resolved === root || !resolved.startsWith(root + path.sep)) return null
  return resolved
}

/**
 * Đường dẫn tài nguyên trong cây đã công bố, đã lọc bỏ mọi đoạn nguy hiểm.
 *
 * `..` bị **bỏ hẳn** (không phải từ chối): `a/../../b` thành `a/b`, đúng như
 * `server/routes/uploads/[...path].ts` làm. Phép kiểm `startsWith` ở nơi gọi là
 * lớp thứ hai, và hai lớp này độc lập — lớp này sai thì lớp kia vẫn đứng.
 */
export function normalizeAssetPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw || raw.length > MAX_ASSET_PATH_LENGTH) return null
  const segments = raw
    .replace(/\\/g, '/')
    .split('/')
    .filter(segment => segment && segment !== '.' && segment !== '..')
  if (segments.length === 0) return null
  return segments.join('/')
}

export type StreamTarget =
  | {
      kind: 'local'
      filePath: string
      contentType: string
      size: number
      cacheSeconds: number
      attachment: boolean
    }
  | {
      kind: 'r2'
      r2Key: string
      contentType: string
      size: number
      cacheSeconds: number
      attachment: boolean
    }

/**
 * Tệp cần phục vụ cho một yêu cầu phát, hoặc `null`.
 *
 * `null` gộp **mọi** lý do không phục vụ được: slug lạ, mục chưa xuất bản, mục
 * nguồn ngoài (không có gì để phát từ đĩa), đường dẫn thoát khỏi cây media, và
 * tệp không tồn tại. Nơi gọi chỉ có một nhánh 404, và không có nhánh nào trong
 * số đó nói ra lý do thật — một phản hồi khác nhau giữa chúng là cách liệt kê ra
 * những slug chưa xuất bản.
 *
 * R2: khi `storageProvider='r2'`, trả `{ kind: 'r2', r2Key }` — nơi gọi pipe
 * stream từ R2 qua proxy (không redirect, giữ design.md dòng 196 "không lộ
 * storage location"). `r2Key` = `storagePath + '/' + assetPath`.
 */
export async function resolveStreamTarget(
  slug: string,
  relativePath: unknown,
  deps: { db?: Database, config?: MediaConfig } = {},
): Promise<StreamTarget | null> {
  const db = deps.db ?? getDb()
  const config = deps.config ?? resolveMediaConfig()

  const assetPath = normalizeAssetPath(relativePath)
  if (!assetPath) return null

  const [row] = await db
    .select(assetMediaSelection)
    .from(mediaItems)
    .where(eq(mediaItems.slug, slug))
    .limit(1)

  if (!row || row.status !== PUBLISHED_MEDIA_STATUS) return null
  if (row.source !== 'upload') return null

  // R2 stream — `storagePath` là R2 key prefix (cùng hình dạng cây, khác backend).
  // Không kiểm `startsWith(directory)` vì không có filesystem — chỉ kiểm
  // `assetPath` đã lọc `..` qua `normalizeAssetPath`.
  if (row.storageProvider === 'r2') {
    const stored = typeof row.storagePath === 'string' ? row.storagePath.trim() : ''
    if (!stored) return null
    const r2Key = `${stored.replace(/\/+$/g, '')}/${assetPath}`
    const extension = path.extname(assetPath).toLowerCase()
    const known = STREAM_CONTENT_TYPES[extension]
    return {
      kind: 'r2',
      r2Key,
      contentType: known ?? 'application/octet-stream',
      size: 0, // không biết trước — R2 GetObject trả ContentLength, nơi gọi đọc
      cacheSeconds: extension === '.m3u8' ? MANIFEST_CACHE_SECONDS : SEGMENT_CACHE_SECONDS,
      attachment: known === undefined,
    }
  }

  const directory = resolveMediaDirectory(config, row)
  if (!directory) return null

  const filePath = path.resolve(directory, assetPath)
  if (filePath !== directory && !filePath.startsWith(directory + path.sep)) return null

  let size: number
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return null
    size = stat.size
  } catch {
    return null
  }

  const extension = path.extname(filePath).toLowerCase()
  const known = STREAM_CONTENT_TYPES[extension]

  return {
    kind: 'local',
    filePath,
    contentType: known ?? 'application/octet-stream',
    size,
    cacheSeconds: extension === '.m3u8' ? MANIFEST_CACHE_SECONDS : SEGMENT_CACHE_SECONDS,
    attachment: known === undefined,
  }
}

/** Đường dẫn manifest của một mục. Tách thành hằng để hai endpoint (manifest và
 *  tài nguyên) không thể lệch nhau về tên tệp. */
export const MEDIA_STREAM_MANIFEST_PATH = MEDIA_MASTER_PLAYLIST

export type ThumbnailTarget =
  | { kind: 'local', filePath: string, contentType: string, size: number }
  | { kind: 'remote', url: string }
  | { kind: 'r2', r2Key: string }

/**
 * Ảnh thu nhỏ của một mục đã xuất bản.
 *
 * Mục nguồn ngoài trả về **địa chỉ thượng nguồn** để endpoint đi lấy, và đó là
 * chỗ duy nhất trong toàn bộ mã công khai mà máy chủ ảnh của nền tảng được nêu
 * tên — nó không bao giờ đi vào một phản hồi. Tra theo `slug` của mục đã xuất
 * bản, không theo định danh video: khoá theo định danh thì bất kỳ ai cũng biến
 * cổng này thành một proxy ảnh mở cho mọi video trên nền tảng.
 *
 * R2: khi `storageProvider='r2'`, thumbnail nằm cùng cây R2 với rendition —
 * trả `{ kind: 'r2', r2Key }`, endpoint pipe qua proxy như stream.
 */
export async function resolveThumbnailTarget(
  slug: string,
  deps: { db?: Database, config?: MediaConfig } = {},
): Promise<ThumbnailTarget | null> {
  const db = deps.db ?? getDb()
  const config = deps.config ?? resolveMediaConfig()

  const [row] = await db
    .select(assetMediaSelection)
    .from(mediaItems)
    .where(eq(mediaItems.slug, slug))
    .limit(1)

  if (!row || row.status !== PUBLISHED_MEDIA_STATUS) return null

  if (row.source === 'youtube') {
    const url = buildYouTubeThumbnailUpstreamUrl(row.youtubeVideoId)
    return url ? { kind: 'remote', url } : null
  }

  // R2 thumbnail — cùng key prefix với rendition, tệp `thumb.jpg`.
  if (row.storageProvider === 'r2') {
    const stored = typeof row.storagePath === 'string' ? row.storagePath.trim() : ''
    if (!stored) return null
    return { kind: 'r2', r2Key: `${stored.replace(/\/+$/g, '')}/${MEDIA_THUMBNAIL_FILE}` }
  }

  const directory = resolveMediaDirectory(config, row)
  if (!directory) return null

  const filePath = path.join(directory, MEDIA_THUMBNAIL_FILE)
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return null
    return { kind: 'local', filePath, contentType: 'image/jpeg', size: stat.size }
  } catch {
    return null
  }
}

// ─── Đếm lượt xem ────────────────────────────────────────────────────────────

/**
 * `mv:<mediaItemId>:<32 hex đầu của token khách>`.
 *
 * Cùng khuôn `buildViewDedupeKey` của bài viết, tiền tố khác để hai bộ đếm không
 * bao giờ dùng chung một khoá: một id bài viết và một id mục media là hai dãy số
 * độc lập, nên trùng số là chuyện bình thường — và khi đó một lượt xem bài viết
 * sẽ chặn một lượt xem video.
 */
export function buildMediaViewDedupeKey(mediaItemId: number, visitorToken: string): string {
  const key = `mv:${mediaItemId}:${visitorToken.slice(0, MEDIA_VIEW_DEDUPE_TOKEN_LENGTH)}`
  if (key.length > MEDIA_VIEW_DEDUPE_KEY_MAX_LENGTH) {
    throw new Error(`media view dedupe key exceeds ${MEDIA_VIEW_DEDUPE_KEY_MAX_LENGTH} characters`)
  }
  return key
}

/**
 * Một lượt xem. Một câu lệnh, không transaction: đây là bộ đếm của cổng về nội
 * dung của chính nó, không kèm dòng audit nào (người xem là khách công khai, và
 * `activity_logs.user_id` là FK tới `users` — không có hàng nào để trỏ vào).
 */
export async function recordMediaView(
  mediaItemId: number,
  executor?: Pick<Database, 'update'>,
): Promise<void> {
  await (executor ?? getDb())
    .update(mediaItems)
    .set({ viewCount: sql`${mediaItems.viewCount} + 1` })
    .where(eq(mediaItems.id, mediaItemId))
}

// ─── Ghi quản trị ────────────────────────────────────────────────────────────

export type CreateMediaItemInput = {
  title: unknown
  description?: unknown
  source?: unknown
  youtubeVideoId?: unknown
  categoryId?: unknown
  storagePath?: unknown
  createdBy: number
}

export type CreatedMediaItem = { mediaItemId: number, slug: string }

/**
 * Tạo một mục media, cùng dòng audit trong **cùng một transaction**.
 *
 * Slug sinh qua `uniqueMediaSlug(tx, …)` — nhận **client giao dịch**, không nhận
 * `db`: lượt `SELECT` kiểm trùng phải đọc đúng ảnh chụp mà lượt `INSERT` sắp ghi
 * vào, nếu không hai lượt tạo cùng lúc cùng thấy "slug còn trống" và lượt thứ hai
 * ném lỗi UNIQUE.
 *
 * Id đọc vào **biến cục bộ** rồi `return` nó ra ngoài: đọc biến của chính khối
 * transaction trong dòng audit bên trong khối đó là vùng chết tạm thời, và hình
 * dạng đó đã làm bốn endpoint tạo mới của dự án trả 500.
 */
export async function createMediaItem(
  input: CreateMediaItemInput,
  // `Pick<Database, 'transaction'>` chứ không `Database`: nơi gọi có thể truyền
  // **client giao dịch đang mở** (lượt lưu buổi phát thành bản ghi ở
  // `livestream.ts` cần mục media và cột `saved_media_id` nằm chung một giao
  // dịch). Một `tx` không gán được cho `Database`, nhưng gán được cho đúng một
  // phương thức này — cùng lối đi mà `recordMediaView` đã dùng với
  // `Pick<Database, 'update'>`. Drizzle lồng giao dịch bằng SAVEPOINT, không mở
  // giao dịch thứ hai, nên lượt gọi lồng vẫn là **một** giao dịch thật.
  deps: { db?: Pick<Database, 'transaction'> } = {},
): Promise<CreatedMediaItem> {
  const db = deps.db ?? getDb()

  const title = requireMediaTitle(input.title)
  const source = requireMediaSource(input.source ?? 'upload')
  const description = optionalMediaText(input.description, MEDIA_DESCRIPTION_MAX_LENGTH, 'Mô tả')
  const categoryId = optionalMediaId(input.categoryId, 'Danh mục')
  const storagePath = source === 'upload'
    ? optionalMediaText(input.storagePath, 1024, 'Đường dẫn lưu trữ')
    : null
  // Chỉ mục nguồn ngoài mới có định danh video, và định danh đó bắt buộc phải bóc
  // ra được: lưu một giá trị không nhận ra là để nó hỏng ở trang công khai, nơi
  // không có gì giải thích vì sao khung nhúng trắng.
  const youtubeVideoId = source === 'youtube'
    ? requireMediaSourceId(input.youtubeVideoId)
    : null

  return db.transaction(async (tx) => {
    const slug = await uniqueMediaSlug(tx, title)
    const [inserted] = await tx.insert(mediaItems).values({
      slug,
      title,
      description,
      source,
      youtubeVideoId,
      storagePath,
      categoryId,
      status: 'draft',
      // Mục nguồn ngoài không có gì để chuyển mã, nên nó sẵn sàng ngay. Để
      // `pending` thì nó nằm mãi trong nhóm mà bộ dọn coi là việc đang dở.
      processingStatus: source === 'upload' ? 'pending' : 'ready',
      createdBy: input.createdBy,
    })

    const mediaItemId = Number(inserted?.insertId ?? 0)
    if (!mediaItemId) throw new Error('media_items insert returned no id')

    await tx.insert(activityLogs).values({
      userId: input.createdBy,
      action: 'create',
      resource: 'media_portal',
      resourceId: mediaItemId,
      // Chỉ id và giá trị không định danh. Slug **không** vào đây: nó là một
      // chuỗi do người gõ quyết định, và nhật ký kiểm toán không phải chỗ chở nó.
      meta: { source, hasCategory: categoryId !== null },
    })

    return { mediaItemId, slug }
  })
}

/** Định danh video của nền tảng ngoài, bắt buộc bóc ra được từ giá trị đã lưu. */
function requireMediaSourceId(value: unknown): string {
  const id = extractYouTubeVideoId(value)
  if (!id) throw new MediaValidationError('Địa chỉ video không hợp lệ hoặc không được hỗ trợ.')
  return id
}

export type UpdateMediaItemInput = {
  id: number
  actorId: number
  title?: unknown
  description?: unknown
  categoryId?: unknown
  status?: unknown
  commentsEnabled?: unknown
  isFeatured?: unknown
  youtubeVideoId?: unknown
}

export type UpdateMediaItemResult =
  | { ok: true, slug: string, status: MediaItemStatus }
  | { ok: false, reason: 'not_found' }

/**
 * Sửa một mục media, cùng dòng audit trong một transaction.
 *
 * **Tiêu đề đổi nhưng slug thì không.** Đây là quy tắc đã có của bài viết
 * (`articles/[id].put.ts` không slugify lại), và lý do là hậu quả: slug nằm trong
 * URL công khai, trong liên kết đã phát ra ngoài và trong chỉ mục tìm kiếm. Đổi
 * nó theo tiêu đề là làm chết mọi liên kết đã chia sẻ, cho một thay đổi mà cán bộ
 * không hề yêu cầu.
 */
export async function updateMediaItem(
  input: UpdateMediaItemInput,
  deps: { db?: Database } = {},
): Promise<UpdateMediaItemResult> {
  const db = deps.db ?? getDb()

  const changes: Record<string, unknown> = {}
  const changedFields: string[] = []

  if (input.title !== undefined) {
    changes.title = requireMediaTitle(input.title)
    changedFields.push('title')
  }
  if (input.description !== undefined) {
    changes.description = optionalMediaText(input.description, MEDIA_DESCRIPTION_MAX_LENGTH, 'Mô tả')
    changedFields.push('description')
  }
  if (input.categoryId !== undefined) {
    changes.categoryId = optionalMediaId(input.categoryId, 'Danh mục')
    changedFields.push('categoryId')
  }
  if (input.commentsEnabled !== undefined) {
    changes.commentsEnabled = requireMediaBoolean(input.commentsEnabled, 'Bật bình luận')
    changedFields.push('commentsEnabled')
  }
  if (input.isFeatured !== undefined) {
    changes.isFeatured = requireMediaBoolean(input.isFeatured, 'Nổi bật')
    changedFields.push('isFeatured')
  }
  if (input.youtubeVideoId !== undefined) {
    changes.youtubeVideoId = requireMediaSourceId(input.youtubeVideoId)
    changedFields.push('youtubeVideoId')
  }

  let requestedStatus: MediaItemStatus | null = null
  if (input.status !== undefined) {
    requestedStatus = requireMediaStatus(input.status)
    changes.status = requestedStatus
    changedFields.push('status')
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: mediaItems.id, slug: mediaItems.slug, status: mediaItems.status, publishedAt: mediaItems.publishedAt })
      .from(mediaItems)
      .where(eq(mediaItems.id, input.id))
      .limit(1)

    // Không có hàng nào thì không có gì để ghi và cũng không có gì để kể lại —
    // một dòng audit cho một lượt sửa không xảy ra là một dòng làm nhật ký mờ đi.
    if (!current) return { ok: false, reason: 'not_found' } as const

    const fromStatus = String(current.status) as MediaItemStatus
    const statusChanged = requestedStatus !== null && requestedStatus !== fromStatus

    // Xuất bản lần đầu đóng dấu `published_at`. Đổi từ `published` sang trạng thái
    // khác **giữ nguyên** dấu đó: rút bài rồi đăng lại không phải một lượt đăng mới.
    if (statusChanged && requestedStatus === PUBLISHED_MEDIA_STATUS && !current.publishedAt) {
      changes.publishedAt = new Date()
    }

    if (changedFields.length > 0) {
      await tx.update(mediaItems).set(changes).where(eq(mediaItems.id, input.id))
    }

    await tx.insert(activityLogs).values({
      userId: input.actorId,
      // `publish` là nhãn riêng vì "ai đã cho bài này lên cổng" là câu hỏi khác
      // với "ai đã sửa tiêu đề của nó", và trộn hai câu trả lời vào một nhãn là
      // làm cả hai khó trả lời hơn.
      action: statusChanged && requestedStatus === PUBLISHED_MEDIA_STATUS ? 'publish' : 'update',
      resource: 'media_portal',
      resourceId: input.id,
      meta: {
        changed: changedFields,
        fromStatus,
        toStatus: requestedStatus ?? fromStatus,
      },
    })

    return { ok: true, slug: String(current.slug), status: requestedStatus ?? fromStatus } as const
  })
}

export type DeleteMediaItemInput = { id: number, actorId: number }

/**
 * Xoá một mục media, cùng dòng audit trong một transaction.
 *
 * Thứ tự **xoá rồi ghi log, cả hai trong transaction** là chủ đích: ngoài
 * transaction thì câu thứ hai hỏng sẽ để lại một hàng đã mất mà không còn gì ghi
 * ai xoá — và với một lượt xoá thì không có gì để đối chiếu sửa lại.
 *
 * Tác dụng phụ `rm()` vẫn nằm ngoài transaction, nhưng transaction ghi một outbox
 * bền vững. Worker sẽ retry việc xoá sau commit/restart thay vì để tệp mồ côi.
 */
export async function deleteMediaItem(
  input: DeleteMediaItemInput,
  deps: { db?: Database } = {},
): Promise<boolean> {
  const db = deps.db ?? getDb()

  const outcome = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: mediaItems.id, slug: mediaItems.slug, source: mediaItems.source, status: mediaItems.status,
        storagePath: mediaItems.storagePath, storageProvider: mediaItems.storageProvider, claimedBy: mediaItems.claimedBy })
      .from(mediaItems)
      .where(eq(mediaItems.id, input.id))
      .limit(1)

    if (!current) return { removed: false as const, claim: null as string | null }

    let assetRoot: string | null = null
    if (current.source === 'upload') {
      try { assetRoot = mediaAssetRoot(current) } catch { /* invalid legacy path: preserve it for manual inspection */ }
    }

    if (assetRoot) {
      await tx.insert(mediaAssetCleanup).values({
        id: randomUUID(), assetRoot,
        // `assetRoot` là R2 key prefix khi storageProvider='r2', local path khi
        // 'local' — worker branch theo cột này để xoá đúng backend.
        storageProvider: current.storageProvider,
        // A worker cannot race a just-aborted encoder; defer one short interval.
        nextAttemptAt: new Date(Date.now() + 30_000),
      })
    }

    await tx.delete(mediaItems).where(eq(mediaItems.id, input.id))
    await tx.insert(activityLogs).values({
      userId: input.actorId,
      action: 'delete',
      resource: 'media_portal',
      resourceId: input.id,
      // Trạng thái lúc xoá là thứ duy nhất còn nói được mục này đã từng ở trên
      // cổng hay chưa — sau lượt xoá, hàng không còn để hỏi lại.
      meta: { source: String(current.source), fromStatus: String(current.status) },
    })

    return { removed: true as const, claim: current.claimedBy }
  })

  if (outcome.removed) abortProcessingClaim(outcome.claim)
  return outcome.removed
}
