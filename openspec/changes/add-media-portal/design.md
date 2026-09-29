# Design

## Context

See `proposal.md` — Why. What shapes the approach:

**The comment engine already exists and is expensive to duplicate.** `server/services/comments.ts` (~813 lines) carries seven mechanisms that were each paid for by a bug: reply-depth eligibility, rate limiting on two keys, reader notifications written in the same transaction as the reply, reply email, the cascade-impact counter that a delete confirmation shows, the admin-reply path, and `serializePublicComment`. A `media_comments` table would start from none of them, and the gaps would not be visible — a comment would save fine and simply never notify anyone.

**`article_comments` already holds production rows.** Any change to its columns must be additive and must not require a window where old code and new schema disagree.

**Three gates already exist that this change must pass, not bypass:**
- `npm run db:drift` (`scripts/check-schema-drift.ts`) compares `schema.ts` against the DDL in **both** `init.ts` and `migrations-additive.ts`, including column type and nullability.
- `tests/reader-audit-atomicity.test.ts` scans `server/services/**` and demands that every file touching `activity_logs` either uses `db.transaction(` or is named in `SERVICE_EXEMPTIONS` with a reason.
- `tests/transaction-tdz.test.ts` blocks the shape `const id = await db.transaction(...)` reading `id` inside its own callback — a shape that has already made four create-endpoints return 500 in this repo.

**Two established patterns this change reuses rather than reinvents:**
- In-process schedulers: tick interval, `unref()`, errors swallowed into a log line (`retention-scheduler.ts`, `view-boost-scheduler.ts`, `analytics-maintenance.ts`).
- `GET_LOCK` for a cross-replica mutex with timeout `0` (skip rather than queue) — `view-boost-scheduler.ts:94`.

**Cache safety is a constraint on every reader-facing decision.** Public routes run `swr: 60`. Anything personalized must load after mount.

### Corrections to the source plan, verified against the code

The source plan (`openspec/media-portal-plan.md` v4) is the origin of this design. Four of its instructions do not match the repository and are corrected here; each was verified by reading the file named.

1. **`ensureColumnDefinition` does not exist.** `server/db/migrations-additive.ts` exports `ensureColumn` (ADD COLUMN if missing), `ensureIndex`, `ensureForeignKeyIfMissing`, and `ensureRequiredColumn` (ADD nullable → backfill → MODIFY). There is no helper that only changes an existing column's definition. Decision below (§2).

2. **The drift gate does not parse `MODIFY COLUMN`.** `scripts/check-schema-drift.ts` reads columns out of `CREATE TABLE` bodies, `ensureColumn(...)` calls, `{table, column, definition}` objects, and `['table','col','DEF']` tuples. A `MODIFY COLUMN` in a migration file is invisible to it. So a migration that only alters the live database would leave the gate comparing `schema.ts` against a `CREATE TABLE` line that still says `NOT NULL` — reporting `LỆCH NULL` forever. Decision below (§2).

3. **`DEFAULT_NAV` already has eight items and cannot take a ninth.** `app/utils/nav-config.ts:77` records that a ninth peer item overflows the nav bar at the `md` breakpoint. Decision below (§9).

4. **R2 is not the implemented Media Portal store.** `server/services/video-processing.ts`, `server/services/media-portal.ts`, and the public stream endpoint read and write the disk-backed `CDKT_MEDIA_WORKDIR` / `media_work` volume. R2 configuration elsewhere in the repository belongs to the pre-existing generic Media Library and must not be cited as Media Portal storage. The local archive/restore scripts are present, but no fresh-host restore drill has been recorded. This remains an operational acceptance gap, not a completed design decision.

## Goals / Non-Goals

**Goals:**
- One commenting engine serving articles and media, with the item kind enforced as a real invariant rather than a convention.
- A transcode pipeline that survives its own failure: a job that dies mid-flight returns to a retryable state without an operator.
- Live chat that cannot accumulate unbounded server-side work when a reader stops reading.
- Every gate in the repository (`db:drift`, audit atomicity, TDZ scan, typecheck, build) passing without an exemption that is not justified in writing.

**Non-Goals:**
- Multi-replica SSE. Requires a pub/sub backplane; this design pins a single instance instead (§8).
- Dash streaming, photo albums, reactions, video chapters, view backfill — see the source plan's out-of-scope list.
- A second comment engine. Explicitly rejected (§1).

## Current implementation and acceptance status

The application code, unit suite, typecheck, schema-drift check, production build, and a disposable-database Media Portal browser suite have all been run successfully in the 20/09/2026 remediation pass. That evidence demonstrates the implemented paths; it does not complete production acceptance.

- Uploads, HLS renditions, thumbnails, and stream reads currently use the local `media_work` volume. R2 remains unimplemented for this portal.
- The local archive/restore path has not been rehearsed on a fresh host, so recoverability is not yet verified.
- The claim/queue/reaper, chunk receipt, cleanup, and chat-stop implementations need their remaining production-like soak or end-to-end evidence as recorded in `docs/codebase-audit-2026-09-19.md` (AUD-09, AUD-11–14, AUD-16). These are not grounds to mark the change archive-ready.
- Tasks 17.1, 17.3, and 17.4 below remain open because their stated end-to-end acceptance steps were not all captured. A unit test or a separate partial browser test does not complete an omitted end-to-end step.

## Decisions

### 1. Parameterize the comment service; do not create a second one

`CreateCommentInput` gains `articleId?` and `mediaItemId?`, mutually exclusive, with a **runtime guard at the top of `createComment`** rejecting a request that sets both, or neither.

Alternatives considered:
- **Separate `media_comments` table + service.** Rejected: loses notifications, reply email, rate limiting, the impact counter, and `serializePublicComment` — and the loss is silent, because a comment still saves.
- **A `comment_threads` parent table with polymorphic children.** Rejected: a migration of existing article comments into a new shape, for a feature that has one extra item kind. The runtime XOR gets the same guarantee at a fraction of the blast radius.

`checkParentEligibility` takes the same pair, so a reply's parent must belong to the same kind **and** the same item. `loadCommentThread` takes the pair and branches its `WHERE` in both the count query and the reply query. `listCommentsForAdmin` gains a `leftJoin` on `media_items` (precedent: the `leftJoin` to `users` that keeps log rows for deleted accounts) and a `?source=article|media` filter that accepts one value, not both. `deleteComment` reads `mediaItemId` on its first select and writes it into the audit `meta` alongside `articleId` — one deletion path stays the only deletion path.

`notification-email.ts` and `notifications.ts` gain a media branch. `reply.articleId` is nullable now, so the article lookup becomes conditional rather than an equality against a possibly-null value; the media branch looks up `media_items` for slug, title, status, and `comments_enabled`, and builds `/media/<slug>?comments=<page>#comment-<id>`.

**`COMMENT_THREAD_PER_PAGE` stays a single exported constant.** The notification link's page number is derived from the same page size the thread is served with; two copies of that number produce a link that lands *beside* the comment instead of on it, with nothing reporting an error.

### 2. Making `article_comments.article_id` nullable — edit both DDL sources, plus an idempotent ALTER

The column must become nullable in **three** places, for two different reasons:

| Place | Why |
|---|---|
| `server/db/init.ts` — the `CREATE TABLE` line becomes `article_id INT NULL` | Fresh installs. **Also required by the drift gate**, which reads nullability out of the `CREATE TABLE` body. |
| `server/db/schema.ts` — drop `.notNull()` on `articleId` | TypeScript, and the other side of the drift comparison. |
| `server/db/migrations-additive.ts` — a `MODIFY COLUMN ... INT NULL` | Existing databases, where the table already exists and `CREATE TABLE IF NOT EXISTS` is a no-op. |

**A migration-only fix is wrong** (correction 2): the drift gate would compare `schema.ts` (nullable) against the `CREATE TABLE` text (still `NOT NULL`) and fail permanently. **A `CREATE TABLE`-only fix is also wrong**: it never runs on a database that already has the table.

The additive migration needs a small helper, since none of the four existing helpers changes an existing column's definition. The helper is written next to them:

```ts
/** Change an existing column's definition. No-op when the column is absent — creating it is ensureColumn's job. */
export async function modifyColumn(db: Connection, database: string, table: string, column: string, definition: string)
```

It is guarded on the column existing, and it is idempotent (`MODIFY COLUMN` to the same definition is a no-op in MySQL). Precedent for `MODIFY COLUMN` in this file already exists at lines 255 and 299, inside `ensureRequiredColumn`.

`media_item_id` is added with `ensureColumn(..., 'INT NULL')` — a new column, no string default, so single quotes suffice and the gate's regex sees it. The FK and index go through `ensureForeignKeyIfMissing` and `ensureIndex`.

`article_comments` gains the mirror index on `(media_item_id, parent_id, created_at)`, matching the article index, because the thread query is the same query with a different leading column.

### 3. Four new tables

`media_items`, `livestream_sessions`, `livestream_messages`, `media_upload_sessions`. `CREATE TABLE` bodies go in `init.ts`; `schema.ts` declares the Drizzle side. This change originally added four tables (42 → 46); the current repository drift tally is 47 tables / 464 columns after later, separate schema work.

Notable column decisions:

- **`media_items.resolutions_ready`** is JSON typed `$type<string[]>()` with `.default([])` on the Drizzle side and a DDL default of `'[]'`. It records which renditions are playable, which is what makes a partially processed item watchable.
- **`media_items.processing_status`** is `pending|processing|ready|failed`. Distinct from `status` (`draft|published|archived`) — one is editorial state, the other is machine state, and collapsing them would make "published but failed" unrepresentable.
- **`media_items.claimed_by`** holds the identity of the process running the transcode, and `updated_at` is refreshed as its heartbeat. This pair is what lets the pipeline release its database connection (decision 4).
- **`media_items.comments_enabled`** defaults to `0`, matching articles. The default is not a detail: the opposite default would open commenting on the entire archive at deploy time, a moderation load nobody chose.
- **`livestream_sessions.is_active` has no unique index.** A unique index would make the invariant depend on catching a duplicate-key error; the lock in decision 7 is the mechanism, and this is a plain flag. A partial unique index (`WHERE is_active = 1`) is not available in MySQL 8.
- **`livestream_sessions.saved_media_id`** is `ON DELETE SET NULL`, so a retention pass over sessions does not delete the recording it produced.
- **`livestream_sessions.started_at` / `ended_at`** are `DATETIME`, not `TIMESTAMP` — no 2038 horizon, and no timezone conversion applied by the driver.
- **`livestream_messages.created_at`** is `DATETIME(3)` — chat ordering needs millisecond resolution, and two messages in the same second are ordinary.
- **`livestream_messages.display_name`** is a snapshot. The reader's current name is resolved elsewhere; a rename must not rewrite what was displayed at the time.
- **`media_upload_sessions`** binds an upload to its owner (decision 6).

### 4. Transcode releases its database connection before spawning FFmpeg

A transcode runs for a long time. Holding a pooled connection for its duration — or holding a named lock that owns one — exhausts the pool on a small VPS.

The sequence:

1. Acquire the named lock with `withNamedLock`, take the connection, record `claimed_by` (the process identifier) and `processing_status = 'processing'` on the row, and **release the connection**.
2. Spawn FFmpeg. Liveness now lives on the row: a heartbeat refreshes `updated_at` every five minutes, taking a connection briefly and returning it immediately.
3. The reaper (decision 5) reads `updated_at` and `claimed_by` to decide whether the job is alive.

The named lock protects the *start* of a job, not its duration; the row is the durable record. This is why `claimed_by` exists at all.

Transcoding is progressive: each rendition is transcoded, segmented, written beneath the local media asset root as it finishes, and appended to `resolutions_ready` immediately. A video therefore becomes watchable before the last rendition completes, and a job that dies on rendition three has still published renditions one and two.

**The HLS manifest is replaced atomically** — written to a temporary path and `rename`d over the target. A reader fetching the manifest during an update must see a complete manifest, old or new; a manifest written in place is a window where the player receives a truncated playlist and stops.

FFmpeg runs under `nice -n 19` with a bounded thread count per rendition and a bounded number of concurrent renditions, so a transcode degrades the portal rather than starving it.

**Disk guard:** free space is checked with `fs.statfs` (Node 18+; `statvfs` does not exist in Node's `fs`), polled on an interval, and the job aborts below the configured floor, marking the item failed with a disk-space reason and logging `media.disk_full`. A guard that itself errors aborts the job rather than continuing unguarded.

### 5. Reaper reclaims stuck jobs

`server/services/media-processing-reaper.ts` plus a plugin, in the shape of `retention-scheduler.ts`: 15-minute tick, `unref()`ed timer, errors caught and logged as a swallowed event rather than surfacing as an unhandled rejection.

A pass selects items in `processing` whose `updated_at` is older than the staleness window. For each: if the recorded process is no longer running, return the item to a retryable state and log it; if it is running, refresh `updated_at` and leave it.

The pass takes the same named lock as the pipeline start, so two replicas, or a tick overlapping a previous pass, do no duplicate work.

Without this, a killed container mid-transcode leaves an item in `processing` forever, and the only symptom is a video that never becomes playable.

### 6. Upload ownership is a database row, not a request field

`upload_id` is a server-generated UUID. Every chunk, status, and completion request re-verifies `WHERE upload_id = ? AND admin_user_id = <session admin>` — the ownership check is in the query, not a comparison after a fetch. An unknown identifier and another administrator's identifier return the same not-found response, so the endpoint does not reveal which uploads exist.

Temporary files live under `<workdir>/uploads/<upload_id>/`. The path is built from the server-generated identifier only, so no request field reaches the filesystem.

Chunk indexes are validated as non-negative integers within range, and a chunk body larger than the declared chunk size is rejected. Re-sending an already-received index is a success with no state change, so a retry after an ambiguous network failure is safe. Chunks may arrive out of order.

Completion verifies every expected index is present, assembles the parts, and **validates the assembled file by its leading bytes** rather than by the declared content type or extension — the same rule the existing media upload applies. A file that fails the check marks the upload failed and creates no media item.

A housekeeping pass removes upload sessions and their directories after the configured inactivity window, and never touches one modified within it.

### 7. Livestream single-active is a `GET_LOCK`, not a transaction

Two concurrent starts under `REPEATABLE READ` can both read "no active session" and both insert. A transaction does not prevent this at the default isolation level, and the project's `db.ts` sets no isolation level.

The start path takes `GET_LOCK('cdkt:livestream:active', 0)` on a pooled connection. Timeout `0` means skip rather than queue — an administrator clicking start while a session is live gets a 409 immediately, not a request that waits. Inside the lock, one transaction deactivates any active session, inserts the new one, and writes the audit row. The lock is released in a `finally`.

The insert identifier is read into a local (`const created = header?.insertId`) and returned from the transaction; it is never read from the outer variable inside the transaction's own callback (the TDZ shape the repo has paid for four times).

Stop does not need the lock — the session is already active — but it is the same single transaction, and it refuses to stop a session that is not active.

**Save-as-recording** requires a stopped session, creates a media item referencing the session's source, and writes `saved_media_id` back, all in one transaction. `uniqueMediaSlug` therefore takes the transaction client rather than `db` — the same shape as `uniqueCategorySlug`, with the client as its first parameter.

### 8. SSE: `h3.EventStream` with an explicit queue bound, and a single-replica pin

`createEventStream(event)` returns an `EventStream` instance; the handler registers it and returns `stream.send()`.

**`push()` does not reject on a write failure.** h3's `_sendEvent` ends with `.catch()` and swallows the error, so `push().catch(...)` is dead code — a design that relies on it for backpressure silently never fires. The design therefore tracks a **count of in-flight pushes per stream** and closes a stream whose count exceeds `MAX_PENDING`, which is the actual slow-consumer protection.

`onClosed` marks the stream closed and removes it from the registry, so a disconnected reader stops receiving messages and stops being tracked.

On server shutdown, a Nitro `close` hook sets a shutting-down flag, pushes a `shutdown` event to every open stream, and closes them. The event is pushed as an **object** (`{ event, data }`), not a pre-formatted string — the string form would be interpreted as data and arrive at the client without an event name. After the flag is set, broadcasts are dropped.

**Why single-replica:** the registry is in process memory. Two instances means a reader connected to instance A never receives a message published on instance B. Compose's `deploy.replicas` is a no-op outside Swarm, so the pin is `container_name` (Compose refuses a second container with the same name, so `--scale app=2` fails) plus a boot-time check that warns when the guard variable is absent in production. Multi-replica needs a pub/sub backplane and is out of scope; the README states this.

**Nginx** must disable proxy buffering and caching for the stream location and raise the read timeout; without it the stream is buffered and readers see messages in bursts or not at all.

### 9. Navigation: nest under an existing entry, do not add a ninth peer

`DEFAULT_NAV` has eight items, and `nav-config.ts:77` records that a ninth peer item overflows the bar at `md`. The media entry therefore goes into the existing dropdown structure alongside the entries that already share a dropdown, and appears in **both** the desktop header and the mobile drawer.

`NavItem` gains the label key, `normalizeNavItem` copies it, and a test asserts it in both languages — the allowlist normalizer is the known place where a new field is silently dropped if it is not named (`openNewTab` was lost this way), so the field is added in all three places: interface, normalizer, and assertion.

### 10. Third-party asset isolation

- External items embed through the source platform's no-cookie domain.
- Thumbnails for external items are served from the portal's own origin, not hot-linked from the platform's image host. Hot-linking sends every reader's IP and referrer to a third party on a page about their own legal situation — the same reason the project self-hosts its webfonts and does not store Google avatar URLs.
- `serializePublicMedia()` is written out field by field rather than selecting the row, so `processing_status`, `resolutions_ready`, `is_featured`, `status`, and `created_by` cannot leak into a public response even if someone adds a column later.

### 11. Streaming bytes through the origin, not a redirect

`serializePublicMedia` returns `streamUrl: '/api/public/media/<slug>/stream'`. That endpoint resolves the local `storage_path` server-side and **pipes the bytes** with `sendStream`, following `server/routes/uploads/[...path].ts`. It does not redirect, and it never returns the internal path. If an object store is adopted later, its signed URL must remain server-side and needs separate proof; that is not current behavior.

The stream endpoint responds as not found for unpublished items and sets `X-Content-Type-Options: nosniff`.

### 12. View counting follows the article-view precedent

Counted from the browser after mount (the page is served from cache, so server-side counting would undercount by exactly the amount the cache is working), one per visitor per day, keyed on a derived visitor token rather than an address, deduplicated through `rate_limit_counters` with `limit: 1`. Every branch returns the same accepted status, so the endpoint does not disclose which slugs exist. The reader's address is obtained through `getClientIp(event)`, never `getRequestIP` — behind nginx the latter returns the bridge gateway for every visitor and collapses the internet into one counter.

A missing HMAC secret stops counting and logs it; a counting failure never affects the reader's page.

### 13. Retention: a fifth scope, aged from the end

`livestream_sessions` joins `RETENTION_SCOPES`. Both the age column and the ordering column are `ended_at` — a session is old when it **finished**, not when it started, and a session with no end time is excluded from age-based purging. This is the same lesson as `chat_sessions.last_message_at`: aging from the start column would purge a broadcast that is still running.

`livestream_messages` is deliberately **not** a scope: its foreign key cascades from `livestream_sessions`, so it is already bounded. An independent window would delete messages while their session still exists.

`DataRetentionOptions` and the `windows[]` array in `data-retention.ts` are **not** compile-checked by a `Record<>` type, so the new fields are declared explicitly there in addition to `SCOPE_SETTINGS`.

### 14. A shared named-lock helper, with `analytics-maintenance`'s NOC event preserved

Three schedulers hand-copy the same `GET_LOCK` / `RELEASE_LOCK` block. `withNamedLock(pool, name, timeoutSec, action)` takes a callback that receives the connection holding the lock.

`analytics-maintenance.ts` emits a NOC event on the same connection (`emitNocBestEffort(connection, now, outcome)`, called from four sites). The refactor keeps the callback's connection as the object that event is emitted on; a refactor that hides the connection inside the helper would silently drop the NOC reporting, which is the only signal that maintenance is running at all.

### 15. Two RBAC resources, granted to nobody

`media_portal` and `livestream` are added to `VALID_RESOURCES`; neither is granted to any role by default, following `readers` and `comments`. Seeding is insert-only, so an existing permission matrix survives, and SuperAdmin holds them from the start. Comment moderation reuses the existing `comments` resource rather than minting a third.

### 16. One test file per boundary, and the guards stay source-text guards where that is all they can be

The new tests follow the repo's existing split. Behavior that can be exercised without mounting a page is tested by calling it: the YouTube parser, the slug helper, the status machine, the XOR guard, the rate-limit keys, the SSE queue bound. Behavior that only exists in a Vue template is asserted by reading the source, with the same caveat the existing suites carry in writing: a source-text assertion proves structure, not behavior.

Two tests exist specifically because the plan's own instructions were wrong about the repository: one asserts that `article_comments.article_id` is nullable on **both** sides of the drift comparison, and one asserts that the nav entry appears on both surfaces.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| A transcode on a small VPS starves the portal | Uploads gated by configuration; `manage.sh` refuses to enable uploads below the RAM floor; FFmpeg at low priority with bounded threads; disk guard |
| FFmpeg missing from the image | Uploads must not be enabled where FFmpeg cannot run; the runtime gate is the same flag, and the image installs FFmpeg explicitly |
| SSE registry is per-process | Single-instance pin (`container_name`) plus a boot-time warning; documented as a known limit rather than discovered in production |
| The stream endpoint is a byte pipe through Node | Acceptable for the expected concurrency; the alternative (redirect) leaks the storage location. Revisit with a CDN if streaming load grows |
| Local media volume is lost or moved | Archive the matching `media_work` assets with the database and prove a restore on a fresh host; R2 or an approved replacement architecture is still required before production archive |
| Making `article_id` nullable weakens a constraint | The XOR guard in `createComment` and the `checkParentEligibility` same-item rule are the replacement invariant, and both are tested. A database-level `CHECK` would be stronger but MySQL 8 enforces it inconsistently with `ON DELETE CASCADE` |
| Comment deletion paths multiply | One shared `deleteComment` remains the only path; the audit-atomicity guard scans the service directory rather than a hand-maintained file list, so a new service cannot slip past |
| Long-running transcode holds the named lock only briefly | By design: the row (`claimed_by` + `updated_at`) is the durable liveness record, and the reaper is what reads it. A lock held for hours would be worse |
| A rename of a chat participant rewrites history | `display_name` is snapshotted on the message row at send time |

## Migration Plan

Deployment order matters in three places, and each is a real ordering constraint rather than a preference:

1. **Schema before code.** Four `CREATE TABLE`s, `media_item_id` added, and `article_id` relaxed to nullable. All are additive or widening, so the previous release keeps working against the new schema.
2. **`article_id` is relaxed only after every writer treats it as optional.** The relax step is last among the schema changes, so no release exists in which the column is nullable and the code still requires it — the reverse (code optional, column `NOT NULL`) is safe, and that is the order.
3. **`readers`/`comments` are already granted or not; `media_portal` and `livestream` are granted by hand after deploy.** The media and livestream administration pages are unreachable until then, which is intended.

**Rollback** is turning features off rather than reverting schema: the upload gate disables uploads, the livestream permission can be revoked, and per-item `comments_enabled` defaults to off. The new tables and columns are inert when unused, and no existing row is rewritten by this change.

**Operational prerequisites, stated so they are not discovered later:** the media volume needs disk headroom for the largest expected upload plus its renditions; nginx needs a large-body location for uploads and an unbuffered location for the stream; the compose file needs a memory limit for the app container that reflects the transcode requirement. Before production archive, the deployment owner must either implement the planned R2 store or approve local storage and run a clean-host restore drill that plays a restored manifest, segment, and thumbnail.
