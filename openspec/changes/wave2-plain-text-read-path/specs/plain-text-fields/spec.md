# Spec Delta

## Purpose

The operator repair no longer describes its output by reference to the public read path, because that read path stops guessing at truncated entities in this change; the repair rule itself is unchanged.

## MODIFIED Requirements

### Requirement: Stored entity-encoded titles and excerpts can be repaired by an operator
An operator command SHALL scan `title` and `excerpt` of articles and article translations, report how many rows would change without writing by default, and with an explicit apply flag rewrite each changed value to plain text: entity decoding, plus removal of an entity cut off at the end only when the value is entity-encoded. The preview SHALL list every row whose result drops a trailing fragment, so the operator can review those before applying. The command MUST NOT touch `content`, MUST leave `updated_at` unchanged, MUST process rows in keyed batches, and running it again after apply MUST change nothing for rows that are no longer entity-encoded.

#### Scenario: Preview
- **WHEN** the operator runs the command without the apply flag on a database with an excerpt `Ng&agrave;y 26/8`
- **THEN** the report counts that row as changed and the stored value is still `Ng&agrave;y 26/8`

#### Scenario: Apply
- **WHEN** the operator runs it with the apply flag
- **THEN** the excerpt becomes `Ngày 26/8`, `updated_at` is unchanged and a SQL `LIKE '%Ngày%'` search finds the article

#### Scenario: Truncated tail is listed for review
- **WHEN** an excerpt ends with `nh&ac` and the rest of it is entity-encoded
- **THEN** the preview lists that row among the trailing-fragment repairs and apply stores it ending with `nh…`

#### Scenario: Literal ampersand untouched
- **WHEN** a title is `Phòng R&D`
- **THEN** it is not reported as changed and is not modified
