# Proposal

> **Wave 1 of the 2026-10-23 improvement plan.** It depends on `fix-media-category-wipe-on-boot` (Wave 0) being merged and deployed first.
>
> The work ships as **four PR groups**, in this order: **1D** (pre-deploy backup and docs-only deploy skip first), then **1A**, **1B**, **1C**. The 1D order matters because every merge to `main` deploys.
>
> Evidence for every item was verified read-only at `main` 7dfed8c. File:line references are from that commit. Items that did not reproduce are listed under "Dropped".

## Why

The 2026-10-23 review found a set of confirmed defects, each fixable in under half a day. Several of them are live harm, not hygiene:

- **Secrets are exposed.** The Google service-account private key is returned to every `settings.read` holder.
- **Citizen submissions can be redirected.** A recipient e-mail planted in an unpublished page draft is accepted.
- **Stored XSS through block links.** Block link fields accept `javascript:`.
- **Analytics raw data is never purged.** The purge statement is invalid SQL, and the error is swallowed.
- **Backups do not run on the configured schedule.**
- **Deploys have no database snapshot and no real smoke test.** Every merge, docs included, rebuilds and redeploys.

Doing them together, in small PRs, raises the reviewer score from about 6.5 to about 7.4. That is the best ratio of score to effort in the whole plan.

## What Changes

### 1A — Security

**Settings GET never returns stored secrets** (`server/api/admin/settings/index.get.ts:9-24`, `backup.get.ts:26-31`)
- Replace the deny-list with an allowlist of keys the five settings pages actually read.
- `backup_drive_service_account`, `r2_secret_key` and `media_video_r2_secret_key` are masked as `********` for everyone, SuperAdmin included.
- The PUT already keeps the stored value when it receives the mask.

**Submission recipients come only from published, visible blocks** (`server/api/submissions.post.ts:106-121`)
- Drafts, hidden nodes, and stale flat rows of tree-published pages are ignored.
- The query no longer loads every page's two JSON trees.
- `recipientEmail` is stripped from the public `pages/[slug]` JSON.

**One URL policy for block and nav link fields**
- The policy is enforced on write and on public read. It allows relative paths, `#`, `http(s):`, `mailto:` and `tel:`, and rejects `javascript:`, `data:`, `vbscript:` and protocol-relative `//`.
- Affected code: `sanitizeBlockData` in `server/utils/sanitize-html.ts:220-262`, `LinksBlock.vue:13`, `HeroBlock.vue:77`, `navigation.put.ts:18-22`, and `normalizeNavItem`.

**Reader logout revokes the session** (`server/api/public/reader/logout.post.ts:15-18`)
- Logout bumps `token_version`, the same way the admin logout does.

**One shared "is this request HTTPS" rule for the `Secure` cookie flag**
- Applies to 4 call sites: `server/utils/mfa/session.ts:20-23`, `server/utils/reader-auth.ts:59-62` and the two OAuth `start` endpoints.
- Raw `x-forwarded-proto` is trusted only from a configured proxy, as in `google-oauth/config.ts:60-80`. In production the fallback is Secure.

**A comment-reply e-mail goes out only after the reply passes AI moderation** (`server/services/comments.ts:514-517`)
- Its subject no longer interpolates the reader-chosen name (`notification-email.ts:~149-155`).

**Reader display names cannot impersonate staff** (`server/utils/display-name.ts:59-88`)
- Names are checked after folding (NFKC, case, diacritics, with zero-width and bidi characters removed).
- A short reserved list of staff and authority terms is rejected.

### 1B — Data integrity

**Analytics retention actually purges** (`server/services/analytics-maintenance.ts:353-369`)
- Use a single-table batched DELETE, since multi-table DELETE plus LIMIT is a MySQL 1064 error.
- Each purge step gets its own `try` and its own log line.
- Add a new real-MySQL suite that runs the maintenance.

**The backup scheduler follows its policy** (`server/services/backup-scheduler.ts:35-61`)
- No 36-hour "stale" run on off days.
- Hour 0 is honoured.
- A failed run does not count as done; it is retried with a bounded backoff.
- The scheduler boots in production by default. The admin toggle, which defaults off, is the deliberate switch, and `BACKUP_SCHEDULER=0` still disables it.
- The admin page shows when the server has the scheduler disabled.

**A failed backup leaves no orphan archive** (`server/services/backup.ts:105-125, 325, 354-356`)
- A partial or unregistered archive file is deleted.
- The failed row names the archive that actually failed.

**Backup download streams the file** (`server/api/admin/backup/[filename].get.ts:26`)
- No more whole-file `readFile`, which fails above 2 GiB.
- Set `Content-Length`, and require a regular file.

**Livestream chat stops hard-deleting AI-hidden messages** (`server/services/livestream-chat.ts:370`)
- `applyAutoHide` already soft-deletes them. Moderation evidence is kept.

**Seed stops overwriting admin ordering of `home_sections` on every boot** (`server/db/seed.ts:203-204`)

**New operator script `npm run db:decode-excerpts`**
- It decodes HTML entities stored in `articles` and `article_translations` `title`/`excerpt`, so SQL `LIKE` search matches.
- Preview by default, `--apply` to write, keyed batches, and it keeps `updated_at` unchanged.

### 1C — Performance and front end

**Expired `rate_limit_counters` rows are purged in bounded batches, on their own tick** (`server/utils/rate-limit-store.ts:~199`, `data-retention.ts:323`)
- The purge no longer depends on the retention switch.

**Article view counting gets a per-IP ceiling** (`server/api/public/articles/[slug]/view.post.ts:44`)

**Two composite indexes on `articles`**
- They serve the public list queries in `articles.get.ts:100-135` and `related.get.ts`.
- Declared in `schema.ts`, `schema-tables/content.ts` and `ensureIndex`.

**Public video thumbnail fallback** (`server/api/public/media/[shortId]/thumb.get.ts:78,221-253`, `video-processing.ts:1066-1090`)
- Concurrent requests share one FFmpeg run.
- Each run is time-limited.
- A failure is remembered for a while.

**The live-status ticker stops polling every 8 s in hidden tabs and on `/media`** (`LiveTickerBar.vue:108-112`)
- `livestream/active` gets a short server-side cache.

**HeroBlock renders the editor's configured buttons** (`HeroBlock.vue:135-141`)
- The buttons are text plus link, through the 1A URL policy.
- Already-saved default labels are unchanged (see decision D4).

**Public accessibility**
- Focus rings change from `#7CB342` to `#4A6741` (13 files, 24 occurrences), and to a white ring on dark backgrounds.
- Exactly one `<h1>` per public page. `DefaultHeader.vue:24` becomes a non-heading.
- The `RoleModelsBlock` carousel gets a pause control, honours reduced motion, pauses on focus, touch and hidden tab, and gets visible focus rings.
- The `LiveTickerBar` marquee honours reduced motion.
- `ChatWidget` fixes three residual gaps: focus on mobile, the page behind becomes inert, and Escape works at window level.
- The `NewsCategoryList` most-read fetch is keyed by language.

### 1D — CI, deploy, ops and docs

**Pre-deploy DB dump** (`scripts/deploy-remote.sh:267-284`)
- A dump is taken before the app image is swapped. A failed dump aborts the deploy.
- `manage.sh` Update offers the same, defaulting to yes.

**Docs-only merges skip the build and deploy**
- The `changes` job emits a `deploy` output for push events.
- This is not done with `push: paths-ignore`, because five tests read `.md` files.

**Post-deploy smoke test through the public domain** (repo variable `VPS_SMOKE_URL`)
- It hits a new `GET /api/public/health` that returns `{ ok, version }` with the deployed short SHA.

**`wait_healthy` fails fast when the container is restart-looping** (`deploy-remote.sh:73-96`)

**App `stop_grace_period` of 45 s**
- Docker's 10 s default cuts Nitro's 30 s drain.
- Add a close hook that stops the backup scheduler.

**Image hygiene**
- Keep the newest 5 `sha-*` images on the VPS and remove the older ones by tag. Today `image prune -f` never removes tagged images (`deploy-remote.sh:291`).
- Add GHCR retention, keeping the newest 20 versions.
- Warn when Docker's disk usage is above 80 %.

**Dockerfile layer order**
- Put `apk`/`tzdata` before the app `COPY`s.
- Use `COPY --chown` instead of `chown -R /app`, which saves about 380 MB of re-pull per deploy.
- Run `chown` on uploads only when the owner differs (`deploy-remote.sh:107-115`, `docker-entrypoint.sh`).

**Dependabot** (npm, github-actions, docker; weekly, grouped)

**CI guards**
- Every `tests/*-integration.test.ts` file must be in the CI matrix, with its env in both env blocks.
- The "Fail if this suite skipped" step stops re-running the whole suite.

**`HEALTHCHECK_PING_URL`** is pinged at the end of `scripts/backup-db.sh` and `scripts/verify-restore.sh`. `manage.sh` asks for it.

**Docs corrections**
- The repo is PUBLIC, not private.
- Image retention.
- Stale counts: 171 `getDb()`, 209 services imports, `useI18n.ts` 265 lines.
- The `check-resources.sh` header.

## Capabilities

### New Capabilities
- `admin-settings-secrets`: which stored settings an admin read may return, and how secrets are masked.
- `public-submissions`: where the recipient of a citizen submission may come from; what public page JSON may expose.
- `page-builder-links`: allowed URL schemes for block and navigation links, on write and on render.
- `reader-session`: reader sign-out revokes the session server-side.
- `session-cookies`: when admin and reader cookies carry `Secure`.
- `comment-notifications`: when a reply e-mail may be sent, and what its subject may contain.
- `reader-display-names`: reserved and confusable display names.
- `analytics-retention`: raw and aggregate analytics data are purged per policy, and failures are visible.
- `livestream-chat-moderation`: AI-hidden livestream messages are kept as evidence.
- `boot-seed`: what the seed that runs on every boot may overwrite.
- `plain-text-fields`: an operator-run repair of stored entity-encoded titles and excerpts.
- `rate-limiting`: expired counters are purged; view counting has a per-IP ceiling.
- `video-thumbnails`: on-demand thumbnail extraction is bounded.
- `live-status-polling`: how often public pages poll livestream state.
- `hero-block`: hero buttons follow the editor's configuration.
- `public-accessibility`: focus visibility, heading structure, motion control, chat dialog focus.
- `deploy-pipeline`: pre-deploy snapshot, deploy skip for docs-only changes, smoke test, failure detection, image retention, graceful stop.
- `ci-pipeline`: every integration suite is wired into CI.
- `ops-monitoring`: backup jobs report success to an external ping.

### Modified Capabilities
- `backup-restore`: adds requirements for schedule adherence, failed-run handling, orphan cleanup and streamed download.

## Impact

**Code (server)**
- `server/api/admin/settings/{index.get.ts,backup.get.ts,navigation.put.ts}`
- `server/api/submissions.post.ts`
- `server/api/public/pages/[slug].get.ts`
- `server/utils/{sanitize-html.ts,display-name.ts,reader-auth.ts,mfa/session.ts,rate-limit-store.ts}`
- New `server/utils/request-secure.ts`
- `server/api/auth/google/start.get.ts`
- `server/api/admin/backup/drive/start.get.ts`
- `server/api/public/reader/logout.post.ts`
- `server/services/{comments.ts,notification-email.ts,analytics-maintenance.ts,backup-scheduler.ts,backup.ts,livestream-chat.ts,data-retention.ts,video-processing.ts,livestream.ts}`
- `server/plugins/backup-scheduler.ts`
- `server/api/admin/backup/[filename].get.ts`
- `server/db/{seed.ts,schema.ts,schema-tables/content.ts,migrations-additive.ts}`
- `server/api/public/articles/[slug]/view.post.ts`
- `server/api/public/media/[shortId]/thumb.get.ts`
- `server/api/public/livestream/active.get.ts`
- New `server/api/public/health.get.ts`
- New `server/services/stored-plaintext-decode.ts` and `scripts/decode-stored-excerpts.ts`

**Code (app)**
- `app/components/blocks/{LinksBlock.vue,HeroBlock.vue,RoleModelsBlock.vue}`
- `app/components/{LiveTickerBar.vue,ChatWidget.vue,NewsCategoryList.vue,layout/DefaultHeader.vue}`
- `app/pages/index.vue`
- `app/utils/nav-config.ts`
- `app/utils/blocks/registry.ts`
- The 13 files listed in design D9 (focus-ring class only)

**CI and ops**
- `.github/workflows/ci.yml`
- New `.github/workflows/ghcr-retention.yml`
- New `.github/dependabot.yml`
- `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`
- `scripts/{deploy-remote.sh,backup-db.sh,verify-restore.sh,check-resources.sh}`

**`production/`** (required by CLAUDE.md for deploy-affecting changes)
- `manage.sh`: Update gets the backup prompt and the image prune; the `.env` template gets `HEALTHCHECK_PING_URL`.
- `README.md`: the pre-deploy dump, smoke test variable, backup scheduler default, ping URL and image retention.

**Docs**
- `CLAUDE.md`, `CI-CD.md`, `DEPLOY.md`, `docs/CHANGELOG.md`

**Dependencies**
- None new. The `actions/delete-package-versions` action is used only in the GHCR retention workflow.

## Decision points (recommended default applied unless the user overrides)

- **D4 — HeroBlock labels on already-saved pages.**
  - Render the editor's stored values.
  - A stored value equal to the *old registry default* counts as "not set" and falls back to today's live label.
  - The registry defaults are updated to today's live labels.
  - Result: existing pages look the same, and edits now take effect.
- **D-1D-health — version disclosure.** `/api/public/health` returns the short git SHA. The repo is public, so this discloses nothing new. If the repo goes private, the SHA can be dropped from the public body and checked from the VPS side only.
- **D-1C-ipcap — view ceiling.** Count at most 60 views per IP per 10 minutes. Over the ceiling, return 202 and count nothing; the endpoint already always returns 202. It is generous, because offices share one NAT IP.

## User-side (not osf-apply tasks)

- Create the repo variable `VPS_SMOKE_URL`, for example `https://<production host>`, before merging 1D.
- Create an uptime monitor on `<host>/api/public/health`.
- Create a ping check and put its URL in the VPS `.env` as `HEALTHCHECK_PING_URL`.
- Before 1B is deployed, check in production whether `backup_auto_enabled` is already `true` from an earlier toggle that "did not work".
  - If it is, scheduled backups start at the next slot after the deploy.
  - Confirm free disk space for the uploads/media archives, or turn the switch off first.
- After 1B is deployed:
  1. Run `docker exec <app> npm run db:decode-excerpts` (preview).
  2. Read the report.
  3. Take a backup, then run it with `-- --apply`.

## Dropped (did not reproduce)

- **"Chat widget has no dialog role or focus trap."** It already has `role="dialog"`, `aria-modal`, Escape, a Tab wrap and focus return (`ChatWidget.vue:5-15, 469-512`). Only the three residual gaps in 1C remain.
- **"Deleting a livestream hard-deletes moderation evidence."** There is no session-delete path. The only hard delete is the AI auto-hide line, which is fixed in 1B.
- **"Moderation rescan reset lacks a generation token."** There is no reset path, and in-process re-entry is refused. The residual "named-lock loss mid-run" risk is noted in wave2.
