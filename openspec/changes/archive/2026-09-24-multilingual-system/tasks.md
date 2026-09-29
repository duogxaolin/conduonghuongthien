# Tasks

## 1. Database Schema & DDL

- [x] 1.1 Add `languages` and `langTranslations` table definitions to `server/db/schema.ts` (design.md D1)
- [x] 1.2 Add `articleTranslations` table definition to `server/db/schema.ts` (design.md D1)
- [x] 1.3 Add `CREATE TABLE` statements for all three tables in `server/db/init.ts`
- [x] 1.4 Add `ensureColumn` entries in `server/db/migrations-additive.ts` for deployments with existing data
- [ ] 1.5 Update `npm run db:drift` to include the three new tables in column/type checks ← (verify: `npm run db:drift` passes with 0 drift for all 3 new tables, column types and nullability match between schema.ts and DDL)

## 2. Language Seed & Management Service

- [x] 2.1 Create `server/services/languages.ts` with CRUD functions (create, update, delete, list, setDefault) — all writes in transaction with `activity_logs`
- [x] 2.2 Create seed function in `server/db/seed.ts` to insert 6 languages (vi, en, zh, fr, ru, lo) and migrate ~216 existing keys from `useI18n.ts` + `i18n-extra.ts` into `lang_translations`. Insert-only, idempotent.
- [x] 2.3 Create API endpoints: `GET/POST /api/admin/languages`, `PUT/DELETE /api/admin/languages/[code]` — RBAC `settings.read`/`settings.update` ← (verify: all endpoints enforce RBAC, delete-default returns 400, audit logs written in transaction)

## 3. UI Translation Admin API

- [x] 3.1 Create `GET /api/admin/languages/[code]/translations` — list with group filter, search, pagination
- [x] 3.2 Create `PUT /api/admin/languages/[code]/translations` — batch upsert, sets `is_ai_translated=false` for human edits
- [x] 3.3 Create `POST /api/admin/languages/ai-translate` — batch AI translate untranslated keys via `callAi`, sets `is_ai_translated=true`
- [x] 3.4 Create `GET /api/public/translations/[code]` — public endpoint, returns all key-values grouped, SWR 300s cache ← (verify: public endpoint returns correct shape, inactive languages return empty, cache header present)

## 4. Admin Languages Page

- [x] 4.1 Create `app/pages/admin/languages/index.vue` — tab layout with Languages tab (CRUD cards) and Translations tab (key-value table with group filter, search, inline edit)
- [x] 4.2 Add AI translate button in Translations tab — calls batch AI endpoint, shows progress, marks AI-translated keys with badge
- [x] 4.3 Add navigation entry in admin sidebar (`app/layouts/admin.vue`) under Settings group
- [ ] 4.4 Add skeleton loading, error/retry states, and `role="alert"` on error branch ← (verify: page loads with skeleton, error state has retry button pointing to same-file function, `role="alert"` present)

## 5. Migrate useI18n to DB-driven

- [x] 5.1 Refactor `app/composables/useI18n.ts` — fetch from `/api/public/translations/{code}` via `useState`, keep hardcoded vi as fallback (design.md D7)
- [x] 5.2 Update `app/composables/i18n-extra.ts` — remove hardcoded dictionaries, export only the extra key type definitions
- [ ] 5.3 Convert ~380 hardcoded Vietnamese strings across ~36 public `.vue` files to `t('key')` calls — layout, pages, components ← (verify: no hardcoded Vietnamese text remains in public layout/pages/components except CMS content, `t()` calls resolve correctly)

## 6. Article Translation Service & Worker

- [x] 6.1 Create `server/utils/html-chunker.ts` — split HTML content at semantic boundaries (~8k chars, at h2/h3/hr/p/div edges, never inside tags) (design.md D2)
- [x] 6.2 Create `server/services/article-translations.ts` — CRUD functions (create, update, delete, publish/unpublish, list for article), all writes in transaction with `activity_logs` (design.md D6)
- [x] 6.3 Create translation worker function in `server/services/article-translations.ts` — chunked translation via `callAi`, DB progress tracking, error handling with partial preservation (design.md D3)
- [x] 6.4 Add stale translation reaper in `server/plugins/` — on startup, mark `translating` rows older than 30 minutes as `failed` ← (verify: worker translates a short article in one chunk, long article splits correctly, failed chunk preserves prior results, reaper marks stale jobs)

## 7. Article Translation Admin API

- [x] 7.1 Create `GET /api/admin/articles/[id]/translations` — list all translations for an article
- [x] 7.2 Create `POST /api/admin/articles/[id]/translations/translate` — trigger background worker, returns immediately (design.md D3). Reject 409 if already translating.
- [x] 7.3 Create `GET /api/admin/articles/[id]/translations/[lang]/progress` — poll endpoint returning status/progress/chunks
- [x] 7.4 Create `PUT /api/admin/articles/[id]/translations/[lang]` — manual edit, sets `translated_by='human'`, status to `reviewed`
- [x] 7.5 Create `PATCH /api/admin/articles/[id]/translations/[lang]/status` — publish/unpublish/review
- [x] 7.6 Create `DELETE /api/admin/articles/[id]/translations/[lang]` — delete translation
- [x] 7.7 Create `POST /api/admin/articles/bulk-translate` — bulk translate selected articles sequentially
- [ ] 7.8 Create `GET /api/admin/articles/bulk-translate/progress` — poll bulk progress ← (verify: single translate spawns worker and returns 200 immediately, duplicate returns 409, progress endpoint reflects real worker state, bulk processes sequentially)

## 8. Article Translation Admin UI

- [x] 8.1 Add translation section in `app/pages/admin/content/articles/[id].vue` — replace current "apply to article" flow with translation list showing per-language status, translate/edit/publish buttons, progress bar for active jobs
- [x] 8.2 Create translation edit drawer — textarea for title/excerpt, HTML textarea + preview for content, save button
- [ ] 8.3 Add translation badges in `app/pages/admin/content/articles/index.vue` — colored badges per language in table row
- [ ] 8.4 Add translation filter in article list — "Missing translation for [lang]" dropdown
- [ ] 8.5 Add bulk translate action in article list — button in BulkActionBar, confirmation dialog, progress display ← (verify: editor shows translation list with correct statuses, progress bar animates during translation, bulk translate processes selected articles, badges reflect translation state)

## 9. Public Article Translation

- [x] 9.1 Modify `GET /api/public/articles/[slug]` to accept `?lang=` parameter — return published translation if available, otherwise original with `availableTranslations` list
- [ ] 9.2 Update `app/components/ArticleDetail.vue` — detect current language, pass `?lang=` to fetch, show translation banner ("Translated from Vietnamese" / "Only available in Vietnamese")
- [ ] 9.3 Add `routeRules` SWR for translation variants or ensure existing cache works with query params ← (verify: `?lang=en` returns English translation when published, returns Vietnamese with availableTranslations when not, ai_draft is never served publicly, banner displays correctly)

## 10. Tests & Drift

- [ ] 10.1 Update `npm run db:drift` to cover 3 new tables (45 total) — verify column names, SQL types, and nullability match
- [ ] 10.2 Add test for HTML chunker — verify splitting at boundaries, no broken tags, single-node oversized chunks
- [ ] 10.3 Add test for translation worker progress tracking — verify progress updates, failure handling, chunk preservation
- [ ] 10.4 Add test for public translation endpoint — verify only published translations served, fallback to original, availableTranslations list
- [ ] 10.5 Run full `npm test` and `npm run typecheck` ← (verify: all new tests pass, no regressions in existing 1187+ tests, typecheck clean, db:drift clean)
