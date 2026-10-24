# Tasks

> **Preconditions**
> - `fix-media-category-wipe-on-boot` is merged and deployed.
> - One PR per group, in the order 1 (1D) → 2 (1A) → 3 (1B) → 4 (1C).
>
> **Rules**
> - Scope is the files named in design.md for that group.
> - Write the test first and confirm it fails on current code, then fix.
> - Do not commit or push without the user's explicit request.
> - Every deploy-affecting task updates `production/` in the same group.
> - Each group ends with `npm test`, typecheck and `npm run lint` (0 errors), plus `npm run db:drift` when the schema changes.

## 1. Group 1D — CI, deploy, ops (ship first)

- [x] 1.1 Pre-deploy dump (design D26).
  - Add an optional dump-name prefix to `scripts/backup-db.sh` and keep its verify step.
  - In `scripts/deploy-remote.sh`, call it before `set_image` and abort on non-zero.
  - Rotate `cdkt-predeploy-*` to 5.
  - Add the `manage.sh` `cmd_update` prompt (default Y) and document it in `production/README.md`.
  - Verify: extend `tests/ops-scripts.test.ts` so the dump call precedes `set_image` and a failure exits before any `docker compose up`.
- [x] 1.2 Docs-only deploy skip (D27).
  - The `changes` job gets a `deploy` output for push (fetch full history; base = the commit live in production — health version, else the last successful deploy run; unknown base, non-ancestor or diff failure means `true`).
  - `image` is gated on it, and `deploy` uses `needs.image.result == 'success'` instead of `if: true`.
  - Verify: `tests/ops-scripts.test.ts` assertions for the output, the gates and the regex `\.md$|^docs/|^openspec/`.
- [x] 1.3 Health endpoint plus version (D28).
  - Add `server/api/public/health.get.ts` (DB ping, 2 s timeout, `no-store`, 503 on failure).
  - Add `ARG/ENV APP_VERSION` as the last Dockerfile layer, and the CI `build-args`.
  - Verify: a behaviour test with a fake pool (ok → 200 + version; throw → 503, `Cache-Control: no-store`).
- [x] 1.4 Smoke step in the `deploy` job (D28).
  - Use `VPS_SMOKE_URL`, cache-bust, 12×10 s retries and compare versions. If the variable is unset, emit a warning annotation and do not fail.
  - Document the variable in `CI-CD.md` and `production/README.md`.
  - Verify: an ops-scripts assertion that the step exists and compares the version.
- [x] 1.5 `wait_healthy` fails fast when `RestartCount` > 2 (D29).
  - Verify: an ops-scripts assertion. If feasible, add a stubbed-docker shell test that returns a rising RestartCount and expects non-zero within 3 polls.
- [x] 1.6 Graceful stop (D30).
  - Set app `stop_grace_period: 45s` in `docker-compose.yml`.
  - Add a `close` hook calling `stopBackupScheduler` in `server/plugins/backup-scheduler.ts`.
  - Verify: an ops-scripts assertion (grace > 30 s) and a source check for the hook.
- [x] 1.7 Image retention (D31).
  - Prune by tag in `deploy-remote.sh`, keeping the running image + 5 and excluding `cdkt-rollback/app`. Add the disk warning above 80 %.
  - Add the same prune to the `manage.sh` Update path.
  - New `.github/workflows/ghcr-retention.yml` (keep 20, `sha-*` only, action pinned by SHA, `packages: write`).
  - Correct `CI-CD.md:442`.
  - Verify: ops-scripts assertions (no bare `image prune -f` as the only prune; the keep-count is present).
- [x] 1.8 Dockerfile layer order (D32).
  - Move `apk`/`tzdata` before the app COPYs, use `COPY --chown`, and stop the recursive `chown /app`.
  - Make the chown in `fix_uploads_ownership` and `docker-entrypoint.sh` conditional on the owner.
  - Verify: a new guard test plus a local `docker build`. Put the `docker history` layer sizes in the PR description, with the app-sized layer no longer present.
- [x] 1.9 Add `.github/dependabot.yml` (npm, github-actions, docker; weekly; grouped; limit 5) (D33).
  - Verify: the file parses as YAML in a small test, and `CI-CD.md` notes batch merging.
- [x] 1.10 CI matrix guard (D34).
  - New `tests/ci-integration-matrix.test.ts`.
  - The skip-check step parses the tee'd log instead of re-running.
  - Verify: the guard passes on the current 17 suites + the Wave 0 suite. Temporarily renaming one matrix file makes it fail; check locally, do not commit that.
- [x] 1.11 Backup ping (D35).
  - Add the `ping_healthcheck` EXIT trap in `scripts/backup-db.sh` and `scripts/verify-restore.sh`.
  - Add the `manage.sh` prompt and the `.env` line, plus a `production/README.md` section.
  - Verify: ops-scripts assertions that the ping is `|| true` and only runs when the variable is set.
  - ← (verify: group 1D end to end. Run `bash -n` on every changed script. ci.yml still has `cancel-in-progress` only for pull_request, and the deploy job still ships compose + the SHA-256 check. `production/README.md` covers dump, smoke, retention and ping.)

## 2. Group 1A — Security

- [x] 2.1 Settings allowlist plus masking (D1).
  - Derive the key list from every `'/api/admin/settings'` caller in `app/`.
  - Mask `backup_drive_service_account`, `r2_secret_key`, `media_video_r2_secret_key` and `smtp_pass` for all roles in `index.get.ts`, and in `backup.get.ts` for SuperAdmin too.
  - Verify: new `tests/admin-settings-get-masking-behavior.test.ts`. Editor and SuperAdmin get no `private_key` substring, an unknown key is absent, and each page's keys are present. Update `tests/backup-settings-ui.test.ts` if it asserts the raw value.
- [x] 2.2 Submission recipients (D2).
  - Published + visible only; flat rows only for pages that have no published tree; narrowed query.
  - Strip `recipientEmail` from the public page projection (recursive + translations).
  - Verify: new `tests/submission-recipient-published-only.test.ts` (draft-only, hidden subtree, stale flat row, published honoured), plus a public page test asserting no `recipientEmail`.
- [x] 2.3 Link policy (D3).
  - New `shared/link-policy.ts`.
  - Write path: `sanitizeBlockData`/`normalizeBlocks` driven by the registry's `type: 'url'` fields, including array subfields.
  - Read path: blank unsafe values.
  - `navigation.put.ts`, `normalizeNavItem`, and the `href` bindings in `LinksBlock.vue` and `HeroBlock.vue`.
  - Verify: new `tests/security-block-link-schemes.test.ts` (javascript/data/vbscript/`//`/entity/tab variants nested in containers and translations, plus the allowed forms). Extend `tests/nav-config-boundary.test.ts`.
- [x] 2.4 Reader logout revocation (D4).
  - Verify: a `tests/reader-session-boundary.test.ts` case. Sign in, log out, and the replayed token resolves as anonymous; anonymous logout writes nothing.
- [x] 2.5 `server/utils/request-secure.ts` used by the 4 cookie sites (D5).
  - Verify: new `tests/cookie-secure-flag-behavior.test.ts` covering production with no header (Secure), development with an untrusted https header (not Secure), and production with trusted http (not Secure).
- [x] 2.6 Run the E2E admin login and reader flows against a production build on port 3123.
  - Verify: `npm run test:e2e` green, which confirms the Secure cookies work on localhost.
  - Check `ss -ltn` before and after, and confirm no leftover `cdkt_e2e_*` databases.
- [x] 2.7 Reply e-mail after moderation, plus neutral subject (D6).
  - Verify: new `tests/comment-email-after-moderation.test.ts`. A blocked reply gets no `sendReplyEmail`; a clean reply gets one; a moderation error gets none plus the log line; the subject contains no display name.
- [x] 2.8 Reserved display names (D7).
  - Verify: extend `tests/reader-profile.test.ts` with exact, case/diacritic variants, zero-width, bidi, and "Adminh" accepted.
  - ← (verify: group 1A. Every new test fails on the pre-change code. `tests/admin-handler-authorization.test.ts` and `tests/security-translation-html.test.ts` still pass. No secret value appears in any test snapshot or log.)

## 3. Group 1B — Data integrity

- [x] 3.1 Analytics purge (D8).
  - Single-table batched DELETE, per-step `try` + log, and update the fake-pool test.
  - New `tests/analytics-maintenance-integration.test.ts`, added to the CI matrix (both env blocks; the 1.10 guard enforces it).
  - Verify: the integration suite is green on local MySQL, and the fake-pool guard rejects multi-table DELETE + LIMIT.
- [x] 3.2 Backup scheduler (D10).
  - Slot computation, hour 0, failed-attempt backoff (3 × 60 min), `backup.slot_abandoned`.
  - The plugin boots in production unless the env says off; `schedulerDisabledByServer` in `backup.get`, plus a notice in `BackupSettingsPanel.vue`; update the compose comment.
  - Verify: new table-driven `tests/backup-scheduler-due.test.ts`, plus a UI test that the notice renders when the flag is true.
- [x] 3.3 Orphan archives and the failed-row filename (D11).
  - Verify: a `mock.module` test of `runBackup` with a fake tar that fails on the second archive. No stray file remains in the temp dir, and the failed row names the media archive.
- [x] 3.4 Streamed backup download (D12).
  - Verify: extend `tests/backup-access.test.ts`. A temp file gets a stream with `Content-Length`, a directory gets 404, and a static guard confirms no `readFile` in `server/api/admin/backup/`.
- [x] 3.5 Remove the livestream hard delete (D13).
  - Verify: extend `tests/livestream-chat.test.ts`. An auto-hide verdict triggers no `delete` and the row remains.
- [x] 3.6 Seed ordering (D14).
  - Verify: a source or behaviour test that the `home_sections` seed upsert sets nothing except a no-op.
- [x] 3.7 Excerpt repair script (D15).
  - `server/services/stored-plaintext-decode.ts`, `scripts/decode-stored-excerpts.ts`, and the `package.json` `db:decode-excerpts` entry.
  - Document it in `production/README.md` (preview → backup → apply) and in the CLAUDE.md plain-text bullet.
  - Verify: new `tests/stored-plaintext-decode.test.ts`. The plan is pure, the second run is idempotent, `R&D` is untouched, a truncated tail is listed, and `updated_at` is preserved; the last check is a SQL assertion through the MySqlDialect + node:sqlite harness.
  - ← (verify: group 1B. The `docs/CHANGELOG.md` entries exist. The new integration suite is in the matrix. No change touches `content` columns.)

## 4. Group 1C — Performance and front end

- [x] 4.1 Rate-limit purge loop on its own timer, plus the view IP ceiling (D16, D17).
  - Verify: extend `tests/rate-limit-store.test.ts`, where 12 000 rows are purged in one run with the cap respected. Extend `data-retention.test.ts` so a throwing scope does not stop the purge. A new view-endpoint behaviour test confirms the 61st view from one IP in 10 min is not counted and still returns 202.
- [x] 4.2 Article composite indexes (D18).
  - Declare them in `schema.ts`, `schema-tables/content.ts` and `ensureIndex`.
  - Verify: a guard test on the same names in all three. `npm run db:drift` green. A local `initDb()` on an existing dev DB creates them; check with `SHOW INDEX`.
- [x] 4.3 Thumbnail extraction bounds (D19).
  - Verify: a fake-runner test. 10 parallel calls make 1 spawn, a hung runner is aborted at 15 s (use fake timers or a short injected timeout), a failure is negative-cached, a partial file is removed, and concurrency is capped at 2.
- [x] 4.4 Live polling (D20).
  - Verify: a source guard for `visibilitychange` in `LiveTickerBar.vue` and `LiveHero.vue`, and no interval when `isOnMedia`. A unit test of the 3 s cache in `services/livestream.ts`, including invalidation on start and stop.
- [x] 4.5 Hero buttons (D21).
  - Verify: a `_render-sfc-template` test of `HeroBlock.vue` (vi + en). An edited value renders, empty text hides the button, old defaults show today's labels, and an unsafe link is blanked.
- [x] 4.6 Focus rings in the 13 files listed in D9 (white ring on the two dark backgrounds).
  - Verify: extend `tests/focus-ring-contrast.test.ts` (or a sibling) to forbid `focus*:…-[#7CB342]` across `app/`.
- [x] 4.7 Single `<h1>` (D22).
  - Verify: new `tests/e2e/public-single-h1.spec.ts` green over the listed routes. `tests/vietnamese-diacritics-clipping.test.ts` still passes for the header brand.
- [x] 4.8 Carousel, ticker motion and new i18n keys (D23).
  - Verify: source guards (`prefers-reduced-motion`, the pause button with an `aria-label`, `motion-reduce:animate-none`), and a render test that the pause button exists. The i18n keys are present in the seed and the fallback dictionary.
- [x] 4.9 Chat widget focus (D24).
  - Verify: new `tests/chat-widget-dialog-a11y.test.ts` (source guards for `createFocusReturn`/`inertOutside`, the window Escape, and the visible-first focus). Run the existing e2e chat specs and keep them green.
- [x] 4.10 Most-read language key (D25).
  - Verify: a source guard that the key includes the language, plus the `useAsyncData` key-shape test pattern.
  - ← (verify: group 1C. `openspec/ui-dna.md` was read and the PR description says so. No `leading-none`/`leading-tight` was added inside a clipped uppercase element. `tests/skeleton-loading-ui.test.ts` and `tests/admin-error-retry-ui.test.ts` still pass. E2E green.)

## 5. Docs (folded into the PR of the group that changes the fact)

- [x] 5.1 Correct the repo visibility (PUBLIC) in CLAUDE.md and `CI-CD.md:42`, plus the counts (171 / 209 / `useI18n.ts` 265) and the `scripts/check-resources.sh` header (D36). Ship in group 1D.
  - Verify: grep shows no remaining "đã chuyển private" claim.
- [x] 5.2 Each group adds its `docs/CHANGELOG.md` section and updates the CLAUDE.md checklist bullets it affects: settings masking, link policy, reader logout, backup scheduler default, pre-deploy dump, docs-only skip, health endpoint.
  - Verify: the bullets stay checklist-style; long narrative goes to `docs/decisions/*.md`.
  - 1D part done (CHANGELOG § 27; CLAUDE.md CI bullet + "Deploy — checklist" bullets for pre-deploy dump, docs-only skip, health endpoint). Stays open for 1A/1B/1C.
