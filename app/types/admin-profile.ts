/**
 * Types of `/admin/profile` ("Tài khoản của tôi"), its components
 * (`app/components/admin/profile/*`) and the composables behind its forms.
 *
 * Responses are DERIVED FROM THE HANDLERS under `server/api/admin/profile/**`, the
 * technique of `app/types/admin-api.ts`: `Payload<…>` is the handler's return value after
 * JSON, so a changed response changes the type, and each `adminFetch<T>()` names the
 * endpoint's own answer instead of a shape restated at the call site. (`adminFetch`'s `T`
 * is still an unchecked assertion — see app/composables/adminFetch.ts — but it is the
 * right one.)
 *
 * Differences from the hand-written shapes these replace, none of them displayed:
 *   - every answer of enroll/confirm/disable also carries `factorType`, enroll `expiresAt`;
 *   - enroll answers a UNION — `secret`/`otpauthUri` for the app, `sentTo` for email, neither
 *     for a second password — so the page narrows with `'secret' in res` where it read
 *     `res.secret` before (same value at run time);
 *   - creating recovery codes also answers a `message` (the page keeps its own sentence),
 *     turning them off also answers `lockoutRisk` (the page re-reads the status instead).
 */
import type { Serialize } from 'nitropack/types'

/** As in app/types/admin-api.ts: what the browser holds after JSON, not what the handler returned. */
type Payload<T> = Serialize<Awaited<ReturnType<T extends (...args: never[]) => unknown ? T : never>>>

type StatusHandler = typeof import('~~/server/api/admin/profile/mfa/index.get').default
type PasswordHandler = typeof import('~~/server/api/admin/profile/password.put').default
type EnrollHandler = typeof import('~~/server/api/admin/profile/mfa/enroll.post').default
type ConfirmHandler = typeof import('~~/server/api/admin/profile/mfa/confirm.post').default
type DisableHandler = typeof import('~~/server/api/admin/profile/mfa/disable.post').default
type RecoveryCreateHandler = typeof import('~~/server/api/admin/profile/mfa/recovery-codes.post').default
type RecoveryDeleteHandler = typeof import('~~/server/api/admin/profile/mfa/recovery-codes.delete').default

// ─── Factor state ────────────────────────────────────────────────────────────
/** `GET /api/admin/profile/mfa`. */
export type MfaStatus = Payload<StatusHandler>
export type MfaFactor = MfaStatus['factors'][number]
export type FactorType = MfaFactor['factorType']

// ─── Actions ─────────────────────────────────────────────────────────────────
export type PasswordChangeResponse = Payload<PasswordHandler>
export type MfaEnrollResponse = Payload<EnrollHandler>
export type MfaConfirmResponse = Payload<ConfirmHandler>
export type MfaDisableResponse = Payload<DisableHandler>
export type RecoveryCodesCreateResponse = Payload<RecoveryCreateHandler>
export type RecoveryCodesDeleteResponse = Payload<RecoveryDeleteHandler>

/** What the factor cards and the dialogs say about each factor. */
export interface MfaFactorMeta {
  label: string
  icon: string
  desc: string
}
