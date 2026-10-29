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

---

## Lần tách 2026-10-25 — `pages/admin/ai/moderation.vue` (1155 → 367)

Wave 3, task 4.1 + 7.1. Lần này bản tách được giữ lại (không rollback như lần thử 2026-10).

- **Đường tách:** 4 panel trình bày trong `app/components/admin/ai/moderation/`:
  - `ModerationSettingsPanel` (146 dòng);
  - `ModerationQueuePanel` (172);
  - `ModerationRulesPanel` (135);
  - `ModerationWorkerPanel` (255).

  Ngoài ra:
  - logic tab worker (trạng thái, quét lại + hỏi lại mỗi 3 giây, hai nút khởi động lại) → `app/composables/useModerationWorker.ts` (210). `toast`/`confirm` được truyền vào, nên test import thẳng được;
  - kiểu suy ra từ handler (`Payload<…>`, cùng kỹ thuật với `admin-api.ts`) → `app/types/moderation.ts`;
  - hai hàm định dạng thuần → `app/utils/moderation-format.ts`.
- **Giữ ở cha:**
  - state, mọi request và `loadData`;
  - MỌI nhánh lỗi kèm nút "Thử lại", có hai cấp:
    - lượt tải TRANG (`error`, ô cảnh báo trên dải tab, "Thử lại" = `loadData`) — kể cả khi hàng đợi hỏng ngay lúc mở trang, như trước khi tách;
    - đọc lại SAU lần tải đầu (`queueError`/`settingsError`/`rulesError`: hàng đợi đổi bộ lọc/trang, cài đặt/quy tắc sau khi ghi) → ô cảnh báo trên chính tab đó, "Thử lại" chỉ đọc lại tab đó (`loadQueue`/`reloadSettings`/`reloadRules`).

    Markup của ô cảnh báo tab do trang cấp qua slot `#error` của panel, nên `admin-error-retry-ui` ghim cả bốn ref/retry ở file trang. Lý do: ô cảnh báo trang che MỌI tab, và "Thử lại" của nó (`loadData`) đọc lại cấu hình đè lên chỗ đang sửa — một bộ lọc hỏng không được làm mất chỗ sửa ở tab cài đặt;
  - skeleton `v-if="loading"`;
  - dải tab (`v-if="t.badge !== null && t.badge > 0"` đang bị ghim).

  Các panel không tự fetch, nên cổng phủ của `admin-error-retry-ui`/`skeleton-loading-ui` không cần liệt kê chúng.
- **Hàng đợi đối soát dùng `useAdminList`** (bộ lọc + phân trang + chỉ lượt mới nhất được ghi + hỏi lại trang cuối còn hàng). Hàng đợi hỏng lúc mở trang vẫn hiện ở ô cảnh báo trang với đúng câu cũ (`errorFallback`).
- **Ghi thành công thì toast thành công đứng yên:** lượt đọc lại sau khi ghi (lưu cài đặt, thêm/xoá quy tắc, xử lý đối soát) mà hỏng thì báo trên tab, không thành toast "Không thể lưu/thêm/xoá".
- **12 chỗ ép kiểu `($fetch as …)` → `adminFetch<T>()`.** `T` suy ra từ handler. `settings.get.ts` khai kiểu `mode: 'ai' | 'keyword_only'` — chỉ đổi kiểu, không đổi gì lúc chạy — vì object literal nới `mode` thành `string`.
- **Tên component:**
  - trang import panel tường minh như `ai/index.vue` (`<ModerationQueuePanel>`);
  - tên auto-import toàn cục là `AdminAiModerationQueuePanel`. Nuxt bỏ đoạn `moderation` lặp, nên KHÔNG phải `…ModerationModeration…`.
- **Test đọc mã nguồn, chuyển sang đọc đúng phần đang chứa đoạn bị ghim** (`tests/_moderation-page-parts.ts`):
  - `admin-moderation-summary` (worker-status → composable; `queueTotalFilter` suy từ `queueList.result`);
  - `moderation-rescan-summary` (dòng cảnh báo AI `role="status"` → `ModerationWorkerPanel`).
- **Hành vi:** `tests/admin-moderation-page.test.ts` mount trang thật cùng các panel trên một DOM tối giản (`tests/_sfc-mount.ts`) và bấm đúng các nút thật. Cùng tệp test xanh trên bản gốc (trừ các test ghi "RED trên bản gốc") và xanh sau khi tách.
- **Mã màu hex:** 213 class được dời đi, không thêm mới. Trang giữ 17; 4 panel được thêm vào ratchet hex bằng `--raise` (37/26/42/91). Đợt chuyển sang token màu (3.3/3.4) sẽ hạ dần các con số này.

## 2026-10-25 — `pages/admin/media/scan.vue` (908 → 228)

Wave 3, task 4.1 + 7.1. Bản tách giữ lại (không rollback). **Khác hình dạng "873 → 44, mỗi section tự fetch" ghi ở trên**: 5 panel ở đây CHỈ trình bày — panel tự fetch sẽ lọt vào hai cổng phủ (`admin-error-retry-ui`, `skeleton-loading-ui`) mà không có nhánh lỗi để khai.

- **Đường tách** (đường job/panel):
  - 5 panel trình bày trong `app/components/admin/media/scan/`, mỗi panel một `<section>` gốc:
    - `ScanFolderPanel` (157 dòng);
    - `StorageSyncPanel` (192);
    - `RepairUrlsPanel` (54);
    - `RepointDomainPanel` (83);
    - `SelfHealPanel` (104).

    Props vào, emit ra, `defineModel` cho ô tích "Tự đẩy lên R2" và hai ô domain. Phần suy ra thuần (phần trăm tiến độ, nhãn phase, "treo > 90 s") nằm ở panel.
  - Hai job NỀN (quét thư mục, đồng bộ local ↔ R2: khởi tạo, poll 3 giây, huỷ, buộc gỡ kẹt) → `app/composables/useMediaStorageJobs.ts` (262), gồm `useMediaScanJob` + `useMediaSyncJob`. `toast`/`confirm` được truyền vào, như `useModerationWorker`.
  - Kiểu suy ra từ handler (`Payload<…>`) → `app/types/media-scan.ts` (67).
- **Giữ ở cha:**
  - số ảnh local/R2 (`loadCounts`);
  - ba thao tác một lần: vá URL, đổi domain R2, self-heal — state, confirm, request;
  - lời gọi hai composable trong `setup`.

  Cha vẫn gọi `adminFetch<…>()` nên vẫn nằm trong hai cổng phủ — mục `NO_CONTRACT_NEEDED`/`NO_SKELETON_NEEDED` của trang vẫn đúng (không có danh sách tải, nút là thử lại, kết quả vào toast). Trang không có nhánh lỗi/`role="alert"` nào để giữ: trước và sau tách đều vậy.
- **Tên component:** trang import panel tường minh. Tên auto-import toàn cục là `AdminMediaScanFolderPanel` (Nuxt gộp đoạn `scan` lặp), `AdminMediaScanStorageSyncPanel`… — không trùng tên nào có sẵn.
- **12 chỗ ép kiểu `($fetch as …)` → `adminFetch<T>()`.** `T` suy ra từ 12 handler dưới `server/api/admin/media/`. Không dùng `useAdminList`: trang không có danh sách.
- **Hai lỗi sửa kèm,** mỗi lỗi có test đỏ trên bản gốc:
  - rời trang khi lượt đọc trạng thái đầu tiên, hoặc POST "Bắt đầu quét"/"Đồng bộ", còn đang bay → trước đây `startPolling()` chạy SAU `onUnmounted`, để lại một vòng poll 3 giây không ai dừng (toast của job còn hiện ở trang khác). Nay bộ hẹn giờ không bao giờ được bật sau khi trang đã rời;
  - "Hủy quét"/"Hủy sync" bấm sau khi job vừa kết thúc giữa hai lượt poll: máy chủ trả `{ ok: false, "Không có job … đang chạy." }` (HTTP 200) mà trang vẫn báo "Đã yêu cầu hủy". Nay hiện câu của máy chủ.
- **Hành vi:** `tests/admin-media-scan-page.test.ts` (36 test) mount trang thật cùng các panel trên DOM tối giản (`tests/_sfc-mount-media-scan.ts`) và bấm đúng các nút thật. Trên bản gốc: 32/36 xanh, 4 đỏ đúng là 4 test "[fixed by the split]". Sau tách: 36/36.
- **Chứng minh DOM không đổi** (chạy một lần, không commit): mount bản gốc và bản tách trong 22 kịch bản (62 ảnh chụp sau từng bước), so DOM tuần tự hoá + request + toast:
  - trước codemod: 62/62 DOM giống hệt bản gốc;
  - sau codemod: 62/62 giống hệt `codemod(bản gốc)`.

  Request giống hệt; toast giống hệt, trừ đúng lỗi "Hủy" đã sửa.
- **Mã màu hex:** đã chạy `scripts/codemod-hex-tokens.ts --write` trên 5 panel VÀ trang. Kết quả 115 thay thế — đúng con số codemod cho ra trên tệp gốc nguyên khối. Trang về 0 hex. 89 hex còn lại là giá trị chưa có token (`#8a6412`, `#cce5cd`, `#a32924`, … — quyết định D-T1) + 3 giữ vì thứ tự cascade. Chúng nằm ở 5 panel, vào ratchet bằng `--raise` (14/9/21/21/24); tổng hex của trang cũ 204 → 89.
- **Việc sau:** nhánh tách `moderation.vue` có `tests/_sfc-mount.ts` cùng ý tưởng với `tests/_sfc-mount-media-scan.ts`. Khi cả hai đã vào, giữ một.

## 2026-10-26 — `pages/admin/profile.vue` (901 → 277)

Wave 3, task 4.1 + 7.1. Bản tách giữ lại. Khác lần thử 2026-10 (875 → 657, chỉ tách 3 hộp thoại): lần này tách theo cả bốn đường khối — mật khẩu, yếu tố thứ hai, mã dự phòng, lịch sử (đã tách sẵn).

- **Đường tách:**
  - 6 component chỉ trình bày trong `app/components/admin/profile/` — props vào, emit ra, `defineModel` cho mọi ô nhập, không component nào tự fetch:
    - `ProfilePasswordSection` (56 dòng);
    - `ProfileMfaFactorList` (85) — ba thẻ yếu tố;
    - `ProfileRecoveryCodesCard` (84) — thẻ mã dự phòng + lô mã hiện một lần;
    - `ProfileEnrollDialog` (170), `ProfileDisableDialog` (66), `ProfileRecoveryDialog` (77).
  - Luồng của biểu mẫu/hộp thoại → composable; `toast`, hàm đưa tiêu điểm và việc đọc lại sau mỗi thao tác do trang truyền vào (như `useModerationWorker`):
    - `useProfilePassword` (51);
    - `useProfileMfaFactors` (239) — `useMfaEnrollDialog` + `useMfaDisableDialog`;
    - `useProfileRecoveryCodes` (144) — hộp thoại, lô mã, copy, tải về.
  - Kiểu suy ra từ handler (`Payload<…>`) → `app/types/admin-profile.ts` (52). Nhãn/biểu tượng/mô tả của ba yếu tố + `canEnrollMfaFactor` (hàm thuần) → `app/utils/profile-mfa.ts` (30).
- **Giữ ở cha:** `mfa`/`mfaLoading`/`mfaError` + `loadMfa` (ghim bởi `admin-error-retry-ui`), khung chờ `v-if="mfaLoading"` vẽ tại chỗ (ghim bởi `skeleton-loading-ui`), ô lỗi `role="alert"` + "Thử lại", cảnh báo mất quyền truy cập (`lockoutRisk` của máy chủ), thẻ tài khoản, `historyRef` + `<AdminProfileActivityHistory>`, phím Escape, `focusFirstField`. Ô lỗi của biểu mẫu mật khẩu và của từng hộp thoại đi theo biểu mẫu/hộp thoại của nó: đó là lỗi gửi biểu mẫu, không phải nhánh lỗi tải mà `admin-error-retry-ui` ghim.
- **Tên component:** trang import tường minh. Tên auto-import toàn cục là `AdminProfilePasswordSection`, `AdminProfileEnrollDialog`… (Nuxt gộp đoạn `profile` lặp) — không trùng `AdminProfileActivityHistory`.
- **8 chỗ ép kiểu `($fetch as …)` → `adminFetch<T>()`.** `T` suy ra từ 7 handler dưới `server/api/admin/profile/**`. Enroll trả một union (bí mật TOTP / `sentTo` email / không gì cho mật khẩu cấp 2) nên mã đọc qua `'secret' in res` — cùng giá trị lúc chạy. `mfa/index.get.ts` khai kiểu `email: string | null` — chỉ đổi kiểu: `event.context.adminUser` là `any`, và một trường `any` rơi khỏi kiểu `Serialize<…>`.
- **Bốn lỗi sửa kèm,** mỗi lỗi có test đỏ trên bản gốc (11 test). Gốc chung: "Huỷ", ✕ và nền đóng được hộp thoại đang bận (chỉ Escape kiểm `busy`), nên một câu trả lời về muộn ghi vào hộp thoại đã mở lại cho yếu tố khác:
  - lỗi của lượt tắt TOTP hiện trong hộp tắt email; lượt thành công đóng hộp tắt email; lượt enroll TOTP về muộn biến hộp bật email thành bước nhập mã ("Đã gửi mã … tới" khi chưa gửi gì); lượt xác nhận về muộn đóng hộp đang mở. Nay mỗi lần mở/đóng là một phiên mới, câu trả lời của phiên cũ không ghi gì vào hộp thoại — còn việc máy chủ ĐÃ làm (toast, lô mã dự phòng một lần, đọc lại) vẫn diễn ra;
  - hai lượt đọc trạng thái cùng bay: lượt cũ về sau vẽ lại trạng thái trước khi đổi, lượt cũ về trước tắt khung chờ khi lượt mới còn bay. Nay chỉ lượt gửi sau cùng được ghi;
  - Enter lần hai khi request còn bay gửi request thứ hai (nút đã khoá, phím Enter thì không) — với "Tạo mã", lô thứ hai thay lô đang hiện;
  - hai lô mã dự phòng cùng bay, trả lời về ngược thứ tự: lô máy chủ đã huỷ ở lại trên màn hình. Nay mỗi lượt đổi lô giữ một số thứ tự lấy lúc gửi; câu trả lời cũ hơn lô đang hiện không đổi gì.

  Không đổi cách đóng hộp thoại (vẫn đóng được khi bận) — chuyển ba hộp thoại sang `AdminModal` (khoá đóng khi bận, giữ Tab trong hộp) là việc sau, có đổi DOM.
- **Hành vi:** `tests/admin-profile-page.test.ts` (42 test) mount trang thật cùng các component và composable trên DOM tối giản (`tests/_profile-page-harness.ts` trên `tests/_sfc-mount.ts`), bấm/gõ/nhấn phím trên đúng điều khiển thật. Bản gốc: 31/42 xanh, 11 đỏ đúng là 11 test "fixed by the split". Sau tách: 42/42. `PROFILE_PAGE=<tệp>` chạy cùng bộ test trên một bản khác của trang.
- **`tests/_sfc-mount.ts` mở rộng** (không thêm bản thứ ba): `env.components` đăng ký component auto-import (`<AdminProfileActivityHistory>` — thiếu nó thì `ref` cầm một phần tử trần và `reload()` ném lỗi), và `env.auto` được đặt lên `globalProperties` — tên chỉ template dùng (`formatDateTimeVN(…)`) biên dịch thành `_ctx.tên`, Nuxt import nó qua bước biến đổi template.
- **Chốt nguồn đổi theo:** `admin-modal-dialog` ghim `isDeliberateEnter(` trong ba component hộp thoại thay cho `profile.vue`, và chặt hơn trước: MỌI `@keydown.enter` của chúng phải đi qua `submitOnEnter($event…)` (không `keyup`), `profile.vue` không còn ô bắt Enter nào. Bộ chọn mà `tests/e2e/admin-mfa.spec.ts`/`admin-login-challenge.spec.ts`/`admin-dialogs.spec.ts` dùng trên trang này giữ nguyên (DOM không đổi; E2E chưa chạy lại).
- **Chứng minh DOM không đổi** (chạy một lần, không commit): chạy cả 42 test trên bản gốc và bản tách với `PROFILE_DOM_LOG`, so DOM tuần tự hoá + request + toast sau mỗi bước:
  - 31 test không đổi hành vi: 173/173 ảnh chụp giống hệt;
  - 11 test sửa lỗi: 75/75 ảnh chụp giống hệt tới bước ngay trước bước lỗi lộ ra; khác đúng ở bước đó.
- **Mã màu hex:** codemod `--write` trên trang và 6 component: 0 thay thế, như trên tệp gốc. Tổng vẫn 70 (66 giá trị chưa có token — quyết định D-T1 — + 4 giữ vì thứ tự cascade). Trang 70 → 16; 6 component vào ratchet bằng `--raise` (5/14/15/5/9/6).
- **Việc sau:** `ProfileActivityHistory.vue` còn 2 chỗ ép kiểu `$fetch` và không chặn lượt đọc cũ khi đổi trang/tài khoản nhanh. Ô `enroll-sp-confirm` (bước 2 của mật khẩu cấp 2) gắn cùng giá trị với ô bước 1 nên hiện sẵn mật khẩu vừa gõ — giữ nguyên ở đây, cần quyết định sản phẩm.

## 2026-10-28 — `components/ArticleDetail.vue` (730 → 367)

Wave 3, task 4.2. Bản tách giữ lại.

- **Đường tách:**
  - 5 phần chỉ hiển thị trong `app/components/article/`: `ArticleMetaHeader` (84 — dòng danh mục/ngày/tác giả/lượt xem, tiêu đề, sapo, ảnh), `ArticleToc` (53 — mục lục, `v-model:open`), `ArticleBody` (86 — `v-html` thân bài + toàn bộ luật `.article-body :deep()` + ẩn ảnh 404), `ArticleShareBar` (120 — Facebook/Zalo/chép link/in, handler riêng, không fetch), `ArticleRelatedList` (80 — danh sách đã tải + chip chủ đề).
  - `useArticleRelated` (84 — `useAsyncData` của khối liên quan, gọi tại đúng chỗ cũ trong setup nên hai lượt đọc vẫn song song, cả trên máy chủ), `useArticleReadTracking` (63 — lượt xem sau mount, nuốt lỗi + lịch sử đọc), `useArticleDetailLabels` (39 — nhãn theo `variant`).
- **Giữ ở cha:** lượt đọc bài + `fetchOutcome`/`loadError` + `useSsrFailureStatus` (503/404 SSR — ghim bởi `public-detail-ssr-status`), khung chờ + nhánh lỗi + "thử lại" của trang VÀ của cột "Bài viết khác", bố cục lưới, settings + SEO, trạng thái gập mục lục (mục lục bị gỡ mỗi khi bài tải lại — đổi ngôn ngữ — nên trạng thái phải sống ở cha), nhãn danh mục theo thứ tự ưu tiên.
- **Bốn lượt `$fetch` ép kiểu ở lại cha** (bài, liên quan, settings, lượt xem); hai composable nhận request dưới dạng hàm. Ratchet ép kiểu không đổi (4).
- **`v-html` chuyển sang `ArticleBody.vue`:** kiểm kê `security-ai-editorial-html` đổi tên mục, cùng lý do lọc; thêm guard "ArticleBody chỉ được ArticleDetail.vue dùng, đúng `:html="toc.html"`" (bắt cả `<article-body>`, `<LazyArticleBody>`, import) với bằng chứng cấy lỗi.
- **Một lỗi sửa kèm** (`FINDING-D1`, đỏ trên bản gốc): ẩn ảnh 404 gắn lúc ArticleDetail mount — khi bài tới SAU mount (điều hướng phía client, đổi ngôn ngữ) thân bài chưa có, không ảnh lỗi nào được ẩn. Nay gắn khi `ArticleBody` mount.
- **Hành vi:** `tests/article-detail-page.test.ts` (24 test, `tests/_article-detail-harness.ts`: `useAsyncData`/`useSeoMeta`/`useI18n` giả mỏng + ofetch thật trên mạng giả). Bản gốc 23/24 (đỏ đúng FINDING-D1), sau tách 24/24. `tests/_sfc-mount.ts` mở rộng: `v-show` thành bộ ghi (`isShown`).
- **Sau kiểm chứng độc lập (follow-up):**
  - lượt đọc "Bài viết khác" được ghim chạy song song với lượt đọc bài: harness ghi lại từng lượt `useAsyncData` (lúc đăng ký: setup hay sau mount, `server`/`immediate`/`lazy`; `immediate: false` không chạy như Nuxt), test 25 khẳng định nó đăng ký trong setup ngay sau lượt đọc bài, không `server:false`/`immediate:false`, và request đã đi khi bài chưa về. Guard nguồn: không `server: false`/`immediate: false` trong `useArticleRelated`, lời gọi ở cấp cao nhất của setup giữa lượt đọc bài và settings, fetcher không chờ bài. Đột biến thêm `server: false` (M17) và `immediate: false` (M18) đều đỏ (cả test hành vi lẫn guard);
  - guard người gọi `ArticleBody` bắt thêm render gián tiếp: `:is`/`v-bind:is`/`is=` (định danh hoặc tên), `resolveComponent(...)`, `import(...)` động (`defineAsyncComponent`), `#components`, dùng như giá trị (`h(ArticleBody…)`, `const X = ArticleBody`, `components: { ArticleBody }`) — ở mọi tệp, kể cả ArticleDetail.vue; 11 mẫu cấy đều đỏ.
- **Chứng minh không đổi:**
  - DOM (`ARTICLE_DETAIL_DOM_LOG`, một lần, không commit): 36/36 ảnh chụp giống hệt (DOM + request + toast + `window.open` + SEO), 1 ảnh thêm là bước sau đổi ngôn ngữ của FINDING-D1;
  - build: CSS Tailwind `entry.*.css` giống từng byte; CSS của chunk ArticleDetail giống hệt sau khi chuẩn hoá scope id (luật `:deep()` nay gắn scope của ArticleBody);
  - ảnh chụp trình duyệt (build e444621 vs bản tách, CSDL e2e, luồng bình luận + danh tính giả ở trình duyệt): 12 trạng thái × desktop 1440 + phone 390 — 22/24 trùng từng điểm ảnh (max diff 0), 2/24 khác đúng ở nhãn phân trang (FINDING-C1 của ArticleComments).
- **Mã màu hex:** codemod 0 thay thế. 8 → cha 2 (`#E2A0A0` của hai nhánh lỗi) + `ArticleShareBar` 6 (màu Facebook/Zalo, không có token; `--raise`).
- **Khác biệt không phải điểm ảnh, đã biết:** nhãn "Đã sao chép" (2,5 s) mất sớm nếu bài tải lại trong khoảng đó; `ArticleMetaHeader` gốc nhiều nút nên HTML SSR thêm dấu `<!--[-->…<!--]-->`.
- **Việc sau:** chưa có helper fetch công khai có kiểu (`publicFetch` kiểu `adminFetch`), nên 4 ép kiểu còn đó; `onMounted` vẫn đọc lại khối liên quan khi danh sách rỗng hợp lệ (một request thừa mỗi lượt xem bài không có bài liên quan).

## 2026-10-28 — `components/ArticleComments.vue` (732 → 325)

Wave 3, task 4.2 (component công khai > 600 dòng). Bản tách giữ lại.

- **Đường tách:**
  - 3 phần chỉ hiển thị trong `app/components/comments/` — props vào, emit ra, `defineModel` cho khung soạn/khung trả lời, không phần nào tự fetch: `CommentThreadItem` (163 dòng — một bình luận gốc + một cấp trả lời + khung trả lời, hai neo `#comment-<id>`), `CommentPendingList` (50 — mục gửi lạc quan), `CommentComposer` (78 — lời mời đăng nhập + lý do phiên hết hạn, hoặc khung soạn).
  - Luồng GHI → `app/composables/useCommentWrites.ts` (277): soạn/trả lời, gửi lạc quan, thử lại/bỏ qua, xoá, 401 (lưu nháp TRƯỚC khi bỏ danh tính), điểm kiểm duyệt ngầm 2,5/6/11/18 s.
  - Neo/chép liên kết → `useCommentAnchor.ts` (73); hàm thuần (id neo, `?comments=`, gỡ bình luận khỏi luồng, khoá nháp) → `app/utils/comment-thread.ts` (75).
- **Giữ ở cha:** state của luồng, `loadThread` + nhánh lỗi `role="alert"` + "thử lại" (ghim bởi `reader-comments-ui`), khung chờ, trạng thái rỗng, thông báo thu hồi, phân trang, thứ tự mount (`?comments=` đọc TRƯỚC lượt tải đầu, ghim bởi `reader-notifications`), trục bài viết/video (`threadQuery`/`writeBody`, ghim bởi `media-comments` 10.9).
- **Bốn lượt `$fetch` ép kiểu ở lại cha** (ratchet chỉ được hạ; phía công khai chưa có helper kiểu `adminFetch`): `loadThread` gọi thẳng, ba lượt ghi đi vào composable dưới dạng hàm `api.post/remove/checkpoint`.
- **Bốn lỗi sửa kèm** (test `FINDING-C*` đỏ trên bản gốc):
  - C1 nhãn phân trang in nguyên khuôn i18n: "Trang {current} / {total} 1 / 2" — nay thay chỗ trống như mọi trang danh sách khác;
  - C2 bốn hẹn giờ kiểm duyệt ngầm mỗi lần gửi không bao giờ bị huỷ → tới 4 request sau khi rời trang; nay huỷ ở `onBeforeUnmount`, câu trả lời về muộn không ghi gì;
  - C3 "Thử lại" trên mục gửi lỗi trong lúc một bình luận khác đang gửi: mục bị gỡ, chữ vào khung soạn, `submit()` thoát ngay, rồi lượt đang gửi về và xoá khung — bình luận mất hẳn; nay mục ở lại và "Thử lại" bị khoá (`disabled`, mờ) khi đang gửi — luồng ghi cũng tự từ chối;
  - C4 nháp của video được phục hồi vào bài viết trùng slug (một khoá `cdkt:comment-draft:<slug>` cho cả hai loại); khoá video nay có `media:` (khoá bài viết giữ nguyên).
- **Hành vi:** `tests/article-comments-thread.test.ts` (29 test) mount component thật cùng các phần trên DOM tối giản (`tests/_article-comments-harness.ts`, ofetch thật trên mạng giả trả lời như `server/api/public/comments/**`). Bản gốc: 25/29, 4 đỏ đúng là 4 test FINDING. Sau tách: 29/29. `ARTICLE_COMMENTS_FILE=<tệp>` chạy cùng bộ test trên bản khác.
- **Chứng minh DOM không đổi** (chạy một lần, không commit — `ARTICLE_COMMENTS_DOM_LOG`): 95 ảnh chụp (DOM tuần tự hoá + request): 79 giống hệt; 13 giống hệt sau khi chuẩn hoá đúng nhãn C1; 3 khác đúng ở bước lỗi C3 (2) và C4 (1).
- **Guard đọc cả họ tệp** (`tests/_component-family.ts`): `reader-comments-ui` (v-html, class nội suy, nhịp chờ, chữ thân bình luận — nay theo TỪNG phần tử thân, 401/nháp/xoá khung sau khi ghi), `media-comments` 10.9, `reader-notifications` (2 neo, `isSafeInteger`, reduced-motion), `skeleton-loading-ui`. Mỗi guard có bằng chứng cấy lỗi vào một phần tách ra.
- **Mã màu hex:** codemod 0 thay thế (như trên tệp gốc). 17 → cha 5 + `CommentThreadItem` 6 + `CommentPendingList` 6 (`--raise`); sau đó `bg-[#F8FAF7]` của mục đang gửi → `bg-surface` (cùng giá trị; codemod để lại vì lý do "order" nhưng hai lớp nền ở hai nhánh của một toán tử ba ngôi, không bao giờ cùng phần tử) → `CommentPendingList` 5. `ring-[#7CB342]/40` (vòng tô sáng neo) GIỮ hex: `accent` là token chỉ để trang trí, `tests/focus-ring-no-secondary-green.test.ts` chặn mọi `ring-accent`.
- **Sau kiểm chứng độc lập (follow-up):**
  - C3 có phản hồi: `CommentPendingList` nhận `submitting`, nút "Thử lại" `disabled` + `disabled:opacity-50 disabled:cursor-not-allowed` (test đỏ trước khi sửa);
  - cờ `left` chặn MỌI tác dụng phụ của câu trả lời về sau khi rời trang: POST về sau khi rời trang không đọc lại luồng/không hẹn kiểm duyệt/không ghi state (chỉ dọn nháp của bình luận đã nhận); DELETE cũng vậy; lượt gửi hỏng về sau khi rời trang không lưu nháp. Ba test mới; bốn đột biến (bỏ từng `if (left) …`, bỏ `:disabled`) đều đỏ.
  - Test: 33 (bản gốc 25/29 trên 29 test ban đầu).
  - Độ phủ đo lại trên Node 24.21 (image `cdkt-cov:node24`, `TZ=Asia/Ho_Chi_Minh`, lệnh của CI, toàn bộ xanh): `app/composables` 73,19 % (5198/7102), `app/utils` 96,02 % (5590/5822) → mốc 73.19 / 96.01, không cao hơn số đo (mốc 73.14 trước đó đo trên Node 26). Các thư mục khác cũng RISE nhưng không do lô này — không nâng.
- **Khác biệt đã biết, chủ đích:** nháp video đang nằm dưới khoá cũ `cdkt:comment-draft:<slug>` lúc deploy không còn được phục hồi (chỉ sống trong tab, một lần).

## 2026-10-28 — `components/admin/ai/AiProvidersTab.vue` (1018 → 246)

Wave 3, task 4.2. Bản tách giữ lại. Khác kế hoạch 2026-10 ở trên (1026 → 824, cả 5 hộp thoại vào một `ProviderModals.vue` với 18 `defineModel`): mỗi hộp thoại một tệp, thẻ nhà cung cấp cũng tách.

- **Đường tách:**
  - 7 phần chỉ hiển thị trong `app/components/admin/ai/providers/` — props vào, sự kiện ra, `defineModel('form')` cho biểu mẫu, không phần nào gọi API, toast hay confirm:
    - `ProviderCardHeader` (108 dòng) — ô chọn, nhãn, Base URL, `••••` + 4 ký tự cuối của khoá, bốn nút, kết quả "Test kết nối";
    - `ProviderModelsPanel` (203) — bảng model, thanh model đã tích của nhà cung cấp đó, trạng thái rỗng, ước tính chi phí;
    - `ProviderCreateModal` (55), `ProviderEditModal` (66), `ModelAddModal` (54), `ModelEditModal` (55), `ModelTestCallModal` (70) — mỗi tệp một `AdminModal`.
  - Thao tác ghi + trạng thái của chúng → `useAiProviderWrites` (227) và `useAiModelWrites` (323), chuyển nguyên văn. `toast`/`confirm`/`reload`/`onInvalidate` do tab truyền vào; import tương đối (như `useModerationWorker`), nên test import thẳng được.
- **Giữ ở cha:**
  - hai danh sách, `loadProviders` + hai `adminFetch` — cha vẫn khớp `ADMIN_FETCH_CALL` nên vẫn nằm trong hai cổng phủ;
  - nhánh lỗi `role="alert"` + "Thử lại", khung chờ `v-if="providersLoading"` (ghim bởi `admin-error-retry-ui`/`skeleton-loading-ui`, không đổi);
  - thanh chọn nhiều nhà cung cấp, vỏ thẻ `v-for`;
  - trạng thái gập của từng thẻ — thẻ bị vẽ lại mỗi lượt tải, nên trạng thái phải sống ở cha;
  - 5 hộp thoại vẫn nằm trong `<template v-if="!providersLoading && !providersError">` (đang tải lại thì không vẽ hộp nào — có test ghim);
  - `defineExpose` đúng 3 khoá.

  Cha destructure mọi giá trị của hai composable ra hằng cấp cao nhất: `admin-fetch-rollout` chạy `<script setup>` của tab và đọc ~30 binding (kể cả `delifyUsage` không vẽ ở đâu).
- **Ép kiểu:** tệp gốc đã không còn `$fetch as` (chuyển sang `adminFetch` ở 7.1); `T` viết tay đi theo vào composable, ratchet `fetch-casts` không đổi. Chưa suy `T` từ handler: `test-call.post.ts` và `providers/[id]/test.post.ts` trả `ok: boolean` (không phải literal), union không thu hẹp được nếu không sửa handler.
- **Bốn lỗi sửa kèm** (`tests/admin-ai-providers-tab-findings.test.ts`, 7 test đỏ trên bản gốc VÀ trên bản tách thuần, xanh sau sửa):
  - P1 "Test kết nối" trên thẻ:
    - kết quả không bao giờ hiện trên thẻ — băng kết quả chờ `editingProvider?.id === p.id`, mà chỉ "Cài đặt" đặt `editingProvider`;
    - câu trả lời của A rơi vào hộp Cài đặt của B mở trong lúc chờ;
    - lượt thử đầu về trước tắt "Đang test..." của lượt thử sau.

    Gốc: kết quả và dấu "đang chạy" không gắn với nhà cung cấp. Nay có `testResultFor`, và chỉ lượt thử mới nhất được ghi.

    Kiểm chứng độc lập bắt một hồi quy (Medium) của bản sửa này: kết quả không bao giờ bị xoá. Thử khoá ĐÃ LƯU trong hộp Cài đặt báo "Thất bại" → gõ khoá mới → Lưu ("Đã lưu") → thẻ vẫn hiện băng đỏ cho cấu hình vừa thay; đóng hộp Cài đặt cũng để lại băng trên thẻ. Bản gốc không hiện cả hai.
    - Nay `forgetProbe(id)` xoá kết quả của nhà cung cấp đó khi lưu thành công, khi đóng hộp Cài đặt (`closeProviderEdit`), khi xoá nhà cung cấp, và khi lượt tải lại không còn nó.
    - Câu trả lời của lượt thử còn đang bay không hiện ở đâu, vì `testResultFor` đã về `null`; nó chỉ nhả "Đang test..." như bản gốc.
    - Ba test hành vi xanh trên bản gốc, đỏ trên `8961f77`: đóng bằng ✕/Huỷ, lưu, lượt thử đang bay lúc lưu.
    - Kết quả của lượt thử bấm từ THẺ vẫn ở trên thẻ (đó là P1) tới khi mở Cài đặt, lưu hoặc xoá.
  - P2 hàng xoá lẻ vẫn ở trong lựa chọn: "Đã chọn 1 nhà cung cấp" cho hàng đã mất (xoá hàng loạt khi đó trả 404), model thêm lại hiện sẵn dấu tích. Nay mỗi lượt tải thành công dọn lựa chọn theo danh sách mới.
  - P3 thanh model của MỘT nhà cung cấp xoá model đã tích ở MỌI nhà cung cấp, trong khi nút chỉ đếm của mình. Nay `bulkDeleteModels(provider)` chỉ xoá — và chỉ bỏ tích — model của nhà cung cấp đó. Chữ ký đổi, nên `admin-fetch-rollout` gọi `bulkDeleteModels('delify')`; request không đổi.
  - P4 lần bấm đầu "Thu gọn models" không làm gì: chưa có mục nghĩa là mở, nhưng nút lật "chưa có" thành MỞ.
- **Hành vi:** `tests/admin-ai-providers-tab.test.ts` (32 test viết TRƯỚC khi tách, nay 38).
  - Mount tab thật cùng các phần và composable trên DOM tối giản (`tests/_ai-providers-tab-harness.ts`), ofetch thật trên mạng giả trả lời như `server/api/admin/ai/**`. Luật "đổi Base URL phải nhập lại API key" chạy bằng `checkProviderBaseUrl` thật.
  - `AdminModal` thay bằng khung giả vẽ đủ tiêu đề, `busy` (khoá ✕), `size`, `icon`, footer — cùng khung cho bản gốc và bản tách.
  - Bản gốc 38/38, bản tách 38/38. `AI_PROVIDERS_TAB_FILE=<tệp>` chạy cùng bộ test trên bản khác.
  - 6 test thêm sau kiểm chứng độc lập: ba test của hồi quy ở trên, cùng ba test lấp đột biến còn sống:
    - "Bỏ chọn" của một nhà cung cấp chỉ bỏ tích model của nó (M54);
    - nút xoá hàng loạt model khoá khi đang chạy (M34);
    - mở lại "Thêm Model" không còn lỗi cũ (M30).
  - `tests/_sfc-mount.ts`: `mountSfc` trả thêm `instance` (đọc được `defineExpose`).
- **Chứng minh DOM không đổi** (`AI_PROVIDERS_TAB_DOM_LOG`, chạy một lần, không commit):
  - bản gốc vs bản tách thuần (commit `965aaa8`), chạy bộ test cuối cùng (38 + 7): 180/180 ảnh chụp giống hệt — DOM + request + toast + confirm + số lần `invalidate`;
  - sau sửa lỗi + sửa hồi quy: 172/180 giống hệt. 8 ảnh khác đúng ở bước lỗi lộ ra:
    - 7 test FINDING;
    - test khoá nút "Test kết nối": kết quả của lượt thử bấm TỪ THẺ nay hiện trên thẻ. Đó là P1 chủ đích, không phải hồi quy — hồi quy là kết quả của hộp Cài đặt sống quá lúc đóng/lưu, và ba test riêng ở trên chặn nó;
  - build: CSS Tailwind `entry.*.css` của build `d7593b2` và bản tách giống từng byte (cùng tập lớp);
  - ảnh chụp trình duyệt (hai build, CSDL e2e, API của tab trả lời ở trình duyệt nên không gọi ra ngoài, không khoá thật): 12 trạng thái × desktop 1440 + phone 390.
    - 19/24 trùng từng điểm ảnh: danh sách, rỗng, lỗi (desktop), thêm/sửa nhà cung cấp, xác nhận xoá, thêm/sửa model, kết quả Test Call, hai thanh đã chọn.
    - 4/24 khác đúng ở P1 (băng kết quả trên thẻ) và P4 (gập sau một lần bấm).
    - 1/24 (phone, lỗi) khác 10 điểm ảnh ở mức 1. Chạy lại chính bản tách cũng khác đúng chỗ đó, nên đây là nhiễu render.
- **Guard đọc cả họ tệp** (`AI_PROVIDERS_TAB_FAMILY` trong `tests/_component-family.ts`), mỗi guard có bằng chứng cấy lỗi:
  - `admin-fetch-rollout`: không `$fetch` ở cả họ (cấy vào phần, vào composable, vào phần mới đều đỏ);
  - `admin-modal-dialog`: 5 `AdminModal` ở 5 phần, tổng vẫn 23;
  - guard mới `admin-ai-providers-tab-source`:
    - API key chỉ là `v-model` của ô `type="password"` tĩnh — ô text, `:type` động, `{{ }}`, thuộc tính khác hay phần mới đều đỏ;
    - phần tách không gọi API/toast/confirm;
    - trong script của cả họ, API key chỉ được khai kiểu, đặt về `''` và gửi một lần trong body. Đưa khoá vào toast, `console`, lỗi, chuỗi mẫu hay bản sao đều đỏ, ở cả hai composable (M36).
- **Đột biến:** 16 đột biến ban đầu (M1–M16), sau cùng đều đỏ. M14 (tích theo nhãn thay vì mã model) và M15 (bỏ `:busy` ở hộp Thêm Model) sống ở lượt đầu — đã thêm test.
  - Sau kiểm chứng: M54, M34, M30, M36 đỏ nhờ test/guard mới.
  - Bỏ `forgetProbe` khi lưu (R1) và khi đóng hộp (R2): đỏ.
  - R3 (không bỏ lượt đang bay) và R4 (không nhả "Đang test...") SỐNG — hai bước đó thừa, nên đã gỡ khỏi `forgetProbe` thay vì giữ logic không ai kiểm.
- **Mã màu hex:** codemod 0 thay thế (như trên tệp gốc). 16 → cha 5 + `ProviderModelsPanel` 4 + `ProviderCreateModal` 3 + `ModelAddModal` 3 + `ProviderCardHeader` 1 (`--raise`).
- **Độ phủ** (Node 24.21, `cdkt-cov:node24`, lệnh của CI, toàn bộ xanh): `app/composables` 76,38 % (5878/7696) → mốc 76.37; sau sửa hồi quy đo lại 76,45 % (5903/7721) → mốc 76.45. Các thư mục khác RISE không do lô này — không nâng.
- **Việc sau** (ghim nguyên trạng hoặc chưa đụng):
  - xoá trống Base URL gửi `null`, máy chủ hiểu là "không đổi" mà trang vẫn báo "Đã lưu";
  - nhãn model `null` và `deleted` của `pricing/bulk-delete.post.ts` (trả số model GỬI lên): đã sửa phía máy chủ trên wave3/integration (R4). Khi gộp, cập nhật hai chỗ đóng vai máy chủ trong `tests/_ai-providers-tab-harness.ts` (đã ghi chú tại chỗ). Hiện không test nào phụ thuộc chỗ khác nhau đó;
  - tab không có trạng thái rỗng khi chưa có nhà cung cấp nào;
  - `selectAllProviders` không nơi nào gọi; `delifyUsage` được lưu nhưng không vẽ;
  - (Low) `loadProviders` không chặn lượt đọc cũ về sau lượt mới — hai thao tác liền nhau có thể vẽ lại danh sách cũ;
  - (Low) "Test" model chỉ có một ô `testingModelKey`: hai lượt gọi song song, lượt đầu về trước mở lại nút của lượt sau;
  - "Kiểm tra kết nối" thử cấu hình ĐÃ LƯU, không phải giá trị đang gõ.

## 2026-10-28 — `pages/admin/languages/index.vue` (756 → 310)

Wave 3, task 4.2. Bản tách giữ lại. Ba tab (`LanguagesListTab`/`TranslationsTab`/`UniversalTab` trong `components/admin/languages/`) là lần tách cũ của chính trang này, không đụng.

- **Đường tách:**
  - 3 phần chỉ hiển thị trong `app/components/admin/languages/page/` — props vào, sự kiện ra, không phần nào gọi API, toast hay confirm:
    - `LanguagesPageHeader` (77 dòng) — tiêu đề, "Đồng bộ key" / "Dịch tất cả còn thiếu" / "Nạp mặc định", dải lưu ý + "Làm mới CSDL" (hai gốc, không thẻ bọc: DOM như cũ);
    - `LanguagesMoveModal` (60) — hộp "chuyển đến vị trí nào?";
    - `LanguagesTranslateProgressModal` (106) — hộp "Tiến trình Dịch AI" (bận khi đang dịch, biểu tượng quay + `motion-reduce`).
  - `useLanguageWrites` (243) — thêm/bật-tắt/mặc định/xoá, ▲▼ + hộp chuyển vị trí, lưu + dịch AI một khoá, "Nạp mặc định", "Đồng bộ key". `useLanguageBatchTranslate` (201) — lượt dịch AI theo khối 10 khoá + "Dừng lại" + "Dịch tất cả còn thiếu" + trạng thái hộp tiến trình. Cả hai nhận `toast`/`confirm` và các lượt tải từ trang, import tương đối (test import thẳng).
  - Kiểu (viết tay như trang đã viết) → `app/types/admin-languages.ts` (32).
- **Giữ ở cha:** ba danh sách (`languages`, `translations`, `viTranslationsMap`) + bộ lọc của bảng; `fetchLanguages`/`fetchTranslations` (chỉ lượt mới nhất ghi)/`loadViSourceMap`/`loadData`; tab đang mở; khung chờ `v-if="loading && activeTab…"` + hai nhánh lỗi `role="alert"` + "Thử lại" (ghim bởi `admin-error-retry-ui`/`skeleton-loading-ui`, không đổi); "Bảng dịch"/"Xem thiếu" (đổi bộ lọc + cuộn lên — `window` chỉ có trong SFC); `aiTranslateAll`/`oneTimeTranslate` (hai dòng nối nút với lượt dịch). Cha destructure mọi giá trị composable mà `admin-fetch-rollout` đọc qua `<script setup>` của trang.
- **Ép kiểu:** tệp gốc không còn `$fetch as`; `T` viết tay đi theo vào composable, ratchet `fetch-casts` không đổi.
- **Hai lỗi sửa kèm** (`tests/admin-languages-page-findings.test.ts`: 8 test đỏ trên bản gốc — chạy bằng `LANGUAGES_PAGE_FILE` —, xanh sau sửa; 6 test viết trước cũng đỏ trên bản tách thuần `31dae81c`; 2 test canh không đổi hành vi khác xanh trên cả hai):
  - L1 nguồn tiếng Việt gửi cho AI đã cũ: trang đọc mọi hàng vi một lần (`viTranslationsMap`) rồi lấy `sourceText` từ đó. "Nạp mặc định" chèn hàng vi mới (đa số khoá mặc định chỉ có vi) mà không đọc lại → dịch khoá đó gửi chính TÊN khoá ("hotline") và lưu câu trả lời làm bản dịch; "Lưu"/"Dịch AI" một hàng vi rồi dịch khoá đó sang ngôn ngữ khác vẫn gửi chữ cũ. Nay "Nạp mặc định" tải lại cả ba (`loadData`), ghi vào hàng vi đọc lại nguồn vi; ghi ngôn ngữ khác không đọc thêm gì. Ghim request của "Nạp mặc định" trong `admin-fetch-rollout` thêm lượt đọc vi (có chú thích).
  - L2 hai lượt dịch AI cùng lúc: hộp tiến trình, nhật ký, cờ dừng chỉ có một; "Đóng cửa sổ" ẩn lượt đang chạy và để nút của mọi ngôn ngữ khác bật → lượt hai đặt lại tiến trình dưới lượt đầu (số đếm lẫn nhau, "Hoàn tất" khi một lượt còn chạy, "Dừng lại" không dừng được lượt đầu). Kể cả giữa hai ngôn ngữ của "Dịch tất cả" (lúc tải lại). Nay một lượt mỗi lúc (giữ suốt cả "Dịch tất cả", kể cả lượt tải lại GIỮA hai ngôn ngữ): bấm khi đang chạy mở lại hộp của lượt đang chạy + toast "Đang dịch AI cho … — chờ xong hoặc bấm "Dừng lại" rồi chạy tiếp.", không hỏi, không gửi gì. Nút "Dịch AI (n)" của ngôn ngữ khác vẫn bật (khoá hẳn cần đổi props của `LanguagesListTab`).
    - Sau kiểm chứng độc lập (V2): khoá và "Đang dịch..." của thẻ từng được nhả SAU lượt tải lại theo sau lượt dịch — hộp báo "✓ Hoàn tất" mà ngôn ngữ khác bị từ chối. Nay lượt dịch không tự tải lại; lượt một ngôn ngữ nhả khoá ngay khi khối cuối được trả lời, rồi mới tải lại (thứ tự request không đổi). Test đỏ → xanh; đột biến VL9 (nhả thẻ sau lượt tải lại) nay đỏ.
- **Hành vi:** `tests/admin-languages-page.test.ts` (32 test, viết TRƯỚC khi tách) mount trang thật cùng `LanguagesListTab`/`TranslationsTab` thật (`tests/_languages-page-harness.ts` trên `tests/_sfc-mount.ts`; `AdminModal` = `AdminModalStandIn` của harness tab nhà cung cấp; `UniversalTab`/`SkeletonTable` là khung giả), ofetch thật trên mạng giả trả lời như `server/api/admin/languages/**` (AI giả trả lại chính `sourceText` nên nguồn sai lộ ra). Bản gốc 32/32, bản tách 32/32. `LANGUAGES_PAGE_FILE=<tệp>` chạy cùng bộ test trên bản khác.
- **Chứng minh DOM không đổi** (`LANGUAGES_PAGE_DOM_LOG`, một lần, không commit): bản gốc vs bản tách thuần, cả 38 test: 136/136 ảnh chụp giống hệt (DOM + request + toast + confirm + `scrollTo`). Sau hai bản sửa, 32 test hành vi: 105/106 giống hệt, 1 khác đúng ở request (lượt đọc vi sau "Nạp mặc định" — L1).
- **Build + trình duyệt** (chung cho hai trang tách ở 4.2; build `0778e988` vs HEAD sau mọi bản sửa, chạy một lần, không commit):
  - mọi tệp CSS trong `.output/public/_nuxt/` giống từng byte (băm nội dung; `entry.*.css` 159 930 byte);
  - bộ E2E đầy đủ trên build HEAD: 116/116 xanh (5,0 phút), gồm `admin-dialogs` với `AdminModal` thật trên cả hai trang (hộp chuyển vị trí, hộp tiến trình dịch AI, "Cấu hình trang", ngăn "Phiên bản": giữ Enter không tự lưu, hộp xác nhận đè lên ngăn, `inert`, trả focus);
  - ảnh chụp (CSDL e2e, API của hai trang trả lời ở trình duyệt, khung xem trước của trình dựng là một trang tĩnh): 8 trạng thái `/admin/languages` (danh sách, lỗi tải, bảng bản dịch, hộp chuyển vị trí, hộp tiến trình đang chạy / xong, xác nhận xoá, biểu mẫu thêm) + 9 trạng thái trình dựng (xem dưới) × desktop 1440 + phone 390 = 34 ảnh. Bản gốc vs bản tách: 30/34 trùng từng điểm ảnh; 2 khác đúng ở FINDING-B1 (ngăn Phiên bản đọc hỏng); 2 khác ≤ 1 mức ở vài chục điểm (ngăn "Thêm khối", bảng bản dịch, desktop) — hai lần chụp CHÍNH bản gốc cũng khác đúng các điểm đó (nhiễu render), và lần chụp gốc thứ hai trùng bản tách ở cả hai.
- **Guard theo phần tách** (`LANGUAGES_PAGE_FAMILY` trong `tests/_component-family.ts`), mỗi guard có bằng chứng cấy lỗi:
  - `admin-fetch-rollout`: không `$fetch` ở cả họ (cấy vào phần, composable, phần mới đều đỏ);
  - `admin-modal-dialog`: 2 `AdminModal` sang 2 phần (tổng vẫn 23); regex `:icon` quay của hộp tiến trình đọc phần tách, trang phải vẽ `<LanguagesTranslateProgressModal` và không còn `<AdminModal`;
  - guard mới `tests/admin-split-pages-source.test.ts`: phần tách không gọi API/toast/confirm; trang vẫn khớp `ADMIN_FETCH_CALL` và giữ đúng 2 `role="alert"`;
  - `admin-languages-search-focus` cấp khung giả cho 3 phần mới (bộ test của nó dựng trang bằng trình biên dịch riêng, ném lỗi khi gặp `.vue` lạ).
- **Đột biến:** 21 đột biến (LM1–LM21, trên bản sao reflink, không đụng worktree), cả 21 đỏ — gồm bỏ `role="alert"`, "Thử lại" gọi nhầm hàm, bỏ `:disabled`/`:busy`/`size`/biểu tượng quay, lệch vị trí chuyển, "Dừng lại" chỉ đóng, bỏ từng nhánh khoá/nhả khoá của L2, đảo/bỏ lượt đọc vi của L1, phần tách gọi toast. LM21 (không nhả khoá sau "Dịch tất cả") sống ở lượt đầu → thêm test rồi đỏ.
- **Mã màu hex:** codemod 0 thay thế (như trên tệp gốc). 9 → trang 0 + `LanguagesPageHeader` 3 + `LanguagesTranslateProgressModal` 6 (`--raise`, dời nguyên).
- **Việc sau / còn mở (ghim nguyên trạng):**
  - toast "Đã hoàn tất dịch X/Y key" đếm khoá ĐÃ XỬ LÝ, kể cả khối lỗi ("Lỗi dịch") — cần quyết định câu chữ;
  - (Low) `fetchLanguages` không chặn lượt đọc cũ về sau lượt mới; `translatingSingleKey` một ô cho hai lượt dịch khoá song song;
  - `reordering` được đặt nhưng không vẽ ở đâu (▲▼ không khoá khi đang lưu thứ tự).

## 2026-10-28 — `pages/admin/content/pages/[id].vue` — trình dựng trang (795 → 394)

Số dòng dưới đây đo ở bản tách đầu (trang 386); sau hai bản sửa của kiểm chứng độc lập trang 394, `PageBuilderTopBar` 76, `PageVersionsDrawer` 124, `usePageVersions` 122, `usePageMeta` 60; `useLanguageBatchTranslate` (mục trên) 209.

Wave 3, task 4.2. Bản tách giữ lại. `BuilderCanvas`/`PropertyPanel`/`BlockTreeNode`/`BuilderArrayEditor` (tách cũ, `components/admin/builder/`) và `TinyMceEditor.vue` không đụng (`git diff 0778e988 -- app/components/admin/builder app/components/admin/TinyMceEditor.vue` rỗng). Không `v-html` nào trong cả họ trước và sau.

- **Đường tách:**
  - 4 phần chỉ hiển thị trong `app/components/admin/page-builder/`: `PageBuilderTopBar` (71 — kèm phép suy trạng thái lưu từ `draftStatus`/`publishing`/`hasUnpublished`), `BlockPaletteDrawer` (41), `PageMetaModal` (49, `v-model:form`), `PageVersionsDrawer` (119, `v-model:label`, Enter qua `isDeliberateEnter`).
  - `useBuilderTreeEdits` (169 — bảng chọn + thêm khối theo ngữ cảnh, nhân đôi, ẩn/hiện, xoá, di chuyển), `usePageVersions` (117 — sao lưu, bản gốc, khôi phục, xoá phiên bản), `usePageMeta` (57).
  - Hàm cây thuần → `app/utils/blocks/builder-tree.ts` (112: `findNode`/`locateNode`/`strip`/`hydrateNodes`/`makeNode`/`cloneSubtree`/`serializeNodes` + `createTmpIds`) — cây truyền vào thay cho mặc định `blocks.value`; bộ đếm `tmp_*` vẫn một bộ mỗi trang. `VERSION_KIND_META` + định dạng ngày → `app/utils/page-builder/versions.ts` (17). Cả hai ở thư mục con của `utils/` nên Nuxt không auto-import.
- **Giữ ở cha:** trang + cây đang dựng + lựa chọn + `provide('builderTree')`; `fetchPage` + khung chờ 3 cột vẽ tại chỗ (`INLINE_PLACEHOLDER_FILES`) + nhánh lỗi `role="alert"` + "Thử lại"; CẢ vòng đời bản nháp như một khối (`hydrating`, hẹn giờ 800 ms, `saveDraft`, `watch(blocks, deep)`, xuất bản, huỷ sửa, `loadWorkingCopy` cho bản khôi phục); danh sách phiên bản + `loadVersions` (chỉ lượt mới nhất ghi). Composable gọi SAU khi `scheduleDraftSave`/`draftPayload`/`loadWorkingCopy` đã khai (tránh TDZ).
- **Ép kiểu:** không còn `$fetch as` từ 7.1 lô B; kiểu suy từ handler (`app/types/admin-pages-api.ts`) đi theo vào composable. Một chú thích có chữ "`$fetch`" đổi chữ để guard quét `$fetch` của cả họ không bắt nhầm.
- **Hai lỗi sửa kèm** (`tests/admin-page-builder-findings.test.ts`; 11/12 test đỏ trên bản gốc — test còn lại kiểm "tải xong thì mọi nút về" —, xanh sau sửa):
  - `FINDING-B1` — danh sách phiên bản CHƯA BIẾT trông như "không có phiên bản". Đọc hỏng: chỉ báo bằng toast rồi ngăn kéo hiện "Chưa có phiên bản nào", đếm "Lưu (0/4)" và đổi nút bản gốc thành "Chỉ định làm bản gốc" với lời hỏi "Đặt … làm bản gốc" — đồng ý là GHI ĐÈ bản gốc đang có mà không được cảnh báo như "Cập nhật bản gốc". Đang tải (lần mở đầu, "Thử lại" đang bay) cũng vậy. Nay trang giữ `versionsError`: lỗi + "Thử lại" (chỉ đọc lại danh sách) do trang vẽ qua slot `#error` của ngăn (`role="alert"` ở tệp trang — `admin-error-retry-ui` ghim thêm `versionsError`/`loadVersions`), thay chỗ danh sách (danh sách cũ và nút "Khôi phục"/xoá của nó không vẽ dưới ô lỗi); "Lưu (n/4)", Enter và nút bản gốc TẮT khi chưa biết danh sách (đang tải hoặc đọc hỏng); lỗi đọc lại sau một lượt ghi hiện cùng cách, toast thành công của lượt ghi đứng nguyên. Bản sửa đầu (`0d8f1ec3`) chỉ phủ "đọc hỏng" — kiểm chứng độc lập (V1) chỉ ra khoảng "đang tải"; phủ ở `6fe9c4a2`. Test "chỉ danh sách mới nhất" từng dựng hai lượt đọc chồng bằng nút "Lưu" lúc đang tải (nay tắt đúng chủ đích): dựng lại bằng nút xoá trên danh sách cũ lúc đang tải lại.
  - `FINDING-B2` (có từ bản gốc, kiểm chứng V3) — thao tác trên trang trước khi trang tải xong. Thanh trên nằm ngoài nhánh tải/lỗi, và khi chưa tải gì phép so "có gì để xuất bản" (cây rỗng với mốc `''`) trả lời có: đang tải, tải hỏng hoặc "Thử lại" đang bay thì "Xuất bản" bật và gửi `POST …/publish { blocks: [] }` (trang thật bị xuất bản RỖNG; máy chủ nhận mảng rỗng), "Hủy sửa" xoá bản nháp trên máy chủ, "Cấu hình" mở biểu mẫu trống mà "Lưu" ghi SEO trống đè lên, "Phiên bản" cho cây rỗng thành bản gốc. Nay trang có cờ DƯƠNG `loaded` (đặt khi tải thành công, xoá khi bắt đầu tải — mẫu trình soạn bài 7.1 lô D), hai lớp mỗi lớp có test: nút "Hủy sửa"/"Phiên bản"/"Cấu hình"/"Xuất bản" tắt khi chưa có; `publish`, `discardDraft`, `scheduleDraftSave`, `openVersions`, `openMeta` tự kiểm (bấm vượt nút tắt không làm gì; một sửa đổi tới sau lượt tải lại hỏng không được lưu nháp). Máy chủ không đổi.
- **Hành vi:** `tests/admin-page-builder.test.ts` (39 test, viết TRƯỚC khi tách) mount trang thật + `BlockTreeNode` thật (đi qua `inject('builderTree')`) (`tests/_page-builder-harness.ts`); `BuilderCanvas` (iframe xem trước) và `PropertyPanel` (TinyMCE, chọn ảnh) là khung giả mang đúng props/sự kiện + thanh thao tác của panel (cùng tiêu đề, cùng luật khoá) + một ô sửa `block.data.title` tại chỗ như ô thật. Ghim: request + cây tuần tự hoá (nhiều cấp, `colSpan`, `displayOrder` theo cấp), nhịp 800 ms, không lưu ngược khi nạp/khôi phục/xuất bản/huỷ, lượt lưu đang chờ bị bỏ khi xuất bản/huỷ, HTML rich-text đi nguyên văn tới máy chủ (máy chủ lọc — `sanitizeBlockData`, không nới). Bản gốc 39/39, bản tách 39/39. `PAGE_BUILDER_FILE=<tệp>` chạy cùng bộ test trên bản khác.
- **Chứng minh DOM không đổi** (`PAGE_BUILDER_DOM_LOG`): bản gốc vs bản tách thuần, cả 43 test: 157/157 ảnh chụp giống hệt. Sau B1, 39 test hành vi: 121/148 giống hệt; 27 khác đúng hai thuộc tính thêm vào nút bản gốc (`disabled=false` + `disabled:opacity-50`) — bỏ đúng hai thuộc tính đó thì 148/148. Ảnh chụp trình duyệt (cùng lượt với `/admin/languages` ở trên): không gian làm việc, khung chờ, lỗi tải, ngăn "Thêm khối", "Cấu hình trang", "Phiên bản", "Phiên bản" đọc hỏng (khác đúng B1), trạng thái nháp, xác nhận xoá khối.
- **Guard theo phần tách** (`PAGE_BUILDER_FAMILY`), mỗi guard có bằng chứng cấy lỗi:
  - `admin-modal-dialog`: 3 `AdminModal` sang 3 phần (tổng vẫn 23); `isDeliberateEnter(` ghim ở `PageVersionsDrawer` và chặt hơn trước — mọi `@key…enter` của ngăn phải đúng `@keydown.enter="onBackupLabelEnter"`, hàm đó kiểm `isDeliberateEnter` trước, trang không còn ô bắt Enter;
  - `admin-split-pages-source`: phần tách không gọi API/toast/confirm; trang giữ đúng 2 `role="alert"` (trang + danh sách phiên bản); cả họ không `$fetch` và không `v-html`/`innerHTML`;
  - `cms-core-content` (kiểu `BuilderNode` import ở trang), `skeleton-loading-ui`, `admin-fetch-rollout-page-builder` (13 test, mount trang thật — phần tách nạp thật) xanh không sửa.
- **Đột biến:** 25 (PM1–PM25), 24 đỏ. PM25 (bỏ `scheduleDraftSave()` trong ẩn/hiện) SỐNG vì tương đương: `watch(blocks, deep)` hẹn đúng lượt lưu đó — các lời gọi `scheduleDraftSave()` tường minh trong thao tác cây là thừa, giữ nguyên văn. Kiểm chứng độc lập thêm hai đột biến sống, nay có test: VP5 (danh sách cũ vẽ dưới ô lỗi) và VP4 (`colSpan` ngoài 1–12 từ máy chủ không bị kẹp — cây hiện độ rộng đã kẹp).
- **Hành vi đổi có chủ đích, ngoài phần tách:** ngăn Phiên bản báo lỗi tải tại chỗ thay cho toast; nút bản gốc mang `disabled`; "Lưu (n/4)"/Enter/nút bản gốc tắt khi danh sách đang tải hoặc đọc hỏng; "Hủy sửa"/"Phiên bản"/"Cấu hình"/"Xuất bản" tắt (mờ) cho tới khi trang tải xong — kể cả ở khung đầu do máy chủ render (cờ khởi tạo `false`; harness `serverRender()` ghim, đột biến `loaded = ref(true)` đỏ).
- **Sau các sửa của kiểm chứng độc lập** (một lần, không commit): đột biến mới 20/20 đỏ (NM1–NM18 cho ba sửa + VP4/VP5 của người kiểm); DOM log bản `42bcbba7` vs HEAD với bộ test hiện tại: `/admin/languages` 106/106 giống hệt; trình dựng 145/150 sau khi bỏ đúng hai thuộc tính B2 thêm vào nút thanh trên (`disabled=false`, `disabled:opacity-50`), 5 khác đúng ở thanh trên lúc tải/tải hỏng (B2) và ngăn Phiên bản lúc đang tải (B1); CSS build giống từng byte với base; E2E đầy đủ 116/116; ảnh chụp 26/34 trùng từng điểm ảnh với base — khác: lúc tải + lỗi tải × 2 khổ (bốn nút thanh trên mờ, B2), ngăn Phiên bản đọc hỏng × 2 (B1), và nhiễu ≤ 2 mức (khử răng cưa góc bo nút, như giữa hai lần chụp chính bản gốc).
- **Mã màu hex:** trang và mọi phần 0 (codemod 0 thay thế).
- **Độ phủ** (chung cho hai trang; Node 24.21, image `cdkt-cov:node24`, `TZ=Asia/Ho_Chi_Minh`, lệnh của CI, toàn bộ xanh): `app/composables` 78,48 % (6677/8508) → mốc 78.47; `app/utils` 96,48 % (5748/5958) → mốc 96.47. `shared` cũng RISE (99,48 %) nhưng không do lô này — không nâng.
- **Việc sau / còn mở (ghim nguyên trạng):**
  - `adding` không bao giờ thành `true` (bảng chọn không có trạng thái bận thật); `blockPreviewText` không ai dùng — dời nguyên văn;
  - (Low) hai lượt lưu nháp chồng nhau trên mạng chậm có thể tới máy chủ ngược thứ tự (bản nháp cũ hơn thắng);
  - bố cục 3 cột không có dạng điện thoại;
  - hẹn giờ lưu nháp 800 ms không dọn lúc rời trang (lượt lưu vẫn chạy sau khi rời — giữ nguyên văn, kiểm chứng độc lập xác nhận không phải hồi quy).

## 2026-10-29 — `pages/news/index.vue` — danh sách bản tin `/news` (724 → 348)

Wave 3, task 4.2 (trang công khai). Bản tách giữ lại. Bản tách thuần 337 dòng; 348 sau ba bản sửa.

- **Đường tách:** 10 phần chỉ hiển thị trong `app/components/news/` — props vào, sự kiện ra, import tường minh từ trang (như ArticleDetail), không phần nào đọc dữ liệu hay điều hướng:
  - `NewsListHero` (52 — đường dẫn, huy hiệu, `<h1>` duy nhất của trang), `NewsSearchBox` (46 — `v-model` = `searchInput`, `submit`/`clear`), `NewsCategoryPills` (77 — viên chuyên mục gốc + chuyên đề, hai gốc như `<template v-else>` cũ);
  - `NewsFeaturedCard` (76), `NewsArticleGrid` (100 — tiêu đề "Danh sách bản tin" + lưới; hai `v-if` nằm trong phần, trang vẽ phần vô điều kiện để hai chỗ giữ `<!--v-if-->` không đổi), `NewsPagination` (69 — `go(page)` → `setPage`);
  - cột phải: `NewsMostReadList` (25 — danh sách đã tải), `NewsCategoryWidget` (54), `NewsHotlineWidget` (37), `NewsQuickLinksWidget` (61).
  - `categoryIcon` + ngày của thẻ → `app/utils/news/list-display.ts` (18; thư mục con nên Nuxt không auto-import — ContentTypeListSection/ContentTypeSidebar có `categoryIcon` riêng).
- **Giữ ở trang:** mọi lượt đọc — danh sách và "Đọc nhiều" qua `usePublicArticleList`/`usePublicMostRead` (URL là nguồn chân lý, khoá suy từ query không đổi), chuyên mục qua `useAsyncData` (ép kiểu `$fetch` duy nhất ở lại: phía công khai chưa có helper có kiểu; ratchet `fetch-casts` không đổi); cây chuyên mục (`activeRoot`/`activeChildren`/tên/tiêu đề); dải kết quả tìm kiếm; khung chờ + thẻ lỗi `role="alert"` + "Thử lại ngay" (`refresh()`) + hai trạng thái rỗng (không có bài / `?page` vượt trang cuối); chip chờ của thanh lọc; khung chờ + dòng rỗng (và nay nhánh lỗi) của "Đọc nhiều"; mỏ neo `#news-list-top`. `routeRules` không đụng (`/news` trần vẫn KHÔNG cache), `lazy: true` giữ, SEO giữ.
- **Hành vi:** `tests/news-index-page.test.ts` (31 test, viết TRƯỚC khi tách) mount trang thật + các phần thật (`tests/_news-page-harness.ts` trên `tests/_sfc-mount.ts`): `usePublicArticleList` thật, ofetch thật trên mạng giả trả lời như `/api/public/articles` và `/api/public/categories` (kể cả luật dịch tên chuyên mục theo `?lang=`), `useAsyncData` giả theo Nuxt 4.6.1 — khoá phản ứng (`flush: 'sync'`), `watch` bỏ lượt cùng nhịp đổi khoá, lượt mới nhất thắng, **đặt `data` về `default()` khi lượt đọc hỏng** (`asyncData.js:419`; thiếu điều này thì hai lỗi N2/N3 dưới đây không hiện). ofetch tự thử lại một lần GET 503 như trên trình duyệt — test đếm theo đó. Bản gốc 31/31, bản tách 31/31. `NEWS_PAGE_FILE=<tệp>` chạy cùng bộ test trên bản khác.
- **Chứng minh DOM không đổi** (`NEWS_PAGE_DOM_LOG`, một lần, không commit): bản gốc vs bản tách thuần, 31 test: 49/49 ảnh chụp giống hệt (DOM + request + điều hướng + SEO); 5 test FINDING (đỏ trên cả hai): 6/6 giống hệt. Sau ba bản sửa: 48/49 giống hệt sau khi chuẩn hoá đúng một điều (`lang=vi` thêm vào request chuyên mục — N1), 1 khác đúng ở bước sau đổi ngôn ngữ (tên chuyên mục tiếng Anh — N1).
- **Ba lỗi sửa kèm** (`tests/news-index-page-findings.test.ts`, 5/5 đỏ trên bản gốc VÀ trên bản tách thuần, xanh sau sửa):
  - `FINDING-N1` — tên chuyên mục không bao giờ theo ngôn ngữ. Trang đọc `/api/public/categories?type=news` dưới khoá cố định `'news-categories'`, không gửi `lang`: máy chủ lùi về cookie `cdkt_lang` — mà `$fetch` lúc dựng phía máy chủ không mang cookie (hành vi Nuxt có ghi trong tài liệu: `useRequestFetch` tồn tại chính vì `$fetch` không chuyển tiếp header của request; nửa này không có test, test FINDING chỉ chứng minh nửa phía client) — và đổi ngôn ngữ không bao giờ đọc lại. Người đọc tiếng Anh thấy viên chuyên mục, mục "Chuyên mục" ở cột phải, đường dẫn và tiêu đề (`?cat=` cũ) bằng tiếng Việt, trong khi `/news/<chuyên mục>` (ContentTypeListSection) hiện tiếng Anh. Cùng lớp với D25 của "Đọc nhiều". Nay `lang` đi trong query và trong khoá (`news-categories-<lang>`): đổi ngôn ngữ đọc lại đúng một lần (khoá đổi là Nuxt đọc lại, không cần `watch`), chip chờ hiện trong lúc đọc như lúc đổi chuyên mục.
  - `FINDING-N2` — tìm kiếm hỏng đọc như "0 kết quả": Nuxt đặt `data` về `default()` khi lượt đọc hỏng, dải tìm kiếm hiện số đếm mỗi khi không còn chờ → "«abc» (0 bài viết)" ngay trên thẻ lỗi. Nay không đếm khi `loadError`.
  - `FINDING-N3` — "Đọc nhiều" hỏng đọc như "Chưa có dữ liệu lượt xem." (cùng cơ chế đặt lại), không có cách thử lại. Gốc: `usePublicMostRead` không cho biết lượt đọc hỏng. Nay nó trả thêm `mostReadFailed` + `retryMostRead` (cộng thêm, bốn nơi dùng khác không đổi); trang hiện `role="alert"` "Đã xảy ra lỗi khi kết nối dữ liệu máy chủ. Thử lại" (khoá có sẵn `n_load_error_desc` + `retry`, không thêm khoá i18n) và "Thử lại" chỉ đọc lại khối này.
- **Guard theo phần tách** (`NEWS_PAGE_FAMILY` trong `tests/_component-family.ts`), mỗi guard có bằng chứng cấy lỗi trong bộ test:
  - `skeleton-loading-ui`: luật `motion-reduce` theo từng thẻ đọc cả họ (chấm nhấp nháy của hero sang `NewsListHero`); cấy `animate-pulse` trần vào hero hoặc vào một phần mới → đỏ;
  - guard mới `tests/public-split-pages-source.test.ts`: phần tách và `list-display.ts` không đọc dữ liệu/điều hướng (`$fetch`, `useAsyncData`, `navigateTo`, `useRoute`, hai composable danh sách); trang giữ khung chờ, thẻ lỗi + `refresh()`, đúng 2 `role="alert"` (danh sách, "Đọc nhiều"), chip chờ, khung chờ "Đọc nhiều"; cả họ không `v-html`.
- **Đột biến:** 19 (NM1–NM19, trên bản sao reflink), cả 19 đỏ — gồm "Thử lại ngay" gọi nhầm hàm, bỏ `role="alert"`, hoàn nguyên từng bản sửa N1 (khoá cố định; bỏ `lang`) / N2 / N3 (cờ luôn sai; thử lại đọc nhầm danh sách; nhánh lỗi không bao giờ hiện), phân trang nhảy hai trang, ✕ luôn hiện, chuyên đề không bao giờ nhấn, chấm hero mất `motion-reduce`, tiêu đề đếm số thẻ thay vì cả danh sách, ngày thô, kiểu "đang chọn" đảo, top-3 thành top-2, một phần tự `$fetch`, chuyên mục bỏ `lazy`, ngày ưu tiên `createdAt`.
- **Mã màu hex:** codemod 0 thay thế (bản gốc cũng 0: 52 unmapped + 1 order + 1 order-merge). 54 → trang 8 + 9 phần 46 (`--raise`, dời nguyên; `NewsMostReadList` 0). Không thêm màu: nhánh lỗi mới dùng `text-danger-soft`/`text-brand-600`.
- **Việc sau / còn mở (ghim nguyên trạng):**
  - bốn nơi khác dùng `usePublicMostRead` (`ContentTypeListSection`, `NewsCategoryList`, `ModelArticlesListPage`, `ContentTypeSidebar`) vẫn hiện "chưa có dữ liệu" khi lượt đọc hỏng — nay chỉ cần đọc `mostReadFailed`;
  - lượt đọc chuyên mục hỏng: thanh lọc chỉ còn "Tất cả bản tin" và mục "Chuyên mục" ở cột phải biến mất, không báo lỗi, không thử lại (không nói sai điều gì, nhưng người đọc mất bộ lọc mà không biết vì sao).

## 2026-10-29 — `pages/profile.vue` — trang cá nhân của người đọc `/profile` (741 → 389)

Wave 3, task 4.2 (trang công khai, KHÔNG có `routeRules` — mọi dữ liệu nạp sau mount trong `<client-only>`). Không phải `/admin/profile` (mục 2026-10-26 ở trên). Bản tách giữ lại. Bản tách thuần 375 dòng; 389 sau ba bản sửa.

- **Đường tách:**
  - 11 phần chỉ hiển thị trong `app/components/reader-profile/` — props vào, sự kiện ra, import tường minh từ trang, không phần nào gọi API hay chạm kho của người đọc (`useReaderAuth`/`useReaderNotifications`/`useReadingHistory`, `localStorage`):
    - `ReaderProfileHero` (21 — `<h1>` duy nhất), `ReaderProfileSignIn` (26 — khối mời đăng nhập, `sign-in`), `ReaderProfileIdentity` (82 — ảnh đại diện, tên, email, biểu mẫu đổi tên `v-model` + lỗi `role="alert"`/"đã lưu"; hai hằng `DISPLAY_NAME_*` đi theo);
    - `ReaderProfileNotificationsHeader` (23), `ReaderProfileEmailSwitch` (57 — công tắc email + lỗi `role="alert"`), `ReaderProfileNotificationList` (58 — `resolveComponent('NuxtLink')` đi theo, `open` → đánh dấu đã đọc ở trang), `ReaderProfilePager` (36 — dùng chung cho thông báo và bình luận: trang nào/khi nào tắt do trang quyết);
    - `ReaderProfileCommentList` (40 — thân bình luận `whitespace-pre-line break-words`), `ReaderProfileHistory` (98 — cả khối "Bài đã đọc" + câu "lưu trên thiết bị này" + `formatReadAt`), `ReaderProfileChatList` (18), `ReaderProfileChatClaim` (38).
  - Lượt ghi + trạng thái của chúng → `useReaderNameEdit` (65), `useReaderEmailPreference` (46), `useReaderChatClaim` (55) — chuyển nguyên văn, nhận request dưới dạng hàm và các móc `applyDisplayName`/`applyEmailPreference`/`forgetReader`/`claimChats` của chính `useReaderAuth` mà trang giữ (một composable tự gọi `useReaderAuth()` cũng ra cùng trạng thái cấp module — nhưng 401 của nó sẽ nằm ngoài tầm nhìn của trang). Import tương đối.
- **Giữ ở trang:** danh tính; mọi lượt nạp sau mount (`onMounted` → `loadReader` rồi ba lượt song song, 401 bắt riêng); bốn ép kiểu `$fetch` (hai lượt đọc, hai lượt ghi trao cho composable — ratchet `fetch-casts` không đổi); khung chờ + nhánh lỗi `role="alert"` + "Thử lại" + nhánh rỗng của thông báo / bình luận / đoạn chat (ghim bởi `reader-profile-page`); phân trang; `<client-only>`.
- **`formatReadAt` đi theo khối lịch sử** sang `ReaderProfileHistory.vue`, và miễn trừ "giờ địa phương" của `public-pages-structure` đi theo (vẫn đếm đúng 3). Hai tiền đề của miễn trừ được kiểm lại theo tệp mới: phần chỉ do `pages/profile.vue` vẽ, đúng một lần, nằm giữa `<client-only>` và `</client-only>`; không tệp nào khác nhắc tới nó; không `formatDateVN(item.readAt)` (bằng chứng cấy lỗi: đặt ra ngoài `client-only`, bỏ `client-only`, trang khác vẽ, đổi sang `formatDateVN`).
- **Hành vi:** `tests/reader-profile-page-behavior.test.ts` (27 test, viết TRƯỚC khi tách) mount trang thật + các phần thật (`tests/_reader-profile-harness.ts`): `useReaderAuth`/`useReaderNotifications`/`useReadingHistory` THẬT, mỗi lần mount một bản mới (`?mount=N` — trạng thái cấp module không rò giữa test), ofetch thật trên mạng giả trả lời như `server/api/public/reader/**` (`requireReader` → 401 "Chưa đăng nhập"), `localStorage`/`sessionStorage` trong bộ nhớ; `NuxtLink` đăng ký làm khung giả để `<nuxt-link>` trong template và `resolveComponent('NuxtLink')` tới cùng một component (như Nuxt — để trống thì tên thẻ trong DOM log phụ thuộc việc tệp có khai biến `NuxtLink`). Bản gốc 27/27, bản tách 27/27. `READER_PROFILE_FILE=<tệp>` chạy cùng bộ test trên bản khác.
- **Chứng minh DOM không đổi** (`READER_PROFILE_DOM_LOG`): bản gốc vs bản tách thuần: 67/67 (27 test hành vi) + 14/14 (6 test FINDING, đỏ trên cả hai) giống hệt. Sau ba bản sửa: 67/67 giống hệt (cả ba lỗi chỉ ở nhánh hỏng, bộ hành vi không đi qua).
- **Ba lỗi sửa kèm** (`tests/reader-profile-page-findings.test.ts`, 6/6 đỏ trên bản gốc VÀ trên bản tách thuần, xanh sau sửa):
  - `FINDING-R1` — "Nhận các đoạn chat trên thiết bị này" báo điều nó không biết. `claimChats()` nuốt mọi lỗi (đúng cho lượt nhận ngầm ở mỗi trang), và nút đọc kết quả chỉ từ danh sách nạp lại: lượt nhận không tới được máy chủ (503, mất mạng) vẫn báo "Đã gắn 2 đoạn trò chuyện vào tài khoản của bạn." (hoặc "Không tìm thấy…" khi danh sách rỗng); khi danh sách nạp lại hỏng, câu được tính từ danh sách CŨ, nằm ẩn sau nhánh lỗi và hiện ra — sai số — khi "Thử lại" đưa danh sách về. Gốc: `claimChats` nay TRẢ `ClaimOutcome` (`skipped`/`nothing`/`sent`/`failed`), vẫn không ném — lượt ngầm (`void claimChats()`) không đổi; `useReaderChatClaim`: `failed` → `role="alert"` "Không thể gắn các đoạn trò chuyện vào tài khoản. Vui lòng thử lại.", danh sách hỏng → không câu nào (nhánh lỗi của danh sách nói).
  - `FINDING-R2` — "Trước"/"Sau" của thông báo gọi thẳng loader từ template; loader ném lại đúng 401, nên vé hết hạn giữa lúc lật trang thành lỗi không ai bắt và trang vẫn "đã đăng nhập" trên một danh sách hỏng (mọi lượt nạp khác của trang đổi 401 thành khối đăng nhập). Nay qua `showNotificationPage` (401 → `forgetReader`), "Thử lại" dùng chung.
  - `FINDING-R3` — phân trang bình luận đọc hai trang khác nhau: nhãn theo trang đang hiện (`commentsData.page`), nút đếm từ trang đã xin (`commentsPage`). Trang 2 hỏng → "Trang 1 / 3", "Trước" bật, "Sau" xin trang 3 (bỏ qua trang vừa hỏng). Nay nhãn và nút cùng đếm từ trang đang hiện (`commentsShownPage`); "Thử lại" vẫn xin đúng trang hỏng.
- **Guard theo phần tách** (`READER_PROFILE_FAMILY`), mỗi guard có bằng chứng cấy lỗi trong bộ test:
  - `reader-profile-page`: hai loại luật — chuỗi nhánh tải/lỗi/rỗng + ref lỗi + hàm thử lại + khung chờ + `<client-only>` đọc TRANG (dời vào phần là đỏ); luật "không ở đâu"/"ở đâu đó" đọc cả họ: không `v-html`, không `useFetch`/`useAsyncData`, không `location.reload()`, `motion-reduce` theo từng thẻ, bất đối xứng 401/403 (kể cả hai composable ghi), thân bình luận giữ `whitespace-pre-line`/`break-words` (ghim đúng phần tử `{{ item.body }}`), câu "lưu trên **thiết bị này**" (chặt hơn trước: `/thiết bị này/` trần cũng khớp nút nhận đoạn chat);
  - `public-pages-structure`: như trên;
  - `public-split-pages-source`: phần + composable không `$fetch`, không gọi ba kho người đọc, không `localStorage`/`sessionStorage`/`navigateTo`; trang giữ ba kho, đúng 4 ép kiểu, đúng 3 `role="alert"`.
- **Đột biến:** 20 (PM1–PM20, trên bản sao reflink), cả 20 đỏ — gồm "Thử lại" gọi nhầm hàm, bỏ `role="alert"`, 401 không quên danh tính / 403 lại quên, ghi chú "đã lưu" không rụng khi gõ tiếp, công tắc đổi trước khi máy chủ trả lời, "Lưu tên" bật cho tên không đổi, mất `whitespace-pre-line`, ngày đọc dạng thô, đổi câu "thiết bị này", thông báo không còn được đánh dấu đã đọc, "Sau" không bao giờ tắt, hoàn nguyên từng bản sửa R1 (gốc `failed`→`sent`; bỏ kiểm danh sách hỏng; không vẽ lỗi) / R2 / R3 (hai nút), một phần tự đọc `localStorage`, quên xoá cờ phiên.
- **Mã màu hex:** codemod 0 thay thế (bản gốc cũng 0: 17 unmapped + 1 order). 18 → trang 6 + 6 phần 12 (`--raise`, dời nguyên). Không thêm màu: lỗi nhận đoạn chat dùng `text-danger-soft`.
- **Việc sau / còn mở (ghim nguyên trạng):**
  - "Thử lại" của thông báo sau một lượt lật trang hỏng nạp lại trang ĐANG HIỆN (trang cũ), không phải trang vừa hỏng — chú thích của hàm nói vậy là chủ ý ("ở đúng trang đang xem"), không sửa;
  - `useReaderAuth.load()` trả về ngay khi một lượt nạp danh tính khác đang bay (không dùng chung promise như `useReaderNotifications`): nếu trang mount đúng lúc đó, bình luận/đoạn chat không bao giờ nạp và hiện trạng thái rỗng. Không với tới được qua giao diện hôm nay — mọi liên kết tới `/profile` chỉ hiện khi danh tính đã biết, và trang mount trước layout — nên chỉ ghi lại;
  - "Đã gắn N đoạn trò chuyện" đếm CẢ danh sách (kể cả đoạn đã gắn từ trước), có chủ đích theo chú thích ("thứ người đọc đang nhìn thấy") — câu chữ có thể gây hiểu lầm, cần quyết định;
  - trang 389 dòng, sát trần 400 của ratchet — thêm gì nữa nên đi vào phần hoặc composable.

### Kiểm chứng chung cho `/news` + `/profile` (2026-10-29, chạy một lần, không commit)

- **Build:** base `527a568c` vs HEAD sau mọi bản sửa — 9 tệp CSS trong `.output/public/_nuxt/` giống từng byte (băm nội dung; `entry.*.css` 159 930 byte ở cả hai).
- **E2E liên quan** trên build HEAD: `public-list-pagination`, `public-single-h1`, `public-ssr-status`, `public-language-cache`, `public-detail-status` — 55/55 xanh (1,9 phút); cổng 3123 trống trước và sau, không còn CSDL `cdkt_e2e_*`.
- **Ảnh chụp trình duyệt** (CSDL e2e; `/news` tới bằng điều hướng phía client từ `/about` nên ba lượt đọc đi qua trình duyệt và được trả lời giống nhau cho hai build; `/profile` nạp sau mount, API người đọc trả lời ở trình duyệt): 7 trạng thái `/news` (danh sách, trang 2, tìm kiếm, tìm kiếm rỗng, tìm kiếm hỏng, "Đọc nhiều" hỏng, một trang) + 10 trạng thái `/profile` (chưa đăng nhập, đang xác định danh tính, đã đăng nhập, sau "Nhận các đoạn chat", sau đổi tên, ba danh sách hỏng, rỗng + tài khoản không email, lỗi ghi tên + công tắc, nhận đoạn chat hỏng, trang bình luận hỏng) × desktop 1440 + phone 390 = 34 ảnh. 26/34 trùng từng điểm ảnh (max diff 0); 8 khác đúng ở chỗ của bốn bản sửa nhìn thấy được, mỗi bản × 2 khổ: N2 (bỏ "(0 bài viết)"), N3 ("Chưa có dữ liệu lượt xem." → lỗi + "Thử lại"), R1 ("Đã gắn 2 đoạn…" → "Không thể gắn…"), R3 ("Trước" bật / "Sau" tắt → ngược lại). N1 và R2 không có trạng thái ảnh chụp (đổi ngôn ngữ, 401 khi lật trang) — test hành vi phủ.
- **Unit đầy đủ** (Node 26, `TZ=Asia/Ho_Chi_Minh`): 7168 test, 7114 pass, 0 fail, 54 skip. Typecheck 0 lỗi; ESLint các tệp đổi: 0 lỗi, 0 cảnh báo; `npm run docs:facts` sạch.
- **Độ phủ** (Node 24.21, image `cdkt-cov:node24`, lệnh của CI, toàn bộ xanh): `app/composables` 82,43 % (7405/8983) → mốc 82.43 (bộ test mount trang thật chạy `useReaderAuth`/`useReaderNotifications`/`useReadingHistory`/`usePublicArticleList` thật + ba composable ghi mới); `app/utils` 96,49 % (5766/5976) → mốc 96.48. `shared` cũng RISE (99,48 %) nhưng không do lô này — không nâng.
