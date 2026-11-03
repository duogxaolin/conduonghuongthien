# Spec Delta

## Purpose

Makes changing the public R2 domain rewrite every stored reference to media on the old domain, exactly at URL boundaries, atomically and auditable.

## ADDED Requirements

### Requirement: A domain repoint rewrites every URL-holding column
Changing the R2 public domain SHALL rewrite references to the old domain in every column that the media sync rewrite covers (the shared target list), including JSON columns, and SHALL only rewrite occurrences where the old domain is preceded by `scheme://` and followed by a URL boundary. All rewrites and the audit record SHALL commit in one transaction, and the result SHALL report a count per target.

#### Scenario: Reference in a page block
- **WHEN** a page block, an article thumbnail and a settings logo reference `https://old.cdn/x.webp` and the domain is repointed to `new.cdn`
- **THEN** all three reference `https://new.cdn/x.webp` and the result counts each target

#### Scenario: Look-alike host untouched
- **WHEN** content references `https://xold.cdn/a.png` or `https://old.cdn.evil/a.png`
- **THEN** those references are unchanged

#### Scenario: Second run
- **WHEN** the same repoint runs again
- **THEN** no row changes

### Requirement: A repoint never runs without its safety backup
If the pre-repoint backup fails, the repoint SHALL abort without modifying any row.

#### Scenario: Backup fails
- **WHEN** the pre-repoint backup cannot be written
- **THEN** the repoint returns an error and no URL changed
