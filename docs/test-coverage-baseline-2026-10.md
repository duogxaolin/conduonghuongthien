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

## Lát R3 của task 5.2 — đo lại 2026-10-27 (Node 24, `ebbffa5`)

"R3" ở đây là **lát thứ ba** của task 5.2 (sau lát R1 `3598a59` và R2 `99695ca`), **không** phải lớp rủi ro R3 ở bảng trên.

**Đo ở đâu.** `npm run test:coverage` trên `wave3/integration` = `ebbffa5`, image `cdkt-cov:node24` (Node 24.21, `TZ=Asia/Ho_Chi_Minh`, lệnh của CI). Trước lát: 759 tệp, 248 chưa nạp, **80,06 %** (67 169 / 83 896). Trên cây chưa đụng gì, ratchet đã báo RISE ở `app/utils` (+0,59), `server/services` (+0,15) và `shared` (+3,58) — do các nhánh gộp trước, không do lát này.

### Cách chọn

- Danh sách gốc: mọi tệp `server/**` và `shared/**` có độ phủ dòng < 40 % — 235 tệp, không tệp nào ở `shared/`. Giữ tệp thuộc sáu lớp của task (xác thực, phân quyền, backup, giữ dữ liệu, tải lên/đồng bộ/phục tệp media, cổng AI).
- Xếp theo: (1) ranh giới an ninh — đường công khai không cần đăng nhập trước, (2) mất dữ liệu, (3) tiền/xác thực, rồi cỡ.
- Bỏ: tệp lát R1/R2 đã làm; `moderation-*` và endpoint chat (agent khác đang làm); handler mỏng trên service ≥ 80 %; tệp chỉ có kiểu — `server/services/ai-gateway-types.ts` (36 dòng, 0 %) chỉ có `import type` và khai báo kiểu, con số 0 % là ảo giác đo.

### Đã làm trong lát này (14 tệp)

| # | Tệp | Trước | Sau | Vì sao ở đây | Suite |
|---|---|---|---|---|---|
| 1 | `server/services/livestream-hls.ts` | 20,3 % (37/182) | 98,4 % (179/182) | Công khai, không đăng nhập; khách chọn đường dẫn tệp trên đĩa | `livestream-hls-serving-behavior` |
| 2 | `server/api/public/livestream/[id]/assets/[...path].get.ts` | 0 % (12) | 100 % | như trên | như trên |
| 3 | `server/api/public/livestream/[id]/stream.get.ts` | 0 % (11) | 100 % | như trên | như trên |
| 4 | `server/api/admin/media/upload.post.ts` | 0 % (155) | 94,1 % | Tệp vào thư mục công khai / R2 — XSS lưu trữ nếu tin tên/header | `media-upload-behavior` |
| 5 | `server/routes/favicon.ico.ts` | 0 % (52) | 93,0 % | Công khai; phục tệp đĩa do một giá trị CSDL chọn | `favicon-lifecycle-behavior` |
| 6 | `server/utils/media-local.ts` | 36,4 % (16/44) | 100 % | Xoá tệp theo `storage_path` của hàng `media` | `media-local-confinement-behavior` |
| 7 | `server/api/admin/settings/favicon.post.ts` | 0 % (81) | 100 % | Ghi tệp vào `public/` | `favicon-lifecycle-behavior` |
| 8 | `server/api/admin/settings/favicon.delete.ts` | 0 % (24) | 100 % | như trên | như trên |
| 9 | `server/api/admin/ai/providers/[id]/test.post.ts` | 0 % (73) | 97,8 % | Gửi API key đã lưu tới địa chỉ cán bộ gõ (SSRF / lộ key) | `ai-provider-probe-behavior` |
| 10 | `server/api/admin/settings/retention-run.post.ts` | 0 % (34) | 100 % | Xoá dữ liệu ngay | `retention-run-now-behavior` |
| 11 | `server/api/admin/settings/retention.put.ts` | 0 % (41) | 100 % | Chính sách quyết định xoá gì | `retention-policy-save-behavior` |
| 12 | `server/api/admin/settings/retention.get.ts` | 0 % (72) | 100 % | Phải đếm "quá hạn" trên đúng cột mà lượt dọn xoá | `retention-status-behavior` |
| 13 | `server/api/admin/activity-logs/retention.get.ts` | 0 % (52) | 100 % | như trên | như trên |
| 14 | `server/api/admin/ai/budget/index.put.ts` | 0 % (45) | 96,7 % | Trần chi AI (tiền) | `ai-budget-update-behavior` |

Số trong ngoặc ở cột "Trước" là dòng có mã của tệp chưa nạp; cột "Sau" đếm mọi dòng vật lý của tệp đã nạp (xem "Cách đọc cho đúng"), đo SAU đợt sửa FINDING-R3-1..3 bên dưới (lúc vừa xong lát, trước đợt sửa: `retention.put.ts` 97,1 %). Kéo theo: `server/services/retention-policy.ts` 79,9 % → 100 % (97,2 % trước đợt sửa).

**Sau lát và đợt sửa R3-1..3** (`npm run test:coverage`, Node 24, cây cuối của nhánh lát): 760 tệp (thêm `retention-state.ts` tách ra ở R3-1), 236 chưa nạp, **81,32 %** (68 664 / 84 439). Theo thư mục: `server/api` 56,74 → 60,82, `server/routes` 40,12 → 77,43, `server/services` 85,28 → 86,22, `server/utils` 93,53 → 93,90. (Ngay sau lát, trước đợt sửa: 759 tệp, 81,23 % — 68 506 / 84 339; `server/api` 60,75, `server/services` 86,00.) Mức nền ratchet nâng đúng bốn thư mục đó (`server/services` lấy số đo mới 85,99, gồm cả +0,15 có sẵn trên cây); `app/utils` và `shared` giữ 95,13 / 95,9 vì lát này không đụng tới (lần nâng của chúng thuộc nhánh khác).

### Cách chạy và cái bẫy đã gặp

- Cùng kiểu R1/R2: app h3 thật + middleware `admin-auth` thật (`_h3-handler-server.ts`), SQL MySQL của Drizzle chạy trên SQLite (`_sqlite-mysql-db.ts`), tệp thật dưới thư mục làm việc tạm, sharp thật, phong bì AES-GCM thật. Biên giả: SDK S3 (upload), hai đường mạng của `safeProviderRequest` — DNS và socket HTTPS (`resolveHost`, `request`) — còn chính sách URL, kiểm IP công khai, ghim địa chỉ, từ chối redirect là mã thật; `runRetentionPass` (khoá tên MySQL + `DELETE … LIMIT` trên pool riêng — có suite riêng).
- Helper `_h3-handler-server.ts`: thân `FormData` gửi multipart như trình duyệt, `origin` cho request thô, thêm `readMultipartFormData`/`setResponseHeaders`/`sendStream` vào danh sách auto-import.
- **Đường dẫn có `..` phải gửi bằng `node:http` với `{ host, port, path }`.** `fetch` và `http.request(<chuỗi URL>)` đều tự giải `.`/`..` trước khi gửi — test "không thoát thư mục" qua chúng xanh mà không bao giờ gửi đòn tấn công (đã gặp: `./seg0.ts` trả 200). Suite HLS có một đường dẫn đối chứng (`v720/../seg0.ts` phải 404) để chứng minh đường dẫn tới máy chủ nguyên văn.
- Câu tổng hợp `NOW() - INTERVAL n DAY` của hai trang trạng thái giữ dữ liệu không chạy được trên SQLite (harness cố ý không xấp xỉ). Suite ghi lại SQL MySQL đã biên dịch của câu đó, trả số đếm soạn sẵn, và so **cột tuổi + số ngày** với câu `DELETE` mà `runDataRetention` thật gửi đi — bất biến xuyên tệp, đỏ khi một bên đổi cột (đột biến ở cả handler lẫn `data-retention.ts` đều bị giết).
- Một đột biến (`Content-Length` lớn hơn thân) làm request treo thay vì đỏ: request thô có hạn 5 s, script đột biến có `--test-timeout` + `timeout`. (Trong log đột biến HLS, dòng `hls-range-no-clip: KILLED (ℹ fail 0) … 311176ms` là lượt bị dừng bằng tay khi treo, không phải bằng chứng; bằng chứng là lượt chạy lại ngay sau, đỏ sau 5 s.)

### Đột biến (≥ 2 mỗi tệp, đỏ rồi hoàn lại; kịch bản và log ở thư mục bằng chứng)

| Suite | Đột biến | Đỏ | Sống sót (tương đương) |
|---|---|---|---|
| `media-upload-behavior` | 9 | 8 | bỏ nhánh 415 magic byte: `effectiveMime` thành `null` nên bước tra đuôi vẫn trả 415 — đột biến mạnh hơn (tin header khi magic byte không nhận ra) bị giết |
| `livestream-hls-serving-behavior` | 12 | 11 | bỏ `start >= size`: `end` đã kẹp ≤ size − 1 nên `start ≥ size` kéo theo `start > end` → vẫn 416. (Đột biến "handler assets nhận id bất kỳ" sống sót lượt đầu → test thêm ca id của phiên đã kết thúc → đỏ. Mỗi handler mỏng có hai đột biến: bỏ so id, bỏ so nguồn `upload`.) |
| `media-local-confinement-behavior` | 4 | 4 | — |
| `favicon-lifecycle-behavior` | 9 | 8 | bỏ riêng phép chặn `..` của tuyến `/favicon.ico`: lớp `startsWith(publicRoot + sep)` vẫn chặn; bỏ cả hai lớp → đỏ |
| `retention-policy-save-behavior` | 6 | 6 | — |
| `retention-run-now-behavior` | 5 | 5 | — |
| `retention-status-behavior` | 9 | 9 | — |
| `ai-budget-update-behavior` | 5 | 5 | — |
| `ai-provider-probe-behavior` | 6 | 6 | — |
| **Tổng** | **65** | **62** | **3**, đều có lớp phòng thủ thứ hai |

### Lỗi tìm thấy (ghim lúc viết test, sửa sau đó)

| Mã | Mức | Tệp | Lỗi | Trạng thái |
|---|---|---|---|---|
| FINDING-R3-1 | trung bình | `settings/retention.put.ts` + `saveRetentionPolicy` | Lưu chính sách (từng khoá trên pool) rồi mới ghi audit trên pool, không transaction. Audit hỏng → 500 nhưng cửa sổ xoá mới đã có hiệu lực, không ai biết ai đổi. Guard audit không thấy (chỉ hỏi tệp tự ghi). | **Đã sửa**: `saveRetentionPolicy(input, { userId })` ghi các khoá + dòng audit trong MỘT transaction; ảnh trước/sau tính từ một lượt đọc khoá đã lưu (không đọc lại qua `getDb()` trong tx); giá trị đã lưu hỏng → 500, không phải 400. Hàm vào `AUDITED_WRITES`; phần sổ sách `data_retention_state` tách sang `retention-state.ts` (tệp chính sách chạm trần 400 dòng). Test ghim đã lật; 3 đột biến đều đỏ |
| FINDING-R3-2 | thấp | `settings/retention-run.post.ts` | Lượt dọn commit trên pool riêng trước khi ghi audit; audit hỏng → 500 cho một lượt đã xoá, không lưu ai chạy (`data_retention_state` vẫn ghi số và `manual`) | **Đã sửa**: `runRetentionPass` nhận `beforePurge`, gọi khi đã giữ khoá và trước DELETE đầu tiên (ném → không xoá gì, nhả khoá, lỗi tới người gọi; bị khoá → không gọi). Handler ghi dòng `phase: 'started'` (ai, cửa sổ sắp áp) ở đó, fail-closed: không ghi được → 500 "chưa có bản ghi nào bị xoá". Dòng `phase: 'finished'` (mỗi bảng mất bao nhiêu) ghi sau, hỏng → `logError` + 200 `auditFailed: true`. Cùng khuôn bắt đầu/kết thúc của `rescan-all.post.ts`, khác ở chỗ dòng bắt đầu là bắt buộc vì job này xoá dữ liệu. Thứ tự ghim trên `runRetentionPass` thật (`retention-pass-attribution-behavior`); 4 đột biến đều đỏ |
| FINDING-R3-3 | thấp | 16 handler dưới `server/api/admin/ai/**` + `comments/[id]/visibility.patch.ts` (17 tệp, ghim ở `ai/budget/index.put.ts`) | `meta: JSON.stringify(…)` trước khi Drizzle mã hoá cột JSON lần nữa → `meta` là một chuỗi JSON, `JSON_EXTRACT(meta, '$.type')` không thấy gì | **Đã sửa**: cả 17 tệp truyền thẳng object (chỉ đổi dòng `meta`). Nơi đọc không cần sửa, không backfill: hai trang nhật ký (`activity-logs/index.get.ts`, `profile/history.get.ts`) chỉ lấy `ip`/`userAgent`/`mfaMethod` — 17 tệp chưa bao giờ ghi ba khoá đó — và coi chuỗi là "không có khoá" (`admin-profile-history-behavior` đã nạp sẵn một hàng meta chuỗi); `media-sync-rewrite.ts` chỉ đọc `resource = 'media'`; không có `JSON_EXTRACT` hay xuất `activity_logs`. Guard mới `activity-log-meta-shape` quét `server/` + `scripts/` (tệp có mã chạm `activityLogs`, cột `meta` duy nhất) chặn `meta: JSON.stringify(` và `const meta = JSON.stringify(`, kèm bằng chứng tiêm vào tệp thật; giới hạn nêu tên: biến tên khác / qua helper. Test ghim đã lật (kiểm cả chữ thô trong cột); đột biến ghi chuỗi lại ở 2 handler → đỏ |

Mỗi lỗi có một test tên `FINDING-R3-n`. Lúc viết, test khẳng định hành vi **hiện tại** kèm chú thích phải lật khẳng định nào khi sửa; lỗi đã sửa thì test được lật để khẳng định hành vi đúng (đảo lại ranh giới transaction / ghi chuỗi lại → đỏ). Sau đợt sửa (Node 24, image `cdkt-cov:node24`): mốc ratchet `server/api` 60,75 → 60,81, `server/services` 85,99 → 86,21; không thư mục nào giảm; `app/utils` và `shared` vẫn giữ mốc cũ (lần tăng không do đợt này).

Ghi nhận, không ghim: `deleteLocalFile` chỉ kiểm đường dẫn theo chữ, nên một thư mục symlink nằm **trong** `public/uploads` sẽ bị đi theo — chỉ người có quyền vào máy chủ mới tạo được (khôi phục backup từ chối mục link); tải lên hỏng ở bước ghi CSDL để lại tệp mồ côi trên đĩa/R2 (lượt quét ảnh mồ côi sau đó có thể nhập lại nó); tên tệp `Date.now()_tên` có thể trùng khi hai lượt tải cùng tên trong cùng một mili giây (tệp sau ghi đè tệp trước).

### Lát sau (theo thứ tự xếp hạng)

1. `server/api/admin/ai/test-call.post.ts` (270, 0 %) — tốn tiền thật + gọi ra ngoài; cần harness cho `checkBudget`/`logAiUsage`.
2. `server/api/admin/media/storage-size.get.ts` (88) — chỉ đọc, liệt kê bucket R2.
3. Cấu hình giá/nhà cung cấp AI kèm audit: `ai/services/[id].put.ts` (89), `ai/pricing/index.post.ts` (63), `[model].put.ts` (52), `bulk-delete.post.ts` (34), `[model].delete.ts` (32), `ai/providers/bulk-delete.post.ts` (53), `[id].delete.ts` (36).
4. Handler mỏng media-portal (`[id]/thumbnail.post.ts` 42, `thumbnail.delete.ts` 24, `upload/{init,chunk,complete,housekeep,status}`) — service đã phủ hoặc có suite integration.
5. Chỉ đọc, một truy vấn: `ai/usage.get.ts` (79), `backup/status.get.ts` (14), `backup/index.get.ts` (13), `users/index.get.ts` (24), `roles/index.get.ts` (15).
6. Ngoài sáu lớp của task: `server/services/readers.ts` (36 %, 550), `ip-bans.ts` (36,4 %, 118) — quyết định kiểm duyệt (lớp R5/R6 ở bảng trên).

Test văn bản mã nguồn mà các suite trên nay thay được (không xoá trong lát này): khối `upload.post.ts` của `cms-core-auth-media`, khối "kiểm hết trước khi ghi" của `retention-policy` (đột biến `rput-write-as-you-go` bị giết).

## Lát R4 của task 5.2 — đo lại 2026-10-28 (Node 24, `b315635`)

"R4" là **lát thứ tư** của task 5.2, không phải lớp rủi ro R4 ở bảng xếp hạng (dù lát này phần lớn nằm trong lớp đó: cổng AI).

**Đo ở đâu.** `npm run test:coverage` trong image `cdkt-cov:node24` (Node 24.21, `TZ=Asia/Ho_Chi_Minh`, lệnh của CI) trên `wave3/integration` = `b315635`, trước khi đụng gì: 767 tệp, 230 chưa nạp, **81,93 %** (70 203 / 85 682). Trên cây chưa đụng, ratchet đã báo RISE ở `app/utils` (+0,59), `server/utils` (+0,30) và `shared` (+3,58) — do các nhánh gộp trước.

### Cách chọn

Ba mục đầu của "Lát sau" ở lát R3 (test-call, storage-size, cấu hình giá/nhà cung cấp AI kèm audit), cộng các handler cùng nhóm vẫn 0 % mà suite đó dựng sẵn harness (`providers/index.get.ts`, `pricing/index.get.ts`, `services/index.get.ts`), rồi một cặp `settings/**`: `layout.{get,put}.ts` — handler mỏng trên `server/services/layout-settings.ts`, service chưa từng nạp. Bỏ: `ai/usage.get.ts` (truy vấn theo mốc tháng phụ thuộc `timezone: '+07:00'` của pool — cần suite riêng, xem "Lát sau"), `ai/budget/index.get.ts` (17 dòng, không quyết định riêng ngoài upsert).

### Đã làm trong lát này (15 tệp)

| # | Tệp | Trước | Sau | Vì sao ở đây | Suite |
|---|---|---|---|---|---|
| 1 | `server/api/admin/ai/test-call.post.ts` | 0 % (270) | 98,9 % (346/350) | Khoá API đã lưu + lượt gọi tốn tiền + gọi ra ngoài | `ai-test-call-behavior` |
| 2 | `server/api/admin/media/storage-size.get.ts` | 0 % (88) | 96,6 % (114/118) | Duyệt đĩa (symlink), liệt kê bucket R2 bằng bí mật đã lưu | `media-storage-size-behavior` |
| 3 | `server/api/admin/ai/services/[id].put.ts` | 0 % (89) | 98,3 % (117/119) | Prompt/model/nhà cung cấp mỗi dịch vụ, phản chiếu sang chatbot | `ai-service-config-behavior` |
| 4 | `server/api/admin/ai/services/index.get.ts` | 0 % (15) | 100 % | như trên | như trên |
| 5 | `server/api/admin/ai/pricing/index.post.ts` | 0 % (63) | 97,5 % (78/80) | Giá → chi phí mà `checkBudget` cộng | `ai-pricing-config-behavior` |
| 6 | `server/api/admin/ai/pricing/[model].put.ts` | 0 % (52) | 94,8 % (73/77) | như trên | như trên |
| 7 | `server/api/admin/ai/pricing/bulk-delete.post.ts` | 0 % (34) | 100 % | như trên | như trên |
| 8 | `server/api/admin/ai/pricing/[model].delete.ts` | 0 % (32) | 95,3 % (41/43) | như trên | như trên |
| 9 | `server/api/admin/ai/pricing/index.get.ts` | 0 % (30) | 100 % | như trên | như trên |
| 10 | `server/api/admin/ai/providers/bulk-delete.post.ts` | 0 % (53) | 100 % | Xoá nhà cung cấp (khoá mã hoá) + bảng giá của nó | `ai-provider-delete-behavior` |
| 11 | `server/api/admin/ai/providers/[id].delete.ts` | 0 % (36) | 100 % | như trên | như trên |
| 12 | `server/api/admin/ai/providers/index.get.ts` | 0 % (33) | 100 % | Danh sách không được lộ phong bì khoá | như trên |
| 13 | `server/api/admin/settings/layout.put.ts` | 0 % (11) | 100 % | Cấu hình bố cục mọi trang công khai đọc | `settings-layout-behavior` |
| 14 | `server/api/admin/settings/layout.get.ts` | 0 % (9) | 100 % | như trên | như trên |
| 15 | `server/services/layout-settings.ts` | 0 % (93) | 100 % | như trên | như trên |
| 16 | `server/api/admin/ai/moderation/settings.get.ts` | 0 % (42) | 100 % | Trang cán bộ đọc để biết bình luận/chat được kiểm duyệt theo prompt nào (vòng 2, FINDING-R4-9) | `ai-moderation-settings-read-behavior` |

Vòng 2 (sau kiểm chứng độc lập) còn thêm `ai-gateway-default-prompt-behavior` cho `callAi` (tệp đã phủ sẵn 100 %; suite ghim prompt hệ thống thật gửi đi), và đưa test-call lên 99,0 % (377/381).

Cộng một tệp mới: `server/utils/ai/pricing-cost.ts` (100 % — giới hạn giá dùng chung, xem FINDING-R4-6). Số trong ngoặc ở cột "Trước" là dòng có mã của tệp chưa nạp; cột "Sau" đếm mọi dòng vật lý của tệp đã nạp, đo sau đợt sửa. Dòng còn trống ở các tệp dưới 100 % (đọc từ lcov): nhánh 400 "thân không phải object" (`readBody(...).catch(() => ({}))` chỉ trả non-object khi thân là một JSON vô hướng), 400 "Model không hợp lệ" (tham số tuyến rỗng — router không bao giờ khớp), `Base URL không hợp lệ` của test-call, và hai `catch` của storage-size: tệp bị xoá giữa lượt quét, và `catch` ngoài quanh `diskUsage` (hàm tự nuốt lỗi bên trong, không bao giờ ném).

**Sau lát** (`npm run test:coverage`, Node 24, cây cuối của nhánh lát, log `coverage-after.log`): 768 tệp (thêm `pricing-cost.ts`), 215 chưa nạp, **83,10 %** (71 482 / 86 017). Theo thư mục: `server/api` 61,91 → 66,76, `server/services` 86,67 → 86,99, `server/utils` 94,23 → 94,56; các thư mục khác không đổi. Mức nền ratchet nâng đúng ba thư mục lát này đụng, bằng số đo làm tròn xuống: `server/api` 61,9 → 66,76, `server/services` 86,67 → 86,98, `server/utils` 93,93 → 94,56 (gồm cả +0,30 có sẵn trên cây — cùng cách lát R3 làm với `server/services`); `app/utils` và `shared` giữ 95,13 / 95,9 vì lát này không đụng tới. Toàn bộ unit + ratchet (lệnh của CI, Node 26 cục bộ): 6 564 test, 0 đỏ, 54 bỏ qua (suite integration không có MySQL).

**Sau vòng 2** (sửa theo kiểm chứng độc lập, log `coverage-round2.log`): 768 tệp, 214 chưa nạp, **83,16 %** (71 587 / 86 080); `server/api` 66,76 → 67,07 (mốc ratchet 66,76 → 67,06), `server/services` 86,99 và `server/utils` 94,57 — làm tròn xuống vẫn bằng mốc 86,98 / 94,56, không nâng. Toàn bộ unit + ratchet: 6 577 test, 0 đỏ, 54 bỏ qua.

### Cách chạy và cái bẫy đã gặp

- Cùng kiểu R1–R3: app h3 thật + middleware `admin-auth` thật (`_h3-handler-server.ts`), SQL MySQL của Drizzle trên SQLite (`_sqlite-mysql-db.ts`), tệp và symlink thật dưới thư mục làm việc tạm, phong bì AES-GCM thật (khoá AI, bí mật R2). test-call chạy `checkBudget`/`logAiUsage`/`calculateAiCost` thật và `safeProviderRequest` thật, chỉ thay DNS và socket HTTPS như suite probe của R3. Biên giả còn lại: SDK S3.
- **`checkBudget` với ngân sách 0 gọi mạng.** Hạn mức tháng 0 = "không giới hạn" → nó hỏi Delify hạn mức của khoá (`loadDelifyQuota`), qua đúng `safeProviderRequest` đã thay — một yêu cầu thừa (khoá trong query) lọt vào danh sách đã gửi, và kết quả được nhớ 60 s ở cấp module, dò sang test sau. Suite đặt sẵn hạn mức > 0; "hết ngân sách" dựng bằng hàng `ai_usage_logs` có chi phí ≥ hạn mức.
- **Logger giả phải GHI LẠI** (suite R3 dùng no-op, nên "khoá không vào log" chưa từng được kiểm). Mỗi lời gọi được `util.inspect` (`JSON.stringify(new Error())` ra `{}`), và mọi khẳng định "không lộ khoá" quét phản hồi + mọi hàng `ai_usage_logs` + mọi dòng log theo **mọi cửa sổ 8 ký tự** của khoá — lộ một phần (SyntaxError của V8 trích 10 ký tự đầu thân) cũng đỏ.
- **Hạn giờ không chờ 20 s.** Socket giả phát `'timeout'`; `executeRequest` thật đổi nó thành `UPSTREAM_TIMEOUT`. Bộ hẹn giờ của chính nó có suite riêng (`outbound-deadline`); suite này kiểm handler xin đúng `timeoutMs: 20000`, `maxResponseBytes: 131072`.
- **Lỗi bơm vào mà thoát khỏi handler** được harness trả `{ injected: true }` (500) — với các ca đó chỉ khẳng định mã; khẳng định "không lộ nội dung" chỉ có nghĩa ở nơi handler tự bắt lỗi và trả về.
- **SQLite không kiểm độ dài VARCHAR, khoảng DECIMAL, NOT NULL, hay collation không phân biệt hoa thường của khoá chính MySQL.** Hai FINDING dựa trên giới hạn cột (R4-3, R4-6) có bằng chứng MySQL riêng: trên container dev (MySQL 8.0.46, `sql_mode` = `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,…`, mặc định của image — `docker-compose.yml` không đổi) một CSDL nháp cho `ERROR 1406 Data too long for column 'service_key'` với 65 ký tự và `ERROR 1264 Out of range value` với `10000` vào DECIMAL(8,4) (log `mysql-strict-evidence.log` ở thư mục bằng chứng). Test ghim mã 400 handler nay trả **trước** CSDL.
- **Tên model có `/`.** `fetch` gửi `org%2Fflash` nguyên văn; h3 giải mã đường dẫn trước khi định tuyến nhưng giữ `%2F` (và xử lý `%25` để giải mã tham số một lần là đúng) — nên phép thử qua app h3 thật là đủ, không cần `node:http` như ca `..` của R3.
- **Thư mục không đọc được** (`chmod 000`) dọn bằng `t.after` đặt lại quyền — không thì `beforeEach` sau không xoá được cây. Chạy bằng root thì 000 vẫn đọc được: test đổi kỳ vọng theo `process.getuid()`.

### Đột biến (mỗi cái đúng một test đỏ; kịch bản `mutants.sh` + `mutants.list` và log ở thư mục bằng chứng)

| Suite | Đột biến | Đỏ | Test đỏ (đúng 1 mỗi đột biến) |
|---|---|---|---|
| `ai-test-call-behavior` | 10 | 10 | bỏ che khoá → R4-1; che **sau** khi cắt 300 ký tự → R4-1; câu trả lời `null` coi là thành công → R4-2; nuốt lỗi tra giá (tính 0 đồng) → R4-2; chỉ kiểm độ dài nhãn dịch vụ, nhận nhãn tự đặt → R4-3; bỏ giới hạn độ dài model → R4-3; bỏ chặn ngân sách → "past the monthly budget"; hạn giờ 120 s → "20 s deadline"; khoá Anthropic thành Bearer → "Anthropic"; bỏ trừ 2000 token Delify → "token accounting" |
| `ai-pricing-config-behavior` | 5 | 5 | PUT đọc tham số thô → R4-4; DELETE đọc tham số thô → R4-4; bulk trả số tên gửi lên → R4-5; bỏ trần 9 999,9999 → R4-6; `label: null` bị bỏ qua → R4-7 |
| `ai-provider-delete-behavior` | 3 | 3 | audit đếm id gửi lên → R4-5; bỏ chặn nhà cung cấp đang dùng → "delete one … 409"; `activeModels` = tổng → "the list" |
| `ai-service-config-behavior` | 2 | 2 | `systemPrompt: null` bị bỏ qua → R4-8; đảo bật/tắt → `mode` → "mirrored into chatbot_settings" |
| `media-storage-size-behavior` | 2 | 2 | theo symlink tới tệp → "symbolic link … not followed"; bí mật R2 không giải mã được vẫn tính là đã cấu hình → "R2 counts as not configured" |
| `settings-layout-behavior` | 2 | 2 | audit thiếu `after` → "a valid save"; bỏ trần 1920 px → "every field is checked" |
| **Tổng** | **24** | **24** | không đột biến nào sống sót; cây sản phẩm được kiểm khôi phục từng byte sau mỗi lượt |

Vòng 2 (`mutants-round2.list`, chạy trên cây đã commit; hai đột biến "bỏ che khoá"/"che sau khi cắt" của vòng 1 viết lại cho `withoutSecret` mới):

| Suite | Đột biến | Đỏ | Test đỏ |
|---|---|---|---|
| `ai-gateway-default-prompt-behavior` | 2 | 2 | `callAi` bỏ lùi về mặc định → **2** test R4-9 (null; rỗng/khoảng trắng — cùng bất biến); `AI_SERVICE_DEFAULT_PROMPTS[serviceKey]` không qua `Object.hasOwn` → R4-9 "effectiveSystemPrompt" |
| `ai-moderation-settings-read-behavior` | 2 | 2 | bỏ `trim()` (khoảng trắng thành prompt) → R4-9; trang lại hiện `config?.systemPrompt ?? mặc định` → R4-9 |
| `ai-test-call-behavior` | 7 | 7 | bỏ dạng `\uXXXX` → R4-1 (thoát JSON); bỏ dạng `\"`/`\\`/`\/` → R4-1 (thoát JSON); hex chỉ chữ thường → R4-1 (thoát JSON); bỏ che `reply` sau khi parse → **2** test R4-1 (hai test cùng ghim khoá lặp lại trong câu trả lời); che sau khi cắt → R4-1; bỏ trần message → R4-10; bỏ trần prompt → R4-10 |
| `ai-pricing-config-behavior` | 1 | 1 | cắt tên ở 64 lại → R4-11 |
| **Tổng vòng 2** | **12** | **12** | 10 đúng một test đỏ, 2 làm đỏ hai test cùng ghim một bất biến |

### Lỗi tìm thấy (ghim lúc viết test, sửa sau đó)

Chín test `FINDING-R4-n` đỏ trên `b315635` và **chỉ** chúng — 46 test còn lại của sáu suite xanh trên mã base (kịch bản `findings-on-base.sh` đặt tạm 7 tệp sản phẩm về `b315635`, chạy, khôi phục và so từng byte; log `findings-on-base.log`). Vòng 2 (kiểm chứng độc lập chỉ ra R4-9, nửa sau của R4-1, R4-10, R4-11): bảy test FINDING mới đỏ trên `2c73283` và chỉ chúng — 33 test còn lại của bốn suite liên quan xanh (`findings-on-rev.sh 2c73283 …`, log `findings-round2-on-2c73283.log`).

| Mã | Mức | Tệp | Lỗi | Trạng thái |
|---|---|---|---|---|
| FINDING-R4-1 | trung bình | `ai/test-call.post.ts` | Thân lỗi của nhà cung cấp (300 ký tự đầu) trả nguyên văn **và** lưu vào `ai_usage_logs.error_message` (tab Nhật ký AI, mọi người có `ai.read`). Nhà cung cấp/proxy nhắc lại khoá bị từ chối ("Incorrect API key provided: sk-…") → khoá đã lưu lộ ra, điều `ai.read` không bao giờ được thấy. Thân 2xx không phải JSON lộ một đoạn qua `SyntaxError` của V8. Probe kết nối (`providers/[id]/test.post.ts`) đã không chuyển tiếp thân vì đúng lý do này. | **Đã sửa** (hai vòng): một mẫu khớp khoá với mỗi ký tự viết thường **hoặc** thoát JSON (`\uXXXX` hoa/thường, `\"`, `\\`, `\/`, trộn tuỳ ý) — áp lên thân thô **trước** khi cắt 300 ký tự (đường lỗi), và áp lại lên câu trả lời **sau** khi giải mã JSON; thân không phải object JSON → câu viết sẵn. Vòng 1 chỉ che ba cách viết trong thân thô trước `JSON.parse`, nên khoá viết bằng `\uXXXX` được giải mã nguyên vẹn vào `reply`, còn thân kiểu PHP (`\"` cùng `\/`) hay trộn lọt vào chữ lỗi — kiểm chứng độc lập bắt được, test ghim bằng khoá chứa `"`, `\`, `/`. Lời nhắn của nhà cung cấp vẫn còn (chỉ khoá thành `[đã ẩn khoá API]`). Không khẳng định gì với bản sao đã mã hoá lại hay che một phần |
| FINDING-R4-2 | thấp | `ai/test-call.post.ts` | Tra giá chạy **sau** lượt gọi đã trả tiền, trong `try` đổi mọi lỗi thành "Thất bại khi gọi API: <message>": lỗi CSDL gửi chữ "Failed query: select … from ai_model_pricing …" cho trình duyệt, và lượt gọi thành công bị ghi là thất bại, 0 đồng — khoản chi `checkBudget` không thấy. Câu trả lời `null` thành chữ lỗi JavaScript. | **Đã sửa**: mọi lần đọc CSDL (dịch vụ, ngân sách, nhà cung cấp, giá) trước lượt gọi; sau lượt gọi chỉ còn `logAiUsage` (không ném). Chỉ `ChatbotOutboundError` mang câu của nó; JSON không phải object là lỗi viết sẵn |
| FINDING-R4-3 | trung bình | `ai/test-call.post.ts` | `serviceKey` và `model` lấy nguyên văn, dài bao nhiêu cũng được, trong khi `ai_usage_logs.service_key`/`model` là VARCHAR(64). MySQL strict từ chối hàng, `logAiUsage` nuốt lỗi (cố ý) — lượt gọi đã gửi và đã trả tiền không vào bảng `checkBudget` cộng: ai có `ai.read` chi không giới hạn. Nhãn dịch vụ cũng là thứ trình duyệt tự đặt. | **Đã sửa**: model > 64 ký tự → 400; `serviceKey` chỉ là `test_call` hoặc khoá của một dịch vụ đã cấu hình (ghi theo cách viết đã lưu), còn lại 400 — đều trước lượt gọi |
| FINDING-R4-4 | trung bình | `ai/pricing/[model].put.ts`, `[model].delete.ts` | Đọc tham số tuyến thô. h3 giữ `%2F` để không tách đoạn; trang quản trị gửi `encodeURIComponent(model)` (`admin-fetch-rollout` ghim `PUT …/pricing/org%2Fflash`) → model dạng `vendor/model` (kiểu tên của router) hoặc có `%` tạo được, liệt kê được, nhưng không sửa/tắt/xoá từng cái được (404) | **Đã sửa**: `getRouterParam(event, 'model', { decode: true })`. nginx không giải mã trước: mọi `proxy_pass` trong `CI-CD.md` / `production/README.md` là `http://127.0.0.1:54432` không có phần URI, nên URI gốc (`%2F` nguyên vẹn) tới Nitro. Các tham số chuỗi khác dưới `server/api` (slug, mã ngôn ngữ, tên tệp backup, shortId) không chứa `/` hay `%` theo khuôn của chúng |
| FINDING-R4-5 | thấp | `ai/pricing/bulk-delete.post.ts`, `ai/providers/bulk-delete.post.ts` | Bulk xoá giá trả `deleted` = số tên gửi lên và audit tên gửi lên (trùng, tên không có cũng tính); bulk xoá nhà cung cấp audit `count` = số id gửi lên. CLAUDE.md: con số báo cho người dùng phải đo, không khẳng định | **Đã sửa**: bỏ trùng; bảng giá đọc hàng có thật trong transaction (`FOR UPDATE`), xoá + đếm + audit đúng chúng (không khớp gì → `deleted: 0`, không audit); nhà cung cấp xoá + đếm theo hàng tìm thấy |
| FINDING-R4-6 | thấp | `ai/pricing/index.post.ts`, `[model].put.ts` | Cột giá DECIMAL(8,4); giá > 9 999,9999 qua kiểm tra (hữu hạn, không âm) rồi MySQL strict từ chối → 500 thay vì một câu cho cán bộ | **Đã sửa**: helper `server/utils/ai/pricing-cost.ts` (một giới hạn cho cả hai); POST và PUT trả 400 trước CSDL. PUT vẫn bỏ qua rác (âm, chuỗi) như trước — quy ước "bỏ qua, không ép" của R3 |
| FINDING-R4-7 | thấp | `ai/pricing/[model].put.ts` | Form sửa gửi `label: null` khi xoá ô nhãn (`AiProvidersTab.vue` `saveEditModel`); handler chỉ nhận chuỗi → nhãn giữ nguyên trong khi trang báo đã lưu | **Đã sửa**: `null` xoá nhãn |
| FINDING-R4-8 | thấp | `ai/services/[id].put.ts` | Form dịch vụ gửi `systemPrompt: … \|\| null`, `model: … \|\| null` cho ô trống (`AiServicesTab.vue`); handler chỉ nhận chuỗi — dù `'' → null` của chính nó cho thấy ý định xoá — nên xoá ô không đổi gì, kể cả bản phản chiếu chatbot, trong khi trang báo "Đã lưu cấu hình dịch vụ." | **Đã sửa**: `null` xoá, cả hai bên phản chiếu — tức đường giao diện nay làm đúng điều `systemPrompt: ''` vẫn làm qua API. Hệ quả khi chạy: xoá ô prompt = dịch vụ chạy bằng **prompt mặc định** của nó (FINDING-R4-9, vòng 2 — trước đó là gọi không prompt hệ thống); chatbot không đổi (tự truyền prompt có căn cứ, lùi về `DEFAULT_CHATBOT_SYSTEM_PROMPT`). Xoá ô model → dịch vụ thành `service_inactive` |
| FINDING-R4-9 | trung bình (an toàn nội dung) | `services/ai-gateway-call.ts` (+ `ai-gateway-config.ts`, `utils/ai/prompt-defaults.ts`, `ai/moderation/settings.get.ts`) | `callAi` dùng `input.systemPrompt ?? config.systemPrompt ?? ''`: prompt đã lưu null/rỗng/khoảng trắng = gọi model **không có** prompt hệ thống, trái lời hứa của `prompt-defaults.ts` ("falls back to it when a service is enabled without a stored prompt"). Với kiểm duyệt là mất mọi luật của prompt mặc định — kể cả luật chủ quyền ("tôn vinh, bênh vực Trung Quốc … = VI PHẠM"), điều bộ luật từ khoá seed không có — trong khi trang `/admin/ai/moderation` hiện prompt mặc định khi null nên cán bộ tưởng nó vẫn chạy. R4-8 làm trạng thái này với tới được từ giao diện. Kiểm chứng độc lập bắt được | **Đã sửa**: `effectiveSystemPrompt(serviceKey, stored)` — prompt đã lưu nếu có chữ (sau `trim`), không thì `AI_SERVICE_DEFAULT_PROMPTS[serviceKey]` (`Object.hasOwn`); dịch vụ không có mặc định giữ hành vi cũ; người gọi tự truyền prompt (chatbot) không đổi. `callAi` dùng nó qua dòng import sẵn có (tệp bị chặn trần: 608 dòng, không đổi); trang cài đặt kiểm duyệt hiện đúng giá trị đó. Hai luồng kiểm duyệt (`moderation-worker-check.ts`, `comments/ai-moderate.post.ts`) gọi `callAi('moderation', …)` không truyền prompt → nhận bản sửa, không phải đổi |
| FINDING-R4-10 | thấp | `ai/test-call.post.ts` | `message` và `systemPrompt` không giới hạn độ dài: 2 MB vẫn được gửi và tính tiền. Kiểm chứng độc lập bắt được | **Đã sửa**: trần bằng hai trần sẵn có của chatbot — 10 000 ký tự (`CHAT_LIMITS.maxMessageChars`) và 20 000 (`validateChatbotSettingsUpdate`), sau `trim`, 400 trước lượt gọi |
| FINDING-R4-11 | thấp | `ai/pricing/bulk-delete.post.ts` | Cắt mọi tên ở 64 ký tự: tên dài hơn (không hàng nào giữ được, cột VARCHAR(64)) bị cắt thành tên của model khác đúng bằng 64 ký tự đầu, và model đó bị xoá. Kiểm chứng độc lập bắt được | **Đã sửa**: tên > 64 ký tự → 400, không xoá gì (kể cả tên hợp lệ đi kèm) |

Ghi nhận, không ghim (không sửa ở lát này):
- `test-call` chi tiền thật mà chỉ đòi `ai.read` — cùng mức với probe kết nối (R3 ghim `ai.read`); ngân sách vẫn chặn. `services/[id].put.ts` đổi nhà cung cấp/prompt/model của dịch vụ chatbot chỉ với `ai.update`, không cần `chatbot_settings.update`, và **không** qua `validateChatbotSettingsUpdate` (prompt ≤ 20 000 ký tự, model `[A-Za-z0-9._:-]`) — đích gọi (baseUrl/allowedHosts, thứ mang khoá chatbot do siêu quản trị giữ) không đổi qua đường này. Hai điều là quyết định thiết kế cần chốt, không phải lỗi đã chứng minh.
- Phản chiếu hai chiều lệch: dịch vụ → chatbot ánh xạ nhà cung cấp khác `anthropic` thành `openai-compatible`, chatbot → dịch vụ ánh xạ mọi policy khác `anthropic` thành `delify`.
- `providers/[id].delete.ts` giữ hàng giá của nhà cung cấp, `bulk-delete` xoá chúng (ghim cả hai như đang chạy). Kiểm "đang được dịch vụ dùng" của cả hai nằm ngoài transaction.
- `storage-size`: thư mục gốc `public/uploads` không đọc được (sai chủ sở hữu — sự cố đã gặp) trả `0 B, 0 tệp` như cây rỗng; lỗi R2 thành `null` nhưng không ghi log. Sửa đúng cần trang `/admin/media` phân biệt "lỗi" với "0" (ngoài phạm vi `app/**` của lát này).
- `layout-settings.ts` `getLayoutConfig` nuốt cả lỗi CSDL → trả mặc định; trang `general.vue` cũng nuốt lỗi tải và giữ mặc định — một lần tải hỏng rồi bấm Lưu sẽ ghi đè cấu hình thật bằng mặc định. Gốc nằm ở cả trang lẫn service.
- Tạo giá trùng (`pricing/index.post.ts`) kiểm tồn tại ngoài transaction: hai lượt cùng lúc → lỗi khoá chính MySQL → 500; tạo giá với tên > 64 ký tự âm thầm cắt tên (cùng họ R4-11 nhưng không xoá nhầm gì). `delify/sync.post.ts` ghi giá Delify vào cùng cột DECIMAL(8,4) mà không kiểm trần.
- test-call không chặn model chưa có giá (lượt gọi ghi 0 đồng, ngân sách không thấy khoản chi) — quyết định của người dùng, không đổi ở lát này.
- `comments/ai-moderate.post.ts` dán nguyên văn bình luận và tên người gửi vào prompt (`Nội dung: "${item.content}"`) và vào biến `{{content}}`/`{{author}}` không qua `fenceUntrustedContent` — trái quy tắc của CLAUDE.md mà luồng worker đã theo. Ngoài phạm vi lát này.

### Lát sau (theo thứ tự xếp hạng)

**Trước hết — cùng họ với R4-2/R4-3 trên đường AI thật** (ngoài phạm vi lát này — `ai-gateway-call.ts` là tệp bị chặn trần độ dài, đường chat thuộc agent khác): `callAi` tra giá (`loadPricing`) **sau** lượt gọi đã trả tiền, nên lỗi CSDL ở đó ném ra khỏi `callAi` và lượt gọi không vào `ai_usage_logs`; và theo grep, `logAiUsage` chỉ được gọi ở cổng AI và test-call — đường gọi trực tiếp cũ của chatbot (khi cổng chưa cấu hình, khoá do siêu quản trị giữ) không ghi khoản chi nào cho `checkBudget` cộng. Model của đường cổng lấy từ `ai_service_configs.model` (VARCHAR(64), cắt lúc ghi) nên không mắc lỗi độ dài của R4-3. Lỗi upstream ở cổng chỉ ghi `HTTP <mã>`, không chuyển thân (không mắc R4-1).

1. `server/api/admin/ai/delify/sync.post.ts` (191) + `delify/status.get.ts` (154) — gọi Delify bằng khoá đã lưu, ghi bảng giá + lịch sử gọi; dùng lại harness mạng của `ai-test-call-behavior`.
2. `server/api/admin/ai/usage.get.ts` (79) + `budget/index.get.ts` (17) — mốc "đầu tháng" so với `created_at` qua pool `timezone: '+07:00'` (cùng câu hỏi với `checkBudget.loadMonthlySpend`): cần suite trên MySQL thật hoặc kiểm SQL đã biên dịch như lát R3 làm với `NOW() - INTERVAL`.
3. `server/api/admin/ai/translate.post.ts` (116), `translate-ui.post.ts` (72), `editorial.post.ts` — dịch/biên tập AI qua hạn mức; rào nội dung không tin cậy.
4. `server/services/universal-translation.ts` (452, 0 %) — job dịch toàn hệ thống.
5. Hai việc giao diện ở "Ghi nhận" trên (`/admin/media` phân biệt lỗi đĩa/R2; trang cấu hình chung không lưu đè sau lần tải hỏng) — cần lát được đụng `app/**`.

## Lát R5 của task 5.2 — đo lại 2026-10-28 (Node 24, `0778e988`)

"R5" là **lát thứ năm** của task 5.2, không phải lớp rủi ro R5 ở bảng xếp hạng. Lát mở đầu bằng một sửa an ninh (phần A: rào nội dung người dùng trong prompt kiểm duyệt bình luận), rồi đi theo mục 1–3 của "Lát sau" ở lát R4, cộng bốn route đọc `settings/**` còn 0 %.

**Đo ở đâu.** `npm run test:coverage` trong image `cdkt-cov:node24` (Node 24.21, `TZ=Asia/Ho_Chi_Minh`, lệnh của CI) trên `wave3/integration` = `0778e988`, trước khi đụng gì: 776 tệp, 212 chưa nạp, **83,43 %** (72 822 / 87 282). Trên cây chưa đụng, ratchet đã báo RISE ở `app/utils` (+0,39) và `shared` (+3,58) — do các nhánh gộp trước.

### Đã làm trong lát này

| # | Tệp | Trước | Sau | Vì sao ở đây | Suite |
|---|---|---|---|---|---|
| 1 | `server/api/admin/comments/ai-moderate.post.ts` | 0 % (138) | 92,1 % (163/177) | Bình luận + tên người đọc (dữ liệu công khai) vào prompt kiểm duyệt — phần A | `comments-ai-moderate-behavior` |
| 2 | `server/api/admin/ai/usage.get.ts` | 0 % (79) | 100 % | "Tháng này" / "ngày" của chi phí AI — câu hỏi múi giờ | `ai-usage-month-behavior` |
| 3 | `server/api/admin/ai/budget/index.get.ts` | 0 % (17) | 100 % | GET có ghi (tạo hàng mặc định) | như trên |
| 4 | `server/utils/ai-budget.ts` | 96,4 % | 96,4 % | `checkBudget` dùng cùng mốc đầu tháng — nay có test hành vi cho mốc đó | như trên |
| 5 | `server/api/admin/ai/delify/sync.post.ts` | 91,4 % (203/222) | 99,3 % (292/294) | Ghi bảng giá + lịch sử gọi (chi phí `checkBudget` cộng) từ dữ liệu của router | `ai-delify-sync-behavior` |
| 6 | `server/api/admin/ai/delify/status.get.ts` | 95,8 % (181/189) | 100 % | Chuyển dữ liệu router cho mọi người có `ai.read` | như trên |
| 7 | `server/api/admin/ai/translate.post.ts` | 0 % (116) | 98,6 % (141/143) | Dịch AI; HTML do model viết | `ai-translate-editorial-behavior` |
| 8 | `server/api/admin/ai/translate-ui.post.ts` | 0 % (72) | 97,6 % (80/82) | như trên | như trên |
| 9 | `server/api/admin/ai/editorial.post.ts` | 73,3 % (159/217) | 93,2 % (204/219) | Trợ lý biên tập (`ArticleAIPanel.vue`) | như trên |
| 10 | `server/api/admin/settings/navigation.get.ts`, `navigation/navbar.get.ts`, `navigation/mobile.get.ts` | 0 % (16 + 17 + 16) | 100 % | Route `settings/**` còn 0 % | `settings-navigation-sitemap-read-behavior` |
| 11 | `server/api/admin/settings/sitemap/generate.post.ts` (+ `server/utils/sitemap-builder.ts`) | 0 % (10); builder 50,0 % (92/184) | 100 %; builder 99,5 % (185/186) | Sitemap công khai sinh từ CSDL | như trên |

Hai tệp mới: `server/utils/ai/target-language.ts` (100 % — bảng tên ngôn ngữ + kiểm mã, dùng chung cho hai route dịch, xem FINDING-R5-13) và `tests/_ai-route-harness.ts` (harness dùng chung của năm suite: app h3 + `admin-auth`, SQL trên SQLite, phong bì khoá AES-GCM thật, `checkBudget`/`callAi`/`logAiUsage` thật, `safeProviderRequest` thật chỉ thay DNS + socket HTTPS, logger ghi lại từng dòng). `vn-day-range.ts` thêm `vietnamDayStartOf` / `vietnamMonthStart` (vẫn 100 %). Cột "Sau" đếm mọi dòng vật lý của tệp đã nạp (xem "Cách đọc cho đúng").

**Sau lát** (`npm run test:coverage`, Node 24, cây cuối của nhánh lát, log `coverage-after.log`): 777 tệp, 203 chưa nạp, **84,19 %** (73 683 / 87 521). Theo thư mục: `server/api` 67,20 → 70,31, `server/utils` 94,57 → 95,14; các thư mục khác không đổi. Mức nền ratchet nâng đúng hai thư mục lát này đụng, bằng số đo làm tròn xuống: `server/api` 67,2 → 70,3, `server/utils` 94,56 → 95,13; `app/utils` và `shared` giữ 96,01 / 95,9 vì lát này không đụng tới. `server/services` không đổi (86,99 — lát này không sửa service nào). Toàn bộ unit + ratchet (lệnh của CI, Node 26 cục bộ, `TZ=Asia/Ho_Chi_Minh`, log `unit-full.log`): 6 852 test, 0 đỏ, 54 bỏ qua (suite integration không có MySQL).

**Sau vòng 2** (hai sửa Delify sau kiểm chứng của chính lát, log `coverage-round2.log`): 777 tệp, 203 chưa nạp, **84,19 %** (73 693 / 87 531); `server/api` 70,31 → 70,32 (mốc ratchet 70,3 → 70,32), `server/utils` giữ 95,14 (mốc 95,13); cùng lượt chạy là toàn bộ bộ unit + ratchet trên Node 24, xanh. Lệnh của CI trên Node 26 cục bộ (log `unit-full-round2.log`): 6 854 test, 0 đỏ, 54 bỏ qua.

**Sau vòng 3** (sửa theo kiểm chứng độc lập, log `coverage-round3.log`): 777 tệp, 203 chưa nạp, **84,20 %** (73 726 / 87 564); `server/api` 70,32 → 70,38 (mốc ratchet 70,32 → 70,37), `server/utils` giữ 95,14 (mốc 95,13). Lệnh của CI trên Node 26 cục bộ (log `unit-full-round3.log`): 6 861 test, 0 đỏ, 54 bỏ qua.

### Quyết định múi giờ (`usage.get.ts`, `checkBudget`)

Câu hỏi của lát R4: pool khai `timezone: '+07:00'` trong khi quy ước nói phiên MySQL chạy UTC. Kiểm, không giả định:
- Drizzle gửi một `Date` so với cột TIMESTAMP thành chuỗi **UTC** (`mapToDriverValue` = `toISOString()`; `toSQL()` cho `'2026-09-30 17:00:00.000'` với 00:00 ngày 1/10 giờ VN), và đọc ngày thành **chuỗi** (session mysql2 của Drizzle đặt `typeCast` → `field.string()`). `timezone` của pool không tham gia các truy vấn này — nó chỉ chạm `pool.query` trần (lý do của `utc-query.ts`).
- MySQL đọc chuỗi đó, và tính `DATE()`, theo `time_zone` của **phiên**: `SYSTEM` = UTC trên container dev (MySQL 8.0.46, `@@system_time_zone = UTC`, log `mysql-tz-evidence.log`) — đúng chú thích của `docker-compose.yml` và `vn-day-range.ts`. **Giữ nguyên quy ước** (không đặt `time_zone` cho phiên).
- Lỗi thật nằm ở hai chỗ khác (FINDING-R5-3, R5-4): mốc đầu tháng tính theo TZ của **tiến trình**, và nhóm theo ngày bằng `DATE(created_at)` = ngày UTC. Sửa: `vietnamMonthStart(at)` / `vietnamDayStartOf(at)` (độ lệch cố định, như `vietnamDayStart`), `DATE(CONVERT_TZ(created_at, '+00:00', '+07:00'))` (hai độ lệch số, không cần bảng múi giờ; dựa trên cùng quy ước phiên UTC).
- Cách kiểm: SQLite chạy `DATE()` như MySQL phiên UTC; `CONVERT_TZ` được mô phỏng đúng **một** dạng (`'+00:00'` → `'+07:00'`, dạng khác ném lỗi) — không xấp xỉ gì khác. Câu đã biên dịch phát lại trên MySQL 8.0.46 (có `ONLY_FULL_GROUP_BY`) cho đúng các số của test, trước và sau sửa (`mysql-usage-daily-replay.log`). Đồng hồ ghim bằng `mock.timers` (chỉ `Date`); TZ tiến trình đổi qua `process.env.TZ` theo từng ca — biến thể `Asia/Ho_Chi_Minh` xanh cả trên base (đúng: chỉ tiến trình chạy TZ khác mới hỏng), biến thể `UTC` là test FINDING.

### Cách chạy và cái bẫy đã gặp

- `mock.timers.enable` hai lần trong một test ném `ERR_INVALID_STATE` — `at()` của suite gọi `reset()` trước mỗi lần bật.
- Bộ cấu hình dịch vụ của cổng AI nhớ 60 s theo khoá dịch vụ (cấp module, không có hàm xoá): suite kiểm duyệt giữ **một** system prompt (có `{{content}}`/`{{author}}`) cho cả suite, vì đổi giữa các test sẽ đọc bản cũ.
- Cột DECIMAL trên SQLite mang ái lực số: `'0.001000'` đọc ra `0.001` — so chi phí bằng `Number(...)`.
- `{ __proto__: 'x' }` trong một object literal không tạo khoá `__proto__` (nó đặt prototype, và bỏ qua chuỗi): câu trả lời giả của model viết bằng chuỗi JSON thô.
- TIMESTAMP(0) của MySQL **làm tròn** phần lẻ giây; SQLite giữ nguyên chuỗi, nên một test "đồng bộ lại không nhân đôi" xanh trên base dưới SQLite. Test FINDING-R5-8 ghim giá trị được ghi (giây tròn như MySQL giữ), còn hậu quả trên MySQL nằm ở `mysql-tz-evidence.log` (0 hàng khớp `= '…00.567'`, 1 hàng khớp `= '…01'`).
- `findings-on-rev.sh` lấy danh sách tệp bằng `git diff`: tệp sản phẩm mới phải `git add -N` trước, không thì nó không bị gỡ khi chạy "trên base".

### Đột biến (mỗi cái một test đỏ; kịch bản `mutants.sh` + `mutants-*.list` và log ở thư mục bằng chứng)

| Suite | Đột biến | Đỏ | Test đỏ |
|---|---|---|---|
| `comments-ai-moderate-behavior` | 6 | 6 | nội dung không bọc → R5-1 "body"; tên không bọc → R5-1 "display name"; biến `content` thô → R5-1 "{{content}}"; biến `author` thô → R5-1 "{{content}}"; nonce cố định → R5-1 "body"; bỏ trần độ dài → R5-2 |
| `ai-usage-month-behavior` | 6 | 6 | `usage.get` đầu tháng theo TZ tiến trình → R5-3 dashboard UTC; `checkBudget` cũng vậy → R5-3 checkBudget UTC; `DATE(created_at)` → R5-4 "Vietnam calendar day"; cửa sổ `now − 30 ngày` → R5-4 "window"; cửa sổ 31 ngày → R5-4 "window"; bỏ tạo hàng mặc định → "before the seed has run" |
| `ai-delify-sync-behavior` | 8 + 4 | 8 + 4 | bỏ kiểm độ dài tên → R5-6; bỏ kiểm khoảng giá → R5-5; giữ mili giây → R5-8 "whole second"; cắt thay vì làm tròn → R5-8 "whole second"; nhận chi phí âm → R5-7; `history` thô → R5-9 "only the fields"; bỏ giới hạn 10 mục → "key card"; `summary` thô → R5-9 "only the fields". Vòng 2 (`mutants-round2.list`): dedupe so cả hàng cổng AI ghi → R5-8 "recognised"; dedupe bỏ số token → R5-8 "recognised"; `allowedModels` của thẻ khoá thô → R5-9 "plain values"; `allowedModels` của câu trả lời đồng bộ thô → R5-9 "plain values" |
| `ai-translate-editorial-behavior` | 10 | 10 | escape HTML lại → R5-10 "article"; nonce cố định → R5-10 "article"; bỏ sanitize → R5-11; câu không phải JSON thành nội dung → R5-12; helper ngôn ngữ nhận chữ bất kỳ → **2** test R5-13 (translate + translate-ui, cùng một helper); trả khoá không được hỏi → R5-14; trả giá trị không phải chuỗi → R5-14; quá 100 nhãn → "at most 100"; bỏ giải mã entity → "reads the article as text"; bỏ khôi phục JSON cắt cụt → "cut off mid-JSON" |
| `settings-navigation-sitemap-read-behavior` | 5 | 5 | JSON hỏng ném lỗi → "navigation"; navbar không lùi về menu chung → "navbar"; mobile đọc menu chung → "mobile"; `/qa-documents` không mang ngày → R5-15; bài nháp vào sitemap → "published articles only" |
| Vòng 3 — sửa theo verifier (`mutants-round3.list`) | 10 | 10 | `translatedText` không lọc → R5-11 "single-text"; khoá dedupe bỏ `model` / token vào / token ra (V16/V27/V28 của verifier) → mỗi cái đúng test "dedupe key holds …" của nó; token không làm tròn → R5-8 "fractional"; bỏ trần INT của token → R5-7 "INT columns"; bỏ trần `execution_ms` → R5-7 "INT columns"; nhận `tokS` âm → R5-7 "INT columns"; bỏ đếm `skippedLogs` → **2** test R5-7 (cả hai ghim bộ đếm); kiểm độ dài cả khi có `commentIds` → R5-2 "checked only when it is used" |
| **Tổng** | **49** | **49** | 47 đúng một test đỏ, 2 làm đỏ hai test cùng ghim một bất biến (helper dùng chung của hai route; bộ đếm `skippedLogs`); cây sản phẩm khôi phục từng byte sau mỗi lượt |

**Kiểm chứng độc lập** (verifier, `/home/ray/orca/cdht-wave3-tests-r5-verify/mutants-verify.log`, trên `29fd17b1`): 28 đột biến tự viết — 23 chết, 2 tương đương (bỏ `provider` khỏi khoá dedupe khi đã giữ `service_key = 'delify_router'` — chỉ đồng bộ ghi khoá đó, luôn với `delify`; `Object.hasOwn` → `in` ở `target-language.ts` — regex đã chặn mọi tên của `Object.prototype`), 3 sống (V16/V27/V28: bỏ riêng `model` / token vào / token ra khỏi khoá dedupe) — đã thêm ba test ở vòng 3, nay cả ba đỏ.

### Lỗi tìm thấy (ghim lúc viết test, sửa sau đó)

Mỗi suite chạy "trên base" bằng `findings-on-rev.sh 0778e988 <suite>` (đặt tạm mọi tệp `server/`, `shared/` khác base về `0778e988`, chạy, khôi phục, so từng byte): **đúng** các test `FINDING-R5-n` đỏ, mọi test khác xanh — 4 + 4 + 7 + 7 + 1 = 23 test FINDING, 42 test còn lại xanh (log `partA-on-base.log`, `usage-on-base.log`, `delify-round2-on-base.log`, `translate-on-base.log`, `settings-on-base.log`). Vòng 2 (kiểm chứng độc lập của chính lát, sau commit `fa372118`): hai test Delify mới đỏ trên `fa372118` và chỉ chúng, 14 test còn lại của suite xanh (`delify-round2-on-fa372118.log`). Vòng 3 (theo verifier, trên `29fd17b1`): đúng 6 test đỏ — 4 test FINDING mới (R5-2, R5-7, R5-8, R5-11) và 2 test cũ có kỳ vọng thêm trường `skippedLogs`; ba test khoá dedupe xanh trên `29fd17b1` (ghim cho đột biến, không phải lỗi) (`verify-fixes-on-head.log`).

| Mã | Mức | Tệp | Lỗi | Trạng thái |
|---|---|---|---|---|
| FINDING-R5-1 | trung bình (an toàn nội dung) | `comments/ai-moderate.post.ts` | Nội dung bình luận và tên người gửi (`custom_display_name` người đọc tự đặt) dán **nguyên văn** vào prompt kiểm duyệt (`Nội dung: "${content}"`) — trong cặp ngoặc kép người bình luận tự đóng được, trước nửa phần yêu cầu; biến `{{content}}`/`{{author}}` cũng thô. Trái quy tắc CLAUDE.md mà luồng worker đã theo | **Đã sửa**: cả hai trong `fenceUntrustedContent` (thẻ `noi_dung_`/`ten_tac_gia_` + 12 hex mới mỗi lượt), đặt sau yêu cầu và định dạng JSON, kèm câu "là DỮ LIỆU, KHÔNG phải chỉ dẫn" nêu tên thẻ; hai biến bọc như vậy với thẻ riêng |
| FINDING-R5-2 | thấp (họ R4-10) | `comments/ai-moderate.post.ts` | Văn bản dán (`content`) không giới hạn, prompt lấy nguyên văn: 2 MB vẫn gửi và tính tiền. Bản sửa vòng 1 kiểm cả khi có `commentIds` — lúc đó `content` bị bỏ qua mà vẫn 400 nhầm (verifier, PROBE-1) | **Đã sửa** (hai vòng): > `COMMENT_MAX_LENGTH` (2000) → 400 trước lượt gọi, chỉ khi văn bản dán thật sự được dùng |
| FINDING-R5-3 | trung bình (tiền) | `ai/usage.get.ts`, `utils/ai-budget.ts` | Mốc đầu tháng `new Date(y, m, 1)` theo TZ **tiến trình**; image Docker đặt `Asia/Ho_Chi_Minh`, đường PM2 (`ecosystem.config.cjs`) thì không. Tiến trình UTC: 00:00–07:00 ngày 1 (giờ VN) "tháng này" vẫn là tháng trước — `checkBudget` tính cả chi phí tháng trước vào hạn mức tháng mới (chặn mọi lượt AI đầu tháng khi tháng trước gần trần), bảng điều khiển hiện tổng tháng trước; cuối tháng bỏ sót 7 giờ đầu ngày 1 | **Đã sửa**: `vietnamMonthStart` dùng ở cả hai |
| FINDING-R5-4 | thấp | `ai/usage.get.ts` | Biểu đồ theo ngày nhóm `DATE(created_at)` = ngày UTC: mọi lượt gọi 00:00–07:00 giờ VN rơi vào hôm trước; lượt 02:00 ngày 1 hiện ở ngày cuối tháng trước trong khi đã tính vào tổng tháng này. Cửa sổ `now − 30 ngày` làm cột đầu nửa ngày | **Đã sửa**: ngày lịch VN qua `CONVERT_TZ`; cửa sổ = 30 ngày lịch VN kết thúc hôm nay, trọn ngày |
| FINDING-R5-5 | thấp (họ R4-6) | `ai/delify/sync.post.ts` | Giá router ngoài DECIMAL(8,4) → cả lượt đồng bộ hỏng trên MySQL strict; giá âm → chi phí âm | **Đã sửa**: `isStorableCostPerMillion`, bỏ qua và đếm vào `skipped` |
| FINDING-R5-6 | trung bình (họ R4-11) | `ai/delify/sync.post.ts` | Tên model > 64 ký tự bị cắt còn 64 — thành tên của **model khác**, ghi đè giá và nhà cung cấp của nó | **Đã sửa**: bỏ qua |
| FINDING-R5-7 | thấp | `ai/delify/sync.post.ts` | Mục sai hình dạng (tên/model không phải chuỗi, `null`) ném `TypeError` trong transaction → 500, không đồng bộ được gì; chi phí âm/vô lý của router vào bảng `checkBudget` cộng. Vòng 1 chưa kiểm số token và `tokS`: `{tok: 1500, tokS: 0.0005}` cho `execution_ms` = 3e9, vượt INT → MySQL ERROR 1264, cả lượt 500 (verifier) | **Đã sửa** (hai vòng): `storableModel` / `storableHistoryItem` parse từng mục; `storedCount` — token vào/ra/tổng hữu hạn, ≥ 0, ≤ INT; `tokS` hữu hạn ≥ 0; `execution_ms` tính ra ≤ INT. Mục lịch sử không ghi được bỏ qua và đếm vào `skippedLogs` (trường mới của câu trả lời + meta audit; `skipped` giữ nghĩa "model bỏ qua", để `upserted + skipped = totalFromApi`) |
| FINDING-R5-8 | trung bình (tiền) | `ai/delify/sync.post.ts` | Mốc lịch sử có mili giây, cột TIMESTAMP(0): MySQL làm tròn khi ghi nên phép so `created_at = '…00.567'` không bao giờ thấy hàng nó vừa ghi — mỗi lượt đồng bộ chèn lại cả lịch sử, chi phí bị nhân lên. Khoá dedupe chỉ là `(provider, created_at)`: sau khi làm tròn nó gộp hai lượt gọi khác nhau trong cùng giây (thiếu chi phí) và có thể nhận nhầm hàng cổng AI tự ghi cùng giây là "đã nhập" (vòng 2). Token lẻ (1.5): MySQL làm tròn vào cột INT (2) nên `= 1.5` không thấy hàng, chèn lại mỗi lượt (verifier, vòng 3) | **Đã sửa** (ba vòng): làm tròn về giây như MySQL trước khi so và ghi; chỉ so với hàng đồng bộ đã ghi (`service_key = 'delify_router'`) theo giây + model + số token vào/ra; token làm tròn như MySQL trước khi làm khoá. Mỗi thành phần của khoá có một test riêng (hai lượt cùng giây chỉ khác đúng thành phần đó) — đột biến bỏ riêng `model` / token vào / token ra của verifier (V16/V27/V28, sống sót ở vòng 2) nay đỏ. **Hàng đã nhân đôi bởi các lượt đồng bộ trước có thể còn** trên CSDL đang chạy (verifier đo CSDL dev: 0 nhóm trùng; production không kiểm được từ đây) và nếu còn thì vẫn được `checkBudget` cộng trong tháng của chúng; tìm (chỉ đọc) bằng `SELECT created_at, model, prompt_tokens, completion_tokens, cost_usd, COUNT(*) FROM ai_usage_logs WHERE service_key = 'delify_router' GROUP BY created_at, model, prompt_tokens, completion_tokens, cost_usd HAVING COUNT(*) > 1` (đã chạy thử trên CSDL nháp, `mysql-delify-duplicates-query.log`). Dọn là một migration — qua toolkit `production/` theo quy tắc CLAUDE.md, cần người dùng quyết; lát này không chạm dữ liệu thật |
| FINDING-R5-9 | thấp | `ai/delify/status.get.ts`, `sync.post.ts` | `summary`/`history`/`availableModels` của router, các trường của thẻ khoá (`name`, `groupName`, `allowedModels`, …) và `delifyUsage` của câu trả lời đồng bộ chuyển nguyên văn cho người có `ai.read`/`ai.update` — trường router thêm (khoá đã dùng để hỏi, URL mang khoá) tới trình duyệt | **Đã sửa** (hai vòng): chỉ các trường `AiDashboardTab.vue` hiện, mỗi trường ở kiểu thẻ hiển thị (chuỗi/số/bool; danh sách model chỉ phần tử chuỗi) |
| FINDING-R5-10 | thấp | `ai/translate.post.ts` | HTML bài viết bị escape rồi bọc trong dấu phân cách cố định `<<<USER_CONTENT`: prompt đòi giữ 100 % thẻ nhưng model thấy `&lt;p&gt;` | **Đã sửa**: mỗi phần trong `fenceUntrustedContent` (`van_ban_`), không escape |
| FINDING-R5-11 | trung bình (quy tắc CLAUDE.md) | `ai/translate.post.ts` | `translatedContent` — HTML do model viết — trả về không qua `sanitizeHtml`; nhánh dịch một đoạn (`translatedText`) cũng vậy (verifier, PROBE-2) | **Đã sửa** (hai vòng): cả hai qua `sanitizeHtml`. Hệ quả đã biết của bộ lọc dùng chung: một `<` trần trong văn bản thuần ("Q&A < 5") bị coi là đầu thẻ và phần sau bị bỏ — cùng hành vi với thân bài viết; không sửa ở đây (`sanitize-html.ts` là tiện ích an ninh dùng chung) |
| FINDING-R5-12 | thấp | `ai/translate.post.ts` | Câu trả lời không phải JSON → trả "[EN] <tiêu đề tiếng Việt>", tóm tắt tiếng Việt làm "bản dịch", câu từ chối của model làm nội dung | **Đã sửa**: 502 |
| FINDING-R5-13 | thấp | `ai/translate.post.ts`, `translate-ui.post.ts` | `LANGUAGE_NAMES[code] \|\| code` trên mọi chuỗi: `constructor` thành hàm dán vào prompt; chuỗi bất kỳ (dài, xuống dòng, "bỏ qua yêu cầu") vào prompt và tính tiền | **Đã sửa**: `utils/ai/target-language.ts` (bỏ hai bản chép bảng tên) — chỉ mã ngôn ngữ, 400 trước lượt gọi |
| FINDING-R5-14 | thấp | `ai/translate-ui.post.ts` | Trả nguyên câu trả lời của model: khoá không ai hỏi, object/số làm "bản dịch" | **Đã sửa**: chỉ khoá được hỏi, giá trị chuỗi |
| FINDING-R5-15 | thấp | `utils/sitemap-builder.ts` (qua `settings/sitemap/generate.post.ts`) | `/qa-documents` nằm trong danh sách trang và còn được thêm lần nữa khi có hỏi–đáp xuất bản → URL hai lần trong sitemap, từ commit đầu của tính năng | **Đã sửa**: một mục, `lastmod` = hỏi–đáp xuất bản mới nhất |

Ghi nhận, không sửa ở lát này (quyết định thiết kế hoặc ngoài phạm vi):
- **Delify: chi phí đếm hai lần.** Mỗi lượt gọi qua cổng AI với nhà cung cấp `delify` đã được `logAiUsage` ghi một hàng (khoá dịch vụ thật, `created_at` = lúc ghi); "Đồng bộ" nhập lại chính lượt đó từ lịch sử router thành hàng `delify_router`. `checkBudget`, tổng tháng của `usage.get` và "đã dùng" của `status.get` cộng cả hai. Trước lát, khoá dedupe `(provider, created_at)` đôi khi (ngẫu nhiên, khi trùng giây) bỏ qua lượt đó; nay dedupe chỉ nhìn hàng đồng bộ đã ghi (R5-8 vòng 2), nên việc đếm hai lần là **chắc chắn**, đúng như thiết kế hiện tại. Verifier độc lập xác nhận là THẬT (PROBE-5, `/home/ray/orca/cdht-wave3-tests-r5-verify/probe-doublecount.log`): một lượt gọi 11,47 VND thành hai hàng (`translation_article` + `delify_router`), chi tiêu cộng 22,94 VND; trên CSDL dev có các cặp hàng cổng AI / hàng nhập cách nhau 80–100 giây (`mysql-double-count-evidence.log`). Sửa đúng cần chọn: không nhập lịch sử, hay nhập nhưng không tính vào chi tiêu, hay khớp với hàng cổng AI theo model/token/khoảng thời gian — cần người dùng quyết. Cùng gốc: hàng đã nhân đôi bởi các lượt đồng bộ trước (truy vấn tìm ở FINDING-R5-8).
- MariaDB **cắt** phần lẻ giây của TIMESTAMP(0) (`…00.567` → `…00`, verifier đo trên MariaDB 11.8.9: `mariadb-timestamp-fraction.log`) trong khi MySQL 8.0 **làm tròn** (`…01`). `storedSecond` làm tròn theo MySQL; compose production dùng `mysql:8.0` nên không áp dụng — không sửa. Vì mã gửi giây đã tròn, không còn phần lẻ nào để MariaDB cắt: giá trị so và giá trị lưu vẫn trùng nhau trên cả hai.
- Đồng bộ Delify gán mọi hàng lịch sử cho cán bộ bấm nút (`user_id`); tỉ giá 25 500 viết cứng ở `sync`, `status`, `ai-budget` trong khi `calculateAiCost` đọc `USD_TO_VND_RATE` (compose không truyền biến đó, nên trên Docker hai bên vẫn khớp); `success` chỉ khi `status === '200'` dạng chuỗi.
- `comments/ai-moderate.post.ts`: câu trả lời không đọc được hay `verdict` lạ thành `safe` với lý do "Không có dấu hiệu vi phạm rõ ràng." — đúng thứ một chỉ dẫn tiêm muốn (worker coi đó là "không có câu trả lời"). Sửa đúng cần trang `/admin/comments` hiển thị trạng thái thứ tư (trang chỉ biết ba `verdict`) — cần lát được đụng `app/**`.
- Quyền (chỉ báo cáo, không đổi): `comments.read` chi tiền AI (kiểm duyệt), `news.read` (dịch, biên tập), `settings.read` (dịch giao diện); `translate.post.ts` và `translate-ui.post.ts` không có nơi gọi trong `app/` — ứng viên gỡ bỏ, cần người dùng quyết.
- Rà các nơi dán dữ liệu vào prompt (`callAi`): dữ liệu **công khai** chỉ còn ở chatbot — `variables.question` (câu hỏi của khách) thay vào `{{question}}` của system prompt chatbot do quản trị viên tự viết (`AiServicesTab.vue` gợi ý biến này), không qua fence; đường chat thuộc agent khác. Dữ liệu **cán bộ viết** (bài, nhãn giao diện, khối trang) không bọc ở `editorial.post.ts` (chú thích sai "gateway bọc variables" đã sửa), `article-translation-worker.ts`, `i18n-auto-translate.ts`, `languages/ai-translate*.post.ts`, `universal-translation.ts`; biến `source_text` của `translate.post.ts` thô.

### Lát sau (theo thứ tự xếp hạng)

1. Quyết định về chi phí Delify đếm hai lần (ở trên), rồi sửa trong `sync.post.ts` + nơi cộng chi tiêu; cùng lúc quyết có dọn hàng đã nhân đôi (migration qua `production/`) hay không.
2. `server/services/universal-translation.ts` (444 dòng mã, 0 %) — job dịch toàn hệ thống; cần suite riêng (khoá/hủy/tiến độ, `upsertTranslations`, gọi model theo lô).
3. Kết quả AI không đọc được ở `comments/ai-moderate` (trạng thái thứ tư, cần `app/**`).
4. `server/api/admin/languages/ai-translate*.post.ts`, `server/services/i18n-auto-translate.ts` — dịch nhãn bằng AI (giới hạn độ dài, giữ khoá được hỏi như R5-14).
5. Còn 0 %/thấp trong `settings/**` và lân cận: `chatbot/settings/index.get.ts` (38), `chatbot/settings/clear.post.ts` (7); ngoài sáu lớp: `services/readers.ts` (36 %), `services/ip-bans.ts` (36,4 %), `articles/[id]/boost.post.ts` (34,8 %).

## Lát R6 của task 5.2 — đo lại 2026-10-29 (Node 24, `0a2707e8`)

Lát thứ sáu: mục 2, 4, 5 của "Lát sau" ở lát R5 (mục 1 — chi phí Delify đếm hai lần — và mục 3 — cần `app/**` — vẫn chờ), cộng các handler admin còn 0 % trong `server/api`. Không đụng Delify, chatbot sovereignty/chat-policy, `app/`.

**Đo ở đâu.** `npm run test:coverage` trong `cdkt-cov:node24` (Node 24, `TZ=Asia/Ho_Chi_Minh`) trên `wave3/integration` = `0a2707e8`, trước khi đụng gì (log `coverage-before.log` ở thư mục bằng chứng `/home/ray/orca/cdht-wave3-tests-r6-proof/`): 788 tệp, 200 chưa nạp, **84,72 %** (75 375 / 88 973); `server/api` 70,38, `server/services` 86,99, `server/utils` 95,14. Ratchet đã báo RISE ở `shared` (+3,58) trên cây chưa đụng — của các nhánh gộp trước, lát này không nâng.

`languages/ai-translate*.post.ts` (97–100 %) và `i18n-auto-translate.ts` (91,3 %) đã có test hành vi từ trước (`language-translations-write-behavior`, `model-translations`) — lát này không thêm, chỉ ghi nhận (xem dưới).

### Đã làm trong lát này

| # | Tệp | Trước | Sau | Suite |
|---|---|---|---|---|
| 1 | `server/services/universal-translation.ts` | 0 % (444) | 98,9 % (355/359) | `universal-translation-behavior` |
| 2 | `server/services/universal-translation-blocks.ts` (mới, tách từ #1) | — | 97,9 % (190/194) | như trên |
| 3 | `system/translation-coverage.get.ts`, `universal-translate-status.get.ts`, `universal-translate-cancel.post.ts` | 0 % (11 + 10 + 7) | 100 % | như trên |
| 4 | `server/services/readers.ts` | 36,0 % (198/550) | 83,1 % (457/550) | `reader-moderation-behavior` |
| 5 | `server/services/ip-bans.ts` | 36,4 % (43/118) | 97,5 % (116/119) | như trên |
| 6 | `readers/index.get.ts`, `[id].get.ts`, `[id].delete.ts`, `[id]/ban.post.ts`, `[id]/unban.post.ts`, `[id]/comments.delete.ts`, `[id]/impact.get.ts` | 0 % (21 + 18 + 13 + 16 + 13 + 13 + 10) | 91,7–100 % | như trên |
| 7 | `ip-bans/index.get.ts`, `index.post.ts`, `[id].delete.ts` | 0 % (6 + 22 + 13) | 100 % | như trên |
| 8 | `articles/[id]/boost.post.ts` | 34,8 % (40/115) | 100 % (119/119) | `article-boost-behavior` |
| 9 | `articles/[id]/boost.delete.ts` | 0 % (55) | 97,8 % (87/89) | như trên |
| 10 | `chatbot/settings/index.get.ts`, `clear.post.ts` | 0 % (38 + 7) | 100 % | `chatbot-settings-read-clear-behavior` |
| 11 | `articles/export-batch.get.ts` (lớn nhất trong 0 %) | 0 % (115) | 100 % (137/137) | `article-export-behavior` |
| 12 | `articles/[id]/export.get.ts` | 0 % (98) | 100 % (125/125) | như trên |
| 13 | `articles/export-google.post.ts` | 0 % (83) | 100 % (111/111) | như trên |
| 14 | `media-portal/index.get.ts` (+ `services/media-portal-admin-read.ts` 67,0 → 96,3 %) | 0 % (81) | 100 % (121/121) | `media-portal-admin-list-behavior` |

`server/services/chatbot-settings.ts` 77,0 → 89,7 %; `articles/export-csv.get.ts`, `article-export-google.ts`, `vn-day-range.ts` (thêm `vietnamDateString`) giữ mức cũ, mỗi chỗ đổi có test riêng. `article-views.ts` giữ 80,3 % (phần còn thiếu là `getArticleViewStats`, không thuộc đường boost). Trong sáu handler 0 % lớn nhất, lát này làm bốn (#11–#14); hai còn lại ở "Lát sau". Cột "Sau" đếm mọi dòng vật lý của tệp đã nạp.

**Sau lát** (log `coverage-after.log`, Node 24, cây cuối `55b11413`): 789 tệp, 179 chưa nạp, **86,57 %** (77 406 / 89 411). `server/api` 70,38 → 74,55, `server/services` 86,99 → 89,87, `server/utils` 95,14 → 95,18. Mức nền ratchet nâng đúng ba thư mục lát này đụng, bằng số đo (sửa tay, không `--update` vì `--update` nâng cả `shared`): `server/api` 70,37 → 74,55, `server/services` 86,98 → 89,87, `server/utils` 95,13 → 95,18 (`coverage-ratchet-final.log`). Toàn bộ unit + ratchet (lệnh CI `npm test`, Node 26 cục bộ, `TZ=Asia/Ho_Chi_Minh`, `unit-full.log`): 7 227 test, 0 đỏ, 54 bỏ qua (integration không có MySQL). Sáu suite mới + test ngày của Google chạy lại ở `TZ=UTC`: 65/65 xanh (`new-suites-tz-utc.log`). `file-length.baseline.json`: bỏ mục `universal-translation.ts` (540 → 359, dưới 400); `readers.ts` giữ đúng 550.

**Sau vòng kiểm chứng** (M1 kể cả hai đường anh em, M2, L1–L5 bên dưới; log `coverage-final.log`, Node 24, cây `de797591` + tài liệu): 789 tệp, 179 chưa nạp, **86,58 %** (77 433 / 89 434). `server/api` 74,55 → 74,549 (14 412 / 19 332; theo `race2/lcov_cmp.py` của verifier, lcov của `55b11413` so với vòng này: `export-csv.get.ts` 127/147 → 123/143 — bộ chặn ngày riêng gộp vào `vietnamDateString`, −4 dòng đã phủ —, `boost.post.ts` 119/119 → 121/121 (+2), `boost.delete.ts` 87/89 → 88/90 (+1): ròng −1 dòng đã phủ, −1 dòng), `server/services` 89,87 → 89,89 (27 680 / 30 793; `universal-translation-blocks.ts` 97,9 → 100 %, `ip-bans.ts` 97,8 %), `server/utils` giữ 95,18. Mức nền theo số đo làm tròn xuống, không vượt số đo: `server/api` 74,55 → **74,54** (mốc duy nhất hạ, một dòng; cả lát vẫn 70,37 → 74,54), `server/services` 89,87 → **89,89**, `server/utils` giữ 95,18. Unit + ratchet (`npm test`, Node 26): 7 250 test, 0 đỏ, 54 bỏ qua — ở cả `TZ=Asia/Ho_Chi_Minh` (`unit-full-final-vn.log`) và `TZ=UTC` (`unit-full-final-utc.log`).

### Harness (thêm, không đổi hành vi cũ — 45 suite dùng chung: 410/410 xanh, `harness-users-f.log`)

- `_ai-route-harness.ts`: câu trả lời nhà cung cấp có thể là promise — giữ job nền giữa lượt (test 409, huỷ).
- `_sqlite-mysql-db.ts`: `like ?` mang `escape '\'` (ký tự thoát mặc định của MySQL; SQLite không có — trước đó một mẫu đã thoát nghĩa khác trên hai bên); `beforeNext(pattern, fn)` (một người ghi khác chen giữa đọc và ghi); `txStatements` (câu nào chạy trong transaction); upsert nhận `` `col` = `bảng`.`col` + ? ``; mặc định của cột JSON (`.default([])`) lưu dạng văn bản JSON — trước đó là chuỗi rỗng và mọi lần đọc `media_items` ném "Unexpected end of JSON input".
- `_h3-handler-server.ts`: thêm `setResponseStatus`, `setHeader` vào các hàm tự import.

### Múi giờ

Ba nơi chạm ngày, mỗi nơi test ở `TZ=UTC` và `TZ=Asia/Ho_Chi_Minh` (đổi `process.env.TZ` trong test, `mock.timers` chỉ `Date`):
- Xuất bài (FINDING-R6-17): "Ngày" theo TZ tiến trình, tên tệp theo ngày UTC → nay ngày lịch VN qua `vietnamDateString` (độ lệch cố định, cùng cách các hàm khác của `vn-day-range.ts`). Bản `TZ=Asia/Ho_Chi_Minh` vẫn đỏ trên base — vì tên tệp lúc 01:30 ngày 1/12 giờ VN mang ngày 30/11.
- Tăng lượt xem tức thì: hàng `boost` của `article_view_daily` mang ngày **UTC** (`viewDay`) ở cả hai TZ — có chủ đích (cùng ngày mà token người xem của lượt xem thật được suy ra); test ghim, không đổi (xem "cần chủ dự án quyết").
- Lượt tăng dần: `started_at`/`ends_at` (DATETIME) ghi qua Drizzle, so ISO — không phụ thuộc TZ.

### Cách chạy và cái bẫy đã gặp

- zsh không tách từ `$files` không ngoặc: chạy danh sách suite qua `cap80 bash -c '…'`.
- Một hook ghi bằng `sqlite.exec` trong transaction đang mở bị chính ROLLBACK của handler xoá theo. Test "bộ lập lịch thắng cuộc đua" (R6-15) commit lượt của bộ lập lịch rồi mở lại (`COMMIT; UPDATE …; BEGIN`) — lúc đó transaction của handler chưa ghi gì, đúng như MySQL đọc hàng đã commit mới nhất cho UPDATE có điều kiện.
- SQLite không có khoá hàng: TOCTOU của boost.post (R6-14) không dựng được bằng hai yêu cầu song song (harness cấm transaction lồng). Test đơn vị ghim thứ tự câu lệnh trong transaction (`txStatements`); hành vi khoá phát lại trên MySQL 8.0.46 bằng hai phiên (`mysql-boost-lock.sh`/`.log`, CSDL tạm `cdkt_r6_<rand>`, đã xoá, `SHOW DATABASES LIKE 'cdkt_r6_%'` rỗng).
- `readBody` của h3 trả `undefined` cho yêu cầu không có body — `.catch(() => …)` không chạy (R6-18).
- Drizzle bọc lỗi truy vấn: `err.message` là "Failed query: <SQL> params: …", lỗi gốc ở `cause`.
- `checkPermission` trả `false` cho hành động lạ, nên bỏ `action === 'clear'` khỏi cổng siêu quản trị là đột biến **tương đương** — thay bằng đột biến bỏ dòng `forbidden()`.
- Mã có backtick/`$`/`&` trong biểu thức sed của đột biến: dùng chuỗi con không chứa chúng, hoặc lệnh địa chỉ (`/…/d`, `/…/{n;d}`).

### Đột biến (mỗi cái ≥ 1 test đỏ; `mutants.sh` + `mutants-*.list`, log ở thư mục bằng chứng; cây sản phẩm khôi phục từng byte sau mỗi lượt)

| Suite | Chạy | Đỏ | Ghi chú |
|---|---|---|---|
| `universal-translation-behavior` (`mutants-a`) | 13 | 13 | bỏ sanitize → R6-3; `String(value)` → R6-4; nhận JSON thiếu trường → R6-4 + R6-5; JSON hỏng vẫn đi tiếp → R6-4 + R6-5; dịch lại khối đã dịch, hỏi cả email → test "blocks"; vị từ quét cũ → R6-2; đếm bản dịch bài nháp, đếm khoá mồ côi → R6-1; nhận mọi mã ngôn ngữ → R6-6; khúc 20 khoá → test UI + huỷ; bỏ qua huỷ → test huỷ; nhận giới hạn âm → R6-7 |
| `reader-moderation-behavior` (`mutants-b`) | 10 | 10 | bỏ thoát LIKE → R6-8; bỏ khoá phụ `id` → R6-9; audit "unban" ma → R6-10; sắp IP tăng dần → R6-11; audit trang được hỏi → R6-12; không tăng `tokenVersion`, bỏ lọc "banned", audit chi tiết không id, purge theo `readers.delete` (2 test), nhận địa chỉ trùng → mỗi cái test của nó |
| `article-boost-behavior` (`mutants-c`) | 7 | 7 | huỷ không phạm vi → R6-13; không đếm `affectedRows` → R6-15; bỏ khoá hàng bài → R6-14; bỏ 409, cửa sổ tính giây → test "gradual"; ghi vào nửa thật → hai test TZ; `viewDay` theo giờ địa phương → test `TZ=Asia/Ho_Chi_Minh` |
| `chatbot-settings-read-clear-behavior` (`mutants-d`, `-d2`) | 6 + 1 | 5 + 1 | phủ khoá/host/enabled, xoá không xoá khoá, không tạo hàng mặc định; bỏ `forbidden()` của cổng siêu quản trị (`-d2`). Cái thứ sáu của `mutants-d` sống và là **tương đương** (ở trên) |
| `article-export-behavior` (`mutants-e`) | 9 | 9 | không phạm vi → R6-16; ngày UTC ở HTML/ZIP/CSV, `vietnamDateString` = UTC → hai test R6-17 (cùng bất biến, hai TZ); ngày UTC ở dịch vụ Google → test của `…-ssrf-behavior`; `body.ids` → R6-18; bỏ escape `<`, bỏ lọc quyền ZIP → test của nó |
| `media-portal-admin-list-behavior` (`mutants-f`) | 4 | 4 | nhận trạng thái lạ, bỏ trần `limit`, bỏ khoá phụ `id`, bỏ thoát LIKE |
| **Tổng** | **50** | **49** | + 1 tương đương ghi lại (sống, không làm đổi hành vi); nhiều test đỏ cùng lúc chỉ khi chúng ghim cùng một bất biến (hai TZ, hai route dùng chung) |

### Lỗi tìm thấy (ghim lúc viết test, sửa sau đó)

Mỗi suite chạy "trên base" bằng `findings-on-rev.sh <commit trước> <suite>`: **đúng** các test `FINDING-R6-n` đỏ, mọi test khác xanh — 7 + 5 + 3 + 4 test FINDING (`universal-on-base.log`, `readers-on-base.log`, `boost-on-base.log`, `export-on-base.log`); thêm test ngày của dịch vụ Google và test cấu trúc `article-export-google` (cập nhật `body?.ids`) đỏ trên base (`export-google-on-base.log`). Hai suite không có lỗi mới: `chatbot-settings-read-clear-behavior`, `media-portal-admin-list-behavior`.

| Mã | Mức | Tệp | Lỗi | Trạng thái |
|---|---|---|---|---|
| FINDING-R6-1 | trung bình (số liệu) | `universal-translation.ts` (quét) | `articlesMissing` trừ mọi bản dịch không lỗi — kể cả của bài nháp/lưu trữ; `uiMissing` trừ mọi khoá có chữ của ngôn ngữ đích — kể cả khoá vi không có (danh mục đã xoá): báo 0 thiếu, 100 % khi chưa bài xuất bản nào được dịch | **Đã sửa**: JOIN bài đã xuất bản, `COUNT(DISTINCT)`; chỉ khoá của vi |
| FINDING-R6-2 | thấp | như trên | Quét và job đọc "khối có chữ" khác nhau: khối chỉ có nhãn nút được dịch mà không được đếm; khối chỉ có số (hay `title` không phải chữ) bị đếm thiếu mãi, tab không bao giờ tới 100 % | **Đã sửa**: một hàm `blockTranslationParts` cho quét, đếm việc, job |
| FINDING-R6-3 | trung bình (quy tắc CLAUDE.md) | `universal-translation-blocks.ts` | `bodyHtml` model viết vào `data.translations[lang]` không qua `sanitizeHtml` lúc ghi (endpoint công khai lọc lúc đọc; guard `security-translation-html` chỉ quét đường ghi bản dịch bài viết) | **Đã sửa** |
| FINDING-R6-4 | thấp | như trên | Mọi khoá trong `BLOCK_STRING_KEYS` model trả về vào bản dịch (thêm `badge` "HOT" mà khối tiếng Việt không có); nhãn dạng object thành "[object Object]" | **Đã sửa**: chỉ trường được hỏi, qua `modelTranslationText` |
| FINDING-R6-5 | thấp (hệ quả chi phí) | như trên | Phần JSON hỏng mà phần HTML được → bản dịch chỉ có thân, cả quét lẫn lượt sau coi là đã dịch; tiêu đề tiếng Việt nằm mãi trên trang tiếng Anh | **Đã sửa**: chỉ ghi khi đủ mọi phần (JSON thiếu trường = chưa xong; JSON hỏng thì không gọi phần HTML). Khối hỏng được hỏi lại ở lượt sau (tốn thêm một lượt gọi cho khối đó) |
| FINDING-R6-6 | thấp (chi phí) | `universal-translation.ts` (job) | Dịch sang mọi mã có trong bảng: `vi` (tiếng Việt sang tiếng Việt, ghi bản dịch `vi` cho khối và bài) và ngôn ngữ đã tắt | **Đã sửa**: chỉ ngôn ngữ đang bật khác vi |
| FINDING-R6-7 | thấp (chi phí) | `system/universal-translate.post.ts` | `articlesLimit` "abc"/-1 → "không giới hạn": cả kho × mọi ngôn ngữ | **Đã sửa**: 400 nếu không phải số nguyên ≥ 0; 0 vẫn là "tất cả" (xem "cần chủ dự án quyết") |
| FINDING-R6-8 | thấp (quy ước CLAUDE.md) | `readers.ts` | Ô tìm người đọc dán chữ vào LIKE không thoát: `nguyen_van` khớp `nguyenxvan`, `%` khớp mọi người | **Đã sửa**: `likeContains` |
| FINDING-R6-9 | thấp | như trên | Sắp `last_seen_at DESC` không khoá phụ — MySQL trả hàng hoà theo thứ tự bất kỳ, hai trang có thể trùng/thiếu một người | **Đã sửa**: thêm `id DESC` |
| FINDING-R6-10 | trung bình (audit, tranh chấp) | `readers.ts`, `ip-bans.ts` | Bỏ chặn tài khoản không bị chặn vẫn ghi dòng "unban" — việc không xảy ra. Vòng 1 chỉ chặn trường hợp tuần tự (đọc `is_banned` ngoài transaction): hai POST `unban` cùng lúc vẫn ghi hai dòng (verifier M1, 30/30 trên MySQL). Cùng mẫu ở ba đường anh em: hai lần chặn cùng lúc cùng nhận đã xoá các bình luận (4 cho 2) và cùng ghi `tokenVersion` từ một lần đọc cũ; hai lần gỡ chặn IP ghi hai dòng "delete"; hai lần chặn cùng địa chỉ → `ER_DUP_ENTRY` 500 | **Đã sửa** (ba vòng): `UPDATE … AND is_banned=1` + `readAffectedRows` trong transaction, audit chỉ khi 1 hàng; gỡ IP / xoá tài khoản: DELETE được đếm, 0 → 404 không audit; tạo IP: `INSERT IGNORE` + đếm, 0 → 409; chặn / xoá bình luận: hai lượt đều thành công và đều ghi audit (hai dòng mỗi vòng, đúng: hai thao tác thật), nhưng tổng số bình luận được nhận là số thật (2), không 4. Vòng 2 dùng `FOR UPDATE` hàng người đọc để làm việc đó — gây deadlock và treo pool (verifier vòng 3, H1/H2); vòng 3 đếm trên chính transaction dưới khoá bình luận — xem mục vòng 3. MySQL 8 sau vòng 3: `race2/mysql-new2-same.log` |
| FINDING-R6-11 | thấp | `ip-bans.ts` | Danh sách chặn IP tăng dần theo id, chú thích hứa "mới nhất trước", trang không sắp lại | **Đã sửa** |
| FINDING-R6-12 | thấp (audit) | `readers/index.get.ts` | Audit danh sách ghi trang được HỎI (`?page=9`) thay vì trang được XEM (dịch vụ kẹp về trang cuối) | **Đã sửa** |
| FINDING-R6-13 | thấp (an ninh — oracle id) | `articles/[id]/boost.delete.ts` | Tra bài theo id rồi mới kiểm quyền loại: 404 vs 403 (boost.post và stats.get đã sửa, huỷ thì chưa) | **Đã sửa**: tra trong `articleActionScope(actor, ['read', 'update'])` (vòng 1 viết `'update'`; verifier L2 đổi về quy ước đường ghi, cả boost.post) |
| FINDING-R6-14 | thấp (dữ liệu) | `articles/[id]/boost.post.ts` | Kiểm "đã có lượt tăng dần đang chạy" trên pool trước transaction — bấm đúp: hai lượt chạy song song | **Đã sửa**: `SELECT … FOR UPDATE` hàng bài rồi kiểm, trong transaction; MySQL: thứ tự cũ 2 lượt, thứ tự mới yêu cầu sau chờ khoá rồi 409 |
| FINDING-R6-15 | thấp (audit) | `articles/[id]/boost.delete.ts` | Bộ lập lịch hoàn tất lượt giữa lúc đọc và UPDATE có điều kiện: không hàng nào đổi mà vẫn audit "cancel ở 120/600" và trả 200 | **Đã sửa**: `readAffectedRows !== 1` → 409, không audit (quy tắc "chuyển trạng thái có cạnh tranh") |
| FINDING-R6-16 | thấp (an ninh — oracle id) | `articles/[id]/export.get.ts` | 404 vs 403 như R6-13 | **Đã sửa**: `articleActionScope(adminUser, 'read')` |
| FINDING-R6-17 | thấp (múi giờ — họ R5-3) | xuất HTML/ZIP/CSV/Google Docs | "Ngày" theo TZ tiến trình, tên tệp theo ngày UTC: tiến trình UTC (đường PM2) in bài đăng 03:00 ngày 29 (giờ VN) thành ngày 28; tệp tải 01:30 ngày 1/12 giờ VN mang ngày 30/11 ở mọi TZ | **Đã sửa**: `vietnamDateString` ở sáu chỗ |
| FINDING-R6-18 | thấp | `articles/export-google.post.ts` | POST không body → `body.ids` TypeError → 500 | **Đã sửa**: 400 "Thiếu danh sách bài viết." |

### Thay đổi đã làm mà người dùng/chi phí thấy được — chủ dự án xác nhận

Không hoàn nguyên; liệt kê để không thành đổi ngầm:
- R6-7: `articlesLimit` không phải số nguyên ≥ 0: 200 (chạy cả kho) → **400**.
- R6-13, R6-16: id bài thuộc loại cán bộ **không thấy được** (không đọc, không sửa): **403 → 404** (huỷ tăng lượt xem, xuất một bài). Loại thấy được mà không sửa được: huỷ/tăng lượt xem vẫn **403** (trước sửa cũng 403; sau vòng 1 có lúc là 404, verifier L2 trả về 403).
- R6-15: huỷ thua cuộc đua với bộ lập lịch: 200 "đã huỷ" → **409**, không audit.
- R6-14: yêu cầu tăng dần thứ hai cho cùng bài (bấm đúp): 200 + lượt chạy trùng → chờ khoá rồi **409**.
- R6-18: POST xuất Google không body: 500 → **400**.
- R6-5: khối mà model cứ bỏ sót một trường được hỏi lại — và tính tiền — **mỗi lượt**, không bao giờ "xong"; trước đây nó ghi nửa bản dịch một lần rồi thôi.
- R6-8: ô tìm người đọc trả **ít hàng hơn** khi chữ gõ có `_`/`%`.
- R6-10: bỏ chặn khi không bị chặn (kể cả người thua khi hai người bấm cùng lúc): vẫn 200, nhưng không còn dòng audit. Gỡ chặn IP cùng lúc và xoá tài khoản người đọc cùng lúc: người thua 200 → **404**; chặn cùng địa chỉ cùng lúc: người thua 500 → **409**; chặn cùng lúc và xoá bình luận của người đọc cùng lúc: dòng audit thứ hai (và phản hồi `impact` của nó) báo 0 bình luận đã xoá (trước báo lặp lại số của người thắng). Chặn IP mà lệnh chèn bị bỏ qua vì lý do khác trùng (khoá ngoại): 500 thay vì 409 "đã có trong danh sách".
- R6-11: danh sách chặn IP **đảo thứ tự** (mới nhất lên đầu).
- R6-1, R6-2: **tỉ lệ % độ phủ** của tab "Dịch toàn cục" đổi (thường giảm: bản dịch bài nháp/khoá mồ côi không còn được tính; khối chỉ có số không còn bị đếm thiếu).
- Câu báo hoàn tất của job nay đếm số ngôn ngữ thật sự được dịch (`allLangs`), không phải số mã trong yêu cầu.
- Verifier L2: tăng/huỷ tăng lượt xem trên loại bài cán bộ **thấy được mà không sửa được**: 404 → **403** (loại không thấy, không sửa: vẫn 404).
- Verifier L1: bài có ngày hỏng (`0000-00-00`) được xuất với "Ngày:" trống thay vì 500 cả lượt (Google: không còn bị bỏ khỏi lượt xuất).
- Verifier L3: huỷ bị từ chối 409/404 thì panel tự đọc lại số liệu (lượt đã xong biến khỏi màn hình), toast lỗi giữ nguyên.
- R6-17: trên Docker (TZ VN), tên tệp xuất từ 00:00 tới 07:00 giờ VN nay mang ngày VN (trước là ngày hôm trước); trên đường PM2 (TZ UTC) cả "Ngày" in trong tệp cũng đổi.

**Dữ liệu ghi trước bản sửa.** R6-3: bản dịch khối đã lưu chưa lọc — `stored-html-sanitize.ts` duyệt `page_blocks` qua `sanitizeBlockData` (phủ `translations[lang]`), nên người vận hành chạy `npm run db:sanitize-html` (xem trước) rồi `npm run db:sanitize-html -- --apply` (sao lưu CSDL trước). R6-4/R6-5: bản dịch khối đã lưu có `badge` tự thêm hay chỉ có `bodyHtml` vẫn được coi là "đã dịch" và không gì sửa lại — xoá chúng (để lượt sau dịch lại) là quyết định của chủ dự án.

### Kiểm chứng độc lập (verifier, `/home/ray/orca/cdht-wave3-tests-r6-verify/`) và cách xử lý

Kết luận verifier: "Đạt kèm sửa" — 17/18 FINDING tái hiện đỏ→xanh, R6-14/R6-15 xác nhận trên MySQL 8, không hồi quy ngoài 18 FINDING. Xử lý (commit `cc73b18b`…`72d73eb9`; chín test mới đỏ trên `52d7b527` và chỉ chúng, `verifier-fixes-on-52d7b527.log`):

| Mục | Nội dung | Xử lý |
|---|---|---|
| M1 (trung bình) | R6-10 chưa tới gốc: hai `unban` đồng thời → hai audit (30/30 MySQL) | Sửa như dòng R6-10 ở bảng trên, cùng năm đường anh em. Phát lại 30 vòng × 6 kịch bản trên MySQL 8.0.46 trước/sau sửa (`mysql-reader-race.sh`, CSDL tạm `cdkt_r6b_*` đã xoá; `mysql-reader-race-{before,after}.log`, `…-siblings-{before,after}.log`): unban 2 → 1 audit; chặn: nhận 4 → 2 bình luận, tokenVersion 1 → 2; xoá tài khoản 200+200/2 audit → 200+404/1; xoá bình luận của người đọc: nhận 4 → 2 (vòng 2 bằng khoá hàng người đọc — gây H1/H2, thay ở vòng 3 bên dưới); gỡ IP 200+200/2 → 200+404/1; tạo IP 201+500 → 201+409 (`INSERT IGNORE` bỏ qua vì lý do khác trùng — khoá ngoại `created_by` — thì đọc lại theo giá trị và ném, không báo nhầm "đã có"). Test harness: người kia commit ngay trước lệnh ghi đầu tiên trong transaction (`beforeNext`); harness `insert ignore` → `INSERT OR IGNORE` |
| M2 (trung bình) | Nhánh HTML hỏng của R6-5 (V05) và lần thử HTML thứ hai của R6-3 (V11) chưa từng chạy | Hai test hành vi; V05, V11 nay đỏ |
| L1 | `vietnamDateString(Invalid Date)` ném RangeError → 500 cả lượt xuất | Chặn chung trong `vietnamDateString` → `''`; bộ chặn riêng của CSV bỏ (thừa) nên đột biến E02 không còn chỗ áp — đột biến tương đương với nó (bỏ bộ chặn chung) làm đỏ test của cả bốn đường |
| L2 | boost dùng scope `'update'`, quy ước đường ghi là `['read', action]` | Đổi cả boost.post và boost.delete; loại thấy-không-sửa 404 → 403 (đã ghi ở trên); B03 nay đỏ |
| L3 | Huỷ nhận 409 mà UI vẫn hiện "đang chạy" + nút huỷ | `loadStats()` khi 409/404, giữ toast; ba test qua trang danh sách bài |
| L4 | Đột biến sống V03, V04, V06, V10, E05, E06, R06, R02 | Test cho từng cái — đều đỏ. **R02 tương đương**: handler đã kẹp `perPage` bằng `finitePositive(…, 25, 100)` thành số nguyên trong [1, 100], dịch vụ kẹp lại đúng khoảng đó, nên `perPage` của handler luôn bằng `result.perPage`. B05 tương đương (verifier xác nhận) |
| L5 | Tài liệu | Mục này, dòng R6-10, danh sách "thay đổi người dùng thấy" ở trên |

Đột biến vòng này (`mutants-v.list`/`.log`, `mutants-v2.list`/`.log`): 28 chạy, 27 chết, 1 sống tương đương (R02). Trong đó 17 đột biến cho các bản sửa mới (M1 ×10 kể cả hai đường anh em và đọc lại sau IGNORE, L1 ×1 chạy trên hai suite, L2 ×3 kể cả B03, L3 ×3), tất cả chết. Mười hai test mới của vòng này (9 + 3) đỏ trên commit trước bản sửa và chỉ chúng (`verifier-fixes-on-52d7b527.log`: 9; `siblings-on-13485ca5.log`: 3, gồm hai đường anh em và IGNORE).

### Kiểm chứng vòng 3 (verifier, `/home/ray/orca/cdht-wave3-tests-r6-verify2/`): hai hồi quy đồng thời của vòng 2 và cách xử lý

Kết luận verifier: "Không đạt" — bản sửa M1 cho hai yêu cầu giống nhau đúng, nhưng vòng 2 thêm hai hồi quy mà base `52d7b527` không có:
- **H1** — purge khoá hàng reader (`FOR UPDATE`) TRƯỚC các hàng bình luận; đường trả lời (`comments-admin-reply.ts` → `notifications.ts`; đường công khai `comments-posting.ts` cùng thứ tự) khoá S bình luận cha khi chèn phản hồi, rồi S hàng reader qua FK của `reader_notifications` — ngược thứ tự: purge ‖ trả lời 30/30 lỗi 1213, purge trả 500 (base 0/30).
- **H2** — `banReader` đếm bình luận bằng `countReaderCommentImpact` qua `getDb()` — một kết nối THỨ HAI — trong lúc giữ kết nối của transaction. Pool `connectionLimit: 10`, chờ không hạn: 10 lượt chặn 10 người đọc khác nhau → 0/10 xong, mọi SELECT khác của ứng dụng treo, 10 hàng reader bị khoá X tới khi khởi động lại. Purge mắc đúng mẫu này **từ base** (`deleteReaderComments` đếm trên pool; base treo ở N = 12), vòng 2 mở rộng sang chặn.
- Ngoài ra: chặn / purge không kiểm hàng (tài khoản bị xoá khi đang chờ khoá → 200 và audit cho tài khoản không còn — D1/D2, cả base); xoá tài khoản đếm ngoài transaction (chặn ‖ xoá nhận 4 cho 2 — X1/D3, cả base); UI không làm mới sau 404/409 ở trang chặn IP và trang người đọc.

**Hai thứ tự khoá cùng tồn tại** và không thể chọn một cho mọi thao tác: trả lời / đăng bình luận khoá *bình luận → reader*; xoá do retention (`data-retention.ts`, ngoài phạm vi) và FK cascade khi xoá tài khoản khoá *reader → bình luận*; chặn của base cũng *reader → bình luận* (nên chặn ‖ trả lời đã deadlock từ base, X4). Cách xử lý, theo từng thao tác:
- **Đếm trên chính transaction** (H2, cả gốc từ base): `countImpact` / `countReaderCommentImpact` / `deleteReaderComments` nhận executor; trong transaction, hàng bình luận của người đọc đọc TRƯỚC, dưới `FOR UPDATE` (số đếm là đúng cái transaction này sẽ xoá — drizzle mở transaction bằng `begin`, không `CONSISTENT SNAPSHOT`, nên không dựa vào thời điểm snapshot); hàng phản hồi đọc thường sau đó (không phản hồi mới nào chèn được dưới hàng cha đang khoá X).
- **Purge**: chỉ khoá bình luận như base, không bao giờ hàng reader (H1); đọc thường hàng reader sau khoá — mất → 404, không audit (D2).
- **Chặn**: thứ tự của base — `UPDATE` hàng reader (`readAffectedRows`: 0 → 404, không audit — D1), rồi đếm trên tx, rồi xoá bình luận. Không đổi sang bình luận-trước: sẽ deadlock với retention và với xoá tài khoản (hai kịch bản base không có).
- **Xoá tài khoản**: `FOR UPDATE` hàng reader, đếm bình luận trên tx dưới `FOR UPDATE` (thao tác đi trước không bị đếm lại — X1/D3), `DELETE` đếm hàng.
- **Chặn / xoá tài khoản ‖ trả lời** là chu trình có sẵn: bọc trong `withDeadlockRetry` (`server/utils/deadlock-retry.ts` — chỉ 1213, tối đa 3 lần, jitter 5–25 ms; cùng quy tắc với retry của `analytics-ingestion.ts`, có bản `isDeadlock` riêng — gộp là việc R7). InnoDB rollback nạn nhân trọn vẹn nên chạy lại an toàn; phía trả lời vẫn có thể là nạn nhân như ở base.
- UI: `ip-bans.vue` đọc lại danh sách khi thêm bị 409 / gỡ bị 404; `readers/[id].vue` về danh sách khi xoá tài khoản bị 404.

**Phát lại độc lập trên MySQL 8.0.46** — bộ script của verifier (`race.ts`, `race.sh`) chép sang `/home/ray/orca/cdht-wave3-tests-r6-proof/race2/` (chỉ đổi thư mục và tiền tố CSDL `cdkt_r6c_*`; thêm chế độ `extra` cho các cặp mà thứ tự khoá mới tạo ra và D2b lái trên hàng bình luận; `race-all.sh` chạy mọi chế độ). Mỗi chạy một CSDL tạm, xoá ngay; sau mọi lần chạy `innodb_trx` toàn máy = 0, không còn CSDL `cdkt_r6*`. Base = worktree `52d7b527`; HEAD vòng 2 = `10405d54` (số của verifier); sau = cây `652a44ea`.

| Kịch bản (30 vòng, D: 5 vòng lái) | Base `52d7b527` | HEAD vòng 2 (verifier) | Sau vòng 3 |
|---|---|---|---|
| S1 bỏ chặn ×2 | 2 audit | 1 audit | 1 audit |
| S2 chặn ×2 (2 bình luận) | nhận 4, tokenVersion 1 | nhận 2, tv 2 | nhận 2, tv 2 |
| S3 xoá tài khoản ×2 | 200+200, 2 audit, nhận 4 | 200+404, 1, nhận 2 | 200+404, 1, nhận 2 |
| S4 purge ×2 | nhận 4 | nhận 2 | nhận 2 |
| S5 gỡ IP ×2 / S6 thêm IP ×2 | 2 audit / 201+500 (1062) | 1 / 201+409 | 1 / 201+409 |
| X1 chặn ‖ xoá | nhận 4 | nhận 4 | nhận 2 (chặn đến sau → 404, không audit) |
| X2 purge ‖ chặn | nhận 4 | nhận 2 | nhận 2 |
| X4 chặn ‖ trả lời | **27/30 lỗi 1213** | 30/30 | **0/30** (thử lại) |
| X5 purge ‖ trả lời | 0 | **30/30 lỗi 1213** (H1) | **0** |
| X6 xoá ‖ 3 lần chạm phiên | 0 | 0 | 0 |
| X7 chặn ‖ retention | 0 lỗi, audit chặn cho tài khoản đã mất | như base | 0 lỗi, chặn → 404 không audit |
| X8 xoá ‖ purge (mới) | nhận 4 | — | nhận 2 |
| X9 xoá ‖ trả lời (mới) | **30/30 lỗi 1213** | — | **0/30** (thử lại) |
| X10 purge ‖ retention (mới) | 0 lỗi | — | 0 lỗi (purge → 404 khi retention đi trước) |
| D1 chặn, tài khoản xoá khi chờ | audit cho tài khoản đã mất 5/5 | 5/5 | 404, 0 audit |
| D2 (lái trên hàng reader) | purge không bị chặn (blocked=false), audit hợp lệ (purge xong trước khi xoá) | — | như base: purge không khoá reader nên không chờ — tiền đề của kịch bản không còn |
| D2b purge chờ trên hàng bình luận (mới) | audit nhận 2 cho tài khoản đã mất 5/5 | — | 404, 0 audit 5/5 |
| D3 chặn rồi xoá | nhận 2 + 2 | 2 + 2 | 2 + 0 |
| D4 purge ‖ trả lời (lái) | 0 lỗi | **5/5 lỗi 1213** | 0 (15/15 ở ba lần lặp; một lần chạy đầu có 1/5 trả lời lỗi 1452 — purge xoá bình luận cha trước khi trả lời kịp chèn, đúng nghĩa, không tái hiện ở 3 lần lặp) |
| D5 chặn ‖ trả lời (lái) | 1/20 lỗi 1213 qua bốn lần chạy (verifier 1/5; một lần dò đơn trên CSDL mới 1/1) | 5/5 | **0/5** (thử lại) |
| pool chặn N=10 / 12 | xong / xong | **TREO / TREO** | xong / xong; SELECT khác 3 ms |
| pool purge N=10 / 12 | xong (verifier: TREO) / **TREO** | TREO / — | xong / xong; SELECT khác 2 ms |

Log: `race2/mysql-base-*.log`, `race2/mysql-new2-*.log` (`new1` = trước khi thêm thử lại: X4 30/30, X9 30/30, D5 5/5 — còn ngang base, chưa tốt hơn). Không còn kịch bản nào tệ hơn base: deadlock = 0 ở mọi kịch bản (kể cả những kịch bản base > 0), pool không treo ở N = 12, số audit và số bình luận được nhận đúng.

**Giới hạn của harness SQLite** (`_sqlite-mysql-db.ts`, cùng loại "known SQLite-vs-MySQL test gap" của `docs/decisions/realm-safety.md` cho MFA): một kết nối, không khoá hàng, không pool — nên không thấy deadlock, chờ khoá hay treo pool, và một test "khoá nhầm hàng" (đột biến N19/N20 của verifier) xanh nếu chỉ nhìn kết quả. Harness nay ghim những gì nó thấy được: thứ tự câu lệnh trong transaction (`txStatements` — purge mở đầu bằng `FOR UPDATE` trên `article_comments`, không khoá `reader_accounts`; chặn/xoá: hàng reader trước), và **ném khi có `select` trên pool lúc transaction đang mở** (bắt cả lời gọi gián tiếp; trong 44 suite dùng harness chỉ suite người đọc đỏ). Guard tĩnh bổ sung: `tests/transaction-pool-read-guard.test.ts`. Phần còn lại là phát lại MySQL ở trên. Không thêm suite `*-integration` mới cho các kịch bản này: nó đổi ma trận CI 17 job, khối facts của CLAUDE.md ("Mười bảy suite") và các guard `ci-*`, trong khi kịch bản cần nhiều kết nối được lái và đọc `information_schema`/`performance_schema` — script phát lại nằm ở thư mục bằng chứng và được mô tả ở đây.

Test vòng 3 (đỏ trên `10405d54`, xanh sau sửa): 6 test mới trong `reader-moderation-behavior` (thứ tự khoá ×2, H2, D1, D2, X1/D3) + 1 test thử lại nạn nhân deadlock, 4 test chặn/purge cũ đỏ vì guard pool của harness, `transaction-pool-read-guard` (tĩnh), `deadlock-retry` (4 test), 3 test UI (`r3-readers-on-10405d54.log`, `r3-ui-on-10405d54.log`). Đột biến vòng 3 (`mutants-r3.list` / `.log`): 21 chạy, 21 chết (18 phép đột biến, ba cái chạy trên hai suite) — kể cả N19 (purge khoá hàng reader) và N20 (chặn khoá bình luận trước), đếm trên pool ở chặn / xoá / helper, bỏ `FOR UPDATE` khi đếm, bỏ kiểm hàng ở chặn / purge / xoá, bỏ thử lại, thử lại cả 1205, thử lại thêm một lần, ba chỗ UI.

**Số đo sau vòng 3** (`coverage-r3.log`, Node 24, cây `652a44ea` + tài liệu): 790 tệp, 179 chưa nạp, **86,59 %** (77 486 / 89 487). `server/api` giữ 74,549 (mốc 74,54), `server/services` 89,893 (mốc giữ 89,89; `comments-deletion.ts` 100 %, `readers.ts` 83,1 %), `server/utils` 95,194 (mốc 95,18 → **95,19**; `deadlock-retry.ts` 100 %). Unit + ratchet (`npm test`, Node 26): 7 265 test, 0 đỏ, 54 bỏ qua ở `TZ=Asia/Ho_Chi_Minh` (`unit-full-r3-vn.log`) và `TZ=UTC` (`unit-full-r3-utc.log`).

### Cần chủ dự án quyết (lát này không đổi)

- **Dịch toàn cục không có trần chi phí**: `articlesLimit: 0` ("Tất cả bài viết") = mọi bài đã xuất bản × mọi ngôn ngữ, mỗi bài một lượt worker (nhiều lượt gọi), chỉ cần `settings.update`. Giữ nguyên vì là nút của tab.
- **Chặn lại một tài khoản đã bị chặn** ghi đè `banned_by`/`banned_at`/`ban_reason` của lần chặn đầu (dấu vết gốc chỉ còn trong `activity_logs`) và tăng `tokenVersion` lần nữa — giữ 200 hay đổi thành 409?
- **Chặn dải `/0`** (`0.0.0.0/0`, `1.2.3.4/0`) được nhận: chặn mọi người đọc IPv4 ở cả đăng nhập lẫn bình luận.
- **`viewDay` là ngày UTC** cho cả lượt xem thật lẫn hàng `boost` của `article_view_daily`: biểu đồ "theo ngày" của bài xếp lượt xem 00:00–07:00 giờ VN vào hôm trước (cùng loại R5-4). Đổi sẽ lệch lịch sử và token chống F5.
- **`chatbot/settings/clear`** chỉ xoá khoá trong `chatbot_settings`, còn đường gọi chatbot qua cổng AI dùng khoá của `ai_providers` — sau khi "xoá", trang vẫn báo có khoá nếu nhà cung cấp có khoá. Route không có nơi gọi trong `app/`: ứng viên gỡ bỏ.
- **`languages/ai-translate.post.ts`** (dịch hết khoá thiếu trong một yêu cầu) không có nơi gọi trong `app/` (trang dùng `ai-translate-chunk`) và tính tiền vào `translation_article` thay vì `translation_ui` như hai route anh em: ứng viên gỡ bỏ.

### Ghi nhận, không sửa (khuôn dùng chung hoặc ngoài phạm vi)

- 22 handler đọc id bằng `Number.isFinite(id) || id <= 0` rồi `Math.floor`: `/readers/1.5/ban` tác động lên người đọc 1. Khuôn của cả dự án — sửa một lượt, không vá từng tệp.
- `createIpBan` kiểm trùng rồi mới chèn: hai yêu cầu cùng địa chỉ đồng thời → `ER_DUP_ENTRY` (500) thay vì 409. `banReader` đếm tác động ngoài transaction: bình luận đăng chen giữa bị xoá mà không vào số của audit.
- `state.error` của job dịch toàn cục là thông điệp Drizzle ("Failed query: <SQL> params: …") — người có `settings.read` thấy câu SQL.
- Prompt của dịch khối (`universal-translation-blocks.ts`) và nhãn giao diện vẫn dán nội dung cán bộ viết không qua `fenceUntrustedContent` (đã ghi ở R5; giữ nguyên từng chữ prompt khi tách tệp).

### Quyền (chỉ báo cáo, không đổi) — đường chi tiền AI không có cờ kiểu `canTest`

- `system/universal-translate.post.ts` — `settings.update`; trần chi phí: không (ở trên).
- `languages/ai-translate.post.ts`, `ai-translate-chunk.post.ts`, `ai-translate-key.post.ts` — `settings.update`.
- `categories/index.post.ts`, `categories/[id].put.ts`, `content-types/index.post.ts`, `content-types/[id].put.ts` — `categories.create/update`; dịch AI chạy nền (`i18n-auto-translate.ts`) sang mọi ngôn ngữ đang bật mỗi lần tạo/sửa.
- `articles/[id]/translations/translate.post.ts`, `translate-all.post.ts`, `articles/bulk-translate.post.ts` — `news.update` **cố định**, không theo loại của bài (người có `news.update` kích được dịch AI cho bài `document`) — cùng họ khoảng trống phạm vi loại bài của rà soát 2026-10-22; chưa có test (0 %), việc của R7.
- Từ R5: `comments.read` (kiểm duyệt AI), `news.read` (dịch, biên tập), `settings.read` (dịch giao diện).

### Lát sau (theo thứ tự xếp hạng)

1. Hai handler 0 % lớn còn lại: `ai/moderation/queue/[id]/resolve.post.ts` (108) — họ moderation, dùng `_moderation-worker-family.ts`; `chatbot/sessions/[id].get.ts` (89) — `RIGHT(REGEXP_REPLACE(…))` cần đăng ký hàm cho SQLite (`DatabaseSync#function`) hoặc phát lại trên MySQL; rồi `chatbot/knowledge/template.get.ts` (70), `media-portal/youtube-meta.post.ts` (67), `categories/[id].put.ts` (60), `media/index.get.ts` (60).
2. Phạm vi loại bài của ba route dịch bài (mục "Quyền" ở trên) — test + sửa theo `articleActionScope`/`requireReadableArticle`.
3. LIKE chưa thoát còn lại: `articles/index.get.ts`, `export-csv.get.ts` (ô tìm), `media/index.get.ts`, `services/chatbot-knowledge.ts`.
4. Các mục "cần chủ dự án quyết" ở trên, và hai mục còn chờ của R5 (chi phí Delify đếm hai lần; kết quả AI không đọc được ở `comments/ai-moderate` cần `app/**`).
5. `services/view-boost-scheduler.ts` (55,3 %), `getArticleViewStats` trong `article-views.ts`.
