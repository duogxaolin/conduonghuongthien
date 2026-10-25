# Design

## Context

See proposal.md for motivation, scope and the decision points. Specs live under `specs/`.

Evidence for each item is the read-only review of `main` 7dfed8c (2026-10-23). The file and line anchors below come from it. Waves 0 and 1 are assumed deployed. In particular:
- the boot-migration rule from Wave 0;
- the link policy and `request-secure.ts` from Wave 1;
- the settings allowlist from Wave 1;
- the health endpoint and pre-deploy dump from Wave 1.

The same CLAUDE.md constraints as Wave 1 apply:
- `production/` is updated with every deploy-affecting change.
- Any new env var is listed in compose `environment:`.
- Audit rows go inside the transaction.
- SQL is parameterised.
- No logic in `default.vue` or `init.ts`.
- No commit or push without an explicit request.

## Goals / Non-Goals

**Goals**
- Close the remaining attack paths: cross-site requests, optional MFA, plaintext credentials.
- Make the media URL tools and the boot seed safe for data.
- Make "most read" O(1) per request.
- Make ops failures visible.
- Give the front end and back end the shared structure that Wave 3 rolls out.

**Non-Goals**
- Migrating legacy endpoints to schema validation. The baseline guard only stops growth.
- Rolling out `adminFetch`/`useAdminList` beyond the 3 pilot pages, which is Wave 3.
- Colour tokens, file splitting outside the 4 services, and CSP. All Wave 3.
- Rewriting git history. That is the user's decision, in the Wave 0 checklist.

## Decisions

### 2A. Security

**D-CSRF. Origin gate** *(As shipped: the middleware gates every path, not only `/api/**` — stricter than written here.)*
- New `server/middleware/00.origin-gate.ts`. The `00.` prefix makes it run before `admin-auth`; confirm against Nitro's middleware ordering, which is alphabetical by filename.
- It applies only to `/api/**` with the methods POST, PUT, PATCH and DELETE.
- Order of checks:
  1. `Sec-Fetch-Site`: allow `same-origin` and `none`, reject anything else.
  2. Otherwise `Origin`: parse it. `null` or unparsable means reject. If the host is not in the allowed set, reject.
  3. Neither header present: allow.
- The allowed host set is built from:
  - the request host, via `public-link-base.ts` and the trusted-proxy logic, never a raw `Host` from an untrusted peer;
  - the host of `PUBLIC_BASE_URL`;
  - `PUBLIC_HOST_ALLOWLIST`.
- The refusal log uses a new `SECURITY_EVENTS` entry, `security.cross_site_refused`, carrying the path and the origin host only.
- Test: an h3 app harness in the `tests/admin-auth-path-gate.test.ts` style. Cover the 4 spec scenarios, plus multipart upload, plus a public form POST from the real host.
- Rejected: a CSRF token. It needs state, plus changes on every form and fetch. The Origin/Fetch-Metadata approach covers all browsers in use, and the cookies stay SameSite=Lax as a second layer.

**D1. MFA policy**
- Storage: settings key `mfa_policy` (`off|privileged|all`) and `mfa_enforce_after` (ISO timestamp). Both are excluded from `ALLOWED_SETTING_KEYS` and from the Wave 1 read allowlist.
- They are written only by a new endpoint, `server/api/admin/security/mfa-policy.put.ts`. It needs `requireResourcePermission` plus `requireSuperAdmin`. Audit is in the same transaction.
- "Covered" is computed from the actor's effective permissions:
  - `isSuperAdmin`; or
  - update or delete on `users`, `roles` or `settings`; or
  - any backup permission resource.
  - The exact resource names come from `shared/permissions.ts`.
- Enforcement runs in `server/middleware/admin-auth.ts`, after the user loads:
  - It applies when the policy covers the user, `now ≥ mfa_enforce_after`, `!hasAnyActiveFactor(user.id)`, and the decoded path is not in the enrollment allowlist (`auth/me`, `auth/logout`, `profile` password, `profile/mfa/**`).
  - The result is 403 `{ code: 'mfa_enrollment_required' }`.
  - The factor check is cached per request, and per `tokenVersion` for 60 s, to avoid an extra query on every request.
- `auth/me` returns `{ mfaEnrollmentRequired, mfaEnforceAfter }`.
  - `app/middleware/admin-auth.ts` redirects to `/admin/profile#security` when enrollment is required.
  - A banner shows the date during the grace period.
- `MFA_ENFORCEMENT=0` is read at request time and listed in compose `environment:` and `production/README.md`.
- Recovery codes: the confirm-first-factor flow generates them when the policy is not `off`, reusing `profile/mfa/recovery-codes` logic. That flow already revokes sessions and re-issues the cookie (`confirm.post.ts`); the UI must handle the new cookie.
- Lockout risks are documented in `docs/decisions/realm-safety.md`:
  - JWT secret rotation invalidates TOTP.
  - Email OTP needs SMTP.
  - Break-glass is the SuperAdmin `users/[id]/mfa.delete` plus the env switch.

**D-SECRETS. Credential envelopes**
- Reuse the AES-256-GCM envelope helpers already used for `media_video_r2_secret_key` and the backup-drive OAuth secrets, in `media-config-service.ts` and `backup-drive-oauth-config.ts`.
- New labels:
  - `cdkt-smtp-pass:v1`
  - `cdkt-r2-secret:v1`
  - `cdkt-backup-drive-key:v1`, already named in the `backup.put.ts:10` comment.
- Writes go through `settings/index.put.ts`, `backup.put.ts` and the media-storage save path.
- Reads for use: `mailer.ts:48`, `openR2`/media R2 config, and `services/backup.ts:97`.
- One-time conversion: a boot step in `migrations-additive.ts` encrypts any non-envelope value of those three keys. That complies with the Wave 0 rule, because the trigger ("value is not an envelope") is removed by the conversion.
- An undecryptable value is reported by the settings GET as `{ needsReentry: true }`, never as a raw value.
- Key rotation runbook: rotating `CHATBOT_ENCRYPTION_SECRET` now also requires re-entering the SMTP, R2 and Drive credentials. Document it next to the existing rotation runbook.

**D-NAMES. Provider names**
- In the Google OAuth callback, after `validateIdTokenClaims`, compute `isReservedName(fold(name))` using the Wave 1 fold.
- If reserved, store the provider name, but set a flag column `display_name_reserved` (via `ensureColumn`, `TINYINT NOT NULL DEFAULT 0`).
- `effectiveDisplayName()` returns "Bạn đọc" when the flag is set and there is no custom name.
- Rejected: overwriting `display_name`, because the next sign-in refreshes it anyway.

### 2B. Data integrity

**D-REPOINT**
- Build a domain-prefix matcher from the same boundary definitions as `media-sync-url-match.ts`:
  - the left side must be `scheme://`;
  - the right side is `RIGHT_BOUNDARY` or `/`.
- Apply it to `URL_REFERENCE_TARGETS` with the existing `kind: 'json' | 'text'` forms (`media-sync-rewrite.ts`).
- Also update `media.url` rows with `provider='r2'`.
- Everything runs in one transaction with the audit row.
- The pre-backup failure becomes fatal (`media-repoint.ts:105`).
- `assertRewritable` already guards against the new value containing the old one; keep it.
- Test: extend `tests/media-sync-rewrite-integration.test.ts`, or add `media-repoint-integration`, to seed all 27 targets plus look-alikes and run twice.

**D-SCAN**
- Add column `media.scanned_source_path VARCHAR(1024) NULL` with a prefix index, via `ensureColumn`/`ensureIndex` and `schema.ts`.
- `runScanWorker` builds `known` from that column, as well as `storagePath` for local rows.
- Before upload, check `otherRowOwns(db, id, 'r2', targetKey, null)` (`media-sync-files.ts:209`) and record a conflict.
- On insert failure, delete the uploaded object and log.
- Existing R2-scanned rows have no source path and cannot be backfilled reliably. The duplicate report covers them:
  - new `GET /api/admin/media/duplicates` (`media.read`);
  - groups by `filename + size`, plus groups by identical `storage_path`;
  - lists usage counts from the 27 targets.
- `repairLegacyMediaUrls` (`migrations-additive.ts:831-879`): a filename shared by more than one `media` row is skipped and logged, instead of mapped. The hard-coded `cdn1.delify.vn` becomes the configured R2 public domain when available, otherwise the step is skipped.

**D7. Seed markers**
- Markers are **versioned per default set**: `seed.<group>.v<N>.done`, for example `seed.moderation_rules.v1.done`. They live in `settings`, with value = ISO time.
  - When a later release adds new defaults to a group, it introduces `v2` with only the new rows. Existing databases receive them once, and deleted `v1` rows stay deleted.
  - The groups are `moderation_rules`, `social_links`, `media_categories`, `content_types` and `categories`.
- Each group's seed function:
  1. If the marker exists, skip.
  2. Else if the table has rows, write the marker only (the bootstrap for existing databases).
  3. Else insert the defaults and write the marker.
- `content_types` and `categories` are seeded in `schema-tables/core.ts:104` and `content.ts:67` (DDL files). Move those seed inserts into `seed.ts`, behind the markers, keeping the DDL files DDL-only.
- The `seed.` prefix is excluded from every settings read (Wave 1 allowlist) and from `ALLOWED_SETTING_KEYS`.

**D-PLAIN.** *(Moved to the change `wave2-plain-text-read-path` on 2026-10-25.)* Remove the `dropTruncatedEntity` call from `plainTextField`/`withPlainTextFields`. Keep `decodeHtmlEntities`. Update `tests/html-entities-plain-text.test.ts`: the tail-repair cases move to the backfill test. Ship only after the operator confirms the Wave 1 backfill was applied in production; this is a hard precondition in tasks.md.

**D-RESCAN.** Before each batch, `moderation-rescan-job.ts` runs `SELECT IS_USED_LOCK(?) = CONNECTION_ID()` on the lock connection. If false or erroring, it stops with status `stopped`, reason `lock_lost`. Test: extend `tests/moderation-rescan-job.test.ts` with a fake that flips mid-run.

### 2C. Performance

**D6. View totals**
- Add to `articles`:
  - `view_total_real BIGINT NOT NULL DEFAULT 0`;
  - `view_total_fabricated BIGINT NOT NULL DEFAULT 0`;
  - `view_total BIGINT NOT NULL DEFAULT 0`, a plain column the app updates in the same statement as the real/fabricated half. A STORED generated column was tried first and rejected: an older image's `SELECT *` dump writes into it and the restore fails with MySQL error 3105 (found by verification); a database that ran that version has the column converted to plain at boot, keeping its values;
  - index `articles_status_type_views_idx (status, type, view_total, published_at, created_at)` — 5 columns because EXPLAIN showed MySQL never uses a 3-column version for the required ordering.
- Declare them in `schema.ts`, `content.ts`, `ensureColumn`/`ensureIndex`.
- `db:drift` compares generated columns and fails if any column of ours is generated.
- Boot-time reconcile (`reconcileArticleViewTotals`, replaces a one-time backfill): every boot, recompute real/fabricated/view_total from `article_view_daily` only for articles whose totals differ, pinning `updated_at`; writes nothing when consistent. This heals the first upgrade and any drift after a rollback followed by a roll-forward. It runs in `init.ts` before the server listens. Declared as a boot conversion in the upgrade suite.
- `type=reintegration` (`IN` of two stored types) reads each type in index order and merges in the handler, so it also avoids a filesort.
- Writes:
  - `recordArticleView` and `addFabricatedViews` (`article-views.ts:~113,~147`) increment the matching column in the same executor or transaction as the daily upsert.
  - Both scheduler and instant boost go through `addFabricatedViews`.
- Reads:
  - `articles.get.ts:76-99` uses `articles.view_total` and drops the correlated subquery and the `COUNT` for `sort=views`.
  - `[slug].get.ts:35`, the admin list and `export-csv` read the columns.
- Guards:
  - `tests/correlated-subquery-qualification.test.ts` is updated.
  - New `tests/view-totals-integrity.test.ts` checks that totals equal the daily sums after record, instant boost and gradual boost (via `view-boost-integration`).
- Honesty invariant: real and fabricated stay separate columns, and public APIs expose only what they expose today.
- Cascade deletes remove the article row together with its totals, so the invariant holds.

**D8. Analytics hot rows**
- In `analytics-ingestion.ts`, run every dedupe insert first, then the bucket upserts with `total` FIRST (placing it last, as first designed, raised deadlocks sharply under load: the auto-increment clustered key makes each upsert hold a lock at the end of the primary key until commit, so a shared first row queues concurrent page views instead of deadlocking them). The NOC aggregate stays after commit. The ingestion transaction is retried up to 3 times on `ER_LOCK_DEADLOCK`. Root fix for the residual deadlocks (follow-up): give the two live analytics tables their natural key as primary key.
- Measure with an `autocannon` run against `/api/analytics/page-view` on the dev stack, before and after, reading `innodb_row_lock_time` from `SHOW GLOBAL STATUS`.
- Record the numbers in `docs/decisions/data-layer.md`.
- Batching is a follow-up only if p95 exceeds 50 ms.

### 2D. Front-end structure

**D-MODAL**
- `app/components/admin/AdminModal.vue`:
  - Props: `open`, `title`, `busy`, `size`.
  - Slots: `default`, `footer`.
  - Behaviour: `role="dialog"`, `aria-modal`, `aria-labelledby`, Escape blocked while `busy`, Tab trap, `inertOutside`, focus return.
  - It is built on `app/utils/focus-return.ts`, like `ConfirmModal.vue`.
  - Stacking: it uses a z-index below `ConfirmModal`, so a confirm can open on top of it.
- Migrate the 17 overlays:
  - `content/content-types.vue:502`
  - `content/categories/index.vue:467`
  - `content/pages/index.vue:163`
  - `content/pages/[id].vue:152` (meta modal; palette and versions at `:125`/`:184` are drawers and are named exemptions if they are not modal)
  - `users/index.vue:349,382`
  - `media-portal/categories.vue:276`
  - `SubmissionDetailModal.vue:176`
  - `ContentTypePicker.vue:116`
  - `AiServicesTab.vue:219`
  - `AiProvidersTab.vue:824,864,901,937,969`
- New guard `tests/admin-modal-dialog.test.ts`: every `fixed inset-0` in `app/pages/admin` and `app/components/admin` either renders inside `AdminModal`/`ConfirmModal` or has `role="dialog"`, or is in a named exemption list with a reason (`builder/PropertyPanel.vue:11`, `layouts/admin.vue:354`).

**D10. Moderation UI**
- `AiModerationTab.vue` becomes a small summary: pending count and active rules count, from existing endpoints, plus a link.
- The duplicated rule and queue actions are removed from that component.
- Deleting the file entirely is a user-approved step. If not approved, it stays as the summary component.
- `tests/admin-error-retry-ui.test.ts` and `skeleton-loading-ui.test.ts` entries for it are updated.

**D-FETCH**
- `app/composables/adminFetch.ts`: `adminFetch<T>(url, opts)`. It wraps `$fetch` with the response type, so there is no cast at call sites. The response type is an unchecked assertion kept in one place, not compiler-checked against the route. It rethrows the error unchanged, so `errorMessage()`/`errorStatus()` at the caller still read the server-authored message and tell 401 from 403.
- `useAdminList<TItem, TFilters>()`: page, filters, items, total, loading, error (message + status), `reload()`, and abort of stale requests (abort plus a generation counter, because ofetch's aborted request rejects with a `FetchError`, not an `AbortError`). A reply whose page is past the last page triggers at most one follow-up request per user action.
- Pilot pages: `admin/comments/index.vue`, `admin/readers/index.vue`, `admin/chatbot/sessions/index.vue`.
- Each pilot page keeps its own template error block with `role="alert"` and a retry button bound to `reload`. That keeps the grep guards `tests/admin-error-retry-ui.test.ts` and `skeleton-loading-ui.test.ts` green, per the split-guard memory: error/retry/alert stay in the parent.

### 2E. Back-end structure

**D5. Validation**
- Add `zod` to `dependencies`. The `npm audit` gate covers it.
- New `server/utils/request-body.ts`:
  - `readJsonBody(event)`: on invalid JSON or a non-object body, 400 `{ statusMessage: 'Dữ liệu gửi lên không hợp lệ' }`.
  - `readValidated(event, schema)`: 400 naming the first issue path.
- New guard `tests/request-body-baseline.test.ts` counts the files under `server/api/**` that use the bare forms `readBody(event).catch(() => ({}))`, `.catch(() => null)` and uncaught `readBody` against a checked-in list.
  - The list holds today's files: 133 call sites in 133 files. *(As shipped: 138 — the guard header in `tests/request-body-baseline.test.ts` explains the difference.)*
  - A new file using a bare form fails the test.
  - Removing a file from the list is always allowed (ratchet).
- CLAUDE.md "Quy ước tầng dữ liệu" gets one line: new endpoints use `readValidated`.

**D-SHARED**
- Move `app/utils/blocks/registry.ts`, `app/utils/blocks/types.ts` and `app/utils/submission-status.ts` to `shared/blocks/registry.ts`, `shared/blocks/types.ts` and `shared/submission-status.ts`.
- `app/utils/...` keep one-line re-exports, so the ~many app imports and Nuxt auto-imports are untouched.
- Server imports point at `shared/`. These are the 11 files at 7dfed8c:
  - value imports:
    - `server/utils/page-versions.ts:1`
    - `server/api/admin/pages/[id]/blocks/index.post.ts:3`
    - `server/services/submission-workflow.ts:35`
    - `server/api/admin/submissions/bulk-status.post.ts:3`
    - `server/api/admin/submissions/index.get.ts:7`
  - type imports:
    - `server/db/schema.ts:7-8`
    - `server/db/seed.ts:5`
    - `server/services/universal-translation.ts:8`
    - `server/services/languages.ts:13`
    - `server/services/stored-html-sanitize.ts:5`
    - `server/utils/sanitize-html.ts:1`
    - `server/api/admin/pages/[id].get.ts:1`
    - `server/api/admin/pages/[id]/publish.post.ts:4`
    - `server/api/public/pages/[slug].get.ts:6`
  - Re-run `grep -rn "app/" server/` before the PR, since the list may have grown.
- New guard `tests/server-no-app-imports.test.ts`: no file in `server/` imports from `app/`, value or type.
- Run `db:drift` and typecheck.

**D-SPLIT. Seams for the 4 services**
- Before each split:
  - grep `tests/` for the file path and identifiers, since source-guard tests may pin the file;
  - add missing behaviour tests for the public functions being moved.
- `media-portal.ts`: (a) item CRUD + audit, (b) thumbnail resolution (R2 list + local fallback), (c) public projection.
- `video-processing.ts`: (a) process runner + FFmpeg arg builders, (b) transcode pipeline + progress, (c) on-demand extraction (`extractThumbnailOnDemand`).
- `comments.ts`: (a) public posting + pre-moderation, (b) reply notifications/e-mail (Wave 1 ordering), (c) admin moderation actions, (d) admin replies.
- `chunked-upload.ts`: (a) session lifecycle, (b) chunk receipt + union, (c) completion fencing.
- Each original path keeps a barrel re-export, so callers and the `tests/reader-audit-atomicity.test.ts` lists (`AUDITED_SERVICES`, `SERVICE_POOL_AUDIT_EXEMPTIONS`) resolve.
- The guard lists are updated in the same PR when a function's file changes.

### 2F. Tests, ops and CI

**D-UPGRADE**
- New suite `tests/schema-upgrade-integration.test.ts`, registered in the CI matrix; the Wave 1 guard enforces it.
- Fixture: a schema-only dump of the **previous release tag**, checked in as `tests/fixtures/schema-prev.sql`.
  - It is generated by a script `scripts/snapshot-schema.ts` against a DB booted from that release.
  - It is refreshed per release by a documented step.
  - `migrations/*.sql` carries a guard against accidental execution, so the fixture lives under `tests/fixtures/`.
- Seeding: insert 2–3 rows into every table that has an `ensureColumn`/`modifyColumn`/`ensureIndex`/FK step in `migrations-additive.ts`. The list is derived by parsing that file in the test, so new migrations are covered automatically, or fail asking for seed rows.
- Declared conversions: these are the boot writes that exist at `main` 7dfed8c. Each is listed in the test with its reason. They are allowed to change rows on boot 1 and must change nothing on boot 2.

  | Location | What it writes | Reason |
  |---|---|---|
  | `migrations-additive.ts:255, 298` | backfill `WHERE col IS NULL` | fills new columns |
  | `:381-388` | `chatbot_settings.mode = 'ai'` | guarded by `!modeColumnExisted` |
  | `:397-399` | NULL on dangling `updated_by`/`author_id`/`reviewer_id` | repairs orphans before the FKs |
  | `:400-409` | `INSERT IGNORE` "Legacy question N" stubs | orphan terms need a parent row |
  | `:565` area | media-category conversion | Wave 0; keyed on the legacy FK |
  | `:755-764` | hotline label rewrite | only when the label equals the old text |
  | `:807-880` | `repairLegacyMediaUrls` | probe-guarded; ambiguity fix in D-SCAN |
  | `:903` | `short_id` backfill | fills a new column |
  | this wave | view-total reconcile + generated→plain conversion (D6) | writes only articles whose totals differ from daily sums; conversion only while a generated column exists |
  | this wave | credential envelope conversion (D-SECRETS) | runs while the value is not yet an envelope |

  The seed (`seed.ts`) runs in the same boot. Its resurrection of deleted defaults is fixed by D7, and the test asserts it.
- Assertions:
  - After boot 1: rows are unchanged, except in declared conversions.
  - After boot 2: there is no change at all, compared with `CHECKSUM TABLE` or an ordered `SELECT`.

**D-COVERAGE**
- `npm run test:coverage` gains `--test-coverage-include='server/**/*.ts' --test-coverage-include='shared/**/*.ts' --test-coverage-include='app/utils/**/*.ts' --test-coverage-include='app/composables/**/*.ts'`, with `schema-tables` excluded.
- Record the result in `docs/test-coverage-baseline-2026-10.md` as a new dated section. The earlier "65.7 %" figure has no source in the repo; note that the existing doc says 74.8 % unit-only, loaded files only.

**D-OFFSITE**
- Verify the Drive upload in `backup.ts:362-381` runs for scheduled runs, which the review says it does.
- Add an off-site status to `backups`:
  - check the schema first;
  - if absent, add `offsite_status VARCHAR(16) NULL` via `ensureColumn` + `schema.ts`;
  - values `uploaded|failed|none`.
- `BackupSettingsPanel.vue` gets a warning when auto backups are on and Drive is off.
- `manage.sh`:
  - New menu item "Cài cron sao lưu". It prints the exact lines and installs them idempotently only after confirmation.
  - New item "Xuất .env đã mã hoá": `openssl enc -aes-256-cbc -pbkdf2 -iter 200000` with a passphrase prompt, writing `.env.enc` for the operator to download.
- Document both in `production/README.md` and `DEPLOY.md`.

**D-LOG**
- `docker-compose.yml` app `logging: driver: journald` with `tag: cdkt-app`.
- `production/README.md` documents `journalctl CONTAINER_TAG=cdkt-app` and the host retention (`SystemMaxUse=` in `journald.conf`).
- Precondition: the host runs systemd-journald. `manage.sh` Deploy checks for it and falls back to `json-file` with a printed warning.

**D-ALERT**
- New `server/utils/ops-alert.ts`, called from `logger.ts` when an event is in `ALERT_EVENTS` (a subset of `SECURITY_EVENTS`):
  - `backup.restore_failed`
  - `backup.restore_refused`
  - `auth.mfa_challenge_locked`
  - `security.link_host_rejected`
  - `security.cross_site_refused` (rate-limited harder)
  - `backup.slot_abandoned`
  - `db.migration.media_category_fk_blocked`
- Sending is fire-and-forget through `mailer.ts`. There is an in-memory rate limit, plus the shared store when available.
- `OPS_ALERT_EMAIL` goes into compose `environment:` and the `manage.sh` prompt.
- The logger must not recurse: the alert path logs with a flag that skips alerting.

**D-DOCS**
- `production/README.md`:
  - a non-root deploy user section (create the user, add it to the `docker` group, put a `restrict` key in `authorized_keys`, update the GitHub secrets);
  - recommended `MYSQL_MEM_LIMIT`/`APP_MEM_LIMIT` per RAM size (`npm run check:resources` output);
  - both are labelled as user actions.

## Risks / Trade-offs

- **[Risk] The origin gate blocks a legitimate integration that posts cross-site.** → None is known; grep for external POST callers. Every refusal is logged with its origin host, so a false positive is visible at once.
- **[Risk] MFA enforcement locks out an operator.** → 14-day grace, an env kill switch, SuperAdmin factor reset, and mandatory recovery codes.
- **[Risk] Encryption conversion runs with the wrong secret and makes credentials unreadable.** → Conversion only encrypts; it never decrypts and re-encrypts. An undecryptable value is never overwritten. The Wave 1 pre-deploy dump holds the plaintext copy, to be handled as sensitive.
- **[Risk] The generated column trips `db:drift` or Drizzle.** → The drift parser is extended in the same PR. Fallback: drop the generated column and use `(view_total_real + view_total_fabricated)` with an index on both columns. That is slightly slower, and the decision is recorded.
- **[Risk] The shared/ move breaks Nuxt auto-imports.** → The re-export shims keep `app/utils` paths. Typecheck and build are the gates.
- **[Risk] Service splits break source-guard tests.** → Grep the guards first. Barrel re-exports. One service per PR.
- **[Risk] journald is missing on the VPS.** → The `manage.sh` check falls back with a warning.
- **[Trade-off] Allowing requests with no Origin and no Sec-Fetch-Site.** Very old browsers get no CSRF protection beyond SameSite=Lax.

## Migration Plan

- **Order:**
  1. 2F (upgrade suite, coverage), first, so later schema work is covered.
  2. 2A (security).
  3. 2B (data).
  4. 2C (performance).
  5. 2E (shared modules, then validation, then service splits).
  6. 2D (front end).
  7. Ops docs.
- **Schema additions** are additive (`ensureColumn`/`ensureIndex`). Each one is covered by the upgrade suite before merge.
- **Preconditions for specific items:**
  - D-PLAIN requires operator confirmation that the Wave 1 excerpt backfill was applied.
  - D1 enforcement starts only when a SuperAdmin switches the policy on.
- **Rollback:** revert the PR. Two items do not revert cleanly and have an explicit rollback note in their PR:
  - the credential envelopes need a reverse migration, or re-entry of the credentials;
  - the view-total columns stay; they are harmless when unused.
