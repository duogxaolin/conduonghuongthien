# Design

## Context

See proposal.md for motivation and the item list. The specs under `specs/` are the behavior contracts. This document records the technical choices that the specs leave open, group by group.

Every finding was verified read-only at `main` 7dfed8c (2026-10-23 review). Everything an implementer needs is in proposal.md, this file and the specs; there is no external notes file.

**Constraints from CLAUDE.md that apply throughout:**
- **Do not add logic to `app/layouts/default.vue` or `server/db/init.ts`.**
- **Deploy-affecting changes update `production/` in the same PR.** That means compose, Dockerfile, scripts, env and healthcheck changes. Any new app env variable must also be listed under `environment:` in `docker-compose.yml`, because compose has no `env_file`.
- **Audit writes go inside the same transaction as the change they record.** The guard is `tests/reader-audit-atomicity.test.ts`.
- **SQL is always parameterised.** Integer literals in SQL go through `intervalDays()`. Never use `sql.raw` with user data.
- **The front-end error contract stays:** `errorMessage()`, and error/retry/`role="alert"` kept in the parent file.
- **Tailwind utilities only.** Focus ring colour is `#4A6741`. UI work reads `openspec/ui-dna.md` first.
- **Do not use `leading-none` or `leading-tight` inside clipped uppercase text.** The Vietnamese stacked diacritics get cut.
- **No commit or push without the user's explicit request.**

**Shipping order is 1D → 1A → 1B → 1C.** 1D goes first because it adds the pre-deploy dump and the docs-only deploy skip, and every later merge then benefits from both.

## Goals / Non-Goals

**Goals**
- Every item fixed at its root, with a test that fails on the old code.
- Each group is an independently reviewable, independently deployable PR.

**Non-Goals**
- **No refactor of the 171 legacy `getDb()` endpoints.**
- **No input-validation library.** That is wave2.
- **No CSRF origin gate, MFA enforcement or secret encryption at rest.** All wave2.
- **No colour tokens or file splitting.** Both wave3.
- **No changes to seed resurrection of deleted defaults.** That is wave2 D7; only the `display_order` overwrite is fixed here.

## Decisions

### 1A — Security

**D1. Settings read is an allowlist derived from its callers.**
- The allowlist is the union of keys read by the five pages that call `GET /api/admin/settings`: `general`, `email`, `media-storage`, `media-portal` and `tracking`. It also includes any composable or other caller found by grepping `'/api/admin/settings'` in `app/`.
- The allowlist lives in one exported constant next to the handler, and a test pins it.
- Masking uses the existing `MASKED_SECRET` from `shared/settings-credential-rules.ts`, for every role.
- `backup.get.ts` masks for SuperAdmin too. The backup settings textarea then shows `********`, and `backup.put.ts:127,149-152` already keeps the stored value on the mask.
- *Rejected: extending the deny-list.* That is the very failure mode we are fixing: any new secret key leaks by default.

**D2. Submission recipients mirror the public read rule.**
- `collectFromTree` skips a node with `isVisible === false` together with its whole subtree.
- `draftBlocks` is never read.
- Flat `page_blocks` rows are read only for pages whose `published_blocks IS NULL`, and only where `is_visible` is true.
- The query selects only `id` and `published_blocks` for pages, plus the flat rows filtered by block type.
- `recipientEmail` is removed in the public projection of `pages/[slug].get.ts`, recursively and inside `data.translations[*]`. It is not removed from storage.
- Test: `tests/submission-recipient-published-only.test.ts` (fake db, real handler).

**D3. One link policy shared by server and app.**
- New module `shared/link-policy.ts`, with a pure `safeLinkOrNull(value)` and `assertSafeLink(value, field)`.
- Normalisation before the scheme test:
  1. Decode HTML entities (`decodeHtmlEntities` from `server/utils/decode-html-entities.ts`). If that module cannot be imported from `shared/`, copy only the numeric and named decode it needs, with a test that both agree.
  2. Strip ASCII control characters and whitespace.
  3. Lowercase.
- Allowed forms: `/x` (but not `//`), `#…`, `http:`, `https:`, `mailto:`, `tel:`.
- Write side:
  - `sanitizeBlockData` learns the link fields from the registry, meaning fields with `type: 'url'`, including array item subfields (`links[].url`).
  - `normalizeBlocks` in `page-versions.ts` throws a 400 naming the field.
  - `navigation.put.ts` reuses `assertSafeLink`, which closes the `//` hole.
- Read side:
  - `public/pages/[slug].get.ts` already re-runs `sanitizeBlockData`, which now also blanks unsafe links in legacy rows.
  - `normalizeNavItem` uses `safeLinkOrNull`.
- Render side: `LinksBlock.vue` and `HeroBlock.vue` bind `href` through the same helper, as defence in depth.
- *Rejected: render-side only.* Stored bad data would still reach other consumers, such as the JSON API and future renderers.
- Image fields (`type: 'image'`) are out of scope here. They go into `src`, which does not execute script.

**D4. Reader logout revokes sessions.**
- `logout.post.ts` resolves the reader with `optionalReader`. If one is found, it bumps `reader_accounts.token_version` (the same column `services/readers.ts:255` bumps on ban), then clears the cookie.
- No audit row, because readers have no audit trail today. The behaviour mirrors admin logout.

**D5. One `isSecureRequest(event)` helper.**
- New file `server/utils/request-secure.ts`.
- It follows the logic of `google-oauth/config.ts:60-80` (`forwardedTrusted`):
  - The forwarded proto is used only when the peer is a trusted proxy (`client-ip.ts` rules).
  - In production the default is `true`, unless a trusted proxy said `http`.
- All four call sites use it.
- E2E: Chromium treats `http://localhost` and `127.0.0.1` as potentially trustworthy and accepts `Secure` cookies there, so the E2E login on port 3123 keeps working. Task 1A.6 verifies this.

**D6. Reply e-mail after moderation.**
- In `comments.ts`, the reply path awaits `checkAndModerateContent` (already called; currently `void`) **before** `sendReplyEmail`, and sends only when the result is not blocked or hidden.
- The comment insert and in-app notification still commit first. Only the e-mail waits.
- The moderation call is bounded by its existing timeout. On error or timeout: log `comment.reply_email_held` and do not send.
- The subject for a non-admin reply becomes a fixed neutral string: "Có người trả lời bình luận của bạn". The name stays in the body, rendered as text.
- *Rejected: an outbox table.* It would be more robust, but it is a new table plus a worker. If e-mail volume grows, wave2 can revisit it.

**D7. Display-name folding.**
- The fold:
  1. NFKC.
  2. Remove the categories `Cf` (zero-width, bidi) and `Mn` after NFD, which strips the diacritics.
  3. Map `đ` to `d`.
  4. Lowercase.
  5. Collapse non-letters to single spaces.
- The reserved terms are listed in spec `reader-display-names`.
- Matching is on whole words: equal to the term, or the term followed or preceded by a space.
- Any `Cf` character in the raw input is rejected outright.
- The rule applies to reader-chosen names only (`renameReader`). Google-provided names are display data we do not control. Applying the rule to them at sign-in would lock real people out, so that is deferred to wave2 with a decision.

### 1B — Data integrity

**D8. Analytics purge.**
- The new raw-event statement is a single-table delete: `DELETE FROM analytics_page_view_events WHERE occurred_at < ? AND event_day IN (SELECT day FROM analytics_maintenance_runs WHERE status = 'complete') LIMIT ?`. MySQL allows this because the subquery reads a different table.
- Each table purge runs in its own `try`, and each failure logs `analytics.retention_step_failed` with `{ step, code }`.
- A new real-MySQL suite, `tests/analytics-maintenance-integration.test.ts`, joins the matrix (see the ci-pipeline spec). It covers three cases: old aggregated events purged, old unaggregated events kept, and a recent event kept. It also checks that the daily tables are purged past aggregate retention.
- The fake-pool test `analytics-maintenance-retention.test.ts:45` currently matches the invalid SQL text. Update it so that it no longer pins the old statement, and add a guard that no statement matches `/^DELETE\s+\w+\s+FROM/i` together with `LIMIT`.

**D9 (1C, listed here for file inventory). Focus-ring files.**
- The files are `ArticleDetail.vue`, `ArticleComments.vue`, `pages/profile.vue`, `ChatWidget.vue`, `ReaderNotificationBell.client.vue`, `pages/news/index.vue`, `pages/legal-qa/index.vue`, `SocialBubble.client.vue`, `ModelArticlesListPage.vue`, `layout/DefaultSearchDropdown.vue`, `ContentTypeListSection.vue`, `ChatFollowUps.vue` and `blocks/RoleModelsBlock.vue`.
- Dark-background cases use `ring-white ring-offset-2 ring-offset-[#1e4620]` instead: `ChatWidget.vue:312` and `SocialBubble.client.vue:418`.

**D10. Backup scheduler semantics.**
- Replace the "stale > 36h" rule with a slot computation:
  - `lastSlot(now, days, hour)` is the most recent configured weekday-at-hour that is ≤ now.
  - Run if there is no `done` scheduled backup with `startedAt ≥ lastSlot`.
  - Count failed scheduled attempts since `lastSlot`. Below 3, retry once 60 min have passed since the last failure; at 3, log `backup.slot_abandoned` once.
- `hour` is parsed as an integer in 0..23. 0 is valid, and anything invalid falls back to 3.
- `isBackupDue` stays pure and gets a table-driven test: weekly Sunday, Monday 15:30, hour 0, failed then retry, three failures, down-at-slot catch-up.
- The plugin boots the scheduler unless `BACKUP_SCHEDULER` is `0`, `false`, `off` or `no`.
  - The admin `backup_auto_enabled` defaults off (`backup-scheduler.ts:60` requires `'true'` or `'1'`). Booting the scheduler therefore never causes an unrequested backup, and the original "conscious choice" intent is kept.
  - Development keeps today's default (off), matching the other schedulers' dev behaviour.
- `GET /api/admin/settings/backup` adds `schedulerDisabledByServer: boolean`. `BackupSettingsPanel.vue` shows a one-line notice when it is true.
- The compose comment for `BACKUP_SCHEDULER` changes to say: empty means on in production.

**D11. Orphan archives.**
- `runBackup` tracks every target path it creates in this run.
- On any failure, it unlinks each tracked path that has no `done` row. It also unlinks a partial `tar` target.
- The failed row's filename is the archive whose step threw, not a hard-coded `cdkt-media-…`.
- Rows are inserted per archive right after that archive is verified, so a later failure cannot strand an earlier success.

**D12. Streamed download.**
- `fs.stat`, then require `isFile()` (404 otherwise).
- Set `Content-Length`, plus `Content-Disposition` with an RFC 5987-encoded filename.
- Return `sendStream(event, createReadStream(path))`, and destroy the stream when the request closes.
- Add a static guard: no `readFile` in `server/api/admin/backup/`.

**D13. Livestream hard delete.** Remove the `db.delete(livestreamMessages)` line at `livestream-chat.ts:370`. `applyAutoHide` already soft-deletes it. The test asserts that no delete call happens and that the row remains.

**D14. Seed ordering.** Change `seed.ts:203-204` from `onDuplicateKeyUpdate({ set: { displayOrder } })` to an insert-ignore of missing rows (`onDuplicateKeyUpdate` with a no-op `set: { id: sql\`id\` }`), the same pattern as other seed rows.

**D15. Excerpt repair script.**
- Follow the `stored-html-sanitize.ts` pattern:
  - a pure `planPlainTextFixes(rows)`;
  - `runPlainTextFix({ apply })` with keyed batches of 200 by id;
  - `scripts/decode-stored-excerpts.ts`;
  - `package.json` `db:decode-excerpts`.
- It uses `plainTextField` semantics, meaning the gated truncation repair, so that wave2 can then remove the read-time guess.
- Each UPDATE sets `updated_at = updated_at` explicitly so `ON UPDATE CURRENT_TIMESTAMP` does not fire.
- The report lists the ids whose result dropped a trailing fragment.

### 1C — Performance and front end

**D16. Rate-limit purge.**
- `purgeExpiredRateLimits` loops `DELETE … WHERE window_expires_at <= ? LIMIT 5000` until `affectedRows < 5000` or 10 batches.
- It runs from a small interval in an existing plugin. Do not add a new plugin file if `retention-scheduler.ts` can host a separate timer that is **not** gated on `autoEnabled`, under its own named lock.
- It is removed from the end of `runDataRetention`, so another scope throwing cannot skip it.

**D17. View ceiling.**
- Add a rule `VIEW_IP_CEILING_RULE = { limit: 60, windowSeconds: 600 }`, keyed `avip:<ip-bucket>` with the `/64` bucket from `ip-bucket.ts`, via `rateLimitDeps()` and `getClientIp`.
- It is checked before the per-article dedupe. Over the limit, return 202 without counting.

**D18. Article indexes.**
- `articles_status_type_pub_idx (status, type, published_at, created_at)` and `articles_status_category_pub_idx (status, category_id, published_at, created_at)`.
- They are declared in `schema.ts` (`index()`), in `schema-tables/content.ts`, and via `ensureIndex` in `migrations-additive.ts`, because `CREATE TABLE IF NOT EXISTS` does not add them to existing databases.
- Also add a guard test that all three declare the same names, since `db:drift` does not compare indexes.
- *Not done:* `EXPLAIN` assertions in CI. Plans depend on table statistics and would be flaky.

**D19. Thumbnail extraction bounds.**
- A module-level `Map<shortId, Promise>` single-flight, cleared in `finally`.
- A global semaphore of 2.
- `AbortSignal.timeout(15_000)` passed to the runner, which already SIGKILLs on abort.
- A negative cache: `Map<shortId, expiresAt>` with a 10-minute TTL, in memory, because a restart retrying once is acceptable.
- A partial `thumb.jpg` from a killed run is deleted before the result is reported.
- Test: an injected fake `ProcessRunner` (`tests/media-portal-thumbnail-source.test.ts` pattern).

**D20. Live polling.**
- `LiveTickerBar.vue` starts its interval only when the ticker can show (`!isOnMedia`). It pauses on `visibilitychange` when hidden and fetches once when visible.
- `livestream/active.get.ts` gets a 3-second in-process cache in `services/livestream.ts` (`getActiveLivestream`). The cache is invalidated by start and stop in the same process.
- `LiveHero.vue:271` gets the same visibility pause.

**D21. Hero buttons.**
- Use the `pick()` order already used for the title and subtitle.
- `OLD_HERO_DEFAULTS` holds the previous registry default texts and links. A stored value equal to one of them counts as unset.
- The registry defaults change to today's live labels: "Về chúng tôi" / `/about` and "Gửi yêu cầu trợ giúp" / `#tro-giup`.
- The dead reads `data.btnAbout` and `data.btnHelp` are removed.

**D22. Headings.**
- `DefaultHeader.vue:24` changes from `<h1>` to `<p>` with the same classes. Its line-height and padding rules stay, per the diacritics-clipping test.
- `pages/index.vue:6` renders its `sr-only` `<h1>` only when the page has no hero block.
- Verification is a Playwright spec, `tests/e2e/public-single-h1.spec.ts`. It counts `h1` on `/`, `/news`, an article, `/about`, `/contact`, `/media`, `/legal-qa`, `/documents` and `/search?q=a`.
- Any page that still shows two `h1` after the header change is fixed in the same task. One candidate is `/media` with `LiveHero` plus `MediaDefaultHero`; those are mutually exclusive, so the e2e confirms it.

**D23. Carousel.**
- `RoleModelsBlock.vue`:
  - `autoplay` starts only if `matchMedia('(prefers-reduced-motion: reduce)')` is false.
  - A visible pause/play button with an i18n label (new keys in `default-translations-seed.ts` plus the fallback dictionary).
  - Only the pause/play button changes the user's wish. Focus inside the carousel, pointer hover, an active touch and a hidden document are transient pause reasons: focus/hover/touch resume when they end (`focusout` outside, `pointerleave`, `touchend` with no touches left), hidden resumes when visible. A touch that starts on the toggle itself is ignored as a pause reason so the tap's click decides.
  - Pressing play overrides the current focus/hover/touch pause until the next such event (APG carousel pattern: the explicit control wins); it never overrides hidden or an empty carousel.
  - Scroll behaviour is `auto` under reduced motion.
  - The arrow and dot buttons get `focus-visible` rings.
- `LiveTickerBar.vue:40` marquee gets `motion-reduce:animate-none`.

**D24. Chat widget.**
- Reuse `app/utils/focus-return.ts` (`createFocusReturn`, `inertOutside`, `trapTabTarget`), as `ConfirmModal.vue` does.
- On open, focus the first visible focusable element, using an `offsetParent !== null` check rather than a hard-coded `md:` button.
- `inertOutside` while open. A window-level `keydown` Escape listener is active only while open.
- `openFullPage` returns focus as well.
- Use one shared tabbable selector that includes `select`, `[tabindex]:not([tabindex="-1"])` and `summary`.

**D25. Most-read key.** `NewsCategoryList.vue:300-305` passes `lang` and includes it in the `useAsyncData` key, as `usePublicMostRead` does.

### 1D — CI, deploy, ops and docs

**D26. Pre-deploy dump in `deploy-remote.sh`.**
- Insert a dump step before `set_image`. It calls `scripts/backup-db.sh` with a `PREFIX=cdkt-predeploy` (new optional argument), which verifies the dump with its existing logic.
- If it is non-zero, exit before any container change.
- Rotate `cdkt-predeploy-*`, keeping 5.
- `manage.sh` `cmd_update` asks `Sao lưu DB trước khi cập nhật? [Y/n]` and calls the same thing.
- The README documents where the dumps live and how they pair with the rollback.

**D27. Docs-only skip.**
- The `changes` job, for `push`, diffs against the commit that is **live in production**, not against `github.event.before`.
  - `before` is the previous tip of `main`, not what production runs. Suppose run A is deploying, code push B is pending and docs-only push C arrives. GitHub cancels the pending B, because the concurrency group keeps one pending run. C then diffs B..C, finds docs only and skips the deploy. B's code never reaches production while CI is green. The same thing happens when B fails a flaky gate before `image` and C is docs-only.
  - C's `changes` job only starts once A has finished entirely, because pushes to `main` queue. A's deploy outcome is therefore settled when the base is read.
- The base is resolved in this order:
  - (a) If `vars.VPS_SMOKE_URL` is set, the step requests `GET <url>/api/public/health?t=<run_id>-plan` with `curl -fsSL -m 10 --retry 2`. It reads `version`, the 12-character SHA baked in as `APP_VERSION`. It accepts the value only if it is exactly 12 lowercase hex characters, then resolves it with `git rev-parse --verify "<version>^{commit}"`.
  - (b) Otherwise, or if (a) fails, returns `dev` or returns an unknown commit, the step uses `gh api` with `GITHUB_TOKEN`. The `changes` job alone gets `actions: read`. The step lists completed runs of this workflow on `main` (30 newest) and orders them by `run_started_at`, so a re-run counts from when it re-ran. It takes the `head_sha` of the first run whose `Deploy to VPS` **job** concluded `success`. A docs-only run concludes `success` with that job `skipped`, so the step checks the job, not the run.
  - (c) If neither source yields a commit, the step sets `deploy=true`.
- After a base is found, the step decides in this order:
  - If the base equals the pushed commit, it sets `deploy=false`. Production already runs it, so there is nothing new to deploy. To redeploy the same commit, use *Run workflow* on `main`; `workflow_dispatch` always deploys.
  - If the base is not an ancestor of the pushed commit (`git merge-base --is-ancestor`), it sets `deploy=true`.
  - If the diff fails, it sets `deploy=true`.
  - If the diff is empty but the commits differ, it sets `deploy=true`.
  - If the diff is non-empty and every path matches `\.md$|^docs/|^openspec/`, it sets `deploy=false`. The diff is `git diff --no-renames --name-only <base> <sha>`.
  - Any other diff gives `deploy=true`.
- Checkout uses `fetch-depth: 0` with `filter: blob:none`, because the live commit can be many commits back.
- Pull-request behaviour of `changes` is unchanged.
- (b) is a fallback. It can name a commit newer than what is live if someone rolled back by hand outside CI; (a) does not have that problem. Setting `VPS_SMOKE_URL` makes (a) the normal path.
- The `image` job gets `needs.changes.outputs.deploy == 'true'`. `deploy` changes from `if: true` to `needs.image.result == 'success'`.
- Tests:
  - `tests/ci-docs-only-skip.test.ts` runs the step's script in a throwaway git repo with stubbed `curl` and `gh`. It covers the cancelled-pending scenario and the fallbacks between (a), (b) and (c). It also covers "not an ancestor", "already live" and the pinned deploy-job name.
  - `tests/ops-scripts.test.ts` asserts the shape.

**D28. Health endpoint and smoke test.**
- New `server/api/public/health.get.ts`:
  - It runs `SELECT 1` through the shared pool with a 2 s timeout.
  - It returns `{ ok: true, version: process.env.APP_VERSION || 'dev' }` with `Cache-Control: no-store`, or a 503.
  - It must stay outside the swr rules; `/api/**` is already `cache:false`.
- `Dockerfile` adds `ARG APP_VERSION` and `ENV APP_VERSION=$APP_VERSION` as the **last** layer before `CMD`, so it does not bust the cache.
- CI passes `build-args: APP_VERSION=${{ github.sha }}` (short form computed in the step).
- `APP_VERSION` is baked into the image, not passed through compose, so the "list it in compose `environment:`" rule does not apply. The design records this to pre-empt a reviewer flag.
- The smoke step runs on the runner, after the SSH deploy succeeds:
  - It runs only if the `VPS_SMOKE_URL` variable is set; otherwise it emits a warning annotation.
  - It does `curl` with `?t=<run_id>`, 12 tries × 10 s, and requires `version` equal to the short SHA.
  - On failure the job fails. It does **not** auto-rollback, because the cause may be the CDN or DNS. The rollback runbook is printed.

**D29. Fail-fast `wait_healthy`.** Each poll also reads `docker inspect -f '{{.RestartCount}}'`. When the count exceeds 2, print the last 60 log lines and return failure, which triggers the existing rollback.

**D30. Graceful stop.**
- `docker-compose.yml` app gets `stop_grace_period: 45s`, which is greater than Nitro's 30 s shutdown timeout.
- A new close hook goes in the existing `server/plugins/backup-scheduler.ts`: `nitroApp.hooks.hook('close', stopBackupScheduler)`.
- A source guard in `tests/ops-scripts.test.ts` asserts the grace period is greater than 30.

**D31. Image retention.**
- In `deploy-remote.sh`, after a healthy deploy, list the app repository's `sha-*` tags by creation time and keep the running one plus the 5 newest. Remove the rest with `docker image rm` (never `-f`), then `docker image prune -f` for dangling layers.
- Print a warning if `df --output=pcent /var/lib/docker` is above 80.
- New `.github/workflows/ghcr-retention.yml`:
  - Runs weekly plus manually (`workflow_dispatch`).
  - Uses `actions/delete-package-versions` pinned by SHA, with `min-versions-to-keep: 20` and only `sha-*` tags.
  - Permissions are `packages: write` only.
- `CI-CD.md:442` is corrected.

**D32. Dockerfile layer order.**
- `apk add` and `tzdata` move above the first `COPY --from=builder`.
- `RUN … chown -R node:node /app /var/lib/cdkt` (line 84) is replaced by `COPY --chown=node:node` on each app COPY, plus `mkdir` and `chown` of the **empty** mount directories only.
- `fix_uploads_ownership` (`deploy-remote.sh:107-115`) and the `docker-entrypoint.sh` chown run only when `stat -c %U` of the root of that tree is not `node`.
- A guard test asserts that `apk add` precedes the first app COPY and that no recursive chown targets `/app`.
- The result is checked with `docker history` in the PR description.

**D33. Dependabot.**
- `.github/dependabot.yml` covers `npm` (root), `github-actions` and `docker`.
- Schedule is weekly, with `groups` for minor/patch per ecosystem and `open-pull-requests-limit: 5`.
- Because every merge deploys, the user should merge Dependabot PRs in batches. This is noted in `CI-CD.md`.

**D34. CI guards.**
- New `tests/ci-integration-matrix.test.ts`:
  - Lists `tests/*-integration.test.ts`.
  - Parses `ci.yml` as text: the matrix `include` file entries and the two env blocks.
  - Requires each suite's switch variable in both blocks.
- The "Fail if this suite skipped" step reads the log already written by the integration step (`tee` to `$RUNNER_TEMP/<suite>.log`) and counts `# pass`/`# skip` there, instead of re-running.

**D35. Backup ping.**
- In `backup-db.sh` and `verify-restore.sh`, add a `ping_healthcheck ok|fail` function that runs `curl -fsS -m 10 --retry 2 "$HEALTHCHECK_PING_URL[/fail]" || true`, and call it from an EXIT trap with the script's status.
- `manage.sh` Deploy/Update prompts optionally for `HEALTHCHECK_PING_URL` and writes it to `.env`. The scripts read it from the environment or from `.env` the way they already read DB settings.

**D36. Docs.**
- Correct the repo visibility in CLAUDE.md (CI section) and `CI-CD.md:42`. The text should be: currently PUBLIC; Actions minutes are not limited.
- Correct image retention.
- Fix the counts: `getDb()` 171, services imports 209, `useI18n.ts` 265 lines.
- Fix the `check-resources.sh` header ("unlimited by default").
- Add a CHANGELOG section per group.

## Risks / Trade-offs

- **[Risk] The settings allowlist misses a key a page needs, so that page shows blanks.** → The task requires grepping every caller, and a test asserts each page's keys are present. Manual check of the 5 pages in the PR.
- **[Risk] The link policy rejects odd legacy values on re-save.** Examples: `tel:` with spaces, or uppercase `HTTPS:`. → Normalisation handles case and whitespace. Legacy rows are blanked only on public read, not rewritten. Editors see a 400 naming the field on next save.
- **[Risk] Awaiting moderation delays reply e-mails by the moderation latency.** → That is acceptable for e-mail. In-app notifications are unchanged.
- **[Risk] The scheduler now boots in production by default.** → The admin switch defaults off, so no behaviour change until someone enables it. That is exactly the case that was silently broken before.
- **[Risk] The docs-only skip misclassifies a change, for example a renamed `.ts` file reported as a `.md`.** → `git diff --name-only` lists both sides of a rename. Any non-matching path forces a deploy.
- **[Risk] The smoke test fails because of the CDN, not the deploy.** → Retries, no auto-rollback, and a clear message.
- **[Risk] The Dockerfile reorder changes runtime file ownership.** → `COPY --chown` gives identical ownership. The entrypoint still fixes mounted volumes. Container start is checked in CI by the existing build and health steps.
- **[Risk] `rm` of old image tags removes a rollback target.** → It keeps 5 previous images. The rollback tag created by `manage.sh` (`cdkt-rollback/app`) is excluded by name.
- **[Trade-off] The view IP ceiling of 60 per 10 min can undercount a busy office NAT.** → It is generous. Fabricated and boost views are unaffected.

## Migration Plan

1. **1D first.** Before merging, the user creates the repo variable `VPS_SMOKE_URL`. After merge, watch the first deploy log for the pre-deploy dump, the smoke result and the prune output.
2. **1A, 1B and 1C** each merge as one PR. Each deploy now has a pre-deploy dump to roll back to.
3. **After 1B is live,** the operator runs `npm run db:decode-excerpts` (preview), reviews the trailing-fragment list, takes a backup, then runs it with `-- --apply`.
4. **Rollback:** revert the PR. Every DB change in this wave is additive: two indexes, and no column changes. Reverting needs no data migration, except the excerpt repair, which is reversible only from the pre-apply backup.
