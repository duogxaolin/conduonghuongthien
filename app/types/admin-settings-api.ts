/**
 * Responses of the admin settings pages migrated in wave3 7.1 batch A —
 * `/admin/settings/{general,social-links,media-portal}` and `/admin/chatbot/settings`.
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
