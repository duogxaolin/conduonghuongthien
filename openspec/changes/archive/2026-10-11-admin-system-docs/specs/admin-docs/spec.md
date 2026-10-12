# Spec Delta

## Purpose

In-system documentation hub that lets admin operators search, browse, and visually locate guidance for any feature across the entire CDKT website (admin + public) without leaving the admin panel.

## ADDED Requirements

### Requirement: Documentation hub page

The system SHALL provide a page at `/admin/docs` accessible only to authenticated admins (middleware `admin-auth`, layout `admin`). The page SHALL NOT be cached (`/admin/**` routeRule `cache:false` already applies). The page SHALL display three entry points: smart search bar, category browse grid, and preview-page entry cards.

#### Scenario: Admin opens docs hub

- **WHEN** an authenticated admin navigates to `/admin/docs`
- **THEN** the page renders with a search bar, a grid of 6 category cards (content, chatbot, readers, ai, system, public), and a row of preview-page entry cards linking to `/admin/docs/preview/<pageSlug>`
- **AND** each category card displays the category label, icon, and count of docs in that category

#### Scenario: Unauthenticated access blocked

- **WHEN** an unauthenticated visitor navigates to `/admin/docs`
- **THEN** the `admin-auth` middleware redirects to `/admin/login`

### Requirement: Smart search with Vietnamese intent detection

The system SHALL provide a search bar that accepts natural-language Vietnamese questions and returns ranked documentation entries. Search SHALL be client-side (no server round-trip) over static doc data.

Search SHALL normalize input using: NFKC Unicode normalization, lowercasing, whitespace collapse, diacritic stripping (NFD + remove combining marks + đ→d), and token splitting (unique non-empty tokens).

Search SHALL detect query intent via pattern matching:
- "làm sao" / "cách" / "how to" / "hướng dẫn" → procedure
- "tại sao" / "vì sao" / "why" → explanation
- "ở đâu" / "where" / "vị trí" → location
- "là gì" / "what is" / "định nghĩa" → definition
- fallback → keyword

Search SHALL score each doc using 3 tiers:
1. Exact normalized title match → 10000
2. Exact alias match → 9000
3. Keyword match (multi-word keyword uses substring contains; single-word keyword matches exact token or ≥4-char substring overlap) → 100 per matched keyword
4. Token overlap with title + description + questions → 1 per overlapping token

Search SHALL filter results to docs where: exact title match OR alias exact match OR matchedKeywords ≥1 OR token overlap ≥2. Results SHALL be sorted by score descending.

#### Scenario: Exact title match

- **WHEN** admin searches "cài đặt chatbot"
- **THEN** the doc with title "Cài đặt Chatbot" appears as the top result with score 10000

#### Scenario: Alias match

- **WHEN** admin searches "xuất bản bài viết"
- **THEN** the doc whose aliases include "xuất bản bài viết" appears in results with score ≥9000

#### Scenario: Keyword match with intent detection

- **WHEN** admin searches "làm sao đăng bài"
- **THEN** intent is detected as "procedure"
- **AND** the "Bài viết & Bản tin" doc appears in top results (keyword "đăng bài" or "bai viet" matches)

#### Scenario: Location question

- **WHEN** admin searches "backup ở đâu"
- **THEN** intent is detected as "location"
- **AND** "Sao lưu & Khôi phục" doc appears in top results

#### Scenario: No results

- **WHEN** admin searches a query matching no doc (no exact, no alias, no keyword, <2 token overlap)
- **THEN** the page displays an empty state with suggested sample questions drawn from doc entries

#### Scenario: Long query truncated

- **WHEN** admin enters a query longer than 200 characters
- **THEN** the search uses only the first 200 characters (slice)

### Requirement: Doc detail page

The system SHALL provide a page at `/admin/docs/[slug]` displaying the full content of a single doc entry: title, category badge, description, Mermaid flowchart diagram, numbered workflow steps (each with optional link to an admin page), and related-links section.

#### Scenario: Valid slug

- **WHEN** admin navigates to `/admin/docs/bai-viet-ban-tin`
- **THEN** the page renders title, category badge, description, Mermaid diagram, workflow steps, and related links for "Bài viết & Bản tin"

#### Scenario: Invalid slug

- **WHEN** admin navigates to `/admin/docs/nonexistent-slug`
- **THEN** the page redirects to `/admin/docs` and a toast notification says "Không tìm thấy tài liệu"

#### Scenario: Anchor scroll

- **WHEN** admin navigates to `/admin/docs/trang-chu-blocks#hero`
- **THEN** the page loads and scrolls to the element with `id="hero"` (if present)

### Requirement: Mermaid diagram rendering

The system SHALL render Mermaid flowchart diagrams client-side via a `.client.vue` component (Mermaid requires DOM, cannot SSR). The component SHALL lazy-load the `mermaid` npm package on mount, render the `source` prop to SVG, and display the SVG.

#### Scenario: Successful render

- **WHEN** the detail page mounts with a valid Mermaid source string
- **THEN** the component renders the flowchart as SVG inside the page

#### Scenario: Loading state

- **WHEN** Mermaid is loading (async import in progress)
- **THEN** a skeleton placeholder with `role="status"` and `aria-busy="true"` is displayed (with `motion-reduce:animate-none` on any pulse animation)

#### Scenario: Render failure fallback

- **WHEN** Mermaid import or render throws an error
- **THEN** the component displays the raw Mermaid source text inside a `<pre>` block so content is not lost

### Requirement: Page preview with clickable hotspots

The system SHALL provide preview pages at `/admin/docs/preview/[pageSlug]` that render a static HTML/Tailwind skeleton of a real page (no screenshots) with clickable region hotspots. Each hotspot SHALL map to a doc slug. Clicking a hotspot SHALL navigate to `/admin/docs/<docSlug>`.

Skeletons SHALL be rendered by a single `DocsPreviewSkeleton` component that switches layout by a `layout` prop. Valid layouts: `home`, `article-detail`, `news-list`, `admin-dashboard`, `admin-articles-list`, `admin-article-edit`.

Each hotspot SHALL be a `<button>` element with `aria-label`, a tooltip on hover showing label + hint, border highlight on hover/focus, and `cursor-pointer`.

#### Scenario: Valid preview page

- **WHEN** admin navigates to `/admin/docs/preview/trang-chu`
- **THEN** the page renders a skeleton of "Trang chủ" with clickable hotspots for topbar, hero, news block, role-models block, reintegration block, stats, and footer

#### Scenario: Click hotspot navigates to doc

- **WHEN** admin clicks the "Hero Banner" hotspot on the trang-chu preview
- **THEN** the browser navigates to `/admin/docs/trang-chu-blocks` (with anchor `#hero` if specified)

#### Scenario: Invalid preview page

- **WHEN** admin navigates to `/admin/docs/preview/nonexistent`
- **THEN** the page redirects to `/admin/docs` and a toast says "Không tìm thấy trang xem trước"

#### Scenario: Hotspot references invalid doc slug

- **WHEN** a hotspot's `docSlug` does not match any AdminDoc
- **THEN** clicking it navigates to `/admin/docs` (fallback). The guard test SHALL catch this at build time.

### Requirement: Sidebar menu entry

The system SHALL add a "Tài liệu hệ thống" menu item in the "Hệ thống & Cài đặt" group of the admin sidebar (`app/layouts/admin.vue`). The item SHALL be gated by `settings.read` permission (no new RBAC resource). The item SHALL link to `/admin/docs` with icon `fa-solid fa-circle-question`.

#### Scenario: Admin with settings.read sees menu item

- **WHEN** an admin with `settings.read` permission views the sidebar
- **THEN** "Tài liệu hệ thống" appears in the "Hệ thống & Cài đặt" group with a question-circle icon

#### Scenario: Admin without settings.read

- **WHEN** an admin without `settings.read` permission views the sidebar
- **THEN** "Tài liệu hệ thống" does not appear (same gating as other settings items in that group)

### Requirement: Doc data structure and integrity

The system SHALL store all documentation content as static TypeScript data in category files under `app/utils/docs/`. Each AdminDoc SHALL have: `slug` (unique), `title`, `category`, `icon`, `summary`, `description`, `workflow` (array of steps), `mermaid` (source string), optional `links`, optional `aliases`, optional `keywords`, optional `questions`.

Categories SHALL be: `content`, `chatbot`, `readers`, `ai`, `system`, `public`. Each category SHALL have a label and icon defined in `ADMIN_DOC_CATEGORIES`.

A guard test (`tests/admin-docs.test.ts`) SHALL validate:
- Every doc has non-empty `slug`, `title`, `category`, `icon`, `summary`, `description`, `workflow` (≥1 step), `mermaid`
- All slugs are unique
- All `category` values exist in `ADMIN_DOC_CATEGORIES`
- Every `PagePreview` has a unique `slug`, and every hotspot `docSlug` exists in `ADMIN_DOCS`
- `searchDocs` returns the correct top-1 doc for known queries

#### Scenario: Guard test catches missing field

- **WHEN** a doc entry is missing `mermaid` field
- **THEN** `tests/admin-docs.test.ts` fails with a message identifying the offending slug

#### Scenario: Guard test catches duplicate slug

- **WHEN** two doc entries share the same slug
- **THEN** `tests/admin-docs.test.ts` fails

#### Scenario: Guard test catches invalid hotspot reference

- **WHEN** a preview hotspot references `docSlug` not in `ADMIN_DOCS`
- **THEN** `tests/admin-docs.test.ts` fails with the offending preview + hotspot id

### Requirement: Admin UI conventions

All docs pages SHALL follow existing admin conventions: `definePageMeta({ layout: 'admin', middleware: 'admin-auth' })`, Tailwind utility classes (no `<style scoped>`), hardcoded Vietnamese (no i18n), admin color palette (`#0d1f11` / `#1e4620` / `#8ed694` / `#122815`). Loading skeletons SHALL use `role="status"` + `aria-busy="true"` + `motion-reduce:animate-none`.

#### Scenario: No scoped styles

- **WHEN** the docs pages and components are compiled
- **THEN** no `<style scoped>` block appears (only Tailwind utilities); `::before` / keyframes / `:deep()` exceptions from CLAUDE.md do not apply here (not rich-text)

#### Scenario: Admin color palette

- **WHEN** the docs hub and detail pages render
- **THEN** the color scheme matches the existing admin palette (dark sidebar greens, light content area with `#122815` text)
