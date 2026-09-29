# i18n/language-management Specification

## Purpose
Admin management of portal languages and DB-driven UI string translations, replacing hardcoded dictionaries.

## Requirements

### Requirement: Language CRUD
Administrators with `settings.update` permission can create, read, update, and delete languages. Each language has a unique code, display name, native name, active flag, default flag, and display order.

#### Scenario: Create a language
- **WHEN** admin POSTs a new language with code `en`, name `English`, native_name `Tiếng Anh`
- **THEN** a `languages` row is created with `is_active=true`, `is_default=false`
- **THEN** an `activity_logs` entry is written in the same transaction

#### Scenario: Only one default language
- **WHEN** admin sets language `en` as default
- **THEN** any previously default language is unset
- **THEN** only one row has `is_default=true` at any time

#### Scenario: Cannot delete default language
- **WHEN** admin attempts to delete the default language
- **THEN** the request is rejected with 400

#### Scenario: Delete a language cascades translations
- **WHEN** admin deletes language `fr`
- **THEN** all `lang_translations` rows with `lang_code='fr'` are deleted

### Requirement: UI Translation Management
Administrators can view, edit, and batch-update UI translation strings grouped by category.

#### Scenario: List translations with filters
- **WHEN** admin GETs translations for lang `en` with group filter `nav`
- **THEN** only keys in group `nav` are returned, with their current values

#### Scenario: Inline edit a translation
- **WHEN** admin PUTs a batch update with `{key: 'nav.home', value: 'Home'}`
- **THEN** the translation is upserted (insert or update on duplicate)
- **THEN** `is_ai_translated` is set to `false` when human-edited

#### Scenario: AI batch translate
- **WHEN** admin triggers AI translation for lang `zh` with untranslated keys
- **THEN** each untranslated key is sent to AI Gateway (`callAi`) for translation
- **THEN** results are saved with `is_ai_translated=true`
- **THEN** keys that already have values are not overwritten

### Requirement: Public translation endpoint
A public endpoint serves all translations for a language code, cached with SWR.

#### Scenario: Fetch translations for active language
- **WHEN** client GETs `/api/public/translations/en`
- **THEN** all key-value pairs for `en` are returned, grouped by group name
- **THEN** response is cached with SWR 300s

#### Scenario: Fetch translations for inactive language
- **WHEN** client GETs `/api/public/translations/xx` where `xx` is not active
- **THEN** empty object is returned (fallback to default language handled client-side)

### Requirement: Seed migration
On first deployment, existing ~216 keys from `useI18n.ts` and `i18n-extra.ts` are seeded into `lang_translations` for all 6 configured languages. Seed is insert-only — re-running does not overwrite edited values.
