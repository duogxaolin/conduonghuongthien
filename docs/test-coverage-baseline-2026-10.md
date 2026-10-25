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

## Cách dùng
- Cục bộ: `npm run test:coverage`. Bảng của script in ở cuối log; lcov ở `node_modules/.cache/cdkt-coverage/lcov.info`; sau đó là ratchet. Các cờ và script chạy được trên Node 22, 24 và 26. Một test đỏ thì dừng trước bước tóm tắt (`&&`).
- CI: mở một lần chạy → *Summary* → mục **Test coverage** và **Coverage ratchet**.
- Khi viết test hành vi mới cho một file trong danh sách trên, chạy lại và nâng mức nền bằng `--update` trong cùng PR.
