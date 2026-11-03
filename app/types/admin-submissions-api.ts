/**
 * Responses of the submission detail modal (`components/admin/SubmissionDetailModal.vue`) —
 * wave3 7.1 batch D.
 *
 * DERIVED FROM THE HANDLERS (`Payload<…>`, app/types/handler-payload.ts); the detail and event
 * row types (`AdminSubmissionDetail`, `AdminSubmissionEvent`) stay in app/types/admin-api.ts.
 * Differences from the hand-written shapes these replace, none of them displayed: the detail
 * also answers `ok` and `firstView`; the status change answers the new `status`; the note and
 * contact writes answer `{ ok }` where the modal declared `unknown`.
 */
import type { Payload } from './handler-payload'

type DetailHandler = typeof import('~~/server/api/admin/submissions/[id]/index.get').default
type StatusHandler = typeof import('~~/server/api/admin/submissions/[id]/status.put').default
type NoteHandler = typeof import('~~/server/api/admin/submissions/[id]/notes.post').default
type ContactHandler = typeof import('~~/server/api/admin/submissions/[id]/contact.post').default

/** `GET /api/admin/submissions/:id` — the submission and its processing log. */
export type AdminSubmissionDetailResponse = Payload<DetailHandler>
export type AdminSubmissionStatusResponse = Payload<StatusHandler>
export type AdminSubmissionNoteResponse = Payload<NoteHandler>
export type AdminSubmissionContactResponse = Payload<ContactHandler>
