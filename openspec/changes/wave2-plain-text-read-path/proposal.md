# Proposal

> **Split out of `wave2-hardening` (task 3.5, design D-PLAIN) on 2026-10-25.** Everything else in Wave 2 is implemented and archived; this item waits on a production fact that only the operator can confirm.

## Why

`plainTextField`/`withPlainTextFields` (`server/utils/decode-html-entities.ts`) still repair a truncated trailing entity at read time. The guess exists because excerpts imported from the old CMS were cut mid-entity (`Ng&agrave…`). The guess has a known false positive: a mixed string with complete entities **and** a real trailing `&word` (`C&ocirc;ng ty AT&T`) reads as `Công ty AT…`.

The root fix is the one-time Wave 1 backfill `npm run db:decode-excerpts -- --apply`, which repairs the stored rows. Once it has run in production, the read-time guess has nothing left to repair and only causes the false positive.

## What Changes

- Remove the `dropTruncatedEntity` call from the read path. Keep `decodeHtmlEntities`.
- Move the tail-repair cases in `tests/html-entities-plain-text.test.ts` to the backfill test.

## Precondition (hard)

The operator confirms that `npm run db:decode-excerpts -- --apply` ran against the **production** database (and that a DB backup was taken before it). Without that confirmation this change must not ship: rows still truncated in production would start showing a dangling `&agrave`.

## Capabilities

### New Capabilities
- `plain-text-read-path`: read-time decoding without truncation guessing.

### Modified Capabilities
- `plain-text-fields`: the operator repair's rule is stated on its own, no longer as "what the public read path shows today".

## Impact

- `server/utils/decode-html-entities.ts`, `tests/html-entities-plain-text.test.ts`, the backfill test.
- No schema, env, deploy or `production/` change.
