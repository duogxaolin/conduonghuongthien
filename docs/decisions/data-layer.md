# Data Layer — diễn giải vì-sao & tiền sử bug

Phần này bổ sung cho `CLAUDE.md` mục "Quy ước tầng dữ liệu" và "Hạn chế đã biết".
Quy tắc hành động (MAI PHẢI/ KHÔNG ĐƯỢC, vị trí test) nằm trong `CLAUDE.md`; tệp này giữ **lý do và lịch sử bug**.

---

## `const id = await db.transaction(…)` — TDZ

Biến khai bằng `const` ở đầu `db.transaction(…)` còn trong vùng chết tạm thời (TDZ) suốt thời gian callback chạy, nên `resourceId: newArticleId` đặt trong dòng audit bên trong khối ném `ReferenceError` **lúc chạy**. Dùng giá trị cục bộ (`const created = res.insertId`) rồi `return` nó.

- Chính đợt bọc audit vào transaction đã tạo ra lỗi này ở **bốn** endpoint tạo mới (bài viết, tải ảnh, thêm block trang, tạo vai trò) — nghĩa là **mọi lượt tạo bài viết trả 500**.
- Nó lọt qua `typecheck` (biến có tồn tại và đúng kiểu), qua `db:drift`, qua `npm run build`, và qua **cả 1187 test**.
- **Bốn cổng đó đều kiểm mã ở trạng thái nghỉ; không cổng nào gọi một endpoint.** Đó là khoảng trống thật, không phải một lần xui: mọi hồi quy chỉ hiện ra khi handler *chạy* đều đi qua được. Nay có hai lớp — `tests/transaction-tdz.test.ts` chặn hình dạng trong văn bản mã nguồn (đếm ngoặc nhọn, không dò thụt lề), và `tests/e2e/admin-write-paths.spec.ts` **gọi thật** năm endpoint tạo mới rồi đọc lại hàng. Lớp sau bắt được cả những cách hỏng chưa ai nghĩ ra; lớp trước chạy trong `npm test` nên phản hồi sớm hơn.
- **E2E kiểm cả `id` trả về, không chỉ mã 200**: một handler trả `{ ok: true, id: undefined }` vẫn là 200, và giao diện sẽ điều hướng tới `/admin/.../undefined`. Đó đúng là hình dạng của lỗi `insertId` mà dự án đã trả giá bốn lần.
- **Spec e2e dựng dữ liệu qua CSDL trực tiếp** (`e2eDbConfig()` ở `tests/e2e/harness.ts`), không đi vòng qua một tính năng khác: bản đầu tạo phiên chat bằng tuyến công khai và **đỏ vì tuyến đó trả 503** khi chưa cấu hình nhà cung cấp AI — một lý do không liên quan gì tới điều spec khẳng định, và một test đỏ vì lý do sai sẽ bị đọc là nhiễu.

### Bộ quét TDZ đã bị nới hai lần, kèm kiểm chứng âm tính

`\bid\b` khớp cả `result.id` (dấu chấm là biên từ) và chữ "id" trong `throw new Error('… returned no id')` — hai dương tính giả thật, và chúng tệ hơn một lỗi thường: chúng dạy người đọc rằng guard này ồn, mà bước tiếp theo của bài học đó là tắt nó đi. Nay bỏ nội dung chuỗi ký tự trước khi tìm, và dùng `(?<![.\w$])` để không khớp sau dấu chấm. Vì **nới một cổng là một cơ hội để nó thành cổng không kiểm gì cả** — và dạng hỏng đó im lặng, vì cả hai đều xanh — phần phát hiện được chạy lại trên bốn mẫu dựng tay: hai **phải** bị bắt (đúng hình dạng đã làm mọi lượt tạo bài viết trả 500), hai **không được** bị bắt.

---

## `db.insert()` trả về MẢNG — destructure mới có `insertId`

`db.insert()` / `db.delete()` / `pool.query()` trả về **mảng** — destructure (`const [res] = await …`), và đọc `affectedRows` **chỉ** qua `readAffectedRows()` / `affectedRowsOrZero()`. `as { affectedRows?: number }` và `as unknown as { insertId?: number }` **khẳng định** hình dạng chứ không **kiểm** nó, nên một phép đọc sai qua được `typecheck`, qua fake pool, và qua mọi test soi văn bản mã nguồn — chỉ driver thật mới phản đối. Dự án đã trả giá cho điều này **sáu lần** (bốn ở `insertId`, hai ở `affectedRows`), và mỗi lần triệu chứng đều là một con số `0` trông hợp lý.

### `insertId` — bốn chỗ đã viết sai

`db.insert()` trả về một MẢNG, phải destructure mới lấy được `insertId` (`tests/insert-id-integration.test.ts`). Viết `res.insertId` trên giá trị chưa destructure cho ra `undefined` — **âm thầm**. **Bốn** chỗ đã viết sai và cả bốn đều lọt qua mọi cổng: `callback.get.ts` (đăng nhập người đọc), `ip-bans.ts`, rồi `createComment` và `createAdminReply` trong `services/comments.ts` (phát hiện sau, lúc làm trang cá nhân người đọc). Các chỗ cũ hơn trong dự án đều viết đúng dạng `const [res] = await db.insert(...)`.

- **Triệu chứng ở production đọc ra như một lỗi chập chờn, không như một lỗi lập trình**: lần đăng nhập **đầu tiên** báo "không thể hoàn tất đăng nhập", lần thứ hai thì được. Cả hai đến từ cùng một dòng — `Number(undefined ?? 0)` là `0`, guard `if (!readerId)` nổ và chuyển hướng `failed`, **nhưng hàng đã commit xong**. Lần thứ hai tìm thấy hàng đó, đi nhánh `existing` (nhánh này không đọc `insertId`) nên chạy đúng. Người thử hai lần tưởng cổng chỉ cần "làm lại một lần"; người thử một lần kết luận đăng nhập bị hỏng.
- **`as unknown as { insertId?: number }` là thứ làm lỗi này vô hình.** Nó *khẳng định* hình dạng chứ không *kiểm* hình dạng, nên cách đọc sai vẫn qua `typecheck`. Fake pool cũng không bắt được (một stub trả về đúng hình dạng mà người viết tin là đúng), và test soi văn bản mã nguồn thì chỉ ghim được ký tự của một phép đọc, không ghim được giá trị nó trả về lúc chạy. **Chỉ driver thật phản đối.**
- Ở `ip-bans.ts` hậu quả khác và tệ theo kiểu khác: lệnh chặn vẫn ghi được, nhưng dòng audit mang `resourceId: 0` — một lệnh chặn đang có hiệu lực mà nhật ký trỏ vào hàng không tồn tại, tức đúng cái mà việc bọc hai lượt ghi vào một transaction ra đời để ngăn.

### `affectedRows` — cùng họ lỗi, sống thêm một thời gian ở `db.delete()`

`server/api/admin/chatbot/sessions/bulk-delete.post.ts` đọc `(result as unknown as { affectedRows?: number }).affectedRows` trên mảng chưa destructure, nên **luôn** ra `undefined` → `0`: cán bộ xoá một loạt phiên trò chuyện thật, màn hình báo "đã xoá 0", và dòng `activity_logs` ghi `deletedCount: 0` kèm câu `consequence` khai rằng không có gì bị xoá. **Hàng thì đã mất.** Một hành động phá huỷ mà dấu vết duy nhất của nó phủ nhận nó đã xảy ra là đúng thứ nhật ký kiểm toán tồn tại để ngăn. Suite `insert-id-integration` **chỉ kiểm `insert()` nên không thấy** — nay đã mở rộng sang `delete()`, và nó khẳng định luôn rằng phép đọc chưa destructure **phải** là `undefined`, để lỗi được ghim bằng một test chạy thật chứ không bằng một dòng chú thích. **Nay mọi phép đọc đi qua MỘT hàm**: `readAffectedRows()` / `affectedRowsOrZero()` (`server/utils/affected-rows.ts`, `tests/affected-rows.test.ts`). Sáu chỗ từng tự viết `as { affectedRows?: number }`, mỗi chỗ một bản — và phép ép kiểu chính là thứ làm lỗi vô hình: nó **khẳng định** hình dạng chứ không **kiểm**. Helper nhận **cả hai** hình dạng (header đã destructure, hoặc cả mảng `pool.query()` trả về) nên nơi gọi không phải nhớ mình đang cầm cái nào.

- **`null` và `0` là hai thứ khác nhau, và helper giữ nguyên sự khác biệt đó.** `0` là "không có hàng nào khớp" — một lời khẳng định về dữ liệu; `null` là "không đọc được" — một chỗ không biết. Gộp lại là cách một lượt truy vấn hỏng đọc ra thành một bảng đã sạch. `affectedRowsOrZero` chỉ dùng cho vòng dọn theo lô, nơi cả hai dẫn tới **cùng một quyết định** (dừng vòng); `analytics-ingestion` thì **ném lỗi** khi `null` vì con số ở đó quyết định một lượt xem có phải bản đầu tiên hay không.
- Chuỗi số **không** được tự chuyển thành số: `Number('5')` chạy được, nhưng một driver trả chuỗi ở trường này nghĩa là hình dạng đã khác giả định, và đoán tiếp là bỏ qua đúng cái tín hiệu đó.

---

## `finitePositive()` — số trong query string

`server/utils/query-number.ts`. `Math.max(1, Number(query.page))` trông đúng — có kẹp biên, có mặc định — nhưng `Number('abc')` là `NaN` và **mọi so sánh với `NaN` đều `false`**, nên `Math.max` trả lại chính `NaN`. Giá trị đó vào `offset()` rồi JSON hoá thành `page: null`: endpoint **trả về hàng nhưng khai là không ở trang nào**. `?page=1e999` (Infinity) lọt y hệt.

- Hàm này từng bị **chép năm bản** giống hệt nhau, còn **bốn endpoint khác không có bản nào** (`public/articles`, `admin/articles`, `admin/categories/[id]/articles`, `admin/media`) — chúng vẫn kẹp biên trần. Đó là hình dạng của một quy ước lan ra không đều: chỗ có helper thì đúng, chỗ không có thì sai, và **không có gì chỉ ra chỗ nào là chỗ nào**. Nay còn một bản; `tests/query-number.test.ts` chặn cả việc phép kẹp biên trần quay lại lẫn việc bản sao thứ hai xuất hiện.
- Phát hiện bằng cách **gọi thật endpoint sau khi build**, không phải đọc mã — một test soi văn bản mã nguồn không thấy được hình dạng phản hồi.
- **Đã đo lại bằng A/B trên hai máy chủ thật** (HEAD so với `main`, hai CSDL dùng một lần, 30 tuyến đọc quản trị): 28/30 giống nhau, và **đúng hai chỗ lệch là chính lỗi này**. `?page=abc` → `main` trả `pagination.page: null` trong khi vẫn trả về hàng; `?page=1e999` → `main` trả **500**. HEAD trả `page: 1` và `200`. Ghi lại con số vì nó trả lời câu "phép sửa này có thật cần không" bằng một quan sát chứ bằng một lập luận — và vì `Infinity` đi tới **500** là hậu quả không ai đoán trước khi chạy thử.

---

## Đường ghi audit — nguyên tử

`tx.insert(activityLogs)`, không bao giờ `db.insert(activityLogs)` bên trong khối transaction. Lời gọi thứ hai vẫn chạy trên pool và **commit độc lập** — đúng con bug đó nhưng khoác áo transaction.

- **Xoá trước, ghi log sau, không bọc** là hình dạng sai phổ biến nhất trong repo này. `activity_logs.user_id` là FK tới `users` và `meta` là cột JSON, nên câu thứ hai có cách hỏng riêng của nó: hàng đã mất, và thứ duy nhất còn ghi lại ai xoá chính là thứ vừa hỏng. Đã kiểm bằng driver thật — với FK sai, transaction rollback và **hàng sống sót**.
- **Ngoại lệ phải được nêu tên trong test, không bỏ qua trong im lặng.** `profile/mfa/confirm.post.ts` **cố ý không bọc**: nó gọi `setSessionCookie()` giữa lượt ghi và lượt audit, mà cookie là tác dụng phụ lên phản hồi HTTP — **rollback không thu hồi được**. Bọc lại sẽ tạo ra trạng thái tệ hơn: trình duyệt đã cầm cookie cho một lượt bật yếu tố đã bị rollback. `tests/reader-audit-atomicity.test.ts` **khẳng định** cookie vẫn nằm giữa hai lượt ghi, nên nếu ai dời nó đi thì test đỏ và endpoint này phải vào danh sách bọc.

### 22 endpoint quản trị đã bọc, bốn ngoại lệ được nêu tên

`tests/reader-audit-atomicity.test.ts` chặn hai nhóm: 12 hàm service phía người đọc, và **5 endpoint quản trị có lệnh xoá**. Nhóm sau được thêm sau khi đo được 43 endpoint truy vấn thẳng cũng ghi audit mà **39 trong số đó không bọc**. Chỉ nhóm **xoá** được sửa: một lượt audit hỏng sau `update` để lại hàng còn đó, đối chiếu và sửa được; sau `delete` thì không còn gì cả. Sửa nốt 39 chỗ một cách máy móc cũng là 39 cơ hội làm hỏng mã đang chạy đúng — nên phần còn lại do quy ước này quản, không phải một đợt refactor.

Đường ghi audit đã bọc xong ở 22 endpoint quản trị (5 lệnh xoá + 17 lượt tạo/sửa), phát hiện bằng cách **đo** chứ không phải đọc.

- **Bốn endpoint được miễn trừ CÓ NÊU TÊN, và test khẳng định lý do vẫn còn đúng**: `profile/mfa/confirm.post.ts`, `profile/mfa/recovery-codes.post.ts`, `auth/logout.post.ts` đều ghi **cookie HTTP giữa hai lượt ghi CSDL** — cookie là tác dụng phụ lên phản hồi mà rollback không thu hồi được, nên bọc lại sẽ tạo trạng thái tệ hơn (trình duyệt đã cầm cookie cho một thao tác đã bị rollback). `articles/[id]/boost.post.ts` ghi audit qua service dùng chung nên không có cặp cục bộ để bọc. Dời cookie đi chỗ khác là **test đỏ**, và endpoint đó phải vào danh sách bọc.
- **`db.transaction()` phải TRẢ VỀ id sinh ra**, không để biến rò ra ngoài khối. Sáu endpoint tạo mới (`articles`, `media`, `pages`, `page blocks`, `roles`, `users`) khai `insertId` bên trong rồi dùng ở `return` bên ngoài — typecheck bắt được cả sáu.
- **`settings/index.put.ts` bọc CẢ vòng lặp**, không chỉ hai lượt ghi cuối: vòng lặp có thể `throw` 403 giữa chừng (khoá chỉ SuperAdmin sửa được), nên viết rời thì các khoá xử lý trước lúc ném **đã ghi xong và nằm lại** — một lượt lưu bị từ chối vẫn đổi được một phần cấu hình.

### Tầng SERVICE cũng đã bọc, và nó từng là điểm mù của chính bộ test canh gác

Ba danh sách trong `tests/reader-audit-atomicity.test.ts` liệt kê **đường dẫn cụ thể** trong `server/api/admin/**`, nên toàn bộ `server/services/**` nằm ngoài tầm với — trừ sáu service phía người đọc được nêu tên riêng. Đo lại thấy **bảy đường ghi thật** đã sống ở đó không ai canh: `deleteUserById`, `setUserActive`, `deletePageById`, `deleteMediaById`, `deleteSubmissionById`, `updateChatbotSettings`/`clearChatbotApiKey`, và bốn hàm trong `chatbot-small-talk.ts`.

- **Nhóm này nghiêm trọng hơn nhóm endpoint theo một điểm đo được**: cả năm hàm xoá được gọi từ **cả** tuyến xoá một hàng **lẫn** tuyến `bulk-delete`, nên một lượt xoá hàng loạt nhân số cơ hội lỗi lên theo số bản ghi được chọn. `deleteSubmissionById` là ca xấu nhất — nó xoá hồ sơ liên hệ của một công dân, lượt xoá **không đảo được**, và dòng audit là thứ duy nhất còn lại sau đó.
- **`deleteMediaById` chỉ bọc HAI lượt ghi CSDL, không bọc lượt xoá tệp.** Tệp đã bị xoá khỏi đĩa hay khỏi R2 thì rollback không lấy lại được, nên gói nó vào chỉ tạo ra trạng thái tệ hơn: hàng còn nguyên và trông như tệp vẫn ở đó.
- **Guard mới quét CẢ THƯ MỤC, không chỉ liệt kê tên** — đây đúng là phần đợt trước thiếu, và nó thiếu theo cách không nhìn thấy được: một danh sách đường dẫn thì **xanh vĩnh viễn** với bất cứ tệp nào không ai nghĩ ra để thêm vào. Guard tự tìm mọi tệp trong `server/services/` chạm `activityLogs` và đòi mỗi tệp **hoặc** có `db.transaction(`, **hoặc** được nêu tên trong `SERVICE_EXEMPTIONS` kèm lý do. Thêm service mới là buộc phải chọn một trong hai.
- **`chatbot-small-talk.ts` audit qua helper `audit(store, …)` mà THAM SỐ cũng tên `db`**, nên một phép tìm chữ `db.insert(activityLogs)` khớp vào thân helper và báo một lượt ghi trên pool **không tồn tại**. Điều quyết định tính nguyên tử ở đó là **nơi gọi**, và nó có assertion riêng (`audit(db,` phải không còn). Guard đã thu hẹp phạm vi cho đúng.

---

## `slugify` từng có hai bản, cho ra kết quả khác nhau

`server/api/admin/articles/index.post.ts` giữ một bản chép cục bộ thiếu đúng một dòng — phép cắt dấu gạch treo hai đầu — nên `"-- Tin nong --"` sinh slug `-tin-nong-`. Sáu endpoint khác (`categories`, `content-types`, `pages`) đều import bản dùng chung; chỉ đường tạo bài viết là lệch. Hậu quả **vĩnh viễn** vì `articles/[id].put.ts` **không** slugify lại: slug dị dạng đi vào URL công khai `/news/<slug>`, vào email thông báo trả lời bình luận, và vào chỉ mục tìm kiếm. Nay chỉ còn một bản. **Slug dị dạng đã có trong CSDL thì không tự sửa** — và cố ý không backfill: đổi slug là làm chết mọi liên kết đã phát ra ngoài.

- **Đã đo cả hai bản cạnh nhau, và phạm vi hẹp hơn tưởng ban đầu.** Ca em đoán đầu tiên — `"— Tin nóng —"` với gạch ngang em (U+2014) — **không** tái hiện được: ký tự đó bị `[^0-9a-z-\s]` lược cùng khoảng trắng quanh nó, nên `.trim()` dọn sạch. Chỉ **gạch ngang ASCII thật** trong tiêu đề mới lọt qua bộ lọc (nó nằm trong lớp ký tự được giữ) rồi đọng lại ở hai đầu. Ghi ra đây vì một ví dụ sai trong tài liệu còn tệ hơn không có ví dụ: người sau đọc thấy nó, thử ca đó, không tái hiện được, và kết luận cả mục này là tưởng tượng.

---

## `openNewTab` — rơi một trường khi đổi passthrough → allowlist

`app/utils/nav-config.ts` (`tests/nav-config-boundary.test.ts`, 35 test) — cấu hình điều hướng do quản trị viên nhập ở `/admin/content/navigation/*`, đi thẳng vào `v-for` dựng thanh nav của **mọi trang công khai**. Bản cũ chỉ có `try { JSON.parse } catch { null }`: bắt được JSON hỏng cú pháp, **không** bắt được JSON hợp lệ mang hình dạng sai. `[{}]` đi qua trót lọt → `<NuxtLink :to="undefined">` → liên kết chết trên toàn cổng; một mảng rỗng thì **thanh nav biến mất**. Cả hai sau một lượt lưu **thành công**, nên không có gì chỉ vào nguyên nhân. Nay **mọi** dữ liệu không dùng được ra `null` để lùi về bảng mặc định — cấu hình sai nên làm cổng trông như *chưa* cấu hình, không nên làm cổng trông như *bị hỏng*. Kiểm chứng ngược: quay về parser cũ → **15 test đỏ**.

- **⚠️ Việc đổi sang allowlist đã làm RƠI một trường, và nó im lặng: `openNewTab`.** Cán bộ tick ô "Mở tab mới" ở `/admin/content/navigation/navbar.vue`, `navigation.put.ts:35` lưu đúng trường đó, nhưng `normalizeNavItem` **dựng lại node từng trường** và không copy nó — nên trang công khai bỏ qua thiết lập sau một lượt lưu **thành công**, với ô vẫn còn tick lúc tải lại. Không có triệu chứng nào chỉ vào nguyên nhân. Đo được bằng cách **chạy thật** normalizer (`parseNavConfig` trên một mục có `openNewTab: true` → trường biến mất ở cả hai cấp), không phải bằng đọc mã; và nó lọt qua `npm test`, `typecheck`, `db:drift` **và cả 35 test của chính tệp này** — vì không test nào nhắc tới trường đó (`grep -c openNewTab` = 0).
- **Đây là cái giá cố hữu của việc đổi passthrough → allowlist**, không phải một lần bất cẩn: `JSON.parse` giữ **mọi** trường kể cả trường nó không biết, còn allowlist chỉ giữ trường **được nêu tên**. Allowlist đúng hơn về mọi mặt khác — đó là lý do nó tồn tại — nhưng nó biến "thêm một trường nav" thành việc phải sửa **hai** chỗ, và chỗ thứ hai **không báo lỗi khi bị quên**. Thêm trường mới thì thêm ở `interface NavItem`, ở `normalizeNavItem`, **và** một khẳng định trong test.
- Bộ đọc dùng `item.openNewTab === true`, **không** `Boolean(...)`: giá trị đến từ JSON đã lưu nên chuỗi `"false"` là truthy và sẽ **bật** cờ mà cán bộ vừa tắt. Có test chạy qua 6 dạng giá trị không dùng được. Kèm một test soi `default.vue` đòi **mọi** chỗ đặt `target="_blank"` phải đặt kèm `rel="noopener noreferrer"` — thiếu `noopener` thì trang đích **ghi được vào `location`** của cổng, tức một liên kết ngoài do cán bộ cấu hình có thể bị chuyển hướng sang bản sao giả mạo của chính cổng này.
- **Cổng `lang="ts"` nay bắt được chính bug `openNewTab`.** Đã kiểm chứng: xoá trường khỏi `interface NavItem` → **6 lỗi `TS2339` ở `default.vue`**. Trước khi bật `lang="ts"`, hồi quy đó lọt qua `npm test`, `typecheck`, `db:drift` và cả 35 test của chính tệp nav.

---

## `validateIdTokenClaims` — cổng chặn `aud` nay có test

Chữ ký `id_token` **cố ý không kiểm** (xem `reader-features.md` mục Đăng nhập Google), nên `aud` là **thứ duy nhất** từ chối một token thật của Google nhưng phát cho ứng dụng khác — token đó mang chữ ký hợp lệ, issuer hợp lệ, `sub` thật và hạn còn xa. Module được viết ra để kiểm được (docstring nói vậy, và `nowMs` là **tham số** đúng vì "so the expiry branch is testable") rồi **không ai viết test**, nên năm nhánh từ chối chỉ được bảo vệ bằng chính lời văn mô tả chúng. Đã kiểm chứng âm tính: bỏ guard `!expectedClientId` → test đỏ, khôi phục → xanh. Có kiểm cả việc `picture` **không** lọt vào hình dạng trả về (nhúng `lh3.googleusercontent.com` là gửi IP và referrer của mọi khách tới Google trên đúng những trang công dân đọc), và **thứ tự lý do** — `iss` báo trước `aud` khi cả hai sai, vì lý do đó là thứ đi vào log và một người vận hành đọc `google_oauth.login_failed` phải được chỉ vào nguyên nhân thật.

---

## Audit 2026-10-13 — cạnh tranh, thứ tự ghi, lỗi đọc bị nuốt

### Chuyển trạng thái đơn: kiểm và ghi trong cùng một câu lệnh có điều kiện

`changeSubmissionStatus` (`server/services/submission-workflow.ts`) từng đọc trạng thái hiện tại **ngoài** transaction rồi `UPDATE … WHERE id = ?`. Hai cán bộ thao tác cùng lúc đều qua bước kiểm chuyển trạng thái → một chuyển trạng thái bị cấm lọt qua và dòng thời gian ghi sai trạng thái "từ". Nay đọc, kiểm và `UPDATE … WHERE id = ? AND status = <trạng thái đã đọc>` nằm trong transaction, `affectedRows` (qua `readAffectedRows`) bằng 0 → người thua nhận 409; audit + `submission_events` cùng transaction. `tests/submission-workflow-integration.test.ts` chạy hai lượt chuyển **đồng thời** trên MySQL thật: đúng một lượt thắng, nhật ký nhất quán (đột biến `WHERE` chỉ theo id → đỏ). Cùng mẫu với `recordSubmissionView` đã có.

### Kho chatbot: publish/archive/xoá ghi audit trong transaction

Ba thao tác này trong `server/services/chatbot-knowledge.ts` ghi thay đổi và hàng `activity_logs` trên pool (tạo/sửa trong cùng tệp đã bọc nên guard theo tệp vẫn xanh — đúng điểm mù "guard theo tệp" đã mô tả ở trên). Nay mỗi hàm một `db.transaction` + `tx.insert(activityLogs)`; `tests/chatbot-knowledge-audit-atomicity.test.ts` kiểm **theo hàm** bằng DB giả mà lượt insert trên pool ném lỗi.

### Đồng bộ media lên R2: xoá bản local SAU khi URL đã được thay bền vững

Trước: `syncOneToR2` upload, HeadObject rồi **xoá file local ngay**; các lượt thay URL trong bài chỉ gom vào một mảng trong bộ nhớ và áp **một lần ở cuối**. Huỷ giữa chừng, worker ném lỗi, hay container khởi động lại (CI tự deploy mỗi lần merge) → bài vẫn trỏ `/uploads/…` đã mất, `/uploads/[...path]` không lùi về R2 → 404, và lượt chạy lại chỉ chọn hàng còn `local` nên không bao giờ sửa. Thay URL cũng chỉ phủ `articles.content`/`thumbnail_url`.

Nay (`media-sync-files.ts`, `media-sync-rewrite.ts`, `media-sync.ts`):
- Mỗi mục: upload → Head kiểm (hỏng thì ném, hàng không đổi) → **một transaction** gồm đổi hàng `media` có điều kiện + thay URL ở **mọi** bảng đích (bài, bản dịch, `page_blocks` JSON với dạng `\/` đã thoát, trang, phiên bản trang, `home_sections`, `media_items`/livestream thumbnail, `settings`) + audit → **rồi mới** xoá bản local. REPLACE là idempotent nên chạy lại an toàn. Trên MySQL: `REGEXP` không phân biệt hoa thường dưới `utf8mb4_unicode_ci` (cần `(?-i)`), `LIKE` phải thoát `_`, REPLACE vào cột JSON với `"` chưa thoát → lỗi 3140 — `tests/media-sync-rewrite-integration.test.ts` chạy trên MySQL thật.
- Worker giữ `withNamedLock` suốt lượt + mã thế hệ kiểm mỗi lô, nên `forceResetSyncJob` không để worker cũ ghi tiếp. "Sửa URL" (`media-repair.ts`) có bước sửa các mục bị cắt ngang: hàng đã lên R2 mà URL local cũ vẫn còn trong nội dung.
- `media-sync-rewrite.ts` không còn trong `SERVICE_EXEMPTIONS` của `tests/reader-audit-atomicity.test.ts` (audit của nó nay cùng transaction).
- Thay file video (`chunked-upload.ts`): cây cũ nằm ở `media/<uploadId>` chứ không phải `media/<slug>`, và bị `rm` trước khi transaction commit, bỏ qua R2 → mọi lượt thay rò cây cũ. Nay chọn đúng `storagePath`, đẩy vào outbox `media_asset_cleanup` **trong** transaction (giống `deleteMediaItem`), không xoá gì trước commit; `deleteR2Tree` xoá theo ranh giới thư mục (`prefix/`) và từ chối prefix rỗng.

### Đọc công khai hỏng phải là lỗi, không phải "danh sách trống"

Khoảng mười endpoint `server/api/public/**` bắt lỗi CSDL và trả `200 { ok:false, articles: [] }` không log; block công khai không đọc `ok` nên hiện trống, và với `swr: 60` trang dựng lúc CSDL chập chờn có thể được cache như một trang trống hợp lệ. Cache của Nitro không lưu phản hồi `>= 400`. Nay `reportPublicReadFailure(event, name, err)` (`server/utils/public-read-failure.ts`): log sự kiện ổn định + **503** + `cache-control: no-store`, thân giữ hình dạng `ok:false` cũ. Block (`News/RoleModels/Reintegration/DocumentsBlock`) hiện `BlockLoadError.vue` + thử lại; `[slug].vue` không trả 404 khi chỉ là lỗi tải. **Giới hạn còn lại (bản 2026-10-13):** bản thân trang SWR vẫn được cache 200 khi một fetch con hỏng lúc SSR — block tự nạp lại sau mount để lành. Đã đóng phần lớn ở đợt 2026-10-14 (§ "Đợt sửa sau kiểm chứng" bên dưới).

Tìm kiếm (`search.get.ts` + `server/utils/search-paging.ts`): `total`/`totalPages` từng lấy từ lượt đọc bị giới hạn (100 hàng hoặc `limit*2+offset`) nên số trang sai và tăng dần khi lật trang; `%`/`_` lọt vào LIKE. Nay `COUNT(*)` thật mỗi nguồn, cắt lát theo trang, đếm mọi tab, LIKE thoát wildcard.

Spike chỉ mục `(status, type, published_at)` cho danh sách bài: **không thêm** — ở 50k hàng optimizer bỏ qua chỉ mục (hash join với bảng nhỏ → filesort), ở cỡ production (~1.1k hàng) không đổi (5.3 ms → 5.3 ms); chỉ đổi câu truy vấn/gợi ý mới có lợi. Đó là việc riêng.

### Analytics: giờ UTC trên pool chung

`analytics-noc.ts`/`analytics-reporting.ts` từng mở **một pool mới mỗi lượt gọi** (pool riêng `timezone '+00:00'`, dashboard hỏi 15 s/lần). Pool chung dùng `'+07:00'`, và mysql2 định dạng tham số `Date` theo timezone **của kết nối** (chỉ phần đọc kết quả nhận `timezone` theo từng truy vấn) → cần bộ chuyển `server/utils/utc-query.ts`: tham số `Date` đổi thành chuỗi UTC, đọc kết quả với `timezone: '+00:00'`, trên `getPool()`. Bộ giới hạn page-view chuyển sang store chung (`rate_limit_counters`, 120 lượt/60 s, cửa sổ cố định). Hai nơi ghi `analytics_noc_minute_aggregates` (`analytics-noc.ts` có trần `LEAST(…)`, cộng `eventCount`; `analytics-ingestion-noc.ts` cộng 1, xử lý thời lượng > 24 h khác) **chưa hợp nhất** — ngữ nghĩa khác nhau, chưa chứng minh tương đương.

## Đợt sửa sau kiểm chứng (2026-10-14, F1–F6)

### Bộ lọc ngày ở admin là NGÀY LỊCH Việt Nam

`<input type="date">` gửi `YYYY-MM-DD` — một ngày lịch cán bộ đọc theo giờ VN, không phải một thời điểm. Ba lỗi cùng gốc ở `ai/logs`, `chatbot/sessions`, `activity-logs`: `new Date('2026-10-14')` là 00:00 UTC = 07:00 VN (mất 7 giờ đầu ngày); `setHours(23,59,59,999)` và `'…T00:00:00'` không múi giờ tính theo `TZ` của tiến trình (kết quả đổi theo container); `to=YYYY-MM-DD` đọc thành 00:00 của chính ngày đó (ngày cuối bị loại hẳn). Nay `server/utils/vn-day-range.ts`: `[ngày đầu 00:00 +07:00, ngày sau ngày cuối 00:00 +07:00)`, so `lt` chứ không `lte`, giá trị không phải ngày → 400; `users/activity.vue` gửi ngày trần. **Điều kiện tiên quyết:** phiên MySQL chạy UTC (`time_zone=SYSTEM=UTC`, đã kiểm chỉ đọc) — đổi múi giờ phiên thì mốc lệch theo. `profile/history.get.ts` cùng mẫu cũ, chưa đổi; `analytics.vue` cố ý dùng ngày UTC. Test: `tests/admin-date-filters-vn-day.test.ts`, `tests/ai-logs-date-filter.test.ts`.

### Đồng bộ media: "một tham chiếu tới ảnh X" là gì

Bản 2026-10-13 thay URL ở một danh sách cột hẹp và không có quy tắc ranh giới cuối URL (`a.jpg` phải không khớp bên trong `a.jpg.webp`), còn `settings.value` (logo, favicon, og-image), `chat_messages`, `page_versions`, câu trả lời chatbot, `social_links.icon`… không được thay, nên bản local bị xoá trong khi các chỗ đó vẫn trỏ tới nó. Nay `server/services/media-sync-url-match.ts` giữ **27 cột đích** (mỗi cột ghi lý do) và **một** định nghĩa ranh giới cuối URL cho cả bản SQL (`REGEXP_REPLACE`) lẫn bản JS (bộ dò của lượt vá) — hai bản lệch nhau thì hoặc thay mà không thấy, hoặc thấy mà không thay. Sau commit, `findRemainingReferences` còn thấy tham chiếu → **giữ** bản local và log `media.sync_old_copy_kept_referenced` thay vì xoá. Trước khi đổi hàng, kiểm đường dẫn đích chưa thuộc hàng khác (bỏ qua hàng đó). Viết lại `settings` thì xoá cache favicon/og-image. Chi phí đo trên dữ liệu dev (3705 hàng media): ≈ +0,4–0,5 s mỗi hàng → ≈ 25–30 phút thêm cho một lượt đồng bộ đầy đủ. `tests/media-sync-rewrite-integration.test.ts` đỏ trên mã cũ (settings không được thay).

Còn mở: bản cũ được giữ không bao giờ bị dọn sau; tệp trùng tên từ tháng khác chặn hàng đó đồng bộ; viết lại làm tràn `VARCHAR` → hàng đó rollback mỗi lượt; SWR có thể phục vụ trang trỏ tới bản cũ vừa xoá tới 60 s.

### Trang lỗi không được vào bộ đệm

Lượt kiểm chứng đo trên bản build với CSDL không với tới: 12 API công khai đã trả 503 + `no-store`, nhưng **trang** `/`, `/about`, `/contact`, `/<slug>` vẫn 200 kèm `s-maxage=60` — nhánh lỗi trong HTML được phát lại cho mọi người. Hai nguyên nhân: trang không đặt mã lỗi, và bộ bọc swr của Nitro **ghi đè** `cache-control` bằng `s-maxage=60, stale-while-revalidate` sau khi handler trả về, bất kể mã trạng thái (cache của Nitro tự không lưu ≥ 400, nhưng CDN thì có). Nay trang dùng `useSsrFailureStatus` (`app/utils/ssr-failure-response.ts`) → 503, và `server/plugins/error-no-store.ts` móc `beforeResponse` (chạy sau bộ bọc swr, trước khi ghi thân) đặt lại `no-store` cho mọi phản hồi ≥ 500 — `render:response` hay middleware đều chạy quá sớm. `reportPublicReadFailure` thêm cho `media/index`, `livestream/active`, `livestream/chat/history`; log không còn chứa tham số Drizzle. Đo lại ở lượt kiểm cuối (2026-10-14): `/`, `/about`, `/contact`, `/media`, `/news`, `/news/<x>`, `/documents`, `/role-models`, `/reintegration-models` → 503 + `no-store`; **`/legal-qa` vẫn 200** (không header cache).

Đợt G1–G3 (2026-10-14) đóng ba lỗ còn lại: `/legal-qa` gọi `useSsrFailureStatus`; nhánh hai đoạn của `[slug].vue` quyết định bằng `resolveCategoryRoute` (tra chuyên mục hỏng → `BlockLoadError` + 503, không rơi sang `ArticleDetail`); `ArticleDetail.vue` tách "không có" khỏi "không tải được" bằng `resolveDetailFetch` — bài thật không có → 404 + "Không tìm thấy" (trước đây cả hai đều là cảnh báo + Thử lại với HTTP 200, nên lỗi tải được SWR phát lại và 404 thật bị báo là lỗi), lỗi tải → 503 + `no-store` + Thử lại (`useSsrFailureStatus` tuỳ chọn `notFound`). Đo lại trên bản build (CSDL không với tới): thêm `/legal-qa`, `/news/<x>/<bài>`, `/video/<x>`, `/role-models/<x>` → 503 + `no-store`. Với CSDL khoẻ, trang 404 trên tuyến `swr` (`/news/**`, `/role-models/**`…) vẫn mang `s-maxage=60` — còn mở.

Còn mở: `rate_limit.database_read_failed` không giới hạn tần suất log (`rate_limit.database_write_failed` của store chung — page-view, đăng nhập… — nay tối đa 1 dòng/phút kèm số lần bị nén); `analytics-maintenance.ts` vẫn tự `createPool`.

## Đợt 2 — 2C hiệu năng (2026-10-24)

OpenSpec `wave2-hardening` nhóm 4, design D6 + D8. Tóm tắt thay đổi → `docs/CHANGELOG.md` § 35. Ở đây là vì sao và số đo.

### "Đọc nhiều" đọc tổng duy trì sẵn (D6)

`GET /api/public/articles?sort=views` từng cộng `article_view_daily` trong một truy vấn con tương quan cho **mọi** bài đã xuất bản của thể loại, rồi chạy thêm `COUNT(*)` cho một khối phân trang không ai đọc. Nay `articles` giữ `view_total_real`/`view_total_fabricated` (hai cột riêng — bất biến trung thực của `article-views.ts`) và `view_total` = tổng, cột sinh STORED có index `articles_status_type_views_idx (status, type, view_total, published_at, created_at)`.

**Hai cột luôn bằng tổng hàng theo ngày vì cấu trúc, không vì quy ước:** chỉ `recordArticleView`/`addFabricatedViews` ghi, và cộng tổng trong cùng transaction với upsert hàng ngày. Ba chi tiết đã đo/đã trả giá:
- **Thứ tự khoá: `articles` trước.** Chèn một hàng `article_view_daily` mới lấy khoá S trên hàng `articles` cha (kiểm FK). Nếu cộng tổng sau, hai transaction cùng bài (hai nguồn lượt xem đầu ngày; lượt xem thật cạnh lượt giao boost) mỗi bên giữ S, chờ X của bên kia → deadlock, và `view.post.ts` nuốt lỗi nên lượt xem mất im lặng. Lấy X trên `articles` trước thì các transaction cùng bài xếp hàng.
- **`updated_at = updated_at`** trong mọi câu UPDATE `articles` của đường đếm và của lượt điền: cột `ON UPDATE CURRENT_TIMESTAMP`; MySQL để yên cột tự cập nhật khi câu lệnh gán nó tường minh.
- **Bản dump trong app bỏ cột sinh** (`backup-sql.ts`): `SELECT *` → `INSERT` từng ghi cả `view_total`, và MySQL từ chối mọi giá trị cho cột sinh (lỗi 3105) — mọi bản sao lưu sau 2C, kể cả `pre-restore`, sẽ không khôi phục được. Nay liệt kê cột theo `information_schema.COLUMNS` với `EXTRA NOT IN ('STORED GENERATED','VIRTUAL GENERATED')` — **không** `LIKE '%GENERATED%'`: trên 8.0.46 `created_at`/`updated_at` mang `DEFAULT_GENERATED` (đã kiểm), lọc lỏng sẽ đánh rơi mọi mốc thời gian và bản khôi phục nhận NOW() im lặng. `scripts/backup-db.sh` (mysqldump) vốn đã bỏ cột sinh.

**Lượt điền một lần** khoá theo trạng thái lược đồ: index `articles_status_type_views_idx` chưa có (dò trước ba `ensureColumn`, index thêm sau lượt điền). Lý do chọn index thay cho "cột vừa được thêm": một lượt khởi động chết giữa `ADD COLUMN` và `UPDATE` thì lượt sau vẫn thấy thiếu index và điền lại; khoá theo cột thì tổng = 0 mãi mãi. Hệ quả có lợi: khôi phục một bản dump **trước 2C** (bảng `articles` không có ba cột) thì lần khởi động kế tiếp điền lại tổng từ hàng theo ngày vừa khôi phục. **Còn mở:** khôi phục trong app không chạy di trú sau đó, nên từ lúc khôi phục bản trước 2C tới lần khởi động lại, mọi lượt đọc `articles.view_total` và mọi lượt đếm báo lỗi (cùng lớp vấn đề với mọi cột thêm bằng `ensureColumn`; đề xuất: chạy `applyAdditiveMigrations` sau khôi phục).

**Index 5 cột, không phải 3 cột như chữ của D6 — lệch có chủ đích, theo EXPLAIN.** Spec đòi hoà thì xếp theo ngày đăng, nên câu sắp `view_total DESC, published_at DESC, created_at DESC`. Với index `(status, type, view_total)` của D6, optimizer **không dùng nó** cho câu đó: chọn `articles_status_type_pub_idx` rồi filesort mọi bài cùng thể loại (đo ở cả 1100 và 5000 bài) — tức mỗi lượt xem trả phí cập nhật một index không ai đọc. Thêm hai cột phá hoà (giữ nguyên tiền tố và tên) thì MySQL đọc ngược thẳng trên index, dừng ở hàng thứ 6. Tên giữ nguyên nên điều kiện kích hoạt lượt điền và các test không đổi; `ensureIndex` chỉ so **tên** — một CSDL dev từng chạy bản 3 cột của nhánh này phải tự `DROP INDEX` (chưa CSDL thật nào có bản 3 cột).

Đo trên CSDL dùng một lần của MySQL dev (8.0.46, đĩa btrfs, `innodb_flush_log_at_trx_commit=2`), bài 20 KB nội dung, 30 hàng `article_view_daily` mỗi bài, script đo tạm `view-totals-measure.ts` (giả lập bản trước 2C rồi gọi `convergeArticleViewTotals`):

| cỡ | bảng `articles` | "Đọc nhiều" cũ (truy vấn con) + `COUNT` | mới, index 3 cột (D6) | mới, index 5 cột (bản giao) | lượt nâng cấp (một lần) | khởi động lần hai |
|---|---|---|---|---|---|---|
| 1 100 bài / 33 000 hàng ngày (cỡ production) | 34,8 MB | 14,0 ms + 0,4 ms | 0,88 ms — `articles_status_type_pub_idx` + filesort | **0,28 ms** — `articles_status_type_views_idx (reverse)` | 3,6 s | 2 ms |
| 5 000 bài / 150 000 hàng ngày | 158,8 MB | 63,7 ms + 0,8 ms | 3,7 ms — `pub_idx` + filesort | 0,27 ms (index thăm dò cùng cột) | 23,0 s | 2 ms |

Cả hai cỡ: top-6 cũ = top-6 mới, 0 bài lệch tổng sau lượt điền, 0 bài đổi `updated_at`. **Rủi ro deploy:** lượt nâng cấp chạy trong CMD của container (`init.ts` trước khi server lên) và dựng lại bảng `articles` một lần (thêm cột sinh STORED = ALGORITHM=COPY, giữ khoá ghi trên bảng suốt lượt đó). Healthcheck của image có `start-period=45s` + 3 lần × 30 s, `deploy-remote.sh` chờ 300 s — 3,6 s ở cỡ production (23 s ở 5 000 bài) nằm gọn trong đó.

### Ghi analytics: thứ tự câu lệnh trong transaction (D8) — đo, rồi lệch khỏi chữ của D8

D8 viết: "upsert `total` cuối cùng" để rút thời gian giữ hàng nóng. Đo cho thấy chữ đó **làm mất ~37 % lượt xem**. Nguyên nhân (bản dump `SHOW ENGINE INNODB STATUS`, rút gọn):

```
*** (1) TRANSACTION: INSERT INTO analytics_live_minute_buckets (…'device_class','desktop'…) ON DUPLICATE KEY UPDATE …
*** (1) HOLDS THE LOCK(S):   index PRIMARY … lock_mode X            (heap no 1 = supremum)
*** (1) WAITING FOR THIS LOCK: index PRIMARY … lock_mode X insert intention waiting (supremum)
*** (2) TRANSACTION: INSERT INTO analytics_live_minute_buckets (…'source_category','direct'…) ON DUPLICATE KEY UPDATE …
*** (2) HOLDS / WAITING: giống hệt (1)
*** WE ROLL BACK TRANSACTION (2)
```

`analytics_live_minute_buckets` (và `analytics_live_deduplication`) có PK tự tăng cạnh khoá tự nhiên `(bucket_start, scope_type, scope_value_hash[, visitor_token])`. `INSERT … ON DUPLICATE KEY UPDATE` ở đó giữ khoá X next-key trên **supremum của PK** tới commit. Khi upsert bucket đầu tiên của mỗi transaction là hàng **chung** (`total` của phút), nó tuần tự hoá pha bucket; khi là hàng riêng (`path`…), hai transaction cùng giữ supremum rồi chờ nhau ở upsert thứ hai.

**Bộ mô phỏng** (cùng SQL với `analytics-ingestion.ts`, pool 10, hình dạng production 4 scope `total/path/source_category/device_class`, MySQL 8.0.46 image production — `innodb_flush_log_at_trx_commit=2`, `sync_binlog=1` — datadir tmpfs để fsync không lấn át):

Lượt ngắn (3000 transaction, < 1 phút, không qua mốc phút):

| thứ tự | đồng thời | deadlock | commit/s | p95 ms |
|---|---|---|---|---|
| cũ (`3ede49a`): `total` đầu, dedupe/bucket xen kẽ | 10 | 85 | 558 | 23,9 |
| chữ D8: xen kẽ, `total` cuối | 10 | 1108 | 509 | 33,5 |
| dedupe trước, `total` cuối (bản cài đầu tiên) | 10 | 1145 | 504 | 28,5 |
| **dedupe trước, `total` đầu (bản giao)** | 10 | **0** | **705** | **20,4** |
| cũ | 40 | 92 | 524 | 93,4 |
| chữ D8 | 40 | 1083 | 496 | 80,3 |
| dedupe trước, `total` cuối | 40 | 1114 | 602 | 59,7 |
| **dedupe trước, `total` đầu** | 40 | **0** | **947** | **53,4** |

Lượt dài 185 s (qua 3 mốc phút; khách lặp lại trong phút → `INSERT IGNORE` trùng lấy khoá S next-key):

| thứ tự | đồng thời | transaction | deadlock | tỉ lệ hỏng | commit/s | p95 / p99 ms |
|---|---|---|---|---|---|---|
| cũ | 10 | 159 106 | 60 047 | 37,7 % | 535 | 21,4 / 99 |
| **dedupe trước, `total` đầu** | 10 | 159 353 | 6 234 | **3,9 %** | **828** | 20,7 / 33,2 |
| cũ | 40 | 181 156 | 70 889 | 39,1 % | 595 | 62,3 / 164,1 |
| **dedupe trước, `total` đầu** | 40 | 102 335 | 2 390 | **2,3 %** | 539 | 258 / 397 |

Đọc bảng: thứ tự cũ cũng deadlock nặng khi tải kéo dài (lượt ngắn 3000 transaction che mất điều đó); bản giao giảm deadlock ~10–17 lần nhưng **không về 0**; ở 40 đồng thời đuôi trễ của bản giao dài hơn vì giao dịch chờ khoá thay vì chết sớm (thứ tự cũ "nhanh" một phần nhờ 39 % chết ngay). Máy đo chia sẻ CPU với các tác tử khác (load ≈ 8/8 lõi lúc chạy bộ mô phỏng) — số tuyệt đối dao động, tỉ lệ deadlock thì không.

**Qua endpoint thật** (`POST /api/public/analytics/page-view`, hai bản build `nuxt build` cạnh nhau chỉ khác `analytics-ingestion.ts` — "trước" = thứ tự của `3ede49a`; app pool 10, rate limit thật, NOC thật, mỗi yêu cầu một `X-Forwarded-For` ngẫu nhiên để không chạm trần 120/phút/IP, User-Agent trình duyệt; MySQL 8.0.46 dùng một lần từ image production; xen kẽ trước/sau, mỗi lượt 75 s (qua mốc phút), bảng analytics xoá trắng trước mỗi lượt; máy rảnh, load ≈ 0,3):

Datadir tmpfs (fsync ≈ 0 — tách riêng thời gian giữ khoá khỏi chi phí đĩa), 2 vòng:

| bản | đồng thời | nhận/s | p50 / p95 / p99 ms | 500 (deadlock) | thời gian chờ khoá hàng |
|---|---|---|---|---|---|
| trước | 1 | 206–214 | 4,3–4,6 / 5,9–6,6 / 9,8–13 | 0 | 0 |
| sau | 1 | 178–209 | 4,3–5,1 / 6,7–8,1 / 11–23 | 0 | 0 |
| trước | 10 | 460 / 467 | 20 / **29,6–29,7** / 41–43 | 22 / 39 | 572 s / 572 s |
| **sau** | 10 | **572 / 544** | 17 / **23,1–25,6** / 30–33 | **0 / 0** | **468 s / 469 s** |
| trước | 40 | 484 / 492 | 79–80 / 101–102 / 119–121 | 41 / 40 | 601 s / 602 s |
| **sau** | 40 | **573 / 548** | 67–70 / 90–96 / 105–122 | **0 / 0** | **520 s / 520 s** |

Datadir trên đĩa (độ bền như production: `innodb_flush_log_at_trx_commit=2`, `sync_binlog=1`, binlog bật), 1 vòng — **bị fsync lúc commit chi phối**: một lượt xem có ba commit (rate limit, transaction ghi, NOC), mỗi commit một fsync binlog trên btrfs:

| bản | đồng thời | nhận/s | p50 / p95 ms | 500 |
|---|---|---|---|---|
| trước | 1 | 14 | 79 / 118 | 0 |
| sau | 1 | 12 | 89 / 132 | 0 |
| trước | 10 | 18 | 541 / 642 | 0 |
| sau | 10 | 17 | 589 / 735 | 0 |
| trước | 40 | 18 | 2265 / 2478 | 0 |
| sau | 40 | 30 | 1219 / 2238 | 0 |

Khác biệt trên đĩa nằm trong nhiễu (thứ tự câu lệnh không đổi số fsync).

**Ngưỡng batching của D8 (p95 > 50 ms).** tmpfs ở 10 đồng thời (≈ pool): p95 23–26 ms — dưới ngưỡng. Ở 40 đồng thời p95 90–96 ms, nhưng phần lớn là chờ một trong 10 kết nối pool. Trên đĩa btrfs của máy dev p95 vượt ngưỡng **ngay ở 1 đồng thời** (118–132 ms) vì fsync binlog mỗi commit — batching (gộp nhiều lượt xem vào một commit) chính là thứ giảm được chi phí đó, nhưng con số này là của đĩa máy dev, không phải VPS. **Không làm batching trong 2C**; đề xuất đo p95 của endpoint này trên VPS (log thời gian của nginx) trước khi quyết.

**Gốc rễ (đề xuất, ngoài phạm vi 2C):** cho hai bảng live dùng khoá tự nhiên làm PRIMARY KEY (bỏ `id` tự tăng). Không còn supremum chung thì mọi thứ tự đều không deadlock vì lý do này, và "hàng nóng cuối" của D8 mới thực sự rút được thời gian giữ khoá. Đổi PK trên bảng đang ghi liên tục cần một lượt chuyển riêng.

---

<a id="media-category-restore"></a>

## Khôi phục danh mục video sau lỗi xoá lúc khởi động (2026-09-22 → bản vá)

**Lỗi.** Từ `69a84eb` (2026-09-22) tới bản vá `fix-media-category-wipe-on-boot`, `applyAdditiveMigrations` chạy `UPDATE media_items SET category_id = NULL` **vô điều kiện**, rồi drop/add `fk_media_items_category` theo tên. Khối đó chạy ở **mọi** lần container khởi động (Dockerfile CMD: `init.ts` → `seed.ts` → server): mỗi lượt CI deploy, mỗi `manage.sh` Update, mỗi lần `restart: always` sau sự cố. Danh mục cán bộ gán cho video chỉ sống tới lần khởi động kế tiếp; riêng 2026-10-23 có bốn lượt deploy.

**Bản vá** (`convergeMediaCategoryForeignKey`, `server/db/migrations-additive.ts`):
- Lượt chuyển `categories` → `media_categories` khoá theo **trạng thái lược đồ**. Nó chỉ chạy khi trên cột `media_items.category_id` còn FK trỏ `categories` (đọc theo cột, không theo tên), và lượt chuyển tự xoá điều kiện đó.
- CSDL đã chuyển không nhận lệnh `UPDATE`/`ALTER` nào vào `media_items` từ khối này.
- Không bao giờ xoá theo giá trị: id thể loại bài viết cũ 1–7 trùng id danh mục video được seed 1–4.
- Thiếu FK mà có giá trị treo: giữ giá trị, không thêm FK, log `db.migration.media_category_fk_blocked` (`{ danglingRows }`), app vẫn khởi động.
- Khoá bằng `tests/media-category-migration-integration.test.ts` (MySQL thật, đỏ trên mã cũ).

**Giá trị đã mất không tự về.** Không có khôi phục tự động: cần người chọn bản sao lưu, và giá trị phải được đối chiếu với `media_categories` hiện tại. Quy trình dưới đây chỉ **đọc** bản dump trong một CSDL nháp, và chỉ điền những hàng đang `NULL` ở CSDL thật.

> ⛔ **Không bao giờ nạp bản dump vào CSDL production** cho việc này — không `restore-db.sh --replace`, không nút khôi phục trong admin. Làm vậy là đưa **mọi** bảng về thời điểm dump. Chỉ nạp vào CSDL nháp.
>
> ⛔ **Không bao giờ lùi về image cũ hơn bản vá**, kể cả lượt lùi tự động của `deploy-remote.sh` khi healthcheck hỏng. Lần khởi động đầu của image cũ sẽ xoá danh mục lại, kể cả giá trị vừa khôi phục. Image mới không khởi động được vì lý do khác thì sửa tiến, đừng lùi.

Các lệnh bên dưới chạy trên VPS, trong thư mục repo. Mật khẩu MySQL đi qua `MYSQL_PWD` theo **tên biến**, không bao giờ `-p<mật khẩu>` (lộ trong `ps`), cùng cách với `scripts/verify-restore.sh`:

```bash
cd /www/wwwroot/conduonghuongthien
set -a; source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env); set +a
LIVE="${MYSQL_DATABASE:-cdkt_admin}"
DB_CONTAINER="${MYSQL_CONTAINER:-cdkt_mysql}"
KEEP=/root/cdkt-category-restore    # thư mục giữ bản sao lưu của bước 0 — cùng đường dẫn ở MỌI phiên
dexec() { MYSQL_PWD="$MYSQL_ROOT_PASSWORD" docker exec -e MYSQL_PWD "$@"; }
```

Khối này phải chạy lại ở mỗi phiên shell mới, vì bước 0 làm hôm nay còn bước 1–7 làm sau khi deploy. `KEEP` là một đường dẫn cố định có chủ đích: một tên có ngày tháng sẽ trỏ sang thư mục rỗng khác ở phiên sau.

### 0. Giữ lại bản sao lưu NGAY — chép ra khỏi vòng xoay

Làm **hôm nay**, kể cả trước khi bản vá được merge. Cả hai loại sao lưu nằm trong `./backups` của repo (bind mount `/app/backups`), và cả hai đang bị xoay vòng:
- `scripts/backup-db.sh` ghi `cdkt-<db>-<stamp>-<pid>.sql.gz` và xoá bản cũ hơn `BACKUP_KEEP_DAYS` (mặc định 14 ngày).
- Sao lưu trong app ghi `cdkt-<stamp>-<trigger>.sql.gz` và chỉ giữ `backup_keep_count` bản (mặc định 14).

Vòng xoay đang xoá đúng những bản có thể còn giữ danh mục đã mất.

```bash
mkdir -p "$KEEP" && chmod 700 "$KEEP"
cp -a backups/*.sql.gz "$KEEP"/
ls -l --time-style=full-iso "$KEEP"
```

Tốt hơn nữa: chép thêm một bản ra ngoài VPS (`scp`/`rsync` về máy khác). Thư mục `$KEEP` nằm ngoài `./backups`, nên không vòng xoay nào chạm tới nó.

### 1. Xác nhận image đã vá đang chạy, và không có lượt lùi nào đang chờ

- Lượt CI deploy của commit vá phải xanh (tab Actions hoặc `gh run list --branch main`), và container healthy: `docker inspect -f '{{.State.Health.Status}} {{.State.StartedAt}}' cdkt_app`.
- Cột chỉ còn **một** FK, trỏ `media_categories (id) ON DELETE SET NULL`: `dexec "$DB_CONTAINER" mysql -u root "$LIVE" -e 'SHOW CREATE TABLE media_items\G'`.
- Gán thử danh mục cho một video, chạy `docker compose restart app`, rồi kiểm danh mục còn nguyên.
- Log khởi động không có sự kiện chặn: `docker logs cdkt_app 2>&1 | grep media_category_fk_blocked`. Nếu có thì dừng: cột đang thiếu FK và có giá trị trỏ tới danh mục không tồn tại, cần xem tay trước.

### 2. Sao lưu mới ngay trước khi ghi

```bash
./scripts/backup-db.sh "$KEEP/truoc-khoi-phuc"   # dòng JSON `succeeded` in đường dẫn tệp
```

Thư mục đích riêng là có chủ đích. `backup-db.sh` xoay vòng **thư mục đích của nó**, xoá `cdkt-<db>-*.sql.gz` cũ hơn `BACKUP_KEEP_DAYS` theo mtime, và `cp -a` ở bước 0 giữ nguyên mtime cũ. Vì vậy **đừng bao giờ** dùng chính `$KEEP` (hay `./backups`, nếu chưa làm bước 0) làm đích.

### 3. Chọn bản dump ứng viên

- **Mới hơn 2026-09-22 14:23 (+01:00).** Bản cũ hơn chưa có bảng `media_categories`, và giá trị trong đó là id thể loại **bài viết**. Câu lệnh ở bước 5 sẽ báo lỗi bảng không tồn tại, nên bản đó không bao giờ được dùng nhầm.
- **Chụp SAU khi cán bộ gán danh mục, và TRƯỚC lần khởi động kế tiếp.** Mỗi lần khởi động là một lần xoá. Đặt thời điểm của bản dump cạnh lịch khởi động để chọn:
  - các lượt deploy CI: `gh run list --workflow ci.yml --branch main --json createdAt,conclusion`;
  - các lần chạy `manage.sh` Update;
  - số lần restart vì sự cố: `docker inspect -f '{{.RestartCount}}' cdkt_app`;
  - mốc khởi động in trong log, chỉ tính từ lần container được tạo gần nhất: `docker logs --timestamps cdkt_app 2>&1 | grep 'Checking & Creating MySQL tables'`.
- Bản tốt nhất thường là bản sao lưu đêm (03:00) sau một ngày làm việc không có deploy.
- Không chắc thì cứ thử. Bước 5 cho biết chính xác bản đó khôi phục được những video nào. Thử từ bản **mới nhất** về cũ, và lặp lại bước 4–7 cho từng bản: điều kiện `IS NULL` bảo đảm bản sau không đè giá trị bản trước đã điền.

### 4. Nạp bản dump vào CSDL NHÁP trên cùng MySQL — không bao giờ vào CSDL thật

```bash
DUMP="$KEEP/cdkt-cdkt_admin-20261020T030000Z-12345.sql.gz"   # bản đã chọn (ví dụ)
SCRATCH=cdkt_catrestore_20261020                              # tên nháp, KHÁC "$LIVE"
test "$SCRATCH" != "$LIVE" && echo "tên nháp OK"

# 4a. Dump phải nạp được, và KHÔNG tự chọn CSDL. Một dòng `USE`/`CREATE DATABASE`
#     sẽ ghi vào CSDL khác chứ không ở lại trong nháp. Script này kiểm cả hai, nạp
#     thử vào một CSDL kiểm riêng rồi tự xoá CSDL đó. Phải in `restore_check.succeeded`.
./scripts/verify-restore.sh "$DUMP"

# 4b. Nạp vào nháp.
dexec "$DB_CONTAINER" mysql -u root -e "CREATE DATABASE \`$SCRATCH\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
gzip -dc "$DUMP" | dexec -i "$DB_CONTAINER" mysql -u root --default-character-set=utf8mb4 "$SCRATCH"
```

### 5. Xem trước (dry-run), rồi mới UPDATE

Mở phiên trên CSDL **thật**: `dexec -it "$DB_CONTAINER" mysql -u root --default-character-set=utf8mb4 "$LIVE"`. Trong các câu SQL dưới đây, thay `cdkt_catrestore_20261020` bằng tên nháp của bước 4.

Video được ghép trên **id + slug** của video (slug video không sửa được sau khi tạo, nên một id bị dùng lại cho video khác sẽ không khớp). Danh mục được ghép trên **id + slug** của danh mục: danh mục đã xoá, hoặc id đã bị dùng lại cho danh mục khác, sẽ bị từ chối. `WHERE mi.category_id IS NULL` bảo đảm không bao giờ đè danh mục cán bộ đã gán lại sau bản vá.

```sql
-- 5a. Những video SẼ được điền lại, và điền danh mục nào.
SELECT mi.id, mi.title, s.category_id AS restore_to, pc.name AS category_name
FROM media_items mi
JOIN cdkt_catrestore_20261020.media_items s ON s.id = mi.id AND s.slug = mi.slug
JOIN cdkt_catrestore_20261020.media_categories sc ON sc.id = s.category_id
JOIN media_categories pc ON pc.id = sc.id AND pc.slug = sc.slug
WHERE mi.category_id IS NULL
ORDER BY mi.id;

-- 5b. Video bản dump có danh mục nhưng KHÔNG được điền: video đã xoá hoặc id thuộc
--     video khác, danh mục đã xoá, hoặc id danh mục nay là danh mục khác.
SELECT s.id, s.title, s.category_id AS dump_category, sc.slug AS dump_slug, pc.slug AS live_slug,
       mi.slug AS live_video_slug
FROM cdkt_catrestore_20261020.media_items s
LEFT JOIN cdkt_catrestore_20261020.media_categories sc ON sc.id = s.category_id
LEFT JOIN media_items mi ON mi.id = s.id
LEFT JOIN media_categories pc ON pc.id = s.category_id
WHERE s.category_id IS NOT NULL
  AND mi.category_id IS NULL
  AND (mi.id IS NULL OR mi.slug <> s.slug OR pc.id IS NULL OR pc.slug <> sc.slug)
ORDER BY s.id;
```

Cho cán bộ duyệt danh sách 5a. Danh mục trong bản dump là giá trị **tại lúc dump**: cán bộ có thể đã đổi nó sau đó, và giá trị mới hơn đã bị xoá trước khi kịp vào bản dump nào. Rồi ghi trong một transaction, và chỉ `COMMIT` khi số hàng khớp với 5a:

```sql
START TRANSACTION;
UPDATE media_items mi
JOIN cdkt_catrestore_20261020.media_items s ON s.id = mi.id AND s.slug = mi.slug
JOIN cdkt_catrestore_20261020.media_categories sc ON sc.id = s.category_id
JOIN media_categories pc ON pc.id = sc.id AND pc.slug = sc.slug
SET mi.category_id = s.category_id
WHERE mi.category_id IS NULL;
SELECT ROW_COUNT() AS restored;   -- phải bằng số dòng của 5a
COMMIT;                           -- hoặc ROLLBACK nếu không khớp
```

Đã chạy thử trên CSDL dùng một lần (2026-10-23). Kết quả đúng như mô tả:
- 5a chỉ điền các video có cả video lẫn danh mục còn khớp.
- 5b liệt kê ba ca bị từ chối: danh mục đã xoá, slug danh mục đổi, id video thuộc video khác.
- UPDATE không đè video đã được gán lại.

### 6. Video không khôi phục được: danh sách để cán bộ gán lại bằng tay

Nhật ký kiểm toán chỉ ghi **rằng** danh mục đã được đặt, không ghi **danh mục nào**: `createMediaItem` ghi `meta.hasCategory`, `updateMediaItem` ghi `meta.changed` có `"categoryId"`. Cán bộ phải tự chọn giá trị. `changed` cũng chứa `categoryId` khi cán bộ **bỏ** danh mục, nên đây là danh sách ứng viên, không phải danh sách chắc chắn.

```sql
SELECT mi.id, mi.title, al.action, al.created_at, al.user_id
FROM activity_logs al
JOIN media_items mi ON mi.id = al.resource_id
WHERE al.resource = 'media_portal'
  AND mi.category_id IS NULL
  AND (
    (al.action = 'create' AND JSON_EXTRACT(al.meta, '$.hasCategory') = true)
    OR JSON_CONTAINS(JSON_EXTRACT(al.meta, '$.changed'), '"categoryId"')
  )
ORDER BY mi.id, al.created_at;
```

`activity_logs` là một scope của data retention, nên hàng cũ có thể đã bị dọn và danh sách này có thể thiếu.

Nếu không bản dump nào khớp (mọi bản đều chụp sau một lần khởi động), chỉ còn danh sách này. Khi đó hãy nói rõ với cán bộ rằng giá trị trong khoảng đó không khôi phục được.

### 7. Xoá CSDL nháp

```bash
dexec "$DB_CONTAINER" mysql -u root -e "DROP DATABASE IF EXISTS \`$SCRATCH\`"
dexec "$DB_CONTAINER" mysql -u root -N -e "SHOW DATABASES LIKE 'cdkt\_catrestore\_%'"   # phải rỗng
```

Giữ thư mục `$KEEP` tới khi cán bộ xác nhận xong, rồi xoá; nó chứa dữ liệu cá nhân của toàn site.
