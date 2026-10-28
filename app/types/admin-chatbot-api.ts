/**
 * Responses of the chatbot content page (`/admin/chatbot/knowledge`,
 * `pages/admin/chatbot/knowledge/index.vue`) and its small-talk tab
 * (`components/admin/ChatbotSmallTalkPanel.vue`) — wave3 7.1 batch C.
 *
 * DERIVED FROM THE HANDLERS (`Payload<…>`, app/types/handler-payload.ts); the row and
 * import types (`AdminKnowledgeRow`, `AdminSmallTalkRow`, `AdminKnowledgeImportResult`)
 * stay in app/types/admin-api.ts. Differences from the hand-written shapes these replace,
 * none of them displayed: the list answers also carry `ok` and `pagination.perPage`; the
 * single-row writes answer the saved row (`item`). The template download is a `Blob`
 * (`responseType: 'blob'`), not a JSON answer.
 */
import type { Payload } from './handler-payload'

type KnowledgeListHandler = typeof import('~~/server/api/admin/chatbot/knowledge/index.get').default
type KnowledgeUpdateHandler = typeof import('~~/server/api/admin/chatbot/knowledge/[id].put').default
type KnowledgeDeleteHandler = typeof import('~~/server/api/admin/chatbot/knowledge/[id].delete').default
type KnowledgePublishHandler = typeof import('~~/server/api/admin/chatbot/knowledge/[id]/publish.post').default
type KnowledgeArchiveHandler = typeof import('~~/server/api/admin/chatbot/knowledge/[id]/archive.post').default
type SmallTalkListHandler = typeof import('~~/server/api/admin/chatbot/small-talk/index.get').default
type SmallTalkCreateHandler = typeof import('~~/server/api/admin/chatbot/small-talk/index.post').default
type SmallTalkUpdateHandler = typeof import('~~/server/api/admin/chatbot/small-talk/[id].put').default
type SmallTalkDeleteHandler = typeof import('~~/server/api/admin/chatbot/small-talk/[id].delete').default
type SmallTalkToggleHandler = typeof import('~~/server/api/admin/chatbot/small-talk/[id]/toggle.patch').default

// ─── Knowledge ───────────────────────────────────────────────────────────────
/** `GET /api/admin/chatbot/knowledge`. */
export type AdminKnowledgeListResponse = Payload<KnowledgeListHandler>
/** `PUT /api/admin/chatbot/knowledge/:id` — the list's quick-question checkbox. */
export type AdminKnowledgeUpdateResponse = Payload<KnowledgeUpdateHandler>
/** `POST /api/admin/chatbot/knowledge/:id/{publish,archive}`. */
export type AdminKnowledgeTransitionResponse = Payload<KnowledgePublishHandler> | Payload<KnowledgeArchiveHandler>
export type AdminKnowledgeDeleteResponse = Payload<KnowledgeDeleteHandler>

// ─── Small talk ──────────────────────────────────────────────────────────────
/** `GET /api/admin/chatbot/small-talk`. */
export type AdminSmallTalkListResponse = Payload<SmallTalkListHandler>
export type AdminSmallTalkSaveResponse = Payload<SmallTalkCreateHandler> | Payload<SmallTalkUpdateHandler>
export type AdminSmallTalkDeleteResponse = Payload<SmallTalkDeleteHandler>
/** `PATCH /api/admin/chatbot/small-talk/:id/toggle`. */
export type AdminSmallTalkToggleResponse = Payload<SmallTalkToggleHandler>
