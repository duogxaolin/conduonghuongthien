# Hiệu năng trang công khai — mức nền & ứng viên tối ưu (2026-10-13)

Mục D1 của kế hoạch tối ưu sau audit. **Bước 1 (đo) xong; bước 2 (sửa) chờ quyết định ở cuối tài liệu.** Không sửa theo suy đoán: mọi ứng viên dưới đây có số đo kèm theo.

## Cách đo và giới hạn của phép đo

- Lighthouse 13.5 chạy bằng Chrome cài sẵn trên máy (headless), danh mục *performance*, mobile (giả lập mạng 4G chậm + CPU chậm 4×) và desktop.
- Đo trên **bản build production chạy local** (image Docker `cdkt_app`, `http://localhost:3000`). **Không** phải domain production: từ môi trường phát triển không kết nối được tới `conduonghuongthien.com.vn`, và PageSpeed Insights không dùng key trả 429. Vì vậy không có nginx, Cloudflare, brotli ở CDN; TTFB local ~2–90 ms không nói gì về production.
- **Con số mobile là mô phỏng.** Ảnh hero (phần tử LCP) *thực đo* chỉ ~0,35 s; số "LCP 13 s" là Lighthouse tính lại cho mạng chậm và trang nặng 3,5 MB. Nó đo đúng một điều: **tổng dung lượng và CSS chặn render**. Đó cũng là đòn bẩy thật trên điện thoại mạng yếu.
- **LCP báo thấp hơn thời gian khách thật sự chờ.** Lớp phủ "Đang tải..." của lượt tải đầu (`app/app.vue`) che toàn trang cho tới khi hydrate xong, nhưng Chrome vẫn tính phần tử LCP khi nó đã vẽ *dưới* lớp phủ. Một lần đo (localhost, CPU chậm 4×): chữ "Đang tải..." hiện ở ~716 ms (đúng mốc Chrome báo), nội dung chỉ thấy được ở **~1985 ms**. So sánh trước/sau một thay đổi về hydrate/lớp phủ phải đo mốc lớp phủ biến mất, không chỉ LCP. (Lớp phủ nay có trần ~4 s và tự ẩn khi tắt JS hoặc khi hydrate lỗi — xem `app/utils/boot-overlay.ts`.)
- **Biến động giữa các lần chạy lớn:** trang chủ mobile chấm 36 ở lần chạy đầu và 51 ở lần sau, cùng mã. Đừng so hai con số đơn lẻ; so sánh trước/sau phải chạy mỗi bên ≥ 3 lần và lấy trung vị.

## Mức nền (một lần chạy mỗi ô)

| Trang | Dạng | Điểm | FCP ms | LCP ms | TBT ms | CLS | KB |
|---|---|---|---|---|---|---|---|
| `/` | mobile | 36 | 8606 | 14302 | 874 | 0,040 | 3544 |
| `/` | desktop | 76 | 1591 | 2557 | 80 | 0,087 | 3620 |
| `/news` | mobile | 46 | 8282 | 16267 | 413 | 0,040 | 2798 |
| `/news` | desktop | 75 | 1514 | 2957 | 31 | 0,086 | 3053 |
| `/news/<bài>` | mobile | 45 | 8277 | 17568 | 445 | 0,076 | 3578 |
| `/news/<bài>` | desktop | 71 | 1499 | 3340 | 27 | 0,130 | 3631 |
| `/assistant` | mobile | 53 | 7529 | 12467 | 262 | 0,037 | 2337 |
| `/assistant` | desktop | 81 | 1378 | 2175 | 5 | 0,105 | 2441 |
| `/role-models` | mobile | 49 | 8121 | 17612 | 354 | 0,042 | 2699 |
| `/role-models` | desktop | 77 | 1459 | 3224 | 23 | 0,028 | 2754 |

Desktop ổn (71–81). Mobile yếu vì **dung lượng**, không phải vì máy chủ chậm. CLS ở bài viết (0,13) hơi trên ngưỡng "tốt" 0,1 — đáng xem riêng.

## Trang chủ mobile: dung lượng đi đâu (3,5 MB, 133 request)

| Loại | Request | KB |
|---|---|---|
| Font | 7 | **903** |
| Script | 34 | 660 |
| Stylesheet | 9 | 378 |
| Ảnh | 14 | 314 |
| Tài liệu HTML | 1 | 145 |

Nặng nhất: `fa-regular-400.woff2` **351 KB**, `fa-solid-900.woff2` **272 KB**, `entry.css` 178 KB, `fa-brands-400.woff2` **115 KB**, `fontawesome.min.css` 153 KB, ảnh hero 153 KB (đã tối ưu). Có **8 stylesheet chặn render** (`inter.css`, `fontawesome.min.css`, `solid/regular/brands.min.css`, `entry.css`, …) và 3 font FontAwesome được `preload` ép tải ngay.
"Reduce unused CSS" ước tính −323 KB / −1,8 s; "Reduce unused JavaScript" −96 KB / −0,46 s.

## Phép thử "nếu bỏ…" (chặn URL, chỉ để biết trần cải thiện — không phải thay đổi code)

Trang chủ mobile, một lần chạy mỗi biến thể (cùng phiên đo, baseline = 51 điểm):

| Biến thể | Điểm | FCP ms | LCP ms | KB |
|---|---|---|---|---|
| baseline | 51 | 7701 | 13301 | 3544 |
| bỏ FA `regular` + `brands` (CSS + font) | 52 | 7546 | 10514 | 3058 |
| bỏ **toàn bộ** FontAwesome | 54 | 6610 | 8128 | 2630 |
| bỏ font Inter `cyrillic` | 54 | 8024 | 13598 | 3524 |

Đọc: FontAwesome là phần nặng nhất có thể cắt được (**−914 KB, LCP mô phỏng −5,2 s** ở trần); riêng `regular` + `brands` đã −486 KB / −2,8 s. Font `cyrillic` của Inter (nạp vì bộ chọn ngôn ngữ có chữ "Русский") không đáng kể. Điểm tổng chỉ nhích vài điểm vì còn JS/CSS khác.

## Ứng viên, xếp theo tác động đo được

| # | Ứng viên | Tác động (trần đo được) | Rủi ro / ràng buộc | Cần quyết định |
|---|---|---|---|---|
| 1 | **Giảm payload FontAwesome** (font 740 KB + CSS ~320 KB, preload cả 3 họ) | −0,5 đến −0,9 MB; LCP mô phỏng −2,8 đến −5,2 s | **Tập icon là mở**: admin gõ tự do tên icon (`fa-brands fa-facebook-f`, `fa-solid fa-video`… ở menu, loại nội dung, mạng xã hội) nên không cắt font tĩnh theo icon trong code được. Font là FA Pro self-host: cắt nhỏ/phân phối lại cần kiểm giấy phép | Có (xem dưới) |
| 2 | **CSS chặn render ~600 KB**: `fontawesome.min.css` (153 KB, bản đồ lớp) + 3 CSS họ + `entry.css` | FCP mô phỏng giảm; ước tính −1,8 s ("unused CSS") | Tải CSS icon không chặn render sẽ làm icon hiện muộn (nháy) | Có |
| 3 | **JS 660 KB / 34 file**, 96 KB không dùng | TBT 260–870 ms trên mobile | Tách mã theo trang dễ vỡ hydrate (đã có tiền sử: `docs/decisions`) | Đo thêm trước |
| 4 | CLS bài viết 0,13 | Trên ngưỡng 0,1 | Cần xác định phần tử gây dịch chuyển | Không |

### Cách giảm payload FontAwesome (ứng viên #1) — ba hướng, đều có đánh đổi

- **A. Thay icon `regular` công khai bằng `solid` tương đương** (lịch, đồng hồ, người, mắt, tin tức: khoảng 10 icon ở `ArticleDetail`, `ContentTypeListSection`, `NewsCategoryList`, `LiveHero`…). Bỏ được `regular` (−351 KB) khỏi mọi trang công khai. **Đổi kiểu icon (viền → đặc): quyết định thiết kế** theo `openspec/ui-dna.md`; icon `regular` do admin cấu hình vẫn cần font — nên nạp lười (`unicode-range`/không `preload`).
- **B. Cắt nhỏ + dự phòng bằng font đầy đủ.** Khai báo hai `@font-face` cùng họ: font đầy đủ (mọi mã) khai báo trước, font cắt nhỏ (chỉ icon đang dùng) khai báo sau với `unicode-range` của nó. Ký tự có trong bản cắt dùng bản nhỏ; icon nằm ngoài (admin cấu hình) mới kéo font đầy đủ. Không làm hỏng icon nào, nhưng cần công cụ cắt font (`fonttools`/`subset-font`, **chưa có** trong môi trường này) và kiểm giấy phép FA Pro.
- **C. Chỉ bỏ `preload` của `regular` và `brands`** để trình duyệt chỉ tải khi có glyph dùng tới. Rủi ro thấp nhưng **ít lợi**: trang chủ đang render 7 icon `regular` và 1 `brands`, nên vẫn tải cả hai.

## Không làm (và vì sao)
- Không đo lại bằng PSI/Cloudflare từ đây (không có đường mạng). Số trên domain production cần anh chạy `npx lighthouse https://conduonghuongthien.com.vn --only-categories=performance` ≥ 3 lần.
- Không sửa JS/hydrate theo cảm tính (ứng viên #3) cho tới khi có phân tích theo chunk.

## Chạy lại phép đo
```bash
mkdir -p /tmp/lh && cd /tmp/lh && npm init -y >/dev/null && npm install lighthouse --ignore-scripts
CHROME_PATH=/opt/google/chrome/chrome node node_modules/lighthouse/cli/index.js http://localhost:3000/ \
  --only-categories=performance --output=json --output-path=home-mobile.json \
  --chrome-flags="--headless=new --no-sandbox"          # thêm --preset=desktop cho desktop
# Phép thử "nếu bỏ": thêm --blocked-url-patterns='*/css/regular.min.css' (lặp cờ cho nhiều mẫu)
```
(npm 12 chặn tải gói theo URL mặc định: thêm `--allow-remote=all` nếu `npm install` báo `EALLOWREMOTE`.)
