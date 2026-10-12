# Design

## Context

The CDKT admin panel has 46 Vue pages across 20 directories but no in-system documentation. Admins who need to fix something on a page but do not know the feature name have no discovery path. The codebase already has a proven 3-tier text matching engine in `server/utils/chatbot/retrieval.ts` (normalize → searchForm → tokens → score) and a `.client.vue` lazy-load pattern for client-only libraries (`AnalyticsTrafficChart.client.vue`).

All admin pages use `definePageMeta({ layout: 'admin', middleware: 'admin-auth' })`, Tailwind utilities, hardcoded Vietnamese, and the `#0d1f11` / `#1e4620` / `#8ed694` / `#122815` color palette. `/admin/**` is already `cache:false` in routeRules. The admin sidebar (`app/layouts/admin.vue:156-263`) is a `menuGroups` computed array with items gated by `hasPermission()`.

## Goals / Non-Goals

**Goals:**
- Three discovery paths: smart search, category browse, visual preview-with-hotspots
- Search understands natural Vietnamese questions, not just keywords
- Covers the entire website (admin + public), ~36 doc entries
- Zero DB/API footprint — all content static TS, client-side search
- Follows every existing admin convention, no new RBAC resource

**Non-Goals:**
- Full-text search over article/page content (that is `/search` public page)
- Editable docs from admin UI (content is code, version-controlled)
- Screenshots (skeleton HTML only — lighter, no binary assets, no drift)
- i18n for docs UI (admin pages are hardcoded Vietnamese per project convention)
- Mobile-responsive preview skeletons (admin is desktop-first; preview skeletons render fine on mobile but hotspots are not optimized for touch)

## Decisions

### D1: Static TS data files, not DB

**Choice:** All doc content lives in `app/utils/docs/admin-docs-*.ts` — 7 category files + 1 index + 1 previews + 1 search util.
**Why:** Docs change with code, not with runtime data. Putting them in DB adds a table, API, admin CRUD UI, and migration — all unnecessary. Static TS is type-checked, version-controlled, and tree-shakeable.
**Alternative considered:** DB table `admin_docs` + API — rejected for the overhead and because docs are code-coupled (mermaid source, admin page links).
**File size:** 7 category files each hold 2–15 entries. Largest (`admin-docs-system.ts`, ~15 entries × ~30 lines) stays under 400 lines. Per CLAUDE.md, split is proactive — if any file approaches 400, split by sub-category. The index file (`admin-docs-index.ts`) only imports + re-exports, no logic.

### D2: Port retrieval.ts matching to client, not import server

**Choice:** Copy the 3 pure functions (`normalizeKnowledgeText`, `searchForm`, `tokens`) from `server/utils/chatbot/retrieval.ts` into `app/utils/docs/search.ts`. Do not import from server.
**Why:** `retrieval.ts` imports Drizzle/DB types. Importing it client-side pulls server deps into the bundle. The 3 functions are pure string ops — ~10 lines total. Copying is the correct boundary.
**Trade-off:** Duplication. Mitigated by a comment in `search.ts` noting the source and keeping the functions identical, so a future refactor can extract to a shared `shared/utils/text-match.ts` if a third consumer appears.

### D3: Mermaid via .client.vue, lazy-loaded

**Choice:** `MermaidDiagram.client.vue` — `.client.vue` suffix (only renders client-side), lazy `import('mermaid')` in `onMounted`, `mermaid.render()` → SVG → `v-html`.
**Why:** Mermaid needs DOM (cannot SSR). `.client.vue` is the existing pattern (`AnalyticsTrafficChart.client.vue`, `AnalyticsLiveDashboard.client.vue`). Lazy import keeps mermaid (~500KB) out of the initial bundle — only loaded when a doc detail page opens.
**Alternative considered:** `vue-mermaid` wrapper — rejected, adds a dependency for a thin wrapper. Mermaid's API is simple (`mermaid.render(id, source)` → `{svg}`).
**Build concern:** `nuxt build` must not try to SSR-compile mermaid. `.client.vue` ensures it is only in the client bundle.

### D4: Preview skeleton as component, not images

**Choice:** `DocsPreviewSkeleton.vue` renders HTML/Tailwind block layouts with hotspot `<button>` overlays. Six layout variants switched by prop.
**Why:** Images require binary assets, drift from real layout, and need regeneration on UI changes. HTML skeletons are text, version-controlled, and hotspots are real DOM elements (accessible, focusable, keyboard-navigable).
**Layout mapping:** Each `PagePreview.layout` value maps to one template branch in the component. Hotspots are positioned via Tailwind grid/flex within each layout — `position` field in `PreviewHotspot` indicates grid area (e.g. "top", "hero", "sidebar").

### D5: settings.read permission, no new resource

**Choice:** Gate the sidebar item and pages by `settings.read`. No new RBAC resource `docs.read`.
**Why:** Docs are read-only reference, not a business workflow. Every admin who can view settings can view docs. Creating a `docs.read` resource adds RBAC complexity (seed, roles, permission checks) for zero security benefit — docs contain no sensitive data, only operational guidance.
**Trade-off:** An admin with only `users.read` but not `settings.read` will not see the docs link. Acceptable — such a narrow role is rare, and the link can be added to a different group if needed later.

### D6: Intent detection as UX hint, not filter

**Choice:** `detectIntent` result is shown as a hint chip in the search bar ("Tìm quy trình" / "Giải thích" / "Định vị" / "Định nghĩa") but does NOT filter results. Search always runs the full 3-tier match.
**Why:** Intent detection on short Vietnamese queries is heuristic. Filtering by intent could hide relevant docs if the heuristic is wrong. Showing the hint is informative without risking false negatives.
**Alternative considered:** Filter results by intent — rejected for false-negative risk.

## Risks / Trade-offs

- **[Mermaid bundle size ~500KB]** → Mitigated by lazy import in `.client.vue` — only loaded on doc detail page, not on hub or list pages. Acceptable for a documentation feature that renders diagrams.
- **[Duplicate retrieval.ts functions]** → Documented in `search.ts` with source pointer. Refactor to shared util only if a 3rd consumer appears (YAGNI now).
- **[Skeleton drift from real layout]** → Skeletons are simplified representations, not pixel-accurate. They show regions + labels, not exact CSS. Acceptable — the purpose is "click region to find doc", not "preview the exact page".
- **[Mermaid render in production build]** → Must verify `npm run build` succeeds with mermaid as dependency. The `.client.vue` pattern prevents SSR issues, but the initial import must be tested. Verify step in tasks.
- **[Search returns no results for obscure queries]** → Mitigated by empty state with `suggestQuestions()` sampling from `doc.questions[]`. Also, the `partial ≥2` threshold is lenient (matches chatbot retrieval threshold).

## Migration Plan

No migration needed — pure additive feature:
1. `npm install mermaid` (new dependency)
2. Create 18 new files (pages, components, utils, test)
3. Add 1 menu item to `app/layouts/admin.vue`
4. `npm run lint && npm run build && npm test`

**Rollback:** Remove the 18 files, revert the 1 line in `admin.vue`, `npm uninstall mermaid`. No DB changes to reverse.
