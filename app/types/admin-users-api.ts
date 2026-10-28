/**
 * Responses of the admin users page (`/admin/users`, `pages/admin/users/index.vue`).
 *
 * DERIVED FROM THE HANDLERS (`Payload<…>`, app/types/handler-payload.ts); the row types
 * `AdminUserRow`/`AdminRoleRow` stay in app/types/admin-api.ts. Differences from the
 * hand-written shapes these replace (wave3 7.1, batch B), none of them displayed: creating
 * an account also answers its `id`; a role row carries its permission matrix.
 */
import type { Payload } from './handler-payload'

type UsersHandler = typeof import('~~/server/api/admin/users/index.get').default
type RolesHandler = typeof import('~~/server/api/admin/roles/index.get').default
type UserCreateHandler = typeof import('~~/server/api/admin/users/index.post').default
type UserUpdateHandler = typeof import('~~/server/api/admin/users/[id].put').default
type UserDeleteHandler = typeof import('~~/server/api/admin/users/[id].delete').default
type ActivityLogsHandler = typeof import('~~/server/api/admin/activity-logs/index.get').default

/** `GET /api/admin/users`. */
export type AdminUsersResponse = Payload<UsersHandler>
/** `GET /api/admin/roles`. */
export type AdminRolesResponse = Payload<RolesHandler>
export type AdminUserCreateResponse = Payload<UserCreateHandler>
/** `PUT /api/admin/users/:id` — the edit dialog and the status button. */
export type AdminUserUpdateResponse = Payload<UserUpdateHandler>
export type AdminUserDeleteResponse = Payload<UserDeleteHandler>

/**
 * `GET /api/admin/activity-logs` — the system-wide log (`/admin/users/activity`, wave3 7.1
 * batch E). Replaces the page's hand-written `LogItem`; the same fields, `createdAt` a string
 * after JSON. Its retention panel reads `ActivityRetentionStatus` (app/types/admin-api.ts).
 */
export type AdminActivityLogsResponse = Payload<ActivityLogsHandler>
export type AdminActivityLogItem = AdminActivityLogsResponse['items'][number]
