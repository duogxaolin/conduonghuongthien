# Proposal

> **Wave 2 of the 2026-10-23 improvement plan.** It depends on Waves 0 and 1 being deployed.
>
> Every item here is medium effort (1–3 days). Each one is detailed down to the files it touches. Each has a **decision point** with a recommended default; the default applies unless the user overrides it before that item starts.
>
> Items ship as independent PRs, in the order of the groups below.

## Why

Wave 1 closes the defects that are cheap to fix. What remains are gaps that need a design choice or a migration. Each one either leaves a real attack path or makes data or ops failures invisible:

- **Cross-site requests.** State-changing requests are protected only by SameSite=Lax. Production shares a registrable domain with other `*.delify.vn` sites.
- **MFA.** MFA is optional for every admin, including SuperAdmin.
- **Credentials stored in plaintext.** `smtp_pass`, `r2_secret_key` and `backup_drive_service_account` are stored as plaintext in `settings`, and therefore also in every DB backup.
- **Media URL tools.**
  - The R2 domain change rewrites only 2 of the 27 URL-holding columns, with an unbounded `REPLACE`.
  - The media scan overwrites R2 objects that share a basename, and re-imports the same files on every scan.
- **The boot seed resurrects defaults that staff deleted**, on every restart.
- **"Đọc nhiều" (most read) is costly.** Every load sums daily view rows for every article.
- **Ops is blind.**
  - Container logs vanish on each deploy.
  - Security events are logged but never alerted.
  - Backups and `.env` have no guaranteed off-VPS copy.
  - Nothing tests that a database from the previous release survives the boot migrations.
- **Front end and back end lack shared structure.**
  - 17 admin modals have no dialog semantics.
  - Moderation is implemented twice.
  - There is no request-body validation layer.
  - Server code imports runtime values from `app/`.
  - Four services exceed 900 lines.

Fixing these takes the reviewer score from about 7.4 to about 8.

## What Changes

### 2A. Security

**Origin gate** (`csrf-protection`)
- One server middleware rejects cross-site state-changing requests to `/api/**`. It decides from `Sec-Fetch-Site`, then from `Origin` against the allowed hosts.
- Requests with neither header are allowed (decision D-CSRF).

**MFA policy** (`admin-mfa-policy`)
- A SuperAdmin-only policy: `off`, `privileged` or `all`.
- It has a 14-day grace period after it is turned on, and an env kill switch `MFA_ENFORCEMENT=0`.
- Enforcement happens in `server/middleware/admin-auth.ts`, with an enrollment allowlist.
- Recovery codes become mandatory at enrollment (decision D1).

**Credentials encrypted at rest** (`settings-secret-storage`)
- `smtp_pass`, `r2_secret_key` and `backup_drive_service_account` are stored as AES-256-GCM envelopes, under distinct HKDF labels of `CHATBOT_ENCRYPTION_SECRET`.
- Existing plaintext is converted once at boot, keyed on the value not yet being an envelope.

**Google-provided display names** (`reader-display-names-google`)
- At sign-in, a reserved name falls back to "Bạn đọc" instead of being stored verbatim (decision D-NAMES).

### 2B. Data integrity

**R2 domain repoint** (`media-url-repoint`)
- Uses the shared 27-target list (`URL_REFERENCE_TARGETS`) and a boundary-aware domain-prefix matcher, in one transaction with the audit row.
- Per-target counts are reported.
- A failed pre-backup aborts the repoint.

**Media scan import** (`media-scan-import`)
- Dedupes on the recorded source path.
- Refuses a target key another row owns.
- Deletes the uploaded object if the DB insert fails.
- Reports existing duplicates instead of deleting them.
- `repairLegacyMediaUrls` skips ambiguous filenames instead of letting the last one win.

**Seed defaults** (`seed-defaults`)
- Default rows of each seed group are inserted once per database.
- Defaults that staff later delete stay deleted (decision D7).

**Plain-text read path** — moved to the change `wave2-plain-text-read-path` (2026-10-25): it ships only after the operator confirms the Wave 1 backfill ran in production.

**Moderation rescan** (`moderation-rescan`)
- A rescan that loses its named lock stops at the next batch.

### 2C. Performance

**Most read** (`most-read-ranking`)
- Per-article view totals are kept on `articles`: `view_total_real` and `view_total_fabricated`, plus a stored generated `view_total`.
- They are updated in the same statement path as the daily upsert, backfilled once when the columns are added, and indexed `(status, type, view_total)`.
- `sort=views` reads the index.
- The `COUNT(*)` is skipped for `sort=views` (decision D6).

**Analytics ingestion**
- The shared hot rows (the `total` scope and the NOC aggregate) move to the end of the transaction, which shortens lock hold.
- Lock waits are measured before any batching is considered (decision D8).
- No spec, because behaviour is unchanged.

### 2D. Front-end structure

**Admin dialogs** (`admin-dialogs`)
- One `AdminModal.vue` shell: `role="dialog"`, `aria-modal`, a label, Escape, focus trap and return, and inert background.
- It replaces 17 hand-written overlays in 10 files.
- A guard test requires dialog semantics on every new overlay.

**Moderation UI** (`admin-moderation-ui`)
- One home: `/admin/ai/moderation`.
- The AI-panel tab becomes a summary with a link (decision D10).

**Typed admin fetching**
- `adminFetch<T>()` and `useAdminList()` are introduced and piloted on 3 list pages: comments, readers and chatbot sessions.
- The guard constraint is kept: error, retry and `role="alert"` stay in the page template.
- No spec, because behaviour is unchanged.

### 2E. Back-end structure

**Request validation** (`request-validation`)
- A `readJsonBody` helper turns malformed JSON into 400.
- A schema library is used for **new** endpoints only (decision D5).
- A guard freezes today's 133 legacy `readBody` call sites as a baseline that may only shrink.

**Shared modules**
- `app/utils/blocks/{registry,types}.ts` and `app/utils/submission-status.ts` move to `shared/`. Re-export shims stay in `app/`.
- A guard forbids `server/` from importing `app/`.
- No spec.

**Large services**
- `media-portal.ts` (1208 lines), `video-processing.ts` (1163), `comments.ts` (1134) and `chunked-upload.ts` (923) are split along named seams.
- Behaviour tests come first, and source-guard tests are kept green.
- No spec.

### 2F. Tests, ops and CI

**Previous-release upgrade test** (`schema-upgrade-safety`)
- Loads a snapshot of the previous release's schema plus representative rows, runs the boot sequence twice, and asserts rows are unchanged except for declared one-time conversions.

**Coverage**
- Re-measured with explicit include globs, so unloaded files count. The baseline is recorded.
- No threshold yet; that is Wave 3.

**Off-VPS backups** (`backup-restore`)
- Scheduled backups upload to Drive when it is configured.
- `manage.sh` gains an opt-in cron install for `backup-db.sh` / `verify-restore.sh`, and an encrypted `.env` export.
- The admin backup page warns when no off-VPS destination is configured.

**Logs and alerts** (`ops-logging`)
- The app log driver changes to `journald`, so logs survive container recreation (decision D-LOG).
- An allowlisted subset of `SECURITY_EVENTS` is e-mailed to an ops address, rate-limited.

**Docs only**
- A non-root deploy user with a `restrict` SSH key.
- Recommended memory caps.

**Decisions only**
- D2: deploy approval gate.
- D-CI: full CI running twice per merge.

## Capabilities

### New Capabilities
- `csrf-protection`: cross-site state-changing requests are refused.
- `admin-mfa-policy`: when an admin must have MFA and how enforcement is staged and switched off.
- `settings-secret-storage`: stored credentials are encrypted at rest and converted once.
- `reader-display-names-google`: reserved names coming from the identity provider.
- `media-url-repoint`: changing the R2 public domain rewrites every URL reference safely.
- `media-scan-import`: scanning local files into the media library is idempotent and never overwrites others' objects.
- `seed-defaults`: default rows are seeded once per database.
- `moderation-rescan`: a rescan stops when it loses exclusivity.
- `most-read-ranking`: how "most read" is ranked and what it costs per request.
- `admin-dialogs`: dialog semantics for admin modals.
- `admin-moderation-ui`: one admin surface for moderation.
- `request-validation`: malformed JSON bodies and new-endpoint validation.
- `schema-upgrade-safety`: the boot sequence preserves a previous release's data.
- `ops-logging`: logs survive redeploys; security events reach a human.

### Modified Capabilities
- `backup-restore`: adds an off-VPS copy requirement and the missing-destination warning.

## Impact

**Server**
- `server/middleware/` (new origin gate, `admin-auth.ts`)
- `server/utils/{mfa/*,logger.ts,mailer.ts,display-name.ts,decode-html-entities.ts}`
- `server/services/{media-repoint.ts,media-scan.ts,media-sync-url-match.ts,media-config-service.ts,backup.ts,moderation-rescan-job.ts,article-views.ts,analytics-ingestion.ts,analytics-ingestion-noc.ts}`
- The four large services
- `server/db/{seed.ts,schema.ts,schema-tables/content.ts,schema-tables/core.ts,migrations-additive.ts}`
- `server/api/public/articles.get.ts`
- `server/api/auth/google/callback*`
- New `server/utils/request-body.ts`

**App**
- New `app/components/admin/AdminModal.vue`
- The 10 modal files
- `app/pages/admin/ai/{index.vue,moderation.vue}`
- `app/components/admin/ai/AiModerationTab.vue`
- New `app/composables/{useAdminList.ts,adminFetch.ts}`
- 3 pilot pages

**Shared**
- `shared/blocks/*`
- `shared/submission-status.ts`

**Ops**
- `docker-compose.yml`: logging driver, plus `MFA_ENFORCEMENT` and `OPS_ALERT_EMAIL` in `environment:`
- `production/{manage.sh,README.md}`
- `DEPLOY.md`, `CI-CD.md`
- `docs/decisions/realm-safety.md`: key-rotation runbook for the new envelope labels

**Dependencies**
- One validation library (decision D5).
- The `npm audit` gate applies to it.

**Schema**
- `articles` gains 3 columns and 1 index.
- No new table. Seed markers live in `settings` under a reserved, non-exposed prefix.
- CLAUDE.md column counts must be updated.

## Decision points (recommended default applies unless overridden)

**D-CSRF: what to do when a state-changing request carries neither `Sec-Fetch-Site` nor `Origin`**
- **Default: allow.** Every current browser sends at least one of them on a cross-site POST, and cron, curl and E2E clients send neither.
- Alternative: reject. It is safer, but it breaks scripted clients.

**D1: who must have MFA**
- **Default: `privileged`.** That means SuperAdmin plus any role holding update/delete on `users`, `roles`, `settings` or backups.
- 14-day grace after the policy is switched on.
- Recovery codes are mandatory.
- `MFA_ENFORCEMENT=0` is the env kill switch.

**D-NAMES: a Google name that folds to a reserved term**
- **Default:** store and show "Bạn đọc" until the reader picks a custom name.
- Alternative: reject the sign-in, which would lock real people out.

**D7: how to remember that defaults were seeded**
- **Default:** keys `seed.<group>.done` in `settings`, excluded from every settings read. On the first boot after this change, each group whose table is non-empty is marked done.
- Alternative: a new `seed_markers` table.

**D6: how to rank "most read"**
- **Default:** per-article total columns plus an index on `articles`.
- Alternative: a 60 s response cache, rejected because it keeps the O(n) query.

**D8: analytics hot row**
- **Default:** reorder now, then measure.
- In-memory batching only if p95 ingest latency exceeds 50 ms under the load test.

**D10: moderation UI home**
- **Default:** keep the full page `/admin/ai/moderation`. The AI-panel tab shows counts and links to it.
- Removing `AiModerationTab.vue` needs the user's approval, because it is a deletion.

**D5: validation library**
- **Default: `zod` (v4).** It is the most widely used, its `schema.parse` plugs into h3 `readValidatedBody`, and it implements Standard Schema.
- Alternative: `valibot`, which is smaller but has fewer users.
- The library goes in `dependencies`, because the runtime image needs it.

**D-LOG: where logs are kept**
- **Default: `journald`.** Logs persist outside the container on a systemd host, and are read with `journalctl CONTAINER_NAME=…`.
- Alternative: a `local` driver plus a host copy cron.

**D-ALERT: where security alerts go**
- **Default:** e-mail through the existing SMTP to `OPS_ALERT_EMAIL`, at most one per event name per 15 min.
- Alternative: a webhook.

**D2: deploy approval gate**
- **Default: no gate.** Rely on branch protection, the pre-deploy dump, the smoke test and the docs-only skip.

**D-CI: full CI runs twice per merge (PR run + push run)**
- **Default:** accept while the repo is public.
- If the repo goes private, the push run should reuse a green PR run for the same tree SHA and only build and deploy.

## User-side (not osf-apply tasks)

- Choose `OPS_ALERT_EMAIL`.
- Turn on the MFA policy when ready; the grace period starts then.
- Make sure every privileged admin has an authenticator or working e-mail.
- Rehearse a restore on a blank machine using `DEPLOY.md`.
- Store the encrypted `.env` export somewhere off the VPS.
- Create a non-root deploy user and a `restrict`ed key, then update `VPS_USER` / `VPS_SSH_KEY`.
- Confirm the VPS uses systemd-journald before the log-driver change (`journalctl --version`).
- Approve the deletion of `AiModerationTab.vue` (D10).
