/**
 * Responses of the "Dịch toàn cục" tab of /admin/languages
 * (`components/admin/languages/UniversalTab.vue`) — wave3 7.1 batch D.
 *
 * DERIVED FROM THE HANDLERS (`Payload<…>`, app/types/handler-payload.ts). They replace the two
 * shapes the tab wrote by hand (`UniversalStats`, `UniversalTask`), which matched the service's
 * `UniversalCoverageStats`/`UniversalTaskState` field for field — now they cannot drift from them.
 * Starting a run that another run blocks is a 409, not `{ ok: false }`
 * (tests/universal-translate-refusal-behavior.test.ts); the cancel still answers `{ ok: false }`
 * when nothing runs, which the tab shows as information.
 */
import type { Payload } from './handler-payload'

type CoverageHandler = typeof import('~~/server/api/admin/system/translation-coverage.get').default
type TaskStatusHandler = typeof import('~~/server/api/admin/system/universal-translate-status.get').default
type StartHandler = typeof import('~~/server/api/admin/system/universal-translate.post').default
type CancelHandler = typeof import('~~/server/api/admin/system/universal-translate-cancel.post').default

/** `GET /api/admin/system/translation-coverage` — the three pillars, per language. */
export type UniversalCoverageResponse = Payload<CoverageHandler>
export type UniversalStats = UniversalCoverageResponse['stats']
/** `GET /api/admin/system/universal-translate-status` — the running (or last) task. */
export type UniversalTaskResponse = Payload<TaskStatusHandler>
export type UniversalTask = UniversalTaskResponse['task']
export type UniversalStartResponse = Payload<StartHandler>
export type UniversalCancelResponse = Payload<CancelHandler>
