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
import { statSync, readdirSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { and, asc, count, desc, eq, inArray, like, sql } from 'drizzle-orm'

import { activityLogs, media, mediaCategories, mediaAssetCleanup, mediaItems } from '../db/schema'
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
import { locateR2Original, listR2Keys, putR2Object } from './video-r2-sync'
import { type R2Config } from '../utils/media-r2'
import sharp from 'sharp'

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
  // Tệp gốc khi `MEDIA_AUTO_TRANSCODE=false` — không có HLS, stream endpoint phục
  // vụ trực tiếp `original.<ext>` qua byte-range. Bốn thùng chứa nhận ở đường tải
  // lên (xem `EXT_BY_VIDEO_MIME`); chỉ `.mp4` và `.webm` trình duyệt phát được
  // gốc, `.mov`/`.mkv` phụ thuộc codec — nhưng phục vụ đúng content-type vẫn đúng
  // hơn `application/octet-stream` (kèm nosniff trình duyệt tự quyết định).
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
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
  categoryName: mediaCategories.name,
  categorySlug: mediaCategories.slug,
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
  /**
   * `hls` khi có rendition (manifest `master.m3u8`), `file` khi phục vụ tệp gốc
   * trực tiếp qua byte-range (`MEDIA_AUTO_TRANSCODE=false`, không rendition).
   *
   * Player dùng trường này để chọn hls.js (cho `hls`) hay native `<video src>`
   * (cho `file`): hls.js nhận một URL mp4 mà đi parse như m3u8 sẽ không phát được,
   * và trình duyệt phát mp4 gốc qua `<video>` nhanh hơn nhiều so với đi qua thư viện.
   * `null` khi chưa phát được (chưa xử lý xong, hoặc nguồn youtube).
   */
  streamKind: 'hls' | 'file' | null
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
    // `streamKind` chỉ có ý nghĩa khi `streamUrl` khác null (upload + playable).
    // Có rendition HLS → `hls`; `ready` mà không có rendition (autoTranscode=false)
    // → tệp gốc phục vụ trực tiếp → `file`. Youtubeembed (`embedUrl`) không đi qua
    // nhánh này nên `null`.
    streamKind:
      source === 'upload' && playable
        ? (coerceResolutionsReady(row.resolutionsReady)?.length ? 'hls' : 'file')
        : null,
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
 * Id của danh mục media theo slug, hoặc `null` nếu không có.
 *
 * `media_categories` phẳng (không cha-con) nên không cần resolves con như
 * `categories` bài viết. `null` nghĩa là **không có danh mục nào mang slug đó**;
 * nơi gọi đọc `null` thành "kết quả rỗng", không phải "lỗi": bộ lọc nằm trong URL
 * mà khách sửa được và chia sẻ được, nên một liên kết cũ phải hiện trang trống
 * chứ không phải một thông báo lỗi — một liên kết hỏng đọc ra là cổng bị hỏng.
 */
async function resolveCategoryIds(db: Database, slug: string): Promise<number[] | null> {
  const [target] = await db
    .select({ id: mediaCategories.id })
    .from(mediaCategories)
    .where(eq(mediaCategories.slug, slug))
    .limit(1)

  if (!target) return null
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
      .leftJoin(mediaCategories, eq(mediaItems.categoryId, mediaCategories.id))
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
  // Cán bộ vận hành cần biết video nằm trên đĩa local hay R2 — để biết nút "Chuyển
  // mã" sẽ chạy trên máy này hay đẩy lên nhà cung cấp, và để chẩn đoán một mục đã
  // xuất bản mà không xem được (target sai tầng lưu trữ). Cột này KHÔNG thuộc
  // `publicMediaSelection` — công dân không cần (và không được) biết video nằm đâu.
  storageProvider:  mediaItems.storageProvider,
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
  storageProvider:  string | null
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
  /** 'r2' | 'local' | null — nơi video đang nằm, để cán bộ chẩn đoán/khởi động transcode đúng. */
  storageProvider:  'r2' | 'local' | null
  thumbnailUrl:     string | null
  isFeatured:      boolean
  commentsEnabled: boolean
  viewCount:       number
  publishedAt:     string | null
  createdBy:       number | null
  createdAt:       string | null
  updatedAt:       string | null
  /** Các bản đã chuyển mã xong — UI đọc để vẽ timeline + quyết định nút transcode. */
  resolutionsReady: string[] | null
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
      .leftJoin(mediaCategories, eq(mediaItems.categoryId, mediaCategories.id))
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
    .leftJoin(mediaCategories, eq(mediaItems.categoryId, mediaCategories.id))
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
      id: mediaCategories.id,
      name: mediaCategories.name,
      slug: mediaCategories.slug,
      total: count(mediaItems.id),
    })
    .from(mediaCategories)
    .innerJoin(
      mediaItems,
      and(eq(mediaItems.categoryId, mediaCategories.id), eq(mediaItems.status, PUBLISHED_MEDIA_STATUS)),
    )
    .groupBy(mediaCategories.id, mediaCategories.name, mediaCategories.slug, mediaCategories.displayOrder)
    .orderBy(asc(mediaCategories.displayOrder), asc(mediaCategories.id))

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
    .leftJoin(mediaCategories, eq(mediaItems.categoryId, mediaCategories.id))
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
  resolutionsReady: mediaItems.resolutionsReady,
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
 * Tìm tệp gốc `original.<ext>` trong thư mục đã công bố.
 *
 * Khi `MEDIA_AUTO_TRANSCODE=false`, pipeline chỉ probe + thumbnail rồi đặt
 * `processingStatus='ready'` mà không cắt HLS, nên không có `master.m3u8`. Stream
 * endpoint vẫn phải phát được — công dân bấm play trên một video đã xuất bản và
 * thấy 404 là đúng cái tính năng "tắt transcode để đỡ lag" ra đời để tránh.
 *
 * Trả đường dẫn tuyệt đối tới tệp đầu tiên khớp `original.*`, hoặc `null` khi thư
 * mục không tồn tại / không có tệp gốc. Giống `locateOriginal` trong
 * `video-processing.ts` nhưng ở đây để **phục vụ** tệp, không để FFmpeg đọc — nên
 * đặt trong service này tránh phụ thuộc vòng (video-processing import service này).
 */
async function locateOriginalFile(directory: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await fs.readdir(directory)
  } catch {
    return null
  }
  // Chỉ nhận tệp có đuôi trong `STREAM_CONTENT_TYPES` — một tệp `original.bin` lạ
  // không nên được phục vụ, và `original.mp4.part` (tải đang dở) thì tuyệt đối
  // không (nửa tệp đọc ra là nửa video hỏng).
  const found = entries.find(entry => {
    if (!entry.startsWith('original.')) return false
    const ext = path.extname(entry).toLowerCase()
    return ext in STREAM_CONTENT_TYPES
  })
  return found ? path.resolve(directory, found) : null
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

/** Parse `resolutions_ready` thành mảng bất kể nó đến từ driver thật (đã parse)
 *  hay pool giả (chuỗi JSON). `null`/chuỗi rỗng → `null` (không có rendition). */
function coerceResolutionsReady(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.length === 0 ? null : value
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'null') return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return Array.isArray(parsed) ? (parsed.length === 0 ? null : parsed) : null
  } catch {
    return null
  }
}

export type StreamTarget =
  | {
      kind: 'local'
      filePath: string
      contentType: string
      size: number
      cacheSeconds: number
      attachment: boolean
      /**
       * `true` khi đây là tệp gốc `original.<ext>` phục vụ trực tiếp (không HLS).
       * Endpoint cần xử lý byte-range (Range → 206) vì trình phát `<video>` cần
       * tua được — HLS đã cóRange trong giao thức, tệp gốc thì không.
       */
      passthrough?: boolean
    }
  | {
      kind: 'r2'
      r2Key: string
      contentType: string
      size: number
      cacheSeconds: number
      attachment: boolean
      /**
       * `true` khi phục vụ tệp gốc `original.<ext>` trực tiếp (autoTranscode=false,
       * không rendition HLS). Endpoint cần byte-range qua R2 (Range header → GetObject
       * với `Range` param → 206). `r2Key` trỏ tới `original.<ext>`, không phải manifest.
       */
      passthrough?: boolean
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

  // Cột `resolutions_ready` là `json()` — `MySqlJson` **không** có `mapFromDriverValue`
  // (xem drizzle-orm/mysql-core/columns/json.cjs), nên việc parse JSON thành mảng
  // thuộc về **mysql2 driver** (`typeCast` mặc định parse cột JSON). Trên driver thật
  // `row.resolutionsReady` là mảng; trên một pool giả trong test (bypass driver) nó
  // đến dưới dạng chuỗi JSON, và `Array.isArray('["360p"]')` là `false` → nhánh fallback
  // kích hoạt sai cho một mục **có** rendition → 404. Parse ở đây để hai đường ra đồng
  // nhất: đây là khác biệt thật giữa driver và mock, không phải đoán kiểu.
  const renditions = coerceResolutionsReady((row as { resolutionsReady?: unknown }).resolutionsReady)
  // `MEDIA_AUTO_TRANSCODE=false` — không có HLS: `master.m3u8` không tồn tại và
  // `resolutionsReady` rỗng. Trả về 404 ở đây khiến một video đã xuất bản phát
  // không được, đúng khi tắt transcode để đỡ lag: công dân bấm play và thấy khung
  // đen. Fallback: phục vụ tệp gốc `original.<ext>` qua byte-range. Chỉ áp dụng
  // cho đúng manifest — một yêu cầu phân đoạn (`.ts`/`.m4s`) khi không có rendition
  // thực sự là lỗi, và lùi về tệp gốc ở đó sẽ trả video gốc dưới dạng `video/mp2t`.
  const isPassthroughManifest = assetPath === MEDIA_MASTER_PLAYLIST
    && (renditions === null || renditions.length === 0)

  // R2 stream — `storagePath` là R2 key prefix (cùng hình dạng cây, khác backend).
  // Không kiểm `startsWith(directory)` vì không có filesystem — chỉ kiểm
  // `assetPath` đã lọc `..` qua `normalizeAssetPath`.
  //
  // Chỉ đi nhánh R2 khi R2 **thật sự cấu hình**. Một mục có `storageProvider='r2'`
  // mà `videoStorage.r2` chưa đặt (deploy chưa cấu hình, hoặc worker ghi nhầm cột)
  // vẫn có tệp gốc trên đĩa local — pipeline upload ghi `original.<ext>` đến thư
  // mục làm việc trước khi sync, và khi R2 chưa cấu hình thì tệp ở lại đó. Lùi về
  // local ở nhánh này để video vẫn phát được; trả 404 trên một mục đã xuất bản chỉ
  // vì cấu hình R2 chưa khớp CSDL là đúng loại hỏng đọc ra "cổng bị gãy".
  if (row.storageProvider === 'r2' && config.videoStorage.r2) {
    const stored = typeof row.storagePath === 'string' ? row.storagePath.trim() : ''
    if (!stored) return null
    const r2Config = config.videoStorage.r2

    // Nhánh passthrough R2: không có rendition → phục vụ `original.<ext>` từ R2
    // qua byte-range (Range → GetObject `Range` → 206). Tương tự nhánh local
    // `locateOriginalFile` nhưng list R2 prefix.
    //
    // **Lùi về local nếu R2 không có original**: pipeline `video-processing.ts`
    // sync cây `published` lên R2 rồi xoá local (dòng 741), nhưng sync có thể bỏ
    // sót `original.<ext>` — tệp gốc lớn có thể put fail một phần mà log vẫn ghi
    // `r2_synced` cho phần đã xong. Khi R2 thiếu original, local thường vẫn còn,
    // vì xoá `published` chỉ chạy sau sync thành công toàn cây; một original còn
    // trên đĩa nghĩa là sync đã không thấy nó. Trả 404 trên một video có tệp gốc
    // trên đĩa chỉ vì R2 liệt kê thiếu là đúng loại hỏng đọc ra "cổng bị gãy".
    if (isPassthroughManifest) {
      const originalR2 = await locateR2Original(stored, r2Config)
      if (originalR2) {
        const extension = path.extname(originalR2.key).toLowerCase()
        const known = STREAM_CONTENT_TYPES[extension]
        return {
          kind: 'r2',
          r2Key: originalR2.key,
          contentType: known ?? 'application/octet-stream',
          size: 0,
          cacheSeconds: SEGMENT_CACHE_SECONDS,
          attachment: known === undefined,
          passthrough: true,
        }
      }
      // R2 không có original → thử local đĩa (upload ghi `original.<ext>` thẳng
      // vào `published`, và nếu sync R2 không thấy nó thì xoá local cũng không chạy).
      const directory = resolveMediaDirectory(config, row)
      if (directory) {
        const original = await locateOriginalFile(directory)
        if (original) {
          let size: number
          try {
            const stat = statSync(original)
            if (!stat.isFile()) return null
            size = stat.size
          } catch {
            return null
          }
          const extension = path.extname(original).toLowerCase()
          const known = STREAM_CONTENT_TYPES[extension]
          return {
            kind: 'local',
            filePath: original,
            contentType: known ?? 'application/octet-stream',
            size,
            cacheSeconds: SEGMENT_CACHE_SECONDS,
            attachment: known === undefined,
            passthrough: true,
          }
        }
      }
      return null
    }

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

  if (isPassthroughManifest) {
    const original = await locateOriginalFile(directory)
    if (!original) return null
    let size: number
    try {
      const stat = statSync(original)
      if (!stat.isFile()) return null
      size = stat.size
    } catch {
      return null
    }
    const extension = path.extname(original).toLowerCase()
    const known = STREAM_CONTENT_TYPES[extension]
    return {
      kind: 'local',
      filePath: original,
      contentType: known ?? 'application/octet-stream',
      size,
      // Tệp gốc không đổi sau khi upload xong, nên đệm lâu hơn manifest HLS.
      cacheSeconds: SEGMENT_CACHE_SECONDS,
      attachment: known === undefined,
      passthrough: true,
    }
  }

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

  // R2 thumbnail — cùng key prefix với rendition, tệp `thumb.jpg`. Pipeline lưu
  // thumb ở `${stored}/generations/<claim>/thumb.jpg` (dòng 596 của video-processing
  // đặt `published` sâu hơn `assetRoot`), nên phải **list** keys để tìm nó thay
  // vì đoán cấp. Ưu tiên `thumb.jpg` ở cấp gốc (cho deployment sửa sau này), rồi
  // mới tới `generations/<claim>/thumb.jpg` (kiểu present).
  if (row.storageProvider === 'r2') {
    const stored = typeof row.storagePath === 'string' ? row.storagePath.trim() : ''
    if (stored) {
      const base = stored.replace(/\/+$/g, '')
      const r2Config = config.videoStorage.r2
      if (r2Config) {
        const keys = await listR2Keys(base, r2Config)
        if (keys) {
          const rootKey = `${base}/${MEDIA_THUMBNAIL_FILE}`
          if (keys.includes(rootKey)) {
            return { kind: 'r2', r2Key: rootKey }
          }
          // Tìm `thumb.jpg` ở cấp sâu hơn — `generations/<claim>/thumb.jpg`. Lấy
          // key ngắn nhất (cấp nông nhất) để khớp layout hiện tại và không ưu tiên
          // thumb của phiên thử cũ nằm sâu hơn.
          const deeper = keys
            .filter(k => k.endsWith(`/${MEDIA_THUMBNAIL_FILE}`) && k !== rootKey)
            .sort((a, b) => a.length - b.length)
          const firstDeeper = deeper[0]
          if (firstDeeper) {
            return { kind: 'r2', r2Key: firstDeeper }
          }
        }
      }
    }
    // R2 không có thumb → thử đĩa local. Cùng lý do `resolveStreamTarget` dòng
    // 960-1008 lùi local khi R2 thiếu original: pipeline sync R2 có thể bỏ sót
    // thumb, và khi đó thumb thường vẫn còn trên đĩa (sync xoá `published` chỉ
    // chạy sau khi sync thành công toàn cây). Trả 404 trên một mục có thumb trên
    // đĩa chỉ vì R2 liệt kê thiếu là đúng loại hỏng đọc ra "cổng bị gãy".
    const localThumb = resolveLocalThumbnail(config, row)
    if (localThumb) return localThumb
    return null
  }

  return resolveLocalThumbnail(config, row)
}

/**
 * Tìm `thumb.jpg` trên đĩa local — cấp gốc rồi `generations/<claim>/`. Tách ra
 * để nhánh R2 fallback dùng chung (khi R2 list không có thumb).
 */
function resolveLocalThumbnail(
  config: MediaConfig,
  row: { slug: string, storagePath?: string | null },
): ThumbnailTarget | null {
  const directory = resolveMediaDirectory(config, row)
  if (!directory) return null

  // Cấp gốc: `<workdir>/media/<slug>/thumb.jpg` (layout sau khi sửa pipeline).
  const rootFile = path.join(directory, MEDIA_THUMBNAIL_FILE)
  try {
    const stat = statSync(rootFile)
    if (stat.isFile()) return { kind: 'local', filePath: rootFile, contentType: 'image/jpeg', size: stat.size }
  } catch { /* không có ở gốc — thử generations */ }

  // Cấp `generations/<claim>/thumb.jpg` (layout hiện tại — `published` sâu hơn
  // `assetRoot`). Đọc thư mục `generations`, tìm subdir có `thumb.jpg`, lấy cái
  // mới nhất. Không đệ quy toàn cây: thumb chỉ ở đúng một cấp đó.
  const genDir = path.join(directory, 'generations')
  try {
    const subs = readdirSync(genDir, { withFileTypes: true })
    let best: { filePath: string, mtime: number, size: number } | null = null
    for (const sub of subs) {
      if (!sub.isDirectory()) continue
      const thumb = path.join(genDir, sub.name, MEDIA_THUMBNAIL_FILE)
      try {
        const stat = statSync(thumb)
        if (!stat.isFile()) continue
        if (!best || stat.mtimeMs > best.mtime) best = { filePath: thumb, mtime: stat.mtimeMs, size: stat.size }
      } catch { /* subdir không có thumb — bỏ qua */ }
    }
    if (best) return { kind: 'local', filePath: best.filePath, contentType: 'image/jpeg', size: best.size }
  } catch { /* generations/ không tồn tại — bình thường cho item chưa transcode */ }

  return null
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

// ─── Thumbnail custom ─────────────────────────────────────────────────────────
//
// Pipeline vốn tự trích thumbnail (`extractThumbnail` ở `processMediaItem` giai
// đoạn 5), và `thumb.get.ts` có fallback trích at-the-fly khi thumb vắng. Nhóm hàm
// này cho cán bộ **chọn ảnh thumbnail từ Thư viện Media** — ghi đè `thumb.jpg`
// ở cấp gốc mà `resolveThumbnailTarget` tìm (R2 list ưu tiên gốc, local ưu tiên
// gốc), nên sau khi đặt, thumb tĩnh phục vụ ngay không cần FFmpeg.
//
// Cột `thumbnail_url` lưu URL/đường dẫn ảnh thư viện **chỉ để admin page hiển thị
// preview** "đang dùng ảnh nào". Phía công khai vẫn serve qua `resolveThumbnailTarget`
// (không redirect theo URL tự do — xem comment `serializePublicMedia` dòng 310).

/** Đường dẫn R2 key của thumb cấp gốc: `<storagePath>/thumb.jpg`. */
function r2ThumbnailKey(storagePath: string): string {
  return `${storagePath.replace(/\/+$/g, '')}/${MEDIA_THUMBNAIL_FILE}`
}

export type SetMediaThumbnailInput = {
  id: number
  /** Id của hàng `media` (thư viện ảnh) làm thumbnail mới. */
  mediaId: number
  actorId: number
  config: MediaConfig
}

export type SetMediaThumbnailResult =
  | { ok: true }
  | { ok: false, reason: 'not_found' | 'media_not_found' | 'not_an_image' | 'not_upload' }

/**
 * Đặt thumbnail cho mục video từ một ảnh Thư viện Media.
 *
 * Đọc bytes ảnh thư viện (đĩa hoặc R2 theo `provider`), tối ưu qua `sharp` về
 * 16:9 ≤720px JPEG, ghi vào `thumb.jpg` cấp gốc ở **cả** đĩa và R2 (nếu video
 * đang R2). Cập nhật `thumbnail_url` + audit trong một transaction.
 *
 * R2 push fail **không rollback đĩa** — đĩa đã ghi là thumb hợp lệ, R2 chỉ là
 * tier dự phòng; `resolveThumbnailTarget` có fallback local nên một R2 hỏng
 * không làm hỏng thumb. Ngược lại, đĩa fail (vd. `workdir` không ghi được) thì
 * return `ok: false` trước khi chạm CSDL — không ghi `thumbnail_url` cho một
 * thumb thực sự không phục vụ được.
 */
export async function setMediaThumbnail(
  input: SetMediaThumbnailInput,
  deps: { db?: Database } = {},
): Promise<SetMediaThumbnailResult> {
  const db = deps.db ?? getDb()

  // 1. Đọc mục video + ảnh thư viện (ngoài transaction — chỉ đọc).
  const [item] = await db
    .select({
      id: mediaItems.id, source: mediaItems.source, storagePath: mediaItems.storagePath,
      storageProvider: mediaItems.storageProvider, slug: mediaItems.slug,
    })
    .from(mediaItems)
    .where(eq(mediaItems.id, input.id))
    .limit(1)
  if (!item) return { ok: false, reason: 'not_found' }
  if (item.source !== 'upload') return { ok: false, reason: 'not_upload' }

  const [img] = await db
    .select({ id: media.id, provider: media.provider, storagePath: media.storagePath, mimeType: media.mimeType, url: media.url })
    .from(media)
    .where(eq(media.id, input.mediaId))
    .limit(1)
  if (!img) return { ok: false, reason: 'media_not_found' }
  if (!img.mimeType.startsWith('image/')) return { ok: false, reason: 'not_an_image' }

  // 2. Đọc bytes ảnh nguồn.
  let sourceBuffer: Buffer
  if (img.provider === 'r2') {
    const r2Config = input.config.videoStorage.r2
    // Ảnh thư viện R2 dùng R2 của **thư viện ảnh** (group `media`), không phải R2
    // video (group `media_portal`). Hai bucket/credential khác nhau. Lấy config
    // thư viện ảnh từ settings — nhưng `input.config` là config media-portal.
    // Thư viện ảnh R2 có thể đọc qua `getR2Object` với config riêng; ở đây ta chỉ
    // có thể đọc ảnh local hoặc ảnh R2 thư viện.
    // — Thư viện ảnh provider xác định qua `media.provider`; R2 của thư viện dùng
    // credentials khác (group `media`). Hiện `input.config` không mang chúng.
    // Nên: nếu ảnh thư viện R2, đọc qua public URL (fetch) — ảnh thư viện R2 có
    // public URL trực tiếp (không proxy như video).
    if (!img.url) throw new Error('Ảnh thư viện R2 không có URL.')
    const res = await fetch(img.url).catch(() => null)
    if (!res || !res.ok) throw new Error('Không tải được ảnh thumbnail từ thư viện R2.')
    sourceBuffer = Buffer.from(await res.arrayBuffer())
  } else {
    // Local: storagePath là đường dẫn tuyệt đối trong public/uploads/.
    sourceBuffer = await fs.readFile(img.storagePath)
  }

  // 3. Tối ưu qua sharp — 16:9, ≤720px, JPEG q80.
  const optimized = await sharp(sourceBuffer)
    .resize({ width: 1280, height: 720, fit: 'cover', position: 'centre' })
    .jpeg({ quality: 80 })
    .toBuffer()
    .catch(() => null)
  if (!optimized) throw new Error('Không xử lý được ảnh thumbnail.')

  // 4. Ghi đĩa cấp gốc.
  const directory = resolveMediaDirectory(input.config, { slug: item.slug, storagePath: item.storagePath })
  if (!directory) return { ok: false, reason: 'not_found' }
  await fs.mkdir(directory, { recursive: true })
  const localPath = path.join(directory, MEDIA_THUMBNAIL_FILE)
  await fs.writeFile(localPath, optimized)

  // 5. Ghi R2 nếu video đang R2.
  let pushedR2 = false
  if (item.storageProvider === 'r2' && item.storagePath && input.config.videoStorage.r2) {
    pushedR2 = await putR2Object(r2ThumbnailKey(item.storagePath), optimized, 'image/jpeg', input.config.videoStorage.r2)
  }

  // 6. Cập nhật thumbnail_url + audit trong transaction.
  await db.transaction(async (tx) => {
    await tx.update(mediaItems)
      .set({ thumbnailUrl: img.url })
      .where(eq(mediaItems.id, input.id))
    await tx.insert(activityLogs).values({
      userId: input.actorId,
      action: 'update',
      resource: 'media_portal',
      resourceId: input.id,
      meta: { changed: ['thumbnail'], thumbSource: 'media_library', mediaId: input.mediaId, pushedR2 },
    })
  })

  return { ok: true }
}

export type ClearMediaThumbnailInput = {
  id: number
  actorId: number
  config: MediaConfig
}

export type ClearMediaThumbnailResult =
  | { ok: true }
  | { ok: false, reason: 'not_found' | 'not_upload' }

/**
 * Xoá thumbnail custom — xoá `thumb.jpg` cấp gốc ở đĩa + R2, reset `thumbnail_url`.
 * Sau khi xoá, `resolveThumbnailTarget` lùi về `generations/<claim>/thumb.jpg`
 * (nếu pipeline đã trích) hoặc `extractFallbackFrame` (nếu vắng) — đúng hành vi
 * "không có thumb custom thì về thumb tự sinh".
 */
export async function clearMediaThumbnail(
  input: ClearMediaThumbnailInput,
  deps: { db?: Database } = {},
): Promise<ClearMediaThumbnailResult> {
  const db = deps.db ?? getDb()

  const [item] = await db
    .select({ id: mediaItems.id, source: mediaItems.source, storagePath: mediaItems.storagePath, storageProvider: mediaItems.storageProvider, slug: mediaItems.slug })
    .from(mediaItems)
    .where(eq(mediaItems.id, input.id))
    .limit(1)
  if (!item) return { ok: false, reason: 'not_found' }
  if (item.source !== 'upload') return { ok: false, reason: 'not_upload' }

  // Xoá đĩa cấp gốc.
  const directory = resolveMediaDirectory(input.config, { slug: item.slug, storagePath: item.storagePath })
  if (directory) {
    await fs.rm(path.join(directory, MEDIA_THUMBNAIL_FILE), { force: true })
  }

  // Xoá R2 cấp gốc (video R2).
  if (item.storageProvider === 'r2' && item.storagePath && input.config.videoStorage.r2) {
    // Best-effort — xoá hỏng không làm hỏng reset CSDL; thumb R2 sẽ bị list ra
    // nhưng `thumbnail_url` null báo admin "không còn custom".
    await deleteR2Thumb(item.storagePath, input.config.videoStorage.r2)
  }

  // Reset thumbnail_url + audit trong transaction.
  await db.transaction(async (tx) => {
    await tx.update(mediaItems)
      .set({ thumbnailUrl: null })
      .where(eq(mediaItems.id, input.id))
    await tx.insert(activityLogs).values({
      userId: input.actorId,
      action: 'update',
      resource: 'media_portal',
      resourceId: input.id,
      meta: { changed: ['thumbnail'], cleared: true },
    })
  })

  return { ok: true }
}

/** Best-effort xoá object R2 thumb cấp gốc. */
async function deleteR2Thumb(storagePath: string, _r2Config: R2Config): Promise<void> {
  // `putR2Object` dùng `PutObjectCommand`; xoá cần `DeleteObjectCommand`. Tránh
  // thêm export mới cho một thao tác best-effort — dùng `deleteR2File` từ media-r2
  // (R2Config khớp về shape).
  try {
    const { deleteR2File } = await import('../utils/media-r2')
    await deleteR2File(r2ThumbnailKey(storagePath), _r2Config)
  } catch { /* best-effort */ }
}
