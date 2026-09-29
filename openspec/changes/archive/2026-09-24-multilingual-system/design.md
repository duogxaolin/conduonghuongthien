# Design

## Context

The portal has a partial i18n system: `useI18n.ts` and `i18n-extra.ts` hold ~216 keys × 6 languages as hardcoded dictionaries. Only `default.vue` uses `t()` — the remaining ~6,252 Vietnamese strings across 114 `.vue` files are hardcoded. The existing article "Translate" button calls AI Gateway but overwrites the original text, and truncates content at 12,000 characters. See proposal.md for full motivation.

Key existing infrastructure:
- **AI Gateway** (`server/services/ai-gateway.ts`): `callAi(serviceKey, input)` — unified AI entry point with budget, provider resolution, key decryption.
- **AI translate endpoint** (`server/api/admin/ai/translate.post.ts`): Translates title+excerpt+content, returns JSON. Currently limited to 12k chars.
- **Background worker pattern** (`server/services/video-processing.ts`): In-process worker with DB-tracked progress, claim/heartbeat pattern.
- **SSE pattern** (`server/utils/node-sse-stream.ts`, `server/utils/sse-manager.ts`): Available but poll is more appropriate for finite jobs.
- **42 existing DB tables**, DDL in `server/db/init.ts` + `server/db/migrations-additive.ts`.

## Goals / Non-Goals

**Goals:**
- DB-driven UI translations with admin management and AI batch translate
- Per-article translation storage with independent lifecycle
- Background chunked translation for unlimited content length
- Progress tracking via DB polling
- Public-facing translated articles

**Non-Goals:**
- Admin panel translation (stays Vietnamese)
- Page block / category / chatbot translations (future work, separate tables)
- Real-time SSE for translation progress (poll is sufficient for finite jobs)
- Automatic translation on article publish (manual trigger only)
- Translation memory or TM/glossary systems

## Decisions

### D1: Three new tables, not a generic translations table

**Decision:** Create `languages` (table 43), `lang_translations` (table 44), and `article_translations` (table 45) as separate, typed tables.

**Why not EAV/generic:** Articles have `title` (VARCHAR 512), `excerpt` (TEXT), `content` (LONGTEXT) with specific types and constraints. UI strings are simple key-value. Forcing both into one table loses type safety, makes queries awkward, and prevents meaningful indexes. Each CMS entity (articles, blocks, categories) has different structure — future tables will follow the same per-entity pattern.

### D2: Chunked translation at HTML semantic boundaries

**Decision:** Split content at `<h2>`, `<h3>`, `<hr>` tags, or at `<p>`/`<div>`/`<li>` boundaries when a chunk exceeds ~8,000 characters. Never split inside an HTML tag.

**Why 8k:** Balances context quality (AI sees enough surrounding text) with token limits (8k chars ≈ 12k tokens, well within any model's context). A 50k article splits into ~6-7 chunks — manageable sequential processing.

**Algorithm:**
1. Parse HTML into top-level block nodes (h2, h3, hr, p, div, ul, ol, table, blockquote, etc.)
2. Accumulate nodes into a chunk until adding the next node would exceed 8k chars
3. If a single node exceeds 8k (e.g., a giant `<table>`), include it as its own chunk
4. Each chunk is valid HTML (no broken tags)

### D3: In-process worker with DB progress tracking

**Decision:** Translation runs as an async function spawned via `setTimeout(0)` after the HTTP response returns. Progress is written to `article_translations.progress` / `current_chunk` / `total_chunks`. Client polls every 2 seconds.

**Why not a job queue (BullMQ/Redis):** Project targets VPS 1-2 GB with single Node instance. Adding Redis is infrastructure overhead that doesn't pay for itself. The video processing pipeline (`video-processing.ts`) already proves this pattern works at this scale.

**Why poll not SSE:** Translation is a finite job (30s-3min). SSE requires holding a connection open the entire time — tab close or network hiccup loses all tracking. Poll is stateless: reload the page, progress is still visible from DB. The livestream chat SSE exists because that's a persistent stream, not a bounded job.

**Concurrency:** Only one translation job per article at a time. Enforced by checking `status='translating'` before spawning. Bulk translate processes articles sequentially (not parallel) to respect AI budget rate limits.

### D4: Five translation statuses

**Decision:** `translating` → `ai_draft` → `reviewed` → `published`. Plus `failed`.

- `translating`: Worker is running. Client shows progress bar.
- `ai_draft`: AI completed, not reviewed. Admin can view/edit.
- `reviewed`: Admin has edited. Distinct from ai_draft so admin knows what they've touched.
- `published`: Visible to public visitors. Only status served by public endpoint.
- `failed`: Worker errored. Shows error message + retry button.

Transitions: `translating` → `ai_draft` | `failed`. `ai_draft` ↔ `reviewed` ↔ `published`. `failed` → `translating` (retry). Any non-translating status → delete.

### D5: RBAC uses existing resources

**Decision:** Language management uses `settings.read` / `settings.update`. Article translations use `articleResource(type)` + `update`. No new RBAC resources.

**Why:** Adding resources requires seeding permissions and forces every deployment to manually grant them before the feature works. Language settings are site-wide configuration (same as other settings). Article translations are article operations — who can edit an article can translate it.

### D6: Audit within transactions

**Decision:** All translation CRUD operations write `activity_logs` in the same DB transaction as the data change, following the project's established pattern (`tests/reader-audit-atomicity.test.ts`).

Exception: The background worker's chunk-by-chunk progress updates do NOT write audit logs — those are machine events, not officer actions (same reasoning as `video-processing.ts`). Only the initial trigger and final completion/failure write audit.

### D7: `useI18n` migration strategy

**Decision:** `useI18n.ts` changes from hardcoded dictionaries to fetching from `/api/public/translations/{code}`. The fetch happens once per locale via `useState` (SSR-safe). Hardcoded Vietnamese dictionary is kept as final fallback — if DB is unreachable, the site still works in Vietnamese.

Fallback chain: DB value → hardcoded vi value → key name.

### D8: Content limit removal

**Decision:** Remove `content.slice(0, 12000)` from `translate.post.ts`. The endpoint now accepts full content. For direct (non-worker) calls, content is still passed in full. The chunking logic lives in the translation worker service, not in the endpoint.

## Risks / Trade-offs

- **AI cost for bulk translate:** 15 articles × 5 chunks × ~$0.02/chunk = ~$1.50 per bulk run. Budget system (`checkBudget`) already gates this. Admin should see estimated cost before confirming.
- **Article update invalidates translation:** When the Vietnamese original changes after translation, the existing translation becomes stale. Mitigation: store `article.updatedAt` at translation time; if original is newer, show "outdated" warning in admin. Not auto-retranslating — that's a conscious decision by the officer.
- **Worker crash mid-translation:** If the Node process restarts while translating, the row stays at `status='translating'` forever. Mitigation: on app startup, mark any `translating` rows older than 30 minutes as `failed` with message "Process interrupted". Same pattern as the video processing reaper.
