/**
 * Responses of the article list (`/admin/content/articles`,
 * `pages/admin/content/articles/index.vue`) and of the editor's translation panel
 * (`components/admin/articles/ArticleTranslationPanel.vue`).
 *
 * DERIVED FROM THE HANDLERS (`Payload<…>`, app/types/handler-payload.ts); the list row,
 * author and content-type rows stay in app/types/admin-api.ts. Differences from the
 * hand-written shapes these replace (wave3 7.1, batch B), none of them displayed:
 *   - the AI badge count's answer also carries `totalArticles`/`languages`;
 *   - a language row is the whole `languages` row plus its key-translation counts;
 *   - a translation row is the whole `article_translations` row (`articleId`,
 *     `translatorId`, `createdAt`, `updatedAt` too) — the panel keeps its own narrower
 *     view type so its optimistic "translating" rows stay constructible;
 *   - starting one translation answers a `message`, translate-all also `languages`.
 * The ZIP export (`export-batch`) is a stream, not JSON: its call is `adminFetch<Blob>`
 * with `responseType: 'blob'`.
 */
import type { Payload } from './handler-payload'

type ListHandler = typeof import('~~/server/api/admin/articles/index.get').default
type AuthorsHandler = typeof import('~~/server/api/admin/articles/authors.get').default
type ContentTypesHandler = typeof import('~~/server/api/admin/content-types/index.get').default
type ArticleUpdateHandler = typeof import('~~/server/api/admin/articles/[id].put').default
type ArticleDeleteHandler = typeof import('~~/server/api/admin/articles/[id].delete').default
type BulkTranslateHandler = typeof import('~~/server/api/admin/articles/bulk-translate.post').default
type BulkTranslateStatusHandler = typeof import('~~/server/api/admin/articles/bulk-translate-status.get').default
type BulkPublishHandler = typeof import('~~/server/api/admin/articles/bulk-publish-translations.post').default
type TranslationStatsHandler = typeof import('~~/server/api/admin/articles/translation-stats.get').default
type ExportGoogleHandler = typeof import('~~/server/api/admin/articles/export-google.post').default
type TranslateHandler = typeof import('~~/server/api/admin/articles/[id]/translations/translate.post').default
type TranslateAllHandler = typeof import('~~/server/api/admin/articles/[id]/translations/translate-all.post').default
type TranslationsHandler = typeof import('~~/server/api/admin/articles/[id]/translations/index.get').default
type TranslationSaveHandler = typeof import('~~/server/api/admin/articles/[id]/translations/[lang].put').default
type TranslationStatusHandler = typeof import('~~/server/api/admin/articles/[id]/translations/[lang]/status.patch').default
type TranslationDeleteHandler = typeof import('~~/server/api/admin/articles/[id]/translations/[lang].delete').default
type LanguagesHandler = typeof import('~~/server/api/admin/languages/index.get').default

// ─── The article list ────────────────────────────────────────────────────────
/** `GET /api/admin/articles` — the silent refresh after a translate and on each bulk poll. */
export type ArticleListResponse = Payload<ListHandler>
export type ArticleAuthorsResponse = Payload<AuthorsHandler>
export type ContentTypesResponse = Payload<ContentTypesHandler>
/** `PUT /api/admin/articles/:id` — the list's comments switch. */
export type ArticleUpdateResponse = Payload<ArticleUpdateHandler>
export type ArticleDeleteResponse = Payload<ArticleDeleteHandler>
export type BulkTranslateResponse = Payload<BulkTranslateHandler>
/** `GET /api/admin/articles/bulk-translate-status` — the banner's state. */
export type BulkTranslateStatusResponse = Payload<BulkTranslateStatusHandler>
export type BulkPublishTranslationsResponse = Payload<BulkPublishHandler>
/** `GET /api/admin/articles/translation-stats` — the list reads `aiPendingTranslations` only. */
export type TranslationStatsResponse = Payload<TranslationStatsHandler>
export type ArticleExportGoogleResponse = Payload<ExportGoogleHandler>

// ─── Translations of one article ─────────────────────────────────────────────
/** `POST /api/admin/articles/:id/translations/translate` — one language, from the list or the panel. */
export type ArticleTranslateResponse = Payload<TranslateHandler>
export type ArticleTranslateAllResponse = Payload<TranslateAllHandler>
/** `GET /api/admin/articles/:id/translations`. */
export type ArticleTranslationsResponse = Payload<TranslationsHandler>
export type ArticleTranslationRow = ArticleTranslationsResponse['items'][number]
export type ArticleTranslationSaveResponse = Payload<TranslationSaveHandler>
export type ArticleTranslationStatusResponse = Payload<TranslationStatusHandler>
export type ArticleTranslationDeleteResponse = Payload<TranslationDeleteHandler>
/** `GET /api/admin/languages` — the panel offers the active non-Vietnamese ones. */
export type LanguagesResponse = Payload<LanguagesHandler>
