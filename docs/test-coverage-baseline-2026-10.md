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
   - Tệp chưa nạp được tính bằng **số dòng có mã**: không trống, không chỉ là chú thích. Đếm bằng một bộ quét nhỏ trong script. Đối chiếu với trình phân tích của TypeScript trên cả 660 tệp: lệch 0,013 % tổng số (54 046 so với 54 039 dòng), chỉ 2 tệp khác, đều là tệp nhiều regex.
3. **In** tổng chung và theo thư mục cho "mọi tệp" lẫn "chỉ tệp đã nạp", cùng danh sách tệp chưa nạp và các tệp đã nạp ít được phủ nhất.

**Phép gần đúng, nói rõ.**
- Với tệp đã nạp, Node đếm **mọi** dòng vật lý. Dòng trống và chú thích được tính là đã chạy khi khối mã chứa nó chạy (đã kiểm trên 22.23, 24.21 và 26.11). Với tệp chưa nạp, chỉ dòng có mã được tính. Nên chú thích giúp tỉ lệ của tệp đã nạp, nhưng không kéo tệp chưa nạp xuống.
- Nếu tính mọi dòng vật lý cho cả tệp chưa nạp, cùng lượt đo ra 64,48 % (51 765 / 80 278) thay vì 70,55 %.
- Cờ `--test-coverage-include-all` của Node 26 lại dùng quy tắc thứ ba (bỏ dòng chỉ có kiểu, giữ dòng trống). Cờ đó không có trên Node 24.21/22.23, và khi đi cùng `mock.module` nó còn sinh bản ghi lệch. Nên script không dùng nó.
- Hàm và nhánh của tệp chưa nạp thì không biết được (Node không phân tích tệp đó), nên hai cột này chỉ nói về tệp đã nạp.

**`--test-coverage-exclude='tests/**'` là cần thiết.** Mặc định Node coi tệp tên `test-*.ts` là tệp test và loại khỏi coverage. Vì thế các handler thật `server/api/admin/settings/test-r2.post.ts` và `test-email.post.ts` mất khỏi báo cáo, dù có test chạy chúng (đã tái hiện trên 24.21 và 26.11). Truyền `--test-coverage-exclude` thì Node bỏ quy tắc mặc định.

### Kết quả (Node 24.21 — bản CI, `TZ=Asia/Ho_Chi_Minh`, đo trên `wave1/integration` `a7be585` + 2F)

`npm test`: 4292 test, 4260 pass, 0 fail, 32 skip. Node 26.11 cho đúng các số này (cùng 70,55 % dòng, cùng 296 tệp chưa nạp).
Node 22.23 chạy được lệnh và script, nhưng số hơi khác: 70,41 %, 288 tệp chưa nạp. Lý do: nó gán một phần lượt nạp qua `mock.module` cho chính tệp đó. Thêm nữa, trên Node 22 vốn có 19 test đỏ và 4 test bị huỷ: `backup-run-endpoint`, `backup-scheduler-due`, `article-view-ip-ceiling`, `chatbot-outbound-stream` đỏ, `thumbnail-on-demand-bounds` bị huỷ. Cả hai đều xảy ra y hệt ở `a7be585` chưa có thay đổi của 2F. Vì có test đỏ, `npm run test:coverage` dừng trước bước tóm tắt. Mức nền vì vậy lấy theo Node 24 (bản CI).

| Thư mục | Tệp | Chưa từng nạp | Dòng, mọi tệp | Dòng, tệp đã nạp | Hàm | Nhánh |
|---|---|---|---|---|---|---|
| **Tất cả** | 660 | 296 | **70,55 %** (51 765 / 73 369) | 87,10 % | 80,77 % | 80,90 % |
| `server/` | 570 | 268 | 69,15 % | 85,83 % | 79,67 % | 80,09 % |
| `server/api/` | 332 | 224 | 45,23 % | 84,48 % | 73,05 % | 64,08 % |
| `server/services/` | 85 | 18 | 73,12 % | 82,71 % | 79,27 % | 80,58 % |
| `server/utils/` | 122 | 6 | 89,50 % | 91,79 % | 88,44 % | 86,65 % |
| `server/db/` (trừ `schema-tables/`) | 4 | 1 | 63,30 % | 74,61 % | 36,97 % | 95,92 % |
| `server/plugins/` | 16 | 11 | 36,39 % | 100,00 % | 100,00 % | 85,19 % |
| `server/middleware/` | 5 | 4 | 72,91 % | 100,00 % | 100,00 % | 88,24 % |
| `server/routes/` | 4 | 4 | 0,00 % | — | — | — |
| `server/data/` | 2 | 0 | 100,00 % | 100,00 % | — | 100,00 % |
| `shared/` | 3 | 0 | 100,00 % | 100,00 % | 100,00 % | 98,46 % |
| `app/utils/` | 52 | 8 | 93,32 % | 97,43 % | 94,14 % | 88,98 % |
| `app/composables/` | 35 | 20 | 59,89 % | 87,43 % | 75,89 % | 74,74 % |

- Cột "Dòng, tệp đã nạp" là cách đếm của mức nền 74,80 %, nay có gộp bản ghi và có hai handler `test-*.ts`. Sự chênh giữa hai cột dòng nằm phần lớn ở `server/api/`: handler được Nitro nạp lúc chạy app, còn bộ unit chỉ nạp những handler có test hành vi.
- Trên `694bb6e` (trước khi có 1A/1C), cùng cách đo cho ra 68,25 % (652 tệp, 312 chưa nạp). Phần tăng đến từ test mới của 1A/1C.
- Bước CI (chỉ các tệp test không phải integration, đã chạy thử đúng lệnh của CI trên Node 24.21): **70,55 %**, 297 tệp chưa nạp. Tệp chênh là `server/services/media-processing-queue.ts`, mà ở lượt `npm run` chỉ được nạp qua import cấp đầu tệp của một suite integration (suite đó tự bỏ qua khi không có MySQL).

### Cách đọc cho đúng
- Bảng mà Node in ở cuối log (khi dùng reporter `spec`) vẫn chỉ đếm tệp đã nạp, và không gộp bản ghi trùng. Con số để trích là bảng của script.
- Tệp chỉ khai báo kiểu vẫn bị tính 0 %, dù không có mã chạy: `app/utils/blocks/types.ts`, `app/utils/public-types.ts`, `app/utils/docs/types.ts`.
- Module chỉ được kiểm bằng suite integration cũng bị tính 0 % ở đây. Ví dụ: `server/services/submission-workflow.ts` (`tests/submission-workflow-integration.test.ts`).
- Tệp mà test chỉ thay bằng `mock.module` (không bao giờ chạy mã thật) bị tính là chưa nạp. Đó là đúng. Ví dụ: `server/utils/mfa/reauth.ts`, `server/utils/chatbot/chat.ts`, `server/services/categories.ts`.

### Chưa từng được nạp bởi bộ unit (danh sách việc, 2026-10-24)
Danh sách đầy đủ (296 tệp, kèm số dòng có mã) nằm trong mục *files no test loads* của output script. Những thư mục đáng làm trước:
- `server/services/` (18): `articles-thumbnail-scan.ts`, `backup-drive-oauth-config.ts`, `backup-drive-oauth.ts`, `backup-drive.ts`, `categories.ts`, `content-types.ts`, `google-oauth-settings.ts`, `i18n-auto-translate.ts`, `languages.ts`, `layout-settings.ts`, `media-repair.ts`, `media-repoint.ts`, `media-scan.ts`, `pages.ts`, `social-links.ts`, `submission-workflow.ts`, `submissions.ts`, `universal-translation.ts`.
- `server/utils/` (6): `backup-drive-oauth-crypto.ts`, `chatbot/chat.ts`, `chatbot/session-db.ts`, `html-to-markdown.ts`, `legacy-urls.ts`, `mfa/reauth.ts`.
- `server/db/` (1): `seed.ts`. Nó tự chạy khi được import; suite nâng cấp chạy nó như một tiến trình riêng.
- `app/composables/` (20): `useAdminAuth`, `useBackupSettings`, `useBrokenImageFallback`, `useBulkSelection`, `useHlsVideo`, `useI18n`, `useImagePicker`, `useLayoutConfig`, `useLayoutNav`, `useLiveSearch`, `useMobileMenu`, `usePagePreview`, `usePlyrPlayer`, `useReaderAuth`, `useReaderMenu`, `useReaderNotifications`, `useReadingHistory`, `useSiteSettings`, `useToast`, `useUpload`.
- `app/utils/` (8): `ai-service-labels.ts`, `backup-format.ts`, `blocks/types.ts`, `docs/types.ts`, `formatDate.ts`, `language-flags.ts`, `media-duration.ts`, `public-types.ts`.

Chưa có ngưỡng. Ngưỡng là việc của Wave 3, và đặt trên các số của script.

## Cách dùng
- Cục bộ: `npm run test:coverage`. Bảng của script in ở cuối log; lcov ở `node_modules/.cache/cdkt-coverage/lcov.info`. Các cờ và script chạy được trên Node 22, 24 và 26. Một test đỏ thì dừng trước bước tóm tắt (`&&`).
- CI: mở một lần chạy → *Summary* → mục **Test coverage**.
- Khi viết test hành vi mới cho một file trong danh sách trên, chạy lại và cập nhật bảng này nếu muốn ghi mốc mới.
- Đặt ngưỡng (nếu sau này cần): theo thư mục (`server/utils`, `server/services`) và chỉ sau vài tuần nhìn thấy mức dao động thật.
