# Refactor 6 file admin lớn — đánh giá & ràng buộc chặn

6 file admin 873-1108 dòng (tổng 5972), vượt ngưỡng ~400 dòng CLAUDE.md khuyến nghị. Lần thử 2026-10 rollback toàn bộ — đây là diễn giải vì sao, ràng buộc test nào chặn, và điều kiện tiên quyết để làm lại sau.

> Người tiếp nhận muốn **hiểu tại sao**, không phải để tra cứu khi sửa mã. Khi sửa mã, đọc `CLAUDE.md`. File này ghi **lý do và giới hạn**.

---

## Bảng tổng quan

| File | Dòng | Tách được? | Ràng buộc chặn |
|------|------|------------|----------------|
| `pages/admin/media/scan.vue` | 873 | **Có** | `NO_CONTRACT_NEEDED` — nút là retry, toast là feedback, 5 section độc lập hoàn toàn |
| `pages/admin/profile.vue` | 875 | **Có** (1 phần) | `admin-error-retry` ghim `mfaError`/`loadMfa` ở file gốc. 3 dialog MFA tách được, section MFA template không |
| `components/admin/ai/AiProvidersTab.vue` | 1026 | **Có** | `admin-error-retry` ghim `providersError`/`loadProviders` ở file gốc. 5 modal tách được |
| `pages/admin/ai/moderation.vue` | 1030 | **Có** | `admin-error-retry` ghim `error`/`loadData` ở file gốc. 3 tab panel tách được |
| `pages/admin/content/articles/index.vue` | 1108 | **KHÔNG** | `admin-bulk-selection` ghim `selection.toggleAll`/`allSelected`/`someSelected`/`selection.toggle(Number(` ×2 ở **template file gốc** — tách table+card ra component con = mất pattern |
| `components/admin/AnalyticsLiveDashboard.client.vue` | 1060 | **KHÔNG** | `analytics-live-dashboard-ui` grep ~30 pattern ở **template file gốc** + `Function()`-trích script — tách cả template lẫn script đều đỏ |

---

## Ràng buộc test guard (đã trả giá để biết)

### 1. `tests/admin-error-retry-ui.test.ts`

**Đọc source từng file**, yêu cầu trong **cùng file gốc**:
- `const <ref> = ref(|computed(` trong script — ref lỗi có nơi hạ cánh
- `v-(else-)?if="<ref>"` trong template — lỗi hiện ra, không chỉ giữ
- `role="alert"` trong template — screen reader biết
- `@click="<retry>("` + `function <retry>(` cùng file — nút thử lại gọi fetch **cùng file**, không `location.reload()`

→ **Nhánh error/loading/retry + state-ref phải ở cha.** Template success-content + modal/dialog tách ra component con được, nhưng error branch không. Pattern đã chứng minh qua 4 file xanh (media/scan, profile¹, AiProviders, moderation).

¹ `profile.vue`: section MFA template (`v-if="mfaError"`, `role="alert"`, `@click="loadMfa"`) phải ở cha; chỉ 3 dialog MFA (enroll/disable/recovery) tách ra `ProfileMfaDialogs.vue`.

### 2. `tests/admin-bulk-selection-ui.test.ts` — chặn `articles/index`

**Đọc source text** `content/articles/index.vue`, grep **template file gốc** yêu cầu:
- `selection.toggleAll(visibleIds)` — select-all control
- `selection.allSelected(visibleIds)` — reflect all-selected state
- `selection.someSelected(visibleIds)` — indeterminate state
- `<AdminBulkActionBar` + `v-if="selection.count.value"` + `@clear="selection.clear()"` — action strip
- `selection.toggle(Number(` xuất hiện **đúng 2 lần** (`rowCheckboxSites: 2`) — desktop table + mobile card

Lần thử 2026-10 tách `ArticleTableDesktop.vue` + `ArticleCardMobile.vue` ra component con → pattern chuyển sang component con → template file gốc không match → **2 test đỏ**:
- `every admin list renders a header checkbox, row checkboxes and the action strip`
- `a page that renders its rows more than once has a checkbox in every branch` (tìm 0, cần 2)

→ **KHÔNG tách desktop table + mobile card của `articles/index.vue` ra component con.** Giữ `selection.*` pattern trong template file gốc. Các page khác trong `pages` của test (`chatbot/knowledge`, `content/categories`, `content-types`, `pages`, `users`, `submissions`, `media`) có cùng ràng buộc — nhưng chúng chưa nằm trong scope tách.

### 3. `tests/analytics-live-dashboard-ui.test.ts` — chặn `AnalyticsLiveDashboard`

**Heaviest constraint.** Test trích:
- `script` qua regex + `Function()` runtime — `normalizeFilter`/`normalizeScope` chạy thực, kiểm giá trị trả về
- `createAnalyticsPanelPoller</g` count = 3
- `onSuccess: response => { liveData.value = response }` (3 biến thể)
- `function retryLivePanel()` / `retryBreakdownPanel()` / `retryNocPanel()`
- `initialPanelSnapshot`, `formatUtc`, `timeZone: 'UTC'`
- visibility/lifecycle pause/resume/stop
- route query sync `preservedQuery`

Tất cả đều ở **script file gốc** → **KHÔNG tách script ra composable/util.**

Test cũng grep **template file gốc** cho ~30 pattern:
- 3 panel × `aria-busy/${panel}PanelState.inFlight` / `.loading` / `.denied` / `.connectionState === 'disconnected'` / `${panel}PanelError` / `.stale`
- `Lần cập nhật thành công (UTC):` với `formatUtc` + `utcDateTime` — **đúng 3 lần** (`occurrences === 3`)
- `role="status" aria-live="polite"` — **đúng 3 lần**
- `@click="retryLivePanel"` / `retryBreakdownPanel` / `retryNocPanel` — 3 retry
- Live chart: `<time v-if="index === 0 || index === ..."` , `point.pageViews === 0 ? '0%'`, `point.pageViews / maxLiveMetric * 100`, parity table `Dữ liệu đầy đủ tương ứng biểu đồ trực tiếp`
- NOC: `:aria-pressed="selectedScope === scope.value"`, `<i class="fa-solid"...aria-hidden="true"></i><span>{{ row.severity }}</span>`, `<details v-if="row.details">`, `safeDetails(row.details)`

Tất cả đều ở **template file gốc** → **KHÔNG tách template ra component con.**

CLAUDE.md đã note rõ (giữ nguyên): *"`AnalyticsLiveDashboard.client.vue` cố ý chỉ tách 2 hàm thuần (`analytics-noc.ts` — `safeDetails` là bộ lọc PII). NOC template giữ nguyên (22 định danh cha)."*

→ **Hạn chế có chủ đích, không phải gap.** File 1060 dòng giữ nguyên. Nếu muốn giảm, phải thay test guard trước (diện rộng, phá 11 test) và thiết lập ROI.

### 4. `tests/skeleton-loading-ui.test.ts`

Grep `v-if="<loadingRef>"` trong source file gốc. 6 file đều có skeleton marker — đã giữ ở cha trong cả 4 lần tách xanh.

---

## 4 file tách XANH (rollback nhưng pattern still valid)

Rollback không vì tách sai — mà vì giữ nhất quán (rollback hết hoặc giữ hết). Pattern đã chứng minh, nếu làm lại:

### `media/scan.vue` (873 → 44)

`NO_CONTRACT_NEEDED` — 5 section độc lập hoàn toàn, mỗi section tự `$fetch` + state, nút là retry, toast là feedback. Tách 5 component con `app/components/admin/media/scan/*.vue` + optional composable. Cha chỉ mount. Test `admin-error-retry` đã liệt kê 5 section trong `NO_CONTRACT_NEEDED` với lý do từng section.

### `profile.vue` (875 → 657)

Giữ ở cha: `mfaError`/`mfaLoading`/`loadMfa` retry, `v-if="mfaLoading"`, `role="alert"` + `@click="loadMfa"`, section MFA template, `changePassword`, mọi dialog handlers, `onKeydown`, `ProfileActivityHistory`.

Tách: 3 dialog MFA ra `ProfileMfaDialogs.vue` (~290 dòng) dùng `defineModel` (Vue 3.4+) cho 3 dialog object (`enrollDialog`/`disableDialog`/`recoveryDialog`). Dùng `defineModel` thay `defineProps` cho object form — con mutate field, cha nhận update, tránh `vue/no-mutating-props`.

Types chia sẻ → `app/types/admin-mfa.ts` (26 dòng: `FactorType`, `FactorRow`, `MfaStatus`, `FactorMeta`).

### `AiProvidersTab.vue` (1026 → 824)

Giữ ở cha: `providersError`/`providersLoading`/`loadProviders` retry, `v-if="providersLoading"`, `role="alert"`, provider card table + bulk + handlers, `defineExpose`.

Tách: 5 modal (create/edit provider, add/edit model, test call result) ra `ProviderModals.vue` (~280 dòng). 18 `defineModel` cho form/open state + 1 `defineProps` + 6 emit.

### `moderation.vue` (1030 → 521)

Giữ ở cha: `loading`/`error`/`loadData` retry, `v-if="loading"`, `role="alert"`, tab settings + tab nav + state/handlers.

Tách 3 tab panel:
- `ModerationQueuePanel.vue` (187) — `defineModel` queue/queueStatusFilter/queuePage, emit loadQueue/changeQueuePage/resolveItem. Hàm `selectFilter` set filter + page=1 + emit.
- `ModerationRulesPanel.vue` (135) — `defineModel` rules/newRuleForm, emit addRule/toggleRule/deleteRule.
- `ModerationWorkerPanel.vue` (252) — props workerData/workerLoading, emit refresh/rescanAll/restartWorker/restartServer. Định nghĩa lại `formatTime`/`formatUptime` (hàm thuần).

Types chia sẻ → `app/types/moderation.ts` (71 dòng: `ModerationRule`, `ModerationQueueItem`, `WorkerStatusData`, `ProviderOption`, `ModelPricingOption`).

---

## Điều kiện tiên quyết để làm lại

1. **Không động `articles/index.vue`** trừ khi sửa test guard `admin-bulk-selection` chấp nhận pattern ở component con (diện rộng, phá guard). Test guard tồn tại để chặn regression — phá guard = lỗ hổng. CLAUDE.md: *"guarded exception (test guard chặn) → KHÔNG fix, test sẽ đỏ"*.
2. **Không động `AnalyticsLiveDashboard.client.vue`** — hạn chế có chủ đích, CLAUDE.md đã note. Phải thiết lập ROI trước (giảm 1060 dòng đáng giá bao nhiêu so với phá 11 test guard?).
3. **Sau mỗi file tách**: chạy `npx nuxt typecheck` + `npm test` (đặc biệt `admin-error-retry`, `admin-bulk-selection`, `skeleton-loading`, `analytics-live-dashboard`) + `npx eslint <file đã chạm>`.
4. **`defineModel` (Vue 3.4+)** cho object form thay `defineProps` — con mutate field, cha nhận update, tránh `vue/no-mutating-props`.
5. **Component auto-import Nuxt**: `app/components/admin/ai/moderation/ModerationQueuePanel.vue` → `<ModerationQueuePanel>`.
6. **Types chia sẻ** → `app/types/*.ts` (không `app/utils/` vì đó cho hàm thuần; không `server/utils/` vì đó cho server).

## Kiểm chứng âm tính

Trước rollback, đã chạy sau mỗi file tách:
- `npx nuxt typecheck` — 0 error TS
- `npm test` — 2093 test, 0 fail, 14 skip (MySQL integration)
- `node --import ./scripts/ts-resolver.mjs --test tests/admin-error-retry-ui.test.ts tests/skeleton-loading-ui.test.ts` — 25/25 pass (4 file xanh)
- `node --import ./scripts/ts-resolver.mjs --test tests/analytics-live-dashboard-ui.test.ts` — 11/11 pass (file 6 chưa động)

Sau rollback `8ea5662`:
- `npm test` — 2079 pass, 0 fail, 14 skip
- 6 file gốc về đúng 1108/1030/1026/875/873/1060 = 5972 dòng

## Triệu chứng nếu regression quay lại

- `admin-bulk-selection` báo `content/articles/index.vue must offer a select-all control over the visible rows` — đã tách `<thead>` select-all ra component con.
- `admin-bulk-selection` báo `should have 2 row-checkbox site(s), found 0` — đã tách desktop table + mobile card ra component con, mất `selection.toggle(Number(`.
- `analytics-live-dashboard-ui` báo `assert.match(template, ...)` fail — đã tách template panel ra component con.
- `analytics-live-dashboard-ui` báo `assert.match(script, ...)` fail — đã tách script ra composable/util (normalizeFilter/normalizeScope).
