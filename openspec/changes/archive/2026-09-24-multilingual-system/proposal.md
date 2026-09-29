# Proposal

## Why

The portal currently has a language switcher and ~216 hardcoded dictionary keys, but only the layout uses `t()` — all page content remains Vietnamese. Visitors who switch to English see English menu labels wrapping Vietnamese content. CMS articles have no translation support at all: the existing "Translate" button overwrites the original Vietnamese text, destroying it. Long articles are silently truncated at 12,000 characters before translation. There is no background processing, so translating a legal document times out.

## What Changes

- **DB-driven UI translations**: Two new tables (`languages`, `lang_translations`) replace the hardcoded dictionaries in `useI18n.ts` and `i18n-extra.ts`. Admin page at `/admin/languages` to manage languages and edit/AI-translate UI strings.
- **CMS article translations**: New table `article_translations` stores translated versions of articles separately from the original. Each article can have one translation per language with its own lifecycle (ai_draft → reviewed → published).
- **Chunked translation worker**: Remove the 12k character content limit. Split long HTML content at semantic boundaries (~8k chars at `<h2>`, `<h3>`, `<p>` edges). Run translation as a background worker with DB-tracked progress (0-100%), polling from the client every 2 seconds.
- **Bulk translation**: Translate multiple articles at once from the article list page. Worker processes articles sequentially, respecting AI budget.
- **Public-facing translations**: `GET /api/public/articles/[slug]?lang=en` returns the published translation if available, otherwise the Vietnamese original with a list of available translations. `ArticleDetail.vue` shows a banner indicating translation status.
- **Migrate public UI strings**: ~380 hardcoded Vietnamese strings across ~36 public `.vue` files converted to `t('key')` calls.

## Capabilities

### New Capabilities
- `i18n/language-management`: Admin CRUD for languages (activate, deactivate, reorder, set default). Database tables `languages` and `lang_translations`. Seed existing 216 keys × 6 languages from current composables.
- `i18n/ui-translations`: Admin translation editor (filter by group, search, inline edit, AI batch translate). Public endpoint with SWR cache. Migration of `useI18n.ts` to DB-driven fetch.
- `i18n/article-translations`: Per-article translation storage with 5-status lifecycle. Background chunked translation worker with progress tracking. Admin UI in article editor (translation tab) and article list (badges, filters, bulk translate). Public endpoint with `?lang=` parameter.

### Modified Capabilities
- None — this is additive; existing article endpoints and UI continue to work unchanged for Vietnamese content.

## Out of Scope
- Admin panel translation (kept Vietnamese — all C11 officers are Vietnamese)
- Page block translations, category translations, chatbot knowledge translations (future, separate tables)
- Automatic translation on publish (manual/bulk only — legal content needs human review)
- Backfilling old articles (officer chooses which articles to translate)
