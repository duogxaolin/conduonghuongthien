/**
 * Cổng media — BARREL. Mọi endpoint và service import cổng media qua đường dẫn
 * này; mã thật nằm ở các tệp con (không tệp con nào import ngược barrel):
 *   • `media-portal-constants.ts` — hằng số + type chia sẻ
 *   • `media-validation.ts` — các `require*`/`optional*` + `MediaValidationError`
 *   • `media-views.ts` — `recordMediaView` + `buildMediaViewDedupeKey`
 *   • `media-portal-public.ts` — tập cột + hình dạng công khai, đường đọc công khai
 *   • `media-portal-admin-read.ts` — hình dạng + đường đọc quản trị
 *   • `media-portal-assets.ts` — thư mục/đường dẫn tài nguyên đã kiểm, tập cột nội bộ
 *   • `media-portal-stream.ts` — `resolveStreamTarget` (HLS / tệp gốc, đĩa / R2)
 *   • `media-portal-thumbnail.ts` — `resolveThumbnailTarget` (R2 list + lùi đĩa)
 *   • `media-portal-admin-write.ts` — tạo/sửa/xoá mục, cùng audit trong một transaction
 *   • `media-portal-thumbnail-override.ts` — đặt/xoá ảnh đại diện tuỳ chỉnh
 *
 * Điều dễ sai nhất của cổng là **tập cột nào được ra khỏi máy chủ**: `media_items`
 * mang `processing_error` (đường dẫn tệp, thông báo FFmpeg), `storage_path`,
 * `created_by`… Nên đường đọc công khai liệt kê từng trường (`serializePublicMedia`),
 * còn hai đường phục vụ tệp (`resolveStreamTarget`/`resolveThumbnailTarget`) chọn
 * tập cột nội bộ và **không bao giờ** trả một hàng cho nơi gọi — chỉ một đích đã
 * kiểm, hoặc `null`.
 */

export {
  MEDIA_ITEM_STATUSES, MEDIA_SOURCES, PUBLISHED_MEDIA_STATUS,
  MEDIA_TITLE_MAX_LENGTH, MEDIA_DESCRIPTION_MAX_LENGTH, MEDIA_SEARCH_MAX_LENGTH,
  MEDIA_LIST_MAX_LIMIT, MANIFEST_CACHE_SECONDS, SEGMENT_CACHE_SECONDS,
  MEDIA_VIEW_DEDUPE_WINDOW_SECONDS, MEDIA_VIEW_DEDUPE_RULE,
  MEDIA_VIEW_DEDUPE_KEY_MAX_LENGTH, MEDIA_VIEW_DEDUPE_TOKEN_LENGTH,
  type MediaItemStatus, type MediaSource,
} from './media-portal-constants'

export {
  MediaValidationError, requireMediaTitle, optionalMediaText,
  requireMediaSource, requireMediaStatus, requireMediaBoolean,
  optionalMediaId, requireMediaSourceId,
} from './media-validation'

export { buildMediaViewDedupeKey, recordMediaView } from './media-views'

export {
  serializePublicMedia, buildMediaStreamPath, coerceResolutionsReady,
  listPublishedMedia, countPublishedMediaByCategory,
  getPublishedMediaByShortId, resolvePublishedMediaIdByShortId,
  type PublicMediaRow, type PublicMediaItem, type PublishedMediaQuery,
  type PublishedMediaPage, type PublicMediaCategory,
} from './media-portal-public'

export {
  serializeAdminMedia, listAllMediaForAdmin, getMediaItemForAdmin,
  type AdminMediaRow, type AdminMediaItem, type AdminMediaQuery,
  type AdminMediaPage,
} from './media-portal-admin-read'

export { resolveMediaDirectory, normalizeAssetPath } from './media-portal-assets'

export {
  resolveStreamTarget, MEDIA_STREAM_MANIFEST_PATH,
  type StreamTarget,
} from './media-portal-stream'

export { resolveThumbnailTarget, type ThumbnailTarget } from './media-portal-thumbnail'

export {
  createMediaItem, updateMediaItem, deleteMediaItem,
  type CreateMediaItemInput, type CreatedMediaItem,
  type UpdateMediaItemInput, type UpdateMediaItemResult,
  type DeleteMediaItemInput, type DeleteMediaItemResult,
} from './media-portal-admin-write'

export {
  setMediaThumbnail, clearMediaThumbnail, THUMBNAIL_SOURCE_MAX_BYTES,
  type SetMediaThumbnailInput, type SetMediaThumbnailResult,
  type ClearMediaThumbnailInput, type ClearMediaThumbnailResult,
} from './media-portal-thumbnail-override'
