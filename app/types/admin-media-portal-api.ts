/**
 * Responses of one video's page (`/admin/media-portal/[id]`) and of the video categories
 * page (`/admin/media-portal/categories`).
 *
 * DERIVED FROM THE HANDLERS under `server/api/admin/media-portal/**`, the technique of
 * `app/types/admin-api.ts` (which already holds the list item `AdminMediaItem` and the
 * upload config `AdminMediaConfig`): `Payload<…>` is the handler's return value after
 * JSON, so a changed response changes the type. (`adminFetch`'s `T` is still an unchecked
 * assertion — see app/composables/adminFetch.ts — but it is the right one.)
 *
 * Differences from the hand-written shapes these replace, none of them displayed:
 *   - one video's answer also carries `ok` (its `item` is the list's serializer,
 *     `serializeAdminMedia`, so it is the same `AdminMediaItem`);
 *   - saving a video answers `slug`/`status`, queueing a transcode a `message`, creating
 *     a category `id`/`slug`, saving one `slug` — the pages keep their own sentences.
 */
import type { Payload } from './handler-payload'

type DetailHandler = typeof import('~~/server/api/admin/media-portal/[id].get').default
type UpdateHandler = typeof import('~~/server/api/admin/media-portal/[id].put').default
type DeleteHandler = typeof import('~~/server/api/admin/media-portal/[id].delete').default
type ProcessHandler = typeof import('~~/server/api/admin/media-portal/[id]/process.post').default
type ThumbnailSetHandler = typeof import('~~/server/api/admin/media-portal/[id]/thumbnail.post').default
type ThumbnailClearHandler = typeof import('~~/server/api/admin/media-portal/[id]/thumbnail.delete').default
type CategoriesHandler = typeof import('~~/server/api/admin/media-portal/categories/index.get').default
type CategoryCreateHandler = typeof import('~~/server/api/admin/media-portal/categories/index.post').default
type CategoryUpdateHandler = typeof import('~~/server/api/admin/media-portal/categories/[id].put').default
type CategoryDeleteHandler = typeof import('~~/server/api/admin/media-portal/categories/[id].delete').default
type ExternalCreateHandler = typeof import('~~/server/api/admin/media-portal/external.post').default
type YoutubeMetaHandler = typeof import('~~/server/api/admin/media-portal/youtube-meta.post').default

// ─── A YouTube video (`/admin/media-portal/external`, batch F) ────────────────
/** `POST /api/admin/media-portal/external` — the new draft's `id` (plus `slug`/`shortId`, unused). */
export type MediaExternalCreateResponse = Payload<ExternalCreateHandler>
/**
 * `POST /api/admin/media-portal/youtube-meta` — "Lấy thông tin" of the video form: `ok: false`
 * with `reason: 'invalid' | 'fetch_failed'`, or the oEmbed title/author/thumbnail and the id.
 */
export type MediaYoutubeMetaResponse = Payload<YoutubeMetaHandler>

// ─── One video ───────────────────────────────────────────────────────────────
/** `GET /api/admin/media-portal/:id`. */
export type MediaDetailResponse = Payload<DetailHandler>
export type MediaUpdateResponse = Payload<UpdateHandler>
/** `DELETE /api/admin/media-portal/:id` — the list's delete (`pages/admin/media-portal/index.vue`, batch E). */
export type MediaDeleteResponse = Payload<DeleteHandler>
/** "Xử lý lại video" and "Chuyển mã" both post to `/process`. */
export type MediaProcessResponse = Payload<ProcessHandler>
export type MediaThumbnailSetResponse = Payload<ThumbnailSetHandler>
export type MediaThumbnailClearResponse = Payload<ThumbnailClearHandler>

// ─── Video categories (`media_categories`) ───────────────────────────────────
/** `GET /api/admin/media-portal/categories`: each row with how many videos use it. */
export type MediaCategoriesResponse = Payload<CategoriesHandler>
export type MediaCategoryRow = MediaCategoriesResponse['items'][number]
export type MediaCategoryCreateResponse = Payload<CategoryCreateHandler>
export type MediaCategoryUpdateResponse = Payload<CategoryUpdateHandler>
export type MediaCategoryDeleteResponse = Payload<CategoryDeleteHandler>
