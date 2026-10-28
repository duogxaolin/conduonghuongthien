/**
 * Responses of the admin settings pages migrated in wave3 7.1 batch A —
 * `/admin/settings/{general,social-links,media-portal}` and `/admin/chatbot/settings` —
 * and batch C: `/admin/settings/{email,tracking,media-storage,google-oauth,ip-bans,
 * security,sitemap,data-retention}`.
 *
 * DERIVED FROM THE HANDLERS under `server/api/admin/**`, the technique of
 * `app/types/admin-api.ts`: `Payload<…>` is the handler's return value after JSON, so a
 * changed response changes the type, and each `adminFetch<T>()` names the endpoint's own
 * answer instead of a shape restated at the call site. (`adminFetch`'s `T` is still an
 * unchecked assertion — see app/composables/adminFetch.ts — but it is the right one.)
 *
 * Differences from the hand-written shapes these replace, none of them displayed:
 *   - `GET /api/admin/settings` also answers `needsReentry`;
 *   - the favicon upload also answers `icoUrl`/`sourceBytes`/`iconBytes`;
 *   - a social link's `iconType` is the column's `string`, not the three-value union the
 *     page declared — the page narrows it where it reads it (`startEdit`);
 *   - the chatbot settings answer is typed field by field (it was `Record<string, unknown>`);
 *     the AI provider rows also carry `id`/`baseUrl`/`apiKeyLastFour`/`updatedAt`/model
 *     counts, the pricing rows `updatedAt`.
 * Batch C (none displayed either): `needsReentry` is always sent (the pages had it
 * optional); the SMTP/R2 test answers always carry `message` (the R2 one also `usedSaved`);
 * the retention answer also carries `bounds`/`defaults`, its run `message` and each
 * table's window, `deletedByAge`/`deletedByRowCap` and `bounded`; the MFA policy save answers the new
 * policy; adding an address ban answers its `id`.
 */
import type { Payload } from './handler-payload'

type SettingsReadHandler = typeof import('~~/server/api/admin/settings/index.get').default
type SettingsSaveHandler = typeof import('~~/server/api/admin/settings/index.put').default
type FaviconUploadHandler = typeof import('~~/server/api/admin/settings/favicon.post').default
type FaviconResetHandler = typeof import('~~/server/api/admin/settings/favicon.delete').default
type LayoutReadHandler = typeof import('~~/server/api/admin/settings/layout.get').default
type LayoutSaveHandler = typeof import('~~/server/api/admin/settings/layout.put').default
type SocialLinksHandler = typeof import('~~/server/api/admin/social-links/index.get').default
type SocialLinkCreateHandler = typeof import('~~/server/api/admin/social-links/index.post').default
type SocialLinkUpdateHandler = typeof import('~~/server/api/admin/social-links/[id].put').default
type SocialLinkDeleteHandler = typeof import('~~/server/api/admin/social-links/[id].delete').default
type SocialLinksReorderHandler = typeof import('~~/server/api/admin/social-links/reorder.post').default
type MediaPortalSettingsReadHandler = typeof import('~~/server/api/admin/settings/media-portal.get').default
type MediaPortalSettingsSaveHandler = typeof import('~~/server/api/admin/settings/media-portal.put').default
type UploadHousekeepHandler = typeof import('~~/server/api/admin/media-portal/upload/housekeep.post').default
type ChatbotSettingsReadHandler = typeof import('~~/server/api/admin/chatbot/settings/index.get').default
type ChatbotSettingsSaveHandler = typeof import('~~/server/api/admin/chatbot/settings/index.patch').default
type AiProvidersHandler = typeof import('~~/server/api/admin/ai/providers/index.get').default
type AiPricingHandler = typeof import('~~/server/api/admin/ai/pricing/index.get').default
type SmtpTestHandler = typeof import('~~/server/api/admin/settings/test-email.post').default
type R2TestHandler = typeof import('~~/server/api/admin/settings/test-r2.post').default
type GoogleOAuthReadHandler = typeof import('~~/server/api/admin/settings/google-oauth/index.get').default
type GoogleOAuthSaveHandler = typeof import('~~/server/api/admin/settings/google-oauth/index.patch').default
type GoogleOAuthClearSecretHandler = typeof import('~~/server/api/admin/settings/google-oauth/clear-secret.post').default
type IpBansHandler = typeof import('~~/server/api/admin/ip-bans/index.get').default
type IpBanCreateHandler = typeof import('~~/server/api/admin/ip-bans/index.post').default
type IpBanDeleteHandler = typeof import('~~/server/api/admin/ip-bans/[id].delete').default
type MfaPolicyReadHandler = typeof import('~~/server/api/admin/security/mfa-policy.get').default
type MfaPolicySaveHandler = typeof import('~~/server/api/admin/security/mfa-policy.put').default
type SitemapReadHandler = typeof import('~~/server/api/admin/settings/sitemap/index.get').default
type SitemapGenerateHandler = typeof import('~~/server/api/admin/settings/sitemap/generate.post').default
type SitemapSaveHandler = typeof import('~~/server/api/admin/settings/sitemap/index.put').default
type RetentionReadHandler = typeof import('~~/server/api/admin/settings/retention.get').default
type RetentionSaveHandler = typeof import('~~/server/api/admin/settings/retention.put').default
type RetentionRunHandler = typeof import('~~/server/api/admin/settings/retention-run.post').default

// ─── General settings (`/api/admin/settings`) ────────────────────────────────
export type SiteSettingsResponse = Payload<SettingsReadHandler>
export type SiteSettingsSaveResponse = Payload<SettingsSaveHandler>
export type FaviconUploadResponse = Payload<FaviconUploadHandler>
export type FaviconResetResponse = Payload<FaviconResetHandler>
/** `GET`/`PUT /api/admin/settings/layout`: each answers the (validated) config. */
export type LayoutSettingsResponse = Payload<LayoutReadHandler>
export type LayoutSettingsSaveResponse = Payload<LayoutSaveHandler>

// ─── Social links ────────────────────────────────────────────────────────────
export type SocialLinksResponse = Payload<SocialLinksHandler>
export type AdminSocialLink = SocialLinksResponse['items'][number]
export type SocialLinkCreateResponse = Payload<SocialLinkCreateHandler>
export type SocialLinkUpdateResponse = Payload<SocialLinkUpdateHandler>
export type SocialLinkDeleteResponse = Payload<SocialLinkDeleteHandler>
export type SocialLinksReorderResponse = Payload<SocialLinksReorderHandler>

// ─── Media Portal settings ───────────────────────────────────────────────────
/** `GET /api/admin/settings/media-portal`. */
export type MediaPortalSettingsResponse = Payload<MediaPortalSettingsReadHandler>
export type MediaPortalSettingsSaveResponse = Payload<MediaPortalSettingsSaveHandler>
/** `POST /api/admin/media-portal/upload/housekeep`. */
export type UploadHousekeepResponse = Payload<UploadHousekeepHandler>

// ─── Chatbot settings ────────────────────────────────────────────────────────
/** `GET /api/admin/chatbot/settings`. */
export type ChatbotSettingsResponse = Payload<ChatbotSettingsReadHandler>
export type ChatbotSettingsSaveResponse = Payload<ChatbotSettingsSaveHandler>
export type AiProvidersResponse = Payload<AiProvidersHandler>
export type AiPricingResponse = Payload<AiPricingHandler>

// ─── Email, tracking, media storage (batch C) ────────────────────────────────
// Read and saved through `/api/admin/settings` — `SiteSettingsResponse` above.
/** `POST /api/admin/settings/test-email`. */
export type SmtpTestResponse = Payload<SmtpTestHandler>
/** `POST /api/admin/settings/test-r2`. */
export type R2TestResponse = Payload<R2TestHandler>

// ─── Google sign-in for readers ──────────────────────────────────────────────
/** `GET /api/admin/settings/google-oauth`. */
export type GoogleOAuthSettingsResponse = Payload<GoogleOAuthReadHandler>
export type GoogleOAuthSettings = GoogleOAuthSettingsResponse['settings']
export type GoogleOAuthSettingsSaveResponse = Payload<GoogleOAuthSaveHandler>
/** `POST /api/admin/settings/google-oauth/clear-secret`. */
export type GoogleOAuthClearSecretResponse = Payload<GoogleOAuthClearSecretHandler>

// ─── Address bans ────────────────────────────────────────────────────────────
/** `GET /api/admin/ip-bans`. */
export type IpBansResponse = Payload<IpBansHandler>
export type AdminIpBan = IpBansResponse['bans'][number]
export type IpBanCreateResponse = Payload<IpBanCreateHandler>
export type IpBanDeleteResponse = Payload<IpBanDeleteHandler>

// ─── MFA policy ──────────────────────────────────────────────────────────────
/** `GET /api/admin/security/mfa-policy`. */
export type MfaPolicyResponse = Payload<MfaPolicyReadHandler>
export type MfaPolicySaveResponse = Payload<MfaPolicySaveHandler>

// ─── Sitemap ─────────────────────────────────────────────────────────────────
/** `GET /api/admin/settings/sitemap`. */
export type SitemapResponse = Payload<SitemapReadHandler>
export type SitemapGenerateResponse = Payload<SitemapGenerateHandler>
export type SitemapSaveResponse = Payload<SitemapSaveHandler>

// ─── Data retention ──────────────────────────────────────────────────────────
/** `GET /api/admin/settings/retention`. */
export type RetentionResponse = Payload<RetentionReadHandler>
export type RetentionScopeStatus = RetentionResponse['scopes'][number]
export type RetentionSaveResponse = Payload<RetentionSaveHandler>
/** `POST /api/admin/settings/retention-run`. */
export type RetentionRunResponse = Payload<RetentionRunHandler>
