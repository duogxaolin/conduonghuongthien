/**
 * Answers of the SITE-WIDE public endpoints (settings, languages, translations, social links,
 * livestream, analytics, the public forms) as the browser holds them —
 * `Payload<typeof handler>` (app/types/handler-payload.ts), derived from the handler, not
 * written by hand. What `publicFetch<T>()` is told at each call site (wave3 D-FETCH, lot G).
 */
import type { Payload } from './handler-payload'

/**
 * `GET /api/public/settings` — the public subset of `settings` (an allow-list in the handler).
 * The hand-written shape it replaces (`useSiteSettings`, `/in-bai`) also declared a
 * `faviconUrl` the handler never sends; the admin login page reads the same endpoint as
 * `LoginPublicSettingsResponse` (admin-auth-api.ts).
 */
export type PublicSettingsPayload = Payload<typeof import('~~/server/api/public/settings.get').default>
