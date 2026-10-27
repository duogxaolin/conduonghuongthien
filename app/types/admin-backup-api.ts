/**
 * Responses of `/admin/settings/backup` — the backup list (the page) and the settings
 * block (`useBackupSettings`, rendered by `BackupSettingsPanel.vue`).
 *
 * DERIVED FROM THE HANDLERS under `server/api/admin/backup/**` and
 * `server/api/admin/settings/backup.*`, the technique of `app/types/admin-api.ts`:
 * `Payload<…>` is the handler's return value after JSON, so a changed response changes the
 * type, and each `adminFetch<T>()` names the endpoint's own answer instead of a shape
 * restated at the call site. (`adminFetch`'s `T` is still an unchecked assertion — see
 * app/composables/adminFetch.ts — but it is the right one.)
 *
 * Differences from the hand-written shapes these replace (wave3 7.1, batch A):
 *   - a backup row is the whole `backups` row: `createdAt` and `driveUploaded` are
 *     nullable columns (the page's `BackupItem` said they never were — it now says so,
 *     and `items.value = res.items` keeps the two in step), and it also carries
 *     `trigger`/`driveFileId`/`error`/`createdBy`, none of them displayed;
 *   - the run/restore status also carries `startedAt`, the status answer `pid`/`uptime`;
 *   - the Drive config also carries `redirectUriSource`/`publicBaseUrl`, the list answer
 *     `page`/`pageSize`.
 */
import type { Payload } from './handler-payload'

type ListHandler = typeof import('~~/server/api/admin/backup/index.get').default
type StatusHandler = typeof import('~~/server/api/admin/backup/status.get').default
type RunHandler = typeof import('~~/server/api/admin/backup/run.post').default
type RestoreHandler = typeof import('~~/server/api/admin/backup/restore.post').default
type DeleteHandler = typeof import('~~/server/api/admin/backup/[filename].delete').default
type SettingsReadHandler = typeof import('~~/server/api/admin/settings/backup.get').default
type SettingsSaveHandler = typeof import('~~/server/api/admin/settings/backup.put').default
type DriveStatusHandler = typeof import('~~/server/api/admin/backup/drive/status.get').default
type DriveConfigReadHandler = typeof import('~~/server/api/admin/backup/drive/config.get').default
type DriveConfigSaveHandler = typeof import('~~/server/api/admin/backup/drive/config.put').default
type DriveClearSecretHandler = typeof import('~~/server/api/admin/backup/drive/clear-secret.post').default
type DriveDisconnectHandler = typeof import('~~/server/api/admin/backup/drive/disconnect.post').default

// ─── The backup list and the run/restore status ──────────────────────────────
/** `GET /api/admin/backup`. */
export type BackupListResponse = Payload<ListHandler>
/** `GET /api/admin/backup/status`. */
export type BackupStatusResponse = Payload<StatusHandler>
export type BackupRunStatus = BackupStatusResponse['backup']
export type BackupRunResponse = Payload<RunHandler>
export type BackupRestoreResponse = Payload<RestoreHandler>
export type BackupDeleteResponse = Payload<DeleteHandler>

// ─── The settings block ──────────────────────────────────────────────────────
/** `GET /api/admin/settings/backup`. */
export type BackupSettingsResponse = Payload<SettingsReadHandler>
export type BackupSettingsSaveResponse = Payload<SettingsSaveHandler>
/** `GET /api/admin/backup/drive/status`. */
export type DriveStatusResponse = Payload<DriveStatusHandler>
export type DriveLink = DriveStatusResponse['link']
/** `GET`/`PUT /api/admin/backup/drive/config`, `POST …/clear-secret`: each answers the config. */
export type DriveConfigResponse = Payload<DriveConfigReadHandler>
export type DriveConfigSaveResponse = Payload<DriveConfigSaveHandler>
export type DriveClearSecretResponse = Payload<DriveClearSecretHandler>
export type DriveConfig = DriveConfigResponse['config']
export type DriveDisconnectResponse = Payload<DriveDisconnectHandler>
