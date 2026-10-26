/**
 * Types of the `/admin/media/scan` page ("Quét & Đồng bộ Media"), its panels
 * (`app/components/admin/media/scan/*`) and `useMediaStorageJobs`.
 *
 * Responses are DERIVED FROM THE HANDLERS under `server/api/admin/media/**`, the technique
 * of `app/types/admin-api.ts`: `Payload<…>` is the handler's return value after JSON, so a
 * changed response changes the type, and each `adminFetch<T>()` names the endpoint's own
 * answer instead of a shape restated at the call site. (`adminFetch`'s `T` is still an
 * unchecked assertion — see app/composables/adminFetch.ts — but it is the right one.)
 *
 * Differences from the hand-written shapes these replace, none of them displayed:
 *   - the sync job status also carries `urlsRepaired`;
 *   - the repair answer also carries `syncUrlsRepaired`/`syncRepairError` (already folded
 *     into its `message`), the repoint answer `byTarget`;
 *   - "Hủy quét"/"Hủy sync" answer `{ ok: false, message }` (HTTP 200) when no job runs.
 */
import type { Serialize } from 'nitropack/types'

/** As in app/types/admin-api.ts: what the browser holds after JSON, not what the handler returned. */
type Payload<T> = Serialize<Awaited<ReturnType<T extends (...args: never[]) => unknown ? T : never>>>

type CountsHandler = typeof import('~~/server/api/admin/media/counts.get').default
type ScanHandler = typeof import('~~/server/api/admin/media/scan.post').default
type ScanStatusHandler = typeof import('~~/server/api/admin/media/scan-status.get').default
type ScanCancelHandler = typeof import('~~/server/api/admin/media/scan-cancel.post').default
type ScanForceResetHandler = typeof import('~~/server/api/admin/media/scan-force-reset.post').default
type SyncHandler = typeof import('~~/server/api/admin/media/sync-storage.post').default
type SyncStatusHandler = typeof import('~~/server/api/admin/media/sync-status.get').default
type SyncCancelHandler = typeof import('~~/server/api/admin/media/sync-cancel.post').default
type SyncForceResetHandler = typeof import('~~/server/api/admin/media/sync-force-reset.post').default
type RepointHandler = typeof import('~~/server/api/admin/media/repoint-r2-urls.post').default
type RepairHandler = typeof import('~~/server/api/admin/media/repair-urls.post').default
type SelfHealHandler = typeof import('~~/server/api/admin/media/self-heal.post').default

// ─── Counts ──────────────────────────────────────────────────────────────────
export type MediaCountsResponse = Payload<CountsHandler>
export type MediaCounts = Pick<MediaCountsResponse, 'local' | 'r2'>

// ─── Scan of orphaned files (background job) ─────────────────────────────────
export type ScanStartResponse = Payload<ScanHandler>
export type ScanStatusResponse = Payload<ScanStatusHandler>
export type ScanJobStatus = NonNullable<ScanStatusResponse['status']>
export type ScanCancelResponse = Payload<ScanCancelHandler>
export type ScanForceResetResponse = Payload<ScanForceResetHandler>
/** The result cards kept on screen after a scan ends. */
export type ScanSummary = Pick<ScanJobStatus, 'imported' | 'skipped' | 'truncated'>

// ─── Local ↔ R2 sync (background job) ────────────────────────────────────────
export type SyncStartResponse = Payload<SyncHandler>
export type SyncStatusResponse = Payload<SyncStatusHandler>
export type SyncJobStatus = NonNullable<SyncStatusResponse['status']>
export type SyncDirection = SyncJobStatus['direction']
export type SyncCancelResponse = Payload<SyncCancelHandler>
export type SyncForceResetResponse = Payload<SyncForceResetHandler>
/** The result cards kept on screen after a sync ends. */
export type SyncSummary = Pick<SyncJobStatus, 'synced' | 'skipped' | 'articlesRewritten'>

// ─── One-shot repairs ────────────────────────────────────────────────────────
export type RepointResponse = Payload<RepointHandler>
export type RepointSummary = Pick<RepointResponse, 'mediaUpdated' | 'contentRowsUpdated' | 'backupStamp'>

export type RepairResponse = Payload<RepairHandler>
export type RepairSummary = Pick<RepairResponse, 'mediaFixed' | 'articlesFixed' | 'thumbnailsFixed' | 'backupStamp'>

export type SelfHealResponse = Payload<SelfHealHandler>
/** The self-heal report card: the answer without `ok`/`message`. */
export type SelfHealReport = Omit<SelfHealResponse, 'ok' | 'message'>
