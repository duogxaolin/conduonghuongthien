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

/** `GET /api/public/languages` — the active languages, in display order. */
export type PublicLanguagesResponse = Payload<typeof import('~~/server/api/public/languages.get').default>

/** `GET /api/public/translations/<code>` — the interface dictionary of one language, by group. */
export type PublicTranslationsResponse = Payload<typeof import('~~/server/api/public/translations/[code].get').default>

/** `GET /api/public/social-links` — the visible links of the floating bubble. */
export type PublicSocialLinksResponse = Payload<typeof import('~~/server/api/public/social-links/index.get').default>

/** `POST /api/public/analytics/page-view` — always 202; `accepted` says whether it counted. */
export type PublicPageViewResponse = Payload<typeof import('~~/server/api/public/analytics/page-view.post').default>

/** `POST /api/submissions` — a citizen's form (support / contact blocks): `{ ok, id }`. */
export type PublicSubmissionResponse = Payload<typeof import('~~/server/api/submissions.post').default>

// ─── Livestream ──────────────────────────────────────────────────────────────

/** `GET /api/public/livestream/active` — `active: false, session: null` when nothing is on air. */
export type LivestreamActiveResponse = Payload<typeof import('~~/server/api/public/livestream/active.get').default>

/** `GET /api/public/livestream/chat/history?limit=` — the open session's last messages. */
export type LiveChatHistoryResponse = Payload<typeof import('~~/server/api/public/livestream/chat/history.get').default>

/** `POST /api/public/livestream/chat/send` — `{ ok, id }` of the accepted message. */
export type LiveChatSendResponse = Payload<typeof import('~~/server/api/public/livestream/chat/send.post').default>
