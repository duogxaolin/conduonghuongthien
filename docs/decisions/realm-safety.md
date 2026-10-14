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

---

## Cổng `/api/admin/**` và khôi phục backup (audit 2026-10-13)

### Middleware phải đọc đúng đường dẫn mà router đọc

`server/middleware/admin-auth.ts` từng so `getRequestURL(event).pathname` — dạng **thô**, còn nguyên `%xx`. h3 1.15 giải mã đường dẫn **trước** khi route (`event.path` trong middleware đã giải mã), nên `/api/%61dmin/users` không bắt đầu bằng `/api/admin/` trong mắt middleware nhưng vẫn được route vào handler `users` — không token, không `isActive`, không `tokenVersion`, không chốt stage MFA. Không lộ gì chỉ nhờ từng handler tự kiểm quyền; một handler mới quên kiểm là mở toang. Test cũ giả `getRequestURL` nên không thể thấy.

- `classifyAdminRequest(routedPath, rawPathname)`: là admin request nếu **bất kỳ** dạng nào (`event.path` bỏ query/fragment, dạng giải mã của nó, pathname thô, dạng giải mã của pathname thô) bắt đầu bằng `/api/admin/`; chỉ được miễn khi **mọi** dạng đã giải mã đều đúng một trong bốn endpoint đăng nhập. Chuỗi giải mã hỏng (`%zz`) giữ dạng thô → vẫn bị chặn. Pathname thô chưa giải mã không dự phần miễn trừ, nếu không `/api/admin/auth/log%69n` (router route vào login) sẽ 401.
- `tests/admin-auth-path-gate.test.ts` chạy middleware **thật** trong app h3 + router **thật** trên cổng tạm, gửi dòng request nguyên văn qua `node:http` (không `fetch`/`URL` — chúng tự chuẩn hoá `..`, `%2e%2e`, `//` trước khi gửi nên test sẽ không kiểm gì). Mỗi handler là một sentinel đếm lượt gọi, có cả catch-all để "0 lượt" không thể là một 404. Đưa middleware cũ trở lại → 3 test đỏ.
- `tests/admin-handler-authorization.test.ts` kiểm kê 282 handler: mỗi tệp phải **gọi** (không chỉ import) một hàm kiểm quyền, trực tiếp hoặc qua một module `services/`/`utils/` một bước (trừ `permissions.ts`/`auth.ts` — nơi định nghĩa hàm kiểm, import chúng không chứng minh gì), hoặc có tên trong `AUTH_EXEMPTIONS` kèm lý do (15 tệp: luồng đăng nhập, tài khoản của chính mình, kiểm SuperAdmin tại chỗ). Mục miễn trừ cũ (tệp mất hoặc đã tự kiểm) cũng làm test đỏ.

### Khôi phục, tải về, xoá backup chỉ dành cho SuperAdmin

Khôi phục chạy file SQL tải lên bằng `multipleStatements` dưới quyền `DB_USER` (root trong compose mặc định) — tức là toàn quyền CSDL, kể cả `users`/`roles` — trong khi trước đây chỉ cần `settings.update`; bản dump (hash mật khẩu, đơn của công dân) tải về được với `settings.read`. Người chỉ được sửa cài đặt leo thang được thành toàn quyền, vượt cả chốt SuperAdmin của `tracking_custom_head`. Nay `requireSuperAdmin(actor)` (`server/utils/permissions.ts`) chặn bốn endpoint `restore`, `restore-upload`, `[filename].get`, `[filename].delete` — gọi **sau** `requireResourcePermission(…, 'settings', …)` để quy ước "mọi handler gọi helper" vẫn đúng. `restore-upload` từ chối trước khi đổi trạng thái khôi phục và trước khi đọc body multipart. Liệt kê, trạng thái, tạo backup và cấu hình Drive giữ quyền cũ. Trang `/admin/settings/backup` ẩn các nút đó với người khác, nhưng server mới là nơi quyết định.

Chưa làm (khuyến nghị): chạy khôi phục bằng một tài khoản MySQL bị giới hạn thay vì `root`.

### Thứ tự khôi phục là hợp đồng

`server/services/backup-restore.ts` + `backup-restore-guards.ts`:

1. **Kiểm trước khi ghi/ghi nhận/chạy**: đuôi `.sql.gz`/`.tar.gz`, chữ ký gzip `1f 8b`, trần nén 512 MiB (endpoint còn chặn sớm theo `Content-Length`), trần giải nén **đếm theo luồng** — 256 MiB cho SQL (toàn văn SQL phải vừa một chuỗi JS), 15 GiB cho archive (giải nén thẳng ra đĩa, chặn bom làm đầy đĩa; trước 2026-10-14 là 8 GiB — chủ repo nâng để archive media 10,9 GB khôi phục được qua giao diện). Không còn `gunzipSync` không trần. Lỗi → xoá file tạm, không có hàng `backups`, trạng thái `failed` kèm lý do, mã 4xx từ `BackupRestoreError.statusCode` (không so khớp chuỗi).
2. **Archive** (bản đầu; từ 2026-10-14 thay bằng `TarHeaderScanner` — xem § "Đợt sửa sau kiểm chứng"): `tar -tzvf` được phân tích (định dạng GNU lẫn BusyBox — container production là alpine) trước khi giải nén; một mục `..`, tuyệt đối, symlink, hard link (BusyBox in hard link như file thường kèm ` -> `), thiết bị, hay ngoài `uploads/`/`media/` → không giải nén mục nào. Dòng không đọc được → từ chối.
3. **Sao lưu an toàn**: khôi phục CSDL tạo bản `pre-restore` trước (`runBackup(…, { rotate: false })` — xoay vòng có thể xoá đúng bản cũ nhất, tức file đang khôi phục). Sao lưu an toàn hỏng → huỷ; đang có backup chạy → 409.
4. **Audit**: `backup_restore` trong một transaction cùng việc gắn lại các hàng `backups` mô tả file còn trên đĩa (dump vừa chạy đã `DROP TABLE backups`, nên hàng `pre-restore` và hàng của file vừa tải lên biến mất); `backup_restore_failed` trong transaction riêng, lỗi ghi audit không che lỗi gốc. Người thao tác vắng khỏi bảng `users` sau khôi phục → `user_id` null, tên và id nằm trong `meta` (khoá ngoại). Log bảo mật `backup.restore_started/succeeded/failed/refused`.

### Dump định dạng 2 — ngày giờ đúng nguyên văn

Dump cũ đọc qua pool (`timezone: '+07:00'`) rồi ghi `Date.toISOString()` (UTC): mọi DATETIME/TIMESTAMP **sớm 7 giờ**, DATE lùi về **ngày hôm trước** (`2026-10-13` → `2026-10-12 17:00:00`), BIGINT và số nguyên trong JSON vượt 2^53 mất chính xác, chuỗi JSON `"text"` ghi trần thành `text` nên khôi phục **hỏng hẳn** (`ER_INVALID_JSON_TEXT`). Mỗi bảng còn được đọc ở một thời điểm khác nhau.

`dumpSql` (`server/services/backup-sql.ts`) nay mở kết nối riêng với `dateStrings`/`bigNumberStrings`/`jsonStrings`, `SET SESSION time_zone = '+00:00'`, đọc mọi bảng trong một `START TRANSACTION WITH CONSISTENT SNAPSHOT` (REPEATABLE READ), ghi header `-- CDKT dump-format: 2` và `SET time_zone = '+00:00';`. Chuỗi của cột số chỉ viết trần khi khớp mẫu số chặt (`'007'` trong VARCHAR luôn có nháy); giá trị kiểu bất ngờ làm dump **ném lỗi** thay vì đổi âm thầm. `tests/backup-dump-integration.test.ts` (MySQL thật, CI matrix `backup-dump`) chứng minh round trip giống hệt dưới múi giờ mặc định của server, dưới `SET GLOBAL time_zone='+07:00'`, và chéo giữa hai bên; cùng snapshot nhất quán và khôi phục đầu-cuối.

Dump cũ (header `-- CDKT backup:` không có dấu định dạng 2) vẫn khôi phục được nhưng được **gắn cờ**: trạng thái và toast báo ngày giờ có thể sớm 7 giờ, audit có `legacyDateShift: true`. Không sửa được đáng tin cậy bằng SQL nên không thử. Dump `mysqldump` (`scripts/backup-db.sh`) không bị gắn cờ.

---

## Đích ra ngoài và bí mật đã lưu (audit 2026-10-13, phần 2)

Mẫu chung của nhóm lỗi này: **một bí mật đã lưu (API key, mật khẩu SMTP) được gửi tới một đích mà request — hoặc một trường do biên tập viên sửa — tự chọn.** Cách sửa chung: đích được kiểm cả lúc ghi lẫn lúc dùng, và đổi đích thì phải đưa lại bí mật.

### baseUrl của nhà cung cấp AI

`providers/index.post.ts` và `[id].put.ts` lưu `baseUrl` không kiểm; `ai-gateway.ts` dựng `allowedHosts` từ chính URL đó (nên không chặn gì), và mọi đường stream/tool-calling dùng `fetch` trần — không https, không chặn IP nội bộ, không hạn giờ/trần byte. Người có `ai.update` đặt `baseUrl=http://máy-mình` thì lượt gọi chatbot/dịch kế tiếp gửi `Authorization: Bearer <key>` tới đó.

- Chính sách thuần `server/utils/ai/provider-url.ts`: https, cổng 443, không userinfo, hostname không phải IP nội bộ/loopback/link-local ở mọi dạng viết (thập phân, hex, IPv6, dấu chấm cuối), không `localhost`/`.local`/`.internal`. Áp lúc **ghi** (provider tạo/sửa, PATCH cài đặt chatbot → 400 tiếng Việt) và lúc **gọi** (mọi đường trong `ai-gateway.ts`; test chứng minh URL xấu không phát ra lượt mạng nào).
- `safeProviderStream` (`server/utils/chatbot/outbound.ts`): cùng các kiểm như `safeProviderRequest`, DNS → IP công khai và **kết nối bằng chính IP đã kiểm** (không có cửa sổ DNS-rebinding), không theo redirect, hạn tổng 300 s / im lặng 240 s, trần byte; trả luồng cho `readChatSse` (bộ đọc SSE vẫn chỉ có một).
- Đổi `baseUrl` của provider đã có key → phải nhập lại key trong cùng request. Đổi `baseUrl`/`allowedHosts` của chatbot chỉ SuperAdmin (như xoay key); trang cài đặt không gửi lại hai trường đó khi không đổi.

### Liên kết trong email thông báo

`requestBase()` lùi về Host thô và tin `X-Forwarded-Host` khi peer là proxy đã khai; ví dụ nginx trong `CI-CD.md` không đặt/xoá header đó → người đọc khiến cổng gửi email thật trỏ tới `evil.example`. Triển khai đa tên miền là **chủ đích** nên không ép `PUBLIC_BASE_URL`: `server/utils/public-link-base.ts` chỉ nhận host request khi nó nằm trong `PUBLIC_HOST_ALLOWLIST` hoặc là host của `PUBLIC_BASE_URL`, còn lại dùng `PUBLIC_BASE_URL`; trống cả hai → hành vi cũ + log một lần `security.link_host_unchecked` (host bị từ chối: `security.link_host_rejected`). OAuth redirect vẫn suy từ request — Google tự đối chiếu redirect URI đã đăng ký. Phía nginx: site `default_server` từ chối host lạ + `proxy_set_header X-Forwarded-Host $host`.

### Những đích khác

- **Test SMTP** (`test-email.post.ts`): body gửi host/port/user + mật khẩu che `********` thì máy chủ từng nạp mật khẩu **đã lưu** và đăng nhập vào host do người gọi chọn (đọc ngược mật khẩu, kiêm quét cổng). Nay mật khẩu che/trống → dùng **trọn** cấu hình đã lưu, bỏ host/port/user trong body; muốn thử host khác phải gõ mật khẩu mới (`server/utils/smtp-test-config.ts`).
- **Xuất Google** (`article-export-google.ts`): từng `fetch(thumbnailUrl)` bất kỳ (SSRF), đẩy bytes lên Drive và chia sẻ `anyone: reader`, chèn URL thô vào `=IMAGE("…")`. Nay chỉ lấy ảnh thuộc media của chính site (`/uploads` đọc từ đĩa, hoặc host R2 công khai đã cấu hình) — còn lại bỏ ảnh, lượt xuất vẫn chạy; không chia sẻ công khai; công thức thoát nháy; ô văn bản đầu `= + - @`/tab/CR bị vô hiệu (`server/utils/spreadsheet-cell.ts`, dùng chung cho CSV).
- **AI biên tập**: `polishedContent` do model viết từng về client nguyên văn và vào `v-html` → nay `sanitizeHtml` ở máy chủ (cả nhánh trả lời không phân tích được và `changes[].suggested`). `tests/security-ai-editorial-html.test.ts` giữ **kiểm kê mọi `v-html` trong `app/`** kèm nguồn đã lọc — thêm `v-html` mới mà không khai là đỏ.
- **Nhỏ**: JWT ký/kiểm ghim `HS256`; `restart-server` cần thêm SuperAdmin (kiểm `isSuperAdmin === true` tại chỗ, sau `requireResourcePermission`); link markdown của chat chỉ `https:` hoặc đường dẫn một gạch (`//evil.com` không còn là link nội bộ); `boost`/`stats` của bài kiểm quyền theo thể loại **trước** khi tra id nên 404/403 không còn lộ bài tồn tại.

### Kiểm duyệt: thứ tự, trần, regex

`chat.post.ts` và `public/chatbot/index.post.ts` chạy `fastPreModerate` **trước** mọi giới hạn, mỗi tin bị chặn ghi một hàng `ai_moderation_queue` → khách vô danh làm ngập hàng duyệt. Nay `chargeChatRateLimit` tính trước (nhớ trong `event.context` để không tính hai lần) và `MODERATION_QUEUE_CAP` giới hạn số hàng theo IP (không có thì theo phiên). `comments.ts`/`livestream-chat.ts` được sửa theo cùng thứ tự ở đợt G1 (§ "Đợt sửa cuối (G1–G3)" bên dưới).

Regex do admin viết từng bị hạ chữ thường trước khi biên dịch ở một nhánh (`\S`→`\s`, `\W`→`\w`) và không ở nhánh kia; nay một helper `server/services/moderation-regex.ts` (cờ `iu`, trần độ dài, bỏ mẫu hỏng) dùng cho cả hai, luật lưu mới bị từ chối nếu không biên dịch được hoặc có hình dạng lùi vô hạn hiển nhiên (`(a+)+`, `(a*)*`, nhánh chồng lấn có lượng từ). **Đây là heuristic: giảm, không loại trừ ReDoS.** (Bộ phân tích + trần lúc chạy đã được làm chặt hơn ở đợt 2026-10-14 — `chatbot.md` § "Kiểm duyệt và độ dài tin".)

## Đợt sửa sau kiểm chứng (2026-10-14, F1–F6)

Một lượt kiểm chứng độc lập trên cây đã gộp tìm ra các lỗ dưới đây; mỗi bản sửa có test đỏ trên mã cũ → xanh trên mã mới (báo cáo của nhánh sửa), và lượt kiểm cuối đã chạy lại toàn bộ test + build + e2e.

### Đổi đích thì phải đưa lại bí mật — áp cho mọi cài đặt có bí mật

Mẫu "bí mật đã lưu bị gửi tới đích do request chọn" (§ trên) còn ở ba chỗ: lưu cài đặt SMTP với host mới mà không gõ mật khẩu (lần gửi email kế tiếp đăng nhập vào host đó bằng mật khẩu cũ), và đổi account/bucket R2 của ảnh hoặc video (lượt đồng bộ kế tiếp ký request bằng secret cũ tới account khác). Nay một luật thuần dùng chung `shared/settings-credential-rules.ts` — đổi host/port/user/secure SMTP, account/bucket R2 ảnh, account/bucket R2 video mà không kèm bí mật mới trong cùng request → 400; trang (`email.vue`, `media-storage.vue`, `media-portal.vue`) dùng đúng luật đó để báo lỗi tại ô trước khi gửi, máy chủ (`server/utils/settings-credential-guard.ts`, `index.put.ts`, `media-portal.put.ts`) là nơi quyết định. SMTP chỉ nhận cổng 25/465/587/2525 (chặn dùng tính năng test để quét cổng). `test-email`/`test-r2` với bí mật trống/che dùng **trọn** cấu hình đã lưu và chỉ trả lỗi đã phân loại (không phản chiếu thông báo thô của máy đích); `test-r2` nay cần `settings.update`. Xoá trắng ô mật khẩu SMTP = xoá mật khẩu đã lưu (trước đó không có cách xoá). `GET media-portal` trả giá trị R2 đã lưu + `secretStored`: trước đó provider `local`/bí mật không đọc được trả chuỗi rỗng, và lưu lại trang là xoá trắng cấu hình.

Còn lại: `smtp-test-config.ts` giữ một bản chép logic của luật chung (có test đối chiếu). (Account id/bucket R2 **đã lưu từ trước** nay được kiểm lúc dùng — G3, bên dưới.)

### Backup: cấu hình đích cũng là quyền SuperAdmin

Khôi phục đã là SuperAdmin, nhưng người có `settings.update` vẫn đổi được **đích** Drive (service account, thư mục, bật/tắt) và `backup_keep_count` — tức là gửi bản dump (hash mật khẩu, đơn của công dân) tới Drive của mình, hoặc đặt giữ 1 bản để xoay vòng xoá bản tốt. Nay `server/api/admin/settings/backup.put.ts` (`SUPERADMIN_ONLY_KEYS`) từ chối các khoá đó với người không phải SuperAdmin (so giá trị hiệu lực, 400 chứ không 500, audit không chứa secret), mọi endpoint Drive OAuth (`config.put`, `start`, `callback`, `clear-secret`, `disconnect`) gọi `requireSuperAdmin`; trang ẩn các ô và `app/utils/backup-settings-payload.ts` bỏ các khoá đó khỏi payload. Xoay vòng (`selectRotationVictims`) luôn giữ bản mới nhất của **mỗi họ** (sql/uploads/media) và mọi bản `pre-restore`, nên `keep_count` nhỏ không xoá được bản duy nhất của một họ.

Kiểm mục tar: phân tích dòng `tar -tzvf` phụ thuộc định dạng in của từng bản tar (BusyBox in hard link như file thường, tên người dùng giả mạo được cột) — một mục đặt tên khéo vượt qua được. Nay `TarHeaderScanner` (`backup-restore-guards.ts`) đọc trực tiếp header 512 byte trong Node, hiểu pax/GNU long name, từ chối loại mục không phải file/thư mục (`archive_unsupported_entry`), tên không an toàn (`archive_unsafe_name`), quá nhiều mục (`archive_too_many_entries`). Đã chạy trên archive thật trong `backups/`: uploads 3235 mục và `missing492` được nhận; một archive media bị cắt cụt thật bị từ chối `corrupt_gzip`. Header dump ghim `sql_mode='NO_AUTO_VALUE_ON_ZERO'` (cả phiên dump và phiên khôi phục) — hàng `id = 0` trong cột AUTO_INCREMENT không còn bị đánh số lại. Archive giải nén > 15 GiB bị từ chối (413; trần cũ 8 GiB) — archive media 10,9 GB đang có (luồng tar 10,59 GiB, 11.786 mục) nay được `inspectArchive` nhận; archive lớn hơn 15 GiB vẫn phải khôi phục bằng `scripts/restore-media.sh`. Archive media bị cắt cụt nói ở trên là tệp 2,3 GB `…185215Z-pre-sync`.

### Cổng admin: `#` và kiểm kê handler

`classifyAdminRequest` từng cắt cả `#` khi chuẩn hoá. Trình duyệt không gửi fragment nhưng client thô thì gửi được, và router h3 **không** cắt `#`: `/api/admin/auth/login#/../users` bị phân loại là trang đăng nhập (miễn kiểm) trong khi router thấy một đường dẫn khác — một route `**` bắt được nó sẽ chạy không qua phiên. Nay chỉ `?` bị cắt; đường dẫn chứa `#` hoặc `%23` không bao giờ được miễn. Kiểm kê "mọi handler admin đều kiểm quyền" từng là grep văn bản (comment hay chuỗi chứa tên helper cũng làm nó xanh); nay `tests/_admin-authz-classifier.ts` đọc AST TypeScript và chỉ tính lời gọi thật ở thân handler (15 miễn trừ giữ nguyên, đột biến bằng comment/chuỗi → đỏ). Bản build thật (CSDL không với tới, 2026-10-14): 19 cách viết × 4 method, kể cả `%61dmin`, `login#/../users`, `login%23/../users`, `..%2f`, `;` — chỉ ra 401/400/404; `/api/admin/backup/status` không cookie → 401.

### Đích ra ngoài khác

Thumbnail khi xuất bài lên Google đi qua `safeProviderRequest` (trước đó `fetch` trần tới URL R2 lấy từ cài đặt); dải IPv6 NAT64 (`64:ff9b::/96`, `64:ff9b:1::/48` — `64:ff9b::a9fe:a9fe` chính là 169.254.169.254) và site-local `fec0::/10` bị coi là nội bộ; Google OAuth chỉ tin `x-forwarded-proto` khi peer là proxy đã khai. Còn `fetch` trần: `ai/delify/*`, `ai-budget.ts` (`media-portal.ts` đã bỏ ở G3).

## Đợt sửa cuối (G1–G3, 2026-10-14)

Ba nhánh sửa sau lượt kiểm cuối của F1–F6; test đỏ → xanh theo báo cáo của nhánh sửa, lượt kiểm cuối chạy lại toàn bộ test/build/e2e (CHANGELOG § 19).

### Bình luận và chat livestream: giới hạn trước kiểm duyệt, trần hàng duyệt theo nguồn

`createComment` và `sendChatMessage` từng chạy `fastPreModerate` trước giới hạn của chính chúng, và không truyền `capQueuePerSource` — một reader (hay script giữ nhiều tài khoản Google) ghi hàng `ai_moderation_queue` không giới hạn. Nay thứ tự là cổng → giới hạn reader → giới hạn IP → `fastPreModerate({ readerId, capQueuePerSource: true })` → ghi. Tin bị chặn tức thì là **ngoại lệ có tên** của "lượt giới hạn chỉ tính khi ghi": nó không miễn phí vì ghi một hàng duyệt. Khoá trần hàng duyệt (20/giờ) là địa chỉ đã gộp (`server/utils/ip-bucket.ts`: IPv6 → /64, `::ffff:a.b.c.d` → IPv4) **và** reader id; không có cả hai thì theo phiên — một tài khoản đổi địa chỉ hay một /64 xoay địa chỉ vẫn đụng trần. Ngân sách tính chung theo địa chỉ giữa chatbot, bình luận, chat livestream. `ip-bucket.ts` cố ý **không** nối vào `getClientIp` hay khoá giới hạn chung (danh sách chặn IP và audit lưu địa chỉ đầy đủ) — nên `comment:ip:`, `livestream:chat:ip:`, giới hạn chat và trần AI theo IP vẫn né được bằng xoay địa chỉ trong /64 (còn mở). `recordInstantBlock` từng `catch {}`: nay log `ai_moderation.queue_insert_failed` chỉ với lớp/mã lỗi (thông điệp Drizzle nhúng tham số ràng buộc — nội dung, IP, tên).

### R2: cấu hình hỏng là lỗi, không phải "không có object"

Luật "đổi đích phải gõ lại bí mật" chỉ chặn lúc **ghi**; hàng đã lưu trước đó (hay sửa tay/khôi phục) vẫn đi thẳng vào `https://${accountId}.r2.cloudflarestorage.com`. Nay `openR2`/`assertUsableR2Config` (`server/utils/media-r2.ts`) kiểm account id (32 hex) + tên bucket ở **mọi** lần dùng, cho ảnh và video (`video-r2-sync.ts`): hỏng → `R2ConfigInvalidError` (400, không phản chiếu giá trị), log `r2.config_invalid` tối đa một dòng/10 phút mỗi trường. `headR2Object`/`deleteR2File` **ném** lỗi đó thay vì trả `false` — trả `false` từng khiến quét thumbnail báo mọi ảnh R2 là hỏng (lượt "sửa" thay hết bằng ảnh mặc định) và self-heal coi mọi object là mất. Lỗi mạng/xác thực/5xx của `HeadObject` thì **vẫn** trả `false` (còn mở).

### Media Portal: ảnh nguồn thumbnail không đi qua `media.url`

"Đặt thumbnail từ ảnh thư viện" từng `fetch(img.url)` trần — không hạn giờ, không trần byte, theo chuyển hướng; `media.url` là một ô CSDL (theo bản khôi phục/import SQL), nên một URL nội bộ biến nút này thành SSRF có kênh đọc ngược (bytes thành thumbnail công khai). Nay `readLibraryImage` đọc theo khoá R2 (`getR2Object`, trần 25 MiB, hạn 20 s, cấu hình R2 của thư viện ảnh) hoặc tệp thường dưới `public/uploads` (`lstat`, trần byte). Không có nhánh `safeProviderRequest`: không host bên thứ ba nào hợp với tính năng này. Còn mở: kiểm "nằm dưới uploads" là so chuỗi đường dẫn — thư mục cha là symlink dưới uploads vẫn lọt (giống route `/uploads`).

### Sao lưu: trigger dài và xoay vòng trong lúc khôi phục

`backups.trigger` là `VARCHAR(16)`; `runBackup('sql','pre-fix-thumbnails')` (18 ký tự) lỗi `ER_DATA_TOO_LONG` trên MySQL 8.0.46 strict — không hàng, không dump (hàng "failed" trong `catch` cũng hỏng theo), nên quét thumbnail chạy **không** có bản an toàn. Nay `VARCHAR(32)`, danh sách `BACKUP_TRIGGERS` là nguồn chân lý (test đòi mọi trigger vừa cột), `modifyColumn` trong `migrations-additive.ts` nâng cột lúc container khởi động. Xoay vòng (`rotateOldBackups`) bỏ cả lượt khi khoá `cdkt:backup:restore` đang bị giữ (`IS_USED_LOCK`, không chờ) hoặc không đọc được trạng thái khoá, và bỏ từng tệp đang được khôi phục (`holdRestoreTarget`, đếm tham chiếu trong tiến trình) — log `backup.rotate_skipped_restore_active`. Còn mở: khôi phục bắt đầu đúng lúc vòng xoá đang chạy thất bại sạch thay vì được ngăn; `deleteBackup` thủ công vẫn xoá được tệp đang khôi phục.

---

## Pentest RedAmon 2026-10-06 — 12 findings, 0 CVE, risk 65/100 High

Báo cáo external pentest `cdht.delify.vn` (RedAmon, 6/10/2026). Mọi finding đều là **misconfig deployment/DNS**, không phải soft vuln — 0 CVE, 0 confirmed exploit. Đối chiếu với codebase:

### Đã có trong code (scanner không thấy — do Cloudflare edge hay scanner cur thấu)

- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` — `nuxt.config.ts` routeRules `/**`.
- `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` — chống clickjacking.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`.
- CSP đầy đủ (script-src/style-src/img-src/connect-src/frame-src/media-src/font-src allowlist).
- **Rate limiting login** — `server/utils/rate-limit-store.ts` + login bước 2 giới hạn 10/15ph theo tài khoản. Scanner báo "No Rate Limiting on Login" ×3 có thể vì test qua CDN edge không thấy response 429 origin trả, hoặc test tới endpoint khác ngoài `/api/auth/login`.

Scanner báo "Sec Headers 0%" là **sai về CDN edge**, không phải code thiếu — origin Nitro gửi đủ. Verify bằng `curl -sI https://cdht.delify.vn/ | grep -i "x-frame\|strict-transport\|content-security"` (sau khi qua Cloudflare).

### Đã fix trong code sau báo cáo (info tier)

- **COOP `same-origin`** + **CORP `same-origin`** — thêm vào `nuxt.config.ts` routeRules `/**` headers. COOP cô lập window handle (chống Spectre side-channel + cross-origin window interaction). CORP chặn site khác nhúng tài nguyên CDKT.
- **COEP cố ý KHÔNG bật**: `require-corp` sẽ chặn cross-origin resource không kèm CORP header — ảnh R2 `cdn1.delify.vn`, YouTube embed, Cloudflare insights đều không gửi CORP và em không control header các endpoint đó → bật COEP = phá vỡ site. `credentialless` (Chrome 96+) an toàn hơn nhưng Firefox/Safari support ch慢 + rủi ro với YouTube iframe. Đợi browser support rộng + R2 gửi CORP rồi mới bật.

### KHÔNG fix trong code (giải thích tại sao)

- **CSP `'unsafe-inline'` script-src** — cố ý Nuxt 4 hydration + Tailwind dùng inline. Bỏ = vỡ site. Đợi Nuxt 5 hash CSP. Ghi rõ trong `nuxt.config.ts` comment + CLAUDE.md.
- **Login Form over HTTP (high)** — không phải code, là **Cloudflare edge** phải redirect HTTP→HTTPS. Code đã có HSTS nhưng nếu Cloudflare forward HTTP tới origin thì browser vẫn thấy HTTP trước redirect. Fix ở Cloudflare dashboard, không phải repo.

### Phần deployment/DNS (không phải code CDKT — anh xử lý ngoài repo)

#### A. Cloudflare edge (fix High "Login Form over HTTP")

Vào Cloudflare dashboard → domain `delify.vn` (hoặc `cdht.delify.vn` nếu zone riêng):

1. **SSL/TLS → Edge Certificates → Always Use HTTPS**: ON. Tự redirect 80→443 tại edge, client không bao giờ thấy HTTP.
2. **SSL/TLS → Edge Certificates → HSTS**: ON, `max-age: 31536000` (1 năm), `includeSubDomains: true`, `preload: true`. Edge gửi HSTS cho mọi response.
3. **SSL/TLS → Edge Certificates → Minimum TLS Version**: 1.2.
4. **SSL/TLS → Edge Certificates → Automatic HTTPS Rewrites**: ON.
5. **Rules → Page Rules** (nếu cần): `http://cdht.delify.vn/*` → "Always Use HTTPS".

Verify sau bật: `curl -I http://cdht.delify.vn/admin/login` → phải ra `301` về `https://` + `Strict-Transport-Security` header.

Lý do scanner thấy "Login Form over HTTP": scan `http://cdht.delify.vn/admin/login` → Cloudflare proxy trả 200 (forward tới origin) thay vì 301→HTTPS. Bật "Always Use HTTPS" edge chặn triệt để.

#### B. DNS SPF/DMARC/DKIM (fix 2 Medium)

Thêm 3 record DNS ở zone `delify.vn` (DNS provider — Cloudflare hoặc registrar):

**SPF** (TXT `delify.vn`):
```
v=spf1 include:_spf.google.com include:_spf.mailchimp.com ~all
```
Thay `include:` bằng mail provider thật anh dùng. `~all` (softfail) để test, sau chuyển `-all` (hardfail). Đảm bảo MX record chỉ指向 authorized mail server.

**DKIM** (TXT `_default._domainkey.delify.vn` — hoặc record provider cấp):
```
v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEB...
```
Lấy public key từ mail provider (Google Workspace, Mailchimp, Brevo...). DKIM ký email header, receiver verify.

**DMARC** (TXT `_dmarc.delify.vn`):
```
v=DMARC1; p=none; rua=mailto:dmarc@delify.vn; ruf=mailto:dmarc@delify.vn; fo=1
```
Bắt đầu `p=none` (monitor), xem report 1-2 tuần, rồi `p=quarantine` (spam folder), cuối `p=reject` (drop). `rua` nhận report tổng hợp, `ruf` nhận report forensic.

Verify: `dig TXT delify.vn` + `dig TXT _dmarc.delify.vn` + https://mxtoolbox.com/dmarcheck.

#### C. DNSSEC (fix Low — optional cho portal nhà nước)

Cloudflare: DNS → DNS settings → Enable DNSSEC → copy DS record → dán vào registrar. Cloudflare tự ký zone. Verify: `dig +dnssec delify.vn`.

DNSSEC chống DNS spoofing/cache poisoning — low severity vì khó exploit nhưng portal nhà nước nên bật cho đủ.

### Tóm tắt phân công

| Finding | Fix chỗ | Ai làm |
|---|---|---|
| Login HTTP (high) | Cloudflare edge | Anh (dashboard) |
| SPF/DMARC/DKIM (medium) | DNS zone delify.vn | Anh (DNS provider) |
| DNSSEC (low) | DNS zone + registrar | Anh |
| CSP unsafe-inline (medium) | Code — KHÔNG fix (Nuxt 4) | Đợi Nuxt 5 |
| Rate limiting (medium) | Code — ĐÃ CÓ | — |
| COOP/CORP (info) | Code — ĐÃ FIX | Em |
| COEP (info) | Code — KHÔNG fix (rủi ro) | Đợi browser+R2 |
| Các header khác (info) | Code — ĐÃ CÓ | — |
