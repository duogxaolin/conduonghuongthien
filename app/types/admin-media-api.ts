/**
 * Responses of the image library (`/admin/media`, `pages/admin/media/index.vue`) — the `media`
 * table, NOT the video library of `media_items` (`admin-media-portal-api.ts`).
 *
 * DERIVED FROM THE HANDLERS under `server/api/admin/media/**` (`Payload<…>`,
 * app/types/handler-payload.ts); the tile type `AdminMediaRow` and the upload answer stay in
 * app/types/admin-api.ts. Differences from the hand-written shapes these replace (wave3 7.1,
 * batch E), none of them displayed: the list's `pagination` also carries `perPage`; the storage
 * scan's hand-written `StorageSize` matched the handler field for field.
 */
import type { Payload } from './handler-payload'

type ListHandler = typeof import('~~/server/api/admin/media/index.get').default
type DeleteHandler = typeof import('~~/server/api/admin/media/[id].delete').default
type StorageSizeHandler = typeof import('~~/server/api/admin/media/storage-size.get').default

/** `GET /api/admin/media` — one page of tiles. */
export type AdminMediaListResponse = Payload<ListHandler>
export type AdminMediaDeleteResponse = Payload<DeleteHandler>
/** `GET /api/admin/media/storage-size` — local disk vs DB, and the R2 bucket (null when unreadable). */
export type AdminMediaStorageSize = Payload<StorageSizeHandler>
