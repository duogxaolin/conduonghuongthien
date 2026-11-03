/**
 * Responses of the admin sign-in flow (`app/composables/useAdminAuth.ts`,
 * `pages/admin/login.vue`) — wave3 7.1 batch C.
 *
 * DERIVED FROM THE HANDLERS (`Payload<…>`, app/types/handler-payload.ts), with one
 * stated exception: `GET /api/admin/auth/me` builds its user from
 * `event.context.adminUser`, which h3 types as `any` (`H3EventContext extends
 * Record<string, any>`). Nitro's `Serialize` OMITS `any`-typed keys, so
 * `Payload<typeof me>['user']` keeps only the two MFA fields — no `id`, `username`,
 * `permissions`… (a typecheck probe showed it). Its answer is typed by the object it
 * sends — the very one a completed login sends
 * (`completeLogin`, server/utils/mfa/session.ts) — and
 * tests/admin-auth-me-shape-behavior.test.ts pins that the two stay identical.
 *
 * Differences from the hand-written shapes these replace, none of them displayed: a
 * permission row also carries `id`/`roleId`, and its flags are `boolean | null` (the
 * columns are nullable — `hasPermission` already granted only `=== true`); `roleName` is
 * `string | null` (role row gone → leftJoin NULL); the MFA fields are always sent; the
 * login answer is a union — a session (`user`) or a challenge (`mfaRequired`, `methods`,
 * `recoveryCodesAvailable`) — so a caller narrows with `'user' in res` /
 * `'mfaRequired' in res`; "Gửi mã" answers `{ ok, sent }` (no `sentTo`).
 */
import type { Payload } from './handler-payload'

type LoginHandler = typeof import('~~/server/api/admin/auth/login.post').default
type MfaVerifyHandler = typeof import('~~/server/api/admin/auth/mfa/verify.post').default
type MfaSendCodeHandler = typeof import('~~/server/api/admin/auth/mfa/send-code.post').default
type CaptchaHandler = typeof import('~~/server/api/admin/auth/captcha.get').default
type LogoutHandler = typeof import('~~/server/api/admin/auth/logout.post').default
type CompleteLogin = typeof import('~~/server/utils/mfa/session').completeLogin

/** `POST /api/admin/auth/login`: a session, or a second-factor challenge. */
export type AdminLoginResponse = Payload<LoginHandler>
/** `POST /api/admin/auth/mfa/verify`: the session a passed challenge opens. */
export type AdminMfaVerifyResponse = Payload<MfaVerifyHandler>
/** `POST /api/admin/auth/mfa/send-code`. */
export type AdminMfaSendCodeResponse = Payload<MfaSendCodeHandler>
/** `GET /api/admin/auth/captcha`. */
export type AdminCaptchaResponse = Payload<CaptchaHandler>
/** `POST /api/admin/auth/logout`. */
export type AdminLogoutResponse = Payload<LogoutHandler>

type PublicSettingsHandler = typeof import('~~/server/api/public/settings.get').default
/**
 * `GET /api/public/settings` — the login page reads the two logos (batch D). The hand-written
 * shape it replaces also declared a `faviconUrl` the handler never sends.
 */
export type LoginPublicSettingsResponse = Payload<PublicSettingsHandler>

/** The signed-in account, as a completed login sends it. */
export type AdminSessionUser = Payload<CompleteLogin>['user']
/** `GET /api/admin/auth/me` — see the header for why it is typed by `completeLogin`. */
export type AdminMeResponse = { ok: boolean, user: AdminSessionUser }
