# Báo cáo đánh giá codebase — 19/09/2026

**Trạng thái tại thời điểm lập báo cáo: cần khắc phục trước khi nghiệm thu Media Portal hoặc coi hệ thống sẵn sàng production.** Nền tảng có cấu trúc và bộ kiểm tra đáng giữ lại, nhưng còn lỗi phân quyền/MFA, thiếu luồng giao diện, lỗi xử lý đồng thời, và khoảng trống vận hành có thể gây mất hoặc tích tụ dữ liệu.

Đây là đường cơ sở **trước sửa lỗi**. Tất cả mục bắt đầu ở trạng thái `OPEN`; chỉ chuyển `VERIFIED` khi có bằng chứng đáp ứng tiêu chí nghiệm thu. Việc tạo báo cáo không đồng nghĩa đã sửa các vấn đề.

## 1. Phạm vi, nguồn bằng chứng và giới hạn

Báo cáo tổng hợp kết quả rà soát đã thực hiện trên working tree hiện tại: kiến trúc, auth/RBAC/MFA, API, schema/retention, các luồng Media/Livestream và deployment. Đối chiếu [kế hoạch Media Portal gốc](../openspec/media-portal-plan.md) và [checklist triển khai](../openspec/changes/add-media-portal/tasks.md). Working tree có nhiều thay đổi chưa commit; báo cáo không đại diện cho riêng một commit hoặc bản production đang chạy.

Không khẳng định đã đọc từng dòng của toàn bộ repository. Lần rà soát này **chưa chạy lại browser E2E và các bài tích hợp với MySQL thật**. Các ghi nhận tích hợp trong OpenSpec là bằng chứng lịch sử của người triển khai, không được coi là lần chạy lại của đợt audit. Những probe dùng DB/runner giả lập và probe dùng H3 thật được phân biệt bên dưới. Không suy diễn rằng mọi cảnh báo dependency đều khai thác được qua ứng dụng.

Khả năng kiểm chứng tiếp: điều phối viên đã xác nhận Docker 29.8.0 và `/usr/bin/ffmpeg` có sẵn. MySQL chưa lắng nghe tại host port 3306, nhưng có thể dựng container cô lập; phần tích hợp DB là **chưa chạy lại**, không phải bị chặn vĩnh viễn do thiếu môi trường.

Các liên kết là đường dẫn tương đối tới file; vị trí dòng trong bản review trước có thể thay đổi khi sửa. Kết quả baseline dưới đây được chuyển từ lần rà soát trước, không phải các lệnh vừa được chạy lại khi viết báo cáo.

| Kiểm tra | Baseline trước sửa | Ý nghĩa và giới hạn |
| --- | --- | --- |
| Typecheck | Qua | Không phát hiện lỗi kiểu trong lần chạy; không chứng minh đúng phân quyền/hành vi |
| Production build | Qua, có cảnh báo trùng auto-import | Có thể tạo build; vẫn còn nợ cấu hình/import |
| Schema drift | 46 bảng, 451 cột, không phát hiện lệch | Các schema được đối chiếu khớp; không chứng minh đầy đủ mọi invariant dữ liệu |
| Test lần đầu | Một test manifest lỗi: 16 vòng trong 250 ms | Phụ thuộc tốc độ máy; xem TECH-02 |
| Test chạy lại | 1.920 test: 1.910 pass, 10 skip | Không có fail trong lần chạy lại; cần xem riêng phạm vi bị skip |
| Dependency audit | 4 gói bị ảnh hưởng: 3 high, 1 moderate | Xem TECH-03; chưa xác nhận reachability |

## 2. Đánh giá kiến trúc hiện tại

Ứng dụng dùng **Nuxt 4 / Vue 3**, server **Nitro / H3**, lớp dữ liệu **Drizzle / MySQL**. Phân tách page/component, HTTP endpoint, service và utility giúp tìm nơi đặt nghiệp vụ tương đối rõ. Tuy nhiên, các hợp đồng giữa tầng giao diện, route, service và tác vụ nền chưa được kiểm chứng xuyên suốt.

### Điểm mạnh nên giữ

- Schema và migration có công cụ phát hiện drift; baseline khớp 46 bảng/451 cột.
- Bình luận dùng chung có ràng buộc XOR giữa đối tượng bài viết và Media, giảm nguy cơ bản ghi thuộc nhiều loại nội dung cùng lúc.
- Public serializer chọn trường rõ ràng, thumbnail được phục vụ qua cùng origin, và quyền sở hữu upload có kiểm tra phía server.
- Có nền tảng RBAC, MFA, audit, retention, named lock, heartbeat và reaper; đây là các cơ chế phù hợp nhưng một số invariant chưa được thực thi đủ chặt.
- Bộ test lớn cùng typecheck/build tạo nền cho sửa lỗi có kiểm soát. Cần giữ các kiểm tra này và bổ sung đúng những khoảng trống hành vi.

### Điểm yếu mang tính hệ thống

- **Validation và authorization chưa dùng cùng một biểu diễn dữ liệu:** kiểm boolean nghiêm ngặt ở guard nhưng ép kiểu khi ghi DB; metadata từ client có thể ghi đè danh tính server.
- **Danh mục quyền bị lặp ở nhiều nơi:** UI không thể hiện đủ resource/action trong khi API thay toàn bộ quyền, dẫn tới mất dữ liệu khi lưu.
- **MFA chưa fail-closed khi cấu hình hoặc giải mã lỗi:** lỗi hạ tầng có thể bị hiểu thành tài khoản chưa bật MFA.
- **Trạng thái tác vụ nền chưa có quyền sở hữu nguyên tử:** lock ngắn hạn không đủ bảo vệ toàn bộ vòng đời chuyển mã; reaper thiếu bước thực sự chạy lại công việc.
- **Quản lý tài nguyên chưa khép kín:** bộ đếm SSE chưa đo socket backlog, upload/file xóa thiếu lịch dọn, backup chưa bao phủ media volume.
- **Độ hoàn thiện bị đánh giá ở từng lớp thay vì hành trình người dùng:** có API/component nhưng thiếu route hoặc nơi mount; test source structure và checklist xanh vẫn bỏ lọt luồng không dùng được.

Không cần viết lại toàn bộ kiến trúc để xử lý những điểm này. Cần sửa invariant tại nơi sở hữu dữ liệu, hoàn thiện hợp đồng giữa các lớp, rồi kiểm chứng luồng thật.

## 3. Tiêu chí ưu tiên

- **P1:** xử lý trước nghiệm thu/production vì ảnh hưởng phân quyền, bảo vệ tài khoản, chức năng chính, tính toàn vẹn hoặc khả năng khôi phục dữ liệu.
- **P2:** xử lý trong đợt khắc phục này vì gây sai hành vi, suy giảm độ tin cậy hoặc vận hành thủ công.
- **P3:** nợ chất lượng cần đóng với bằng chứng rõ ràng, không được dùng để che khuất P1/P2.

## 4. Các phát hiện cần sửa

### AUD-01 — Cấp quyền vượt mức qua JSON sai kiểu

**Mức độ: P1 · Trạng thái: OPEN**

- **Kích hoạt:** tài khoản có `roles:update` gửi giá trị như `"true"`, `1` hoặc `"false"` vào cờ quyền.
- **Nguyên nhân:** guard chỉ kiểm `canUpdate === true`, trong khi endpoint dùng `Boolean(canUpdate)` lúc lưu. Giá trị không phải boolean có thể vượt guard rồi được lưu thành `true`.
- **Tác động:** có thể cấp quyền mà chính người thao tác không sở hữu.
- **Bằng chứng:** đã tái hiện bằng hàm guard thật; [permissions.ts](../server/utils/permissions.ts), [roles/[id].put.ts](../server/api/admin/roles/[id].put.ts).
- **Hướng sửa:** validate payload boolean nghiêm ngặt; guard và write dùng cùng dữ liệu đã validate; áp dụng cho mọi cờ hành động liên quan.
- **Nghiệm thu:** chuỗi/số/object/null sai hợp đồng bị từ chối; người không có quyền không cấp được quyền đó; boolean hợp lệ lưu đúng; request bị từ chối không thay đổi quyền/audit thành công.

### AUD-02 — Bỏ qua MFA khi không giải mã được TOTP

**Mức độ: P1 · Trạng thái: OPEN**

- **Kích hoạt:** xoay `JWT_SECRET` hoặc restore bằng key khác làm TOTP active không giải mã được.
- **Nguyên nhân:** factor lỗi bị loại khỏi danh sách usable; danh sách rỗng bị hiểu là không bật MFA, nên login cấp phiên chỉ bằng mật khẩu.
- **Tác động:** lỗi key/cấu hình làm giảm bảo vệ tài khoản.
- **Bằng chứng:** [mfa/factors.ts](../server/utils/mfa/factors.ts), [auth/login.post.ts](../server/api/admin/auth/login.post.ts).
- **Hướng sửa:** phân biệt không đăng ký MFA với MFA đang active nhưng hỏng; giữ yêu cầu yếu tố thứ hai và cung cấp đường khôi phục hiện có phù hợp.
- **Nghiệm thu:** TOTP active không giải mã được không tạo phiên chỉ bằng mật khẩu; factor/recovery hợp lệ vẫn dùng được theo chính sách; tài khoản chưa bật MFA giữ hành vi đúng; lỗi không lộ secret.

### AUD-03 — Lưu phân quyền làm mất resource/action không có trên UI

**Mức độ: P1 · Trạng thái: OPEN**

- **Kích hoạt:** mở một role có quyền mới rồi lưu bằng trang quản trị hiện tại.
- **Nguyên nhân:** UI chỉ khai 11 resource cũ, thiếu `media_portal`, `livestream`, `comments`, `readers`, `pages`, `analytics`…; API xóa toàn bộ quyền rồi chèn payload. Các cờ `canPublish`, `canArchive`, `canTest` cũng chưa được giữ đầy đủ.
- **Tác động:** mất quyền đã cấp và không có cách cấu hình Media/Livestream đầy đủ từ UI.
- **Bằng chứng:** [users/roles.vue](../app/pages/admin/users/roles.vue), [roles/[id].put.ts](../server/api/admin/roles/[id].put.ts).
- **Hướng sửa:** thống nhất danh mục resource/action và hợp đồng cập nhật; tránh thay toàn bộ bằng một biểu mẫu chỉ biết một phần dữ liệu.
- **Nghiệm thu:** tải/lưu role không sửa gì bảo toàn toàn bộ quyền; sửa một quyền không làm mất quyền khác; UI quản lý được Media/Livestream và các action hợp lệ; backend vẫn ngăn escalation.

### AUD-04 — API đọc bài viết không kiểm quyền theo loại nội dung

**Mức độ: P1 · Trạng thái: OPEN**

- **Kích hoạt:** người chỉ có `news:read` đọc danh sách/chi tiết chứa loại nội dung khác; hoặc người chỉ có quyền văn bản gọi API chung.
- **Nguyên nhân:** endpoint yêu cầu `news:read` cho mọi loại; query không giới hạn theo tập loại người dùng được phép đọc.
- **Tác động:** lộ nội dung thuộc loại không được cấp quyền, gồm bản nháp; đồng thời từ chối người dùng hợp lệ ở loại khác.
- **Bằng chứng:** [articles/index.get.ts](../server/api/admin/articles/index.get.ts), [articles/[id].get.ts](../server/api/admin/articles/[id].get.ts).
- **Hướng sửa:** ánh xạ loại nội dung sang resource; lọc danh sách/count theo quyền, kiểm chi tiết theo loại thực tế của bản ghi.
- **Nghiệm thu:** ma trận role × loại nội dung × draft/published đúng; filter client không mở rộng quyền; count/pagination không tiết lộ loại bị cấm; người chỉ có quyền loại khác đọc được đúng phần của mình.

### AUD-05 — Body sửa Media ghi đè ID và người ghi audit

**Mức độ: P1 · Trạng thái: OPEN**

- **Kích hoạt:** người có quyền sửa Media gửi `id` hoặc `actorId` trong JSON body.
- **Nguyên nhân:** endpoint đặt ID từ route/session trước, rồi spread toàn bộ body phía sau.
- **Tác động:** client có thể làm sai đối tượng thao tác hoặc giả danh người được ghi trong audit.
- **Bằng chứng:** [media-portal/[id].put.ts](../server/api/admin/media-portal/[id].put.ts).
- **Hướng sửa:** allowlist trường nội dung được sửa; route ID và actor luôn do server xác định.
- **Nghiệm thu:** body cố ghi đè `id`/`actorId` không thay đổi bản ghi ngoài route và không thay đổi danh tính audit; các trường cập nhật hợp lệ vẫn hoạt động; audit và write giữ tính nguyên tử.

### AUD-06 — Recovery code có thể được dùng hai lần đồng thời

**Mức độ: P2 · Trạng thái: OPEN**

- **Kích hoạt:** hai request cùng sử dụng một recovery code chưa dùng.
- **Nguyên nhân:** UPDATE có `used_at IS NULL` nhưng không kiểm số dòng cập nhật; request thua vẫn trả `ok:true`.
- **Tác động:** vi phạm tính dùng một lần của mã xác thực.
- **Bằng chứng:** hàm thật với DB giả lập `affectedRows:0` vẫn chấp nhận; [mfa/factors.ts](../server/utils/mfa/factors.ts).
- **Hướng sửa:** kết quả thành công phải phụ thuộc vào claim/consume nguyên tử đúng một dòng; rà cơ chế dùng một lần của TOTP/email OTP liên quan.
- **Nghiệm thu:** hai lần dùng đồng thời chỉ một thành công; zero affected rows thất bại; mã đã dùng không thể replay; xác nhận với DB thật khi có môi trường tích hợp.

### AUD-07 — Thiếu trang tạo/upload/sửa Media

**Mức độ: P1 · Trạng thái: OPEN**

- **Kích hoạt:** bấm các nút YouTube, upload hoặc sửa trên danh sách Media.
- **Nguyên nhân:** link trỏ tới `/admin/media-portal/external`, `/upload`, `/:id` nhưng chưa có page tương ứng; `ChunkedUploader.vue` chưa được mount.
- **Tác động:** cán bộ chưa thực hiện được hành trình quản lý video từ UI dù API tồn tại.
- **Bằng chứng:** [admin/media-portal/index.vue](../app/pages/admin/media-portal/index.vue), [ChunkedUploader.vue](../app/components/admin/ChunkedUploader.vue).
- **Hướng sửa:** hoàn thiện các page và nối API/component, quyền, validation, trạng thái upload/chuyển mã/lỗi.
- **Nghiệm thu:** browser đi được tạo YouTube → sửa → xuất bản → xem; upload → theo dõi/resume → ready → xuất bản; link không 404; quyền và upload-disabled được phản ánh đúng cả UI/server.

### AUD-08 — Livestream HLS nhận URL SSE chat

**Mức độ: P1 · Trạng thái: OPEN**

- **Kích hoạt:** chọn livestream tự lưu trữ/HLS.
- **Nguyên nhân:** API active gán `session.streamUrl` thành `/api/public/livestream/chat/stream`, trong khi `LiveHero` đưa trường đó vào player HLS; form admin còn thiếu `storagePath` bắt buộc ở service.
- **Tác động:** không tạo/phát đúng nhánh tự lưu trữ.
- **Bằng chứng:** [livestream/active.get.ts](../server/api/public/livestream/active.get.ts), [LiveHero.vue](../app/components/LiveHero.vue), [admin/livestream/index.vue](../app/pages/admin/livestream/index.vue), [livestream.ts](../server/services/livestream.ts).
- **Hướng sửa:** tách rõ URL media và URL chat; đồng bộ hợp đồng source giữa form/API/service/player.
- **Nghiệm thu:** tạo được phiên HLS bằng dữ liệu hợp lệ; player nhận manifest/segment hợp lệ, không nhận SSE; YouTube tiếp tục chạy; input storage không hợp lệ bị từ chối.

### AUD-09 — Claim chuyển mã không ngăn chạy trùng

**Mức độ: P1 · Trạng thái: OPEN**

- **Kích hoạt:** nhiều lời gọi `processMediaItem` cho cùng video khi một job đang chạy.
- **Nguyên nhân:** UPDATE claim theo ID không kiểm trạng thái/claim hiện tại; named lock nhả trước FFmpeg; token `hostname:pid` trùng giữa các job trong cùng tiến trình.
- **Tác động:** nhiều worker tranh ghi rendition/manifest, tăng tải CPU/RAM và làm sai trạng thái.
- **Bằng chứng:** gọi service thật với DB/runner giả lập cho thấy **2 lượt vào ffprobe** cho cùng item, kể cả khi trạng thái đang `processing`; [video-processing.ts](../server/services/video-processing.ts).
- **Hướng sửa:** claim nguyên tử, token riêng mỗi job, mọi heartbeat/finalize có điều kiện sở hữu; giới hạn tổng job chạy phù hợp tài nguyên.
- **Nghiệm thu:** concurrent claim chỉ một runner bắt đầu; worker mất claim không ghi đè kết quả; job khác bị giới hạn đúng mức; lỗi/crash không giữ claim vô hạn; DB connection không bị giữ suốt FFmpeg.

### AUD-10 — Giới hạn SSE không đo backlog socket

**Mức độ: P1 · Trạng thái: OPEN**

- **Kích hoạt:** client nhận rất chậm hoặc không drain trong khi server broadcast liên tục.
- **Nguyên nhân:** `MAX_PENDING` đếm promise `push()` chờ, không đếm byte/message tồn tại ở tầng socket.
- **Tác động:** khách chậm vẫn được giữ, buffer tăng ngoài giới hạn dự kiến.
- **Bằng chứng:** probe với **H3 đang cài thật**, response Writable không bao giờ drain: **300 message, 66.900 byte**, vẫn còn **1 stream được track**, dù `MAX_PENDING = 64`; [sse-manager.ts](../server/utils/sse-manager.ts). Đây là probe transport cục bộ, chưa phải tải nhiều client qua reverse proxy production.
- **Hướng sửa:** kiểm soát backpressure tới transport thật, giới hạn backlog đo được và đóng client vượt ngưỡng.
- **Nghiệm thu:** Writable không drain bị ngắt ở giới hạn hữu hạn; bộ nhớ không tăng theo vô hạn broadcast; client khỏe không bị chặn; cleanup gỡ stream/listener/timer; kiểm tra thêm qua HTTP/proxy.

### AUD-11 — Upload bỏ dở và file Media đã xóa không có vòng đời dọn đủ

**Mức độ: P1 · Trạng thái: OPEN**

- **Kích hoạt:** upload bị bỏ dở hoặc cán bộ xóa Media.
- **Nguyên nhân:** có `housekeepUploads()` nhưng chưa có caller định kỳ; xóa Media chỉ xóa DB và giữ file, chưa có job dọn tương ứng.
- **Tác động:** tăng dung lượng đĩa không giới hạn theo tuổi dữ liệu; có thể cản upload/chuyển mã hoặc vận hành ứng dụng.
- **Bằng chứng:** [chunked-upload.ts](../server/services/chunked-upload.ts), [media-portal.ts](../server/services/media-portal.ts).
- **Hướng sửa:** nối housekeeping vào scheduler; xóa asset sau commit với retry và ràng buộc đường dẫn/quyền sở hữu; bảo vệ upload/job đang chạy.
- **Nghiệm thu:** upload quá hạn được dọn tự động; dữ liệu còn hoạt động được giữ; DB rollback không xóa asset; lỗi filesystem có retry; job dọn idempotent và không xóa ngoài media root.

### AUD-12 — Nhận chunk đồng thời làm mất `receivedParts`

**Mức độ: P2 · Trạng thái: OPEN**

- **Kích hoạt:** hai chunk khác index tới cùng lúc cho cùng upload.
- **Nguyên nhân:** read-modify-write cả mảng `receivedParts` khiến request ghi sau đè trạng thái của request trước.
- **Tác động:** client/server tưởng thiếu chunk đã nhận, ảnh hưởng resume và complete.
- **Bằng chứng:** service thật với DB giả lập: cả hai request thành công, đĩa có `0.part` và `1.part`, DB chỉ còn **`[1]`**; [chunked-upload.ts](../server/services/chunked-upload.ts).
- **Hướng sửa:** đồng bộ nguyên tử trạng thái từng part, bằng transaction/lock đúng phạm vi hoặc bảng part với khóa duy nhất `(uploadId, index)`.
- **Nghiệm thu:** chunk song song giữ đủ tập index; gửi lại cùng index idempotent; complete không đua với ghi part; restart/resume phản ánh đúng dữ liệu; kiểm chứng race với DB thật.

### AUD-13 — Reaper đưa về pending nhưng chưa tự chạy lại

**Mức độ: P2 · Trạng thái: OPEN**

- **Kích hoạt:** tiến trình chết giữa chuyển mã hoặc lần khởi chạy gặp lock busy.
- **Nguyên nhân:** reaper đổi `processing → pending` nhưng chưa có worker tự lấy hàng pending. Kế hoạch gốc yêu cầu re-trigger pipeline.
- **Tác động:** video có thể chờ mãi, cần người can thiệp dù được mô tả là tự phục hồi.
- **Bằng chứng:** [media-processing-reaper.ts](../server/services/media-processing-reaper.ts), [kế hoạch gốc](../openspec/media-portal-plan.md).
- **Hướng sửa:** có cơ chế dispatch/retry pending tự động, dùng claim đã sửa ở AUD-09 và giới hạn tài nguyên.
- **Nghiệm thu:** job bị kill được reclaim rồi tự đi tới ready hoặc lỗi hữu hạn có chẩn đoán; busy được thử lại; không reclaim worker còn sống; không tạo job trùng; startup xử lý hàng pending còn sót.

### AUD-14 — Live chat và vòng đời phiên chưa nối đủ

**Mức độ: P2 · Trạng thái: OPEN**

- **Kích hoạt:** người dùng mở trang live; admin kiểm duyệt/dừng phiên; phiên bắt đầu hoặc kết thúc khi trang đã mở.
- **Nguyên nhân:** `LiveChat.vue` chưa được mount; trang kiểm duyệt chỉ hướng dẫn gọi API; stop chưa gọi `closeSessionStreams()`; `LiveHero` chỉ fetch khi mount.
- **Tác động:** thiếu UI chat/kiểm duyệt thực sự, stream không nhận kết thúc và giao diện dễ hiển thị trạng thái cũ.
- **Bằng chứng:** [LiveChat.vue](../app/components/LiveChat.vue), [livestream.ts](../server/services/livestream.ts), [LiveHero.vue](../app/components/LiveHero.vue), [sse-manager.ts](../server/utils/sse-manager.ts).
- **Hướng sửa:** mount chat, triển khai thao tác kiểm duyệt, phát/đóng stream sau stop thành công và cập nhật trạng thái phiên ở client.
- **Nghiệm thu:** hai reader thật trao đổi và nhận broadcast; moderator xóa thì message biến mất khỏi UI/history nhưng row còn theo chính sách; stop đóng các stream; trang đang mở phản ánh start/stop; quyền và reconnect đúng.

### AUD-15 — Bình luận Media thiếu tích hợp quản trị/hồ sơ

**Mức độ: P2 · Trạng thái: OPEN**

- **Kích hoạt:** lọc nguồn bình luận ở quản trị hoặc mở lịch sử bình luận reader có bình luận video.
- **Nguyên nhân:** service có `source=media` nhưng API không đọc/truyền; lịch sử chỉ join `articles`.
- **Tác động:** lọc không hoạt động đúng; bình luận video thiếu tên/link đối tượng.
- **Bằng chứng:** [admin/comments/index.get.ts](../server/api/admin/comments/index.get.ts), [reader/comments.get.ts](../server/api/public/reader/comments.get.ts), [comments.ts](../server/services/comments.ts).
- **Hướng sửa:** validate/truyền source xuyên suốt; trả metadata và link phù hợp từng loại; giữ ràng buộc quyền và trạng thái public.
- **Nghiệm thu:** lọc article/media/all đúng cả count/pagination; hồ sơ hiện tên/link video; link tới đúng comment kể cả phân trang; đối tượng đã xóa/ẩn không gây rò nội dung hoặc lỗi trang.

### AUD-16 — Lưu trữ lệch kế hoạch R2 và backup bỏ sót Media

**Mức độ: P1 · Trạng thái: OPEN**

- **Kích hoạt:** triển khai theo kế hoạch gốc hoặc backup/restore/chuyển máy theo tài liệu hiện tại.
- **Nguyên nhân:** kế hoạch yêu cầu R2, nhưng pipeline công bố vào đĩa local và endpoint đọc local. Hướng dẫn chuyển máy chỉ copy `/app/public/uploads`, bỏ volume `/var/lib/cdkt/media`.
- **Tác động:** kiến trúc chưa đáp ứng kế hoạch đã nêu; restore có thể đủ metadata nhưng mất video. Không có bằng chứng rằng local-only đã được phê duyệt thay R2.
- **Bằng chứng:** [kế hoạch gốc](../openspec/media-portal-plan.md), [video-processing.ts](../server/services/video-processing.ts), [docker-compose.yml](../docker-compose.yml), [DEPLOY.md](../DEPLOY.md).
- **Hướng sửa:** thực hiện yêu cầu lưu R2 hoặc ghi nhận quyết định kiến trúc được xác nhận trước khi coi deviation là hoàn tất; đồng thời bảo đảm backup/restore bao phủ các asset và dữ liệu còn được sử dụng thực tế.
- **Nghiệm thu:** nguồn lưu trữ/runtime/spec thống nhất; secret/signed URL không lộ qua public API; backup sạch và restore sang môi trường mới phát được video/thumbnails/segments, giữ metadata đúng; tài liệu và script diễn tả đủ volume/object store, thứ tự và kiểm tra phục hồi.

## 5. Nợ kỹ thuật và chất lượng bằng chứng

### TECH-01 — Checklist hoàn thành vượt quá bằng chứng nghiệm thu

**Mức độ: P2 · Trạng thái: OPEN**

[Task 17.4](../openspec/changes/add-media-portal/tasks.md) được đánh hoàn tất, trong khi ghi chú thừa nhận chưa ghi nhận hai reader nhận SSE broadcast. Hành vi đóng stream lúc stop cũng chưa được nối tại baseline. Gửi message → đọc history không thay thế phép thử reader B nhận broadcast và stream đóng khi phiên kết thúc.

Các test UI dựa nhiều vào cấu trúc source có thể qua dù route đích không tồn tại hoặc component chưa mount (AUD-07, AUD-14). Các task có ghi chú chưa thực hiện đủ như paging nhiều hơn một trang hoặc resume cũng cần đối chiếu lại bằng chứng, không suy từ test đơn vị sang E2E.

**Nghiệm thu:** mở lại task thiếu bằng chứng; chạy browser E2E `tạo → upload → xuất bản → xem → bình luận → xóa` và `start → hai reader chat → moderate → stop`; ghi môi trường, lệnh, kết quả và phần chưa chạy. Chỉ đánh hoàn thành khi đúng tiêu chí ban đầu hoặc spec đã được cập nhật minh bạch.

### TECH-02 — Test manifest phụ thuộc tốc độ máy

**Mức độ: P2 · Trạng thái: OPEN**

[media-processing.test.ts](../tests/media-processing.test.ts) yêu cầu hơn 20 vòng ghi trong 250 ms. Baseline lần đầu chỉ đạt 16 vòng và lỗi; lần chạy lại qua. Ngưỡng tốc độ này không trực tiếp chứng minh tính nguyên tử/đúng của manifest.

**Nghiệm thu:** đồng bộ writer/reader bằng điều kiện hoàn tất và assert invariant cần bảo vệ; timeout chỉ làm giới hạn chống treo. Test vẫn bắt được manifest viết dở và không yêu cầu máy đạt số vòng trong cửa sổ thời gian ngắn.

### TECH-03 — Dependency có cảnh báo audit

**Mức độ: P1 cho nhóm high, cần đánh giá khả năng bị tác động · Trạng thái: OPEN**

Baseline ghi nhận `nodemailer 9.0.5`, `sharp 0.35.3`, `svgo 4.0.2`, `devalue 5.9.0`: tổng 4 gói bị ảnh hưởng, 3 high/1 moderate. Đây là tình trạng dependency tại lần audit, chưa phải xác nhận exploit hoặc mức severity riêng cho từng gói trong ngữ cảnh ứng dụng. Nguồn trạng thái cài đặt: [package.json](../package.json), [package-lock.json](../package-lock.json).

**Nghiệm thu:** lấy audit hiện tại để chọn phiên bản/path sửa phù hợp; cập nhật dependency trực tiếp hoặc chuỗi phụ thuộc cần thiết; chạy lại audit, typecheck/build và bài kiểm tra liên quan. Ghi rõ advisory nào đã hết, advisory nào còn và bằng chứng đánh giá; không chỉ dùng `audit fix --force` để làm sạch số liệu.

### TECH-04 — Cảnh báo trùng auto-import khi build

**Mức độ: P3 · Trạng thái: OPEN**

Build baseline thành công nhưng còn cảnh báo trùng auto-import. Cần lấy lại log để xác định chính xác symbol/file; báo cáo chưa có danh sách symbol và không suy đoán nguyên nhân cụ thể. Điểm kiểm tra cấu hình: [nuxt.config.ts](../nuxt.config.ts); sau đó truy caller và export của từng symbol được nêu trong log.

**Nghiệm thu:** bỏ sự mơ hồ trong đăng ký/import, giữ đúng public contract của các consumer; build và typecheck qua, không còn cảnh báo trùng đã ghi nhận. Không xóa tùy tiện utility chỉ vì tên trùng.

## 6. Sổ theo dõi khắc phục

Quy ước: `OPEN` → `IN_PROGRESS` → `FIXED` → `VERIFIED`. `FIXED` là đã thay code nhưng chưa đủ nghiệm thu; không tương đương hoàn tất. Mỗi cập nhật phải bổ sung owner và bằng chứng cụ thể (file sửa, test/lệnh/kết quả, hạn chế). Chủ sở hữu để trống có nghĩa chưa phân công, không có nghĩa lỗi bị bỏ qua.

### Cập nhật khắc phục — 20/09/2026

Đợt này đã chạy lại các cổng sau trên working tree hiện tại: `npm test` đạt
**1.967 pass, 0 fail, 12 skip** (skip là integration được thiết kế chỉ chạy khi
có cấu hình MySQL riêng); `npm run typecheck` đạt; `npm run db:drift` đối chiếu
**47 bảng / 464 cột** không lệch; `npm audit --omit=dev --json` báo **0** lỗ
hổng; `npm run build` hoàn tất; và `tests/e2e/media-portal.spec.ts` đạt
`passed` trên database `cdkt_e2e_*` disposable cùng thư mục media `/tmp`.

Các cảnh báo build còn lại không làm build thất bại nhưng vẫn là nợ cần theo dõi:
chunk client lớn nhất là 574.8 kB sau minify, và `server/utils/chatbot/outbound.ts`
dùng BigInt trong target es2019. Chúng không được dùng để đánh dấu TECH-04 là
chưa xong vì cảnh báo auto-import ban đầu không còn xuất hiện.

| ID | Ưu tiên | Trạng thái | Owner | Bằng chứng sửa / nghiệm thu |
| --- | --- | --- | --- | --- |
| AUD-01 | P1 | VERIFIED | Đợt audit 20/09 | Payload quyền được chuẩn hoá/validate nghiêm ngặt; `tests/audit-access-control.test.ts`, `tests/security-rbac-escalation.test.ts`, full suite xanh. |
| AUD-02 | P1 | VERIFIED | Đợt audit 20/09 | MFA fail-closed khi factor active không giải mã được; `tests/mfa-login-boundaries.test.ts` và regression MFA trong full suite xanh. |
| AUD-03 | P1 | VERIFIED | Đợt audit 20/09 | Catalog quyền dùng chung, UI gửi đủ matrix và API ghi transaction; các test RBAC/admin UI xanh. |
| AUD-04 | P1 | VERIFIED | Đợt audit 20/09 | Đọc article đã scope type/content type; contract test access-control xanh. |
| AUD-05 | P1 | VERIFIED | Đợt audit 20/09 | PUT Media Portal dùng allowlist, actor do server xác định; `tests/media-api.test.ts` xanh. |
| AUD-06 | P2 | VERIFIED | Đợt audit 20/09 | Consume MFA/recovery dùng compare-and-set; `tests/mfa-concurrency.test.ts` đã kiểm race DB thật, regression suite xanh. |
| AUD-07 | P1 | VERIFIED | Đợt audit 20/09 | Các page form/upload/detail được mount; E2E Media Portal `passed` kiểm tạo, role read-only, resume và upload thật. |
| AUD-08 | P1 | VERIFIED | Đợt audit 20/09 | HLS có route byte-stream/asset riêng, không đi qua SSE; `tests/media-api.test.ts` kiểm manifest/segment xanh. |
| AUD-09 | P1 | FIXED | Đợt audit 20/09 | Claim/fencing, hàng đợi và retry đã có `tests/media-processing.test.ts`/`media-queue-integration`; cần tiếp tục soak nhiều replica trước khi nâng VERIFIED. |
| AUD-10 | P1 | VERIFIED | Đợt audit 20/09 | Native SSE có backpressure, close slow client và shutdown; `tests/node-sse-stream.test.ts`, `media-sse-guard` xanh. |
| AUD-11 | P1 | FIXED | Đợt audit 20/09 | Outbox `media_asset_cleanup` retry/idempotent và script backup media đã thêm; `tests/media-asset-cleanup.test.ts` cùng `ops-scripts` xanh. Cần diễn tập restore archive thật trước VERIFIED. |
| AUD-12 | P2 | FIXED | Đợt audit 20/09 | Receipt/assemble claim/heartbeat đã thực hiện; integration upload có thể bật với MySQL riêng, cần chạy trong CI để nâng VERIFIED. |
| AUD-13 | P2 | FIXED | Đợt audit 20/09 | Reaper đưa job stale về hàng đợi có retry; cần theo dõi crash-recovery trên production-like worker trước VERIFIED. |
| AUD-14 | P2 | FIXED | Đợt audit 20/09 | Stop đóng stream, chat mount ở hero, server chặn POST session cũ, admin có danh sách/gỡ chat; unit contract xanh. Cần E2E hai reader nhận broadcast + đóng stream để nâng VERIFIED. |
| AUD-15 | P2 | VERIFIED | Đợt audit 20/09 | API/UI comments đọc source media, reader detail hiện media; `tests/media-comments.test.ts` và full suite xanh. |
| AUD-16 | P1 | IN_PROGRESS | Đợt audit 20/09 | Đã backup/restore `media_work` local bằng archive ghép mã thời điểm với SQL; **R2 chưa được dùng cho Media Portal** và restore chưa diễn tập trên host mới. |
| TECH-01 | P2 | IN_PROGRESS | Đợt audit 20/09 | E2E Media Portal nay có bằng chứng thật, nhưng checklist OpenSpec còn một số ghi chú lịch sử mâu thuẫn với code hiện tại; cần cập nhật artifact trước archive. |
| TECH-02 | P2 | VERIFIED | Đợt audit 20/09 | Test manifest dùng 40 lượt ghi cố định và chỉ yêu cầu reader overlap, không dùng ngưỡng 250 ms; `tests/media-processing.test.ts` xanh. |
| TECH-03 | P1 / đánh giá impact | VERIFIED | Đợt audit 20/09 | Nâng `nodemailer`, `sharp` và override chuỗi phụ thuộc; `npm audit --omit=dev --json` trả 0 vulnerability. |
| TECH-04 | P3 | VERIFIED | Đợt audit 20/09 | Build không còn cảnh báo duplicate auto-import. Lỗi bundle import relative của role editor được phát hiện, sửa bằng `~~/shared/permissions`, có regression test và build xanh. |

Thứ tự thực hiện đề nghị: đóng lỗi quyền/MFA/audit (AUD-01–06), hoàn thiện luồng Media/Livestream (AUD-07–08), xử lý đồng thời và vòng đời tài nguyên (AUD-09–13), hoàn thiện tích hợp chat/bình luận (AUD-14–15), thống nhất storage và kiểm chứng phục hồi (AUD-16). Đóng TECH-01–04 theo bằng chứng thực tế trong quá trình này. AUD-13 phụ thuộc claim đúng của AUD-09; nghiệm thu UI cuối cùng phụ thuộc các service tương ứng đã sửa.

## 7. Điều kiện chốt Media Portal

Media Portal chỉ nên được nghiệm thu sau khi các mục ảnh hưởng trực tiếp đã được khắc phục và kiểm chứng; mọi phần còn mở được ghi rõ, không đổi thành hoàn tất chỉ vì bộ test tổng xanh. Cần có bằng chứng cho luồng browser, race trên DB thật, slow-client SSE, tự phục hồi sau crash, và backup/restore phát lại media. Checklist OpenSpec phải phản ánh chính xác những phép thử đã thực hiện và quyết định storage thực tế.
