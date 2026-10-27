/**
 * Responses of the admin livestream page (`/admin/livestream`,
 * `pages/admin/livestream/index.vue`).
 *
 * DERIVED FROM THE HANDLERS (`Payload<…>`, app/types/handler-payload.ts). The active
 * session, start and stop answers were already derived (`AdminLivestream*` in
 * app/types/admin-api.ts); this adds the three the page cast by hand. Differences from
 * those hand-written shapes, none of them displayed: a chat removal also answers
 * `alreadyRemoved`/`sessionId`/`messageId`; a chat message's `createdAt` is '' for a row
 * whose `created_at` is NULL (`serializeChatMessage`).
 */
import type { Payload } from './handler-payload'

type YoutubeMetaHandler = typeof import('~~/server/api/admin/media-portal/youtube-meta.post').default
type ChatHistoryHandler = typeof import('~~/server/api/public/livestream/chat/history.get').default
type ChatRemoveHandler = typeof import('~~/server/api/admin/livestream/chat/[id].delete').default

/** `POST /api/admin/media-portal/youtube-meta`: `{ ok: false, reason }` or the oEmbed fields. */
export type YoutubeMetaResponse = Payload<YoutubeMetaHandler>
/** `GET /api/public/livestream/chat/history?limit` — the messages viewers see now. */
export type LivestreamChatHistoryResponse = Payload<ChatHistoryHandler>
export type LivestreamChatMessage = LivestreamChatHistoryResponse['messages'][number]
export type LivestreamChatRemoveResponse = Payload<ChatRemoveHandler>
