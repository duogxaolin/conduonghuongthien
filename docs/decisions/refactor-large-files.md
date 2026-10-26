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
