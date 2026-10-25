# Độ phủ test — mức nền 2026-10-13

Đo bằng `npm run test:coverage` (`node --experimental-test-coverage`, bộ unit, **không** gồm các suite `*-integration` cần MySQL). CI ghi bản tóm tắt này vào trang kết quả của job `unit-tests` ở mỗi lần chạy, **chỉ báo cáo, không chặn** — chưa đặt ngưỡng vì một con số chọn trước khi ai đó thấy mức nền chỉ là cách mới để CI đỏ.

| | Dòng | Nhánh | Hàm |
|---|---|---|---|
| Toàn bộ (bộ unit) | **74,80%** | 80,03% | 71,40% |

## 15 file ít được phủ nhất (bộ unit)

Đây là *danh sách việc*, không phải lời chê: nhiều file chủ yếu được kiểm bởi suite integration (cần MySQL) hoặc test đọc mã nguồn, nên con số unit thấp không có nghĩa là không được kiểm. File `server/db/schema-tables/*` (DDL) bị loại khỏi danh sách vì chỉ chạy trong bộ integration.

| file | dòng % | nhánh % | hàm % |
|---|---|---|---|
| `server/services/article-translations.ts` | 18.40 | 82.35 | 5.88 |
| `server/services/livestream-hls.ts` | 20.33 | 100.00 | 0.00 |
| `app/composables/useChatbot.ts` | 21.49 | 100.00 | 0.00 |
| `server/utils/html-chunker.ts` | 21.74 | 100.00 | 0.00 |
| `server/services/moderation-worker.ts` | 27.20 | 40.00 | 25.00 |
| `server/utils/media-r2.ts` | 28.57 | 100.00 | 0.00 |
| `server/services/notification-email.ts` | 30.58 | 100.00 | 0.00 |
| `server/services/video-r2-sync.ts` | 34.68 | 100.00 | 0.00 |
| `server/services/ai-gateway.ts` | 34.81 | 61.43 | 39.13 |
| `server/services/readers.ts` | 36.18 | 100.00 | 0.00 |
| `server/services/ip-bans.ts` | 36.44 | 100.00 | 0.00 |
| `server/db/migrations-additive.ts` | 37.79 | 100.00 | 0.00 |
| `server/utils/slug.ts` | 40.63 | 100.00 | 20.00 |
| `server/utils/mailer.ts` | 42.34 | 100.00 | 0.00 |
| `server/services/comments.ts` | 45.90 | 97.96 | 33.33 |

## Mức nền 2026-10-24 — tính cả tệp chưa từng được nạp (wave2 2F, D-COVERAGE)

**Vì sao đo lại.** Con số 74,80 % ở trên chỉ tính những tệp mà lúc chạy test có module nào import. Một tệp không test nào nạp thì **vắng khỏi mẫu số**, chứ không được tính là 0 %. Con số "65,7 %" từng được nhắc tới không có nguồn nào trong repo, nên không dùng để so sánh.

**Cách đo — `scripts/coverage-summary.ts`, chạy được trên Node 22/24/26.** `npm run test:coverage` chạy bộ test với reporter lcov (ghi vào `node_modules/.cache/cdkt-coverage/lcov.info`), rồi chạy script đó. Bước *Coverage summary* của CI làm y hệt trên lượt test unit (Node 24). Bước đó vẫn `continue-on-error`, và script tự ghi vào `$GITHUB_STEP_SUMMARY`. Script làm ba việc:
1. **Gộp bản ghi trùng.** Test chạy với `--experimental-test-module-mocks`, và lcov có thể có nhiều bản ghi cùng `SF:` (một tệp nạp ở nhiều nơi, hoặc bị `mock.module`). Một dòng, hàm hay nhánh được tính là đã chạy nếu **bất kỳ** bản ghi nào chạy nó. Cộng thẳng các bản ghi là đếm một tệp hai lần.
2. **Thêm mọi tệp nguồn không test nào nạp, ở 0 %.**
   - Tập nguồn là mọi tệp `.ts` git theo dõi (`git ls-files`; không có git thì duyệt thư mục) dưới `server/`, `shared/`, `app/utils/`, `app/composables/`.
   - Trừ ra: `server/db/schema-tables/` (DDL chỉ chạy trong suite integration), `*.d.ts`, `*.test.ts`/`*.spec.ts`.
   - Tệp chưa nạp được tính bằng **số dòng có mã**: không trống, không chỉ là chú thích. Đếm bằng một bộ quét nhỏ trong script. Đối chiếu với trình phân tích của TypeScript trên cả 663 tệp: lệch 0,013 % tổng số (54 099 so với 54 092 dòng), chỉ 2 tệp khác, đều là tệp nhiều regex.
3. **In** tổng chung và theo thư mục cho "mọi tệp" lẫn "chỉ tệp đã nạp", cùng danh sách tệp chưa nạp và các tệp đã nạp ít được phủ nhất.

**Phép gần đúng, nói rõ.**
- Với tệp đã nạp, Node đếm **mọi** dòng vật lý. Dòng trống và chú thích được tính là đã chạy khi khối mã chứa nó chạy (đã kiểm trên 22.23, 24.21 và 26.11). Với tệp chưa nạp, chỉ dòng có mã được tính. Nên chú thích giúp tỉ lệ của tệp đã nạp, nhưng không kéo tệp chưa nạp xuống.
- Nếu tính mọi dòng vật lý cho cả tệp chưa nạp, cùng lượt đo ra 64,43 % (51 767 / 80 352) thay vì 70,50 %.
- Cờ `--test-coverage-include-all` của Node 26 lại dùng quy tắc thứ ba (bỏ dòng chỉ có kiểu, giữ dòng trống). Cờ đó không có trên Node 24.21/22.23, và khi đi cùng `mock.module` nó còn sinh bản ghi lệch. Nên script không dùng nó.
- Hàm và nhánh của tệp chưa nạp thì không biết được (Node không phân tích tệp đó), nên hai cột này chỉ nói về tệp đã nạp.

**`--test-coverage-exclude='tests/**'` là cần thiết.** Mặc định Node coi tệp tên `test-*.ts` là tệp test và loại khỏi coverage. Vì thế các handler thật `server/api/admin/settings/test-r2.post.ts` và `test-email.post.ts` mất khỏi báo cáo, dù có test chạy chúng (đã tái hiện trên 24.21 và 26.11). Truyền `--test-coverage-exclude` thì Node bỏ quy tắc mặc định.

### Kết quả (Node 24.21 — bản CI, `TZ=Asia/Ho_Chi_Minh`, đo trên `wave1/integration` `3ede49a` + 2F)

`npm test`: 4407 test, 4374 pass, 0 fail, 33 skip. Node 26.11 cho 70,51 % dòng, cùng 299 tệp chưa nạp.
Node 22.23 chạy được lệnh và script (đo trên `a7be585` + 2F), nhưng số hơi khác: 70,41 %, 288 tệp chưa nạp. Lý do: nó gán một phần lượt nạp qua `mock.module` cho chính tệp đó. Thêm nữa, trên Node 22 vốn có 19 test đỏ và 4 test bị huỷ: `backup-run-endpoint`, `backup-scheduler-due`, `article-view-ip-ceiling`, `chatbot-outbound-stream` đỏ, `thumbnail-on-demand-bounds` bị huỷ. Cả hai đều xảy ra y hệt ở `a7be585` chưa có thay đổi của 2F. Vì có test đỏ, `npm run test:coverage` dừng trước bước tóm tắt. Mức nền vì vậy lấy theo Node 24 (bản CI).

| Thư mục | Tệp | Chưa từng nạp | Dòng, mọi tệp | Dòng, tệp đã nạp | Hàm | Nhánh |
|---|---|---|---|---|---|---|
| **Tất cả** | 663 | 299 | **70,50 %** (51 767 / 73 424) | 87,10 % | 80,77 % | 80,90 % |
| `server/` | 570 | 268 | 69,15 % | 85,83 % | 79,67 % | 80,09 % |
| `server/api/` | 332 | 224 | 45,23 % | 84,48 % | 73,05 % | 64,08 % |
| `server/services/` | 85 | 18 | 73,12 % | 82,71 % | 79,27 % | 80,58 % |
| `server/utils/` | 122 | 6 | 89,50 % | 91,79 % | 88,44 % | 86,65 % |
| `server/db/` (trừ `schema-tables/`) | 4 | 1 | 63,30 % | 74,61 % | 36,97 % | 95,92 % |
| `server/plugins/` | 16 | 11 | 36,39 % | 100,00 % | 100,00 % | 85,19 % |
| `server/middleware/` | 5 | 4 | 72,91 % | 100,00 % | 100,00 % | 88,24 % |
| `server/routes/` | 4 | 4 | 0,00 % | — | — | — |
| `server/data/` | 2 | 0 | 100,00 % | 100,00 % | — | 100,00 % |
| `shared/` | 6 | 1 | 94,64 % | 99,22 % | 97,62 % | 97,99 % |
| `app/utils/` | 52 | 10 | 92,64 % | 97,28 % | 94,31 % | 88,87 % |
| `app/composables/` | 35 | 20 | 59,89 % | 87,43 % | 75,89 % | 74,74 % |

- Cột "Dòng, tệp đã nạp" là cách đếm của mức nền 74,80 %, nay có gộp bản ghi và có hai handler `test-*.ts`. Sự chênh giữa hai cột dòng nằm phần lớn ở `server/api/`: handler được Nitro nạp lúc chạy app, còn bộ unit chỉ nạp những handler có test hành vi.
- Các mốc trước, cùng cách đo:
  - `694bb6e` (trước 1A/1C): 68,25 % (652 tệp, 312 chưa nạp). Phần tăng sau đó đến từ test mới của 1A/1C.
  - `a7be585` (sau 1A/1C, trước 2E): 70,55 % (660 tệp, 296 chưa nạp).
  - Từ 2E, `registry`/`types`/`submission-status` sang `shared/`, và mã import thẳng từ đó. Hai bản re-export ở `app/utils/` (`blocks/registry.ts`, `submission-status.ts`) thành tệp không ai nạp; bản thứ ba, `blocks/types.ts`, vốn chỉ có kiểu và trước đó cũng đã chưa nạp. `shared/blocks/types.ts` chỉ có kiểu, nên bị tính 0 %.
- Bước CI (chỉ các tệp test không phải integration, đã chạy thử đúng lệnh của CI trên Node 24.21): **70,50 %**, 300 tệp chưa nạp. Tệp chênh là `server/services/media-processing-queue.ts`, mà ở lượt `npm run` chỉ được nạp qua import cấp đầu tệp của một suite integration (suite đó tự bỏ qua khi không có MySQL).

### Cách đọc cho đúng
- Bảng mà Node in ở cuối log (khi dùng reporter `spec`) vẫn chỉ đếm tệp đã nạp, và không gộp bản ghi trùng. Con số để trích là bảng của script.
- Tệp chỉ khai báo kiểu vẫn bị tính 0 %, dù không có mã chạy: `shared/blocks/types.ts`, `app/utils/blocks/types.ts`, `app/utils/public-types.ts`, `app/utils/docs/types.ts`. Bản re-export ở đường cũ cũng vậy, khi không ai còn import chúng: `app/utils/blocks/registry.ts`, `app/utils/submission-status.ts`.
- Module chỉ được kiểm bằng suite integration cũng bị tính 0 % ở đây. Ví dụ: `server/services/submission-workflow.ts` (`tests/submission-workflow-integration.test.ts`).
- Tệp mà test chỉ thay bằng `mock.module` (không bao giờ chạy mã thật) bị tính là chưa nạp. Đó là đúng. Ví dụ: `server/utils/mfa/reauth.ts`, `server/utils/chatbot/chat.ts`, `server/services/categories.ts`.

### Chưa từng được nạp bởi bộ unit (danh sách việc, 2026-10-24)
Danh sách đầy đủ (299 tệp, kèm số dòng có mã) nằm trong mục *files no test loads* của output script. Những thư mục đáng làm trước:
- `server/services/` (18): `articles-thumbnail-scan.ts`, `backup-drive-oauth-config.ts`, `backup-drive-oauth.ts`, `backup-drive.ts`, `categories.ts`, `content-types.ts`, `google-oauth-settings.ts`, `i18n-auto-translate.ts`, `languages.ts`, `layout-settings.ts`, `media-repair.ts`, `media-repoint.ts`, `media-scan.ts`, `pages.ts`, `social-links.ts`, `submission-workflow.ts`, `submissions.ts`, `universal-translation.ts`.
- `server/utils/` (6): `backup-drive-oauth-crypto.ts`, `chatbot/chat.ts`, `chatbot/session-db.ts`, `html-to-markdown.ts`, `legacy-urls.ts`, `mfa/reauth.ts`.
- `server/db/` (1): `seed.ts`. Nó tự chạy khi được import; suite nâng cấp chạy nó như một tiến trình riêng.
- `app/composables/` (20): `useAdminAuth`, `useBackupSettings`, `useBrokenImageFallback`, `useBulkSelection`, `useHlsVideo`, `useI18n`, `useImagePicker`, `useLayoutConfig`, `useLayoutNav`, `useLiveSearch`, `useMobileMenu`, `usePagePreview`, `usePlyrPlayer`, `useReaderAuth`, `useReaderMenu`, `useReaderNotifications`, `useReadingHistory`, `useSiteSettings`, `useToast`, `useUpload`.
- `app/utils/` (10): `ai-service-labels.ts`, `backup-format.ts`, `blocks/registry.ts` (re-export), `blocks/types.ts`, `docs/types.ts`, `formatDate.ts`, `language-flags.ts`, `media-duration.ts`, `public-types.ts`, `submission-status.ts` (re-export).
- `shared/` (1): `blocks/types.ts` (chỉ có kiểu).

Chưa có ngưỡng. Ngưỡng là việc của Wave 3, và đặt trên các số của script.

## Ratchet độ phủ theo thư mục (wave3 D-R, 2026-10-25)

- **Cổng chặn duy nhất:** `scripts/coverage-ratchet.ts` so cột "Dòng, mọi tệp" (cùng code với bảng trên) theo thư mục với `tests/ratchets/coverage.baseline.json`. Đỏ khi một thư mục tụt **quá 0,5 điểm**, khi mức nền còn ghi một thư mục không còn tệp nguồn, khi một thư mục **chưa có trong mức nền** (thư mục mới chưa test, hay tệp chưa nạp bị `git mv` sang thư mục mới làm thư mục cũ "tăng"), hoặc khi lcov thiếu/rỗng. Không có ngưỡng tuyệt đối. Tăng thì xanh và in giá trị mới.
- **Thư mục** = hàng nhỏ nhất của bảng: `server/<cấp 1>`, `shared`, `app/utils`, `app/composables`.
- **Độ nhạy** (đo trên mức nền này — số dòng có mã của một tệp mới chưa test, hoặc số dòng đã phủ bị mất, đủ để đỏ):

  | thư mục | tổng dòng | tệp mới chưa test | dòng phủ bị mất |
  |---|---|---|---|
  | `server/middleware` | 305 | **2** | **2** |
  | `server/plugins` | 393 | **6** | **2** |
  | `shared` | 1 226 | **7** | **7** |
  | `server/data` (100 %) | 1 416 | 8 | 8 |
  | `server/db` | 3 651 | 26 | 19 |
  | `app/utils` | 5 542 | 30 | 28 |
  | `app/composables` | 5 564 | 47 | 29 |
  | `server/utils` | 15 891 | 89 | 80 |
  | `server/services` | 27 502 | 175 | 140 |
  | `server/api` | 17 235 | 186 | 88 |
  | `server/routes` (0 %) | 136 | không thể tụt | — |

  Ba thư mục đầu gần như đòi mọi mã mới phải có test ngay trong PR đó — đó là ý muốn, nhưng một tệp tiện ích vài dòng cũng đủ làm đỏ. Hạ có chủ đích: `--allow-drop <thư mục>`, ghi lý do trong PR.
- **Node trôi theo bản vá:** CI dùng `node-version: '24'` (không ghim bản vá, cố ý). Một bản vá Node/V8 đổi cách gán dòng cho coverage sẽ dịch **mọi thư mục cùng lúc** (thường đều một chiều) — dấu hiệu là nhiều thư mục DROP/RISE trong một PR không đụng mã. Cách xử lý: xác nhận trên bản Node mới (so `node -v` trong log CI), rồi hạ có chủ đích bằng `--allow-drop <thư mục>` cho từng thư mục tụt (hoặc `--rebaseline` nếu mọi thư mục cùng dịch), ghi bản Node cũ → mới và lý do trong PR. Không nới dung sai.
- **CI:** bước *Coverage ratchet* của job `unit-tests`, sau Typecheck, chặn (bước *Coverage summary* vẫn chỉ báo cáo). **Cục bộ:** `npm run test:coverage` chạy nó sau bảng tóm tắt.
- **Tập tệp:** từ nay `npm run test:coverage` chạy đúng tập của CI — mọi `tests/*.test.ts` trừ `*-integration`, cộng `tests/ratchets/*.test.ts`. Trước đây nó gồm cả suite integration (tự bỏ qua, nhưng import cấp đầu tệp vẫn nạp `media-processing-queue.ts`), nên ra 299 tệp chưa nạp so với 300 của CI.
- **Mức nền** đo trên `wave3/1-ratchets` (gốc `423013d`, nhánh tích hợp wave2): Node 24.21, `TZ=Asia/Ho_Chi_Minh`, có ffmpeg, lệnh của CI, **hai lần**: 4970 test, 0 đỏ, tổng 74,62 % (58 844 / 78 861, 713 tệp), 294 tệp chưa nạp — cao hơn 70,50 % ở trên vì test thêm từ sau mốc đó. Hai lần giống hệt nhau theo thư mục. Dao động thấy được: 3 dòng của `server/services/video-process-runner.ts` (hàm dựng `ProcessingAborted`, chạy hay không tuỳ thời điểm) — 0,011 điểm ở `server/services`, gặp ở 3/6 lượt: một lượt Node 24 trước đó (13 test đỏ vì môi trường container thiếu `jq`/danh tính git, đều là test không nạp mã được đo), một lượt Node 26 `TZ` UTC, và lượt `npm run test:coverage` cuối. Mức nền giữ 80,21 (hai lượt Node 24 sạch); phía thấp nằm trong dung sai (−0,005). Node 26.11 cho cùng số theo thư mục ở cả `TZ=Asia/Ho_Chi_Minh` lẫn UTC.
- **Cập nhật:** `node --experimental-strip-types scripts/coverage-ratchet.ts node_modules/.cache/cdkt-coverage/lcov.info --update` chỉ **nâng** mục (làm tròn xuống 2 chữ số) và bỏ mục cũ. Hạ một mục phải ghi rõ `--allow-drop <thư mục>`; thêm thư mục mới phải ghi rõ `--add-dir <thư mục>` — cả hai trong cùng PR.

### Tạo lại cả bốn mức nền sau khi gộp nhánh nền đã đổi

Dùng **một lần** khi mức nền được đo trên cây cũ (ví dụ sau khi gộp đỉnh mới của `wave2/integration`). `--rebaseline` cho mọi mục đi theo cây hiện tại, lên hoặc xuống, thêm/bỏ tệp và thư mục, in từng thay đổi; giữ nguyên mọi `reason` và mọi mục `exempt` (mục `exempt` của tệp đã mất → sửa tay). Chạy từ gốc repo, theo đúng thứ tự (các ratchet tệp phải xanh trước, vì `test:coverage` chạy chúng):

```bash
node --experimental-strip-types --import ./scripts/ts-resolver.mjs tests/ratchets/hex-colors.test.ts --rebaseline
node --experimental-strip-types --import ./scripts/ts-resolver.mjs tests/ratchets/file-length.test.ts --rebaseline
node --experimental-strip-types --import ./scripts/ts-resolver.mjs tests/ratchets/fetch-casts.test.ts --rebaseline
npm run test:coverage   # chỉ được đỏ ở phần độ phủ (bước ratchet cuối, hoặc test "names exactly the measured directories" khi có thư mục mới/mất) — lcov vẫn được ghi; đỏ chỗ khác thì sửa trước
node --experimental-strip-types scripts/coverage-ratchet.ts node_modules/.cache/cdkt-coverage/lcov.info --rebaseline
node --experimental-strip-types scripts/coverage-ratchet.ts node_modules/.cache/cdkt-coverage/lcov.info   # phải xanh
npm test                # mọi ratchet xanh trên mức nền mới
```

Mức nền độ phủ nên đo bằng lệnh của CI trên Node 24 với `TZ=Asia/Ho_Chi_Minh`; trên mức nền này Node 26 cục bộ (cả UTC) cho cùng số theo thư mục. Xem diff của bốn tệp `tests/ratchets/*.baseline.json` như mọi thay đổi mức nền khác.

## Xếp hạng tệp chưa từng được nạp theo rủi ro — 2026-10-25 (Wave 3, task 5.1)

**Đo ở đâu.** `npm run test:coverage` chạy một lần trên `wave3/inventories` = `3d69836` (đỉnh tích hợp Wave 2), Node 26.11.1, `TZ` của máy là UTC (CI chạy `TZ=Asia/Ho_Chi_Minh`; tập tệp chưa nạp không phụ thuộc múi giờ, chỉ tỉ lệ có thể lệch rất nhỏ). Các suite `*-integration` tự bỏ qua vì không đặt biến môi trường của chúng, như mọi lượt đo trước.

| | Tệp | Chưa từng nạp | Dòng, mọi tệp | Dòng, tệp đã nạp | Hàm | Nhánh |
|---|---|---|---|---|---|---|
| **Tất cả** | 721 | 287 (12 783 dòng mã) | **75,29 %** (59 913 / 79 579) | 89,70 % | 82,48 % | 82,55 % |

So với 2026-10-24 (663 tệp, 299 chưa nạp, 70,50 %): Wave 2 thêm tệp mới và test mới, nên cả mẫu số lẫn số tệp đã nạp đều đổi. Đây là số để xếp hạng, không phải mốc ngưỡng.

### Quy tắc xếp hạng

- **Lớp trước, cỡ sau.** Mỗi tệp vào lớp **đầu tiên** khớp, theo thứ tự R1 → R7. Trong một lớp, xếp theo số dòng mã giảm dần (dòng không trống, không chỉ là chú thích — cùng cách đếm của script).
- **R1 — xác thực, phiên, MFA, phân quyền.** Đăng nhập/đăng xuất admin, MFA, vai trò và tài khoản admin, cấu hình Google OAuth đăng nhập người đọc, `me` và nhận phiên chat của người đọc, chốt bí mật lúc boot. **Không** gồm khoá người đọc và chặn IP: đó là quyết định kiểm duyệt, nằm ở R5/R6.
- **R2 — backup, khôi phục, giữ dữ liệu.** Backup, Google Drive của backup, chính sách và lượt dọn dữ liệu.
- **R3 — đồng bộ media, R2, tải lên.** Mã đụng tới **byte của tệp**: tải lên, R2, quét/đồng bộ, thumbnail, khởi chạy chuyển mã, phục tệp từ đĩa (`/uploads/**`, HLS). Đọc/sửa metadata media mà không đụng tệp thì vào R5/R6.
- **R4 — cổng AI, chatbot, kiểm duyệt AI.** Gọi model, cấu hình nhà cung cấp/giá/hạn mức, dịch bằng AI, chatbot, hàng chờ/luật/worker kiểm duyệt AI. Kiểm duyệt bằng tay (ẩn bình luận, gỡ tin chat livestream) vào R5.
- **R5 / R6 theo việc mã làm, không theo động từ HTTP.** GET có ghi vào R5: `ai/budget/index.get` chèn hàng mặc định, `chatbot/sessions/[id].get` và `comments/index.get` ghi audit khi đọc, `submissions/[id]/index.get` ghi "xem lần đầu" (hai tệp đầu thuộc miền R4 nên ở R4). POST không ghi CSDL (`sitemap/generate.post`, `youtube-meta.post`) vào R6.
- **R7** — còn lại: composable/util phía trình duyệt, plugin chỉ khởi động lịch, middleware chuyển hướng. Sáu tệp chỉ có kiểu hoặc chỉ re-export (`shared/blocks/types.ts`, `app/utils/blocks/{types,registry}.ts`, `app/utils/{public-types,submission-status}.ts`, `app/utils/docs/types.ts`) bị tính 0 % nhưng không có mã chạy: con số đó là ảo giác đo.
- **Handler mỏng** = route chỉ kiểm quyền, đọc thân request, gọi hàm trong `server/services/`, đổi lỗi; không tự gọi `getDb()`/pool; ≤ 40 dòng mã. Bảng ghi % của **từng** service nó gọi:
  - "Rủi ro thật thấp hơn lớp" chỉ khi **mọi** service ≥ 80 %. Phần còn lại ở handler là tên resource/action truyền cho `requireResourcePermission` và cách đổi thân request; việc *có gọi* kiểm quyền đã được `tests/admin-handler-authorization.test.ts` soát bằng AST (không chạy handler).
  - Service chưa nạp (0 %) thì rủi ro nằm ở service, và service đó có dòng riêng trong bảng. Không hạ rủi ro của handler.
  - `submission-workflow.ts` 0 % ở unit nhưng có suite integration riêng chạy chính các hàm đó.
- **Cột Integration** chỉ tính module mà một suite `tests/*-integration.test.ts` **thật sự chạy**: `import`/`await import()`, hoặc chạy thành tiến trình con (`spawnSync`, như `seed.ts`).
  - "trực tiếp" = chính tệp đó; "qua `x.ts`" = tệp import một service mà suite chạy (chỉ đi một bước, chỉ qua `server/services/*`). "Qua service" nghĩa là service đã chạy trên MySQL thật, **không** có nghĩa handler đã chạy.
  - Không tính: đường dẫn chỉ là đích `mock.module` (`server/utils/media-r2.ts` trong `media-sync-rewrite`, `server/services/backup.ts` trong `media-repoint`), và tệp mà suite chỉ đọc mã nguồn (`server/services/languages.ts` trong `schema-upgrade`). Không đi qua util chung (`password-policy.ts`, `chatbot/small-talk.ts`) — đi qua đó thì gần như tệp nào cũng "có integration".

### Tóm tắt theo lớp

| Lớp | Tệp | Dòng mã | Handler mỏng | — trong đó mọi service ≥ 80 % | Có suite integration chạy tệp hoặc service của nó |
|---|---|---|---|---|---|
| R1 | 22 | 1 070 | 5 | 1 | 1 |
| R2 | 12 | 940 | 2 | 2 | 2 |
| R3 | 25 | 899 | 12 | 9 | 12 |
| R4 | 64 | 3 460 | 19 | 3 | 0 |
| R5 | 83 | 3 268 | 45 | 13 | 18 |
| R6 | 42 | 1 333 | 14 | 6 | 7 |
| R7 | 39 | 1 813 | 0 | 0 | 1 |
| **Tổng** | **287** | **12 783** | **97** | **34** | **41** |

Đọc bảng: R4 là lớp lớn nhất và **không** tệp nào có suite integration. R3 thì phần lớn là handler mỏng trên service đã phủ tốt (chunked upload, sync, scan), trừ `media/upload.post.ts` và đường phục tệp. Ở R1, không test unit hay integration nào chạy 22 tệp này; tệp duy nhất "có integration" (`reader/me.get.ts`) chỉ vì nó gọi `comments.ts`. E2E (`tests/e2e/*.spec.ts`) có chạy máy chủ thật qua đăng nhập, captcha và MFA (`admin-login-challenge`, `admin-mfa`, `global-setup`), nhưng nằm ngoài phép đo coverage này.

### Bảng xếp hạng đầy đủ (287 tệp)

#### R1 — xác thực, phiên, MFA, phân quyền — 22 tệp, 1070 dòng mã

| # | Tệp | Lớp | Dòng mã | Việc | Integration |
|---|---|---|---|---|---|
| 1 | `server/services/google-oauth-settings.ts` | R1 | 198 | Cấu hình Google OAuth đăng nhập người đọc; nơi duy nhất giải mã client secret. | — |
| 2 | `app/composables/useReaderAuth.ts` | R1 | 119 | Danh tính người đọc phía trình duyệt (đăng nhập Google, đăng xuất, `me`). | — |
| 3 | `server/api/admin/profile/history.get.ts` | R1 | 116 | Lịch sử đăng nhập/thao tác; xem của tài khoản khác cần SuperAdmin nghiêm ngặt (`isSuperAdmin === true`), không phải `users.read`. | — |
| 4 | `app/composables/useAdminAuth.ts` | R1 | 100 | Phiên admin phía trình duyệt: tải `me`, đăng xuất, chuyển hướng khi 403 `mfa_enrollment_required`. | — |
| 5 | `server/api/admin/users/[id]/mfa.delete.ts` | R1 | 59 | Break-glass: SuperAdmin xoá yếu tố MFA của tài khoản khác. | — |
| 6 | `server/api/admin/profile/mfa/disable.post.ts` | R1 | 58 | Tắt một yếu tố MFA sau khi nhập lại mật khẩu; thu hồi phiên khác. | — |
| 7 | `server/api/admin/auth/mfa/send-code.post.ts` | R1 | 47 | Gửi mã đăng nhập qua email giữa lượt thử thách MFA (chỉ có vé challenge, giới hạn riêng). | — |
| 8 | `server/api/admin/auth/logout.post.ts` | R1 | 44 | Đăng xuất: thu hồi token (tăng `tokenVersion`), xoá cookie, audit. | — |
| 9 | `server/api/public/reader/claim-chats.post.ts` | R1 | 39 | Gắn phiên chat ẩn danh vào tài khoản bằng token đã ký (chứng minh sở hữu). | — |
| 10 | `server/utils/mfa/reauth.ts` | R1 | 39 | Đòi nhập lại mật khẩu trước khi đổi yếu tố MFA (có giới hạn). | — |
| 11 | `server/api/admin/profile/mfa/index.get.ts` | R1 | 37 | Trạng thái các yếu tố MFA (allowlist trường, không lộ bí mật). | — |
| 12 | `server/api/admin/profile/mfa/recovery-codes.delete.ts` | R1 | 34 | Tắt mã dự phòng (xoá hết) sau khi nhập lại mật khẩu. | — |
| 13 | `server/api/admin/roles/[id].delete.ts` | R1 | 32 | Xoá vai trò (chặn vai trò hệ thống/đang dùng) + audit. | — |
| 14 | `server/api/admin/settings/google-oauth/index.patch.ts` | R1 | 29 | Sửa cấu hình Google OAuth (danh sách trường đóng). Handler mỏng — service `google-oauth-settings.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 15 | `server/api/admin/users/index.get.ts` | R1 | 24 | Danh sách tài khoản admin + vai trò. | — |
| 16 | `server/api/admin/auth/captcha.get.ts` | R1 | 22 | Sinh captcha SVG cho đăng nhập, giới hạn theo IP (logic ở utils đã phủ). | — |
| 17 | `server/api/public/reader/me.get.ts` | R1 | 19 | Người đọc đang đăng nhập là ai (chỉ bản thân). Handler mỏng — service `comments.ts` phủ 100 %, `readers.ts` phủ 36 %. | qua `comments.ts`: `notification-email`, `notification-page` |
| 18 | `server/plugins/require-secrets.ts` | R1 | 18 | Dừng boot ở production khi thiếu bí mật hoặc dùng giá trị mặc định đã lộ (JWT…). | — |
| 19 | `server/api/admin/roles/index.get.ts` | R1 | 15 | Danh sách vai trò + ma trận quyền. | — |
| 20 | `server/api/admin/settings/google-oauth/clear-secret.post.ts` | R1 | 8 | Xoá client secret Google OAuth, tắt đăng nhập người đọc. Handler mỏng — service `google-oauth-settings.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 21 | `server/api/admin/users/[id].delete.ts` | R1 | 7 | Xoá tài khoản admin (chặn tự xoá/SuperAdmin trong service). Handler mỏng — service `users.ts` phủ 94,8 %. Rủi ro thật thấp hơn lớp. | — |
| 22 | `server/api/admin/settings/google-oauth/index.get.ts` | R1 | 6 | Đọc cấu hình Google OAuth (redirect URI suy từ request). Handler mỏng — service `google-oauth-settings.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |

#### R2 — backup, khôi phục, giữ dữ liệu — 12 tệp, 940 dòng mã

| # | Tệp | Lớp | Dòng mã | Việc | Integration |
|---|---|---|---|---|---|
| 23 | `app/composables/useBackupSettings.ts` | R2 | 223 | State + thao tác khối cài đặt backup (lịch, Drive OAuth, Service Account). | — |
| 24 | `server/services/backup-drive-oauth-config.ts` | R2 | 205 | Client ID/secret Drive OAuth của backup (mã hoá, giải mã, kiểm). | — |
| 25 | `server/services/backup-drive-oauth.ts` | R2 | 133 | Liên kết Drive OAuth của backup; nơi giải mã refresh token. | — |
| 26 | `server/services/backup-drive.ts` | R2 | 122 | Tải backup lên Google Drive (Service Account hoặc OAuth), dựng cây thư mục. | — |
| 27 | `server/api/admin/settings/retention.get.ts` | R2 | 72 | Chính sách giữ dữ liệu đang áp dụng + nguồn của từng giá trị. | — |
| 28 | `server/api/admin/activity-logs/retention.get.ts` | R2 | 52 | Trạng thái giữ `activity_logs`: số hàng, hàng cũ nhất, số quá hạn, số đã xoá. | — |
| 29 | `server/api/admin/settings/retention.put.ts` | R2 | 41 | Lưu chính sách giữ dữ liệu (kiểm hết trước khi ghi). | — |
| 30 | `server/api/admin/settings/retention-run.post.ts` | R2 | 34 | Chạy dọn dữ liệu ngay (khoá tên, 409 khi bận) + audit. | — |
| 31 | `server/utils/backup-drive-oauth-crypto.ts` | R2 | 27 | Phong bì mã hoá refresh token Drive (nhãn ngữ cảnh riêng). | — |
| 32 | `server/api/admin/backup/status.get.ts` | R2 | 14 | Trạng thái backup/khôi phục đang chạy. Handler mỏng — service `backup.ts` phủ 100 %, `backup-restore.ts` phủ 97,2 %. Rủi ro thật thấp hơn lớp. | qua `backup.ts`: `backup-dump`; qua `backup-restore.ts`: `backup-dump` |
| 33 | `server/api/admin/backup/index.get.ts` | R2 | 13 | Danh sách bản backup. Handler mỏng — service `backup.ts` phủ 100 %. Rủi ro thật thấp hơn lớp. | qua `backup.ts`: `backup-dump` |
| 34 | `app/utils/backup-format.ts` | R2 | 4 | Định dạng thời điểm backup theo giờ VN (4 dòng). | — |

#### R3 — đồng bộ media, R2, tải lên — 25 tệp, 899 dòng mã

| # | Tệp | Lớp | Dòng mã | Việc | Integration |
|---|---|---|---|---|---|
| 35 | `server/api/admin/media/upload.post.ts` | R3 | 155 | Tải ảnh/tệp lên: kiểm magic byte, sharp, ghi local hoặc R2, ghi hàng `media`. | — |
| 36 | `app/composables/useUpload.ts` | R3 | 118 | Tải một tệp lên thư viện media từ trình duyệt. | — |
| 37 | `server/api/admin/media/storage-size.get.ts` | R3 | 88 | Dung lượng thật: DB, đĩa local, liệt kê bucket R2. | — |
| 38 | `server/api/admin/settings/favicon.post.ts` | R3 | 81 | Nhận ảnh tải lên, sinh bộ favicon đúng cỡ. | — |
| 39 | `server/api/admin/media-portal/[id]/process.post.ts` | R3 | 45 | Bắt đầu/chạy lại chuyển mã FFmpeg (202, chạy nền). | qua `video-processing.ts`: `media-queue`; qua `media-processing-queue.ts`: `media-queue` |
| 40 | `server/api/admin/media-portal/[id]/thumbnail.post.ts` | R3 | 42 | Chép ảnh từ thư viện làm thumbnail video (đĩa + R2). | — |
| 41 | `server/api/admin/media-portal/upload/[id]/chunk.put.ts` | R3 | 38 | Nhận một phần tệp video (thân có trần byte). | qua `chunked-upload.ts`: `upload-concurrency` |
| 42 | `server/routes/uploads/[...path].ts` | R3 | 36 | Phục `/uploads/**` từ đĩa lúc chạy (đường dẫn do khách gửi). | — |
| 43 | `server/api/admin/media-portal/upload/housekeep.post.ts` | R3 | 34 | Dọn phiên tải lên bỏ dở (khoá tên). | qua `chunked-upload.ts`: `upload-concurrency` |
| 44 | `server/api/admin/media/scan.post.ts` | R3 | 32 | Khởi chạy job quét ảnh mồ côi rồi nhập lên R2. Handler mỏng — service `media-scan.ts` phủ 89,6 %. Rủi ro thật thấp hơn lớp. | — |
| 45 | `server/api/admin/media-portal/upload/[id]/complete.post.ts` | R3 | 30 | Ghép các phần, tạo mục video. | qua `chunked-upload.ts`: `upload-concurrency` |
| 46 | `server/api/admin/media-portal/upload/init.post.ts` | R3 | 30 | Mở phiên tải lên từng phần. | qua `chunked-upload.ts`: `upload-concurrency` |
| 47 | `server/api/admin/media-portal/[id]/thumbnail.delete.ts` | R3 | 24 | Xoá thumbnail riêng ở đĩa + R2, về thumb tự sinh. | — |
| 48 | `server/api/admin/media-portal/[id].delete.ts` | R3 | 21 | Xoá mục video + audit; dọn tệp qua outbox. Handler mỏng — service `media-portal.ts` phủ 100 %. Rủi ro thật thấp hơn lớp. | — |
| 49 | `server/api/admin/media-portal/upload/[id]/status.get.ts` | R3 | 20 | Trạng thái một phiên tải lên. Handler mỏng — service `chunked-upload.ts` phủ 100 %. Rủi ro thật thấp hơn lớp. | qua `chunked-upload.ts`: `upload-concurrency` |
| 50 | `server/api/admin/media/scan-force-reset.post.ts` | R3 | 13 | Gỡ kẹt job quét. Handler mỏng — service `media-scan.ts` phủ 89,6 %. Rủi ro thật thấp hơn lớp. | — |
| 51 | `server/api/admin/media/sync-force-reset.post.ts` | R3 | 13 | Gỡ kẹt job đồng bộ. Handler mỏng — service `media-sync.ts` phủ 98,7 %. Rủi ro thật thấp hơn lớp. | qua `media-sync.ts`: `media-sync-rewrite` |
| 52 | `server/api/admin/media/scan-cancel.post.ts` | R3 | 12 | Yêu cầu huỷ job quét ảnh mồ côi. Handler mỏng — service `media-scan.ts` phủ 89,6 %. Rủi ro thật thấp hơn lớp. | — |
| 53 | `server/api/admin/media/sync-cancel.post.ts` | R3 | 12 | Yêu cầu huỷ job đồng bộ lên R2. Handler mỏng — service `media-sync.ts` phủ 98,7 %. Rủi ro thật thấp hơn lớp. | qua `media-sync.ts`: `media-sync-rewrite` |
| 54 | `server/api/public/livestream/[id]/assets/[...path].get.ts` | R3 | 12 | Phục tệp HLS của buổi phát theo đường dẫn con. Handler mỏng — service `livestream.ts` phủ 96,5 %, `livestream-hls.ts` phủ 20,3 %. | qua `livestream.ts`: `livestream-toggle` |
| 55 | `server/api/public/livestream/[id]/stream.get.ts` | R3 | 11 | Phục playlist HLS của buổi phát. Handler mỏng — service `livestream.ts` phủ 96,5 %, `livestream-hls.ts` phủ 20,3 %. | qua `livestream.ts`: `livestream-toggle` |
| 56 | `server/plugins/media-processing-reaper.ts` | R3 | 9 | Khởi động hàng đợi xử lý video + reaper lúc boot. | qua `media-processing-reaper.ts`: `media-queue` |
| 57 | `server/api/admin/media/scan-status.get.ts` | R3 | 8 | Trạng thái job quét. Handler mỏng — service `media-scan.ts` phủ 89,6 %. Rủi ro thật thấp hơn lớp. | — |
| 58 | `server/api/admin/media/sync-status.get.ts` | R3 | 8 | Trạng thái job đồng bộ. Handler mỏng — service `media-sync.ts` phủ 98,7 %. Rủi ro thật thấp hơn lớp. | qua `media-sync.ts`: `media-sync-rewrite` |
| 59 | `server/api/admin/media/[id].delete.ts` | R3 | 7 | Xoá ảnh: chặn khi đang dùng, dọn tệp local/R2, audit (trong service). Handler mỏng — service `media.ts` phủ 68,8 %. | — |

#### R4 — cổng AI, chatbot, kiểm duyệt AI — 64 tệp, 3460 dòng mã

| # | Tệp | Lớp | Dòng mã | Việc | Integration |
|---|---|---|---|---|---|
| 60 | `server/services/universal-translation.ts` | R4 | 452 | Quét độ phủ bản dịch và chạy job dịch AI cho UI, khối trang, bài. | — |
| 61 | `server/api/admin/ai/test-call.post.ts` | R4 | 270 | Gọi thử một model bằng prompt thật, ghi `ai_usage_logs`. | — |
| 62 | `server/api/admin/ai/delify/sync.post.ts` | R4 | 191 | Đồng bộ bảng giá model + lịch sử gọi từ Delify Router vào CSDL. | — |
| 63 | `server/api/admin/ai/delify/status.get.ts` | R4 | 154 | Gọi Delify Router lấy số dư/hạn mức bằng API key đã lưu. | — |
| 64 | `server/api/admin/comments/ai-moderate.post.ts` | R4 | 138 | Cho AI chấm một loạt bình luận (qua hạn mức chi). | — |
| 65 | `server/api/admin/ai/translate.post.ts` | R4 | 116 | Dịch nội dung bài bằng AI, rào nội dung không tin cậy. | — |
| 66 | `server/api/admin/ai/moderation/queue/[id]/resolve.post.ts` | R4 | 108 | Xử lý một mục kiểm duyệt: hiện lại hoặc xoá nội dung. | — |
| 67 | `server/api/admin/ai/services/[id].put.ts` | R4 | 89 | Sửa cấu hình một dịch vụ AI (provider, model, prompt, giới hạn) + audit. | — |
| 68 | `server/api/admin/chatbot/sessions/[id].get.ts` | R4 | 89 | Bản ghi một phiên chat (có SĐT công dân); ghi audit khi đọc (GET có ghi). | — |
| 69 | `server/api/admin/ai/usage.get.ts` | R4 | 79 | Tổng hợp chi phí/token/lượt gọi AI 30 ngày. | — |
| 70 | `server/services/i18n-auto-translate.ts` | R4 | 76 | Sinh khoá i18n + dịch AI khi tạo/sửa thể loại, loại nội dung. | — |
| 71 | `server/api/admin/ai/providers/[id]/test.post.ts` | R4 | 73 | Gọi thử API nhà cung cấp bằng key đã lưu (gọi ra ngoài). | — |
| 72 | `server/utils/chatbot/chat.ts` | R4 | 73 | Nạp kho đã duyệt + từ khoá trong một truy vấn, ghép câu trả lời chatbot. | — |
| 73 | `server/api/admin/ai/translate-ui.post.ts` | R4 | 72 | Dịch chuỗi giao diện bằng AI (qua hạn mức chi). | — |
| 74 | `server/api/admin/chatbot/knowledge/template.get.ts` | R4 | 70 | Tải mẫu nhập kho dạng .xlsx. | — |
| 75 | `server/api/admin/languages/ai-translate.post.ts` | R4 | 70 | Dịch các chuỗi giao diện còn thiếu bằng AI. | — |
| 76 | `server/api/public/chatbot/lead.post.ts` | R4 | 66 | Khách để lại liên hệ khi bot không trả lời được: ghi đơn, gửi email, giới hạn theo IP. | — |
| 77 | `server/api/admin/ai/pricing/index.post.ts` | R4 | 63 | Thêm giá model AI + audit. | — |
| 78 | `server/api/admin/languages/ai-translate-chunk.post.ts` | R4 | 61 | Dịch một lô chuỗi giao diện bằng AI rồi ghi DB. | — |
| 79 | `server/api/admin/chatbot/sessions/bulk-delete.post.ts` | R4 | 57 | Xoá hàng loạt phiên chat, đếm phiên có liên hệ trước khi xoá. | — |
| 80 | `server/api/admin/ai/moderation/settings.put.ts` | R4 | 56 | Lưu cấu hình kiểm duyệt AI. | — |
| 81 | `server/utils/chatbot/session-db.ts` | R4 | 54 | Ghi lượt chat của khách; nuốt lỗi để không giữ câu trả lời. | — |
| 82 | `server/api/admin/ai/providers/bulk-delete.post.ts` | R4 | 53 | Xoá hàng loạt nhà cung cấp AI + audit. | — |
| 83 | `server/api/admin/ai/pricing/[model].put.ts` | R4 | 52 | Sửa giá/nhãn/trạng thái model AI + audit. | — |
| 84 | `server/api/admin/languages/ai-translate-key.post.ts` | R4 | 49 | Dịch một khoá giao diện bằng AI rồi ghi DB. | — |
| 85 | `server/api/admin/ai/moderation/queue.get.ts` | R4 | 46 | Danh sách hàng chờ kiểm duyệt AI (phân trang). | — |
| 86 | `server/api/admin/ai/budget/index.put.ts` | R4 | 45 | Sửa hạn mức chi AI + audit. | — |
| 87 | `server/api/admin/chatbot/sessions/[id]/index.delete.ts` | R4 | 43 | Xoá một phiên chat + audit trong một transaction. | — |
| 88 | `server/api/admin/ai/moderation/settings.get.ts` | R4 | 41 | Đọc cấu hình kiểm duyệt AI (kèm prompt mặc định). | — |
| 89 | `server/api/admin/chatbot/settings/index.get.ts` | R4 | 38 | Đọc cấu hình chatbot (key đã che). | — |
| 90 | `server/api/admin/ai/providers/[id].delete.ts` | R4 | 36 | Xoá nhà cung cấp AI (chặn khi còn dịch vụ dùng) + audit. | — |
| 91 | `server/api/admin/ai/pricing/bulk-delete.post.ts` | R4 | 34 | Xoá hàng loạt giá model + audit. | — |
| 92 | `server/api/admin/ai/providers/index.get.ts` | R4 | 33 | Danh sách nhà cung cấp AI, key đã che. | — |
| 93 | `server/api/admin/ai/moderation/rules/[id].delete.ts` | R4 | 32 | Xoá một luật kiểm duyệt + audit. | — |
| 94 | `server/api/admin/ai/moderation/worker-status.get.ts` | R4 | 32 | Trạng thái worker, số hàng chờ, job quét lại. | — |
| 95 | `server/api/admin/ai/pricing/[model].delete.ts` | R4 | 32 | Xoá giá một model AI + audit. | — |
| 96 | `server/api/admin/ai/pricing/index.get.ts` | R4 | 30 | Danh sách giá model AI. | — |
| 97 | `server/api/admin/chatbot/test.post.ts` | R4 | 27 | Gọi thử nhà cung cấp AI của chatbot + audit. | — |
| 98 | `server/api/admin/articles/[id]/translations/translate-all.post.ts` | R4 | 22 | Dịch bài sang mọi ngôn ngữ bằng AI. Handler mỏng — service `article-translations.ts` phủ 23,8 %. | — |
| 99 | `server/api/admin/chatbot/small-talk/index.get.ts` | R4 | 22 | Danh sách kho thường nhật. Handler mỏng — service `chatbot-small-talk.ts` phủ 52,6 %. | — |
| 100 | `server/api/admin/system/universal-translate.post.ts` | R4 | 22 | Khởi chạy job dịch AI toàn hệ thống. Handler mỏng — service `universal-translation.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 101 | `server/api/admin/ai/moderation/restart-worker.post.ts` | R4 | 21 | Khởi động lại worker kiểm duyệt. | — |
| 102 | `server/api/admin/articles/bulk-translate.post.ts` | R4 | 20 | Dịch hàng loạt bài bằng AI. Handler mỏng — service `article-translations.ts` phủ 23,8 %. | — |
| 103 | `server/api/admin/articles/[id]/translations/translate.post.ts` | R4 | 19 | Dịch bài sang một ngôn ngữ bằng AI. Handler mỏng — service `article-translations.ts` phủ 23,8 %. | — |
| 104 | `server/api/admin/ai/moderation/rules.get.ts` | R4 | 18 | Danh sách luật kiểm duyệt. | — |
| 105 | `server/api/admin/ai/budget/index.get.ts` | R4 | 17 | Đọc hạn mức chi AI; chèn hàng mặc định nếu chưa có (GET có ghi). | — |
| 106 | `server/api/admin/chatbot/small-talk/bulk-delete.post.ts` | R4 | 17 | Xoá hàng loạt kho thường nhật. Handler mỏng — service `chatbot-small-talk.ts` phủ 52,6 %. | — |
| 107 | `server/api/admin/chatbot/small-talk/bulk-enabled.post.ts` | R4 | 17 | Bật/tắt hàng loạt kho thường nhật. Handler mỏng — service `chatbot-small-talk.ts` phủ 52,6 %. | — |
| 108 | `server/api/public/chatbot/session.post.ts` | R4 | 17 | Cấp token phiên chat ký HMAC. | — |
| 109 | `server/api/admin/ai/services/index.get.ts` | R4 | 15 | Cấu hình 5 dịch vụ AI + prompt mặc định. | — |
| 110 | `server/api/admin/chatbot/small-talk/[id].put.ts` | R4 | 15 | Sửa một mục kho thường nhật. Handler mỏng — service `chatbot-small-talk.ts` phủ 52,6 %. | — |
| 111 | `server/api/admin/chatbot/knowledge/index.get.ts` | R4 | 14 | Danh sách kho nghiệp vụ. Handler mỏng — service `chatbot-knowledge.ts` phủ 96,9 %. Rủi ro thật thấp hơn lớp. | — |
| 112 | `server/api/admin/chatbot/small-talk/[id].delete.ts` | R4 | 14 | Xoá một mục kho thường nhật. Handler mỏng — service `chatbot-small-talk.ts` phủ 52,6 %. | — |
| 113 | `server/api/admin/chatbot/small-talk/index.post.ts` | R4 | 12 | Thêm một mục kho thường nhật. Handler mỏng — service `chatbot-small-talk.ts` phủ 52,6 %. | — |
| 114 | `server/api/public/chatbot/sources.get.ts` | R4 | 12 | Nguồn công khai của một câu trả lời trong kho. | — |
| 115 | `server/api/admin/chatbot/small-talk/[id]/toggle.patch.ts` | R4 | 11 | Bật/tắt một mục kho thường nhật. Handler mỏng — service `chatbot-small-talk.ts` phủ 52,6 %. | — |
| 116 | `server/api/admin/system/translation-coverage.get.ts` | R4 | 11 | Độ phủ bản dịch trên 3 trụ (UI, khối trang, bài). Handler mỏng — service `universal-translation.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 117 | `server/api/admin/chatbot/small-talk/[id].get.ts` | R4 | 10 | Đọc một mục kho thường nhật. Handler mỏng — service `chatbot-small-talk.ts` phủ 52,6 %. | — |
| 118 | `server/api/admin/system/universal-translate-status.get.ts` | R4 | 10 | Trạng thái job dịch toàn hệ thống. Handler mỏng — service `universal-translation.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 119 | `server/api/admin/chatbot/settings/clear.post.ts` | R4 | 7 | Xoá API key chatbot đã lưu. Handler mỏng — service `chatbot-settings.ts` phủ 77 %. | — |
| 120 | `server/api/admin/system/universal-translate-cancel.post.ts` | R4 | 7 | Huỷ job dịch toàn hệ thống. Handler mỏng — service `universal-translation.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 121 | `server/plugins/chatbot-encryption-secret.ts` | R4 | 4 | Kiểm `CHATBOT_ENCRYPTION_SECRET` lúc boot. | — |
| 122 | `server/api/admin/chatbot/knowledge/[id].delete.ts` | R4 | 3 | Xoá một mục kho nghiệp vụ chatbot. Handler mỏng — service `chatbot-knowledge.ts` phủ 96,9 %. Rủi ro thật thấp hơn lớp. | — |
| 123 | `server/api/admin/chatbot/knowledge/[id].get.ts` | R4 | 3 | Đọc một mục kho nghiệp vụ. Handler mỏng — service `chatbot-knowledge.ts` phủ 96,9 %. Rủi ro thật thấp hơn lớp. | — |

#### R5 — đường ghi khác (handler/service đổi CSDL) — 83 tệp, 3268 dòng mã

| # | Tệp | Lớp | Dòng mã | Việc | Integration |
|---|---|---|---|---|---|
| 124 | `server/db/seed.ts` | R5 | 349 | Seed chỉ-chèn chạy mỗi lần khởi động: admin, vai trò, ngôn ngữ, kho chatbot. | trực tiếp (tiến trình con): `schema-upgrade`, `seed-markers`, `media-category-migration` |
| 125 | `server/services/languages.ts` | R5 | 331 | CRUD ngôn ngữ + chuỗi dịch, seed mặc định; mọi ghi kèm audit. | một phần: chỉ `seedDefaultLanguagesAndTranslations`, chạy qua `seed.ts` (tiến trình con) ở `schema-upgrade`/`seed-markers`; `schema-upgrade` chỉ đọc mã nguồn tệp này |
| 126 | `server/services/submission-workflow.ts` | R5 | 262 | Vòng đời đơn: xem lần đầu, đổi trạng thái có cạnh tranh, ghi chú, liên hệ. | trực tiếp: `submission-workflow` |
| 127 | `server/services/social-links.ts` | R5 | 220 | CRUD + sắp xếp liên kết MXH, ghi kèm audit. | — |
| 128 | `server/services/layout-settings.ts` | R5 | 93 | Kiểm + lưu cấu hình layout (`settings.layout_config`) + audit. | — |
| 129 | `server/api/admin/articles/export-google.post.ts` | R5 | 83 | Xuất bài sang Google Sheets/Docs trên Drive đã liên kết (ghi ra ngoài, không ghi CSDL). | — |
| 130 | `server/api/public/comments/index.post.ts` | R5 | 67 | Người đọc đăng bình luận/trả lời (kiểm duyệt, giới hạn nằm trong service). | qua `comments.ts`: `notification-email`, `notification-page` |
| 131 | `server/api/admin/categories/[id].put.ts` | R5 | 60 | Sửa thể loại: slug chống trùng, tự dịch tên. | — |
| 132 | `server/api/admin/pages/[id]/versions/index.post.ts` | R5 | 57 | Lưu phiên bản trang (xoá-rồi-chèn trong một transaction). | — |
| 133 | `server/api/admin/articles/[id]/boost.delete.ts` | R5 | 55 | Huỷ job tăng lượt xem đang chạy + audit. | — |
| 134 | `server/api/admin/content-types/[id].put.ts` | R5 | 49 | Sửa loại nội dung: slug, tự dịch tên. | — |
| 135 | `server/api/admin/categories/index.post.ts` | R5 | 44 | Tạo thể loại: kiểm cha, slug chống trùng, tự dịch tên. | — |
| 136 | `server/api/admin/comments/[id]/visibility.patch.ts` | R5 | 44 | Ẩn/hiện một bình luận + audit. | — |
| 137 | `server/api/admin/pages/[id].put.ts` | R5 | 43 | Sửa trang (slug, SEO) + audit. | — |
| 138 | `server/api/admin/settings/sitemap/index.put.ts` | R5 | 39 | Lưu sitemap đã sửa + audit. | — |
| 139 | `server/api/admin/submissions/[id]/index.get.ts` | R5 | 37 | Chi tiết đơn + dòng thời gian; ghi "xem lần đầu" (GET có ghi). | qua `submission-workflow.ts`: `submission-workflow` |
| 140 | `server/api/admin/pages/[id]/blocks/reorder.put.ts` | R5 | 36 | Sắp xếp khối trong trang + audit. | — |
| 141 | `server/api/admin/pages/index.post.ts` | R5 | 35 | Tạo trang + audit. | — |
| 142 | `server/api/admin/home-sections/[id].put.ts` | R5 | 34 | Sửa khối trang chủ cũ (`home_sections`). | — |
| 143 | `server/api/admin/media-portal/categories/[id].put.ts` | R5 | 34 | Sửa danh mục video. | — |
| 144 | `server/api/admin/pages/[id]/versions/[versionId]/restore.post.ts` | R5 | 34 | Khôi phục trang về một phiên bản + audit. | — |
| 145 | `server/api/public/reader/notifications/read.post.ts` | R5 | 34 | Đánh dấu thông báo đã đọc (có giới hạn). Handler mỏng — service `notifications.ts` phủ 96,7 %. Rủi ro thật thấp hơn lớp. | qua `notifications.ts`: `notification-page` |
| 146 | `server/api/public/reader/profile.put.ts` | R5 | 34 | Người đọc đổi tên hiển thị (có giới hạn). Handler mỏng — service `readers.ts` phủ 36 %, `comments.ts` phủ 100 %. | qua `comments.ts`: `notification-email`, `notification-page` |
| 147 | `server/plugins/translation-reaper.ts` | R5 | 34 | Lúc boot, đánh dấu bản dịch kẹt `translating` quá 30 phút là `failed`. | — |
| 148 | `server/api/admin/home-sections/[id]/toggle.patch.ts` | R5 | 33 | Bật/tắt khối trang chủ cũ + audit. | — |
| 149 | `server/api/admin/pages/[id]/versions/[versionId].delete.ts` | R5 | 31 | Xoá một phiên bản trang + audit. | — |
| 150 | `server/api/admin/comments/index.get.ts` | R5 | 30 | Danh sách bình luận cho kiểm duyệt; ghi audit mỗi lượt đọc (GET có ghi). Handler mỏng — service `comments.ts` phủ 100 %. Rủi ro thật thấp hơn lớp. | qua `comments.ts`: `notification-email`, `notification-page` |
| 151 | `server/api/admin/content-types/index.post.ts` | R5 | 30 | Tạo loại nội dung: slug chống trùng, tự dịch tên. | — |
| 152 | `server/api/admin/home-sections/reorder.put.ts` | R5 | 30 | Sắp xếp khối trang chủ cũ + audit. | — |
| 153 | `server/api/admin/pages/[id]/blocks/[blockId].delete.ts` | R5 | 30 | Xoá một khối khỏi trang + audit. | — |
| 154 | `server/api/admin/comments/reply.post.ts` | R5 | 29 | Cổng trả lời bình luận dưới nhãn "Ban quản trị". Handler mỏng — service `comments.ts` phủ 100 %. Rủi ro thật thấp hơn lớp. | qua `comments.ts`: `notification-email`, `notification-page` |
| 155 | `server/api/admin/languages/sync.post.ts` | R5 | 29 | Bổ sung khoá dịch còn thiếu từ seed. | — |
| 156 | `server/api/admin/media-portal/external.post.ts` | R5 | 29 | Đăng ký video nguồn ngoài (YouTube). Handler mỏng — service `media-portal.ts` phủ 100 %. Rủi ro thật thấp hơn lớp. | — |
| 157 | `server/api/public/livestream/chat/send.post.ts` | R5 | 29 | Gửi tin chat livestream; danh tính lấy từ vé. Handler mỏng — service `livestream-chat.ts` phủ 98,9 %. Rủi ro thật thấp hơn lớp. | — |
| 158 | `server/api/public/reader/profile/email-notifications.put.ts` | R5 | 29 | Bật/tắt email báo có trả lời. Handler mỏng — service `readers.ts` phủ 36 %. | — |
| 159 | `server/services/content-types.ts` | R5 | 29 | Xoá loại nội dung (quyền `categories`). | — |
| 160 | `server/api/admin/cache-clear.post.ts` | R5 | 27 | Xoá bộ đệm SWR của trang công khai + audit. | — |
| 161 | `server/api/admin/languages/seed-default.post.ts` | R5 | 27 | Nạp lại ngôn ngữ + bản dịch mặc định. | — |
| 162 | `server/api/admin/livestream/start.post.ts` | R5 | 27 | Bắt đầu buổi phát (409 khi đang có lượt khác). Handler mỏng — service `livestream.ts` phủ 96,5 %. Rủi ro thật thấp hơn lớp. | qua `livestream.ts`: `livestream-toggle` |
| 163 | `server/api/admin/media-portal/categories/[id].delete.ts` | R5 | 26 | Xoá danh mục video (chặn khi còn video). | — |
| 164 | `server/api/admin/pages/[id]/draft.put.ts` | R5 | 26 | Lưu bản nháp trang (không chạm khối đang chạy). | — |
| 165 | `server/services/categories.ts` | R5 | 26 | Xoá thể loại có kiểm con/bài, dùng chung cho route đơn và hàng loạt. | — |
| 166 | `server/api/admin/articles/bulk-publish-translations.post.ts` | R5 | 25 | Xuất bản hàng loạt bản dịch AI chưa xuất bản. Handler mỏng — service `article-translations.ts` phủ 23,8 %. | — |
| 167 | `server/api/admin/livestream/[id]/recording.post.ts` | R5 | 25 | Lưu buổi phát đã dừng thành mục media. Handler mỏng — service `livestream.ts` phủ 96,5 %. Rủi ro thật thấp hơn lớp. | qua `livestream.ts`: `livestream-toggle` |
| 168 | `server/api/admin/media-portal/categories/index.post.ts` | R5 | 25 | Tạo danh mục video. | — |
| 169 | `server/api/admin/languages/[code]/translations/index.put.ts` | R5 | 24 | Lưu chuỗi dịch giao diện. Handler mỏng — service `languages.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 170 | `server/api/admin/livestream/chat/[id].delete.ts` | R5 | 24 | Gỡ (đánh dấu xoá) một tin chat livestream. Handler mỏng — service `livestream-chat.ts` phủ 98,9 %. Rủi ro thật thấp hơn lớp. | — |
| 171 | `server/api/admin/settings/favicon.delete.ts` | R5 | 24 | Trả favicon về bộ mặc định. | — |
| 172 | `server/api/admin/livestream/stop.post.ts` | R5 | 23 | Dừng buổi phát. Handler mỏng — service `livestream.ts` phủ 96,5 %. Rủi ro thật thấp hơn lớp. | qua `livestream.ts`: `livestream-toggle` |
| 173 | `server/services/pages.ts` | R5 | 23 | Xoá trang, dùng chung cho route đơn và hàng loạt. | — |
| 174 | `server/api/admin/articles/[id]/translations/[lang].put.ts` | R5 | 22 | Sửa bản dịch bài viết (lọc HTML trong service). Handler mỏng — service `article-translations.ts` phủ 23,8 %. | — |
| 175 | `server/api/admin/articles/[id]/translations/[lang]/status.patch.ts` | R5 | 22 | Đổi trạng thái bản dịch. Handler mỏng — service `article-translations.ts` phủ 23,8 %. | — |
| 176 | `server/api/admin/ip-bans/index.post.ts` | R5 | 22 | Chặn IP/CIDR IPv4 (kiểm giá trị trong service) + audit. Handler mỏng — service `ip-bans.ts` phủ 36,4 %. | — |
| 177 | `server/api/admin/languages/reorder.post.ts` | R5 | 22 | Sắp xếp ngôn ngữ. Handler mỏng — service `languages.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 178 | `server/api/admin/languages/index.post.ts` | R5 | 21 | Thêm một ngôn ngữ. Handler mỏng — service `languages.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 179 | `server/services/submissions.ts` | R5 | 20 | Xoá đơn đăng ký + audit. | — |
| 180 | `server/api/admin/languages/[code].put.ts` | R5 | 18 | Sửa một ngôn ngữ. Handler mỏng — service `languages.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 181 | `server/api/admin/submissions/bulk-status.post.ts` | R5 | 18 | Đổi trạng thái đơn hàng loạt. Handler mỏng — service `submission-workflow.ts` 0 % ở unit nhưng có suite integration riêng. | qua `submission-workflow.ts`: `submission-workflow` |
| 182 | `server/api/admin/articles/[id]/translations/[lang].delete.ts` | R5 | 17 | Xoá một bản dịch bài viết. Handler mỏng — service `article-translations.ts` phủ 23,8 %. | — |
| 183 | `server/api/admin/articles/bulk-comments.post.ts` | R5 | 17 | Bật/tắt bình luận cho nhiều bài. Handler mỏng — service `articles.ts` phủ 87,6 %. Rủi ro thật thấp hơn lớp. | — |
| 184 | `server/api/admin/readers/[id]/ban.post.ts` | R5 | 16 | Khoá một người đọc. Handler mỏng — service `readers.ts` phủ 36 %. | — |
| 185 | `server/api/admin/social-links/[id].put.ts` | R5 | 15 | Sửa liên kết MXH. Handler mỏng — service `social-links.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 186 | `server/api/admin/submissions/[id]/status.put.ts` | R5 | 14 | Đổi trạng thái đơn (có cạnh tranh, người thua nhận 409). Handler mỏng — service `submission-workflow.ts` 0 % ở unit nhưng có suite integration riêng. | qua `submission-workflow.ts`: `submission-workflow` |
| 187 | `server/api/admin/comments/[id].delete.ts` | R5 | 13 | Admin xoá bình luận (cascade trả lời). Handler mỏng — service `comments.ts` phủ 100 %. Rủi ro thật thấp hơn lớp. | qua `comments.ts`: `notification-email`, `notification-page` |
| 188 | `server/api/admin/ip-bans/[id].delete.ts` | R5 | 13 | Gỡ chặn một IP + audit. Handler mỏng — service `ip-bans.ts` phủ 36,4 %. | — |
| 189 | `server/api/admin/readers/[id].delete.ts` | R5 | 13 | Xoá tài khoản người đọc. Handler mỏng — service `readers.ts` phủ 36 %. | — |
| 190 | `server/api/admin/readers/[id]/comments.delete.ts` | R5 | 13 | Xoá mọi bình luận của một người đọc. Handler mỏng — service `readers.ts` phủ 36 %. | — |
| 191 | `server/api/admin/readers/[id]/unban.post.ts` | R5 | 13 | Mở khoá một người đọc. Handler mỏng — service `readers.ts` phủ 36 %. | — |
| 192 | `server/api/public/comments/[id].delete.ts` | R5 | 13 | Người đọc xoá bình luận của mình. Handler mỏng — service `comments.ts` phủ 100 %. Rủi ro thật thấp hơn lớp. | qua `comments.ts`: `notification-email`, `notification-page` |
| 193 | `server/api/admin/social-links/reorder.post.ts` | R5 | 12 | Sắp xếp liên kết MXH. Handler mỏng — service `social-links.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 194 | `server/api/admin/submissions/[id]/contact.post.ts` | R5 | 12 | Ghi nhận đã liên hệ người dân. Handler mỏng — service `submission-workflow.ts` 0 % ở unit nhưng có suite integration riêng. | qua `submission-workflow.ts`: `submission-workflow` |
| 195 | `server/api/admin/languages/[code].delete.ts` | R5 | 11 | Xoá một ngôn ngữ. Handler mỏng — service `languages.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 196 | `server/api/admin/settings/layout.put.ts` | R5 | 11 | Lưu cấu hình layout + audit. Handler mỏng — service `layout-settings.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 197 | `server/api/admin/social-links/[id].delete.ts` | R5 | 11 | Xoá liên kết MXH. Handler mỏng — service `social-links.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 198 | `server/api/admin/social-links/index.post.ts` | R5 | 11 | Thêm liên kết MXH. Handler mỏng — service `social-links.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 199 | `server/api/admin/submissions/[id]/notes.post.ts` | R5 | 11 | Thêm ghi chú vào đơn. Handler mỏng — service `submission-workflow.ts` 0 % ở unit nhưng có suite integration riêng. | qua `submission-workflow.ts`: `submission-workflow` |
| 200 | `server/api/admin/articles/[id].delete.ts` | R5 | 7 | Xoá bài viết (quyền theo loại nằm trong service). Handler mỏng — service `articles.ts` phủ 87,6 %. Rủi ro thật thấp hơn lớp. | — |
| 201 | `server/api/admin/categories/[id].delete.ts` | R5 | 7 | Xoá thể loại (chặn khi còn con/bài). Handler mỏng — service `categories.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 202 | `server/api/admin/content-types/[id].delete.ts` | R5 | 7 | Xoá loại nội dung. Handler mỏng — service `content-types.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 203 | `server/api/admin/content-types/bulk-delete.post.ts` | R5 | 7 | Xoá hàng loạt loại nội dung. Handler mỏng — service `content-types.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 204 | `server/api/admin/pages/[id].delete.ts` | R5 | 7 | Xoá trang (trừ trang hệ thống). Handler mỏng — service `pages.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 205 | `server/api/admin/pages/bulk-delete.post.ts` | R5 | 7 | Xoá hàng loạt trang. Handler mỏng — service `pages.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 206 | `server/api/admin/submissions/[id].delete.ts` | R5 | 7 | Xoá đơn đăng ký (dọn spam). Handler mỏng — service `submissions.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |

#### R6 — handler chỉ đọc — 42 tệp, 1333 dòng mã

| # | Tệp | Lớp | Dòng mã | Việc | Integration |
|---|---|---|---|---|---|
| 207 | `server/api/admin/articles/export-batch.get.ts` | R6 | 115 | Xuất tối đa 50 bài ra ZIP HTML, lọc quyền từng bài. | — |
| 208 | `server/api/admin/articles/[id]/export.get.ts` | R6 | 98 | Xuất một bài ra HTML độc lập hoặc Markdown. | — |
| 209 | `server/api/admin/media-portal/index.get.ts` | R6 | 81 | Danh sách mục video cho admin. | — |
| 210 | `server/api/admin/media-portal/youtube-meta.post.ts` | R6 | 67 | Lấy metadata YouTube qua oEmbed; không ghi CSDL. | — |
| 211 | `server/api/public/comments/[articleSlug].get.ts` | R6 | 64 | Một trang bình luận của bài/video. | qua `comments.ts`: `notification-email`, `notification-page`; qua `notifications.ts`: `notification-page` |
| 212 | `server/api/admin/media/index.get.ts` | R6 | 60 | Danh sách thư viện ảnh. | — |
| 213 | `server/api/public/reader/comments.get.ts` | R6 | 59 | Bình luận của chính người đọc (danh tính từ vé). | — |
| 214 | `server/api/admin/articles/translation-stats.get.ts` | R6 | 55 | Đếm bản dịch AI chưa xuất bản cho badge. | — |
| 215 | `server/api/admin/categories/[id]/articles.get.ts` | R6 | 53 | Danh sách bài của một thể loại. | — |
| 216 | `server/api/admin/submissions/index.get.ts` | R6 | 52 | Danh sách đơn + đếm theo trạng thái. | qua `submission-workflow.ts`: `submission-workflow` |
| 217 | `server/routes/favicon.ico.ts` | R6 | 52 | Phục `/favicon.ico` theo cài đặt. | — |
| 218 | `server/api/admin/media-portal/categories/index.get.ts` | R6 | 38 | Danh sách danh mục video + số video. | — |
| 219 | `server/api/public/reader/chats.get.ts` | R6 | 38 | Các cuộc chat người đọc đã nhận về tài khoản (danh tính từ vé). | — |
| 220 | `server/api/admin/pages/[id].get.ts` | R6 | 36 | Đọc một trang + khối. | — |
| 221 | `server/api/admin/pages/[id]/versions/index.get.ts` | R6 | 32 | Danh sách phiên bản trang. | — |
| 222 | `server/routes/sitemap.xml.ts` | R6 | 32 | `/sitemap.xml`: bản đã lưu hoặc bản tĩnh. | — |
| 223 | `server/api/admin/content-types/index.get.ts` | R6 | 31 | Danh sách loại nội dung + số thể loại/bài. | — |
| 224 | `server/api/admin/categories/index.get.ts` | R6 | 25 | Danh sách thể loại (lọc theo loại). | — |
| 225 | `server/api/admin/settings/sitemap/index.get.ts` | R6 | 25 | Sitemap đã lưu + bản sinh mới. | — |
| 226 | `server/api/admin/readers/index.get.ts` | R6 | 21 | Danh sách người đọc. Handler mỏng — service `readers.ts` phủ 36 %. | — |
| 227 | `server/api/admin/analytics/dimensions/[dimension].get.ts` | R6 | 19 | Báo cáo analytics theo một chiều. Handler mỏng — service `analytics-reporting.ts` phủ 95,4 %. Rủi ro thật thấp hơn lớp. | qua `analytics-reporting.ts`: `public-read` |
| 228 | `server/api/admin/languages/[code]/translations/index.get.ts` | R6 | 18 | Chuỗi dịch của một ngôn ngữ. Handler mỏng — service `languages.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 229 | `server/api/admin/pages/index.get.ts` | R6 | 18 | Danh sách trang + số khối. | — |
| 230 | `server/api/admin/readers/[id].get.ts` | R6 | 18 | Chi tiết một người đọc. Handler mỏng — service `readers.ts` phủ 36 %. | — |
| 231 | `server/api/admin/analytics/pages.get.ts` | R6 | 17 | Báo cáo analytics theo trang. Handler mỏng — service `analytics-reporting.ts` phủ 95,4 %. Rủi ro thật thấp hơn lớp. | qua `analytics-reporting.ts`: `public-read` |
| 232 | `server/api/admin/settings/navigation/navbar.get.ts` | R6 | 17 | Đọc menu ngang (lùi về `nav_menu`). | — |
| 233 | `server/api/public/reader/notifications.get.ts` | R6 | 17 | Thông báo của chính người đọc. Handler mỏng — service `notifications.ts` phủ 96,7 %. Rủi ro thật thấp hơn lớp. | qua `notifications.ts`: `notification-page` |
| 234 | `server/api/public/translations/[code].get.ts` | R6 | 17 | Bản dịch giao diện công khai theo mã ngôn ngữ. | — |
| 235 | `server/api/admin/media-portal/[id].get.ts` | R6 | 16 | Chi tiết một mục video cho admin. Handler mỏng — service `media-portal.ts` phủ 100 %. Rủi ro thật thấp hơn lớp. | — |
| 236 | `server/api/admin/media/counts.get.ts` | R6 | 16 | Đếm ảnh theo provider (local/R2). | — |
| 237 | `server/api/admin/settings/navigation.get.ts` | R6 | 16 | Đọc menu cũ `nav_menu` (không trang nào gọi). | — |
| 238 | `server/api/admin/settings/navigation/mobile.get.ts` | R6 | 16 | Đọc cấu hình thanh điều hướng mobile. | — |
| 239 | `server/routes/robots.txt.ts` | R6 | 16 | `/robots.txt` động theo domain. | — |
| 240 | `server/api/admin/home-sections/index.get.ts` | R6 | 14 | Danh sách khối trang chủ cũ. | — |
| 241 | `server/api/admin/readers/[id]/impact.get.ts` | R6 | 10 | Đếm bình luận + trả lời admin sẽ mất theo khi xoá. Handler mỏng — service `comments.ts` phủ 100 %. Rủi ro thật thấp hơn lớp. | qua `comments.ts`: `notification-email`, `notification-page` |
| 242 | `server/api/admin/settings/sitemap/generate.post.ts` | R6 | 10 | Sinh lại sitemap từ DB, không lưu. | — |
| 243 | `server/api/admin/settings/layout.get.ts` | R6 | 9 | Đọc cấu hình layout. Handler mỏng — service `layout-settings.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 244 | `server/api/admin/analytics/summary.get.ts` | R6 | 8 | Tóm tắt analytics. Handler mỏng — service `analytics-reporting.ts` phủ 95,4 %. Rủi ro thật thấp hơn lớp. | qua `analytics-reporting.ts`: `public-read` |
| 245 | `server/api/admin/languages/index.get.ts` | R6 | 8 | Danh sách ngôn ngữ. Handler mỏng — service `languages.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 246 | `server/api/admin/social-links/index.get.ts` | R6 | 8 | Danh sách liên kết MXH (admin). Handler mỏng — service `social-links.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |
| 247 | `server/api/admin/ip-bans/index.get.ts` | R6 | 6 | Danh sách IP bị chặn. Handler mỏng — service `ip-bans.ts` phủ 36,4 %. | — |
| 248 | `server/api/public/social-links/index.get.ts` | R6 | 5 | Liên kết MXH công khai. Handler mỏng — service `social-links.ts` chưa nạp (0 %). Rủi ro nằm ở service. | — |

#### R7 — còn lại — 39 tệp, 1813 dòng mã

| # | Tệp | Lớp | Dòng mã | Việc | Integration |
|---|---|---|---|---|---|
| 249 | `app/composables/useI18n.ts` | R7 | 180 | Ngôn ngữ hiện tại + `t()`: tải bản dịch từ DB, lùi về từ điển cứng. | — |
| 250 | `server/utils/html-to-markdown.ts` | R7 | 156 | Đổi HTML bài viết sang Markdown cho `?format=md`. | — |
| 251 | `server/plugins/tracking.ts` | R7 | 121 | Chèn thẻ GA4/GTM/Pixel/Clarity và mã tuỳ biến từ settings vào HTML. | — |
| 252 | `app/composables/useReaderNotifications.ts` | R7 | 114 | Chuông thông báo người đọc: tải, đánh dấu đã đọc. | — |
| 253 | `app/composables/useLayoutNav.ts` | R7 | 88 | Menu điều hướng động (lùi về `DEFAULT_NAV`) cho layout mặc định. | — |
| 254 | `app/composables/useLiveSearch.ts` | R7 | 88 | Ô tìm nhanh ở header và ngăn kéo mobile. | — |
| 255 | `app/composables/useBulkSelection.ts` | R7 | 87 | Chọn nhiều hàng trong bảng admin (state riêng mỗi lần gọi). | — |
| 256 | `app/composables/usePagePreview.ts` | R7 | 83 | Cầu nối postMessage cho xem trước Page Builder. | — |
| 257 | `app/composables/useReadingHistory.ts` | R7 | 78 | Lịch sử bài đã đọc, chỉ ở localStorage. | — |
| 258 | `app/composables/usePlyrPlayer.ts` | R7 | 69 | Khởi tạo trình phát Plyr. | — |
| 259 | `app/composables/useHlsVideo.ts` | R7 | 64 | Gắn hls.js cho trình phát video và livestream. | — |
| 260 | `app/composables/useLayoutConfig.ts` | R7 | 62 | Đọc + chuẩn hoá cấu hình layout từ settings công khai. | — |
| 261 | `app/utils/ai-service-labels.ts` | R7 | 59 | Nhãn/hằng số dịch vụ AI cho các tab AI Panel. | — |
| 262 | `app/composables/useToast.ts` | R7 | 53 | Hàng đợi toast toàn cục. | — |
| 263 | `shared/blocks/types.ts` | R7 | 50 | Chỉ kiểu dữ liệu khối Page Builder — 0 % là ảo giác đo. | — |
| 264 | `app/utils/language-flags.ts` | R7 | 42 | Cờ emoji theo mã ngôn ngữ. | — |
| 265 | `app/composables/useImagePicker.ts` | R7 | 39 | Mở modal chọn ảnh dùng chung. | — |
| 266 | `app/utils/public-types.ts` | R7 | 38 | Chỉ kiểu response API công khai — 0 % là ảo giác đo. | — |
| 267 | `app/composables/useReaderMenu.ts` | R7 | 35 | Menu người đọc ở header/ngăn kéo (dựa trên `useReaderAuth`). | — |
| 268 | `app/composables/useMobileMenu.ts` | R7 | 34 | State ngăn kéo mobile, submenu, header dính. | — |
| 269 | `app/utils/docs/types.ts` | R7 | 26 | Chỉ kiểu cho tài liệu admin — 0 % là ảo giác đo. | — |
| 270 | `app/composables/useSiteSettings.ts` | R7 | 24 | Tải settings công khai qua `useAsyncData`. | — |
| 271 | `server/middleware/media-slug-redirect.ts` | R7 | 23 | 301 `/media/<slug>` sang short id. | — |
| 272 | `app/utils/submission-status.ts` | R7 | 20 | Re-export `shared/submission-status.ts` — 0 % là ảo giác đo. | — |
| 273 | `app/utils/blocks/registry.ts` | R7 | 19 | Re-export `shared/blocks/registry.ts` — 0 % là ảo giác đo. | — |
| 274 | `server/utils/legacy-urls.ts` | R7 | 19 | Bảng 301 từ URL cổng cũ. | — |
| 275 | `server/plugins/og-image.ts` | R7 | 16 | Chèn og:image/Twitter card vào HTML. | — |
| 276 | `server/plugins/favicon.ts` | R7 | 15 | Chèn thẻ favicon từ settings vào HTML. | — |
| 277 | `app/utils/blocks/types.ts` | R7 | 14 | Chỉ kiểu, re-export `shared/blocks/types.ts` — 0 % là ảo giác đo. | — |
| 278 | `app/utils/formatDate.ts` | R7 | 14 | Định dạng ngày dd/MM/yyyy, không lệch SSR/client. | — |
| 279 | `server/middleware/redirect-news-cat.ts` | R7 | 14 | 301 `?cat=` sang path segment. | — |
| 280 | `server/plugins/security-headers.ts` | R7 | 12 | Gỡ header `x-powered-by`. | — |
| 281 | `server/middleware/https-redirect.ts` | R7 | 11 | Chuyển HTTP → HTTPS ở production. | — |
| 282 | `app/composables/useBrokenImageFallback.ts` | R7 | 9 | Ẩn ảnh 404 trong khối `v-html` sau mount (logic thuần ở `broken-image.ts`). | — |
| 283 | `app/utils/media-duration.ts` | R7 | 9 | Đổi số giây thành chuỗi thời lượng. | — |
| 284 | `server/plugins/analytics-scheduler.ts` | R7 | 8 | Khởi động lịch gộp/dọn analytics lúc boot. | — |
| 285 | `server/plugins/view-boost-scheduler.ts` | R7 | 8 | Khởi động vòng giao lượt xem tăng dần lúc boot. | qua `view-boost-scheduler.ts`: `view-boost` |
| 286 | `server/middleware/legacy-urls.ts` | R7 | 7 | 301 từ địa chỉ cổng cũ (ASP.NET). | — |
| 287 | `server/plugins/runtime-config-global.ts` | R7 | 5 | Gắn `useRuntimeConfig` lên `globalThis`. | — |

### Top 15 — viết test hành vi trước (task 5.2)

**Cách chọn.** Đi theo đúng thứ tự xếp hạng ở trên và bỏ qua:
- mã phía trình duyệt (`app/**`): ranh giới an ninh nằm ở máy chủ, `useReaderAuth`/`useAdminAuth`/`useBackupSettings` chỉ là trạng thái giao diện;
- handler mỏng: test service của nó (nếu service chưa nạp thì service đã có dòng riêng trong danh sách);
- tệp đã có suite integration chạy;
- tệp không có quyết định riêng ngoài một câu truy vấn (`users/index.get.ts`, `roles/index.get.ts`) và tệp chỉ có kiểu.

Kết quả: 13 tệp R1 có logic thật, rồi hai service R2 lớn nhất. Viết theo kiểu harness hiện có (`mock.module`, DB giả, SQL thật trên `node:sqlite` khi câu truy vấn là thứ cần kiểm), và mỗi test phải đỏ khi hành vi bị phá (D-COV).

**Ngay sau top 15**, cùng quy tắc: `backup-drive.ts` (R2, 122), `settings/retention.get.ts` (72), `activity-logs/retention.get.ts` (52), `settings/retention.put.ts` (41), `settings/retention-run.post.ts` (34), `backup-drive-oauth-crypto.ts` (27); rồi R3: `media/upload.post.ts` (155), `media/storage-size.get.ts` (88), `settings/favicon.post.ts` (81), `media-portal/[id]/thumbnail.post.ts` (42), `routes/uploads/[...path].ts` (36 — đường dẫn do khách gửi, đáng làm sớm dù đứng sau); rồi R4 mở đầu bằng `universal-translation.ts` (452).

| # | Tệp | Lớp | Dòng mã | Hành vi nên chốt |
|---|---|---|---|---|
| 1 | `server/services/google-oauth-settings.ts` | R1 | 198 | Client secret chỉ giải mã ở đây và không lọt ra phản hồi (`serializeGoogleOAuthSettings`); `clearGoogleOAuthSecret` xoá secret, ép tắt công tắc, giữ client id; `updateGoogleOAuthSettings` ghi kèm audit. |
| 2 | `server/api/admin/profile/history.get.ts` | R1 | 116 | Đọc lịch sử của chính mình không cần resource; đọc của tài khoản khác cần SuperAdmin nghiêm ngặt (`isSuperAdmin === true`) — có đủ mọi cờ trên `users` vẫn 403; lọc `from`/`to` theo ngày lịch VN. |
| 3 | `server/api/admin/users/[id]/mfa.delete.ts` | R1 | 59 | Không phải SuperAdmin → 403 (kể cả có `users.update`); xoá yếu tố và tăng `tokenVersion` của tài khoản đích trong cùng transaction với audit. |
| 4 | `server/api/admin/profile/mfa/disable.post.ts` | R1 | 58 | Sai mật khẩu nhập lại → từ chối, không xoá gì; đúng → xoá hẳn hàng và bí mật (không chỉ gắn cờ), thu hồi phiên khác. |
| 5 | `server/api/admin/auth/mfa/send-code.post.ts` | R1 | 47 | Chỉ chạy với vé challenge hợp lệ, không cần phiên; vượt giới hạn → 429. (Utils MFA đã có suite `mfa-email-code`; handler thì chưa.) |
| 6 | `server/api/admin/auth/logout.post.ts` | R1 | 44 | Token cũ hết hiệu lực sau đăng xuất (`tokenVersion` tăng), không chỉ xoá cookie; có audit. |
| 7 | `server/api/public/reader/claim-chats.post.ts` | R1 | 39 | Chỉ gắn phiên có token ký hợp lệ (chứng minh, không khai báo); thân request dị dạng → 400. |
| 8 | `server/utils/mfa/reauth.ts` | R1 | 39 | Mật khẩu sai → từ chối và tính vào giới hạn; vượt giới hạn → chặn kể cả khi mật khẩu đúng. |
| 9 | `server/api/admin/profile/mfa/index.get.ts` | R1 | 37 | Phản hồi dựng từ allowlist trường: không có bản mã, hash, secret TOTP. |
| 10 | `server/api/admin/profile/mfa/recovery-codes.delete.ts` | R1 | 34 | Đòi nhập lại mật khẩu; xoá mọi mã dự phòng; phản hồi nói đường khôi phục còn lại. |
| 11 | `server/api/admin/roles/[id].delete.ts` | R1 | 32 | Vai trò hệ thống → 400; vai trò còn tài khoản → 400; xoá thành công thì hàng + audit cùng commit. |
| 12 | `server/api/admin/auth/captcha.get.ts` | R1 | 22 | Lượt thứ 11 trong 60 giây cùng IP → 429 + `Retry-After`. |
| 13 | `server/plugins/require-secrets.ts` | R1 | 18 | Production: `JWT_SECRET` thiếu / dưới 16 ký tự / thuộc danh sách mặc định đã lộ → dừng boot; `ADMIN_PASSWORD` vi phạm chính sách → dừng; ngoài production không làm gì. |
| 14 | `server/services/backup-drive-oauth-config.ts` | R2 | 205 | Secret lưu dạng mã hoá, chỉ giải mã ở `getUsableDriveOauthConfig`; `serializeDriveOauthConfig` không trả secret; `clearDriveOauthSecret` ghi audit. |
| 15 | `server/services/backup-drive-oauth.ts` | R2 | 133 | Refresh token chỉ giải mã ở `getUsableDriveLink`; `serializeDriveLink` không lộ token; `clearDriveLink` xoá liên kết + audit. |

## Cách dùng
- Cục bộ: `npm run test:coverage`. Bảng của script in ở cuối log; lcov ở `node_modules/.cache/cdkt-coverage/lcov.info`; sau đó là ratchet. Các cờ và script chạy được trên Node 22, 24 và 26. Một test đỏ thì dừng trước bước tóm tắt (`&&`).
- CI: mở một lần chạy → *Summary* → mục **Test coverage** và **Coverage ratchet**.
- Khi viết test hành vi mới cho một file trong danh sách trên, chạy lại và nâng mức nền bằng `--update` trong cùng PR.
