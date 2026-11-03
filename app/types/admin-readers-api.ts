/**
 * Responses of one reader's page (`/admin/readers/[id]`, `pages/admin/readers/[id].vue`).
 *
 * DERIVED FROM THE HANDLERS (`Payload<…>`, app/types/handler-payload.ts). The detail,
 * impact, ban and comments-purge answers were already derived (`AdminReader*` in
 * app/types/admin-api.ts); this adds the three the page cast by hand and the reader and
 * comment rows the page used to restate (`Reader`, `Comment`) — same fields, now read from
 * `getReaderDetail`'s projection instead of copied.
 */
import type { Payload } from './handler-payload'
import type { AdminReaderDetail } from './admin-api'

type UnbanHandler = typeof import('~~/server/api/admin/readers/[id]/unban.post').default
type ReaderDeleteHandler = typeof import('~~/server/api/admin/readers/[id].delete').default
type CommentDeleteHandler = typeof import('~~/server/api/admin/comments/[id].delete').default

export type AdminReader = AdminReaderDetail['reader']
export type AdminReaderComment = AdminReaderDetail['comments'][number]

export type AdminReaderUnbanResponse = Payload<UnbanHandler>
/** `DELETE /api/admin/readers/:id` — the account and everything it wrote. */
export type AdminReaderDeleteResponse = Payload<ReaderDeleteHandler>
/** `DELETE /api/admin/comments/:id` — one comment (and the replies under it). */
export type AdminCommentDeleteResponse = Payload<CommentDeleteHandler>
