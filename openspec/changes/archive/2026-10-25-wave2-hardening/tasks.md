# Tasks

> **Preconditions:** Waves 0 and 1 are deployed. Each numbered group is one or more PRs, in the order given.
>
> **Rules:**
> - Write the test first and see it fail on current code.
> - Scope is the files named in design.md.
> - Deploy-affecting items update `production/` in the same PR.
> - No commit or push without the user's explicit request.
> - Each PR ends with `npm test`, typecheck, `npm run lint` (0 errors), `npm run db:drift` when the schema changed, and the E2E suite when UI or auth changed.

## 1. Tests and measurement first (2F)

- [x] 1.1 Add `scripts/snapshot-schema.ts` and `tests/fixtures/schema-prev.sql`, generated from the last release tag. Document the refresh step in `CI-CD.md`.
  - Verify: the fixture loads into an empty MySQL without errors.
- [x] 1.2 Add `tests/schema-upgrade-integration.test.ts` (D-UPGRADE) and register it in the CI matrix.
  - The seed table list is derived from `migrations-additive.ts`.
  - The known boot writes are declared conversions with reasons, as in the design D-UPGRADE table. Without them the suite fails on day one.
  - It asserts no change on boot 2, and no change on boot 1 except declared conversions.
  - Verify: green locally. Re-adding an unconditional `UPDATE` in a scratch branch makes it fail. Do not commit that.
- [x] 1.3 Coverage re-measure with include globs (D-COVERAGE). Record the new baseline section.
  - *As shipped:* measured with `scripts/coverage-summary.ts` (lcov + never-loaded files at 0 %), not Node include globs — see `docs/test-coverage-baseline-2026-10.md`.
  - Verify: `npm run test:coverage` prints per-file rows for files never loaded, at 0 %.
  - ← (verify: the upgrade suite is in the matrix with both env blocks, and the Wave 1 matrix guard passes)

## 2. Security (2A)

- [x] 2.1 Origin gate middleware (D-CSRF), plus the new `SECURITY_EVENTS` entry.
  - Verify: new `tests/csrf-origin-gate-behavior.test.ts` covers the spec scenarios, multipart, and a public form from the real host. The E2E suite is green.
- [x] 2.2 MFA policy storage, the SuperAdmin endpoint and the audit row (D1).
  - Verify: a behaviour test. A non-SuperAdmin gets 403. The audit row is in the transaction (`tests/reader-audit-atomicity.test.ts` list updated if needed).
- [x] 2.3 MFA enforcement in `admin-auth` middleware, plus the `auth/me` fields, the client redirect and the grace banner. Add `MFA_ENFORCEMENT` to compose and `production/README.md`.
  - Verify: new `tests/admin-mfa-enforcement-behavior.test.ts` covers before grace, after grace, the allowlist, a user with a factor, and the kill switch. `tests/mfa-login-boundaries.test.ts` is green.
- [x] 2.4 Mandatory recovery codes on first-factor confirm under a policy.
  - Verify: a behaviour test, plus an E2E MFA spec that handles the reissued cookie.
- [x] 2.5 Credential envelopes (D-SECRETS).
  - Write paths, read paths, the boot conversion and the `needsReentry` reporting.
  - The runbook goes in `docs/decisions/realm-safety.md`.
  - Verify: new `tests/settings-secret-storage.test.ts` checks the round trip and that a stored row does not contain the plaintext. A conversion test runs boot twice: the second boot does nothing, and an undecryptable value is untouched. The SMTP test-send and R2 test still pass.
- [x] 2.6 Provider reserved names (D-NAMES).
  - Verify: a callback test where Google name "Admin" signs in and `effectiveDisplayName` returns "Bạn đọc".
  - ← (verify: no endpoint returns an envelope or plaintext credential. `tests/admin-handler-authorization.test.ts` and `tests/admin-auth-path-gate.test.ts` are green. Docs list the new env vars.)

## 3. Data integrity (2B)

- [x] 3.1 Repoint on the shared target list with the boundary matcher and one transaction; a failing pre-backup aborts (D-REPOINT).
  - Verify: an integration test over all 27 targets plus look-alikes, run twice, with per-target counts asserted.
- [x] 3.2 Media scan import (D-SCAN): the `scanned_source_path` column and index, the ownership check, deleting the uploaded object when the insert fails, and the duplicate report endpoint.
  - Verify: new `tests/media-scan-import.test.ts`. A second scan creates no row, a conflict is skipped, and an insert failure deletes the object. A behaviour test of the report.
- [x] 3.3 `repairLegacyMediaUrls` skips ambiguous filenames and logs; the domain comes from configuration (D-SCAN).
  - Verify: a unit test with two rows sharing a filename shows no rewrite.
- [x] 3.4 Seed markers (D7).
  - Move the `content_types`/`categories` seed inserts from the DDL files into `seed.ts`.
  - Add the bootstrap marking for non-empty tables.
  - Exclude the `seed.` prefix from settings reads.
  - Verify: an integration case in the upgrade suite or a new suite. Delete a default, reboot, and it stays deleted. A fresh DB seeds everything once.
- 3.5 Moved to the change `wave2-plain-text-read-path` on 2026-10-25, with its hard production precondition (the operator confirms the Wave 1 `db:decode-excerpts --apply` ran in production).
- [x] 3.6 Rescan lock check per batch (D-RESCAN).
  - Verify: extend `tests/moderation-rescan-job.test.ts` with a lock-lost case.
  - ← (verify: every schema addition appears in `schema.ts`, the DDL files and `migrations-additive.ts`, and the upgrade suite stays green)

## 4. Performance (2C)

- [x] 4.1 View-total columns, the generated column, the index and the one-time backfill (D6). Extend `db:drift` if needed.
  - *As shipped:* three plain columns (no generated column — MySQL error 3105 on restore of an old image's dump), and an every-boot reconcile that writes only drifted rows instead of a one-time backfill (D6).
  - Verify: the upgrade suite is green, and the backfill runs only when the column was just added (boot twice).
- [x] 4.2 Write paths update the totals in the same executor (`recordArticleView`, `addFabricatedViews`).
  - Verify: new `tests/view-totals-integrity.test.ts`. Extend `view-boost-integration` to check that the totals equal the daily sums.
- [x] 4.3 Read paths use the totals; the `COUNT` is dropped for `sort=views`; update `tests/correlated-subquery-qualification.test.ts`.
  - Verify: a MySqlDialect + node:sqlite ordering test, and a source guard that `sort=views` has no `article_view_daily` subquery.
- [x] 4.4 Analytics hot rows move to the end of the transaction (D8). Run the load test before and after, and record the numbers in `docs/decisions/data-layer.md`.
  - *As shipped:* D8 was amended to write `total` first; a residual deadlock under sustained load is mitigated by a 3-try retry, not fixed at the root. Follow-up (not in this change): natural-key primary keys on the two live analytics tables, and measuring the loss rate after retries.
  - Verify: a statement-order test with the injectable store, plus the recorded measurements.
  - ← (verify: the honesty invariant holds — real and fabricated stay separate, and the public API exposes nothing new)

## 5. Back-end structure (2E)

- [x] 5.1 Move the shared modules (D-SHARED): add the re-export shims, point the server imports at `shared/`, and add the guard `tests/server-no-app-imports.test.ts`.
  - Verify: typecheck, build, `db:drift` and the guard are all green.
- [x] 5.2 Add `zod` (D5), `server/utils/request-body.ts`, the baseline guard `tests/request-body-baseline.test.ts`, and the CLAUDE.md line.
  - Verify: unit tests for `readJsonBody`/`readValidated` (truncated JSON, a non-object, a wrong type naming the path). The guard fails for a new bare `readBody`. `npm audit --omit=dev --audit-level=high` is clean.
- [x] 5.3 Split `media-portal.ts` along the D-SPLIT seams: behaviour tests first, a barrel re-export, and guard lists updated.
  - Verify: every new file is ≤ 400 lines, and every test is green.
- [x] 5.4 Split `video-processing.ts` (same verification).
- [x] 5.5 Split `comments.ts` (same verification; the Wave 1 e-mail ordering test stays green).
- [x] 5.6 Split `chunked-upload.ts` (same verification; `upload-concurrency-integration` is green).
  - ← (verify: no behaviour change. The upgrade, media-queue and upload-concurrency integration suites and the E2E suite are green.)

## 6. Front-end structure (2D)

- [x] 6.1 `AdminModal.vue` (D-MODAL), plus the guard `tests/admin-modal-dialog.test.ts` with its named exemptions.
  - Verify: a render test (role, aria-modal, labelledby). The guard fails on an unmigrated overlay.
- [x] 6.2 Migrate the 17 overlays in the 10 files listed in D-MODAL. Read `openspec/ui-dna.md` first.
  - Verify: the guard is green, and an E2E pass runs over users, categories and pages meta.
- [x] 6.3 Moderation UI single home (D10): the tab becomes a summary plus a link. **Ask the user before deleting `AiModerationTab.vue`.**
  - Verify: the UI tests updated, and the spec scenario checked by a render test.
- [x] 6.4 `adminFetch` + `useAdminList` (D-FETCH), piloted on comments, readers and chatbot sessions.
  - Verify: composable unit tests (abort stale, retry, error mapping). `tests/admin-error-retry-ui.test.ts` and `skeleton-loading-ui.test.ts` are green. The 3 pages have no `$fetch` cast left.
  - ← (verify: no visual regression on the migrated pages; the PR includes screenshots)
  - **As shipped (2026-10-25, final verify):** PARTIAL. 6.4 was accepted on a pixel diff of before/after screenshots (readers and comments identical; sessions 34 px off by 1/255), described in PR #139; the PNGs stayed local and were not attached. 6.2 changed the dialog look on purpose (title strip with ✕, footer strip, PR #133); its acceptance rests on the E2E dialog specs (`admin-dialogs.spec.ts`), with no screenshot of a migrated dialog.

## 7. Ops (2F)

- [x] 7.1 Off-site status and the warning (D-OFFSITE): the column only if it is absent, the Drive status recorded, and the panel warning.
  - Verify: a behaviour test where the Drive upload fails, the status is `failed`, and the local file remains. A render test of the warning.
- [x] 7.2 `manage.sh`: the cron-install item and the encrypted `.env` export. Document both in `production/README.md` and `DEPLOY.md`.
  - Verify: ops-scripts assertions (idempotent cron install, confirmation required, `-pbkdf2` used). `bash -n` passes.
- [x] 7.3 journald logging (D-LOG), plus the `manage.sh` journald check and fallback, plus the README `journalctl` usage.
  - Verify: a compose test asserts the driver and tag. Locally, `docker compose config -q` passes.
- [x] 7.4 Ops alerts (D-ALERT): `ops-alert.ts`, the `ALERT_EVENTS` subset and the rate limit, the no-recursion flag, and `OPS_ALERT_EMAIL` in compose and `manage.sh`.
  - Verify: new `tests/ops-alert.test.ts` (rate limit, unset means no send, a send failure is swallowed, no recursion).
- [x] 7.5 Docs-only: the non-root deploy user and the memory-cap guidance in `production/README.md` (D-DOCS). Record the decisions D2 and D-CI in `CI-CD.md`.
  - Verify: the sections exist and are marked as user actions.
  - ← (verify: every new env var — `MFA_ENFORCEMENT`, `OPS_ALERT_EMAIL` — is in compose `environment:`, the `manage.sh` `.env` template and `production/README.md`)
