# Design

**D-PLAIN** (moved verbatim from `wave2-hardening`): remove the `dropTruncatedEntity` call from `plainTextField`/`withPlainTextFields`. Keep `decodeHtmlEntities`. Update `tests/html-entities-plain-text.test.ts`: the tail-repair cases move to the backfill test. Ship only after the operator confirms the Wave 1 backfill was applied in production; this is a hard precondition in tasks.md.

**Rollback:** revert the PR; the read-time guess comes back unchanged.
