/**
 * Responses of the page builder (`/admin/content/pages/[id]`,
 * `pages/admin/content/pages/[id].vue`).
 *
 * DERIVED FROM THE HANDLERS (`Payload<…>`, app/types/handler-payload.ts). The page detail,
 * the meta save and a version row were already derived (`AdminPageDetail`,
 * `AdminPageUpdateResult`, `PageVersionRow` in app/types/admin-api.ts); this adds the
 * answers the page cast by hand. Differences from those hand-written shapes, none of them
 * displayed: saving a draft answers `savedAt` (and `cleared` when it was emptied);
 * publishing also answers `tree`; publishing a FLAT page answers the stored `page_blocks`
 * rows, whose `data`/`isVisible` columns are nullable — the builder runs every answer
 * through `hydrateNodes`, which fills both.
 */
import type { Payload } from './handler-payload'

type DraftHandler = typeof import('~~/server/api/admin/pages/[id]/draft.put').default
type PublishHandler = typeof import('~~/server/api/admin/pages/[id]/publish.post').default
type VersionsHandler = typeof import('~~/server/api/admin/pages/[id]/versions/index.get').default
type VersionCreateHandler = typeof import('~~/server/api/admin/pages/[id]/versions/index.post').default
type VersionRestoreHandler = typeof import('~~/server/api/admin/pages/[id]/versions/[versionId]/restore.post').default
type VersionDeleteHandler = typeof import('~~/server/api/admin/pages/[id]/versions/[versionId].delete').default

/** `PUT /api/admin/pages/:id/draft` — `{ blocks }` saves the draft, `{}` clears it. */
export type PageDraftSaveResponse = Payload<DraftHandler>
export type PagePublishResponse = Payload<PublishHandler>
/** `GET /api/admin/pages/:id/versions`. */
export type PageVersionsResponse = Payload<VersionsHandler>
/** `POST /api/admin/pages/:id/versions` — a manual backup or the origin. */
export type PageVersionCreateResponse = Payload<VersionCreateHandler>
export type PageVersionRestoreResponse = Payload<VersionRestoreHandler>
export type PageVersionDeleteResponse = Payload<VersionDeleteHandler>
