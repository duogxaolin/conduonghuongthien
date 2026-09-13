# Realm Safety — diễn giải vì-sao

Phần này bổ sung cho `CLAUDE.md` mục "Vận hành & an toàn" (favicon, upload, drift) và "Hạn chế đã biết" (kiểu, runtimeConfig).
Quy tắc hành động nằm trong `CLAUDE.md`; tệp này giữ **lý do và tiền sử bug**.

---

## Favicon cấu hình được — chưa từng hoạt động từ commit đầu tiên

Cổng này chưa từng có favicon nào hoạt động, từ commit đầu tiên. `public/favicon.ico` cũ là một **trang HTML** (1245 byte, mở đầu `<!DOCTYPE html PUBLIC …`) mang đuôi `.ico`. Production trả `200` kèm `content-type: image/vnd.microsoft.icon`, thẻ `<link rel="icon">` vẫn nằm trong HTML, không có lỗi nào ở đâu — nên nó sống qua mọi cổng kiểm nhiều tháng. **Một tệp nhị phân sai chỗ không tự báo**, nên phép kiểm phải nhìn vào **byte**, không nhìn vào mã trạng thái.

### Xoá tệp hỏng đi KHÔNG cho ra 404 — nó cho ra placeholder Nitro

Đo được trên máy chủ thật sau khi xoá: `/favicon.ico` vẫn `200` kèm `content-type: image/x-icon`, nhưng thân là **chuỗi văn bản** `data:image/gif;base64,R0lGODlhAQABA…` (78 byte) do `nitropack/dist/runtime/internal/renderer.mjs:18-23` phát ra. Tức là **cùng một kiểu hỏng, chỉ đổi nguồn**: trạng thái đúng, nhãn đúng, byte sai.

### `public/favicon.ico` phải VẮNG, tệp mặc định tên `favicon-default.ico`

Kết luận đảo ngược so với đợt trước, đến từ ba phép đo trên bản build — đọc mã không thấy được:

1. Có `public/favicon.ico` lúc build → **tệp tĩnh thắng** route handler ở cùng đường dẫn. Route **không bao giờ chạy**, nên favicon cán bộ cấu hình bị bỏ qua ở đúng đường dẫn mà máy quét gọi.
2. Có lúc build rồi mất lúc chạy → manifest tĩnh vẫn khai tệp còn đó, `readFile` ném `ENOENT`, khách nhận **500** chứ không phải 404.
3. Không có tệp tĩnh → route thắng, **kể cả thắng placeholder của Nitro**.

Tên đó chỉ tồn tại ở **một** chỗ (`DEFAULT_ICO_FILENAME` trong `server/utils/favicon-image.ts`), nên script sinh tệp và tuyến đọc tệp không thể lệch nhau. Có test chặn cả hai chiều.

### Tuyến `server/routes/favicon.ico.ts` chỉ phục vụ `.ico` thật, không phục vụ PNG

Bug này đã xảy ra và **lọt qua 1404 test**: hàng seed `favicon_url = '/favicon-32.png'` làm ứng viên "icon cục bộ" khớp trước bộ mặc định, nên `/favicon.ico` trả **PNG 2213 byte** dưới nhãn `image/png`. Đường dẫn `.ico` mà trả PNG là đúng loại nhãn-sai-byte mà cả việc này ra đời để dứt điểm. Hàng seed đã **bỏ** — bộ đọc tự lùi về mặc định khi hàng vắng, nên hàng đó không mua được gì mà lại khai "đã cấu hình" cho một giá trị chính là mặc định.

### `.ico` là bắt buộc, không phải để cho đủ bộ

Thẻ `<link>` chỉ phục vụ những nơi **đọc HTML**; máy quét, đầu đọc RSS, phần mềm gom tin và trình duyệt cũ trong cơ quan gọi `/favicon.ico` **trực tiếp**, không đọc thẻ nào. Sharp không xuất được định dạng đó, nên `wrapPngAsIco` dựng vỏ ICO bằng tay, bọc thẳng PNG 32×32 — chuẩn từ IE7 trở đi. Số nguyên trong vỏ là **little-endian**; viết ngược thứ tự byte cho ra một tệp trình duyệt lặng lẽ bỏ qua. Hàm **không nhận kích thước làm tham số** — nó đọc từ chunk IHDR (`readPngSize`), vì `wrapPngAsIco(png180, 32)` sẽ dựng ra tệp khai 32×32 chứa ảnh 180×180 và trình duyệt thường vẫn vẽ được, nên không có gì báo. Thân ICO **là chính** `favicon-32.png` (test so byte), nên hai icon không lệch nhau khi logo đổi.

### Tách dựng ảnh khỏi logic URL

Phần dựng ảnh nằm ở `server/utils/favicon-image.ts`, tách khỏi `favicon.ts`. Tệp kia là logic thuần về URL và được plugin import trên **mọi** lượt dựng trang; gộp lại là kéo `sharp` vào đồ thị import của một plugin chỉ cần nối hai chuỗi. Hai nơi gọi dùng **một** bản: `scripts/make-favicon.ts` (`npm run make:favicon`) sinh bộ mặc định, và endpoint quản trị sinh bộ từ ảnh cán bộ tải lên.

### Ba tệp mặc định sinh bằng script

`npm run make:favicon` → `favicon-32.png`, `favicon-180.png`, `favicon-default.ico`, đều từ `public/Logo.png`. Logo là 170×144 nên dùng `fit: 'contain'` + nền trong suốt: `cover` sẽ cắt mép, và một icon bị cắt trông như icon **sai**, không như icon được thu nhỏ.

### `POST /api/admin/settings/favicon` sinh bộ dẫn xuất, không lưu thẳng tệp gốc

Đây là câu trả lời cho cả hai nửa yêu cầu "tự chuyển qua ico hoặc dùng png jpg luôn": nhận PNG/JPG/GIF/WebP rồi sinh **ba** tệp (`-32.png` cho thẻ `<link>`, `-180.png` cho `apple-touch-icon`, `.ico` cho tuyến trực tiếp) vào `public/uploads/favicon/` kèm dấu thời gian trong tên. Lưu thẳng tệp gốc thì một ảnh 1200×800 nặng 400 KB là **400 KB tải trên mọi trang** của cổng, và tỉ lệ không vuông thì trình duyệt bóp méo — cả hai đều không có gì báo. Đo trên máy chủ thật: JPG 1200×800 (5895 byte) → PNG 32px **126 byte**.

- **Đầu ra luôn là PNG, kể cả nguồn JPEG**, và phản hồi mang `convertedToPng` để trang cài đặt nói ra điều đó. JPEG không có kênh alpha, nên giữ nguyên định dạng biến nền trong suốt thành **nền đen** — trên một icon 32px đó là một ô vuông đen ở mọi tab. Im lặng đổi định dạng là thứ cán bộ sẽ phát hiện sau, ở chỗ khác.
- **`.ico` tải lên thì ĐI THẲNG, không sinh lại** — sharp không giải mã được định dạng đó, nên cố decode là một nhánh thất bại im lặng. Đã kiểm: 2235 byte vào, 2235 byte ra, nguyên vẹn.
- **Ô favicon KHÔNG dùng `uploadImage` như ô logo** (có test chặn): hàm đó lưu thẳng tệp gốc vào Thư viện Media, tức đúng thứ endpoint này ra đời để không làm. Nút "Về mặc định" gọi `DELETE` xoá **cả hai** khoá — thiếu nó thì `favicon_ico_url` cũ nằm lại và `/favicon.ico` phục vụ icon cũ trong khi thẻ `<link>` phục vụ icon mới.
- **Form chung cũng phải xoá `favicon_ico_url` khi `favicon_url` đổi** (`settings/index.put.ts`), vì cán bộ vẫn gõ URL tay được. Và cả hai đường ghi gọi `clearFaviconSettingCache()` sau commit — không thì lưu xong vẫn thấy icon cũ tới 30 giây, mà trang đã cảnh báo *trình duyệt* đệm favicon nên cán bộ không phân biệt được hai nguyên nhân.

### `buildFaviconTags()` tự gọi `safeFaviconUrl`, không tin nơi gọi đã gọi

Bản đầu nhận "một URL đã được chấp nhận" — một hợp đồng chỉ tồn tại trong lời văn, nên nơi gọi thứ hai về sau không có gì nhắc nó phải kiểm trước. Đây là chỗ **duy nhất** dựng ra thẻ icon, nên phép kiểm nằm ở đây thì mọi đường tới HTML đều đã đi qua nó. Đã kiểm bằng cách ghi payload **thẳng vào CSDL** (bỏ qua form — một lượt tấn công thật đến từ đường đó): cả 5 payload (`javascript:alert(1)`, `//evil.com/x.png`, `/x.png" onload="alert(1)`, `https://evil.com@good.com/x.png`, `/uploads/a.png"><script>…`) đều lùi về mặc định, **không rò một ký tự nào** vào HTML.

### Icon iOS đi theo favicon đã cấu hình; bản 180×180 chỉ dùng cho mặc định

Giả định đầu tiên sai theo hướng ngược lại: từng **bỏ** `apple-touch-icon` khi cán bộ đặt icon riêng, để iOS không phóng to một ảnh 32px. Nhưng hậu quả của việc bỏ nó là màn hình chính iOS lùi về icon mặc định — **logo cũ của cổng nằm cạnh logo mới của cơ quan**, và không có gì trên trang cài đặt nói ra điều đó. Một icon hơi mờ vẫn là icon **đúng**; một icon nét nhưng sai nhận diện thì không. Bản 180px dành riêng cho mặc định vì đó là lúc duy nhất ta **biết chắc** có tệp đúng cỡ trên đĩa.

### Plugin Nitro `server/plugins/favicon.ts` chạy trên MỌI tuyến

Cố ý khác `tracking.ts` (tệp đó bỏ qua `/admin/**` vì lý do quyền riêng tư; một favicon thì không đo gì của ai). Bộ đệm 30 giây như `tracking.ts`, **và đệm cả nhánh dự phòng** khi CSDL lỗi để một lần CSDL chập chờn không thành bão truy vấn. CSDL lỗi thì tiêm thẻ **mặc định**, không tiêm gì cả — mất CSDL không có lý do gì phải kéo theo mất favicon.

### Luôn giữ một tệp mặc định ở tầng mã nguồn

Giá trị chưa đặt, hàng bị xoá, hay CSDL không nối được đều lùi về `/favicon-32.png` — không nhánh nào cho ra tab trống.

- **Khai báo cứng ở `nuxt.config.ts` đã bỏ** (`{ rel: 'icon', href: '/favicon.ico' }`), nếu không thì mỗi trang mang **hai** thẻ `rel="icon"` và thẻ nào thắng là chuyện của từng trình duyệt. Đã đếm trên bản build thật: đúng **một** thẻ `rel="icon"` trên `/`, và `/admin/login` **có** thẻ (chứng minh plugin không bỏ qua `/admin`).
- **`favicon_url` phải có trong CẢ HAI allowlist cài đặt** — `ALLOWED_SETTING_KEYS` (`settings/index.put.ts`, ghi được) và `allowedKeys` (`public/settings.get.ts`, đọc được công khai). Thiếu một bên là một khoá lưu **thành công** rồi không có tác dụng gì, đúng lớp lỗi mà `openNewTab` đã mắc. **Không** vào `SUPERADMIN_ONLY_KEYS`: favicon không chèn được mã, khác `tracking_custom_head/body`.
- **Trang cài đặt phải nói ra chuyện bộ nhớ đệm.** Trình duyệt giữ favicon rất lâu, nên cán bộ đổi xong, tải lại trang, không thấy gì đổi, và **kết luận tính năng hỏng**. Đó là phần dễ bị bỏ nhất và cũng là phần sinh nhiều báo lỗi giả nhất; có test chặn.

---

## Upload — nhận định dạng ở cổng VÀO mà không nhận ở cổng RA là không nhận nó

Hai allowlist nằm ở hai tệp khác nhau — `detectMime()`/`EXT_BY_MIME` ở `server/api/admin/media/upload.post.ts` quyết định tệp nào **vào được**, còn `mimeMap` ở `server/routes/uploads/[...path].ts` quyết định tệp nào **hiện được** — và không có gì buộc chúng khớp nhau. Đã trả giá ngay trong đợt mở `.ico` cho favicon: tệp icon thật tải lên **thành công** (`200`, `mimeType: image/x-icon`, 2235 byte nguyên vẹn), rồi được phục vụ lại dưới `application/octet-stream` vì `mimeMap` không có `.ico`. Nhánh đó còn gắn kèm `Content-Disposition: attachment` và `X-Content-Type-Options: nosniff` — hai header tồn tại **để trình duyệt từ chối vẽ tệp**. Kết quả: favicon lưu đúng, hiện đúng trong ô nhập, thẻ `<link>` trỏ đúng, **tab vẫn trống**. `tests/favicon-settings.test.ts` nay buộc hai đầu khớp nhau.

- **`.ico` được nhận, `.svg` thì không, và tiêu chí phân biệt là "có chạy được hay không" — không phải "định dạng nào quen hơn".** Một SVG phục vụ dưới `image/svg+xml` là **tài liệu chạy được** trên chính origin của cổng (nó chứa `<script>` được); một ICO là **thùng chứa ảnh raster**, không có nhánh nào để chạy gì. Ghi rõ vì lần nới tiếp theo sẽ được lập luận bằng chính tiền lệ của `.ico`. Có test khẳng định `.svg` vẫn vắng ở **cả hai** đầu, và đã kiểm trên máy chủ thật: SVG cũ vẫn ra `octet-stream` + `nosniff` + `attachment`.
- **Sharp bị bỏ qua cho ICO có chủ đích** (`effectiveMime !== 'image/x-icon'`): sharp **không decode được** định dạng đó (`ico` không có trong `sharp.format`), nên để nó chạy là một nhánh thất bại im lặng. Hệ quả là ICO không được đo `width`/`height` — chấp nhận được, vì cỡ của một favicon do người tải lên chọn chứ không do cổng suy.
- **Nhận diện magic-byte tách ra `server/utils/image-mime.ts`, dùng chung với đường tải lên Thư viện Media.** Hai bộ nhận diện là đúng lớp lỗi "hai allowlist ở hai tệp" ghi ngay trên. Test **đối chiếu thật** hai danh sách thay vì soi chữ một định dạng, nên thêm định dạng thứ sáu ở cổng vào mà quên cổng ra là **đỏ** (đã kiểm chứng ngược).

---

## Cổng drift từng có một lỗ, nuốt bốn cột

`ensureColumn` với định nghĩa trong NHÁY KÉP thì vô hình với `npm run db:drift`. Regex của nó chỉ khớp `'([^']*)'`, còn một `DEFAULT 'new'` **buộc** phải dùng nháy kép ở ngoài. Đo được: **bốn cột** dùng dạng đó (`submissions.status` và ba cột `chatbot_settings`), và **không cột nào** được cổng nhìn thấy qua đường `ensureColumn` — ba cột chatbot chỉ thoát nhờ tình cờ có mặt trong một mảng migration khác. Đã sửa **chính cổng** thay vì lách bằng cách viết định nghĩa khác đi; kiểm chứng âm tính: trả regex về dạng cũ → cổng báo `submissions.status` LỆCH NULL.

---

## `as unknown as` — khẳng định chứ không kiểm

`useRuntimeConfig(event) as unknown as { analytics?: { … } }` *khẳng định* hình dạng chứ không *kiểm* — đúng cấu trúc đã che giấu lỗi `db.insert()` trả về mảng (xem `data-layer.md`) qua typecheck, qua fake pool, qua mọi test soi văn bản, cho tới khi một driver thật phản đối.

- **Khối `analytics` đọc qua `analyticsConfig()` / `analyticsHmacSecret()`, không ép kiểu.** Năm endpoint từng với tới khối này bằng ép kiểu, mỗi chỗ tự khai đúng một hai trường nó cần — nên "kiểu" ở mỗi nơi gọi là một lần đoán mới, và **bốn trong năm chỗ không hề biết `collectionEnabled` tồn tại**. Một khai báo duy nhất `AnalyticsRuntimeConfig` phản chiếu `nuxt.config.ts` từng trường; thêm trường mới là thêm ở một chỗ và mọi nơi đọc đều thấy. `tests/shared-helpers.test.ts` vừa chặn việc ép kiểu quay lại, vừa **chạy thật** các accessor với `globalThis.useRuntimeConfig` giả để chứng minh chúng trả về đúng giá trị mà phép ép kiểu cũ trả về — "biên dịch được" và "đọc đúng giá trị" là hai khẳng định khác nhau, và dự án này đã trả giá một lần vì coi chúng là một.

### `globalThis.useRuntimeConfig` KHÔNG tự tồn tại trong bundle

**⚠️ Plugin `server/plugins/runtime-config-global.ts` gắn nó lúc boot.** Auto-import của Nitro (unimport) chỉ chèn cho **identifier trần** `useRuntimeConfig()`; một member access như `globalThis.useRuntimeConfig` **không bao giờ được biến đổi**, và không gì trong nuxt@4.5.2/nitropack@2.13.4 gắn global đó. Hệ quả đo được trên production: từ commit `1da1b22` (đổi endpoint sang accessor typed), `tryRuntimeConfig()` trả `undefined` trong bundle → `analyticsConfig()` trả `{}` → **mọi lượt `POST /api/public/analytics/page-view` trả `202 {accepted:false}` suốt ba tuần** dù `NUXT_ANALYTICS_COLLECTION_ENABLED=true` đúng trong container (đã curl chứng minh), `POST /api/public/chatbot/session` trả 503 (vé phiên chết → hội thoại không lưu), và token khử trùng lượt xem bài rỗng. **Mọi nơi đọc runtimeConfig KHÔNG có fallback `process.env` thì chết im lặng**; những nơi có fallback (db, client-ip, google-oauth, pool NOC/reporting) sống sót và che mất bug. Đã lọt qua 1400+ test vì `tests/shared-helpers.test.ts` stub chính global đó với chú thích "the same shape Nitro provides" — một tiền đề stack hiện tại không từng cung cấp. **Sửa một lượt ở plugin, không vá từng endpoint**: `installRuntimeConfigGlobal()` (`runtime-config.ts`) là điểm nối duy nhất, không ghi đè hàm có sẵn (Nitro sau này gắn native thì bản native thắng), và giữ nguyên hợp đồng "ngoài Nitro → undefined" — script bảo trì và test dưới plain node vẫn thấy `undefined` rồi rơi về `process.env` (import thẳng `nitropack/runtime/internal/config` dưới plain node crash vì specifier ảo `#nitro-internal-virtual/*`). **Cổng hồi quy là e2e gọi thật** (`tests/e2e/analytics-ingestion.spec.ts`): khẳng định `accepted:true` + vé phiên ký đúng secret — một test soi văn bản mã nguồn không bao giờ thấy được hình dạng phản hồi này; đây chính là lớp kiểm thiếu dẫn tới ba tuần mất dữ liệu.

---

## Mở `lang="ts"` 43 tệp `.vue` — con số "268 → 0" từng lạc quan hơn thực tế

`typecheck` báo 0 lỗi trong khi **43/95** tệp `.vue` không có `lang="ts"` — tức chúng nằm **ngoài tầm** cổng kiểm, mang implicit `any` toàn bộ mà không cần viết chữ `any` nào. Không phải suy đoán: chèn `String(1).nonExistentMethodXYZ(123)` vào một tệp không typed thì typecheck **im lặng cho qua**, chèn đúng dòng đó vào một tệp có `lang="ts"` thì đỏ `TS2339`. Danh sách gồm **mọi** trang công khai, cả 16 block, `ArticleComments.vue` và `profile.vue` — đúng phần chạm dữ liệu công dân. **Nay cả 43 tệp đã bật `lang="ts"`, còn 0 tệp không typed.** Bật cả 43 để **đo** thì ra 150 lỗi thật trên 21 tệp; làm theo bốn lô (22 tệp sạch ngay → 11 tệp lỗi lẻ → 5 tệp form/carousel → 5 tệp nặng nhất) chứ không một lượt.

- **Hai lượt sửa GỐC thay cho việc vá từng nơi gọi.** (1) `/api/public/pages/[slug]` trả **ba hình dạng khác nhau** ở ba nhánh `return`, nên `$fetch` suy ra một union không thu hẹp được (`ok` là `boolean`, không phải literal) — `data.value.page` báo lỗi ở **cả bốn** trang dựng bằng block. Sửa bằng cách **bỏ union đi**: `page`/`blocks` có mặt ở mọi nhánh (`null`/`[]` khi thất bại). Đó cũng là hình dạng bốn trang **vốn đã** giả định — cả bốn truyền `default` là `{ok:false,page:null,blocks:[]}`, tức **hình dạng thứ tư** không khớp nhánh nào của máy chủ. (2) `RenderableNode` (`app/utils/blocks/types.ts`): renderer từng đòi `BuilderNode`, mà kiểu đó có `isVisible: boolean` **bắt buộc** — trong khi phần tải công khai **cố ý cắt bỏ** `isVisible`/`displayOrder`. Hai nơi gọi có hình dạng khác nhau **theo thiết kế**, nên kiểu đúng là kiểu để hai trường đó tuỳ chọn, khớp cách `BlockNode.vue` vốn đã đọc cờ (`isVisible !== false` — vắng mặt thì vẽ).
- **`app/types/public-api.ts`** phản chiếu `admin-api.ts`: kiểu **suy từ chính handler** (`Serialize<Awaited<ReturnType<...>>>`), không viết tay. `ref([])` trong tệp không typed là `any[]`; trong tệp typed nó là `never[]` và **mọi** phép đọc trường thành lỗi — đó là dấu hiệu hình dạng chưa từng được khai ở đâu, không phải bất tiện của trình kiểm kiểu.
- **Hai hợp đồng đã gộp được ĐO trên máy chủ thật sau khi build**, không chỉ kiểm bằng typecheck — cùng lối đã dùng cho `finitePositive` (một test soi văn bản mã nguồn không bao giờ thấy được hình dạng phản hồi). `/api/public/pages/khong-ton-tai` và `/api/public/pages/about` trả **cùng tập khoá** `['blocks','ok','page']`, và `displayOrder` **không** rò ra trong `blocks`; `/api/public/comments/<slug-không-có>` trả đủ **8** trường kèm `signedIn: false`. Trước khi gộp, nhánh rỗng thiếu hẳn `signedIn` và ba nhánh trang block trả ba tập khoá khác nhau.
- **`notFound()` / `emptyThread()` là HÀM, không phải hằng ở cấp module.** `EMPTY` cũ được trải bằng `...EMPTY`, tức copy **tham chiếu** mảng `comments` — nên cùng một mảng được phát cho mọi request có luồng đóng, và một lượt `.push()` ở đâu đó rò bình luận sang mọi phản hồi rỗng tiếp theo. Trên đúng endpoint mà nội dung phụ thuộc vào **người đang hỏi**.
- **Ba test soi văn bản mã nguồn đã được NỚI, kèm kiểm chứng âm tính.** Chúng ghim *cách viết* (`ref(new Set())`, `statusCode === 401`) chứ không ghim hành vi, nên việc khai kiểu và chuyển sang helper `errorStatus()` làm chúng đỏ dù hành vi không đổi. Vì **nới một cổng là một cơ hội để nó thành cổng không kiểm gì cả**, cả ba đã được thử ngược: cho `403` gọi `forgetReader` → đỏ; xoá hẳn `forgetReader` → đỏ; đưa `openIds` về một chỉ số đơn → đỏ.
- **`app/types/admin-api.ts`** — kiểu bản ghi mà 14 trang quản trị nhận, **suy ra từ chính handler** (`Serialize<Awaited<ReturnType<typeof handler>>>`), không viết tay. Đã lộ ra ba lỗi giao diện thật khi bật lên.
- **`BlockData` thôi là `Record<string, any>`** → `Record<string, BlockFieldValue>`, kèm hai hàm thu hẹp `blockText()` / `blockArray()` (`app/utils/blocks/types.ts`). `any` ở đây từng lan ra **toàn bộ** cây block — builder, endpoint, renderer — nên mọi phép đọc `node.data.<gõ sai>` biên dịch trót lọt rồi hiện một ô trống trên trang công khai mà không có lỗi nào.
- **`AppRuntimeConfig`** phản chiếu `runtimeConfig` của `nuxt.config.ts` từng trường. Trước đó `tryRuntimeConfig()` trả `Record<string, any>` và **tám** nơi gọi mỗi nơi tự đoán hình dạng, nên một khoá gõ sai **âm thầm rơi về `process.env`** — trên máy dev kết quả giống hệt cấu hình đúng, chỉ production mới lệch. `trustedProxyIps` là chỗ nặng nhất: đọc trượt khoá đó là danh sách proxy tin cậy thành rỗng, tức mọi khách sau nginx gộp thành **một** ô đếm giới hạn tần suất.
- **`BuilderTreeApi`** cho `provide`/`inject` của cây block. `inject<any>` là một hợp đồng **không được kiểm ở cả hai phía**: đổi tên `select` ở trang cha thì `tree.select(...)` ở cây con vẫn biên dịch rồi ném "not a function" đúng lúc cán bộ bấm vào một khối.
- **Ba lỗi thật do việc khai kiểu làm lộ ra**: `home-sections/[id].put.ts` ghi vào cột `title` **không tồn tại** (`home_sections` giữ tiêu đề trong `config` JSON); `chatbot/knowledge/[id].vue` đọc `response.item.id` trên một giá trị có thể `null`, và vì lỗi đó ném **trong khối `try`** nên nó hiện ra là "Không thể lưu" cho một lượt lưu **đã thành công**; `sanitizeBlockData()` trả `unknown` nên `null` đi xuyên qua nó vào cột `page_blocks.data`, mà `BlockNode.data` thì không nhận `null`.

---

## Typecheck đã xong — chi tiết lịch sử

`npm run typecheck` (→ `nuxt typecheck`) sạch 0 lỗi và job CI `Types` là **cổng chặn** (không còn `continue-on-error`). `typescript@^5` + `vue-tsc` đã là devDependency thật, lockfile đã sinh lại. **Ghim TypeScript ^5**: bản 7.x là bản viết lại bằng Go, không còn export `lib/tsc.js` mà vue-tsc cần lúc khởi động. Lần chạy đầu phát hiện 598 lỗi; hai nhóm lớn nhất được sửa tận gốc chứ không vá từng chỗ: `getDb()` khai báo kiểu trả về (`server/utils/db.ts`, 389 lỗi) và `tryRuntimeConfig()` (`server/utils/runtime-config.ts`) thay cho 5 chỗ tự dò `globalThis.useRuntimeConfig`.

---

## CI — cách đọc một job "cancelled"

`push` chỉ trên `main`, không phải `['**']`. Với `branches: ['**']`, một nhánh đang mở PR nổ **hai** lượt chạy cho **cùng một commit** — một từ `push`, một từ `pull_request` — và chúng không dedupe được vì `github.ref` khác nhau (`refs/heads/…` với `refs/pull/N/merge`), nên nhóm concurrency cũng khác. Hậu quả không chỉ là tốn gấp đôi: hai lượt **tranh nhau cùng một service MySQL**, và phần lớn "CI đỏ" trên PR là lượt bị huỷ chứ không phải mã hỏng. **Một bảng CI mà quá nửa màu đỏ là nhiễu sẽ được đọc như nhiễu — kể cả cái đỏ thật.** Nhánh chưa có PR vẫn chạy nhờ `pull_request`.

- Nhóm concurrency khoá theo `github.head_ref || github.ref`, không theo `github.ref` trần — vì lý do vừa nêu: `github.ref` cho cùng một nhánh có hai giá trị khác nhau tuỳ sự kiện.
- **Typecheck là một BƯỚC trong job `test`, không phải job riêng.** Mỗi job là một runner phải xin cấp riêng, và trên tài khoản này hai job nhẹ nhất **liên tục bị huỷ sau ~15 phút xếp hàng mà chưa bao giờ được cấp máy** — đo được qua API: `runner: ""`, `steps_run: 0`. Tức là bảng CI báo đỏ cho một thứ **chưa từng chạy**. Gộp cũng bỏ được một lượt `npm ci` trùng. Vẫn là cổng **chặn**: bước đó `exit $status`, và `tests/ops-scripts.test.ts` canh cả hai điều (bước còn trong job `test`, và nó thoát theo mã thật) — bỏ `exit $status` là biến cổng chặn thành một dòng nhật ký, mà từ bảng CI thì hai thứ đó **cùng một dấu tích xanh**.
- **Cách đọc một job "cancelled"**: gọi `gh api …/runs/<id>/jobs` và xem `runner_name` với số step đã chạy. Rỗng và `0` nghĩa là job chưa bao giờ được cấp máy — vấn đề nguồn lực, **không phải mã hỏng**. Một job hỏng thật luôn có tên runner và ít nhất một step `failure`.

### `ANALYTICS_SCHEDULER` so ngày phải theo GIỜ ĐỊA PHƯƠNG

`isMaintenanceDue` hỏi "hôm nay chạy chưa?", và bản đầu so `lastCompletedDay` với `utcDay(now)`. Ở **UTC+7 thì mọi giờ địa phương trước 07:00 vẫn thuộc ngày UTC hôm trước**: 03:00 ngày 8 có `utcDay` là `2026-08-07` — đúng ngày lượt chạy đêm trước đã ghi. Nó đọc thành "hôm nay xong rồi" và **bỏ lượt mỗi đêm, mãi mãi, không một dòng log nào nói ra** — tức là tái tạo đúng cách hỏng mà scheduler này ra đời để chấm dứt, ở dòng ngay bên dưới. Nay ưu tiên `completed_at` (là một mốc thời gian nên đổi sang ngày địa phương chính xác), và khi hàng cũ không có nó thì so ngày đã lưu với **cả** ngày địa phương **lẫn** ngày UTC — lệch về phía "đã xong" thì tệ nhất là mất một đêm mà nhánh `stale` (36 giờ) sẽ vớt, còn lệch về phía kia là **gộp lại mỗi lần boot**.

- **CI nay chạy `npm test` với `TZ=Asia/Ho_Chi_Minh`** (`.github/workflows/ci.yml`, có test canh dòng đó ở `tests/ops-scripts.test.ts`). Đây là **cổng chặn thật, không phải chuyện sạch sẽ**: đưa phép so UTC quay lại thì **6 test đỏ ở UTC+7 và 0 test đỏ ở UTC**. Runner của GitHub chạy UTC, nên thiếu dòng này là pipeline phát dấu tích xanh cho một scheduler **không bao giờ chạy** trên chính máy chủ nó được triển khai tới. Mọi logic ngày tháng đọc giờ/ngày địa phương đều chung điểm mù này, nên dịch **cả suite** thay vì một tệp.
