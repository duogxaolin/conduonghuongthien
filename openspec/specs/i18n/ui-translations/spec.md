# i18n/ui-translations Specification

## Purpose
Convert hardcoded Vietnamese strings in public `.vue` files to `t()` calls backed by DB-driven translations. Modify `useI18n.ts` to fetch from the public translations endpoint.

## Requirements

### Requirement: DB-driven translation composable
`useI18n` fetches translations from the public endpoint on first use, caches in `useState`, and provides `t(key)` that falls back through: DB value → hardcoded Vietnamese → key name.

#### Scenario: First page load
- **WHEN** a visitor loads any public page
- **THEN** `useI18n` fetches `/api/public/translations/{locale}` once
- **THEN** translations are cached in `useState` for SSR hydration consistency
- **THEN** subsequent `t()` calls resolve from cache without additional fetches

#### Scenario: Language switch
- **WHEN** visitor switches language from `vi` to `en`
- **THEN** cookie `cdkt_lang` is set to `en`
- **THEN** translations for `en` are fetched (if not cached)
- **THEN** all `t()` calls reactively update to English values

#### Scenario: Missing translation fallback
- **WHEN** `t('nav.special')` is called but no DB value exists for current locale
- **THEN** the Vietnamese hardcoded value is returned if available
- **THEN** if no hardcoded value exists, the key name `nav.special` is returned

### Requirement: Public string migration
All hardcoded Vietnamese text in public pages, layout, and components is replaced with `t('key')` calls. Approximately 380 keys across 36 files.

#### Scenario: Layout navigation
- **WHEN** visitor views the site in English
- **THEN** header, footer, navigation, breadcrumbs display in English
- **THEN** no hardcoded Vietnamese text remains in public layout

#### Scenario: Public pages
- **WHEN** visitor views `/about`, `/contact`, `/news`, etc. in English
- **THEN** page titles, labels, buttons, error messages display in English
- **THEN** CMS content (article body) remains in its original language unless translated (see article-translations spec)
