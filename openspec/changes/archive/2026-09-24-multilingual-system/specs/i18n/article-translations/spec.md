# Spec Delta

## Purpose
Store and serve per-article translations with a background chunked translation worker, admin management UI, and public-facing translated article display.

## ADDED Requirements

### Requirement: Article translation storage
Each article can have one translation per language, stored in `article_translations` with a 5-status lifecycle: `translating` → `ai_draft` → `reviewed` → `published`. `failed` for errors.

#### Scenario: Create translation via AI
- **WHEN** admin triggers translation of article 42 to English
- **THEN** a row is created in `article_translations` with `status='translating'`, `progress=0`
- **THEN** a background worker begins translating
- **THEN** progress is updated in DB as chunks complete
- **THEN** on completion, status changes to `ai_draft`, `progress=100`

#### Scenario: Duplicate translation request
- **WHEN** admin triggers translation for an article+lang that already has `status='translating'`
- **THEN** request is rejected with 409 (already in progress)

#### Scenario: Article deletion cascades
- **WHEN** an article is deleted
- **THEN** all its translations are deleted via FK CASCADE

### Requirement: Chunked translation worker
Long HTML content is split at semantic HTML boundaries (~8k chars per chunk) and translated chunk-by-chunk via AI Gateway. Worker runs in-process, tracks progress in DB.

#### Scenario: Short article (≤8k chars)
- **WHEN** content is 5,000 characters
- **THEN** title, excerpt, and content are translated in a single AI call
- **THEN** total_chunks=1

#### Scenario: Long article (>8k chars)
- **WHEN** content is 40,000 characters
- **THEN** content is split into ~5 chunks at `<h2>`, `<h3>`, `<p>` boundaries
- **THEN** each chunk is translated sequentially
- **THEN** progress updates after each chunk: 20%, 40%, 60%, 80%, 100%
- **THEN** chunks are concatenated to form the final translated content

#### Scenario: Chunk translation fails mid-way
- **WHEN** AI Gateway returns an error on chunk 3 of 5
- **THEN** status changes to `failed`, `error_message` is set
- **THEN** chunks 1-2 results are preserved
- **THEN** admin can retry, and worker resumes from the failed chunk

#### Scenario: Worker does not block HTTP response
- **WHEN** admin triggers translation
- **THEN** HTTP response returns immediately with `{ ok: true }`
- **THEN** translation runs asynchronously via `setTimeout(0)`

### Requirement: Translation progress polling
Admin client polls translation progress every 2 seconds.

#### Scenario: Poll during translation
- **WHEN** client GETs `/api/admin/articles/{id}/translations/{lang}/progress`
- **THEN** response includes `{ status, progress, currentChunk, totalChunks }`

#### Scenario: Poll after completion
- **WHEN** translation is complete
- **THEN** response includes `{ status: 'ai_draft', progress: 100, completedAt }`

### Requirement: Admin translation management
Admin can view, edit, publish, unpublish, and delete translations from the article editor.

#### Scenario: View translations in article editor
- **WHEN** admin opens article editor for article 42
- **THEN** a translation section shows all languages with their status
- **THEN** languages without translations show a "Translate" button
- **THEN** languages with translations show "View/Edit" and status controls

#### Scenario: Edit AI translation
- **WHEN** admin opens the edit drawer for an `ai_draft` translation
- **THEN** title, excerpt, content are editable
- **THEN** saving changes status to `reviewed`, `translated_by='human'`

#### Scenario: Publish translation
- **WHEN** admin publishes a `reviewed` or `ai_draft` translation
- **THEN** status changes to `published`
- **THEN** translation becomes visible to public visitors

### Requirement: Bulk translation
Admin can translate multiple articles at once from the article list page.

#### Scenario: Bulk translate selected articles
- **WHEN** admin selects 15 articles and triggers "Translate to English"
- **THEN** translations are created for articles that don't already have an English translation
- **THEN** articles are translated sequentially (respecting AI budget)
- **THEN** progress is trackable: "Translating 3/15..."
- **THEN** all translations are created with `status='ai_draft'`

### Requirement: Public translated articles
Public article endpoint supports a `lang` query parameter to return translations.

#### Scenario: Published translation exists
- **WHEN** client GETs `/api/public/articles/my-article?lang=en`
- **THEN** response includes translated title, excerpt, content
- **THEN** response includes `translatedFrom: 'vi'`

#### Scenario: No published translation
- **WHEN** client GETs `/api/public/articles/my-article?lang=en` but no published EN translation exists
- **THEN** response includes original Vietnamese content
- **THEN** response includes `availableTranslations: ['zh']` (listing other published translations)

#### Scenario: Only published translations are public
- **WHEN** a translation exists with `status='ai_draft'`
- **THEN** it is NOT returned to public endpoints
- **THEN** only `status='published'` translations are served

### Requirement: Audit trail
All translation operations are logged in `activity_logs` within the same transaction as the data change.

#### Scenario: Translation created
- **WHEN** a translation is created (AI or manual)
- **THEN** `activity_logs` records `create article_translation` with `{articleId, langCode, translatedBy}`

#### Scenario: Translation published
- **WHEN** a translation status changes to published
- **THEN** `activity_logs` records `publish article_translation`

#### Scenario: Bulk translate
- **WHEN** bulk translation is triggered
- **THEN** `activity_logs` records `bulk_translate articles` with `{langCode, count, articleIds}`
