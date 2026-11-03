/**
 * Đường GHI quản trị của cổng media — tạo/sửa/xoá một mục `media_items`, mỗi
 * lượt cùng dòng audit trong **cùng một transaction** (`tx.insert(...)` trên
 * handle giao dịch, không bao giờ trên pool). Tách khỏi `media-portal.ts` (nay là
 * barrel); tệp này không import ngược barrel.
 *
 * Guard: `tests/media-portal-audit.test.ts` (`AUDITED_SERVICES`) và cổng quét thư
 * mục của `tests/reader-audit-atomicity.test.ts`.
 */
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { activityLogs, mediaAssetCleanup, mediaItems } from '../db/schema'
import { getDb, type Database } from '../utils/db'
import { uniqueMediaSlug } from '../utils/unique-media-slug'
import { uniqueShortMediaId } from '../utils/short-media-id'
import { abortProcessingClaim, mediaAssetRoot } from './video-processing'
import {
  PUBLISHED_MEDIA_STATUS,
  MEDIA_DESCRIPTION_MAX_LENGTH,
  type MediaItemStatus,
} from './media-portal-constants'
import {
  requireMediaTitle, optionalMediaText,
  requireMediaSource, requireMediaStatus, requireMediaBoolean,
  optionalMediaId, requireMediaSourceId,
} from './media-validation'

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

export type CreatedMediaItem = { mediaItemId: number, slug: string, shortId: string }

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
    const shortId = await uniqueShortMediaId(tx)
    const [inserted] = await tx.insert(mediaItems).values({
      slug,
      shortId,
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

    return { mediaItemId, slug, shortId }
  })
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

/** Kết quả xoá: `removed=false` khi mục không tồn tại; `fromStatus` cho biết trạng thái trước xoá. */
export type DeleteMediaItemResult =
  | { removed: false, fromStatus: null }
  | { removed: true, fromStatus: string }

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
): Promise<DeleteMediaItemResult> {
  const db = deps.db ?? getDb()

  const outcome = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: mediaItems.id, slug: mediaItems.slug, source: mediaItems.source, status: mediaItems.status,
        storagePath: mediaItems.storagePath, storageProvider: mediaItems.storageProvider, claimedBy: mediaItems.claimedBy })
      .from(mediaItems)
      .where(eq(mediaItems.id, input.id))
      .limit(1)

    if (!current) return { removed: false as const, claim: null as string | null, fromStatus: null as string | null }

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

    return { removed: true as const, claim: current.claimedBy, fromStatus: String(current.status) }
  })

  if (outcome.removed) abortProcessingClaim(outcome.claim)
  if (outcome.removed) return { removed: true, fromStatus: outcome.fromStatus ?? '' }
  return { removed: false, fromStatus: null }
}
