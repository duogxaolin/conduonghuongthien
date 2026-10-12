# Proposal

## Why

Admins using the CDKT portal have no in-system reference for how features work. When an admin needs to fix something on a page but does not know the feature name, there is no way to discover it — they must ask a developer or guess. A self-service documentation hub with smart search and visual page previews lets any admin find the answer without leaving the admin panel.

This covers the **entire website** — both admin-side operations and public-facing pages — because admins manage both and the boundary between "edit in admin" and "renders on public" is exactly what confuses new operators.

## What Changes

- **New page `/admin/docs`** — documentation hub with three entry points:
  - **Smart search** — natural-language Vietnamese question input ("làm sao đăng bài", "tại sao MFA bị khóa", "backup ở đâu"). Intent detection (procedure / explanation / location / definition) + 3-tier matching (exact title / alias / keyword substring ≥4 chars) ported from `server/utils/chatbot/retrieval.ts`. Returns ranked results with score.
  - **Browse by category** — grid of 6 categories (content / chatbot / readers / ai / system / public). Click card → detail page.
  - **Page preview + hotspot** — when admin does not know the feature name, open a skeleton preview of a real page (HTML/Tailwind blocks, no screenshots). Click a region → navigate to the doc for that region.
- **Detail pages** `/admin/docs/[slug]` — each doc has: title, summary, description, numbered workflow steps with links to admin pages, Mermaid flowchart (path diagram), related links.
- **Preview pages** `/admin/docs/preview/[pageSlug]` — 6 page skeletons (trang chủ, bài viết chi tiết, bản tin list, admin dashboard, admin bài viết list, admin bài viết edit) with clickable hotspots mapping to doc slugs.
- **~36 doc entries** across 7 static TS files by category — client-side data, no DB/API.
- **Mermaid integration** — new `mermaid` npm dependency, rendered client-side via `.client.vue` component (pattern matches existing `AnalyticsTrafficChart.client.vue`).
- **Sidebar entry** — new "Tài liệu hệ thống" menu item in the "Hệ thống & Cài đặt" group of `app/layouts/admin.vue`, gated by `settings.read` (no new RBAC resource).
- **Guard test** — `tests/admin-docs.test.ts` validates: every doc has required fields, slugs unique, `searchDocs` returns correct top result, preview hotspots reference valid doc slugs, intent detection works.

## Capabilities

### New Capabilities
- `admin-docs`: In-system documentation hub for the entire CDKT website — smart search with Vietnamese natural-language intent detection, category browse grid, page-preview hotspots, Mermaid workflow diagrams. Read-only, gated by `settings.read`, no DB/API, all content static TS.

### Modified Capabilities
<!-- None — no existing spec-level behavior changes. This is a pure addition. -->

## Impact

**New files (18):**
- 3 pages: `app/pages/admin/docs/index.vue`, `[slug].vue`, `preview/[pageSlug].vue`
- 5 components: `app/components/admin/docs/{DocsSearchBar,DocsCard,DocsPreviewSkeleton,MermaidDiagram.client,WorkflowSteps}.vue`
- 10 utils: `app/utils/docs/{admin-docs-index,search,previews,admin-docs-content,admin-docs-chatbot,admin-docs-readers,admin-docs-ai,admin-docs-system,admin-docs-public}.ts`
- 1 test: `tests/admin-docs.test.ts`

**Modified files (1):**
- `app/layouts/admin.vue` — add one sidebar menu item in "Hệ thống & Cài đặt" group

**New dependency (1):**
- `mermaid` (npm) — client-side flowchart rendering (lazy-loaded in `.client.vue`)

**No impact on:**
- Database schema (no new tables, no migrations)
- API endpoints (no new server routes)
- RBAC resources (reuses `settings.read`)
- Public-facing pages (admin-only feature)
- `routeRules` (`/admin/**` already `cache:false`)
- i18n (admin pages hardcoded Vietnamese per project convention)

**Files kept small per CLAUDE.md rule:** 7 category files each hold 2–15 entries — none approaches the 400-line threshold. `admin.vue` gains one menu line, not logic.
