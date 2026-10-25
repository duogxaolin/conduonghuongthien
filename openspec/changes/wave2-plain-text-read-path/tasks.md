# Tasks

> **Precondition:** the operator confirms that the Wave 1 `npm run db:decode-excerpts -- --apply` ran against the production database. No commit or push without the user's explicit request.

## 1. Read path

- [ ] 1.1 Remove the truncation guess from the read path (D-PLAIN) and update `tests/html-entities-plain-text.test.ts`; the tail-repair cases move to the backfill test.
  - Verify: `C&ocirc;ng ty AT&T` reads as `Công ty AT&T`; `npm test`, typecheck and lint are green.
