# Reader Features — diễn giải vì-sao

Phần này bổ sung cho `CLAUDE.md` mục 4, 4b, 4c (Đăng nhập Google & bình luận, `/profile`, thông báo trả lời).
Quy tắc hành động nằm trong `CLAUDE.md`; tệp này giữ **lý do và ràng buộc bao trùm**.

---

## Hai rào chắn độc lập cho vé người đọc

Danh tính người đọc TÁCH HOÀN TOÀN khỏi danh tính quản trị, và có HAI rào chắn độc lập. Vé người đọc mang `stage: 'reader'` trong cookie riêng `cdkt_reader`, **và** được ký bằng khoá dẫn xuất từ `JWT_SECRET` (HKDF-SHA256, nhãn `cdkt-reader-session:v1`) chứ không phải chính `JWT_SECRET`. Một rào là đủ để chặn; hai rào vì **hai kiểu hỏng khác nhau**: kiểm claim chống một lần refactor sau này bắt đầu nhận mọi vé có chữ ký hợp lệ, còn khoá riêng chống một lần refactor thôi không kiểm claim nữa. Khác trường hợp vé MFA (sống 5 phút, dùng chung khoá, chỉ chặn bằng claim — xem `CLAUDE.md` Vận hành & an toàn), vé người đọc sống **30 ngày trong tay bất kỳ ai trên internet**, và chính sự bất đối xứng đó trả giá cho rào thứ hai. `tests/reader-session-boundary.test.ts` kiểm **từng rào riêng biệt**, kể cả bằng một vé tự rèn mang `stage: 'session'` nhưng ký bằng khoá người đọc.

- Người đọc **không có** mặt trong bảng `users`, không có quyền RBAC nào, không vào được `/admin`. Payload vé chỉ chứa `readerId` + `tokenVersion` — không email, không tên: hai thứ đó đọc từ CSDL mỗi lần gọi `/api/public/reader/me`, nên một lệnh chặn hoặc một lần đổi tên có hiệu lực **ngay**, không đợi vé hết hạn.
- `reader_accounts.token_version` **tăng lên khi bị chặn**, nên vé đang nằm trong trình duyệt hết hiệu lực tức thì — cùng cơ chế `users.tokenVersion` đã có.
- `sameSite: 'lax'` là **điều kiện tiên quyết, không phải lựa chọn**: lượt callback từ Google là điều hướng khác site, và `strict` sẽ giữ lại cookie đúng ở bước đó — người đọc vừa bấm đồng ý xong thì quay về cổng ở trạng thái chưa đăng nhập, không có gì để chỉ vào.
- **Không có middleware cho người đọc** (`server/utils/reader-auth.ts` chỉ export `requireReader` / `optionalReader`). Middleware quản trị tồn tại vì ~120 tuyến cần xử lý y hệt nhau; ở đây có năm, và một trong số đó (đọc luồng bình luận) cần dạng **tuỳ chọn** để người đã đăng nhập thấy nút xoá trên bình luận của mình mà khách chưa đăng nhập vẫn đọc được. Một middleware mà đôi khi phải không chặn là middleware người đọc mã sau này sẽ hiểu sai.

---

## Redirect URI suy ra, không bao giờ lưu

`resolveRedirectUri(event)` trả `<base>/api/auth/google/callback`, với `base` lấy từ `PUBLIC_BASE_URL`, hoặc từ chính request (chỉ đọc `x-forwarded-proto`/`x-forwarded-host` **khi peer đúng là proxy đã khai** ở `TRUSTED_PROXY_IPS`). Google so khớp chuỗi này **từng ký tự** — kể cả scheme, chữ hoa thường, dấu gạch chéo cuối — nên **một ô cho cán bộ tự gõ là một ô sinh ra `redirect_uri_mismatch`** với lời giải thích nằm trên trang lỗi của Google, nơi mã nguồn này không viết được gì. Trang `/admin/settings/google-oauth` hiện đúng chuỗi đó kèm nút sao chép, và cảnh báo khi `PUBLIC_BASE_URL` chưa đặt. **Một hàm, ba nơi dùng** (lượt chuyển tới Google, lượt đổi mã, chuỗi hiện trên trang) nên chúng không thể lệch nhau.

- Client ID / Client secret nhập **trong trang quản trị, không phải `.env`**. Secret mã hoá AES-256-GCM bằng `CHATBOT_ENCRYPTION_SECRET` với nhãn riêng `cdkt-google-oauth-secret:v1`, **không bao giờ** trả về client (form hiện `••••1234` + ô thay thế). Nhãn khác nhau nghĩa là một envelope của tính năng này **không giải mã được** khi đọc như một API key chatbot và ngược lại — chép ciphertext giữa hai bảng không cho ra bí mật dùng được.
- **`secret_unreadable` là trạng thái phân biệt được**, không đọc thành "chưa cấu hình". Báo sai sẽ đẩy cán bộ đi nhập lại một secret họ đã nhập rồi, trong khi cách xử lý thật là khôi phục khoá cũ hoặc xoá rồi nhập secret mới. Trang in đúng triệu chứng kèm cách xử lý.
- **Chữ ký `id_token` cố ý KHÔNG kiểm tại chỗ** (`server/utils/google-oauth/id-token.ts`): token này về từ chính lượt POST server-to-server của cổng tới `oauth2.googleapis.com`, qua TLS, có xác thực bằng client secret. Thêm JWKS là thêm một phụ thuộc mạng, một cache khoá và một đường xoay khoá vào luồng đăng nhập — tất cả đều có thể hỏng, và không cứu được gì trừ khi TLS hoặc client secret đã bị chiếm, mà lúc đó kẻ tấn công tự phát hành token được rồi. **Nhưng claim thì vẫn kiểm**: `aud` phải đúng client id, `iss` phải là Google, `exp` phải còn hạn, `sub` phải có. (Chi tiết kiểm chứng `aud` xem `data-layer.md` mục `validateIdTokenClaims`.)
- **`sub` là khoá tài khoản, không bao giờ email.** Email đổi được và cấp lại được, nên khoá theo email là gộp hai người thành một hoặc chẻ một người thành hai. Email vẫn lưu và **tìm kiếm được** ở trang kiểm duyệt, nhưng không bao giờ dùng để khớp.
- **`state` là MỘT cookie có chữ ký, chở cả nonce lẫn đường về** (`cdkt_oauth_state`, `base64url(JSON{s,r}).hmac`, sống 10 phút, xoá khi dùng). Cookie client ghi được **dù là HTTP-only**, nên chữ ký là thứ làm đường về đáng tin — không phải việc nó bị ẩn. Lúc xác minh: tính lại HMAC, so `s` bằng `timingSafeEqual`, rồi **kiểm lại `r` một lần nữa** — dữ liệu đã ký vẫn là dữ liệu vào.
- `isSafeReturnPath` là **hàm thuần**, chỉ nhận đúng một dấu `/` đầu; từ chối `//evil.com` (URL tương đối giao thức — trình duyệt đọc là tuyệt đối, nên kiểm một dấu gạch là không đủ), mọi scheme, mọi `@`, mọi dấu gạch chéo ngược, và mọi ký tự điều khiển (chèn header).

---

## Không ảnh đại diện Google, URL không lưu

Avatar vẽ tại chỗ bằng chữ cái đầu trong một vòng tròn (`app/components/ReaderAvatar.vue`). Nhúng thẳng `lh3.googleusercontent.com` sẽ gửi **địa chỉ IP và referrer của mọi khách** tới Google trên đúng những trang công dân đọc — chính lý do dự án này đã tự chủ webfont Inter. Thêm bình luận mà âm thầm phá bỏ điều đó là một cái giá không ai đồng ý trả. Lưu URL mà không hiển thị thì để lại một trường dữ liệu cá nhân **không ai dùng, không ai bảo trì, không ai kiểm** — nên nó không được lưu chút nào; claim `picture` bị đọc rồi bỏ ngay trong hàm thuần, để không caller nào sau này lưu được bằng cách với tay tới một trường còn để mở.

---

## Xoá bình luận cascade — hộp thoại đếm BA con số

Xoá bình luận của một người đọc là xoá luôn phản hồi của Ban quản trị nằm dưới. Mọi FK trên `article_comments` đều CASCADE — trừ `admin_user_id` là `SET NULL`, nên xoá một tài khoản cán bộ **không** làm mất phản hồi của cổng ở nơi khác. Hệ quả là **có chủ đích**, và hộp thoại xác nhận nêu **hai con số tách biệt** (bình luận của người đọc / phản hồi của Ban quản trị) lấy từ endpoint `impact` **đo trước khi xoá bất cứ gì**: một cán bộ chỉ được cho biết "3 bình luận" là đang đồng ý với một việc khác việc sẽ xảy ra.

- **Hộp thoại đếm BA con số, không hai.** `countReaderCommentImpact` trả `comments` / `adminReplies` / `otherReaderReplies`. Con số thứ ba là phần dễ bỏ sót nhất và **bản đầu đã bỏ sót**: không có ràng buộc nào về ai được trả lời, nên người đọc B trả lời được câu hỏi của A — và xoá A là xoá luôn phản hồi của B qua cascade `parent_id`. Khi chỉ đếm hai, một hộp thoại có thể nói thật rằng "2" trong khi **bốn hàng biến mất**. Đúng cái mà hộp thoại này tồn tại để ngăn. Phản hồi do chính người đọc đó viết **không** tính vào con số thứ ba (đã nằm trong `comments`) — đếm hai lần thì phóng đại thiệt hại, mà điều đó cũng làm mất tin vào hộp thoại y như đếm thiếu. Cả ba con số cũng đi vào `activity_logs`, vì sau khi hàng mất thì đó là bằng chứng duy nhất còn lại.
- **Phương án bị TỪ CHỐI:** để lại bia mộ (xoá nội dung/tên/địa chỉ nhưng giữ hàng để phản hồi còn cha). Nó giữ được câu trả lời chính thức, nhưng tạo ra một luồng công khai đọc là "Bình luận đã bị xoá" **kèm một phản hồi chính thức bên dưới** — trên một cổng của cơ quan nhà nước, đó là mời gọi đúng suy diễn sai về việc gì đã bị xoá và vì sao. Nó còn ép một chiến lược dọn riêng cho một scope vào `data-retention.ts`, nơi ba scope kia đều là **một** câu `DELETE` theo lô — và chính sự bất đối xứng đó là chỗ một lần sửa dùng chung sau này lặng lẽ phá một bảng.
- **Cái mất là thật:** một câu trả lời chính thức đáng giữ biến mất cùng câu hỏi đã gợi ra nó. **Nơi đúng cho câu trả lời cần sống lâu là `chatbot_knowledge`** (có luồng duyệt, bắt buộc nguồn, có trang riêng `/qa-documents`) hoặc `articles` với `type='faq'`. Phản hồi bình luận là hội thoại; câu trả lời cần sống lâu hơn cuộc hội thoại thì thuộc về kho đã duyệt — trang kiểm duyệt in đúng câu này ngay trên khung soạn phản hồi.
- **MỘT đường xoá duy nhất**: `deleteComment` / `deleteReaderComments` trong `server/services/comments.ts`, dùng chung cho tự xoá, admin xoá, xoá hàng loạt, chặn, xoá tài khoản, và lượt dọn lưu trữ. Chặn tài khoản gói cờ + tăng `tokenVersion` + xoá bình luận vào **một transaction**: một nửa còn tệ hơn không làm gì — cờ mà không xoá thì bình luận còn treo dưới một cái tên đã bị chặn, xoá mà không cờ thì người đó tiếp tục đăng bằng vé đang có.
- **Bỏ chặn KHÔNG phục hồi gì**, và không hồi sinh vé cũ. Cả hai đều nói rõ trong hộp thoại.

---

## `last_seen_at` phải đóng dấu ở đường ghi THẬT

`touchReader` được gọi ở `POST /api/public/comments` (viết bình luận) và `GET /api/public/reader/me` (mỗi lượt tải trang có người đọc). Bản đầu viết hàm này rồi **không gọi ở đâu cả**, và đó không phải code chết vô hại: `last_seen_at` là **chính cột mà scope lưu trự tính tuổi**, nên người ghi duy nhất còn lại là lượt callback OAuth. Vé người đọc sống 30 ngày, vậy một người đăng nhập một lần rồi bình luận đều đặn suốt một năm sẽ mang `last_seen_at` **đóng băng ở lần đăng nhập đầu tiên** — tài khoản hết hạn theo cửa sổ 365 ngày **trong khi họ vẫn đang viết**, và lượt dọn mang theo toàn bộ bình luận của họ. Hàm tự nuốt lỗi của mình nên một lượt đóng dấu hỏng không thể làm hỏng bình luận vừa lưu thành công.

---

## `/profile` — ràng buộc bao trùm an toàn bộ nhớ đệm

`/profile` KHÔNG được thêm vào `routeRules`, và đây là ràng buộc bao trùm. Mọi tuyến công khai khác phục vụ qua `swr: 60`; một cửa sổ đệm ở trang này là phát tên, email, bình luận và tiêu đề đoạn chat của người này cho người kế tiếp ghé vào trong 60 giây. Hệ quả kéo theo: **mọi dữ liệu nạp sau mount** (không `useFetch`, không `useAsyncData` — có test chặn), toàn bộ thân trang bọc `<client-only>` **không `fallback`**, và **không có middleware chuyển hướng** khi chưa đăng nhập — `useReaderAuth` chỉ biết người đọc là ai sau mount, nên một middleware sẽ chạy trước khi biết và đá cả người đã đăng nhập ra ngoài. Trang hiện khối mời đăng nhập.

### Tên tự đặt — cột riêng, phải sửa đủ NĂM bề mặt

`reader_accounts.custom_display_name`, không ghi đè cột Google. `callback.get.ts` làm mới `display_name` từ Google ở **mỗi** lượt đăng nhập (có chủ đích), nên cho người đọc sửa thẳng cột đó là để lần đăng nhập kế tiếp âm thầm xoá tên họ vừa đặt. Tên hiệu lực = `custom_display_name ?? display_name ?? 'Người dùng'`, gói trong **một** hàm thuần `effectiveDisplayName()`. Không có cờ boolean nào — một cờ là một trạng thái thứ ba để lệch.

- **`server/utils/display-name.ts` là module LÁ**, không nằm trong `services/`: `readers.ts` đã import `comments.ts`, nên đặt logic tên ở một trong hai là tạo phụ thuộc vòng. Cả hai đều cần — luồng bình luận công khai và danh sách kiểm duyệt đều render tên người đọc. `readers.ts` re-export lại để các nơi gọi cũ giữ nguyên một đường import.
- **Phải sửa đủ NĂM bề mặt, không chỉ header.** `serializePublicComment` nhận **cả hai** cột (`readerName` + `readerCustomName`) và giải quyết bằng `effectiveDisplayName`; `loadCommentThread` và `listCommentsForAdmin` đều select thêm cột thứ hai. Thiếu bất kỳ chỗ nào thì đổi tên xong mà bình luận vẫn mang tên cũ — và cán bộ nhận báo cáo về "Bác Ba" sẽ không tìm ra hàng nào tên "Bác Ba". Danh sách kiểm duyệt cố ý hiện **tên công chúng thấy**, không phải cột Google thô.
- **Đổi tên ghi `activity_logs` trong CÙNG transaction** với câu UPDATE — đường ghi thứ 12 trong `tests/reader-audit-atomicity.test.ts`. `userId: null` vì `activity_logs.user_id` là FK tới `users` và người đọc không có hàng ở đó; danh tính người thực hiện nằm ở `meta.readerId`. Ghi id người đọc vào cột "id tài khoản cán bộ" sẽ khiến mọi truy vấn audit có join `users` âm thầm quy hành vi này cho cán bộ đang giữ id đó.

### "Bài đã xem" chỉ localStorage, cố ý không có bảng máy chủ

`localStorage['cdkt_reader_history_v1']`, tối đa 50. Đây là quyết định dễ bị một người sau này "sửa" nhất, nên lý do phải đọc được: `article_view_daily` chỉ đếm theo (ngày, bài, nguồn) và lượt ping dùng `deriveDailyVisitorToken` **chính vì** không lưu IP/user agent. Làm theo tài khoản nghĩa là tạo một bảng ghi **công dân nào đã đọc bài nào, lúc nào** trên cổng của Bộ Công an — với độc giả là người có án đang tra cứu vị thế pháp lý của chính mình. Bảng đó sẽ sống lâu hơn mọi ai còn quan tâm tới danh sách này.

- **Đánh đổi phải in ra trên trang**, không để người đọc tự suy: danh sách theo **thiết bị**, không theo tài khoản. Có test chặn cả hai câu ("thiết bị này", "không lưu trên máy chủ") — người tưởng nó theo tài khoản sẽ kết luận cổng làm mất dữ liệu của họ.
- **`formatDateVN` KHÔNG dùng được cho `readAt`**, và đây là ngoại lệ duy nhất của quy tắc "không định dạng ngày theo giờ cục bộ" (`tests/public-pages-structure.test.ts`, `LOCAL_TIME_EXEMPTIONS`, đếm theo **số lần xuất hiện** chứ không chỉ tên tệp). `formatDateVN` đọc bằng `getUTC*` — đúng cho cột DATETIME cần khớp SSR ↔ trình duyệt, nhưng `readAt` là mốc `Date.now()` sinh ngay trên máy này và chỉ tồn tại trong `localStorage` của nó, nên đọc bằng UTC là **lùi 7 giờ**: bài đọc lúc 6 giờ sáng hiện ra ngày hôm trước. Ngoại lệ chỉ đứng vững khi hai tiền đề còn đúng (dữ liệu ở client, khối nằm trong `<client-only>`); có test kiểm **từng tiền đề**.

### Nhận đoạn chat cũ dùng vé HMAC đang giữ

`POST /api/public/reader/claim-chats`. `localStorage['cdkt_sessions_v1']` giữ `{id, token}`; endpoint **kiểm chữ ký từng vé** bằng `verifySessionToken` và bỏ qua id nào không qua. Không có bước đó thì tuyến này là "đọc cho tôi một uuid rồi đưa tôi bản ghi" — và một bản ghi chat có thể chứa số điện thoại lẫn mô tả tiền án của người khác.

- `chat_sessions.reader_id` là FK **`ON DELETE SET NULL`**, cố ý không CASCADE: `chat_sessions` là scope lưu trữ 90 ngày còn `reader_accounts` là 365, nên cascade sẽ làm một lượt xoá tài khoản mang theo cả bản ghi chat mà **hộp thoại xác nhận đang không đếm** — cán bộ đồng ý với một việc khác việc xảy ra.
- Chỉ nhận phiên có `reader_id IS NULL`, và điều kiện đó nằm **trong câu UPDATE** chứ không phải một lượt SELECT trước đó: đọc-rồi-ghi thì hai lượt gọi đồng thời đều thấy null và đều ghi. Số trả về **đếm lại phần người đọc đang sở hữu**, không đọc `affectedRows` — `affectedRows` đếm hàng *đổi*, nên phiên đã nhận từ lần trước ra 0 trong khi nó đang hiện ngay bên dưới.
- `useReaderAuth.load()` tự gửi một lượt nhận **một lần mỗi phiên trình duyệt** (cờ `sessionStorage`), mọi lỗi nuốt. **Cờ bị xoá khi đăng xuất và khi vé hết hiệu lực** — không thì trên máy dùng chung, người B đăng nhập sau người A sẽ không bao giờ được mời nhận chat của mình.

### `GET /reader/comments` và `GET /reader/chats` cố ý KHÔNG ghi audit

Quy tắc "mọi lượt đọc dữ liệu người đọc phải có audit" nhắm vào **cán bộ đọc dữ liệu công dân**; bắt ghi log mỗi lần một người xem trang của chính họ là biến trang cá nhân thành nguồn rác và làm loãng đúng những dòng bảng đó tồn tại để ghi — cùng lý do `/admin/profile` không gắn `checkPermission`. Danh tính lấy từ vé, **không có tham số `readerId`** ở bất kỳ endpoint nào.

---

## 401 vs 403 khi trang đang mở

Vé sống 30 ngày và một lệnh chặn tăng `tokenVersion` ngay, nên máy chủ có thể bắt đầu từ chối khi trang vẫn mở. 401 → `forgetReader()` để form đổi thành nút đăng nhập; giữ nguyên thì `reader` cũ vẫn truthy, form còn đó kèm một dòng lỗi và **không có nút đăng nhập nào** — ngõ cụt mà đường ra duy nhất là tự tải lại trang. 403 là lệnh chặn: người đọc **vẫn** đang đăng nhập, mời họ đăng nhập lại là mời một lượt sẽ thành công mà không đổi gì.

- **Lý do phải hiện trên khối đăng nhập, không phải trong form.** `submitError` sống trong khung soạn, nên nó bị bỏ đúng bởi cái thay đổi trạng thái mà nó cần giải thích: người đọc bấm "Gửi", thấy form đột nhiên thành một nút đăng nhập, và không có gì nói vì sao.
- **Nháp lưu ra `sessionStorage` TRƯỚC khi bỏ danh tính.** `signIn()` là `window.location.href` — một lượt điều hướng cấp trang thật (luồng OAuth là chuỗi redirect qua accounts.google.com, không làm được trong XHR), nên **mọi ref trong component chết**. Hứa "nội dung vẫn được giữ" mà không ghi ra chỗ sống qua lượt điều hướng đó là một lời nói dối nói đúng vào lúc người đọc đang tin vào nó. `sessionStorage` chứ không `localStorage`: giữ lâu hơn thì một câu hỏi bỏ dở nửa năm trước sẽ hiện lại trên máy dùng chung — chữ của người khác trong khung soạn của người đang ngồi đó. Xoá ngay sau khi phục hồi **và** sau khi gửi thành công, nếu không lượt tải sau sẽ điền lại đúng bình luận vừa gửi và người đọc tưởng nó chưa đi.

---

## Thông báo trả lời — bảng thứ 41, không suy ra từ `article_comments`

`reader_notifications`, không suy ra từ `article_comments`. Phương án suy ra (so với một mốc `notifications_seen_at`) chỉ đánh dấu đã đọc được **toàn bộ một lượt** và khoá cứng vào đúng một loại thông báo. Cột `type` mở đường cho loại thứ hai mà không cần migration.

- **Cả hai FK đều CASCADE, và đó là thứ giữ bảng này trung thực.** Xoá trả lời → thông báo về nó biến mất (một thông báo trỏ vào hàng không tồn tại sẽ dẫn người đọc tới một bài viết không có bình luận đó — đọc ra là cổng đã xoá lời họ viết). Xoá tài khoản → thông báo đi theo.
- **CỐ Ý KHÔNG phải scope lưu trữ.** Mọi hàng treo trên `article_comments`, vốn đã cascade từ **cả** `articles` **và** `reader_accounts` — hai scope đã có — nên bảng này bị chặn trước khi `data-retention.ts` nhìn tới. Một cửa sổ tuổi độc lập sẽ xoá thông báo **trong khi trả lời vẫn nằm trên trang chưa ai đọc**, còn một cap số bản ghi sẽ đuổi thông báo cũ nhất của đúng những người hoạt động nhiều nhất. Cùng lý do `chat_messages` và `article_comments` không phải scope — thêm scope thứ năm cho bảng này là lỗi cần tránh.
- **`UNIQUE (reader_id, comment_id)` + `onDuplicateKeyUpdate`, không phải đọc-rồi-ghi.** Chỉ số là thẩm quyền; kiểm tra trước rồi mới ghi thì hai lượt trả lời đồng thời đều thấy "chưa có hàng" và đều chèn.
- **Thông báo ghi trong CÙNG transaction với trả lời.** Cả hai nơi gọi (`createComment` — nay đã bọc transaction, `createAdminReply` — đã có sẵn) truyền `tx` xuống. Một trả lời tồn tại mà không ai được báo là **đúng cái tính năng này ra đời để ngăn**, và nó hỏng trong im lặng: luồng trông đúng với tất cả mọi người trừ người đang chờ câu trả lời.
- **Tự trả lời KHÔNG sinh thông báo**; trả lời của **cả** người đọc khác **lẫn** Ban quản trị thì có. Không có ràng buộc nào về ai được trả lời (chính điều mà `countReaderCommentImpact` phải đếm riêng), nên chỉ báo phản hồi cán bộ thì A không bao giờ biết B đã trả lời mình.
- **`COMMENT_THREAD_PER_PAGE` sống ở `services/notifications.ts` và được endpoint luồng bình luận `import`, không khai hai nơi.** Thông báo trỏ vào một *trả lời*, nhưng luồng phân trang theo *bình luận gốc* — nên số trang phải suy từ cha. Hai bản sao lệch nhau là kiểu hỏng cho ra liên kết rơi **cạnh** bình luận thay vì **trúng** nó, mà **không có gì báo lỗi ở đâu cả**. `notificationTargetPage` là hàm thuần nên ghim được bằng test; việc nó khớp với luồng thật đã kiểm bằng MySQL thật lúc phát triển (dựng 45 bình luận gốc, đòi trang 3 chứa đúng bình luận được neo).
- **URL là `/news/<slug>?comments=<trang>#comment-<id>`** và neo **bình luận gốc**, không neo trả lời — trả lời luôn render dưới cha nên cha là thứ phải mở. Trang phải đọc **trước** lượt nạp đầu tiên, không thì `focusAnchoredComment` chạy trên trang 1 và không tìm thấy gì.
- **Đọc hash bằng `Number.isSafeInteger`**, cùng cách `/qa-documents` đọc `#qa-<id>`: `Number()` trần cho ra `NaN` rồi đi tiếp vào `getElementById` dưới dạng chuỗi `"NaN"`.

### Chuông — `.client` là ràng buộc an toàn bộ nhớ đệm

Chuông sống trong `ReaderNotificationBell.client.vue`, không nằm trong layout. Hai lý do, và lý do thứ hai mới là lý do thật:

- **`.client` là ràng buộc an toàn bộ nhớ đệm, không phải tối ưu hoá.** Mọi tuyến công khai chạy `swr: 60`, nên một khối dựng phía máy chủ mang số chưa đọc của một người sẽ được **phát lại cho người kế tiếp** ghé vào trong 60 giây. Hậu tố `.client` mạnh hơn một lớp bọc `<client-only>`: Nuxt **không đưa component vào bundle máy chủ**, nên không còn lớp bọc nào để một lần sửa sau này lỡ tay gỡ mất. Đã kiểm ở mức bundle sau khi build: `grep` không thấy tên component trong `.output/server/`, và thấy trong `.output/public/_nuxt/`.
- **Phần đáng tách không phải ~120 dòng template mà là HAI listener cấp document.** Chuông dùng chung Escape và mousedown với menu danh tính, nên chừng nào chúng còn nằm chung thì layout vẫn phải giữ `notifMenuRef` và hai nhánh `if (isNotifMenuOpen)` — một lần "tách component" chỉ dời chữ đi chỗ khác mà **không gỡ được ràng buộc nào**. Component tự đăng ký và tự gỡ listener của nó; test khẳng định layout **không còn** hai định danh đó. Layout đi từ 991 → 866 dòng.
- Layout **vẫn** chạm `useReaderNotifications` cho đúng hai việc: huy hiệu trong ngăn kéo mobile, và lượt nạp đầu tiên (xem mục ngay dưới). Đăng xuất đóng menu qua `defineExpose({ close })` chứ không qua một ref dùng chung.
- **Nạp bằng `watch(reader)` ở layout, không phải trong `onMounted`.** `loadReader()` cố ý không được `await` (header không chặn lượt vẽ đầu), nên lúc mount `reader` vẫn null và gọi thẳng sẽ nhận 401. Nạp sẵn thay vì đợi mở chuông **vì huy hiệu ở ngăn kéo mobile không có cú mở nào để bám vào** — không nạp thì trên điện thoại con số vĩnh viễn bằng 0.
- **`load()` chia sẻ promise đang bay, không `if (pending) return`.** Layout và `/profile` cùng gọi trên mỗi lượt tải trang cá nhân; một `return` trơn sẽ khiến lượt gọi thứ hai resolve **ngay lập tức** trong khi dữ liệu còn đang về, nên `await` của trang rơi xuống đoạn mã tưởng danh sách đã có. Chỉ chia sẻ khi **cùng số trang** — nếu không, bấm "trang sau" giữa lúc lượt đầu đang bay sẽ lặng lẽ trả về trang cũ.
- **Đánh dấu đã đọc là lạc quan.** Người đọc vừa bấm đúng thứ đó; đợi round-trip mới hạ huy hiệu làm cú bấm có cảm giác bị bỏ qua. Ghi hỏng thì hàng trên máy chủ vẫn chưa đọc và lượt nạp sau khôi phục con số thật — giá của việc sai là một huy hiệu quay lại, không phải mất dữ liệu.
- **`reset()` chạy khi đăng xuất, và xoá cả promise đang bay.** State ở cấp module sống qua lượt đăng xuất; trên máy dùng chung người kế tiếp sẽ thấy huy hiệu của người trước.
- **Không polling nền.** Một lượt poll là một request mỗi vài giây từ **mọi tab đang mở**, đổi lấy một con số không bao giờ khẩn cấp — không ai chờ một câu trả lời pháp lý theo từng giây.

### Gửi email khi có trả lời

- **`server/services/notification-email.ts` tách riêng khỏi `notifications.ts`, có lý do.** Module kia ghi hàng **bên trong transaction của người gọi**; module này nói chuyện với một máy chủ SMTP ở xa. Gộp lại là đặt một lượt đi mạng vào trong transaction — giữ khoá hàng mở suốt thời gian máy chủ mail trả lời, mà với một host chậm hoặc không tới được thì đó là rất lâu. **Gửi sau khi commit, không bao giờ trong transaction.**
- **Theo đúng chính sách "3C" mà `utils/mailer.ts` đã có**: ghi trước, gửi nếu đã cấu hình, và **không bao giờ để lỗi mail ảnh hưởng request**. `sendReplyEmail` có **một** `try/catch` bao trọn, ném ra không gì cả, chỉ để lại `reader_notification.email_failed` trong log. Bình luận của công dân phải lưu được dù máy chủ mail có sống hay không — thông báo trong cổng mới là bản ghi, email là tiện ích thêm. Đã kiểm bằng SMTP thật rồi tắt máy chủ mail giữa chừng: bình luận vẫn thành công.
- **`await` chứ không bắn-rồi-bỏ.** Nitro dỡ context của request khi handler trả về, cắt một promise rời tay giữa chừng. Hàm tự nuốt lỗi nên `await` không thể làm hỏng gì.
- **Cột `reader_accounts.email_notifications` (mặc định BẬT) và công tắc ở `/profile`.** Mặc định bật vì thông báo chính là mục đích — công dân hỏi rồi rời đi, chuông trong cổng chỉ tới được họ nếu họ tình cờ quay lại. Nhưng **bắt buộc phải tắt được**: gửi email cho công dân mà không có đường dừng là spam, bất kể ai gửi. Đọc **tại thời điểm gửi** từ hàng trong CSDL, nên một thiết lập vừa đổi một giây trước vẫn có hiệu lực.
- **Tài khoản Google không có email thì công tắc bị vô hiệu hoá kèm lời giải thích** — hiện một nút bật được ở đó là hứa một việc sẽ không bao giờ xảy ra.
- **Không có `PUBLIC_BASE_URL` thì email vẫn gửi, nhưng KHÔNG có liên kết.** Một đường dẫn tương đối trong email là chuỗi chết — không có trang nào để trình đọc mail phân giải nó. Bịa ra hostname sẽ cho ra liên kết 404 với tất cả mọi người.
- **Mọi giá trị nội suy đều `escapeHtml`**: tiêu đề bài, tên hiển thị và nội dung bình luận đều là chữ do công dân hoặc cán bộ gõ, và thân bình luận được lưu **nguyên văn** chính vì không thứ gì được phép diễn giải nó.
- **Người bị chặn không nhận email**: bình luận của họ đã bị xoá, nên báo cho họ về một luồng không còn câu hỏi của họ vừa khó hiểu vừa vô nghĩa.

### Đường dẫn tiếng Anh & chuyển hướng 301

- **Ba tuyến đã đổi tên**: `/nguoi-doc` → `/profile`, `/tai-lieu-hoi-dap` → `/qa-documents`, `/tro-ly` → `/assistant`. Neo đổi từ `#binh-luan-<id>` → `#comment-<id>`, `#thong-bao` → `#notifications`, tham số `?binhluan=` → **`?comments=`**.
- **`?comments=` chứ không phải `?page=`, có lý do.** `/qa-documents` đã dùng `?page=` cho phân trang của chính nó, và trên trang bài viết thì `?page=` mơ hồ — nó là trang bình luận hay trang gì khác? Tên riêng cho một thứ riêng.
- **Ba dòng `redirect` 301 trong `routeRules` là BẮT BUỘC, không phải lịch sự.** Cả ba tuyến đã chạy trên production, đã được chia sẻ và đã vào chỉ mục tìm kiếm — chính trợ lý ảo cũng đã dẫn `/tai-lieu-hoi-dap` trong câu trả lời. Đổi tên mà không có chúng là **làm chết mọi liên kết đã phát ra ngoài**, kể cả liên kết đã in ra giấy hay nằm trong tin nhắn. Một liên kết không có hạn sử dụng; giá để giữ là ba dòng cấu hình. **Đừng xoá theo kiểu dọn dẹp** — có test chặn cả ba.
- **301 chứ không 302**: chuyển hẳn thứ hạng tìm kiếm sang địa chỉ mới thay vì để công cụ tìm kiếm giữ cả hai. Query string **được giữ nguyên** qua lượt chuyển hướng (đã kiểm trên bản build thật: `/tai-lieu-hoi-dap?q=test` → `/qa-documents?q=test`), nên một liên kết đã lọc sẵn vẫn mở đúng kết quả đó.
- **`/profile` CÓ xuất hiện trong `routeRules`** — với tư cách **đích đến** của lượt chuyển hướng, không phải một quy tắc cache. Test kiểm đúng thứ có ý nghĩa: không có khoá `'/profile':` nào (đó mới là hình dạng có thể mang `swr`), và lượt 301 vẫn còn.
