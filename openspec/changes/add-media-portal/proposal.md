# Proposal

## Why

The portal publishes text and images but has no way to publish **video**. Citizens looking for guidance material, reintegration-model footage, or a live broadcast from C11 have nowhere to go on the site — the content has to be hosted on YouTube and linked out, which sends readers (and their IP addresses) to a third party and leaves the portal unable to count, caption, or moderate its own material.

The same gap runs the other way: the portal can broadcast but cannot **listen**. A live announcement is one-way, and readers have no way to ask a question while it is happening.

This change adds a media channel with three parts that depend on each other: a public video gallery, a large-file upload + transcode pipeline that makes self-hosting viable on the project's own VPS, and a livestream with realtime chat.

## What Changes

**Public media library (`/media`, `/media/[slug]`)**
- Grid of published videos with category filter and search; detail page with a player.
- Player source depends on the item: **HLS.js** for self-hosted video (adaptive bitrate); YouTube-sourced video uses a server-built `youtube-nocookie.com` iframe.
- Only **HLS.js** is dynamically imported on media pages. `plyr` is deliberately unused because its YouTube SDK would contact an additional third-party origin.
- YouTube thumbnails are **proxied through the portal** rather than hot-linked from `i.ytimg.com`.
- A hero block on `/media` promotes the active livestream, and degrades to a default hero when nothing is live.

**Video upload + transcode (admin)**
- Chunked, resumable upload up to 10 GB (`MEDIA_UPLOAD_MAX_SIZE`), 10 MB chunks, resume after a dropped connection.
- FFmpeg pipeline: probe → progressive transcode to the configured renditions → HLS segmentation → thumbnail → local asset tree under `CDKT_MEDIA_WORKDIR`. Each rendition is published as it finishes (`resolutions_ready`), so a video becomes watchable before the last rendition completes. The source plan proposed R2; **this change implements it** (off by default, admin toggles in `/admin/settings/media-portal`); local remains the fallback when R2 sync fails or is unconfigured.
- A **reaper** tick (15 min) reclaims items stuck in `processing`, because a transcode that dies mid-flight has no other way back.
- Runtime disk guard: the pipeline aborts if free space drops below 1 GB rather than filling the volume.
- Upload is **gated by `MEDIA_UPLOAD_ENABLED`** — a deployment under 4 GB RAM refuses uploads instead of thrashing.

**Livestream + realtime chat**
- Admin starts/stops a session; at most **one** session is active at a time.
- Viewers watch via YouTube/HLS relay; chat is delivered over **SSE** (`h3.EventStream`).
- Chat is rate-limited per account **and** per IP; messages are plain text, stored in MySQL, soft-deleted on moderation.
- A stopped session can be **saved as a VOD** — the resulting media item outlives the session row.

**Comments on media — reusing the existing engine, not a second one**
- `server/services/comments.ts` is **parameterized** (`articleId` XOR `mediaItemId`) rather than duplicated. A second table would silently lose reader notifications, reply-email, rate limiting, and the cascade-impact counter that the article flow already has.
- `article_comments.article_id` becomes nullable; `media_item_id` is added with an FK and index.
- `comments_enabled` defaults to **off**, per item, matching articles.

**Cross-cutting**
- Two RBAC resources: `media_portal`, `livestream`. Neither is granted to any role by default.
- `livestream_sessions` becomes a data-retention scope (default 90 days), keyed on `ended_at`.
- A shared `withNamedLock()` helper replaces the three hand-copied `GET_LOCK` blocks in the existing schedulers.

## Capabilities

### New Capabilities

- `media-library`: public video gallery and detail pages — listing, filtering, search, player selection by source, view counting, and the livestream hero.
- `media-upload`: admin chunked upload, the FFmpeg/HLS transcode pipeline, rendition readiness, the stuck-item reaper, disk guard, and the runtime upload gate.
- `livestream`: session lifecycle (single-active invariant), public active-session endpoint, SSE chat transport with backpressure and shutdown, chat send/moderation, and VOD save-on-stop.
- `media-comments`: commenting on media items through the shared comment engine — the article-XOR-media contract, notification and email delivery for media replies, and admin moderation across both sources.

### Modified Capabilities

None — `openspec/specs/` is empty; this is the project's first spec set. Existing behavior that this change touches (article commenting, retention policy, site navigation) is covered as requirements inside the new capabilities above, since there is no prior spec to amend.

## Impact

**Database** — 4 new tables (`media_items`, `livestream_sessions`, `livestream_messages`, `media_upload_sessions`) and one altered table (`article_comments`: `article_id` → NULL, `+ media_item_id`). The change originally took the repository from 42 to 46 tables; the current tree has 47 tables / 464 columns because subsequent work added schema separately. `server/db/init.ts` carries the `CREATE TABLE`s; `server/db/migrations-additive.ts` carries the additive column, FK, and index, since `article_comments` already holds production rows.

**Existing services modified** — `comments.ts` (parameterized; all current article callers must keep working), `notifications.ts` and `notification-email.ts` (media branch), `retention-policy.ts` + `data-retention.ts` (new scope), `retention-scheduler.ts` / `view-boost-scheduler.ts` / `analytics-maintenance.ts` (use the new lock helper — `analytics-maintenance` must keep emitting its NOC event).

**Existing tests that will fail until updated** — `reader-audit-atomicity.test.ts` (service scan list), `transaction-tdz.test.ts` (new transaction shapes), `nav-config-boundary.test.ts` (`video_lib` key), `public-pages-structure.test.ts` (nav occurrence counts).

**Runtime / deployment** — Dockerfile gains FFmpeg (`apk add ffmpeg`) and a disk-backed `/var/lib/cdkt/media`; `docker-compose.yml` gains a `media_work` volume, memory limits, and a replica guard; `production/manage.sh` gains `cmd_media_tuning`; nginx needs a large-body location for upload and a buffering-off location for SSE. Local archive/restore support exists, but a restore onto a fresh host has not been rehearsed.

**Operational constraints (stated, not discovered later)**
- SSE is **single-replica only** in this change. The guard is `container_name` plus a boot check — multi-replica needs a pub/sub backplane, which is out of scope.
- FFmpeg transcode needs **≥4 GB RAM**; below that, uploads stay off.
- Renditions and HLS are produced by FFmpeg; a deployment without FFmpeg on `PATH` cannot transcode and must not accept uploads.
- The R2 requirement from the source plan is **implemented** (`server/services/video-r2-sync.ts`); the remaining acceptance item is the fresh-host restore drill (task 18.6), recorded as a procedure in `docs/decisions/media-storage.md`. Local storage remains an approved fallback when R2 is unconfigured or sync fails.
