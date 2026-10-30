/**
 * Answers of the READER's own endpoints (`/api/public/reader/**`) as the browser holds
 * them — `Payload<typeof handler>` (app/types/handler-payload.ts), derived, not written by
 * hand. What `publicFetch<T>()` is told by useReaderAuth, useReaderNotifications and
 * /profile (wave3 D-FETCH, lot G).
 *
 * Every one of these is called AFTER MOUNT only: the identity comes from the reader's
 * own cookie, and the public routes are cached (`swr`), so nothing here may enter
 * server-rendered HTML. The list endpoints of /profile (`comments.get`, `chats.get`) are
 * typed in public-api.ts (`ReaderCommentsPayload`, `ReaderChatsPayload`).
 */
import type { Payload } from './handler-payload'

/** `GET /api/public/reader/me` — `reader: null` when signed out (200, not 401). */
export type ReaderMeResponse = Payload<typeof import('~~/server/api/public/reader/me.get').default>

/** `POST /api/public/reader/claim-chats` — tickets of this device's conversations. */
export type ReaderClaimChatsResponse = Payload<typeof import('~~/server/api/public/reader/claim-chats.post').default>

/** `POST /api/public/reader/logout`. */
export type ReaderLogoutResponse = Payload<typeof import('~~/server/api/public/reader/logout.post').default>

/** `PUT /api/public/reader/profile` — the saved name (and its initials). */
export type ReaderProfileUpdateResponse = Payload<typeof import('~~/server/api/public/reader/profile.put').default>

/** `PUT /api/public/reader/profile/email-notifications`. */
export type ReaderEmailPreferenceResponse = Payload<typeof import('~~/server/api/public/reader/profile/email-notifications.put').default>

/** `GET /api/public/reader/notifications?page=` — one page, with the unread count. */
export type ReaderNotificationsResponse = Payload<typeof import('~~/server/api/public/reader/notifications.get').default>

/** `POST /api/public/reader/notifications/read` — `{ ids }` or `{ all: true }`. */
export type ReaderNotificationsReadResponse = Payload<typeof import('~~/server/api/public/reader/notifications/read.post').default>

// ─── A reader's writes to a comment thread (ArticleComments → useCommentWrites) ───
// The thread itself (`GET /api/public/comments/<slug>`) is `CommentThreadPayload` in public-api.ts.

/** `POST /api/public/comments` — `{ ok, id }` of the new comment (held for moderation or shown). */
export type CommentPostResponse = Payload<typeof import('~~/server/api/public/comments/index.post').default>

/** `DELETE /api/public/comments/<id>` — the reader's own comment. */
export type CommentDeleteResponse = Payload<typeof import('~~/server/api/public/comments/[id].delete').default>

/** `GET /api/public/comments/checkpoint?ids=` — `isHidden` of the reader's own comments (moderation outcome). */
export type CommentCheckpointResponse = Payload<typeof import('~~/server/api/public/comments/checkpoint.get').default>
