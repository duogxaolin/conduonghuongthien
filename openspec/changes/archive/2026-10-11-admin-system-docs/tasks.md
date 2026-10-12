# Tasks

## 1. Dependency & Foundation

- [x] 1.1 `npm install mermaid` and verify it appears in `package.json` dependencies. Verify `npm run build` still succeeds with mermaid present (no SSR import errors yet — `.client.vue` not created yet, but dependency must resolve).
- [x] 1.2 Create `app/utils/docs/search.ts` — port 3 pure functions from `server/utils/chatbot/retrieval.ts` (`normalizeKnowledgeText`, `searchForm`, `tokens`), add `detectIntent`, `scoreDoc`, `searchDocs`, `suggestQuestions`. Add comment noting the source file. Verify file compiles (`npx tsc --noEmit` on that file or via `npm run build`).
- [x] 1.3 Create `app/utils/docs/previews.ts` — define `PreviewHotspot`, `PagePreview` interfaces and `DOC_PREVIEWS` array with all 6 page previews (trang-chu, bai-viet-chi-tiet, ban-tin-list, admin-dashboard, admin-bai-viet-list, admin-bai-viet-edit) including all hotspots with `docSlug` values. Verify every `docSlug` referenced is a planned slug in the doc files (cross-check against category file slugs below).

## 2. Doc Data — Category Files

- [x] 2.1 Create `app/utils/docs/admin-docs-content.ts` — ~6 docs: `bai-viet-ban-tin`, `quan-ly-trang`, `danh-muc`, `thu-vien-media`, `menu-navbar`, `the-loai-noi-dung`. Each with full fields (slug, title, category, icon, summary, description, workflow, mermaid, aliases, keywords, questions, links). Verify each mermaid source is valid mermaid syntax (flowchart with valid node ids).
- [x] 2.2 Create `app/utils/docs/admin-docs-chatbot.ts` — ~4 docs: `kho-noi-dung-chatbot`, `phan-tiep-nhoi`, `phien-tro-chuyen`, `cai-dat-chatbot`. Full fields including aliases/keywords/questions for smart search. Verify mermaid sources valid.
- [x] 2.3 Create `app/utils/docs/admin-docs-readers.ts` — ~3 docs: `nguoi-doc-binh-luan`, `don-dang-ky-ho-tro`, `kiem-duyet-binh-luan`. Full fields. Verify mermaid sources valid.
- [x] 2.4 Create `app/utils/docs/admin-docs-ai.ts` — ~2 docs: `ai-panel`, `kiem-duyet-an-ninh`. Full fields. Verify mermaid sources valid.
- [x] 2.5 Create `app/utils/docs/admin-docs-system.ts` — ~15 docs: `nguoi-dung-phan-quyen`, `lich-su-hoat-dong`, `cau-hinh-email`, `tracking-marketing`, `tu-dong-don-du-lieu`, `sitemap`, `dang-nhap-google`, `chan-dia-chi-ip`, `ngon-ngu-ban-dich`, `mang-xa-hoi`, `luu-tru-media-r2`, `sao-luu-khoi-phuc`, `tai-khoan-ca-nhan`, `thong-ke-truy-cap`. Full fields. If file approaches 400 lines, split into `admin-docs-system-1.ts` + `admin-docs-system-2.ts`. Verify every file ≤400 lines. ← (verify: file line counts, mermaid syntax, every slug unique across all category files)
- [x] 2.6 Create `app/utils/docs/admin-docs-public.ts` — ~8 docs: `trang-chu-blocks`, `ban-tin`, `tam-guong`, `mo-hinh-tai-hoa-nhap`, `van-ban-phap-luat`, `media-portal-cong-khai`, `tim-kiem`, `lien-he`. Full fields. Verify mermaid sources valid.
- [x] 2.7 Create `app/utils/docs/admin-docs-index.ts` — import all 7 category files, export `ADMIN_DOCS` (concatenated), `ADMIN_DOC_CATEGORIES` (6 categories with labels + icons), re-export types (`AdminDoc`, `AdminDocCategory`, `AdminDocLink`, `AdminDocStep`). Verify `ADMIN_DOCS` length matches sum of category file entries and no duplicate slugs.

## 3. Components

- [x] 3.1 Create `app/components/admin/docs/MermaidDiagram.client.vue` — props `{source: string}`, lazy `import('mermaid')` in `onMounted`, render to SVG via `mermaid.render()`, display with `v-html`. Loading skeleton (`role="status"` + `aria-busy="true"` + `motion-reduce:animate-none`). Error fallback: `<pre>` with raw source. Verify component renders a simple `flowchart LR A-->B` without error in dev.
- [x] 3.2 Create `app/components/admin/docs/DocsSearchBar.vue` — props `(v-model)`, emits update on input. Shows intent hint chip when `detectIntent` returns non-keyword. Call `searchDocs` on input (debounced or immediate — follow existing admin search pattern). Verify intent chip updates when typing "làm sao" vs "backup".
- [x] 3.3 Create `app/components/admin/docs/DocsCard.vue` — props `{doc: AdminDoc}`, renders card with icon, title, summary, category badge. Click navigates to `/admin/docs/[slug]`. Tailwind utilities, admin color palette. Verify card renders with correct data.
- [x] 3.4 Create `app/components/admin/docs/WorkflowSteps.vue` — props `{steps: AdminDocStep[]}`, renders numbered list. Each step: title, detail, optional `<NuxtLink>` if `link` present. Verify steps render with working links.
- [x] 3.5 Create `app/components/admin/docs/DocsPreviewSkeleton.vue` — props `{layout: string, hotspots: PreviewHotspot[]}`. Switches template by layout (6 variants: home, article-detail, news-list, admin-dashboard, admin-articles-list, admin-article-edit). Each hotspot is a `<button>` with `aria-label`, tooltip on hover (label + hint), border highlight (`border-[#2c6e33]` on hover/focus), `cursor-pointer`. Emits `@hotspot-click` with `docSlug`. Verify each layout variant renders skeleton blocks + all hotspots are focusable buttons. ← (verify: all 6 layouts render, every hotspot is a <button> with aria-label, keyboard-focusable, click emits correct docSlug)

## 4. Pages

- [x] 4.1 Create `app/pages/admin/docs/index.vue` — hub page. `definePageMeta({ layout: 'admin', middleware: 'admin-auth' })`. Sections: DocsSearchBar (with results dropdown), category grid (6 DocsCard groups by category with counts), preview entry cards (link to `/admin/docs/preview/[pageSlug]`). Trending questions row (`suggestQuestions()`). Empty state when search has no results. Verify page renders with all 3 entry points visible.
- [x] 4.2 Create `app/pages/admin/docs/[slug].vue` — detail page. `definePageMeta({ layout: 'admin', middleware: 'admin-auth' })`. Find doc by slug from `ADMIN_DOCS`. If not found → `navigateTo('/admin/docs')` + toast "Không tìm thấy tài liệu". Render: back link, title, category badge, description, MermaidDiagram component, WorkflowSteps, related links. Support anchor scroll (`#hero` → scroll to element with that id). Verify valid slug renders full content; invalid slug redirects. ← (verify: valid slug shows mermaid + workflow + links; invalid slug redirects to /admin/docs with toast; anchor # scrolling works)
- [x] 4.3 Create `app/pages/admin/docs/preview/[pageSlug].vue` — preview page. `definePageMeta({ layout: 'admin', middleware: 'admin-auth' })`. Find PagePreview by slug from `DOC_PREVIEWS`. If not found → redirect + toast. Render: back link, page title + description ("Click vào vùng muốn sửa"), DocsPreviewSkeleton component. On hotspot click → `navigateTo('/admin/docs/${docSlug}')`. Verify valid preview shows skeleton with clickable hotspots; invalid redirects.
- [x] 4.4 Add sidebar menu item to `app/layouts/admin.vue` — in group "Hệ thống & Cài đặt", add `{ label: 'Tài liệu hệ thống', icon: 'fa-solid fa-circle-question', path: '/admin/docs' }` gated by `hasPermission('settings', 'read')`. Verify item appears for admins with `settings.read`, hidden for those without. ← (verify: sidebar item renders in correct group, gated by settings.read, links to /admin/docs)

## 5. Guard Test

- [x] 5.1 Create `tests/admin-docs.test.ts` — validate: (a) every AdminDoc has non-empty slug/title/category/icon/summary/description/workflow (≥1 step)/mermaid, (b) all slugs unique, (c) all category values in `ADMIN_DOC_CATEGORIES`, (d) every PagePreview slug unique, (e) every hotspot docSlug exists in `ADMIN_DOCS`, (f) `searchDocs("cài đặt chatbot")` top-1 is `cai-dat-chatbot`, (g) `searchDocs("làm sao đăng bài")` returns `bai-viet-ban-tin` in top-3 and intent is `procedure`, (h) `searchDocs("backup ở đâu")` intent is `location`. Verify `npm test` passes with new test included. ← (verify: guard test passes, catches missing fields/duplicate slugs/invalid hotspot refs, searchDocs returns correct results, intent detection correct)

## 6. Final Validation

- [x] 6.1 Run `npm run lint` — verify 0 errors (warnings OK per project convention). If errors in new files, fix them.
- [x] 6.2 Run `npm run build` — verify typecheck passes and mermaid builds without SSR errors. If build fails on mermaid, verify `.client.vue` suffix is correct and import is lazy.
- [x] 6.3 Run `npm test` — verify all existing tests still pass (no regression) and new `admin-docs.test.ts` passes. ← (verify: lint 0 error, build pass, all tests green including new guard test)
