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
