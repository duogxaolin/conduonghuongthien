/**
 * Đường ĐỌC công khai của cổng media — list/get/count đã xuất bản, và hình dạng
 * công khai (`PublicMediaItem`). Tách khỏi `media-portal.ts` vì đây là phần lớn
 * nhất theo dòng, và nó chia sẻ đúng một thứ dễ sai nhất với đường quản trị:
 * **tập cột nào được ra khỏi máy chủ**.
 *
 * `serializePublicMedia` **liệt kê từng trường** thay vì chép hàng. Hệ quả cố ý:
 * thêm một cột vào `media_items` sau này **không** tự động xuất hiện trong phản
 * hồi công khai; người thêm phải tự viết nó vào đây, và đó là bước duy nhất trong
 * toàn bộ thay đổi mà việc "quên" là an toàn theo hướng đúng.
 */
import { and, asc, count, desc, eq, inArray, like } from 'drizzle-orm'

import { mediaCategories, mediaItems } from '../db/schema'
import { getDb, type Database } from '../utils/db'
import { likeContains } from '../utils/like-pattern'
import {
  buildMediaThumbnailPath,
  buildYouTubeEmbedUrl,
} from '../utils/youtube-parser'
import { isPlayable } from './video-processing'
import {
  MEDIA_SEARCH_MAX_LENGTH,
  PUBLISHED_MEDIA_STATUS,
  type MediaSource,
} from './media-portal-constants'

/** Tập cột mà đường đọc công khai **được phép** chọn. `storage_path`,
 *  `processing_error`, `status`, `created_by` và `claimed_by` không có mặt ở đây,
 *  nên chúng không thể rò ra qua một lượt `select` bị sửa sau này. */
const publicMediaSelection = {
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
  // `isFeatured` được chọn **và được trả**: nó quyết định thứ tự danh sách (featured
  // lên đầu) và công dân có thể thấy huy hiệu "nổi bật" trên thẻ — khác với hai cột
  // dưới đây chọn-nhưng-không-trả.
  isFeatured: mediaItems.isFeatured,
  // Hai cột dưới đây **được chọn nhưng không được trả**: chúng quyết định
  // `playable`, và `playable` là câu trả lời duy nhất người đọc cần.
  processingStatus: mediaItems.processingStatus,
  resolutionsReady: mediaItems.resolutionsReady,
} as const

export type PublicMediaRow = {
  id: number
  slug: string
  shortId: string
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
  isFeatured: boolean | null
  processingStatus: string | null
  resolutionsReady: string[] | null
}

export type PublicMediaItem = {
  id: number
  slug: string
  /** Định danh URL công khai chính — `/media/<shortId>`. `slug` chỉ còn cho redirect 301. */
  shortId: string
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
  /** Video nổi bật — được tick bởi cán bộ ở trang quản trị. Quyết định thứ tự danh sách (lên đầu). */
  isFeatured: boolean
}

/** Đường dẫn phát, **trên chính cổng này**. Xem `buildMediaThumbnailPath` cho
 *  cùng lý do ở phía ảnh thu nhỏ: một địa chỉ kho ký sẵn đưa cho trình duyệt là
 *  đưa luôn vị trí kho, và nó nằm lại trong lịch sử cùng log của mọi trung gian.
 *
 *  Nhận một chuỗi `id` generic (slug hoặc short_id) — người gọi quyết định giá trị
 *  truyền. URL công khai dùng `short_id`; hàm này chỉ ráp path, không quan tâm nội
 *  dung chuỗi. */
export function buildMediaStreamPath(id: string): string {
  return `/api/public/media/${encodeURIComponent(id)}/stream`
}

/** Parse `resolutions_ready` thành mảng bất kể nó đến từ driver thật (đã parse)
 *  hay pool giả (chuỗi JSON). `null`/chuỗi rỗng → `null` (không có rendition).
 *
 *  Dùng chung cho public read và admin read — đặt ở file này vì nó gắn với
 *  `serializePublicMedia`, và `media-portal-admin-read` import từ đây. */
export function coerceResolutionsReady(value: unknown): string[] | null {
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

  // Ảnh thu nhỏ **luôn** dựng từ short_id (định danh URL công khai), không bao giờ
  // đọc `thumbnail_url` đã lưu: cột đó là một chuỗi tự do, và trả thẳng nó cho
  // người đọc là để một giá trị trong CSDL trở thành một origin tuỳ ý trong trình
  // duyệt của công dân.
  const hasThumbnail = source === 'youtube' ? embedUrl !== null : true

  const playable = source === 'youtube' ? embedUrl !== null : isPlayable(row)

  return {
    id: Number(row.id),
    slug: String(row.slug),
    shortId: String(row.shortId),
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
    thumbnailUrl: hasThumbnail ? buildMediaThumbnailPath(String(row.shortId)) : null,
    embedUrl,
    streamUrl: source === 'upload' && playable ? buildMediaStreamPath(String(row.shortId)) : null,
    // `streamKind` chỉ có ý nghĩa khi `streamUrl` khác null (upload + playable).
    // `ready` + có rendition → manifest HLS đã publish → `hls`. Còn lại → tệp
    // gốc phục vụ trực tiếp → `file`: bao gồm cả `ready` không rendition
    // (autoTranscode=false) **và** `processing`/`pending` — khi đang transcode,
    // `resolutions_ready` đã liệt kê các bản xong nhưng manifest chỉ publish
    // sau khi **mọi** bản xong (`publishChain` nối đuôi), nên stream endpoint
    // lùi về tệp gốc `original.<ext>`, và hls.js parse mp4 như m3u8 sẽ không phát
    // được. `file` báo cho MediaPlayer dùng `<video src>` gốc.
    streamKind:
      source === 'upload' && playable
        ? (row.processingStatus === 'ready' && coerceResolutionsReady(row.resolutionsReady)?.length ? 'hls' : 'file')
        : null,
    playable,
    commentsEnabled: row.commentsEnabled === true,
    viewCount: Number(row.viewCount ?? 0),
    isFeatured: row.isFeatured === true,
  }
}

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
      // Featured lên trước, rồi ngày đăng, rồi ngày tạo. Mục chưa có `published_at`
      // (dữ liệu cũ) rơi xuống cuối thay vì lên đầu. `isFeatured` là boolean: `true`
      // (1) > `false` (0) nên `desc` đặt featured trước — đúng ý "nổi bật lên đầu".
      .orderBy(desc(mediaItems.isFeatured), desc(mediaItems.publishedAt), desc(mediaItems.createdAt))
      .limit(query.limit)
      .offset(offset),
    db.select({ total: count() }).from(mediaItems).where(where),
  ])

  return { items: rows.map(serializePublicMedia), total: Number(totals[0]?.total ?? 0) }
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
 * Một mục đã xuất bản theo short_id, hoặc `null`.
 *
 * `null` cho **cả** short_id không tồn tại **lẫn** short_id của một mục
 * `draft`/`archived` — nơi gọi không được phân biệt hai trường hợp đó, vì một
 * phản hồi khác nhau giữa chúng là cách liệt kê ra những short_id chưa xuất bản.
 */
export async function getPublishedMediaByShortId(
  shortId: string,
  deps: { db?: Database } = {},
): Promise<PublicMediaItem | null> {
  const db = deps.db ?? getDb()
  const [row] = await db
    .select(publicMediaSelection)
    .from(mediaItems)
    .leftJoin(mediaCategories, eq(mediaItems.categoryId, mediaCategories.id))
    .where(and(eq(mediaItems.shortId, shortId), eq(mediaItems.status, PUBLISHED_MEDIA_STATUS)))
    .limit(1)

  return row ? serializePublicMedia(row) : null
}

/**
 * Id của một mục đã xuất bản theo short_id, hoặc `null`.
 *
 * Một truy vấn **chỉ lấy id**, không phải `getPublishedMediaByShortId`: đường đếm
 * lượt xem chạy một lần mỗi lượt mở trang, và nó không cần tiêu đề, mô tả, tên
 * danh mục hay bất cứ thứ gì khác. Đi qua hàm kia sẽ kéo theo một phép join và
 * mười sáu cột cho một con số.
 */
export async function resolvePublishedMediaIdByShortId(
  shortId: string,
  deps: { db?: Database } = {},
): Promise<number | null> {
  const db = deps.db ?? getDb()
  const [row] = await db
    .select({ id: mediaItems.id })
    .from(mediaItems)
    .where(and(eq(mediaItems.shortId, shortId), eq(mediaItems.status, PUBLISHED_MEDIA_STATUS)))
    .limit(1)

  return row ? Number(row.id) : null
}
