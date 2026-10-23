# Spec Delta

## Purpose

Defines what the schema migrations that run on every container start may do to `media_items.category_id`, so that a restart or deploy never erases the video categories staff assigned. The general rule for all boot-time writes is introduced later by `schema-upgrade-safety` (wave2).

## ADDED Requirements

### Requirement: Boot migrations preserve assigned media categories
Schema migrations executed at container start SHALL NOT change `media_items.category_id` of any existing row, except through the one-time legacy conversion below, whose trigger is a schema state that the conversion itself removes. Running the boot sequence any number of times on an already-converted database MUST leave every `media_items.category_id` value unchanged.

#### Scenario: Assigned video category survives repeated restarts
- **WHEN** a media item has `category_id` pointing at an existing `media_categories` row and the boot sequence runs twice
- **THEN** the media item still has the same `category_id` after both runs

#### Scenario: Fresh database booted twice
- **WHEN** the boot sequence creates an empty database, a media category is assigned to a media item, and the boot sequence runs again
- **THEN** the assignment is unchanged and no statement altered `media_items.category_id`

### Requirement: Legacy media-category ids are cleared exactly once, keyed on the legacy foreign key
While `media_items.category_id` is still constrained by a foreign key that references the article `categories` table, the boot sequence SHALL clear every `media_items.category_id` value, replace that foreign key with one that references `media_categories` with `ON DELETE SET NULL`, and in doing so remove the trigger for the conversion. The clearing MUST NOT be decided by comparing values against `media_categories`, because legacy article-category ids overlap valid media-category ids.

#### Scenario: Upgrade from the pre-split schema
- **WHEN** `media_items.category_id` has a foreign key referencing `categories` and a row holds `category_id = 3`, and the boot sequence runs
- **THEN** that row's `category_id` is NULL and the column's only foreign key references `media_categories(id)` with delete rule SET NULL

#### Scenario: Legacy id that collides with a valid media category
- **WHEN** the legacy foreign key references `categories`, a row holds `category_id = 2`, and `media_categories` also contains id 2
- **THEN** the row's `category_id` is still cleared, because the legacy value is meaningless after the split

#### Scenario: Interrupted conversion is resumed safely
- **WHEN** a previous boot cleared the values but stopped before replacing the foreign key, and the boot sequence runs again
- **THEN** the conversion completes and the result equals an uninterrupted conversion

### Requirement: A missing media-category foreign key is added without clearing data
When `media_items.category_id` has no foreign key at all, the boot sequence SHALL add the foreign key to `media_categories(id)` with `ON DELETE SET NULL` and MUST NOT clear any `category_id` value. If existing values reference ids absent from `media_categories`, the boot SHALL leave those values and the missing foreign key as they are, log one stable error event carrying the number of dangling rows, and continue starting the app.

#### Scenario: Foreign key absent, values valid
- **WHEN** `media_items.category_id` has no foreign key, every non-NULL value exists in `media_categories`, and the boot sequence runs
- **THEN** the foreign key to `media_categories` exists and every value is unchanged

#### Scenario: Foreign key absent, dangling values
- **WHEN** `media_items.category_id` has no foreign key and one row references an id missing from `media_categories`, and the boot sequence runs
- **THEN** no value is changed, no foreign key is added, an error event with the dangling-row count is logged, and the app still starts

### Requirement: A correct media-category foreign key is left untouched
When `media_items.category_id` already has exactly one foreign key referencing `media_categories(id)` with delete rule SET NULL, the boot sequence SHALL issue no UPDATE on `media_items` and no DROP or ADD of that foreign key.

#### Scenario: Already-converted database
- **WHEN** the foreign key already references `media_categories` and the boot sequence runs
- **THEN** no `ALTER TABLE media_items` and no `UPDATE media_items` statement is executed by the media-category migration
