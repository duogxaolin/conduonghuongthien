# Changelog — Lịch sử tính năng CDKT

> Toàn bộ nội dung dưới đây được chuyển ra từ `CLAUDE.md` (§ Work Accomplished, ~93k chars)
> để đưa `CLAUDE.md` về dưới 40k. `CLAUDE.md` hiện chỉ giữ tóm tắt + link tới đây.
> Chi tiết diễn giải vì-sao → `docs/decisions/README.md`.

## 🔑 Các Tính Năng Đã Hoàn Thành (Work Accomplished)

### 1. Giao diện Người dùng (Public Website)
- **Top Bar & Header**: Hotline (`📞 0903.480.985`), Chuyển đổi ngôn ngữ (`[VN] [EN]`), Nút Hỗ trợ 24/7.
- **Dynamic Home Sections**: Trang chủ tự động tải và hiển thị thứ tự các khối Block (Banner, Tin tức, Tấm gương, Mô hình, Văn bản...) từ MySQL Database.
- **Trợ lý AI Chatbot**: Widget trò chuyện tư vấn hỗ trợ 24/7 trực tuyến.
- **Chuẩn hóa Icon FontAwesome 6**: Tích hợp vector icons đồng bộ trên toàn bộ giao diện public.

### 2. Hệ thống Quản trị Admin Panel (`/admin`)
- **Phân quyền RBAC (Role-Based Access Control)**:
  - Admin có thể tạo các Vai trò (Roles) và thiết lập Ma trận quyền chi tiết (`Create`, `Read`, `Update`, `Delete`) trên từng tài nguyên (`users`, `roles`, `news`, `home_sections`, `pages`, `categories`, `media`, `settings`, `submissions`, `documents`, `faq`, `analytics`, `chatbot_knowledge`, `chatbot_settings`, `readers`, `comments`...). **`readers` và `comments` mặc định KHÔNG cấp cho vai trò nào** — phải cấp tay sau khi triển khai, xem mục 4.
- **Quản lý Người dùng (User Management - `/admin/users`)**:
  - Modal Chỉnh sửa tài khoản full tính năng: Đổi Email, Đổi Mật khẩu (bcrypt hash), Đổi Vai trò (Role), Khóa / Mở khóa trạng thái tài khoản.
- **Page Builder Toàn Site (`/admin/content/pages`)**:
  - Trang public (chủ, giới thiệu, liên hệ + trang tùy biến) render trực tiếp từ dữ liệu block trong DB thay vì markup hardcode — chỉnh sửa của editor có hiệu lực thật trên site.
  - Danh sách trang: tạo trang tùy biến (slug tự sinh), xóa (trang hệ thống bị khóa), badge phân biệt trang hệ thống.
  - Trình dựng trang (`/admin/content/pages/[id]`): kéo-thả sắp xếp block (HTML5 DnD + nút `▲/▼`), bật/tắt hiển thị, palette thêm block nhóm theo category, edit drawer sinh động từ registry `fields`, cấu hình meta/SEO trang.
- **WordPress Gutenberg Style Home Editor (`/admin/content/home`)** (legacy, vẫn dùng được):
  - Danh sách Block kéo-thả trực quan kèm nút di chuyển `▲ / ▼` và bật/tắt hiển thị `Hiển thị / Đã ẩn`.
  - Drawer Modal Tùy biến Block chia thành 3 Tab:
    1. **Nội dung & Văn bản**: Tiêu đề chính, Subtitle, Đoạn mô tả, Nút bấm CTA, Số lượng bài hiển thị.
    2. **Giao diện & Layout**: Chọn Màu nền (Trắng, Xám nhạt, Xanh lá đậm), Chọn Bố cục (Grid 3 Cột, Grid 4 Cột, Card Nổi), Chọn Ảnh nền trực tiếp từ **Thư viện Media**.
    3. **Live Preview**: Xem trước hình ảnh thực tế của Block ngay trong trình chỉnh sửa.
- **Thư viện Media (`/admin/media`)**:
  - Tải lên hình ảnh với tự động tối ưu dung lượng (Sharp image engine), hỗ trợ cả lưu trữ trên máy chủ cục bộ (`/public/uploads/`) và Cloudflare R2 (S3-compatible).
  - Tích hợp `MediaLibraryModal.vue` giúp chọn ảnh nhanh khi viết bài hoặc sửa Block trang chủ.
- **Hệ thống Toast Notification Toàn Website (`useToast.ts` & `ToastContainer.vue`)**:
  - Thay thế 100% lệnh `alert()` trình duyệt bằng các hộp thông báo Toast Glassmorphic hiện đại, có icon FontAwesome vector và thanh đếm ngược tự động ẩn.
- **Bảo mật Phiên làm việc (Session Persistence)**:
  - Khắc phục triệt me lỗi mất session khi F5 nhờ cơ chế linh hoạt HTTP/HTTPS Cookie (`lax` SameSite) và tự động chuyển tiếp Request Header trong Nuxt SSR (`useRequestHeaders(['cookie'])`).

### 3. Trợ lý Chatbot (2 chế độ trả lời)
- **Chọn chế độ tại `/admin/chatbot/settings` → "Chế độ trả lời"**:
  - **Chỉ kho kiến thức (không AI)**: khớp câu hỏi theo từ khoá và trả lời bằng nội dung đã duyệt trong Kho kiến thức. Không gọi AI. Có ô "Lời chào vui vẻ" thêm vào đầu mỗi câu trả lời.
  - **Dùng AI**: gọi AI kèm system prompt, luôn ưu tiên/neo vào dữ liệu Kho kiến thức. Khi câu hỏi nằm ngoài kho, admin chọn được: *bám kho* (an toàn) hoặc *để AI tự trả lời*.
  - Tương thích ngược: cấu hình cũ chưa có trường `mode` vẫn chạy AI như trước; `init.ts` tự backfill `mode='ai'` cho deployment đã cấu hình provider.
- **Hai kho tách biệt: kho nghiệp vụ và kho trả lời thường nhật.** Chatbot có hai nguồn trả lời độc lập ở tầng lược đồ, ranh giới do trình biên dịch giữ chứ không do ai phải nhớ:
  - **Kho nghiệp vụ** (`chatbot_knowledge`, không đổi): mỗi câu là phát ngôn pháp lý, có luồng duyệt nháp→published và bắt buộc có nguồn (`validatePublish`). Đây là kho **luôn được ưu tiên**.
  - **Kho trả lời thường nhật** (`chatbot_small_talk`, bảng thứ 31): dữ liệu **quản lý được** tại `/admin/chatbot/small-talk` — cán bộ sửa lời văn, bật/tắt, thêm mục mà không cần deploy. KHÔNG có luồng duyệt, KHÔNG bắt nguồn. Năm nhóm: `social` (xã giao), `identity` (danh tính & năng lực bot), `navigation` (điều hướng cổng), `support` (hỗ trợ cảm xúc — mọi câu phải điều hướng về Công an xã/phường hoặc hotline, không tư vấn tâm lý, không hứa kết quả), `portal_facts` (thường thức về chính cổng). Dataset mặc định ~121 mục ở `server/data/chatbot-small-talk-seed.ts`, nạp **insert-only** qua `seed.ts` (khoá trên câu hỏi đã chuẩn hoá) nên lời văn cán bộ đã sửa sống qua mọi lần khởi động lại. Số hotline luôn nội suy từ hằng `CHATBOT_HOTLINE`, không viết cứng.
  - **Matcher** (`server/utils/chatbot/small-talk.ts`) là **hàm thuần** `matchSmallTalk(entries, query)`: nhận mục đã nạp từ CSDL + câu hỏi, trả `{ id, category, answer } | null`. Ba tầng khớp theo độ đặc hiệu giảm dần: khớp chính xác câu đã chuẩn hoá → khớp chính xác một pattern → pattern xuất hiện trọn vẹn dưới dạng chuỗi token liên tiếp (pattern dài hơn thắng; hoà thì `displayOrder` rồi `id`). Từ ngắn dễ nhầm (≤4 ký tự không dấu như "duoc", "oi", "ok", "da") chỉ khớp khi **là toàn bộ tin nhắn**. Chốt độ dài nới rộng (≤120 ký tự / ≤20 token) chỉ là lưới an toàn cuối, không phải cơ chế khớp chính — nhờ đó câu đời thường dài như "cho tôi hỏi dùng dịch vụ này có mất phí không ạ" (11 từ) vẫn khớp được.
  - **Công tắc** `small_talk_enabled` (**mặc định bật**, cột vắng đọc là bật): chỉ nạp kho thường nhật khi kho nghiệp vụ **không khớp gì** và công tắc bật (kiểm công tắc TRƯỚC khi query, nên tắt thì không tốn round-trip). Ở chế độ AI cũng chặn trước khi gọi provider. `knowledgeGreeting` được prepend cho mọi nhóm TRỪ `social` (tránh chào hai lần). Loại phản hồi `kind: 'small_talk'`. Tắt công tắc → trả về đúng hành vi cũ (xin thông tin liên hệ). RBAC dùng chung resource `chatbot_knowledge` (không tạo resource mới).
  - **Điều kiện tiên quyết đã sửa:** ngưỡng khớp chuỗi con cho từ khoá một từ trong `retrieval.ts` nâng từ `>= 3` lên `>= 4`. Với ngưỡng 3, từ khoá "thủ" (không dấu `thu`) khớp token "thức" (`thuc`), nên câu đời thường khớp sai vào kho nghiệp vụ → `references` không rỗng → matcher thường nhật không bao giờ chạy. Âm tiết tiếng Việt không dấu phần lớn dài 2-3 ký tự nên ngưỡng 4 cắt đúng nhóm đó mà giữ khớp tiền tố có nghĩa ("giấy tờ" ↔ "giấy tờ tùy thân", 7 ký tự).
- **Để lại thông tin liên hệ**: khi không có câu trả lời (cả 2 chế độ), widget mời khách để lại họ tên/SĐT/email → lưu vào `/admin/submissions` và gửi email qua SMTP (người nhận lấy từ cấu hình phía server, không nhận từ client).
- **Nhập câu hỏi từ Excel** (`/admin/chatbot/knowledge` → "Nhập từ Excel"): đọc `.xlsx`/`.csv` cột `STT · Câu hỏi · Trả lời · Ghi chú`, tự tách từ khoá tiếng Việt (từ đơn + cụm 2 từ) để khớp câu hỏi đời thường. Trình đọc XLSX tự viết (`server/utils/xlsx-reader.ts`), không phụ thuộc thư viện ngoài. Mặc định nhập vào trạng thái Bản nháp chờ duyệt.
- **Câu hỏi nhanh quản trực tiếp trên danh sách** (`/admin/chatbot/knowledge`): cột "Câu hỏi nhanh" bật/tắt tại chỗ (PUT qua route sửa thường, nên vẫn chịu mọi quy tắc vòng đời và vẫn ghi audit), thanh hành động hàng loạt có "Đưa vào / Bỏ khỏi câu hỏi nhanh" (`bulk-quick-question.post.ts`, cần quyền `update`), và bộ lọc ba trạng thái `quick=`(rỗng)`|yes|no`. Giá trị lạ bị **từ chối** chứ không suy diễn — `quick=1` đọc thành "yes" sẽ hiện danh sách đã lọc trong khi ô chọn vẫn ghi "Tất cả". Cờ này **không tự xuất bản**: widget chỉ đọc `status='published' AND is_quick_question=1`, nên gắn cờ cho bản nháp chỉ là xếp lịch cho lúc nó được xuất bản.

- **Trang `Tài liệu Hỏi – Đáp` (`/qa-documents`)** — kho câu trả lời đã duyệt dưới dạng một trang đọc được, không phải một tác dụng phụ của việc trò chuyện. Trước đó `chatbot_knowledge` chỉ tới được bằng cách **đặt đúng câu hỏi khớp một hàng** rồi bấm mở tham chiếu; người chỉ muốn đọc xem cổng đã duyệt những gì thì không có lối vào nào.
  - **Là tuyến MỚI, không phải `/legal-qa` trỏ lại.** Hai trang đọc **hai bảng khác nhau**: `/legal-qa` liệt kê `articles` với `type='faq'` (bài biên tập, sửa ở `/admin/content/articles`), còn trang này liệt kê `chatbot_knowledge` (có luồng duyệt nháp→published + bắt buộc nguồn, sửa ở `/admin/chatbot/knowledge`). Trỏ `/legal-qa` sang kho chatbot là **làm biến mất** toàn bộ bài biên tập đang đứng ở đó.
  - **Widget giữ nguyên phần mở tại chỗ VÀ có thêm liên kết ra trang.** Mở tại chỗ trả lời "vừa rồi bot dẫn cái gì" mà không đá khách ra khỏi cuộc hội thoại; liên kết `#qa-<id>` trả lời câu tiếp theo — chủ đề xung quanh. Thay cái trước bằng cái sau là bắt khách trả bằng cuộc hội thoại của họ để đọc một tham chiếu.
  - **Endpoint `GET /api/public/chatbot/knowledge`**: `status='published'` duy nhất; projection dựng từ `serializePublicKnowledge` **chứ không** `select()` trên bảng, nên ai đó thêm cột sau này cũng không đẩy được `internalNotes` ra ngoài. `perPage` chặn trần 50. Chủ đề trong facet chỉ đếm **hàng đã xuất bản** — lấy từ cả bảng là quảng cáo một chủ đề rỗng, bấm vào thì danh sách trống mà không có lời giải thích nào. Lỗi truy vấn trả `ok: false` (trang đổi thành nhánh lỗi có nút thử lại) thay vì mảng rỗng: **một lượt truy vấn hỏng không được phép đọc ra "cổng chưa duyệt gì cả"**.
  - **Chủ đề lạ trả trang rỗng, không trả 400.** Bộ lọc nằm trong URL mà khách sửa được và chia sẻ được; một liên kết cũ mà báo lỗi thì đọc ra là cổng bị hỏng.
  - **Số trong query phải qua `Number.isFinite` TRƯỚC khi kẹp biên** — `Math.max(1, Number('abc'))` = `NaN` -> JSON `page: null`; `?page=1e999` lọt. Test chặn cả hai. (Cùng quy tắc `finitePositive` — `docs/decisions/data-layer.md`.)
  - **Accordion cho phép mở nhiều mục cùng lúc** (`openIds` là `Set`, không phải một `activeIndex` như `/legal-qa`): ở đây khách đang đọc và đối chiếu, đóng câu trả lời trước để mở câu sau là đánh đổi sai. Neo `#qa-<id>` **tự mở** mục được trỏ tới — tới một danh sách đóng hết thì đọc ra là liên kết chết. Câu trả lời hiện bằng **văn bản** (`whitespace-pre-line`), tuyệt đối không `v-html`.
  - `q` / `topic` / `page` đọc từ URL (chia sẻ được, F5 không mất bộ lọc), `lazy: true` để khung xương thật sự được vẽ khi đổi bộ lọc, `swr: 60` cùng lý do như `/legal-qa`. `tests/public-qa-documents-page.test.ts` chặn cả bộ: nó **bỏ comment trước khi khẳng định** những thứ "không được xuất hiện" — nếu không, chính dòng giải thích *vì sao* `internalNotes` phải ở lại máy chủ sẽ làm đỏ cái test nó đang giải thích, và bài học rút ra sẽ là xoá lời giải thích chứ không phải giữ guard.

- **Phiên trò chuyện: chữ ra từ từ, nhiều cuộc hội thoại, trang toàn màn hình, lưu SQL** — bốn thứ này ăn khớp nhau qua **một** composable `app/composables/useChatbot.ts`. Widget (`app/components/ChatWidget.vue`) và trang `/assistant` là hai bề mặt của cùng một state ở **cấp module**, không phải state theo từng lời gọi: khách bấm nút mở rộng giữa cuộc hội thoại phải rơi vào đúng cuộc đó, không phải một cuộc mới.
  - **"Chữ ra từ từ" là hiệu ứng phía client, không streaming** (`/api/public/chatbot` đợi xong rồi phát **một** SSE). `playTypewriter` tách chữ bằng `fullText.match(/\S+\s*/g)` giữ nguyên dấu phân cách (không `split(' ')` — gộp dòng mới = định dạng lại văn bản pháp luật). `isStreaming` che nhãn/danh sách nguồn/biểu mẫu liên hệ; `persist()` bỏ tin nhắn đang `isStreaming`. **Nhịp theo thời gian trôi qua (không đếm timer), trần 6 giây** (`TYPEWRITER_WORD_DELAY_MS=70`, `TYPEWRITER_MAX_MS=6000`), `requestAnimationFrame` trái dấu SSR `setTimeout(16)`. **`target` KHÔNG được có sàn `Math.max(index+1, …)`** — sàn buộc mỗi khung hiện >=1 từ = 60 từ/giây, vô hiệu hằng số cho câu ngắn (trung vị 27 từ). `playTypewriter` nhận phần tử từ mảng (`ref` -> proxy), không nhận object literal vừa push. Cuộn theo đáy chỉ khi khách ở đáy (`followChatBottom`). `tests/chatbot-typing-playback.test.ts` đọc hai hằng số + đếm render. Chi tiết: `docs/decisions/chatbot.md` (mục "Nhịp typewriter").
  - **Bẫy bot `_h`** (honeypot, nằm ngoài thứ tự tab): điền vào thì trả **200 kèm một câu trả lời hợp lý**, không bao giờ 400/403 — mã trạng thái khác sẽ chỉ cho con script biết đúng ô nào đã tố nó.
  - **Giới hạn tần suất đã chuyển sang bảng `rate_limit_counters`** (`chat-policy.ts` — `Map` trong tiến trình đã bị **xoá**): sống qua restart, đúng khi chạy nhiều replica, mất CSDL thì lùi về bộ nhớ tiến trình chứ không mở toang. Hạn mức AI **tính theo phiên** (20 lượt / 60 phút) và **trừ ngay trước mỗi lời gọi provider**, không trừ ở đầu handler: trừ trước sẽ tiêu hạn mức cho những câu trả lời lấy từ kho mà không hề gọi provider, rồi cắt một người chưa dùng gì. Hết hạn mức mà **đã có tham chiếu trong tay** thì lùi về câu trả lời đã duyệt — câu đã duyệt vẫn là câu trả lời; chỉ nhánh hỏi tự do mới trả `rate_limited`.
  - **Ghi CSDL được `await`, không bắn rồi bỏ** (`session-db.ts`): Nitro có thể dỡ context của request khi handler trả về, cắt một promise rời tay giữa lúc truy vấn. Hàm **tự nuốt lỗi của mình** (`chat_session.persist_failed`) nên `await` không thể làm hỏng câu trả lời — một bộ ghi log không có tư cách làm sập trang của khách. `ON DUPLICATE KEY UPDATE` **không chạm `started_at`**: một phiên bắt đầu đúng một lần. Số điện thoại / họ tên phát hiện được ghi bằng `COALESCE` nên tên nêu ở lượt 2 và số nêu ở lượt 5 **cùng sống**, chứ không xoá nhau.
  - **Trang quản trị `/admin/chatbot/sessions`** dùng chung quyền `chatbot_knowledge.read` — ai được đọc kho câu trả lời đã duyệt thì cũng được đọc câu hỏi khách đặt cho nó; tạo resource mới là buộc cấp lại quyền cho mọi vai trò đang có trước khi trang chạy được. **Mọi lượt xem tự ghi một dòng `activity_logs`** kèm bộ lọc: những hàng này chứa địa chỉ IP và có khi cả số điện thoại, và một nhật ký quét được trong im lặng là công cụ theo dõi. Trang chi tiết **đối chiếu số điện thoại với `submissions`** bằng 9 chữ số cuối (`REGEXP_REPLACE` + `RIGHT`) chứ không so chuỗi thô — biểu mẫu nhận cả `0903 480 985`, `+84903480985` và `0903480985` là cùng một số, nên so thẳng sẽ trượt gần hết ca thật. Đây là lý do việc phát hiện số điện thoại tồn tại: một người hỏi bot rồi sau đó gửi biểu mẫu là **một người với một vấn đề**, và cán bộ không thấy được cả hai nửa sẽ gọi lại hỏi đúng thứ họ đã gõ.
  - **Phát hiện liên hệ cố tình bảo thủ** (`contact-detect.ts`): chỉ nhận đầu số di động (`03/05/07/08/09`, đúng 10 số) — số cố định **cố ý loại ra**, và số căn cước / số nghị định không được ghi thành số liên hệ. Tên chỉ nhận khi có động từ giới thiệu tường minh ("tôi tên", "em là"); đoán tên theo chữ hoa sẽ sai liên tục trong tiếng Việt, và một cái tên sai gắn vào phiên còn tệ hơn không có tên. Tiểu từ cuối câu bị cắt (`ạ`, `nhé`, `ơi`, …) nhưng **"a" không dấu thì không** — "Nguyễn Văn A" là cách viết tên phổ biến nhất, cắt chữ "A" đó sẽ phá nhiều tên hơn số tiểu từ dọn được.
  - **Đã đăng ký với `data-retention.ts`** (`chat_sessions` là scope thứ ba, mặc định 90 ngày, cấu hình tại `/admin/settings/data-retention`). Hai bảng này chứa IP, user agent và có khi cả số điện thoại — đúng loại dữ liệu cần thời hạn lưu. Bảng già theo **`last_message_at`** chứ không phải `started_at` (bảng không có `created_at`), và cap sắp xếp theo cùng cột đó vì `id` là UUID. `chat_messages` **không** có cửa sổ riêng: FK `ON DELETE CASCADE` đã dọn nó theo phiên, còn một cửa sổ độc lập sẽ để lại tin nhắn mồ côi hoặc cắt ngang hội thoại. Chi tiết ở mục "Tự động dọn dữ liệu".
- **Trợ lý AI Biên tập & Soát lỗi bài viết (`/admin/content/articles/[id]`, `POST /api/admin/ai/editorial`)**:
  - **Soát lỗi & trau chuốt văn phong**: AI rà soát chính tả, ngữ pháp, danh xưng địa phương và số hiệu văn bản quy phạm pháp luật (chuẩn hóa theo Nghị định 49/2020/NĐ-CP, Quyết định 22/2023/QĐ-TTg, đơn vị hành chính...).
  - **Hiển thị Diff trực quan**: Không trả về JSON thô hay đè toàn bài mà chia nhỏ thành các thẻ so sánh: `Đoạn văn bản gốc` (đỏ gạch ngang) $\rightarrow$ `Đề xuất chuẩn hóa` (xanh đậm) kèm `Lý do`. Cho phép người biên tập chọn `Áp dụng sửa đổi này` trên từng thẻ hoặc `Áp dụng tất cả sửa đổi vào bài viết`.
  - **Schema & Token Gateway**: Schema JSON ưu tiên mảng `changes` và `summaryNotes` lên trước `polishedContent`. `buildProviderChatCall` và `callAi` truyền đúng `maxTokens` cấu hình từ `ai_service_configs` (4096 tokens) thay vì bị kẹp trần 1200 tokens; kèm parser tự phục hồi `changes` nếu bài viết quá dài.
  - **TinyMCE content bridge**: `getEditorContent()` khai báo hàm chuẩn (hoisted) ngay đầu script, đồng bộ nội dung từ TinyMCE iframe sang form state trước khi gọi AI.

- **Bộ nhớ ngữ cảnh đa lượt Chatbot (`useChatbot.ts`, `chat-policy.ts`, `prompt-defaults.ts`)**:
  - Composable client duy trì `boundedUserHistory` gói cả lượt hỏi của người dùng và câu trả lời trước đó của bot vào payload gửi lên `/api/public/chatbot`, cho phép hỏi nối tiếp tự nhiên (ví dụ: "cho tôi ví dụ", "ở đâu?", "thủ tục thế nào?").
  - System prompt quy định rõ ràng việc kế thừa ngữ cảnh hội thoại, chủ động khai thác triệt để các công cụ tra cứu (`search_c11_knowledge`, `search_c11_articles`, `search_c11_photos`, `search_c11_videos`) khi gặp câu hỏi nối tiếp có đại từ thay thế hoặc câu hỏi ngắn.

### 4. Đăng nhập Google & bình luận công khai

Cổng vốn chỉ nói ra mà không nghe được: người đọc một bài tấm gương hoàn lương hay một mục hỏi đáp không có cách nào đặt câu hỏi tiếp **ở nơi người kế tiếp có cùng thắc mắc sẽ đọc thấy**. Hai đường vào cũ (biểu mẫu 24/7 và chatbot) đều là một-đối-một và vô hình với người thứ ba.

- **Danh tính người đọc TÁCH HOÀN TOÀN khỏi danh tính quản trị, có HAI rào chắn độc lập.** Vé người đọc mang `stage: 'reader'` trong cookie riêng `cdkt_reader`, **và** được ký bằng khoá dẫn xuất từ `JWT_SECRET` (HKDF-SHA256, nhãn `cdkt-reader-session:v1`) — không phải chính `JWT_SECRET`. Một rào đủ chặn; hai rào vì **hai kiểu hỏng khác nhau** (kiểm claim chống refactor nhận mọi vé ký hợp lệ; khoá riêng chống refactor thôi không kiểm claim). Vé người đọc sống **30 ngày** (vs vé MFA 5 phút) nên rào thứ hai là trả giá cho bất đối xứng đó. `tests/reader-session-boundary.test.ts` kiểm từng rào. Chi tiết: `docs/decisions/reader-features.md` (mục "Hai rào chắn").
  - Người đọc **không có** mặt trong bảng `users`, không có quyền RBAC nào, không vào được `/admin`. Payload vé chỉ chứa `readerId` + `tokenVersion` — không email, không tên: hai thứ đó đọc từ CSDL mỗi lần gọi `/api/public/reader/me`, nên một lệnh chặn hoặc một lần đổi tên có hiệu lực **ngay**, không đợi vé hết hạn.
  - `reader_accounts.token_version` **tăng lên khi bị chặn**, nên vé đang nằm trong trình duyệt hết hiệu lực tức thì — cùng cơ chế `users.tokenVersion` đã có.
  - `sameSite: 'lax'` là **điều kiện tiên quyết, không phải lựa chọn**: lượt callback từ Google là điều hướng khác site, và `strict` sẽ giữ lại cookie đúng ở bước đó — người đọc vừa bấm đồng ý xong thì quay về cổng ở trạng thái chưa đăng nhập, không có gì để chỉ vào.
  - **Không có middleware cho người đọc** (`server/utils/reader-auth.ts` chỉ export `requireReader` / `optionalReader`). Middleware quản trị tồn tại vì ~120 tuyến cần xử lý y hệt nhau; ở đây có năm, và một trong số đó (đọc luồng bình luận) cần dạng **tuỳ chọn** để người đã đăng nhập thấy nút xoá trên bình luận của mình mà khách chưa đăng nhập vẫn đọc được. Một middleware mà đôi khi phải không chặn là middleware người đọc mã sau này sẽ hiểu sai.

- **Redirect URI được SUY RA từ chính request (scheme + host), KHÔNG từ `PUBLIC_BASE_URL`.** `resolveRedirectUri(event)` và `resolveDriveRedirectUri(event)` đều gọi `requestBase(event)` (export từ `server/utils/google-oauth/config.ts`) — Google so khớp **từng ký tự** nên một codebase phục vụ nhiều domain thì mỗi domain cần đăng ký riêng trong Console, và gửi `PUBLIC_BASE_URL` cứng là `redirect_uri_mismatch` trên mọi domain còn lại. `PUBLIC_BASE_URL` chỉ còn là giá trị tham khảo hiện trên trang `/admin/settings/google-oauth` (`publicBaseUrl` trong `SerializedGoogleOAuthSettings` / `SerializedDriveOauthConfig`), cùng `redirectUriSource` cho biết có đặt hay không. `requestBase` áp `TRUSTED_PROXY_IPS` → `x-forwarded-proto/host` như `getClientIp` nên sau nginx vẫn ra đúng host trình duyệt thấy. Chi tiết: `docs/decisions/reader-features.md` (mục "Redirect URI").
  - Client ID / Client secret nhập **trong trang quản trị, không phải `.env`**. Secret mã hoá AES-256-GCM bằng `CHATBOT_ENCRYPTION_SECRET` với nhãn riêng `cdkt-google-oauth-secret:v1`, **không bao giờ** trả về client (form hiện `••••1234` + ô thay thế). Nhãn khác nhau nghĩa là một envelope của tính năng này **không giải mã được** khi đọc như một API key chatbot và ngược lại — chép ciphertext giữa hai bảng không cho ra bí mật dùng được.
  - **`secret_unreadable` là trạng thái phân biệt được**, không đọc thành "chưa cấu hình". Báo sai sẽ đẩy cán bộ đi nhập lại một secret họ đã nhập rồi, trong khi cách xử lý thật là khôi phục khoá cũ hoặc xoá rồi nhập secret mới. Trang in đúng triệu chứng kèm cách xử lý.
  - **Chữ ký `id_token` cố ý KHÔNG kiểm tại chỗ** (`server/utils/google-oauth/id-token.ts`): token này về từ chính lượt POST server-to-server của cổng tới `oauth2.googleapis.com`, qua TLS, có xác thực bằng client secret. Thêm JWKS là thêm một phụ thuộc mạng, một cache khoá và một đường xoay khoá vào luồng đăng nhập — tất cả đều có thể hỏng, và không cứu được gì trừ khi TLS hoặc client secret đã bị chiếm, mà lúc đó kẻ tấn công tự phát hành token được rồi. **Nhưng claim thì vẫn kiểm**: `aud` phải đúng client id (chặn một token thật của Google nhưng phát cho ứng dụng khác), `iss` phải là Google, `exp` phải còn hạn, `sub` phải có.
  - **`sub` là khoá tài khoản, không bao giờ email.** Email đổi được và cấp lại được, nên khoá theo email là gộp hai người thành một hoặc chẻ một người thành hai. Email vẫn lưu và **tìm kiếm được** ở trang kiểm duyệt, nhưng không bao giờ dùng để khớp.
  - **`state` là MỘT cookie có chữ ký, chở cả nonce lẫn đường về** (`cdkt_oauth_state`, `base64url(JSON{s,r}).hmac`, sống 10 phút, xoá khi dùng). Cookie client ghi được **dù là HTTP-only**, nên chữ ký là thứ làm đường về đáng tin — không phải việc nó bị ẩn. Lúc xác minh: tính lại HMAC, so `s` bằng `timingSafeEqual`, rồi **kiểm lại `r` một lần nữa** — dữ liệu đã ký vẫn là dữ liệu vào.
  - `isSafeReturnPath` là **hàm thuần**, chỉ nhận đúng một dấu `/` đầu; từ chối `//evil.com` (URL tương đối giao thức — trình duyệt đọc là tuyệt đối, nên kiểm một dấu gạch là không đủ), mọi scheme, mọi `@`, mọi dấu gạch chéo ngược, và mọi ký tự điều khiển (chèn header).

- **KHÔNG có ảnh đại diện từ Google, URL ảnh KHÔNG được lưu.** Avatar vẽ tại chỗ (`app/components/ReaderAvatar.vue`). Nhúng `lh3.googleusercontent.com` = gửi IP/referrer của mọi khách tới Google trên trang công dân — chính lý do dự án tự chủ webfont. Claim `picture` bị đọc rồi bỏ trong hàm thuần, không caller nào lưu được. Chi tiết: `docs/decisions/reader-features.md` (mục "Không ảnh đại diện").

- **Nội dung bình luận là VĂN BẢN THUẦN, nên `sanitizeHtml` KHÔNG được dùng.** Kiểm tra (1–2000 ký tự sau khi trim, CRLF về LF, mọi ký tự điều khiển khác bị từ chối) rồi hiển thị bằng `{{ }}` + `whitespace-pre-line break-words`. **Không `v-html`, không ở đâu, không bao giờ** — cùng quy tắc `/qa-documents` đang theo. Máy chủ lưu **nguyên văn** đúng vì template không thể hiểu nó: chạy sanitizer ở đây sẽ âm thầm viết lại chữ của công dân (dấu ngoặc nhọn trong một điều luật được dẫn, dấu `&` trong tên một đơn vị) và trả về cho họ những từ họ không hề gõ. Quá dài thì **từ chối kèm nêu rõ giới hạn**, không bao giờ cắt ngầm — một công dân bị mất đoạn cuối không có cách nào biết là mình đã mất.
- **Đúng MỘT cấp trả lời.** Cha của một phản hồi phải có `parentId === null`; quy tắc nằm trong hàm thuần `checkParentEligibility` nên kiểm được không cần CSDL. Giới hạn độ sâu là thứ giữ cho luồng còn đọc được trên điện thoại và giữ truy vấn đọc ở **đúng hai lượt** thay vì đệ quy.
- **Không có đường sửa bình luận, ở bất cứ đâu.** Không endpoint nào nhận nội dung mới cho một bình luận đã tồn tại. Một phát ngôn công khai sửa được sau đó là bản ghi của không điều gì — và một phản hồi của Ban quản trị có thể nằm dưới một câu hỏi không còn giống câu nó đã trả lời. Sửa nghĩa là xoá rồi viết lại.

- **Công tắc bình luận theo từng bài** (`articles.comments_enabled`, mặc định **TẮT**): bật/tắt tại chỗ ở `/admin/content/articles` **qua chính route sửa bài**, nên vẫn chịu đúng kiểm tra quyền theo thể loại (`articleResource(type)` + `update`) và vẫn ghi audit. Mặc định ngược lại sẽ **mở bình luận cho toàn bộ kho lưu trữ ngay lúc triển khai** — một khối lượng kiểm duyệt không ai chọn, do một lượt migrate quyết định. Có thêm hành động **hàng loạt** (`bulk-comments.post.ts`) và một **giá trị mặc định cho bài mới** lưu trong cấu hình, vì không có hai thứ đó thì "mở những bài cần mở" là hàng trăm cú bấm — và chính loại ma sát vĩnh viễn đó dẫn tới việc ai đó đi đổi giá trị mặc định của cột rồi mở lại cả kho.
  - **Tắt công tắc là ẨN luồng, không xoá gì.** Trang công khai ngừng hiển thị và ngừng nhận bài mới; quản trị viên **vẫn thấy** trong trang kiểm duyệt và **vẫn trả lời được**. Đóng bình luận là chặn công chúng đăng, không phải chặn cổng trả lời. Xoá sẽ làm công tắc thành thao tác phá huỷ, mà nó sẽ được bấm một cách nhẹ tay.

- **Phiên hết hạn giữa lúc trang đang mở phải thành một màn hình người đọc làm được gì.** Vé sống 30 ngày và một lệnh chặn tăng `tokenVersion` ngay, nên máy chủ có thể bắt đầu từ chối lượt ghi khi trang vẫn đang mở. `reportFailure` bắt **401** → lưu nháp → bỏ danh tính đã cache, nên khung soạn được thay bằng nút đăng nhập. Không có nhánh này thì `isSignedIn` cũ vẫn đúng, khung soạn còn nguyên với dòng "Chưa đăng nhập" bên dưới và **không có nút đăng nhập nào** — một ngõ cụt mà đường ra duy nhất là tự tải lại trang. **403 thì KHÔNG xử lý như vậy**: đó là lệnh chặn, người đọc **vẫn** đang đăng nhập, và mời họ đăng nhập lại là mời một lượt sẽ thành công mà không đổi gì — đọc ra là cổng bị hỏng chứ không phải một quyết định của ai đó.
  - **Lý do phải hiện trên khối đăng nhập, không phải trong form.** `submitError` sống trong khung soạn, nên nó bị bỏ đúng bởi cái thay đổi trạng thái mà nó cần giải thích: người đọc bấm "Gửi", thấy form đột nhiên thành một nút đăng nhập, và không có gì nói vì sao.
  - **Nháp lưu ra `sessionStorage` TRƯỚC khi bỏ danh tính.** `signIn()` là `window.location.href` — một lượt điều hướng cấp trang thật (luồng OAuth là chuỗi redirect qua accounts.google.com, không làm được trong XHR), nên **mọi ref trong component chết**. Hứa "nội dung vẫn được giữ" mà không ghi ra chỗ sống qua lượt điều hướng đó là một lời nói dối nói đúng vào lúc người đọc đang tin vào nó. `sessionStorage` chứ không `localStorage`: giữ lâu hơn thì một câu hỏi bỏ dở nửa năm trước sẽ hiện lại trên máy dùng chung — chữ của người khác trong khung soạn của người đang ngồi đó. Xoá ngay sau khi phục hồi **và** sau khi gửi thành công, nếu không lượt tải sau sẽ điền lại đúng bình luận vừa gửi và người đọc tưởng nó chưa đi.
- **Xoá bình luận của người đọc = xoá luôn phản hồi Ban quản trị nằm dưới** (mọi FK CASCADE; `admin_user_id` SET NULL). Hộp thoại xác nhận đếm **BA con số** (`comments`/`adminReplies`/`otherReaderReplies` — counterReaderCommentImpact) đo trước khi xoá: người đọc B trả lời được câu hỏi của A, xoá A = mất luôn phản hồi B. Phương án bia mộ bị **từ chối** (luồng "đã xoá" + phản hồi chính thức bên dưới = mời suy diễn sai). MỘT đường xoá duy nhất: `deleteComment`/`deleteReaderComments` (`server/services/comments.ts`) — dùng chung tự xoá/admin/hàng loạt/chặn/tài khoản/dọn trữ. Chặn gói cờ+`tokenVersion`+xoá vào **một transaction**. Bỏ chặn KHÔNG phục hồi gì. Chi tiết: `docs/decisions/reader-features.md` (mục "Xoá bình luận cascade").

- **Chặn địa chỉ IP có hiệu lực ở CẢ HAI điểm** (`/admin/settings/ip-bans`): lúc bắt đầu đăng nhập **và** lúc gửi bình luận. Chỉ chặn ở lúc gửi thì người bị chặn tạo một tài khoản Google mới là đi tiếp — lệnh chặn tài khoản thành vô nghĩa; chỉ chặn ở lúc đăng nhập thì người đang có vé vẫn đăng được. Dùng lại **đúng** hàm khớp literal-hoặc-CIDR của `isTrustedProxy` (tách thành `matchesIpList` trong `client-ip.ts`): bản thứ hai của phép toán CIDR là chỗ thứ hai để làm sai một biên mặt nạ, và hai bản chỉ được đối chiếu khi một lệnh chặn không nổ — tức là sau khi việc đã xảy ra, giữa một sự vụ đang sống. **Dải IPv6 bị TỪ CHỐI ngay lúc nhập** kèm thông báo nêu rõ giới hạn: một lệnh chặn lưu được mà không khớp ai là lệnh chặn cán bộ tin rằng đang có hiệu lực.

- **Hai resource RBAC mới, `readers` và `comments`, và cố ý KHÔNG cấp cho vai trò nào.** Không gộp vào quyền bài viết: một cán bộ được viết tin **không vì thế** được đọc email và lịch sử phát ngôn của công dân — đó là loại dữ liệu khác. (Tiền lệ small-talk dùng chung `chatbot_knowledge` chỉ áp dụng khi dữ liệu **thật sự cùng loại**.) Seed là insert-only nên ma trận quyền đã sửa vẫn sống; chỉ superadmin có sẵn. **Sau khi triển khai phải cấp tay** — xem "Thứ tự sau triển khai" dưới đây.
- **Hàng và dòng audit phải COMMIT CÙNG NHAU trong một transaction** (`tests/reader-audit-atomicity.test.ts` chặn cả chín đường ghi). `tx.insert(activityLogs)`, không `db.insert(activityLogs)` trong khối (vẫn chạy trên pool, commit độc lập). Xoá-rồi-ghi-log = mất cặp khi câu 2 lỗi: hàng mất, không còn gì ghi ai xoá. Ngoại lệ được **nêu tên**: `deleteArticleById`, `setArticleStatus` — test khoá đúng trạng thái, sửa chúng = test đỏ. Chi tiết: `docs/decisions/data-layer.md` (mục "Đường ghi audit").
- **Mọi lượt ĐỌC và mọi lượt GHI dữ liệu người đọc đều ghi `activity_logs` trên cùng đường ghi**, không phải một helper bắn-rồi-bỏ. Lượt đọc chở theo bộ lọc đã dùng; lượt xoá chở theo số bản ghi (sau khi hàng đã mất thì con số là bằng chứng duy nhất còn lại); lệnh chặn chở theo lý do và số đã xoá. **Một nhật ký dữ liệu công dân quét được trong im lặng là công cụ theo dõi, không phải nhật ký kiểm toán.**
- **Giới hạn tần suất** qua `rate_limit_counters`: đăng nhập 10 lượt/10 phút theo địa chỉ; gửi bình luận 5 lượt/10 phút theo **tài khoản** và 15 lượt/10 phút theo **địa chỉ**. Cần cả hai khoá: chỉ theo tài khoản thì tạo tài khoản mới là thoát, chỉ theo địa chỉ thì một cơ quan dùng chung đường truyền bị phạt vì hành vi của một người. **Một lượt ghi bị từ chối KHÔNG tốn hạn mức** — hai lời gọi `recordRateLimitHit` nằm **ngay trước** câu INSERT, không ở đầu handler: trừ sớm thì một người đọc mà cả năm lần thử đều rơi vào bài đã đóng sẽ bị khoá mười phút dù chưa có bình luận nào tồn tại, và tệ hơn, nó cho kẻ tấn công cách tiêu hạn mức của người khác bằng những request vốn luôn thất bại. **Lượt ĐỌC luồng không giới hạn**: giới hạn ở đó là bóp cổ việc đọc bình thường, và cái giá đã được chặn bằng index tổ hợp `(article_id, parent_id, created_at)` cộng trần số bản ghi mỗi trang do máy chủ áp.
- **Ràng buộc bao trùm — an toàn bộ nhớ đệm.** Mọi tuyến bài viết công khai phục vụ qua `{ swr: 60 }`. Danh tính người đọc và luồng bình luận **đều nạp từ trình duyệt sau khi mount**, đúng hình dạng mà ping đếm lượt xem trong `ArticleDetail.vue` đã dùng. **Không tuyến nào được thêm vào `routeRules`.** Nếu không: một luồng dựng phía máy chủ sẽ được phát lại cho người kế tiếp trong cùng cửa sổ 60 giây — **kèm theo các cờ `canDelete`** cho biết bình luận nào là của **người đọc hiện tại** để xoá, tức là hiện nút xoá của người này trên bình luận của người khác. Trạng thái đăng nhập trên header bọc trong `<client-only>` và **không có `fallback`**: một nút "Đăng nhập" nhấp nháy rồi đổi thành tên còn tệ hơn xuất hiện muộn nửa giây.
- **`last_seen_at` phải được đóng dấu ở đường ghi THẬT, không chỉ lúc đăng nhập.** `touchReader` được gọi ở `POST /api/public/comments` (viết bình luận) và `GET /api/public/reader/me` (mỗi lượt tải trang có người đọc). Bản đầu viết hàm này rồi **không gọi ở đâu cả**, và đó không phải code chết vô hại: `last_seen_at` là **chính cột mà scope lưu trữ tính tuổi**, nên người ghi duy nhất còn lại là lượt callback OAuth. Vé người đọc sống 30 ngày, vậy một người đăng nhập một lần rồi bình luận đều đặn suốt một năm sẽ mang `last_seen_at` **đóng băng ở lần đăng nhập đầu tiên** — tài khoản hết hạn theo cửa sổ 365 ngày **trong khi họ vẫn đang viết**, và lượt dọn mang theo toàn bộ bình luận của họ. Hàm tự nuốt lỗi của mình nên một lượt đóng dấu hỏng không thể làm hỏng bình luận vừa lưu thành công.
- **`reader_accounts` là scope lưu trữ thứ tư** (mặc định 365 ngày, cấu hình tại `/admin/settings/data-retention`). Tính tuổi **và** sắp xếp cap theo **`last_seen_at`**, không theo `created_at` cũng không theo `id`: khoá chính ở đây là AUTO_INCREMENT nên thứ tự `id` là thứ tự **đăng ký**, và một cap theo `id` sẽ đuổi những người đọc ghi danh sớm nhất kể cả khi họ đang hoạt động nhất. Dài hơn 90 ngày của phiên chat vì xoá một tài khoản người đọc là **phá một lịch sử phát ngôn công khai**, còn một bản ghi chat là cuộc trao đổi một-đối-một đã đóng. **`article_comments` cố ý KHÔNG phải một scope** — cùng lý do như `chat_messages`: FK của nó cascade từ **cả** `reader_accounts` **và** `articles` nên đã được chặn sẵn; một cửa sổ tuổi độc lập sẽ xoá câu hỏi trong khi phản hồi chính thức vẫn hiện ra như đang trả lời điều gì đó, còn một cap số bản ghi sẽ **cắt đôi một cuộc trao đổi công khai** giữa công dân và cán bộ — nửa còn lại đọc ra nghĩa mà toàn bộ chưa bao giờ nói.
- **Thứ tự sau triển khai** (`/admin/settings/google-oauth` in đúng danh sách này trên trang): (1) cấp `readers` + `comments` cho vai trò kiểm duyệt tại `/admin/users/roles` — **không cấp thì trang không mở được**; (2) dán Redirect URI hiện trên trang vào Google Cloud Console; (3) lưu Client ID + Client secret; (4) bật công tắc; (5) mở bình luận cho từng bài viết. Tính năng **tối khi vừa lên**: công tắc tắt, và `comments_enabled` tắt cho mọi bài — nên "không thấy gì" sau khi deploy là **đúng như thiết kế**, không phải lỗi.
- **Rollback** là tắt công tắc: đăng nhập và ghi bình luận dừng, **mọi hàng được giữ**, bật lại không mất gì. Không cần đảo schema — bốn bảng và cột thêm vào là trơ khi công tắc tắt.

### 4b. Trang cá nhân người đọc (`/profile`)

Đăng nhập Google lên rồi nhưng bề mặt của nó với công dân chỉ là một dòng chữ ở góc header: không có chỗ nào để đi, không đổi được tên, không xem lại được mình đã hỏi gì. Và trên **điện thoại thì tính năng đăng nhập không tồn tại** — khối cũ mang `hidden lg:flex`, ngăn kéo mobile không có gì tương đương, trong khi phần lớn công dân đọc cổng này bằng điện thoại. Đó là lỗi, không phải chuyện trang trí.

- **`/profile` KHÔNG được thêm vào `routeRules`, và đây là ràng buộc bao trùm.** Mọi tuyến công khai khác phục vụ qua `swr: 60`; một cửa sổ đệm ở trang này là phát tên, email, bình luận và tiêu đề đoạn chat của người này cho người kế tiếp ghé vào trong 60 giây. Hệ quả kéo theo: **mọi dữ liệu nạp sau mount** (không `useFetch`, không `useAsyncData` — có test chặn), toàn bộ thân trang bọc `<client-only>` **không `fallback`**, và **không có middleware chuyển hướng** khi chưa đăng nhập — `useReaderAuth` chỉ biết người đọc là ai sau mount, nên một middleware sẽ chạy trước khi biết và đá cả người đã đăng nhập ra ngoài. Trang hiện khối mời đăng nhập.
- **Tên tự đặt nằm ở cột riêng `reader_accounts.custom_display_name`, không ghi đè cột Google.** `callback.get.ts` làm mới `display_name` từ Google ở **mỗi** lượt đăng nhập (có chủ đích), nên cho người đọc sửa thẳng cột đó là để lần đăng nhập kế tiếp âm thầm xoá tên họ vừa đặt. Tên hiệu lực = `custom_display_name ?? display_name ?? 'Người dùng'`, gói trong **một** hàm thuần `effectiveDisplayName()`. Không có cờ boolean nào — một cờ là một trạng thái thứ ba để lệch.
  - **`server/utils/display-name.ts` là module LÁ**, không nằm trong `services/`: `readers.ts` đã import `comments.ts`, nên đặt logic tên ở một trong hai là tạo phụ thuộc vòng. Cả hai đều cần — luồng bình luận công khai và danh sách kiểm duyệt đều render tên người đọc. `readers.ts` re-export lại để các nơi gọi cũ giữ nguyên một đường import.
  - **Phải sửa đủ NĂM bề mặt, không chỉ header.** `serializePublicComment` nhận **cả hai** cột (`readerName` + `readerCustomName`) và giải quyết bằng `effectiveDisplayName`; `loadCommentThread` và `listCommentsForAdmin` đều select thêm cột thứ hai. Thiếu bất kỳ chỗ nào thì đổi tên xong mà bình luận vẫn mang tên cũ — và cán bộ nhận báo cáo về "Bác Ba" sẽ không tìm ra hàng nào tên "Bác Ba". Danh sách kiểm duyệt cố ý hiện **tên công chúng thấy**, không phải cột Google thô.
  - **Đổi tên ghi `activity_logs` trong CÙNG transaction** với câu UPDATE — đường ghi thứ 12 trong `tests/reader-audit-atomicity.test.ts`. `userId: null` vì `activity_logs.user_id` là FK tới `users` và người đọc không có hàng ở đó; danh tính người thực hiện nằm ở `meta.readerId`. Ghi id người đọc vào cột "id tài khoản cán bộ" sẽ khiến mọi truy vấn audit có join `users` âm thầm quy hành vi này cho cán bộ đang giữ id đó.
  - Giới hạn 10 lượt/10 phút **theo tài khoản**, trừ hạn mức **ngay trước** câu UPDATE chứ không ở đầu handler — một lượt bị từ chối (tên rỗng, quá dài) không được tốn hạn mức, đúng tiền lệ đường ghi bình luận.
- **"Bài đã xem" lưu ở TRÌNH DUYỆT (`localStorage['cdkt_reader_history_v1']`, tối đa 50), cố ý không có bảng nào.** Đây là quyết định dễ bị một người sau này "sửa" nhất, nên lý do phải đọc được: `article_view_daily` chỉ đếm theo (ngày, bài, nguồn) và lượt ping dùng `deriveDailyVisitorToken` **chính vì** không lưu IP/user agent. Làm theo tài khoản nghĩa là tạo một bảng ghi **công dân nào đã đọc bài nào, lúc nào** trên cổng của Bộ Công an — với độc giả là người có án đang tra cứu vị thế pháp lý của chính mình. Bảng đó sẽ sống lâu hơn mọi ai còn quan tâm tới danh sách này.
  - **Đánh đổi phải in ra trên trang**, không để người đọc tự suy: danh sách theo **thiết bị**, không theo tài khoản. Có test chặn cả hai câu ("thiết bị này", "không lưu trên máy chủ") — người tưởng nó theo tài khoản sẽ kết luận cổng làm mất dữ liệu của họ.
  - **`formatDateVN` KHÔNG dùng được cho `readAt`**, và đây là ngoại lệ duy nhất của quy tắc "không định dạng ngày theo giờ cục bộ" (`tests/public-pages-structure.test.ts`, `LOCAL_TIME_EXEMPTIONS`, đếm theo **số lần xuất hiện** chứ không chỉ tên tệp). `formatDateVN` đọc bằng `getUTC*` — đúng cho cột DATETIME cần khớp SSR ↔ trình duyệt, nhưng `readAt` là mốc `Date.now()` sinh ngay trên máy này và chỉ tồn tại trong `localStorage` của nó, nên đọc bằng UTC là **lùi 7 giờ**: bài đọc lúc 6 giờ sáng hiện ra ngày hôm trước. Ngoại lệ chỉ đứng vững khi hai tiền đề còn đúng (dữ liệu ở client, khối nằm trong `<client-only>`); có test kiểm **từng tiền đề**.
- **Nhận đoạn chat cũ dùng chính vé HMAC trình duyệt đang giữ** (`POST /api/public/reader/claim-chats`). `localStorage['cdkt_sessions_v1']` giữ `{id, token}`; endpoint **kiểm chữ ký từng vé** bằng `verifySessionToken` và bỏ qua id nào không qua. Không có bước đó thì tuyến này là "đọc cho tôi một uuid rồi đưa tôi bản ghi" — và một bản ghi chat có thể chứa số điện thoại lẫn mô tả tiền án của người khác.
  - `chat_sessions.reader_id` là FK **`ON DELETE SET NULL`**, cố ý không CASCADE: `chat_sessions` là scope lưu trữ 90 ngày còn `reader_accounts` là 365, nên cascade sẽ làm một lượt xoá tài khoản mang theo cả bản ghi chat mà **hộp thoại xác nhận đang không đếm** — cán bộ đồng ý với một việc khác việc xảy ra.
  - Chỉ nhận phiên có `reader_id IS NULL`, và điều kiện đó nằm **trong câu UPDATE** chứ không phải một lượt SELECT trước đó: đọc-rồi-ghi thì hai lượt gọi đồng thời đều thấy null và đều ghi. Số trả về **đếm lại phần người đọc đang sở hữu**, không đọc `affectedRows` — `affectedRows` đếm hàng *đổi*, nên phiên đã nhận từ lần trước ra 0 trong khi nó đang hiện ngay bên dưới.
  - `useReaderAuth.load()` tự gửi một lượt nhận **một lần mỗi phiên trình duyệt** (cờ `sessionStorage`), mọi lỗi nuốt. **Cờ bị xoá khi đăng xuất và khi vé hết hiệu lực** — không thì trên máy dùng chung, người B đăng nhập sau người A sẽ không bao giờ được mời nhận chat của mình.
- **`GET /reader/comments` và `GET /reader/chats` cố ý KHÔNG ghi audit.** Quy tắc "mọi lượt đọc dữ liệu người đọc phải có audit" nhắm vào **cán bộ đọc dữ liệu công dân**; bắt ghi log mỗi lần một người xem trang của chính họ là biến trang cá nhân thành nguồn rác và làm loãng đúng những dòng bảng đó tồn tại để ghi — cùng lý do `/admin/profile` không gắn `checkPermission`. Danh tính lấy từ vé, **không có tham số `readerId`** ở bất kỳ endpoint nào.
- **Liên kết tới bài viết luôn là `/news/<slug>`, không suy từ `type`.** `/news/[id].vue` tra theo slug **không lọc type** nên nó render mọi loại bài, và nó là trang chi tiết **duy nhất** làm vậy; `/documents` và `/legal-qa` chỉ có trang danh sách, **không có trang chi tiết**. Một tiền tố theo type sẽ trả 404 cho đúng những bình luận người đọc để lại dưới một văn bản pháp luật, và họ sẽ hiểu là cổng đã xoá lời họ viết. Bài đã ẩn hoặc đã đóng bình luận thì **nói ra** thay vì đưa liên kết dẫn tới một trang không có luồng nào.
- **401 giữa lúc trang đang mở thì bỏ danh tính đã cache; 403 thì KHÔNG.** Vé sống 30 ngày và một lệnh chặn tăng `tokenVersion` ngay, nên máy chủ có thể bắt đầu từ chối khi trang vẫn mở. 401 → `forgetReader()` để form đổi thành nút đăng nhập; giữ nguyên thì `reader` cũ vẫn truthy, form còn đó kèm một dòng lỗi và **không có nút đăng nhập nào** — ngõ cụt mà đường ra duy nhất là tự tải lại trang. 403 là lệnh chặn: người đọc **vẫn** đang đăng nhập, mời họ đăng nhập lại là mời một lượt sẽ thành công mà không đổi gì.
- **Menu danh tính ở header là `absolute`**, nên tổ tiên của nó **không được** có `overflow-x` khác `visible` — `overflow-x: auto` ép `overflow-y` thành `auto` và **cắt** menu. Cùng cái bẫy đã ghi ở thanh điều hướng ngang. Đóng được bằng Escape **và** bằng cú bấm ra ngoài (bắt ở `mousedown`, không `click`: đóng ở `click` thì handler chạy sau khi Vue đã tháo phần tử, nên liên kết bên trong menu không kịp điều hướng).
- **Khối danh tính phải có ở CẢ HAI bề mặt** — header desktop và ngăn kéo mobile. `tests/public-pages-structure.test.ts` đếm **số lần xuất hiện** của nút đăng nhập / liên kết `/profile` / nút đăng xuất, vì một lần dọn dẹp sau này rất dễ gộp hai khối thành một rồi bỏ mất bản trong ngăn kéo, và triệu chứng chỉ hiện trên điện thoại.
- **`db.insert()` trả về MẢNG — đã sửa thêm hai chỗ nữa.** `createComment` và `createAdminReply` (`services/comments.ts`) đọc `.insertId` trên giá trị **chưa destructure**, nên luôn ra `undefined` → `0`. Ở `createAdminReply` hậu quả là `resourceId: 0` trong `activity_logs`: một phản hồi chính thức đang hiển thị mà dòng audit trỏ vào hàng không tồn tại — đúng cái mà việc bọc hai lượt ghi vào một transaction ra đời để ngăn. Tổng cộng **bốn** chỗ đã viết sai (`callback.get.ts`, `ip-bans.ts`, và hai chỗ này); `tests/insert-id-integration.test.ts` là suite duy nhất bắt được loại lỗi này vì chỉ driver thật mới phản đối.

### 4c. Thông báo trả lời & neo tới từng bình luận

Luồng bình luận vốn **một chiều**: công dân đặt câu hỏi dưới bài viết rồi rời đi, và không có đường nào biết đã có ai trả lời. Ban quản trị trả lời một câu hỏi pháp lý — người hỏi không bao giờ thấy. Đó là hỏng đúng phần có giá trị nhất của tính năng bình luận. Kèm theo: bình luận trước đây **không có địa chỉ riêng**, nên không chia sẻ được và một thông báo có bấm được cũng không có chỗ để tới.

- **Bảng `reader_notifications` (bảng thứ 41), không suy ra từ `article_comments`.** Phương án suy ra (so với một mốc `notifications_seen_at`) chỉ đánh dấu đã đọc được **toàn bộ một lượt** và khoá cứng vào đúng một loại thông báo. Cột `type` mở đường cho loại thứ hai mà không cần migration.
- **Cả hai FK đều CASCADE, và đó là thứ giữ bảng này trung thực.** Xoá trả lời → thông báo về nó biến mất (một thông báo trỏ vào hàng không tồn tại sẽ dẫn người đọc tới một bài viết không có bình luận đó — đọc ra là cổng đã xoá lời họ viết). Xoá tài khoản → thông báo đi theo.
- **CỐ Ý KHÔNG phải scope lưu trữ.** Mọi hàng treo trên `article_comments`, vốn đã cascade từ **cả** `articles` **và** `reader_accounts` — hai scope đã có — nên bảng này bị chặn trước khi `data-retention.ts` nhìn tới. Một cửa sổ tuổi độc lập sẽ xoá thông báo **trong khi trả lời vẫn nằm trên trang chưa ai đọc**, còn một cap số bản ghi sẽ đuổi thông báo cũ nhất của đúng những người hoạt động nhiều nhất. Cùng lý do `chat_messages` và `article_comments` không phải scope — thêm scope thứ năm cho bảng này là lỗi cần tránh.
- **`UNIQUE (reader_id, comment_id)` + `onDuplicateKeyUpdate`, không phải đọc-rồi-ghi.** Chỉ số là thẩm quyền; kiểm tra trước rồi mới ghi thì hai lượt trả lời đồng thời đều thấy "chưa có hàng" và đều chèn.
- **Thông báo ghi trong CÙNG transaction với trả lời.** Cả hai nơi gọi (`createComment` — nay đã bọc transaction, `createAdminReply` — đã có sẵn) truyền `tx` xuống. Một trả lời tồn tại mà không ai được báo là **đúng cái tính năng này ra đời để ngăn**, và nó hỏng trong im lặng: luồng trông đúng với tất cả mọi người trừ người đang chờ câu trả lời.
- **Tự trả lời KHÔNG sinh thông báo**; trả lời của **cả** người đọc khác **lẫn** Ban quản trị thì có. Không có ràng buộc nào về ai được trả lời (chính điều mà `countReaderCommentImpact` phải đếm riêng), nên chỉ báo phản hồi cán bộ thì A không bao giờ biết B đã trả lời mình.
- **`COMMENT_THREAD_PER_PAGE` sống ở `services/notifications.ts` và được endpoint luồng bình luận `import`, không khai hai nơi.** Thông báo trỏ vào một *trả lời*, nhưng luồng phân trang theo *bình luận gốc* — nên số trang phải suy từ cha. Hai bản sao lệch nhau là kiểu hỏng cho ra liên kết rơi **cạnh** bình luận thay vì **trúng** nó, mà **không có gì báo lỗi ở đâu cả**. `notificationTargetPage` là hàm thuần nên ghim được bằng test; việc nó khớp với luồng thật đã kiểm bằng MySQL thật lúc phát triển (dựng 45 bình luận gốc, đòi trang 3 chứa đúng bình luận được neo).
- **URL là `/news/<slug>?comments=<trang>#comment-<id>`** và neo **bình luận gốc**, không neo trả lời — trả lời luôn render dưới cha nên cha là thứ phải mở. Trang phải đọc **trước** lượt nạp đầu tiên, không thì `focusAnchoredComment` chạy trên trang 1 và không tìm thấy gì.
- **Đọc hash bằng `Number.isSafeInteger`**, cùng cách `/qa-documents` đọc `#qa-<id>`: `Number()` trần cho ra `NaN` rồi đi tiếp vào `getElementById` dưới dạng chuỗi `"NaN"`.
- **Chuông phải có ở CẢ HAI bề mặt.** Khối desktop mang `hidden lg:flex`, nên thiếu mục trong ngăn kéo mobile là **trên điện thoại tính năng không tồn tại** — đúng lỗi đã xảy ra một lần với nút đăng nhập. `tests/reader-notifications.test.ts` đếm **số lần xuất hiện** của `fa-bell` và của huy hiệu. Ngăn kéo **không dựng lại danh sách** (ngăn kéo đã là một lớp phủ; một danh sách cuộn lồng trong đó thì bấm hụt liên tục) mà dẫn thẳng tới `/profile#notifications`.
- **Chuông sống trong `ReaderNotificationBell.client.vue`, không nằm trong layout.** Hai lý do, và lý do thứ hai mới là lý do thật:
  - **`.client` là ràng buộc an toàn bộ nhớ đệm, không phải tối ưu hoá.** Mọi tuyến công khai chạy `swr: 60`, nên một khối dựng phía máy chủ mang số chưa đọc của một người sẽ được **phát lại cho người kế tiếp** ghé vào trong 60 giây. Hậu tố `.client` mạnh hơn một lớp bọc `<client-only>`: Nuxt **không đưa component vào bundle máy chủ**, nên không còn lớp bọc nào để một lần sửa sau này lỡ tay gỡ mất. Đã kiểm ở mức bundle sau khi build: `grep` không thấy tên component trong `.output/server/`, và thấy trong `.output/public/_nuxt/`.
  - **Phần đáng tách không phải ~120 dòng template mà là HAI listener cấp document.** Chuông dùng chung Escape và mousedown với menu danh tính, nên chừng nào chúng còn nằm chung thì layout vẫn phải giữ `notifMenuRef` và hai nhánh `if (isNotifMenuOpen)` — một lần "tách component" chỉ dời chữ đi chỗ khác mà **không gỡ được ràng buộc nào**. Component tự đăng ký và tự gỡ listener của nó; test khẳng định layout **không còn** hai định danh đó. Layout đi từ 991 → 866 dòng.
  - Layout **vẫn** chạm `useReaderNotifications` cho đúng hai việc: huy hiệu trong ngăn kéo mobile, và lượt nạp đầu tiên (xem mục ngay dưới). Đăng xuất đóng menu qua `defineExpose({ close })` chứ không qua một ref dùng chung.
- **Nạp bằng `watch(reader)` ở layout, không phải trong `onMounted`.** `loadReader()` cố ý không được `await` (header không chặn lượt vẽ đầu), nên lúc mount `reader` vẫn null và gọi thẳng sẽ nhận 401. Nạp sẵn thay vì đợi mở chuông **vì huy hiệu ở ngăn kéo mobile không có cú mở nào để bám vào** — không nạp thì trên điện thoại con số vĩnh viễn bằng 0.
- **`load()` chia sẻ promise đang bay, không `if (pending) return`.** Layout và `/profile` cùng gọi trên mỗi lượt tải trang cá nhân; một `return` trơn sẽ khiến lượt gọi thứ hai resolve **ngay lập tức** trong khi dữ liệu còn đang về, nên `await` của trang rơi xuống đoạn mã tưởng danh sách đã có. Chỉ chia sẻ khi **cùng số trang** — nếu không, bấm "trang sau" giữa lúc lượt đầu đang bay sẽ lặng lẽ trả về trang cũ.
- **Đánh dấu đã đọc là lạc quan.** Người đọc vừa bấm đúng thứ đó; đợi round-trip mới hạ huy hiệu làm cú bấm có cảm giác bị bỏ qua. Ghi hỏng thì hàng trên máy chủ vẫn chưa đọc và lượt nạp sau khôi phục con số thật — giá của việc sai là một huy hiệu quay lại, không phải mất dữ liệu.
- **`reset()` chạy khi đăng xuất, và xoá cả promise đang bay.** State ở cấp module sống qua lượt đăng xuất; trên máy dùng chung người kế tiếp sẽ thấy huy hiệu của người trước.
- **Không polling nền.** Một lượt poll là một request mỗi vài giây từ **mọi tab đang mở**, đổi lấy một con số không bao giờ khẩn cấp — không ai chờ một câu trả lời pháp lý theo từng giây.
- **Hai endpoint không ghi `activity_logs`**, cùng lý do `GET /reader/comments` không ghi: quy tắc audit nhắm vào **cán bộ đọc dữ liệu công dân**, không phải công dân xem trang của chính mình. Danh tính từ vé, **không có tham số `readerId`**; `markRead`/`markAllRead` luôn có `readerId` trong mệnh đề `WHERE`.
- **Hạn mức trừ NGAY TRƯỚC lượt ghi**, sau mọi lý do từ chối — cùng thứ tự mà đường ghi bình luận và đường đổi tên đã ghi.
- **Bắt đầu từ 0, không backfill.** Chỉ trả lời **từ lúc triển khai** mới sinh hàng, cùng lối đi với lượt xem bài viết. Người có câu hỏi đã được trả lời trước đó sẽ không thấy gì.

#### Gửi email khi có trả lời

- **`server/services/notification-email.ts` tách riêng khỏi `notifications.ts`, có lý do.** Module kia ghi hàng **bên trong transaction của người gọi**; module này nói chuyện với một máy chủ SMTP ở xa. Gộp lại là đặt một lượt đi mạng vào trong transaction — giữ khoá hàng mở suốt thời gian máy chủ mail trả lời, mà với một host chậm hoặc không tới được thì đó là rất lâu. **Gửi sau khi commit, không bao giờ trong transaction.**
- **Theo đúng chính sách "3C" mà `utils/mailer.ts` đã có**: ghi trước, gửi nếu đã cấu hình, và **không bao giờ để lỗi mail ảnh hưởng request**. `sendReplyEmail` có **một** `try/catch` bao trọn, ném ra không gì cả, chỉ để lại `reader_notification.email_failed` trong log. Bình luận của công dân phải lưu được dù máy chủ mail có sống hay không — thông báo trong cổng mới là bản ghi, email là tiện ích thêm. Đã kiểm bằng SMTP thật rồi tắt máy chủ mail giữa chừng: bình luận vẫn thành công.
- **`await` chứ không bắn-rồi-bỏ.** Nitro dỡ context của request khi handler trả về, cắt một promise rời tay giữa chừng. Hàm tự nuốt lỗi nên `await` không thể làm hỏng gì.
- **Cột `reader_accounts.email_notifications` (mặc định BẬT) và công tắc ở `/profile`.** Mặc định bật vì thông báo chính là mục đích — công dân hỏi rồi rời đi, chuông trong cổng chỉ tới được họ nếu họ tình cờ quay lại. Nhưng **bắt buộc phải tắt được**: gửi email cho công dân mà không có đường dừng là spam, bất kể ai gửi. Đọc **tại thời điểm gửi** từ hàng trong CSDL, nên một thiết lập vừa đổi một giây trước vẫn có hiệu lực.
- **Tài khoản Google không có email thì công tắc bị vô hiệu hoá kèm lời giải thích** — hiện một nút bật được ở đó là hứa một việc sẽ không bao giờ xảy ra.
- **Link trong email lấy từ `requestBase(event)` của chính request tạo trả lời, KHÔNG từ `PUBLIC_BASE_URL`.** `sendReplyEmail({…, event})` nhận `H3Event` do `createComment`/`createAdminReply` truyền xuống (`server/services/comments.ts` + 2 handler), rồi `notification-email.ts` gọi `requestBase(event)` — nhờ đó reply từ domain A gửi link domain A, reply từ domain B gửi link domain B. Test `media-comments` ghim `requestBase(input.event)` thay vì `configuredBaseUrl()`. Không có host thì vẫn KHÔNG bịa liên kết: một đường dẫn tương đối trong email là chuỗi chết.
- **Mọi giá trị nội suy đều `escapeHtml`**: tiêu đề bài, tên hiển thị và nội dung bình luận đều là chữ do công dân hoặc cán bộ gõ, và thân bình luận được lưu **nguyên văn** chính vì không thứ gì được phép diễn giải nó.
- **Người bị chặn không nhận email**: bình luận của họ đã bị xoá, nên báo cho họ về một luồng không còn câu hỏi của họ vừa khó hiểu vừa vô nghĩa.

#### Đường dẫn tiếng Anh & chuyển hướng 301

- **Ba tuyến đã đổi tên**: `/nguoi-doc` → `/profile`, `/tai-lieu-hoi-dap` → `/qa-documents`, `/tro-ly` → `/assistant`. Neo đổi từ `#binh-luan-<id>` → `#comment-<id>`, `#thong-bao` → `#notifications`, tham số `?binhluan=` → **`?comments=`**.
- **`?comments=` chứ không phải `?page=`, có lý do.** `/qa-documents` đã dùng `?page=` cho phân trang của chính nó, và trên trang bài viết thì `?page=` mơ hồ — nó là trang bình luận hay trang gì khác? Tên riêng cho một thứ riêng.
- **Ba dòng `redirect` 301 trong `routeRules` là BẮT BUỘC, không phải lịch sự.** Cả ba tuyến đã chạy trên production, đã được chia sẻ và đã vào chỉ mục tìm kiếm — chính trợ lý ảo cũng đã dẫn `/tai-lieu-hoi-dap` trong câu trả lời. Đổi tên mà không có chúng là **làm chết mọi liên kết đã phát ra ngoài**, kể cả liên kết đã in ra giấy hay nằm trong tin nhắn. Một liên kết không có hạn sử dụng; giá để giữ là ba dòng cấu hình. **Đừng xoá theo kiểu dọn dẹp** — có test chặn cả ba.
- **301 chứ không 302**: chuyển hẳn thứ hạng tìm kiếm sang địa chỉ mới thay vì để công cụ tìm kiếm giữ cả hai. Query string **được giữ nguyên** qua lượt chuyển hướng (đã kiểm trên bản build thật: `/tai-lieu-hoi-dap?q=test` → `/qa-documents?q=test`), nên một liên kết đã lọc sẵn vẫn mở đúng kết quả đó.
- **`/profile` CÓ xuất hiện trong `routeRules`** — với tư cách **đích đến** của lượt chuyển hướng, không phải một quy tắc cache. Test kiểm đúng thứ có ý nghĩa: không có khoá `'/profile':` nào (đó mới là hình dạng có thể mang `swr`), và lượt 301 vẫn còn.


### 4d. Vòng đời xử lý Đơn đăng ký (và bốn lớp lỗi khiến email chưa bao giờ gửi được)

Biểu mẫu ở trang chủ và `/contact` **lưu đúng, hiện đúng, và chưa bao giờ gửi được một email nào**. Kèm theo đó, `/admin/submissions` là một danh sách **chỉ đọc**: không có trạng thái xử lý, không biết ai đã xem, không biết đã liên hệ người dân chưa. Hai thiếu sót này ăn vào nhau — không ai được báo có đơn mới, và người tình cờ mở trang ra cũng không đánh dấu được gì.

#### Email: bốn lớp lỗi xếp lên nhau, không lớp nào tự lộ ra

**Đo trên CSDL đang chạy, không phải đọc mã.** Cả bốn phải đúng cùng lúc mới gửi được, nên sửa một lớp là vẫn im lặng:

1. **`SupportFormBlock.vue` (biểu mẫu trang chủ) không gửi `recipientEmail` lẫn `formTitle`** — nên nhánh gửi mail ở `submissions.post.ts` đứng sau `if (recipientEmail && ...)` **không bao giờ được vào**.
2. **`support_form` trong registry KHÔNG CÓ trường `recipientEmail`.** Nó chỉ có `email` — địa chỉ **hiện trên trang** cho người dân đọc. Máy chủ thì đi tìm `data.recipientEmail` trên đúng loại block đó, nên trường cán bộ điền vào không phải trường máy chủ đọc.
3. **`getConfiguredRecipients` chỉ truy vấn `blockType = 'contact_form'`**, nên một `support_form` có cấu hình vẫn không vào được allowlist.
4. **Cả hai hàng block trong CSDL đều có `JSON_EXTRACT(data,'$.recipientEmail') = NULL`** — allowlist là **tập rỗng**, nên mọi địa chỉ đều bị từ chối, kể cả địa chỉ đúng.

Hợp lại: đơn **lưu thành công**, người dân thấy lời cảm ơn, `/admin/submissions` hiện đúng hàng, **không ai được báo**, và **không có lỗi ở đâu cả**. Đây là lý do nó sống lâu — mọi triệu chứng quan sát được đều nói rằng hệ thống đang chạy đúng.

- **Cách sửa là đi theo `chatbot/lead.post.ts` — tệp đó VỐN ĐÃ LÀM ĐÚNG**: giải người nhận **phía máy chủ** theo một chuỗi ưu tiên, không bao giờ tin thân request. `server/utils/submission-recipient.ts` là hàm **thuần**: (địa chỉ client xin, tập đã cấu hình, `settings.email`) → địa chỉ. Ưu tiên: (1) địa chỉ client xin **chỉ khi** nó nằm trong tập đã cấu hình; (2) tập đã cấu hình có **đúng một** địa chỉ → dùng nó (chính ca lỗi #1: cán bộ đã đặt email trong Page Builder mà biểu mẫu quên gửi kèm); (3) `settings.email`. **Nhiều hơn một thì KHÔNG đoán** — chọn hộ là gửi hồ sơ của công dân tới một đơn vị không phụ trách.
  - **Khả năng open-relay biến mất HOÀN TOÀN thay vì được canh bằng một allowlist**: địa chỉ cuối cùng không bao giờ đến từ thân request, nó chỉ **chọn** được một trong các địa chỉ đã cấu hình. Bước 3 cũng làm phép sửa có hiệu lực **ngay** trên dữ liệu đang có — không cần một lượt migrate hay ai đi sửa từng block.
  - **Test cũ ghim văn bản `allowed.has(to)` đã được thay bằng test CHẠY THẬT hàm thuần đó** (`tests/submission-recipient.test.ts`, 16 test). Một khẳng định về ký tự trong mã nguồn không bao giờ chứng minh được hành vi; nay có kiểm chứng âm tính: bỏ phép kiểm allowlist → **5 khẳng định đỏ trên 3 test** (số đếm ở cấp ngoài là 3 vì hai test có subtest lồng — ghi cả hai con số vì `# fail 3` và năm dòng `not ok` là hai cách đếm cùng một lượt chạy, và một tài liệu chỉ nêu một con số sẽ bị đọc là sai khi người sau đối chiếu với con số kia).
- **Mọi lý do BỎ QUA đều ghi log** (`public.submission_email_skipped` kèm `reason`, `public.submission_email_sent` kèm `recipientSource`). Trước đây "không có địa chỉ nhận" và "đã gửi xong" đọc ra **y hệt nhau** trong log: không có gì cả.
- **`submissions.notified_at` đóng dấu khi gửi THÀNH CÔNG.** `NULL` nghĩa là chưa ai được báo — và trước thay đổi này đó là **mọi hàng**. Trang quản trị trả lời được câu đó mà không phải đi đọc log máy chủ. Lượt ghi này **cũng nuốt lỗi của nó**: đơn đã lưu xong, và một cột thống kê không có tư cách làm hỏng phản hồi cho người dân.

#### Vòng đời: 5 trạng thái, sổ nhật ký, ai đã xem

- **`app/utils/submission-status.ts` là nguồn chân lý duy nhất** cho cả phép kiểm phía máy chủ và nhãn hiển thị, đi theo lối `blocks/registry.ts` (server import được từ `app/utils` — có tiền lệ ở `page-versions.ts`). Khai hai bản là để một trạng thái lưu được rồi không có nhãn nào, hoặc một nhãn hiện ra cho giá trị máy chủ sẽ từ chối. `Record<SubmissionStatus, …>` nên **thêm trạng thái mà quên khai nhãn là lỗi biên dịch**, không phải một huy hiệu trắng trơn phát hiện sáu tuần sau.
- **Năm trạng thái**: `new` → `in_progress` → `transferred` / `resolved` / `rejected`. **`new` không phải đích đến của bất kỳ trạng thái nào**: một đơn đã được nhìn tới thì không "chưa tiếp nhận" lại được. Mọi trạng thái khác **đến được lẫn nhau, kể cả từ `resolved`** — một hồ sơ đóng sai phải mở lại được, khoá lại là buộc cán bộ tạo đơn thứ hai cho cùng một người dân và lịch sử của họ nằm ở hai chỗ.
- **`first_viewed_by` / `first_viewed_at` ghi ĐÚNG MỘT LẦN, và điều kiện `IS NULL` nằm TRONG câu UPDATE.** Đọc-rồi-ghi thì hai cán bộ mở cùng lúc đều thấy NULL và người sau ghi đè người trước — sai đúng cái mà cột này tồn tại để trả lời. `affectedRows` là thẩm quyền quyết định "mình là người đầu", đọc qua `affectedRowsOrZero()` chứ **không bao giờ tự ép kiểu**. Có integration test dựng **hai lượt gọi đồng thời** và đòi đúng một lượt thắng.
- **Mở hồ sơ ra đọc KHÔNG tự đổi trạng thái sang `in_progress`.** Đọc không phải nhận xử lý, và tự chuyển sẽ làm mọi đơn rời khỏi ô "Mới tiếp nhận" chỉ vì có ai bấm vào xem — bộ lọc đó vĩnh viễn rỗng và không còn nói lên điều gì. Cùng lý do, **ghi nhận đã liên hệ cũng không tự đổi trạng thái**: gọi điện xong có thể là "đang xử lý", "đã chuyển cơ sở", hay "không tiếp nhận" — đoán hộ là ghi một kết luận nghiệp vụ mà cán bộ chưa đưa ra.
- **`contact` tách khỏi `note` vì đó là hai câu hỏi khác nhau.** "Đã gọi cho người này chưa" là câu cán bộ trực phải trả lời trong vài giây; nằm lẫn trong lời văn ghi chú thì đáp án duy nhất là đọc hết mọi ghi chú của mọi đơn.
- **Bảng `submission_events` (bảng thứ 42)**: `submission_id` **CASCADE** (nhật ký đi theo hồ sơ nó mô tả — một mục trỏ vào hàng không tồn tại là rác), `actor_id` **SET NULL** kèm **ảnh chụp `actor_name`**, nên dòng của một tài khoản **đã bị xoá vẫn đọc được là ai** — đó đúng là dấu vết cần giữ nhất. Cả hai luật đã kiểm bằng MySQL thật.
- **CỐ Ý KHÔNG phải scope lưu trữ thứ năm.** Mọi hàng treo trên `submissions`, vốn **đã** là scope thứ hai, nên bảng này bị chặn trước khi `data-retention.ts` nhìn tới. Một cửa sổ tuổi độc lập sẽ xoá nhật ký **trong khi hồ sơ còn sống** và hồ sơ khai có người xử lý mà không còn gì chứng minh; một cap số bản ghi sẽ **cắt ngang một dòng thời gian** — nửa còn lại đọc ra nghĩa khác hẳn. Cùng lý do `chat_messages`, `article_comments` và `reader_notifications` không phải scope.
- **Mọi lượt ĐỌC và mọi lượt GHI đều audit trên CÙNG một transaction** (`services/submission-workflow.ts`, đường ghi thứ 13-16 trong `tests/reader-audit-atomicity.test.ts`). Đây là hồ sơ liên hệ của công dân, và một nhật ký dữ liệu công dân quét được trong im lặng là công cụ theo dõi. Kiểm chứng âm tính: bỏ một `db.transaction(` → 2 test đỏ.
  - **`activity_logs` cố ý KHÔNG chở họ tên / số điện thoại / địa chỉ.** Chép sang đó là để lại đúng dữ liệu đó ở một bảng thứ hai, và làm lượt xoá đơn ở `deleteSubmissionById` **mất tác dụng**. Ghi chú chỉ ghi **độ dài**, không ghi nội dung.
- **Đổi trạng thái sang CHÍNH trạng thái đang có bị từ chối**: nó không đổi gì mà vẫn sinh một mục nhật ký, và một dòng thời gian đầy những mục không đổi gì là dòng thời gian không ai đọc.
- **Ghi chú quá dài thì TỪ CHỐI kèm nêu rõ giới hạn, không cắt ngầm** (2000 ký tự) — cùng quy tắc nội dung bình luận. Một cán bộ bị mất đoạn cuối ghi chú nghiệp vụ không có cách nào biết là mình đã mất.
- **Phép kiểm ký tự điều khiển nay có MỘT bản** (`server/utils/plain-text.ts`): `comments.ts` từng giữ bản riêng, và bản thứ hai là chỗ thứ hai để làm sai — hai bản chỉ được đối chiếu khi một trong hai ngừng chặn, tức là sau khi việc đã xảy ra. Viết bằng **escape**, không bao giờ bằng byte thật: một ký tự điều khiển nằm nguyên văn trong mã nguồn thì **vô hình trong mọi trình soạn thảo**, nên một lần dọn dẹp sau này có thể xoá nó mà không ai thấy gì đổi. (Chú thích cũ trong `comments.ts` đã cảnh báo đúng điều này, và chính chú thích đó **chứa byte điều khiển thật** — đã dọn.)
- **Hạn mức trừ NGAY TRƯỚC lượt ghi**, sau mọi lý do từ chối — cùng thứ tự mà đường ghi bình luận và đường đổi tên đã ghi. Trừ sớm thì một cán bộ mà cả năm lần thử đều bị từ chối vì lý do hợp lệ sẽ bị khoá dù chưa ghi được gì.
- **RBAC dùng lại `submissions`, KHÔNG thêm resource mới.** Ai được đọc đơn thì được xem nhật ký xử lý của nó; ai được `update` thì đổi được trạng thái. Tạo resource mới là buộc cấp lại quyền cho mọi vai trò đang có trước khi trang chạy được — và `viewer` (`canRead` trên `submissions`) sẽ mất đúng phần nó vẫn xem được.

#### Cổng drift từng có một lỗ, và nó nuốt bốn cột

**`ensureColumn` với định nghĩa trong NHÁY KÉP thì vô hình với `npm run db:drift`.** Regex của nó chỉ khớp `'([^']*)'`, còn một `DEFAULT 'new'` **buộc** phải dùng nháy kép ở ngoài. Đo được: **bốn cột** dùng dạng đó (`submissions.status` và ba cột `chatbot_settings`), và **không cột nào** được cổng nhìn thấy qua đường `ensureColumn` — ba cột chatbot chỉ thoát nhờ tình cờ có mặt trong một mảng migration khác. Đã sửa **chính cổng** thay vì lách bằng cách viết định nghĩa khác đi; kiểm chứng âm tính: trả regex về dạng cũ → cổng báo `submissions.status` LỆCH NULL.

#### Phần đã kiểm bằng MySQL thật

`tests/submission-workflow-integration.test.ts` (công tắc `SUBMISSION_WORKFLOW_INTEGRATION`, **đã nối vào CI** — suite thứ 10). Bốn điều chỉ driver thật phản đối được: cuộc đua lượt-xem-đầu (hai lượt đồng thời, đúng một thắng), tính nguyên tử của cặp ghi + audit, hai luật FK (`CASCADE` / `SET NULL`), và **tính đối xứng DATETIME** — `status_changed_at` phải đi qua trình dựng truy vấn Drizzle chứ không `pool.query` trần, cùng cái bẫy đã làm lịch cộng lượt xem lệch 7 giờ.

**Đường nâng cấp đã chạy trên CSDL có dữ liệu**, không chỉ trên máy chủ trống: hàng của công dân sống sót, nhận `status='new'`, chạy `initDb()` lần thứ hai vẫn 1 hàng / 4 FK.


### 5. Bảo mật (bắt buộc khi triển khai)
- **Bí mật BẮT BUỘC ở production** — thiếu là app từ chối khởi động (`server/plugins/require-secrets.ts`): `JWT_SECRET`, `CHATBOT_ENCRYPTION_SECRET`, `ANALYTICS_HMAC_SECRET`. Không còn giá trị mặc định trong mã nguồn hay `docker-compose.yml`.
- **Chống leo thang đặc quyền**: chỉ SuperAdmin được gán vai trò hệ thống; không ai cấp được quyền mà chính mình chưa có (`server/utils/permissions.ts`).
- **Chống stored XSS**: nội dung bài viết và rich-text của block được làm sạch phía server (`server/utils/sanitize-html.ts`) ở mọi đường ghi. Khóa `tracking_custom_head/body` (chèn JS toàn site) chỉ SuperAdmin sửa được.
- **Upload**: đuôi tệp suy từ MIME đã kiểm bằng magic-byte; SVG không bao giờ được phục vụ inline.
  - **Nhận một định dạng ở cổng VÀO mà không nhận ở cổng RA là không nhận nó.** Hai allowlist nằm ở hai tệp khác nhau — `detectMime()`/`EXT_BY_MIME` ở `server/api/admin/media/upload.post.ts` quyết định tệp nào **vào được**, còn `mimeMap` ở `server/routes/uploads/[...path].ts` quyết định tệp nào **hiện được** — và không có gì buộc chúng khớp nhau. Đã trả giá ngay trong đợt mở `.ico` cho favicon: tệp icon thật tải lên **thành công** (`200`, `mimeType: image/x-icon`, 2235 byte nguyên vẹn), rồi được phục vụ lại dưới `application/octet-stream` vì `mimeMap` không có `.ico`. Nhánh đó còn gắn kèm `Content-Disposition: attachment` và `X-Content-Type-Options: nosniff` — hai header tồn tại **để trình duyệt từ chối vẽ tệp**. Kết quả: favicon lưu đúng, hiện đúng trong ô nhập, thẻ `<link>` trỏ đúng, **tab vẫn trống**. `tests/favicon-settings.test.ts` nay buộc hai đầu khớp nhau.
  - **`.ico` được nhận, `.svg` thì không, và tiêu chí phân biệt là "có chạy được hay không" — không phải "định dạng nào quen hơn".** Một SVG phục vụ dưới `image/svg+xml` là **tài liệu chạy được** trên chính origin của cổng (nó chứa `<script>` được); một ICO là **thùng chứa ảnh raster**, không có nhánh nào để chạy gì. Ghi rõ vì lần nới tiếp theo sẽ được lập luận bằng chính tiền lệ của `.ico`. Có test khẳng định `.svg` vẫn vắng ở **cả hai** đầu, và đã kiểm trên máy chủ thật: SVG cũ vẫn ra `octet-stream` + `nosniff` + `attachment`.
  - **Sharp bị bỏ qua cho ICO có chủ đích** (`effectiveMime !== 'image/x-icon'`): sharp **không decode được** định dạng đó (`ico` không có trong `sharp.format`), nên để nó chạy là một nhánh thất bại im lặng. Hệ quả là ICO không được đo `width`/`height` — chấp nhận được, vì cỡ của một favicon do người tải lên chọn chứ không do cổng suy.

#### Favicon cấu hình được (`/admin/settings/general`)

> **Diễn giải chi tiết (byte-sai, `.ico` vũ trụ, hai allowlist, tiền sử bug) đã chuyển sang `docs/decisions/realm-safety.md`** mục "Favicon cấu hình được".

- **`public/favicon.ico` phải VẮNG**, tệp mặc định tên `favicon-default.ico` (`DEFAULT_ICO_FILENAME` trong `server/utils/favicon-image.ts`, một chỗ duy nhất — script sinh tệp và tuyến đọc tệp không thể lệch). Có tệp tĩnh `.ico` lúc build → tệp tĩnh thắng route handler, favicon cán bộ cấu hình bị bỏ qua; có lúc build rồi mất lúc chạy → `readFile` ném `ENOENT` → khách nhận **500**.
- **Tuyến `server/routes/favicon.ico.ts` chỉ phục vụ `.ico` thật, không phục vụ PNG.** Máy quét/đầu đọc RSS/trình duyệt cũ gọi `/favicon.ico` **trực tiếp**, không đọc thẻ `<link>`. Sharp không xuất được `.ico` nên `wrapPngAsIco` dựng vỏ ICO bằng tay (số nguyên **little-endian**), bọc thẳng PNG 32×32 — thân ICO **là chính** `favicon-32.png` (test so byte, hai icon không lệch khi logo đổi).
- **`POST /api/admin/settings/favicon` SINH bộ dẫn xuất, không lưu thẳng tệp gốc:** nhận PNG/JPG/GIF/WebP → sinh **ba** tệp (`-32.png`, `-180.png` cho `apple-touch-icon`, `.ico`) vào `public/uploads/favicon/`. Đầu ra luôn PNG (kể cả JPEG — không kênh alpha → giữ nguyên = nền đen); `.ico` tải lên thì **đi thẳng** (sharp không decode được). Nút "Về mặc định" `DELETE` xoá **cả hai** khoá. **Ô favicon KHÔNG dùng `uploadImage`** (lưu thẳng gốc vào Media — đúng thứ endpoint này ra đời để không làm).
- **Nhận diện magic-byte** tại `server/utils/image-mime.ts`, dùng chung với đường tải lên Thư viện Media — hai bộ nhận diện phải khớp nhau (test đối chiếu thật, thêm định dạng ở cổng vào mà quên cổng ra = đỏ).
- **`buildFaviconTags()` TỰ gọi `safeFaviconUrl`**, không tin nơi gọi đã gọi — đây là chỗ **duy nhất** dựng thẻ icon, mọi đường tới HTML đều đi qua nó. Payload ghi thẳng vào CSDL vẫn lùi về mặc định.
- **Plugin `server/plugins/favicon.ts` chạy trên MỌI tuyến kể cả `/admin/**`**, đệm 30 giây, CSDL lỗi → tiêm thẻ **mặc định** (không tiêm gì). Luôn giữ tệp mặc định ở tầng mã nguồn — không nhánh nào cho ra tab trống.
- **`favicon_url` phải có trong CẢ HAI allowlist** — `ALLOWED_SETTING_KEYS` (ghi) và `allowedKeys` (`public/settings.get.ts`, đọc công khai). Thiếu một bên = khoá lưu **thành công** rồi vô tác dụng (cùng lớp lỗi `openNewTab`). **Không** vào `SUPERADMIN_ONLY_KEYS`. Trang cài đặt **phải nói ra chuyện bộ nhớ đệm** — cán bộ đổi xong, tải lại, không thấy đổi → kết luận hỏng.
- **Khai báo cứng ở `nuxt.config.ts` đã bỏ** — mỗi trang mang đúng **một** thẻ `rel="icon"` (đã đếm trên bản build).
- **Đăng nhập Google cho người đọc & bình luận công khai**: danh tính người đọc tách hoàn toàn khỏi danh tính quản trị bằng **hai rào độc lập** (claim `stage: 'reader'` + khoá ký dẫn xuất riêng), nội dung bình luận là **văn bản thuần** không bao giờ `v-html`, không ảnh đại diện từ Google, chặn IP áp ở cả hai điểm, và mọi lượt đọc/ghi dữ liệu người đọc đều có audit. Xem mục "Đăng nhập Google & bình luận công khai" ở trên — **đặc biệt là ràng buộc an toàn bộ nhớ đệm** (`swr: 60` nghĩa là mọi thứ liên quan người đọc phải nạp sau khi mount) và **thứ tự sau triển khai** (phải cấp `readers`/`comments` trước, không thì trang không mở được).
- **Xác thực hai bước tự phục vụ** (`/admin/profile`): ba yếu tố bật tắt độc lập (ứng dụng xác thực / mã về email / mật khẩu cấp 2), mã dự phòng tuỳ chọn, break-glass chỉ SuperAdmin. Xem "Vận hành & an toàn" ở trên, **đặc biệt là runbook xoay `JWT_SECRET`** — xoay khoá này làm mọi secret TOTP đã lưu hết dùng được.

#### Cấu hình Hai Logo phối hợp (`main_logo_url` & `logo_url`)
- **Nguyên tắc phân cấp thị giác**: Logo cơ quan chủ quản (Bộ Công an / C11) đóng vai trò chính, luôn đứng trước (bên trái) và nổi bật trang trọng. Logo Con Đường Hướng Thiện là logo phụ của cổng thông tin, đứng sau vạch ngăn cách mỏng và có chiều cao tương đương 70–80% logo chính.
  - **Header Desktop**: Logo chính `h-10 lg:h-[56px]`, Logo phụ `h-7 lg:h-[38px]`. Vạch chia đứng `h-6 lg:h-8 w-px bg-[#D0DDD1]`.
  - **Mobile Drawer**: Logo chính `h-10`, Logo phụ `h-7`.
  - **Footer**: Logo chính `h-16 md:h-[72px]`, Logo phụ `h-12 md:h-[52px]`. Vạch chia đứng `h-12 md:h-14 w-px bg-white/25`.
  - **Admin Login**: Hiển thị logo kép trang trọng phía trên tiêu đề Cổng quản trị.
- **Khả năng chịu lỗi tự thích ứng (Fault-tolerant Fallback)**:
  - Nếu thiếu 1 trong 2 logo (chỉ có logo chính hoặc chỉ có logo phụ): vạch phân cách đứng tự động ẩn đi, logo hiện có tự động tăng nhẹ kích thước (`h-9 lg:h-[50px]`) để bố cục luôn cân đối, không có icon ảnh vỡ.
- **Allowlist hai đầu**: Khoá `main_logo_url` có mặt ở cả `ALLOWED_SETTING_KEYS` (`server/api/admin/settings/index.put.ts`), `allowedKeys` (`server/api/public/settings.get.ts`), và `seed.ts`.
- **Giao diện quản trị (`/admin/settings/general`)**: Có đầy đủ ô nhập URL, nút chọn từ Thư viện Media, nút tải tệp trực tiếp và khung "Xem trước phối hợp Header thực tế" trực quan. Trang này chỉ gửi `GENERAL_KEYS` (10 khoá `site_*`/`logo`/`favicon`/`hero_banner_url`) lên `PUT /api/admin/settings`; gửi cả `settings` là kéo cả `backup_auto_days` (thuộc `PUT /api/admin/settings/backup`) vào `ALLOWED_SETTING_KEYS` → `400 Khóa cài đặt không hợp lệ` — đã trả giá ở prod.
- **`.gitignore` `logs` phải là `/logs`.** Pattern `logs` không có `/` khớp **mọi** thư mục/file tên `logs` ở mọi cấp, nên `server/api/admin/ai/logs/index.get.ts` bị ignore → không vào git → prod 404 `GET /api/admin/ai/logs`. Đổi thành `/logs` (chỉ root). `server/api/admin/ai/logs` là endpoint phân trang log AI (90 ngày, filter `service_key`/`provider`/`success`/`date`, quyền `ai.read`).
- **`GET /api/admin/ai/logs` (R6.4/R13):** `GET /api/admin/ai/logs?page=&perPage=&serviceKey=&provider=&startDate=&endDate=&success=` — loại log >90 ngày theo `R13.5`, `success` chỉ nhận `true`/`false` chuỗi, `endDate` bao trọn ngày.

#### Chân trang (Footer) & Dòng "Design by Delify.vn"
- **Không bị che trên Mobile & Tablet**:
  - Footer có `pb-[calc(110px+env(safe-area-inset-bottom,0px))] md:pb-12 lg:pb-10` để chừa khoảng cách an toàn, không bị thanh điều hướng nổi di động (Mobile Bottom Nav) che mất nội dung.
  - Dòng bản quyền và liên kết "Design by Delify.vn" có `md:pr-24` để không bị nút Chatbot Launcher tròn (`md:right-6 md:bottom-6`) đè lên trên iPad/Desktop.
  - Định dạng liên kết dạng chữ tinh giản, trang nhã: `class="text-white/70 no-underline font-semibold transition-all hover:text-[#7CB342] hover:underline"`, mở tab mới với `target="_blank" rel="noopener noreferrer"`.

#### Chứng nhận An toàn thông tin, Bản quyền & Pháp lý Cổng thông tin
- **DMCA (Digital Millennium Copyright Act)**: Cổng thông tin hoàn toàn đăng ký được huy hiệu DMCA (gói Free hoặc Pro). Bảo vệ quyền tác giả đối với toàn bộ bài viết, văn bản hướng dẫn và hình ảnh nghiệp vụ, hỗ trợ gửi yêu cầu gỡ bỏ (Takedown Notice) khi bị sao chép trái phép.
- **Tín Nhiệm Mạng (tinnhiemmang.vn)**: Chứng chỉ Quốc gia cấp bởi Trung tâm Giám sát an toàn không gian mạng quốc gia (NCSC) - Cục An toàn thông tin (Bộ TT&TT). Rất khuyến khích và phù hợp cho cổng thông tin cơ quan nhà nước như C11 Bộ Công an (miễn phí cho cơ quan nhà nước, gồm Tín nhiệm Danh tính, Tín nhiệm Mạng).
- **Giấy phép ICP / Trang thông tin điện tử tổng hợp**: Thủ tục cấp phép hoạt động theo Nghị định 72/2013/NĐ-CP và Nghị định 27/2018/NĐ-CP do Cục PTTH&TTĐT hoặc Sở TT&TT cấp.

#### Lưu ý Môi trường Dev & Lỗi Hydration DOM Node
- Nuxt Dev Server (`npm run dev`) chạy trên cổng 3000, trỏ tới MySQL container (`127.0.0.1:33069`).
- Thuộc tính `data-allow-mismatch` được gắn trên các thành phần có trạng thái chuyển đổi hoặc unmount ngay sau khi hydrate (như lớp phủ `isInitialLoad` trong `app/app.vue`) để tránh cảnh báo `The deferred DOM Node could not be resolved to a valid node` trong Chrome DevTools.

### 6. Khởi tạo Cơ sở dữ liệu & Docker
- **MySQL Database Auto-Init (`server/db/init.ts`)**: Tự động kết nối server MySQL, tạo database `cdkt_admin` và toàn bộ 61 bảng dữ liệu nếu chưa tồn tại (idempotent, tự thêm cột còn thiếu).
- **Database Seed (`server/db/seed.ts`)**: Tạo tài khoản SuperAdmin (`admin`, mật khẩu lấy từ `ADMIN_PASSWORD`), các vai trò, bảng phân quyền và dữ liệu thiết lập ban đầu. **Insert-only**: chạy lại (kể cả mỗi lần khởi động container) sẽ KHÔNG ghi đè mật khẩu, ma trận quyền hay cấu hình mà quản trị viên đã sửa.
- **Docker Compose**: Đóng gói môi trường containerized hoàn chỉnh gồm 2 service `cdkt_mysql` (MySQL 8.0) và `cdkt_app` (Nuxt 4 app) chạy trên cổng `3000`.

---

### 7. Tái cấu trúc & a11y 2026-10 (5 commit未push)

#### Tách file lớn — đóng 3 nợ kỹ thuật audit 2026-09
- **`server/db/init.ts` 1302 → 73 dòng** (`61fff49`): tách 7 file `schema-tables/*.ts` theo domain (`core`/`content`/`governance`/`chatbot`/`analytics`/`readers-media`/`ai-i18n`). `init.ts` chỉ giữ thứ tự gọi (ràng buộc FK thật), re-export `migrations-additive` cho 4 suite test không đổi import path. `db:drift` đọc 9 tệp như một nguồn DDL — xanh 635 cột/62 bảng (trước 624/61).
- **`app/layouts/default.vue` 1301 → 382 dòng** (`f125e09`): tách 7 component `app/components/layout/Default*.vue` (TopBar/Header/MobileDrawer/DesktopNav/SearchDropdown/Footer/BottomNav) + 5 composable (`useLayoutNav`/`useSiteSettings`/`useLiveSearch`/`useReaderMenu`/`useMobileMenu`). 10 test guard đọc source text được viết lại cross-file qua `tests/_layout-parts.ts` (ghép 8 file). Khắc phục hydration crash từ việc tách. Đóng caveat "1282 dòng hồi quy".
- **`any` 20 vết → 0** (`ca4f52e`): 4 kiểu dùng chung `UnknownError`/`CaughtError`/`Nullable<T>`/`HttpEventLike` thay thế. 0 vết trong `.vue` SFC (trước 17). ESLint ignore `CDKT` cho trưởng hợp ngoại lệ có tên.

#### TinyMCE admin editor + render blog công khai (`cb2e9cb`)
- **Editor full section width** — gỡ `max-w-[794px]` wrapper khỏi `TinyMceEditor.vue` và `[id].vue`. Editor chiếm trọn vẹn section để soạn thoải mái, không bị hẹp tệ. Giới hạn chiều ngang KHÔNG áp admin editor.
- **Height 700** (main editor `[id].vue`, trước 480) + **480** (component default `TinyMceEditor.vue`, trước 320) — rộng hơn cho bài dài. Skeleton khớp `min-h-[700px]`.
- **`content_style` thêm `iframe, video { max-width:100% }`** — preview editor khớp render công khai.
- **Render blog công khai giới hạn ảnh/video**: `ArticleDetail.vue` thêm `.article-body :deep(img), :deep(video) { max-width:100%; height:auto }` — ảnh/video chèn trong bài không tràn vùng đọc 1240px (trước chỉ `iframe` có max-width). `RichTextBlock.vue` thêm `video` vào rule `img` hiện có — đồng bộ Page Builder render path.

#### a11y admin article (`4885c09`)
- **Filter bar `/admin/content/articles`**: thêm `aria-label` cho 4 select (thể loại, danh mục cha, danh mục con, trạng thái) + search input — trước chỉ 2 select có aria-label, trình đọc màn hình không biết các filter còn lại lọc gì.
- **Nút "Xóa bộ lọc"**: chỉ hiện khi `hasActiveFilters` (bất kỳ filter ≠ mặc định) — 1 click reset tất cả + `fetchArticles(1)`, thay vì mở từng select đặt lại. Nút hover đỏ phân biệt action reset.
- **Nút "X" xóa thumbnail** (`[id].vue`): thêm `type="button"` + `aria-label="Xóa ảnh đại diện"` + `aria-hidden="true"` cho icon.
- **Bug `animate-fadeIn` vô hiệu** (`[id].vue:1458`): class không tồn tại trong `tailwind.config.js` (chỉ có `fade-slide-up`) → modal re-translate không có animation. Đổi sang `animate-fade-slide-up`. Lưu ý: 4 chỗ khác ngoài scope admin article vẫn dùng `animate-fadeIn` dead class (`ArticleComments.vue:69`, `DefaultTopBar.vue:27`, `languages/index.vue:1334+1393`) — chưa sửa.

#### Thống kê sau tái cấu trúc
- Typecheck sạch, `npm test` 2078 total / 2064 pass / 14 skip (integration cần MySQL), `npm run lint` 0 error / 12 warning (trước 272), `db:drift` xanh 635 cột/62 bảng.

### 8. Sửa vi phạm `as unknown as` + dọn dead class (2026-10-05)

#### Vi phạm CLAUDE.md `as unknown as không dùng để đọc hình dạng`
- **V1a Plyr** (`usePlyrPlayer.ts` + `MediaPlayer.vue`): mở rộng `PlyrInstance` type có `quality` (options/forced/onChange), bỏ cast `as unknown as` tại `MediaPlayer.vue:240`. Giữ 1 cast tại `usePlyrPlayer.ts:163` có lý do kỹ thuật rõ (Plyr full type có `quality` shape khác — number-ish, narrowed declaration là object; comment type-boundary).
- **V1b Hls** (`useHlsVideo.ts` + `MediaPlayer.vue` + `LiveHero.vue`): export `HlsInstance`, đơn giản hóa chỉ `{ destroy }` (consumer chỉ dùng destroy). **0 cast hoàn toàn** — type đầy đủ hls.js tự khớp. Bỏ cast `hls = instance as unknown as {...}` nội bộ, dùng thẳng `instance.levels`/`instance.currentLevel`.
- **V1c article translations** (`[id].vue`): mở rộng type `articleTranslations` ref thêm `excerpt`/`content` (phản chiếu schema.ts:1403), bỏ 2 cast `as unknown as { excerpt?: string }` tại `openEditTranslation`, thêm 2 field vào 2 optimistic push.
- **V1d media-portal** (`media-portal.ts`): bỏ 2 cast `as unknown as AdminMediaRow` — Drizzle type tự khớp.
- **V1e video-processing** (`video-processing.ts`): bỏ cast `as unknown as StatfsFn` — `fs.promises.statfs` tự khớp `StatfsFn`.
- **V1f check-schema-drift** GIỮ — reflect Drizzle internals qua symbol, không có type công khai, có comment giải thích (legitimate reflection).

#### Bug dead class `animate-fadeIn` (B1)
- 4 chỗ còn lại (`ArticleComments.vue:69`, `DefaultTopBar.vue:27`, `languages/index.vue:1334+1393`) → `animate-fade-slide-up`. Class `animate-fadeIn` không tồn tại trong `tailwind.config.js` (chỉ có `fade-slide-up`).

#### Bug parsing error `vue/no-parsing-error` (B3)
- 5 chỗ ở `media/scan.vue` raw `<` trong text → `<` (HTML entity).

#### Không fix (có guard/lý do)
- **B2 prop mutation `BuilderArrayEditor`**: intentional legacy — `PropertyPanel.vue:130-135` binds `:items` không `@update:items`, mutate shared reference là cơ chế hoạt động. Refactor emit sẽ gãy feature.
- **V2 audit non-tx `deleteArticleById`/`setArticleStatus`**: known-exclusion guarded bởi `tests/reader-audit-atomicity.test.ts` — bọc transaction sẽ fail test.

#### Cảnh báo cho agent sau — stale info đừng báo lại
Báo cáo audit rà codebase có thể mang lại 2 mục stale (đã đóng):
- "default.vue phình 1200+" — **SAI**, đã đóng `f125e09`, giờ 382 dòng.
- "any ~20 vết ở SFC .vue cũ" — **SAI**, đã đóng `ca4f52e`, SFC sạch. 142 vết `any` còn lại ở `tests/` là mock/stub cố ý, không phải production code.

Hai hạn chế **có chủ đích, không phải nợ**:
- i18n — 50+ file public đã dùng `t()`, tất cả lang kể cả `vi` fetch DB (hardcoded chỉ fallback). Mở rộng thêm trang là feature work (xem mục 9).
- 168 endpoint cũ `getDb()` thẳng — quy ước "áp cho mã MỚI", refactor diện rộng rủi ro > lợi.

#### Thống kê
- 11 file chạm, +75/-47 dòng. Typecheck sạch, `npm test` 2064 pass / 14 skip / 0 fail, `npm run lint` 0 error / 268 warning (142 `any` ở tests/ + 126 khác), `db:drift` xanh 635 cột/62 bảng.

### 9. i18n full DB-driven — bỏ hardcoded `vi` (2026-10-05)

#### Bối cảnh
`t()` trong `useI18n.ts` có 4 bước fallback (DB → hardcoded lang → hardcoded vi → key). Nhưng `vi` **không bao giờ fetch DB** — dòng 894 `if (currentLang.value !== 'vi' && ...)` chỉ fetch cho ngôn ngữ ≠ `vi`. `vi` dùng `hardcodedDictionary` (766 dòng) làm nguồn chân lý. Trong khi seed `default-translations-seed.ts` đã có 531 keys `vi` trong DB, và admin UI `/admin/languages` **đã cho sửa `vi`** (nút "Bảng dịch" mở cho `isDefault`). Mismatch: admin sửa `vi` → ghi DB, nhưng frontend `vi` không đọc DB → sửa vô tác dụng.

#### Thay đổi
- **`useI18n.ts`**: bỏ check `!== 'vi'` ở dòng 894 — **mọi ngôn ngữ kể cả `vi` đều fetch DB**. `hardcodedDictionary` chỉ còn fallback khi DB chưa seed / API hỏng / SSR chưa fetch xong. Thứ tự `t()` giữ nguyên (DB → hardcoded lang → hardcoded vi → key). Caching `useState` per-locale không đổi.
- **`ChatWidget.vue`** (11 chuỗi cứng → `t()`): `cw_back`, `cw_history`, `cw_clear`, `cw_expand`, `cw_sources`, `cw_lead_name/phone/email/question`, `cw_input_placeholder`, `cw_input_label`, `cw_send_aria`.
- **`assistant.vue`** (11 chuỗi cứng → `t()`): `asst_conversation_list`, `asst_delete_conv`, `asst_delete_conv_aria`, `asst_new_conv`, `asst_clear_conv`, `asst_home`, + tái dùng `cw_sources`/`cw_lead_*`/`cw_input_*`/`cw_send_aria`.
- **`profile.vue`** (8 chuỗi cứng → `t()`): `home`, `profile_title`, `profile_subtitle`, `profile_display_name_ph`, `profile_next`, `profile_clear_history`, `profile_remove_aria`, `profile_remove_title`.
- **`default-translations-seed.ts`**: append 25 keys mới (12 `chat/cw_*`, 6 `assistant/asst_*`, 7 `profile_*`) — `vi`+`en` có giá trị, `zh`/`fr`/`ru`/`lo` rỗng (admin AI-dịch sau). Seed insert-only, không ghi đè existing.
- **`hardcodedDictionary.vi`** trong `useI18n.ts`: thêm 25 fallback keys (cw_*, asst_*, profile_*).
- **Test guard** `tests/chatbot-public-widget.test.ts:64`: cập nhật regex từ `aria-label="Nguồn tham khảo"` → `:aria-label="t('cw_sources')"` (test đọc source text).

#### KHÔNG đổi
- **Admin** giữ nguyên (anh yêu rõ "admin giữ nguyên") — admin hardcoded, không i18n.
- **`server/api/admin/languages/**`** — đã hỗ trợ PUT `vi` từ trước.
- **Schema** — bảng `lang_translations` đã có, không thêm cột.
- **SSR fetch** — giữ client-only fetch (scope nhỏ, không block SSR). Hardcoded fallback render trước, DB fetch xong re-render.

#### Kiểm chứng
- Typecheck sạch (exit 0). `npm test` 2064 pass / 14 skip / 0 fail. `npm run lint` 0 error / 268 warning. 7 file chạm (useI18n, ChatWidget, assistant, profile, default-translations-seed, chatbot-public-widget test, CLAUDE.md).

### 10. Accessibility + @nuxt/image + dọn lint (2026-10-06)

#### Bối cảnh
Audit codebase 2026-10-06 phát hiện 3 gap thật (phiên Tier 1+2): 3 trang public top-tier (index/about/contact) thiếu aria, `<img>` raw chậm LCP mobile, lint warning còn cao. Đây không phải nợ kỹ thuật cũ mà là lớp phòng thủ a11y + perf chưa đóng — portal nhà nước cần tuân thủ Luật Người khuyết tật 2010 / Nghị định 28/2012.

#### Thay đổi
- **A11y (12 file)**: `default.vue` thêm skip-link "Bỏ qua tới nội dung" + `id="main-content"` vào `<main>`; `DefaultDesktopNav`/`MobileDrawer` thêm `aria-current="page"` trên NuxtLink active + `aria-label` nav; `DefaultBottomNav` thêm `:aria-current` + `:aria-pressed` + `:aria-label`. 8 block public (`Hero`/`Image`/`Gallery`/`News`/`Cta`/`Links`/`ContentAside`/`RichText`) thêm `role="region" aria-label`, `role="list"`, `role="group" figure`, `aria-hidden="true"` icon trang trí, fallback `alt` ảnh. Giữ `BlockNode` (vùng ngữ nghĩa sẵn) + 9 block đã có aria tốt.
- **`@nuxt/image` 2.1** (17→18 prod dep): IPX provider mặc định tái dùng `sharp` 0.35.4 đã có — không thêm sub-dep nặng. Cấu hình `quality:75`, `format:['webp','jpg','png']` (WebP cho browser hiện đại, fallback jpg/png). `<NuxtImg>` áp cho `DefaultSearchDropdown.vue` (thumbnail search 48px) + `in-bai/[slug].vue` (ảnh thumbnail bài, responsive `256px sm:384px`). **Giữ `<img>`** cho: ảnh rich-text TinyMCE (HTML thô từ DB), 2 logo masthead in-bai (canvas in giấy), block Page Builder (ảnh đã qua sharp+R2 trong media pipeline — NuxtImg duplicate công).
- **i18n SEO 3 trang**: `index`/`about`/`contact` `useSeoMeta` fallback từ hardcoded tiếng Việt sang `t()`. 8 key mới trong `default-translations-seed.ts` (`home_seo_*`, `home_og_*`, `about_seo_*`, `contact_seo_*`).
- **Lint (99 → 81 warning, giảm 18)**: bỏ escape regex thừa (ai-gateway, article-translations, universal-translation, contact-detect), `let` → `const` khi không tái gán, bỏ `Boolean()` wrapper (comments, livestream-chat). Giữ `v-html` (sanitize-html đã xử lý) + 1 `prefer-const` (let deadline tái gán ở dòng khác — eslint báo sai).

#### KHÔNG đổi
- 168 endpoint cũ `getDb()` thẳng — hạn chế có chủ đích (CLAUDE.md).
- File >400 dòng ~30 file — đa số nguồn chân lý hoặc service nghiệp vụ phức tạp, tách tiếp sinh abstraction rác.
- CSP `'unsafe-inline'` cho script-src — Nuxt 4 hydration cần inline, đợi Nuxt 5 hash CSP.
- `pool.query` raw 1 site (`analytics-scheduler.ts:141`) — read-only 1 hàng hợp lệ.

#### Kiểm chứng
- Build Docker OK + container `cdkt_app` healthy. Typecheck 0 lỗi. `npm run lint` 0 error / 81 warning. `db:drift` 635 cột/62 bảng. `npm test` 2065 pass / 0 fail / 14 skip. IPX endpoint sống (404 IPX_FILE_NOT_FOUND cho file không tồn tại = đúng). 25 file chạm, +174/-65 dòng. CLAUDE.md update watermark `default.vue` 382→385, lint 268→81 warning, thêm `@nuxt/image` vào Tech Stack.

### 11. AiModerationTab mobile card list UI + OG image mặc định toàn site (2026-10-06)

#### AiModerationTab mobile UI/UX (tab Kiểm duyệt An ninh trong `/admin/ai`)
Tab "Kiểm duyệt An ninh" (`AiModerationTab.vue`) dùng table 8 cột (queue) + table 6 cột (rules) chỉ `overflow-x-auto` → mobile phải cuộn ngang rất nhiều. Đổi thành:
- **Queue section:** table 8 cột giữ nguyên desktop (`hidden md:block`); mobile card list stack dọc (`md:hidden`), mỗi card có: header type chip + status badge, thời gian, context title (link truncate), người gửi + IP + badge "Đã cấm", snippet (bg-red-50 cảnh báo), lý do, mức độ chip, 3 action button to dễ bấm.
- **Rules section:** table 6 cột giữ nguyên desktop; mobile card list: header category + toggle button (Đang bật/Đã tắt), pattern `break-all`, 2 chip side-by-side, nút "Xóa quy tắc" full-width.
- **Sub-tab header + filter:** `flex flex-col sm:flex-row` stack dọc mobile; queue filter chip `flex flex-wrap` không tràn.
- **A11y:** `aria-hidden="true"` cho 7 icon trang trí desktop (mobile card đã có).

#### OG image mặc định toàn site + Twitter Card

#### Bối cảnh
Codebase gần như không có meta tags Open Graph / Twitter Card: homepage `index.vue` set `ogTitle/ogDescription/ogType` nhưng **KHÔNG có `ogImage`**; `about.vue`/`contact.vue` không có `og:*` gì; news list/role-models/documents/legal-qa không có `og:image`; chỉ `ArticleDetail.vue:544` set `ogImage` (fallback cứng `/assets/hero_banner.jpg`). Twitter Card: 0 nơi. Hậu quả: share link lên Facebook/Twitter/Zalo không hiện ảnh preview.

#### Thay đổi
- **`server/utils/og-image-setting.ts`** (MỚI, 55 dòng): helper `loadOgImageSetting()` + cache 30s, mô phỏng `favicon-setting.ts`. DB fail → rỗng (không break render).
- **`server/plugins/og-image.ts`** (MỚI, 42 dòng): Nitro `render:html` hook inject 5 meta tag (`og:image`, `og:image:width` 1200, `og:image:height` 630, `twitter:card` summary_large_image, `twitter:image`) vào mọi trang công khai. Bỏ qua `/api/**` + `/admin/**`. Chỉ inject khi `og_image_url` có giá trị.
- **`server/api/admin/settings/index.put.ts`**: thêm `'og_image_url'` vào `ALLOWED_SETTING_KEYS` + `clearOgImageSettingCache()` sau commit.
- **`server/api/public/settings.get.ts`**: thêm `'og_image_url'` vào `allowedKeys`.
- **`app/pages/admin/settings/general.vue`**: thêm ô "Ảnh Chia Sẻ Mặc Định (Open Graph / Twitter)" sau Hero Banner — preview tỉ lệ 1200×630 (`object-cover`).
- **`app/components/ArticleDetail.vue`**: `ogImage` fallback từ `/assets/hero_banner.jpg` cứng → `sitePublicSettings.og_image_url` qua `useSiteSettings`. Ưu tiên: thumbnail > OG mặc định > hero_banner cứng.
- **`server/db/seed.ts`**: seed row `og_image_url` rỗng.

#### Kiến trúc dedup
Plugin `render:html` chèn tag vào `html.head` **trước** Vue head (`@unhead` từ `useSeoMeta`). `@unhead` dedup theo `property="og:image"` → tag page thay thế tag plugin. Kết quả: trang bài viết có thumbnail → thumbnail thắng; route không gọi `useSeoMeta` → ảnh mặc định.

#### Kiểm chứng
Typecheck 0 lỗi, eslint 0 error, npm test 2065 pass/0 fail/14 skip, build exit 0, db:drift 62 bảng/635 cột không lệch.

### 12. NuxtImg IPX CDN WebP — logo + thumbnail công khai (2026-10-06)

#### Bối cảnh
Ảnh công khai (logo, thumbnail bài viết, block Page Builder) dùng `<img>` thường → serve định dạng gốc (PNG/JPG). CDN R2 (`cdn1.delify.vn`) không tự convert WebP (test `Accept: image/webp` vẫn trả `image/png`). Hero banner đã qua sharp, related-article thumbnail giữ `<img>` vì test guard `article-related-content.test.ts:341` chặn `/<img/`.

#### Thay đổi
- **`nuxt.config.ts`**: thêm `domains: ['cdn1.delify.vn']` vào `image` config — IPX provider (sharp 0.35.4) fetch ảnh R2 + local → convert WebP + cache server.
- **Logo (4 component)**: `<img>` → `<NuxtImg format="webp">` + `width`/`height`:
  - `DefaultHeader.vue` (112×56/100×50 + 76×38/100×50)
  - `DefaultFooter.vue` (144×72/128×64 + 104×52/128×64)
  - `DefaultMobileDrawer.vue` (80×40/72×36 + 56×28/72×36)
  - `admin/login.vue` — giữ `:src`, `v-if`, class tỷ lệ (test guard `main-logo-settings.test.ts`)
- **Thumbnail công khai**: `ArticleDetail.vue` (thumbnail chính), `NewsCategoryList.vue`, `ContentTypeListSection.vue`, `news/index.vue`, `role-models/index.vue`, `documents/index.vue`, `reintegration-models/index.vue`, `search.vue`
- **Page Builder blocks**: `NewsBlock.vue`, `RoleModelsBlock.vue`, `ReintegrationBlock.vue`, `DocumentsBlock.vue`, `ImageBlock.vue`, `GalleryBlock.vue`

#### Giữ `<img>` cố ý
- `ArticleDetail` related-article thumbnail — test guard `article-related-content.test.ts:341` `/<img/`
- `SocialBubble` — icon SVG social (vector không WebP)
- `media/index` + `media/[shortId]` — thumbnail đã qua sharp server-side (quy tắc CLAUDE.md)
- `in-bai/[slug]` — logo trang in báo giấy
- `StatsBlock` + `image-fallback.ts` + `markdown.ts` — comment/string code

#### Kiểm chứng
Typecheck 0 lỗi, eslint 0 error, npm test 2065 pass/0 fail/14 skip, build exit 0. CSP `img-src 'self' https://*.delify.vn` cover IPX proxy (cùng origin) + R2 CDN.

### 13. Convert ảnh upload PNG/JPG/JPEG → WebP tại Media Library (2026-10-06)

#### Bối cảnh
`/api/admin/media/upload` lưu ảnh PNG/JPG nguyên gốc → client tải full size (2-5MB). Dù NuxtImg IPX (entry 12) convert WebP lúc serve, ảnh trên R2 vẫn gốc lớn, và không phải ảnh nào cũng qua NuxtImg (ArticleDetail related-article giữ `<img>` do test guard, ảnh rich-text TinyMCE dùng `<img>` thường).

#### Thay đổi
- **`server/api/admin/media/upload.post.ts`**: chèn logic convert WebP q80 sau khối resize>2400px, trước khi derive extension. PNG/JPG/JPEG → `sharp(buffer).webp({ quality: 80 })`, cập nhật `effectiveMime = 'image/webp'` → đuôi `.webp` + DB `mimeType` + R2 Content-Type đồng bộ.

#### Giữ nguyên định dạng
- **GIF** — sharp flatten animated GIF → frame đầu, loại trừ
- **WebP** — không re-encode (tránh giảm chất lượng 2 lần)
- **ICO** — sharp không decode
- **Video/PDF** — không phải ảnh
- **Ảnh >2400px** — resize về 2400 RỒI convert WebP (không resize 2 lần)
- **sharp fail** — try/catch fallback giữ format gốc (không chặn upload)

#### 2 endpoint loại (giải thích trong plan)
- Media-portal thumbnail video — test guard `media-api.test.ts:664` chặn `image/jpeg` + `MEDIA_THUMBNAIL_FILE='thumb.jpg'` hardcode
- Favicon — không lưu ảnh gốc, render PNG 32/180 + ICO (iOS không hỗ trợ WebP cho touch icon, ICO container bắt buộc)

#### Kiểm chứng
Typecheck 0 lỗi, eslint 0 error, npm test 2065 pass/0 fail/14 skip, build exit 0. Test guard `favicon-settings.test.ts:639` (`EXT_BY_MIME[effectiveMime]`) + `cms-core-auth-media.test.ts:129-130` (`EXT_BY_MIME` + `effectiveMime`) pass.

### 14. Preload hero banner WebP + preconnect R2 (2026-10-06)

#### Bối cảnh
PageSpeed Insights mobile báo LCP hero banner chậm + "không có điểm gốc nào được kết nối trước". `HeroBlock.vue` dùng `background: url('/assets/hero_banner.jpg')` 201 KiB — CSS background không preload tự động, browser chỉ tìm thấy ảnh sau khi parse xong stylesheet.

#### Thay đổi
- **`public/assets/hero_banner.webp`** (MỚI, 155 KiB, -23% từ 201 KiB JPG): sharp q80 convert 1 lần, commit binary cùng `.jpg` (giữ `.jpg` fallback).
- **`nuxt.config.ts` `app.head.link`**: thêm 2 thẻ sau `fontLinks`, trước `iconFontPreloads`:
  - `{ rel: 'preconnect', href: 'https://cdn1.delify.vn' }` — thiết lập TCP/TLS sớm cho R2 CDN (logo + thumbnail bài viết). 1 preconnect, không quá 4.
  - `{ rel: 'preload', as: 'image', href: '/assets/hero_banner.webp', fetchpriority: 'high', type: 'image/webp' }` — LCP element, `type: 'image/webp'` → browser không hỗ trợ WebP bỏ qua preload an toàn (spec).
- **`HeroBlock.vue`**: `heroBg` computed — nếu `bgImage` là `/assets/hero_banner.jpg` (default), dùng CSS `image-set(url('...webp') type('image/webp'), url('...jpg') type('image/jpeg'))`; ảnh admin upload khác giữ `url(bgImage)`. `image-set()` hỗ trợ Chrome 113+/Safari 17+/Firefox 89+ (>95% browser 2026-10).
- **`QuoteBlock.vue`**: cùng pattern `quoteBg` computed image-set.

#### Kiểm chứng
Typecheck 0 lỗi, eslint 0 error.

### 15. FontAwesome font-display swap + preload woff2 (2026-10-06)

#### Bối cảnh
PageSpeed Insights mobile báo 2 vấn đề:
- **"Hiển thị phông chữ" 620ms** — FontAwesome CSS dùng `font-display:block` (FOIT 3s): icon biến mất trong 3s đầu trên mạng chậm.
- **"Yêu cầu đang chặn kết xuất ban đầu" 4.5s** — 8 file CSS chặn first paint, trong đó 3 file FA woff2 (fa-regular 357KB, fa-solid 276KB, fa-brands 115KB) nằm trong critical path.

#### Thay đổi
- **`font-display: block → swap`** trong 3 file `public/assets/fontawesome/css/{solid,regular,brands}.min.css` (patch trực tiếp, không regenerate). FOUT thay FOIT — icon hiện ngay bằng font fallback, tải xong đổi sang FA icon. Inter font đã có `swap` từ trước.
- **Preload 3 woff2** qua `nuxt.config.ts` `app.head.link`: `<link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href="...fa-{solid-900,regular-400,brands-400}.woff2">`. Đặt TRƯỚC `iconLinks` (stylesheet) để font sẵn sàng khi CSS parse xong — woff2 ra khỏi critical path.

#### KHÔNG đổi
- Không động `fontawesome.min.css` (154KB class map, không có `@font-face`).
- Không async-load CSS (FOUC icon không đáng giá).

#### Kiểm chứng
Build exit 0, typecheck 0 lỗi, eslint 0 error.

### 16. Cổng admin API theo đường dẫn đã giải mã + khôi phục backup chỉ SuperAdmin (2026-10-13)

#### Bối cảnh
Audit 2026-10-13 tìm ra hai lỗi High: (1) middleware `admin-auth` so đường dẫn thô trong khi router route theo đường dẫn đã giải mã — `/api/%61dmin/users` tới handler mà không qua kiểm phiên; (2) khôi phục backup (chạy SQL tải lên bằng quyền root) chỉ cần `settings.update`, tải dump đầy đủ chỉ cần `settings.read`. Kèm theo: dump của app làm lệch mọi ngày giờ 7 giờ và không phải snapshot nhất quán. Diễn giải → `docs/decisions/realm-safety.md` § "Cổng `/api/admin/**` và khôi phục backup".

#### Thay đổi
- **Middleware** (`server/middleware/admin-auth.ts`): `classifyAdminRequest` quyết định trên các dạng đã giải mã của đường dẫn route, fail closed; test hành vi `tests/admin-auth-path-gate.test.ts` (h3 app + router thật) và kiểm kê handler `tests/admin-handler-authorization.test.ts` (`AUTH_EXEMPTIONS` 15 tệp có lý do).
- **BREAKING — quyền backup**: khôi phục (theo tên và tải lên), tải về, xoá backup **chỉ SuperAdmin** (`requireSuperAdmin`). Người có `settings.read`/`settings.update` vẫn xem danh sách, trạng thái, tạo backup, cấu hình Drive. Trang `/admin/settings/backup` ẩn nút với người khác.
- **Khôi phục an toàn** (`server/services/backup-restore.ts`, `backup-restore-guards.ts`): kiểm chữ ký gzip + trần nén/giải nén (đếm theo luồng) trước khi ghi; kiểm danh sách mục tar (không `..`/tuyệt đối/liên kết/ngoài cây) trước khi giải nén; bản `pre-restore` trước khi chạy SQL (không xoay vòng); audit `backup_restore` / `backup_restore_failed`; log bảo mật `backup.restore_*`; trigger mới `pre-restore`.
- **Dump định dạng 2** (`server/services/backup-sql.ts`): ngày giờ/BIGINT/JSON ghi nguyên văn, `time_zone '+00:00'`, snapshot nhất quán; dump cũ được gắn cờ `legacyDateShift` khi khôi phục.
- Suite integration mới `tests/backup-dump-integration.test.ts` (matrix CI `backup-dump`).

#### KHÔNG đổi
- Không đổi schema, không thêm biến môi trường → `production/` không cần sửa. Khôi phục vẫn chạy bằng `DB_USER` hiện có (khuyến nghị: tài khoản MySQL giới hạn).
- Dump vẫn giữ toàn văn trong RAM (giới hạn đã biết).

### 17. Phần còn lại của đợt rà soát 2026-10-13 (bảo mật, dữ liệu, công khai, vận hành)

Diễn giải → `docs/decisions/realm-safety.md` § "Đích ra ngoài và bí mật đã lưu", `data-layer.md` § "Audit 2026-10-13", `reader-features.md` § "Ngôn ngữ người đọc và trang cache SWR".

#### Bảo mật
- **Đích AI**: chính sách URL nhà cung cấp (`server/utils/ai/provider-url.ts`) áp lúc ghi và lúc gọi; mọi đường stream/tool-calling qua `safeProviderStream` (ghim IP, không redirect, hạn giờ, trần byte); đổi baseUrl phải nhập lại key; đổi đích chatbot chỉ SuperAdmin.
- **Liên kết email**: `PUBLIC_HOST_ALLOWLIST` (biến môi trường mới — compose, `.env.example`, `manage.sh` Deploy/Update, `production/README.md`, nginx `default_server` + `X-Forwarded-Host` trong `CI-CD.md`).
- Test SMTP không còn gửi mật khẩu đã lưu tới host do request chọn; xuất Google chỉ lấy ảnh media của chính site, bỏ chia sẻ `anyone`; vô hiệu công thức trong CSV/Sheets; `polishedContent` của AI biên tập được sanitize + kiểm kê mọi `v-html`; JWT ghim `HS256`; `restart-server` cần SuperAdmin; link markdown của chat không nhận `//host`; `boost`/`stats` không còn lộ bài tồn tại qua 404/403.
- Chat: rate limit trước kiểm duyệt + trần hàng duyệt theo IP/phiên; helper regex kiểm duyệt dùng chung + kiểm luật lúc lưu (giảm, không loại trừ ReDoS); lỗi ẩn/ghi hàng duyệt được log; "Quét lại tất cả" thành job nền có khoá (202/409, theo lô).

#### Dữ liệu
- Chuyển trạng thái đơn bằng `UPDATE` có điều kiện trong transaction (409 cho người thua; integration test đồng thời).
- Publish/archive/xoá kho chatbot ghi audit cùng transaction.
- Đồng bộ ảnh lên R2: thay URL (mọi bảng đích, kể cả JSON `page_blocks`) trong một transaction **trước** khi xoá bản local; khoá tên + mã thế hệ; bước sửa lượt bị cắt ngang trong "Sửa URL". Thay file video dọn cây cũ qua outbox. Suite integration mới `media-sync-rewrite`.

#### Trang công khai
- Endpoint công khai hỏng CSDL → 503 + `no-store` + log (`reportPublicReadFailure`); block hiện lỗi + thử lại (`BlockLoadError.vue`, khoá i18n `block_docs_load_error_title`). Tìm kiếm đếm thật + thoát `%`/`_`. Analytics dùng pool chung qua `utc-query.ts`; giới hạn page-view dùng store chung. Suite integration mới `public-read`. Spike chỉ mục danh sách bài: không thêm (không có lợi đo được).
- Phân trang/tìm kiếm danh sách bài nạp lại đúng (khoá `useAsyncData` suy từ URL, `usePublicArticleList.ts`); role-models/reintegration-models dùng chung `ModelArticlesListPage.vue`; `/legal-qa` về trang 1 khi đổi từ khoá. E2E `public-list-pagination.spec.ts`.
- Máy chủ không ghi cookie `cdkt_lang` (trang SWR từng đặt lại ngôn ngữ của mọi người đọc về `vi`); lớp phủ tải đầu có failsafe 4 s / `<noscript>` / gỡ khi lỗi app. E2E `public-language-cache.spec.ts`.
- Trợ năng: ngăn kéo menu đóng là `inert`, biểu mẫu có nhãn/lỗi gắn đúng, nút thay `<div @click>`, liên kết quay lại của trang in qua `safeInternalPath`, chữ phụ `#7A8A76` → `#5A6C58` toàn `app/`.

#### Vận hành
- CI: `cancel-in-progress` chỉ cho `pull_request` (deploy đang chạy không bị cắt); deploy gửi `docker-compose.yml` của đúng commit (SHA-256, sao lưu, `config -q`) và khởi động lại chỉ app; bước audit dependency runtime là chặn (0 advisory sau khi dời nuxt/vue/tailwind… sang `devDependencies`; image runtime `npm ci --omit=dev --ignore-scripts`).
- Container app chạy `TZ=Asia/Ho_Chi_Minh` (Dockerfile + compose; mysql giữ UTC). **Tác động một lần khi deploy**: lượt bảo trì/sao lưu "03:00" dời từ 10:00 về 03:00 giờ VN, mốc đầu tháng của hạn mức AI dịch 7 giờ. Compose truyền thêm `RETENTION_SCHEDULER`, `ANALYTICS_SCHEDULER`, `BACKUP_SCHEDULER`, `LOG_LEVEL`, `LOGIN_CAPTCHA_ENABLED` (rỗng = mặc định của code).
- `manage.sh`: bỏ lựa chọn "Existing DB" chết, Migrate đọc tên DB từ `.env` và dò `DROP TABLE`/`DROP DATABASE`/`TRUNCATE` thật, Deploy tôn trọng ngưỡng RAM 4000 MB cho tải video và kéo image CI thay vì build trên VPS, Update đợi healthy và tự lùi về image + compose trước khi hỏng, mật khẩu qua `MYSQL_PWD`. Cron media gồm cả `uploads_data`; `scripts/restore-db.sh` mới. Test sandbox với `docker`/`git` giả (`tests/ops-scripts-sandbox.test.ts`).

#### Kiểm chứng (cây đã gộp, 2026-10-14 — ảnh chụp TRƯỚC đợt sửa F1–F6 ở § 18; số mới ở § 18)
`npm test` 3313 test / 3294 pass / 0 fail / 19 skip; typecheck 0 lỗi (không còn cảnh báo `Duplicated imports "escapeLikeWildcards"`); eslint 0 error / 17 warning; `db:drift` sạch (62 bảng / 635 cột); 17/17 suite integration xanh trên MySQL thật; `nuxt build` exit 0; Playwright 39/39; `npm audit --omit=dev` 0 lỗ hổng (toàn bộ `npm audit` còn 20 ở công cụ dev: 2 critical, 14 high, 4 moderate).

### 18. Đợt sửa sau kiểm chứng (F1–F6, 2026-10-14)

Sáu nhánh sửa chạy sau lượt kiểm chứng độc lập của § 16–17; mỗi mục dưới đây có test đỏ trên mã cũ → xanh trên mã mới (theo báo cáo của nhánh sửa). Diễn giải → `realm-safety.md` § "Đợt sửa sau kiểm chứng", `data-layer.md` § "Đợt sửa sau kiểm chứng", `chatbot.md` § "Kiểm duyệt và độ dài tin", `reader-features.md` § "Trợ năng công khai — đợt sửa", `media-storage.md` § "Archive lớn", `README.md` § "Bài học quy trình".

#### Bảo mật
- **Cài đặt có bí mật**: đổi host/port/user/secure SMTP, account/bucket R2 ảnh, account/bucket R2 video phải gõ lại bí mật trong cùng request (luật chung `shared/settings-credential-rules.ts` cho trang + máy chủ; `server/utils/settings-credential-guard.ts`); cổng SMTP chỉ 25/465/587/2525; `test-email`/`test-r2` (`test-r2` nay cần `settings.update` thay vì `read`) dùng cấu hình đã lưu khi bí mật trống/che và chỉ trả lỗi đã phân loại; xoá ô mật khẩu SMTP = xoá mật khẩu đã lưu; `GET media-portal` trả giá trị R2 đã lưu + `secretStored` (trước đó lưu lại trang có thể xoá trắng cấu hình).
- **Backup**: đích Drive (service account, thư mục, bật/tắt), `backup_keep_count` và mọi endpoint Drive OAuth chỉ SuperAdmin; giao diện ẩn các ô đó và không gửi các khoá đó với người khác (`app/utils/backup-settings-payload.ts`). Xoay vòng luôn giữ bản mới nhất mỗi họ (sql/uploads/media) và mọi bản `pre-restore`. Kiểm mục tar bằng `TarHeaderScanner` đọc header 512 byte trong Node (pax/GNU long name; lý do `archive_unsupported_entry`/`archive_unsafe_name`/`archive_too_many_entries`), thay cho phân tích dòng `tar -tzvf`. Header dump ghim `sql_mode='NO_AUTO_VALUE_ON_ZERO'`. Archive giải nén > 8 GiB bị từ chối (413) — nâng lên 15 GiB ở § 20.
- **Cổng admin**: chỉ `?` bị cắt khi phân loại; đường dẫn có `#`/`%23` không bao giờ được miễn. Kiểm kê handler (`tests/admin-handler-authorization.test.ts`) phân loại bằng AST TypeScript (`tests/_admin-authz-classifier.ts`), 15 miễn trừ giữ nguyên.
- Ảnh thumbnail khi xuất bài đi qua `safeProviderRequest`; host IPv6 NAT64/`fec0::` bị chặn ở đích ra ngoài; Google OAuth chỉ tin `x-forwarded-proto` từ proxy đã khai.

#### Vận hành
- `scripts/restore-db.sh` + `verify-restore.sh`: bộ chặn câu lệnh viết lại (không `grep -q` dưới `pipefail`, dùng `PIPESTATUS`; chặn thêm `\u`, `connect`, `source`, comment thực thi `/*! … */`); `verify-restore.sh --latest`. `scripts/restore-media.sh` viết lại: liệt kê bằng GNU tar, allowlist loại mục, giải nén vào staging + kiểm `find`, bản an toàn (`--no-safety-copy`), `--i-know-app-is-stopped`.
- `manage.sh` Migrate: bộ quét SQL là tokenizer awk hiểu nháy/comment, tuyến tính (dump 16 MB: gawk 0,7 s, mawk 0,4 s, busybox 12 s); `.env` mode 600.
- Healthcheck mysql dùng `MYSQL_PWD` (chỉ có hiệu lực sau `docker compose up -d mysql` thủ công — deploy CI dùng `--no-recreate mysql`). Lưu ý: `mysqladmin ping` trả 0 kể cả khi sai mật khẩu, nên đây **không** phải kiểm xác thực.
- `CI-CD.md` khuyến nghị một job cổng CI luôn chạy + bỏ `paths-ignore` ở `pull_request` trước khi bật required checks (nếu không, PR chỉ sửa docs bị kẹt) — `ci.yml` **chưa** đổi theo. Bước hygiene UTC của `ci.yml` miễn đúng đường dẫn `server/utils/utc-query.ts`.

#### Dữ liệu
- Lọc ngày ở admin (`ai/logs`, `chatbot/sessions`, `activity-logs`) là ngày lịch Việt Nam qua `server/utils/vn-day-range.ts` (giả định session MySQL ở UTC); `profile/history.get.ts` chưa đổi.
- Đồng bộ media: danh sách cột tham chiếu 27 cột (`settings.value`, `chat_messages`, `page_versions`, `home_sections`, câu trả lời chatbot, `social_links.icon`, thumbnail…) kèm lý do từng cột; khớp tới ranh giới cuối URL (`REGEXP_REPLACE`, `server/services/media-sync-url-match.ts`); lưới an toàn sau commit giữ bản cũ còn bị tham chiếu (`media.sync_old_copy_kept_referenced`); bỏ qua hàng mà đường dẫn đích thuộc hàng khác; cache favicon/og-image xoá sau khi viết lại `settings`. Chi phí ≈ +0,4–0,5 s mỗi hàng media (≈ 25–30 phút thêm cho ~3,7k hàng).
- Kiểm duyệt: bộ phân tích regex là parser nhỏ (mở nhóm lồng, lượng từ kề chồng lấn, allowlist phép hoặc literal an toàn); lúc chạy kiểm theo cửa sổ 2000 ký tự chồng lấn, một cửa sổ > 200 ms → tắt luật 10 phút (`ai_moderation.rule_slow_disabled`); luật đã lưu không qua bộ kiểm bị bỏ ở cả hai đường. Quét lại: lưu con trỏ mỗi lô, lô hỏng thử lại một lần, AI chưa cấu hình → chỉ chạy luật (`summary.aiUnavailable`, hiện ở `moderation.vue`), chèn hàng duyệt idempotent (`INSERT … SELECT … WHERE NOT EXISTS`). Chat: độ dài tin tối đa min(10000, `maxInputChars`‖2000) → 400, kiểm sau honeypot + rate limit, trước kiểm duyệt. Log `rate_limit.database_write_failed` (store chung, gồm page-view) giới hạn 1 dòng/phút kèm số lần bị nén.

#### Trang công khai
- Đọc công khai hỏng → 503 + `no-store` qua `reportPublicReadFailure` thêm cho `media/index`, `livestream/active`, `livestream/chat/history` (log không còn tham số Drizzle). `server/plugins/error-no-store.ts` (`beforeResponse`) đặt `no-store` cho mọi phản hồi ≥ 500 vì bộ bọc swr của Nitro ghi `s-maxage` cả lên trang lỗi; trang dùng `useSsrFailureStatus` → 503; `/news/<chuyên mục>` khi tra chuyên mục hỏng hiện trạng thái lỗi thay vì `ArticleDetail`.
- `usePublicArticleList`/`useNavigationSnapshot` (một request mỗi lượt điều hướng, trạng thái suy từ URL), `usePublicMediaList`, `ContentTypeListSection` chuyển sang cùng mẫu; `ModelArticlesListPage`; trang vượt số trang có "Về trang đầu".
- Menu di động: `role="dialog"` + `aria-modal`, phần ngoài `inert`, bẫy Tab, focus vào trong khi mở (nguyên nhân cũ: transition `visibility` trên khung ngăn kéo **và** `transition-all` của nút đóng), có spec e2e. Tìm kiếm trực tiếp có trạng thái lỗi + Thử lại. Biểu mẫu liên hệ xoá `aria-invalid` khi sửa, một tóm tắt `role="alert"`. Vòng focus `#4A6741` (`#7CB342` chỉ 2,50:1); chữ `#7A8A76` → `#5A6C58`. i18n thêm 5 khoá (`site_search_aria`, `menu_dialog_aria`, `search_live_error`, `list_page_out_of_range`, `list_back_first_page`) — **không** dùng lại `search_aria`: DB đã có khoá đó cho role_models/reintegration.

#### Kiểm chứng (cây cuối, 2026-10-14, người kiểm cuối chạy lại toàn bộ)
`npm test` 3738 test / 3717 pass / 0 fail / 21 skip (giống hệt dưới `TZ=Asia/Ho_Chi_Minh`); bước unit của CI (235 tệp, có coverage) 3716/3716, coverage 82,39 % dòng; typecheck 0 lỗi, không `Duplicated imports`; eslint 0 error / 17 warning; `db:drift` sạch (62 bảng / 635 cột); 17/17 suite integration (26 test) xanh trên MySQL thật, matrix `ci.yml` khớp 17 tệp + hai khối env giống nhau; `nuxt build` exit 0; Playwright 83/83 (3,6 phút); shellcheck `-S warning` 0 phát hiện trên `scripts/*.sh` + `manage.sh`; `npm audit --omit=dev` 0 (toàn bộ còn 20 ở công cụ dev: 2 critical, 14 high, 4 moderate); các bước hygiene của CI chạy lại cục bộ đều qua. Bản build thật với CSDL không với tới: 76 cách viết đường dẫn admin (4 method) chỉ trả 401/400/404, `/api/admin/backup/status` không cookie → 401; `/`, `/about`, `/contact`, `/media`, `/news`, `/news/<x>`, `/documents`, `/role-models`, `/reintegration-models` → 503 + `no-store`; **ngoại lệ `/legal-qa` vẫn trả 200** (không header cache) — đã đóng ở § 19.

### 19. Đợt sửa cuối (G1–G3, 2026-10-14)

Ba nhánh sửa sau lượt kiểm cuối của § 18; mỗi mục có test đỏ trên mã cũ → xanh trên mã mới (theo báo cáo của nhánh sửa — người kiểm cuối chạy lại toàn bộ bộ test, không chạy lại các phép đột biến). Diễn giải → `realm-safety.md` § "Đợt sửa cuối (G1–G3)", `chatbot.md` § "Kiểm duyệt và độ dài tin", `reader-features.md` § "Trang chi tiết: 404 khác lỗi tải", `media-storage.md` § "Cấu hình R2 kiểm lúc dùng", `data-layer.md` § "Trang lỗi không được vào bộ đệm".

#### Kiểm duyệt luồng người đọc (G1)
- `createComment` (`server/services/comments.ts`) và `sendChatMessage` (`livestream-chat.ts`) tính giới hạn reader rồi giới hạn IP **trước** `fastPreModerate`, và truyền `readerId` + `capQueuePerSource`: trần 20 hàng duyệt/giờ (`MODERATION_QUEUE_CAP`) nay phủ cả hai luồng, khoá theo IP gộp + reader id (không có cả hai → phiên). Ngân sách hàng duyệt dùng chung theo địa chỉ giữa chatbot, bình luận và chat livestream.
- `server/utils/ip-bucket.ts` (mới): IPv6 → tiền tố /64, IPv4-mapped → IPv4 — **chỉ** cho khoá trần hàng duyệt; khoá giới hạn chung vẫn là địa chỉ đầy đủ (xem danh sách chưa xử lý).
- Tin bị chặn tức thì là ngoại lệ có tên của "lượt giới hạn chỉ tính khi ghi": nó tốn lượt vì ghi một hàng duyệt.
- `recordInstantBlock` không còn nuốt lỗi: log `ai_moderation.queue_insert_failed` với lỗi driver đã che (thông điệp Drizzle nhúng tham số ràng buộc; không ghi nội dung/IP/tên).
- Test: `ip-bucket`, `reader-flows-rate-limit-before-moderation`, `reader-flows-moderation-queue-cap`, bổ sung `moderation-queue-cap`.

#### Trang công khai + chatbot (G2)
- `ArticleDetail.vue` tách **404** (bài thật không có → "Không tìm thấy" + HTTP 404; trước đây mọi thất bại đều hiện cảnh báo + Thử lại với HTTP 200) khỏi **lỗi tải** (→ 503 + `no-store` + Thử lại) qua `resolveDetailFetch` (`app/utils/ssr-failure-response.ts`); `useSsrFailureStatus` thêm tuỳ chọn `notFound`.
- Nhánh hai đoạn của `[slug].vue` dùng `resolveCategoryRoute`: tra chuyên mục hỏng → `BlockLoadError` + 503, không bao giờ rơi sang `ArticleDetail`. `/legal-qa` trả 503 khi CSDL hỏng.
- Chatbot: `describeChatSendFailure` (`app/utils/chatbot-storage.ts`) — 400 `input_too_long` hiện câu tiếng Việt của máy chủ, tin bị từ chối rút khỏi hội thoại và giữ lại làm nháp; trần phía widget chỉ **hạ** (≤ 2000) theo `maxChars` máy chủ báo về; không endpoint công khai nào lộ `maxInputChars`. `useChatbot.ts` ≈ 857 dòng (vượt quy tắc ~400).
- Test: `chatbot-send-rejection`, `public-detail-ssr-status`, e2e `public-detail-status.spec.ts` (5).

#### Sao lưu + R2 + Media Portal (G3)
- `backups.trigger` → `VARCHAR(32)` (từng là 16: `runBackup('sql','pre-fix-thumbnails')` lỗi `ER_DATA_TOO_LONG` trên MySQL 8.0.46 strict — không hàng, không dump, nên quét thumbnail chạy **không** có bản an toàn). Nguồn chân lý `BACKUP_TRIGGERS` (`backup.ts`); production nhận qua `init.ts` lúc container khởi động (`modifyColumn` trong `migrations-additive.ts`) — không đổi `production/`.
- Xoay vòng bỏ qua cả lượt khi khoá `cdkt:backup:restore` đang bị giữ (hoặc không đọc được trạng thái khoá) và không bao giờ xoá tệp đang được khôi phục (`holdRestoreTarget`; log `backup.rotate_skipped_restore_active`).
- R2: account id/bucket kiểm **lúc dùng** (`openR2`/`assertUsableR2Config`, `R2ConfigInvalidError` 400, log `r2.config_invalid` giới hạn 10 phút/trường); `headR2Object`/`deleteR2File` ném lỗi khi cấu hình hỏng (trả `false` từng khiến quét thumbnail/self-heal coi mọi object là mất và ghi đè URL).
- Media Portal: ảnh nguồn của thumbnail đọc theo khoá R2 (`getR2Object`, trần 25 MiB, hạn 20 s) hoặc tệp dưới `public/uploads` — không bao giờ qua `media.url` (bỏ `fetch(img.url)` trần); không thêm nhánh `safeProviderRequest` (không host bên thứ ba nào hợp với tính năng này).
- Test: `backup-trigger-length`, `backup-rotation-restore`, `r2-config-use-time`, `media-portal-thumbnail-source`; `backup-dump-integration` thêm ca fresh + nâng cấp từ `VARCHAR(16)`.

#### Kiểm chứng (cây cuối, 2026-10-14, người kiểm cuối)
`npm test` 3830 test / 3808 pass / 0 fail / 22 skip (giống hệt dưới `TZ=Asia/Ho_Chi_Minh`; 22 skip đều là integration); bước unit của CI (244 tệp, có coverage) 3807/3807, coverage 83,66 % dòng; typecheck 0 lỗi, không `Duplicated imports`; eslint 0 error / 17 warning; `db:drift` sạch (62 bảng / 635 cột); `nuxt build` exit 0; Playwright 88/88 (3,4 phút theo reporter, ~207 s đồng hồ — dư ~93 s so với `globalTimeout` 300 s); shellcheck `-S warning` 0; `npm audit --omit=dev` 0; `openspec validate --specs --strict`: `admin-api-authentication`, `admin-docs`, `backup-restore` đạt (`ai-panel` + 3 spec `i18n/*` hỏng từ trước). **Integration: 17/17 suite xanh (27 test)** — `media-self-heal-integration` từng đỏ sau G3 (fixture `r2_account_id='stub-account'` bị `openR2` từ chối đúng thiết kế); nay fixture dùng account id 32 hex và SDK S3 giả (`mock.module`, HEAD trả 404 dạng SDK): test khẳng định đúng 3 HEAD tới bucket/khoá dự kiến, không lời gọi mạng thật, không lỗi bị nuốt thành "mất". Bản build với CSDL không với tới: `/`, `/about`, `/contact`, `/media`, `/legal-qa`, `/news`, `/news/<x>`, `/news/<x>/<bài>`, `/video/<x>`, `/role-models/<x>` → 503 + `no-store`; `/api/%61dmin/users`, `/api/admin/users`, `/api/admin/auth/login#/../users`, `/api/admin/backup/status` (GET/POST) → 401. Với CSDL seed thật: `/`, `/about`, `/contact`, `/media` 200 + `s-maxage=60`; trang danh sách trần 200 không header cache.

### 20. Trần giải nén archive khôi phục 8 → 15 GiB (2026-10-14, quyết định của chủ repo)

- `DEFAULT_RESTORE_LIMITS.maxArchiveBytes` (`server/services/backup-restore-guards.ts`) `8 * 1024 * MiB` → `15 * GiB`; vẫn là hằng số (không biến môi trường, `production/` không đổi). Trần tải lên 512 MiB đã nén và trần SQL 256 MiB giữ nguyên; thông báo 413 in trần suy từ hằng số ("15360 MB").
- Archive media 10,9 GB nén trên máy dev (`cdkt-media-20260925T191853Z-pre-sync.tar.gz`, luồng tar 11.373.357.056 byte = 10,59 GiB, 11.786 mục): `inspectArchive` với trần mặc định từ chối 413 ở mốc 8 GiB trên mã cũ → nhận trong ~34 s trên mã mới. **Chưa** chạy một lượt khôi phục thật (giải nén) với tệp này.
- Test: `tests/backup-tar-scanner.test.ts` § "default archive cap is 15 GiB" — luồng tar dựng tay đúng 15 GiB được nhận, thêm 1 byte → 413 `decompressed_too_large`; ghim 512 MiB/256 MiB không đổi (3 test đỏ trên mã cũ).

### 21. Đợt sửa sau rà soát chất lượng (2026-10-22)

Các mục **bảo mật** và **toàn vẹn dữ liệu** có test đỏ trên mã cũ → xanh trên mã mới (đã kiểm bằng cách tạm trả tệp nguồn về bản cũ rồi chạy lại test). Mục giao diện: `useConfirm` có test đơn vị; việc thay `confirm()` gốc và lớp Tailwind chỉ kiểm bằng grep + e2e, chưa có test riêng. Quyết định của chủ repo: chặn mọi thao tác trên tài khoản có quyền cao hơn; kết quả AI kiểm duyệt lạ vẫn xử lý như cũ (cho qua, chỉ ẩn khi khớp từ khoá critical); hộp xác nhận nguy hiểm mở ở nút "Hủy".

#### Bảo mật
- **Leo thang quyền qua quản lý user**: `assertRoleWithinActor` (`server/utils/permissions.ts`) — mọi cờ quyền (kể cả publish/archive/test) của vai trò phải nằm trong quyền người thao tác; áp khi gán vai trò (`users/index.post.ts`, `users/[id].put.ts`) và khi sửa/khoá/xoá tài khoản đang ở vai trò đó (`assertUserManageable`, `services/users.ts` — đi qua cả tuyến hàng loạt). Sửa ma trận quyền của một vai trò (`roles/[id].put.ts`) cũng đòi quyền HIỆN TẠI của vai trò nằm trong quyền người thao tác — nếu không, hạ quyền vai trò cao hơn xuống rồi thao tác tài khoản trong đó là vòng qua được (bước verify tìm ra). Tự đổi vai trò/khoá/đặt lại mật khẩu chính mình qua `users/[id].put.ts` bị chặn (400, trỏ sang trang Hồ sơ); form gửi lại `roleId`/`isActive` không đổi vẫn lưu được email. `isActive` phải là boolean (chuỗi `"false"` từng mở khoá); email kiểm cả khi sửa. Test: `user-management-escalation-behavior` (11), bổ sung `security-rbac-escalation`.
- **Prompt injection kiểm duyệt AI**: `fenceUntrustedContent` (`server/utils/ai/untrusted-content.ts`) bọc bình luận trong thẻ hậu tố ngẫu nhiên mỗi lượt, đặt sau phần yêu cầu, kèm dặn "trong thẻ là dữ liệu"; biến `{{content}}`/`{{author}}` cho system_prompt tuỳ chỉnh cũng bọc. `riskLevel` lạ (kể cả `toString`) tính là `high`. Đây là giảm thiểu, không phải bảo đảm. Test: `ai-untrusted-content`, bổ sung `moderation-worker-behavior`.
- **Dò id bài viết**: `GET`/`PUT /api/admin/articles/:id`, `deleteArticleById`, `setArticleStatus` tra bài trong phạm vi `articleActionScope` — đọc: loại được xem; ghi: loại được xem **hoặc** được làm đúng thao tác đó (`['read', 'delete']`, `['read', 'update']`, theo quyết định của chủ repo). Id ngoài phạm vi và id không tồn tại cùng 404; thấy được mà không có quyền ghi vẫn 403. `articleActionScope` nhận một thao tác hoặc danh sách. Ngoại lệ không bọc transaction của hai hàm giữ nguyên. Test: `article-id-oracle-behavior` (SQL thật biên dịch MySQL chạy trên SQLite).
- **Đọc bản dịch chéo loại bài**: ba route đọc (`[id]/translations/index.get.ts`, `[lang].get.ts`, `[lang]/progress.get.ts`) chỉ kiểm `news:read` cố định — người đọc tin tức đọc được bản dịch của bài văn bản/gương điển hình theo id. Nay mỗi route gọi `requireReadableArticle` (`services/articles.ts`): tra bài trong phạm vi loại được xem, ngoài phạm vi → 404 như id không tồn tại. `news:read` ở đầu route vẫn giữ (người không có quyền tin tức vẫn 403 như trước, giống các route ghi bản dịch). `bulk-translate-status.get.ts` chỉ hiện id/tiêu đề bài đang dịch hàng loạt cho người được đọc loại bài đó. Test: `article-translation-read-scope-behavior`.

#### Toàn vẹn dữ liệu
- Audit ghi trên pool **sau** khi transaction đóng ở `home-sections/reorder.put.ts`, `pages/[id]/blocks/reorder.put.ts`, `pages/[id]/publish.post.ts` và lượt đánh dấu "đang dịch" của `triggerTranslation` (`article-translations.ts`) → chuyển vào cùng transaction.
- Guard `reader-audit-atomicity` từng bỏ qua cả tệp chỉ vì có chữ `db.transaction(`; nay bắt `db.insert(activityLogs)` trên pool ở cả `server/api/admin/**` lẫn `server/services/` (`SERVICE_POOL_AUDIT_EXEMPTIONS` nêu lý do cho `articles.ts`, `media-scan.ts`), kèm mẫu ngược "bọc lượt ghi nhưng audit trên pool".
- `setMediaThumbnail`: bước CSDL hỏng → trả `thumb.jpg` (đĩa + R2) về bản cũ, hoặc xoá nếu trước đó không có (log `media_portal.thumbnail_db_write_failed`); `deleteR2Thumb` log `media_portal.thumbnail_r2_delete_failed` thay vì im lặng. Không đổi sang tên tệp mới vì `thumb.jpg` là tên cố định trang công khai đọc. Test: bổ sung `media-portal-thumbnail-source`.

#### Giao diện quản trị
- `useConfirm`/`ConfirmModal`: alias `confirmText`/`tone` được chuyển về `confirmLabel`/`danger` (nút "Khởi động lại Website" và 8 chỗ khác từng hiện như câu hỏi thường); bỏ Enter gắn trên `window` (Enter ở nút "Hủy" từng thành xác nhận); focus vào hộp (nguy hiểm → "Hủy", thường → nút xác nhận), bẫy Tab, `inert` phần còn lại, trả focus khi đóng, nhận ra hộp nối hộp (`seq`); hộp đè hộp → hộp trước nhận `false`; thêm `prompt()` có ô nhập gắn nhãn.
- 23 chỗ `confirm()`/`window.prompt()` của trình duyệt ở 11 tệp admin → `useConfirm` (thao tác phá huỷ có `danger` + nhãn cụ thể). Còn lại có chủ đích: `ArticleComments.vue` (trang công khai, `ConfirmModal` chỉ gắn trong layout admin).
- `py-0.2` (không có trong thang Tailwind, không sinh CSS) → `py-px` ở 9 tệp; `NewsBlock.vue` `my-[6px_0_10px]` (CSS sai) → `mt-[6px] mb-[10px]` — tiêu đề bài nổi bật trang chủ đổi khoảng cách nhẹ.
- `AdminPagination.vue` dùng `pageRange(page, total, 2)` thay bản chép logic cửa sổ trang (đầu ra không đổi).
- Test: `admin-confirm-dialog` (10), bổ sung `pagination`.

#### Test bổ sung (mã không đổi)
- `admin-password-change-behavior` (6): `PUT /api/admin/profile/password` chạy thật — sai mật khẩu hiện tại, mật khẩu yếu/trùng, thu hồi phiên + cấp lại cookie, audit, giới hạn 5 lần/15 phút (429 + `Retry-After`). Trước đây chỉ có test regex trên mã nguồn; mã endpoint không đổi nên test này xanh cả trên mã cũ.

#### Tài liệu
- CLAUDE.md: chống F5 10 phút (không phải 30), repo đã private (CI-CD.md cũng sửa — hạn mức phút Actions nay áp dụng), guard audit mô tả đúng, `AUDITED_SERVICES` 9 (không phải 7), số test.

#### Kiểm chứng (2026-10-22)
`npm test` 3881 / 3859 pass / 0 fail / 22 skip; typecheck 0 lỗi; eslint 0 error / 17 warning; `db:drift` sạch (62 bảng / 635 cột); `nuxt build` exit 0; Playwright 88/88 (lượt cuối chạy sau bản sửa ba route đọc bản dịch, trước bản sửa `bulk-translate-status`) (4,0 phút trên máy dev — sát `globalTimeout` 300 s hơn lần đo trước 3,4 phút; không còn DB `cdkt_e2e_*`, cổng 3123 trống sau lượt chạy). Chưa chạy: 17 suite integration (không suite nào nạp mã đã đổi; e2e trên MySQL thật có đi qua tạo user, sửa block trang, sửa/xoá bài), kiểm thủ công hộp xác nhận trên trình duyệt.

**Không làm được như đề xuất:** `--test-coverage-include` của Node **không** liệt kê tệp chưa test nào nạp (đã thử trên Node 26.11: chỉ lọc tệp đã nạp), nên không làm con số coverage trung thực hơn — không thêm cờ này.

### 22. Rà soát lại 2026-10-23 — sửa đợt 2

Rà lại ba mảng chưa soi ở § 21 (bề mặt công khai, tầng dữ liệu/hiệu năng, frontend công khai). Mục bảo mật có test đỏ trên mã cũ → xanh trên mã mới (đã kiểm bằng cách tạm trả tệp nguồn về bản cũ).

- **Lách kiểm duyệt chatbot**: `/api/public/chatbot` kiểm duyệt `text ?? content` (thô) còn `chat-policy.ts` trả lời `content ?? text` (NFKC) — gửi `text` vô hại kèm `content` bị cấm là qua kiểm duyệt, tới nhà cung cấp AI, và được lưu như câu vô hại; `/api/chat` bỏ qua lượt `{sender:'user', text}`; lượt trước và lượt "trợ lý" (lịch sử do trình duyệt gửi) không được quét. Nay `server/utils/chatbot/chat-turns.ts` là cách đọc lượt duy nhất (`chatTurnText`: `content` trước `text`, NFKC) cho kiểm duyệt, trả lời và lưu. Hai endpoint kiểm hình dạng lịch sử **trước** khi quét (≤ 30 lượt, ≤ 30 000 ký tự, không lượt rỗng, lượt cuối phải của người dùng — `validateChatMessages` áp cùng quy tắc), rồi quét **mọi lượt người dùng** (mỗi lượt qua trần độ dài): câu hỏi **mới** vi phạm → từ chối + một hàng chờ duyệt, lưu đúng chuỗi đã quét; lượt người dùng **cũ** vi phạm (vd. luật thêm sau khi lượt đó đã qua) chỉ bị **giữ lại khỏi model** (`matchInstantRule` — cùng quyết định với `fastPreModerate` nhưng không ghi hàng chờ, không đếm; `withoutUserTurns`) và câu mới vẫn được trả lời — từ chối vì lượt cũ từng làm kẹt cả cuộc trò chuyện (widget chỉ bỏ lượt mới nhất) và ghi lại câu cũ vào hàng chờ ở mỗi tin. Lượt "trợ lý" (lời bot gửi lại) **không** quét: bản đầu có quét và bước verify chỉ ra câu trả lời đúng chứa từ khoá ("tội lừa đảo") làm câu kế tiếp của người dân bị từ chối oan, lời bot bị ghi vào hàng chờ duyệt dưới IP người dân. Lượt trợ lý giả mạo vẫn tới được model — chặn hẳn cần lịch sử phía máy chủ (mục còn mở). Test: `chatbot-moderation-screens-answered-text` (18, gồm nhánh streaming như production), bổ sung `moderation-worker-behavior` (`matchInstantRule`), sửa `chatbot-honeypot-behavior` (thân rỗng nay 400 trước kiểm duyệt).
- **Lộ lý do ẩn bình luận**: `GET /api/public/comments/checkpoint` nhận id bất kỳ từ bất kỳ ai và trả `flagReason` (ghi chú cán bộ, lập luận AI, nguyên văn mẫu chặn). Nay chỉ trả `isHidden` cho bình luận của chính reader đang đăng nhập; tác giả thấy lý do chung. Test: `comment-checkpoint-privacy` (SQL thật trên SQLite).
- **Lỗi kỹ thuật hiện cho người dân**: `app/utils/errorMessage.ts` không còn dùng `message`/`statusMessage` do ofetch tự sinh (`[POST] "/api/…": <no response> Failed to fetch`, "Bad Gateway") — với lỗi `$fetch` chỉ tin câu máy chủ soạn (`data.statusMessage`/`data.message`), còn lại dùng câu dự phòng của nơi gọi. Test: `error-message` (6).
- **Admin**: form user theo trần mật khẩu của máy chủ (12 ký tự, 3/4 nhóm — bản chép hằng `PASSWORD_MIN_LENGTH` có trỏ nguồn), nút tạo/lưu chặn bấm hai lần; trình soạn bài (`articles/[id].vue`) hỏi trước khi rời trang (`onBeforeRouteLeave` qua `useConfirm` + `beforeunload`) khi còn thay đổi chưa lưu.

#### Kiểm chứng (2026-10-23)
`npm test` 3909 / 3887 pass / 0 fail / 22 skip; typecheck 0 lỗi; eslint 0 error / 16 warning; Playwright 88/88 (chạy trước bản sửa lượt trợ lý sau verify). **CI GitHub không chạy từ 2026-10-14** (chạy lại từ 2026-10-23, xem § 25) — mọi job báo "recent account payments have failed or your spending limit needs to be increased" (PR #121, #122): không cổng tự động nào chạy, merge vào `main` cũng không tự deploy cho tới khi chủ repo xử lý thanh toán.

### 23. Sapo bài viết hiện nguyên HTML entity (2026-10-23)

Báo lỗi kèm ảnh: sapo bài "LÀO CAI: Tập huấn…" hiện `Ng&agrave;y 26/8, tại Hội trường Ủy ban nh&acirc;n d&acirc;n x&atilde;…`. Nguyên nhân: CMS cũ lưu mọi chữ Latin-1 thành named entity (chữ ngoài Latin-1 như ạ, ộ, Ủ để nguyên); sapo cắt từ HTML đó được nhập thẳng vào `articles.excerpt` và Vue in nguyên văn. CSDL dev: 17/1132 bài, 5 bài bị cắt giữa entity (`nh&ac`, `l&atild`); `content` (1040 bài có entity) hiển thị đúng vì render bằng `v-html`.

- `server/utils/decode-html-entities.ts` viết lại: đủ 252 tên HTML 4.01 (cả hoa — bản cũ chỉ ~60 tên chữ thường, `&Ocirc;` lọt) + `&apos;` + tên HTML5 của ă/đ/ĩ/ũ (cùng bộ với `cleanExcerpt` phía client), một lượt (`&amp;agrave;` → chữ `&agrave;`), mã số ngoài Unicode/surrogate giữ nguyên thay vì ném `RangeError`.
- Sửa entity bị cắt cuối chuỗi (`dropTruncatedEntity`: tên cụt → bỏ, tên đủ thiếu `;` → giải mã, rồi `…`) **chỉ khi chuỗi đang ở dạng mã hoá** — mọi `&` khác là entity đầy đủ. Bản đầu không có điều kiện này và bước verify chỉ ra `Phòng R&D`/`Hỏi đáp Q&A` thành `R…`/`Q…` (mọi chữ hoa đều mở đầu một tên entity), lại chạy cả lúc ghi.
- Ghi (tạo/sửa bài, bản dịch — giải mã **trước** `stripMarkup`): `decodePlainTextInput`, chỉ giải mã, không bao giờ "sửa". Admin `articles/[id].get` trả sapo đã giải mã, nên trình soạn hiện chữ đọc được và lưu lại một bài cũ là làm sạch nó.
- Đọc (bài cũ hiện đúng ngay sau deploy, không cần chạy script): `articles.get`, `articles/[slug]` (kể cả bản dịch), `related`, `search` (giải mã trước khi cắt 200 ký tự), chatbot `search_c11_articles` (nội dung + sapo gửi model).
- Test: `html-entities-plain-text` (9, gồm handler công khai thật và nhánh bản dịch; ca âm `R&D`/`Q&A`/`R&amp;amp;D`), bổ sung `security-translation-html`. Trang danh sách còn `cleanExcerpt` giải mã lần nữa phía client (thừa — chỉ khác với chữ entity viết nguyên văn).
### 24. Dòng phụ header mất dấu chồng (2026-10-23)

Báo lỗi kèm ảnh: dòng phụ dưới "CON ĐƯỜNG HƯỚNG THIỆN" hiện "CÔNG THÔNG TIN ĐIỆN TỬ HÔ TRỢ … CỘNG ĐÔNG". Thẻ `<p>` (`DefaultHeader.vue`) là `uppercase` + `line-clamp-2` (tức `overflow: hidden`) + `leading-tight`: chữ in hoa hai dấu chồng phía trên (Ổ, Ỗ, Ồ) cao hơn khung dòng 1,25 và bị cắt ở mép trên. Kiểm bằng ảnh chụp Playwright: thêm `pt-[0.2em]` (thay `mt-0.5`) + `leading-snug` thì "CỔNG", "HỖ", "ĐỒNG" hiện đủ ở 1100/1300/1600 px, chiều cao header không đổi (82 px). Cùng mẫu ở tiêu đề livestream (`LiveHero.vue`, `truncate` + `leading-tight`, tiêu đề in hoa từ dữ liệu). Đo bằng font Inter của repo trong Chromium (bước verify): chữ in hoa dấu chồng cao 1,11em trên đường chân chữ, chỗ trống trên dòng đầu của khung cắt là (line-height + 0,73)/2 + đệm trên — nên `leading-snug` một mình vẫn cắt, phần sửa thật là đệm trên. Nhãn địa danh in hoa của `RoleModelsBlock` (`truncate`, thừa kế line-height 1,6 của body) ghi rõ `leading-[1.6]`. Guard: `tests/vietnamese-diacritics-clipping.test.ts` — chữ in hoa trong khung cắt phải có đệm trên hoặc leading ≥ 1,5; ghim dòng phụ header và tiêu đề livestream (chứng minh tổ hợp class, không chứng minh hiển thị). Còn mở: tiêu đề thẻ bài (`NewsBlock` `[1.3]`, các `line-clamp-2 leading-snug`) mất chóp dấu khi tiêu đề trong dữ liệu viết toàn chữ hoa hoặc mở đầu bằng Ấ/Ổ…

### 25. CI: bước cài FFmpeg cắt job dù test xanh (2026-10-23)

Từ 2026-10-23 (lượt chạy đầu sau khi Actions chạy lại) `sudo apt-get update && apt-get install ffmpeg` trên runner `ubuntu-24.04` (image 20261012) mất tới 20 phút (2026-10-14: 20–60 giây) — mirror `azure.archive.ubuntu.com` cấu hình sẵn chập chờn (lỗi đã biết của runner GitHub). Hậu quả: lượt `main` của PR #122 bị huỷ 2 job integration (deploy phải chạy lại), PR #123 bị huỷ 4 job integration và job build (build + e2e đã xanh, nhưng vượt timeout 25 phút của job).

- 17 job integration bỏ bước cài FFmpeg: không suite nào chạy FFmpeg thật (`media-queue-integration` dùng runner giả).
- `unit-tests` (`media-processing` chuyển mã thật) và `build` (e2e `media-portal` tạo video bằng `lavfi`) giữ bước cài, nay có `timeout-minutes: 12`, `DEBIAN_FRONTEND=noninteractive`, `Acquire::Retries`/timeout; chỉ bước **tải** (`--download-only`) có `timeout -k`, cài từ gói đã tải chạy sau (dpkg bị giết giữa chừng làm mọi lần thử sau hỏng ngay); lần thử hai đổi mirror sang `archive.ubuntu.com` **trong `/etc/apt/apt-mirrors.txt`** — runner ubuntu-24.04 khai `URIs: mirror+file:/etc/apt/apt-mirrors.txt`, bản đầu chỉ sửa sources.list nên không đổi được gì (bước verify chỉ ra); `--no-install-recommends` (290 → 198 gói trên image trần, đủ cho libx264/aac/lavfi/ffprobe — đã chạy thử trong container ubuntu:24.04).
- `Install Chromium` (`playwright install --with-deps` chạy apt riêng) có `timeout-minutes: 8`; job `build` 25 → 35 phút (hai bước apt có trần 12 + 8 phút cộng build/e2e ~14 phút — 25 phút từng cắt lượt đã xanh).
- Guard: `tests/ci-ffmpeg-install.test.ts`. Mô phỏng luồng điều khiển bằng apt/sudo giả: tải được ngay → 1 lần; hỏng 1 lần → đổi mirror rồi cài; hỏng 2 lần → exit 1.

### 26. Danh mục video bị xoá ở MỖI lần khởi động (2026-09-22 → bản vá 2026-10-23)

**Lỗi.** `69a84eb` (2026-09-22) tách danh mục video khỏi `categories` bài viết sang bảng `media_categories`. Lượt chuyển trong `applyAdditiveMigrations` có hai chỗ sai:
- Nó chạy `UPDATE media_items SET category_id = NULL WHERE category_id IS NOT NULL` **không điều kiện**.
- Nó drop `fk_media_items_category` theo **tên**, bất kể FK đó trỏ đâu, rồi add lại.

Khối này chạy mỗi lần container khởi động (Dockerfile CMD `init.ts` → `seed.ts` → server; `restart: always`; mỗi lượt CI deploy và `manage.sh` Update tạo lại container app). Danh mục cán bộ gán cho video chỉ sống tới lần khởi động kế tiếp, từ 2026-09-22 cho tới khi bản vá được deploy; riêng 2026-10-23 có bốn lượt deploy. Không test nào gán danh mục rồi khởi động lại, nên CI vẫn xanh suốt thời gian đó.

**Sửa** (`convergeMediaCategoryForeignKey`, `server/db/migrations-additive.ts`): lượt chuyển khoá theo **trạng thái lược đồ**. Mọi FK trên cột `media_items.category_id` được đọc theo cột (`KEY_COLUMN_USAGE` ⋈ `REFERENTIAL_CONSTRAINTS`, cùng khuôn `ensureChatbotForeignKey`), không theo tên:
- Còn FK trỏ `categories`: UPDATE về NULL → drop mọi FK trên cột → add `fk_media_items_category`. Bị cắt ngang ở bất kỳ bước nào thì lượt sau vẫn hoàn tất đúng.
- Đúng một FK → `media_categories(id)` SET NULL: **không làm gì**, không UPDATE, không DROP/ADD.
- Không FK hoặc FK sai hình: đếm giá trị treo. Nếu 0, drop FK sai rồi add, không đụng giá trị. Nếu > 0, giữ nguyên, log `db.migration.media_category_fk_blocked` `{ danglingRows }` (khai trong `BOOT_MIGRATION_EVENTS`, `server/utils/logger.ts`), và app vẫn khởi động. Trước đây add FK lúc đó sẽ ném 1452 và container khởi động lại mãi.
- Không xoá theo giá trị: id thể loại bài viết cũ 1–7 trùng id danh mục video seed 1–4.

**Test** `tests/media-category-migration-integration.test.ts` (MySQL thật, matrix CI nay 18 job; switch `MEDIA_CATEGORY_MIGRATION_INTEGRATION` + `MEDIA_CATEGORY_MIGRATION_HOST/PORT/USER/PASSWORD` ở cả hai khối env). Bốn ca:
1. CSDL mới (init + seed thật), gán danh mục rồi khởi động lại → giữ nguyên; bộ ghi lệnh trên `applyAdditiveMigrations` thấy không lệnh ghi nào vào `media_items`.
2. Nâng cấp từ FK `fk_media_items_category` → `categories`, có `media_categories` id 2 (ca trùng id) → id cũ 2 và 6 bị xoá đúng một lần; gán lại rồi khởi động hai lần → còn nguyên.
3. FK cũ tên tự sinh (`media_items_ibfk_1`) và chưa có bảng `media_categories` → còn đúng một FK đúng.
4. Thiếu FK (giá trị hợp lệ) → add, không xoá; sai luật xoá → dựng lại, không UPDATE; thiếu FK + giá trị 999 → giữ 999, không FK, log sự kiện mỗi lần khởi động.

Trên mã cũ cả 4 ca đỏ: ca 1 thấy giá trị thành NULL, ca 3 thấy hai FK cùng tồn tại.

**Khôi phục** giá trị đã mất: runbook do người vận hành chạy, sau khi image vá đã chạy healthy, ở [`docs/decisions/data-layer.md` § Khôi phục danh mục video](decisions/data-layer.md#media-category-restore); con trỏ ở `production/README.md`. Bước 0 là chép `./backups` ra ngoài vòng xoay **ngay**. Bản dump chỉ nạp vào CSDL nháp; UPDATE ghép video theo id + slug, danh mục theo id + slug, và chỉ điền `WHERE mi.category_id IS NULL`. Nếu không có bản dump dùng được thì lấy danh sách ứng viên từ `activity_logs`. **Không bao giờ lùi về image cũ hơn bản vá**: lần khởi động đầu của nó sẽ xoá lại.

#### Kiểm chứng (2026-10-23)
Suite mới trên MySQL dev: mã cũ 0/4 pass, bản vá 4/4. `npm test` 3930 / 3904 pass / 0 fail / 26 skip. Typecheck 0 lỗi. eslint 0 error / 16 warning. `db:drift` 62 bảng / 635 cột.

Còn mở:
- `modifyColumn(… 'media_items', 'short_id', 'VARCHAR(16) NOT NULL')` vẫn gửi một `ALTER TABLE media_items MODIFY COLUMN` ở mọi lần khởi động. Nó không đụng `category_id`, và test nêu tên nó là ngoại lệ.
- Các lượt ghi khác lúc khởi động (`seed.ts` hồi sinh hàng mặc định đã xoá, ghi đè thứ tự `home_sections`) thuộc wave1/wave2 (`schema-upgrade-safety`).

### Chưa xử lý (cập nhật sau đợt G1–G3, 2026-10-14; thêm mục từ § 21–25, 2026-10-23)

Ghi thật để không ai tưởng đã xong. Đã đóng ở § 19 (gỡ khỏi danh sách): `comments.ts`/`livestream-chat.ts` kiểm duyệt trước giới hạn; xoay IPv6 né trần hàng duyệt (chỉ trần hàng duyệt); thông báo 400 của `useChatbot.ts` bị nuốt; `fetch(img.url)` trần ở `media-portal.ts`; account id R2 đã lưu không kiểm lúc dùng; `[slug].vue` hai đoạn + lỗi tải `ArticleDetail.vue` trả 200; `/legal-qa` 200 khi CSDL hỏng; `backups.trigger` `VARCHAR(16)`; xoay vòng theo lịch xoá tệp đang khôi phục; `recordInstantBlock` nuốt lỗi; fixture `stub-account` làm đỏ `media-self-heal-integration`.

- Khoá giới hạn chung vẫn là địa chỉ IP đầy đủ (`comment:ip:`, `livestream:chat:ip:`, giới hạn chat, trần AI theo IP) — xoay địa chỉ trong một /64 IPv6 vẫn né được các giới hạn này (trần hàng duyệt đã gộp /64).
- Luật độ dài tin chat nằm ở `server/utils/chatbot/input-length.ts`, nên chuyển vào `chat-policy.ts`; widget mặc định 2000 ký tự và chỉ hạ theo `maxChars` máy chủ báo về — `maxInputChars` > 2000 không bao giờ tới được widget.
- `headR2Object` vẫn trả `false` cho lỗi mạng/xác thực/5xx (chỉ cấu hình hỏng mới ném): self-heal gặp R2 chập chờn sẽ coi object là mất và đổi thumbnail + `media.url` sang ảnh mặc định (có bản `pre-self-heal` trước đó).
- `articles/export-csv` và xuất Google không có cổng quyền ở đầu handler (phạm vi bài lọc qua `articleReadScope` / kiểm từng bài).
- `server/middleware/https-redirect.ts` tin `x-forwarded-host` thô.
- `fetch` trần: `ai/delify/status`, `ai/delify/sync`, `server/utils/ai-budget.ts` tới `router.delify.vn`.
- `server/utils/smtp-test-config.ts` giữ một bản chép logic của `shared/settings-credential-rules.ts` (có test đối chiếu, nhưng vẫn là hai bản).
- Bộ nhớ đệm provider giữ baseUrl cũ tới 60 s sau khi đổi.
- `deleteMediaItem` rò bản gốc local của video đã lên R2.
- Media Portal: kiểm "nằm dưới `public/uploads`" của ảnh nguồn thumbnail là so chuỗi đường dẫn — thư mục cha là symlink nằm dưới uploads vẫn lọt (như route `/uploads` hiện có; tệp symlink thì bị `lstat` chặn).
- `ai/moderation/rules/[id].put.ts` không kiểm `severity`/`action`/`category`.
- ReDoS: parser + chạy có trần cửa sổ giảm mạnh rủi ro nhưng vẫn **không** chứng minh loại trừ.
- `rate_limit.database_read_failed` không được giới hạn tần suất log như `database_write_failed`.
- `server/services/analytics-maintenance.ts` vẫn tự `createPool`.
- Trang 404 trên tuyến `swr` mang `s-maxage=60, stale-while-revalidate` (đo với CSDL seed, 2026-10-14: `/news/<chuyên mục không có>`, `/news/<x>/<bài không có>`, `/role-models/<x>`) — CDN có thể giữ 404 tới 60 s sau khi bài/chuyên mục được tạo; `/<slug>`/`/video/<x>` không có header này.
- Đồng bộ media: bản cũ được lưới an toàn giữ lại không bao giờ bị xoá sau; tệp trùng tên từ tháng khác chặn hàng đó đồng bộ; viết lại URL làm tràn cột `VARCHAR` thì hàng đó rollback mỗi lượt; cache SWR có thể phục vụ trang trỏ tới bản cũ vừa xoá tới 60 s.
- Tệp vượt ngưỡng ~400 dòng mà đợt rà soát này làm dài thêm (`wc -l` 2026-10-14 sau G1–G3; trong ngoặc: `origin/main` 25d0e44): `server/services/media-portal.ts` 1169 (1133), `server/services/comments.ts` 1134 (1122), `app/pages/admin/ai/moderation.vue` 1134 (1030), `app/composables/useChatbot.ts` 857 (804), `server/services/moderation-worker.ts` 767 (489), `server/utils/chatbot/chat-policy.ts` 763 (740), `server/services/ai-gateway.ts` 732 (685), `app/components/ArticleDetail.vue` 730 (717), `server/services/moderation-regex.ts` 686 (mới), `app/pages/admin/settings/media-portal.vue` 671 (645), `server/utils/chatbot/outbound.ts` 588 (388), `server/services/livestream-chat.ts` 536 (524), `app/components/ModelArticlesListPage.vue` 535 (mới), `app/pages/admin/settings/backup.vue` 529 (518), `server/services/backup-restore-guards.ts` 477 (mới; 482 sau § 20).
- Xoay vòng backup: một lượt khôi phục bắt đầu đúng lúc vòng xoá đang chạy sẽ thất bại sạch thay vì được ngăn trước; `deleteBackup` thủ công vẫn xoá được tệp đang khôi phục. Khôi phục chạy bằng `DB_USER` (root theo mặc định compose). Archive media 10,9 GB trong `backups/` nay qua được bước kiểm (trần 15 GiB, § 20), nhưng khôi phục theo tên chạy đồng bộ trong một request (~34 s kiểm + một lượt `tar -xzf`): sau nginx `location /` (`proxy_read_timeout` mặc định 60 s) trình duyệt có thể nhận 504 trong khi máy chủ vẫn giải nén; không kiểm dung lượng đĩa trống trước khi giải nén; một mục đơn ≥ 8 GiB do GNU tar ghi (size base-256 ở `--format=gnu`, `size=` pax + 0 trong header ở `--format=posix` — đã kiểm với GNU tar 1.35) vẫn bị từ chối `archive_unparseable`, bất kể trần.
- Hai nơi ghi `analytics_noc_minute_aggregates` với ngữ nghĩa khác nhau.
- Cột `GEOMETRY` (nếu thêm sau này) sẽ làm dump của app hỏng.
- Compose: `DB_HOST`/`DB_PORT` không truyền qua (MySQL ngoài chưa hỗ trợ), service mysql không có `image:` riêng; chú thích healthcheck mysql trong `docker-compose.yml` vẫn ghi "Authenticated ping" — sai: `mysqladmin ping` trả 0 cả khi sai mật khẩu.
- `profile/history.get.ts` còn lọc ngày theo mẫu cũ (chưa qua `vn-day-range.ts`).
- Test: suite `analytics-ddl`/`chatbot-ddl` không xoá DB `_fresh`/`_partial` của chúng; `media-self-heal-integration` ghi một `cdkt-*-pre-self-heal.sql.gz` vào `backups/` **của repo** mỗi lượt chạy; chú thích trong `ci.yml` còn ghi "203 tệp non-integration" (thực tế 244); Playwright đầy đủ (88 test) mất ~207 s trên máy dev so với `globalTimeout` 300 s (dư ~93 s) — runner CI chậm hơn có thể chạm trần, và khi chạm trần teardown bị bỏ (server mồ côi giữ cổng 3123).
- Việc của chủ repo trên GitHub: bật branch protection cho `main` (PR + status check bắt buộc, kèm job cổng CI luôn chạy — xem `CI-CD.md`), cân nhắc `environment: production` có người duyệt, xoá environment lạc tên `VPS_HOST`; giấy phép Font Awesome Pro trong repo **public**; hash bcrypt của admin trong `migrations/002_seed_data.sql`; lịch sử git ~699 MB có dump.
- (§ 21) Id bài viết vẫn dò được (tra theo id trần rồi 403 theo loại) ở: `articles/[id]/boost.delete.ts`, `articles/[id]/export.get.ts`, `setArticleCommentsEnabled` (`services/articles.ts`, qua `bulk-comments.post.ts`), `article-translation-bulk.ts` (id thiếu bị bỏ qua, id khác loại làm hỏng cả lô), `article-translations.ts` (4 chỗ). `tests/audit-access-control.test.ts:119` vẫn kỳ vọng 403 cho GET khác loại vì mock bỏ qua WHERE — hành vi thật (404) do `article-id-oracle-behavior` khẳng định.
- (§ 21) `articles.type` lưu chỉ `.trim()` trong khi bảng dùng `utf8mb4_unicode_ci`: `Role_Model` được JS coi là news nhưng MySQL so bằng `role_model` — phạm vi SQL và kiểm quyền JS lệch nhau; editor news có thể tạo bài `type: 'ROLE_MODEL'` mà bộ lọc công khai `type = 'role_model'` khớp. Gốc: chuẩn hoá/allowlist `type` lúc ghi. `[id].put.ts` dùng `resourceMap[type] || 'news'` riêng thay vì `articleResource()` (loại tên `constructor` → 403 sai, an toàn).
- (§ 21) `triggerTranslateAllLanguages` trả 200 `{queued: 0}` mà không kiểm loại bài khi không còn gì để dịch (403 khi có, 404 khi id thiếu) — lộ sự tồn tại và độ phủ bản dịch, không lộ nội dung. `translation-stats.get.ts` đếm gộp mọi loại dưới `news:read` (chỉ số tổng).
- (§ 22) Lịch sử chat do trình duyệt giữ: lượt "trợ lý" giả mạo tới được model (không quét để tránh từ chối oan) — muốn chặn cần dựng lịch sử từ `chat_messages` của phiên phía máy chủ. `errorMessage` vẫn hiện "Server Error" khi handler ném lỗi chưa xử lý (Nitro tự điền `statusMessage`).
- (§ 22) Chat: `chatHistoryShapeOk` dùng trần cố định 30 lượt, policy dùng `min(30, (maxHistoryMessages+1)*2)`. Client cắt câu bot 1200 ký tự và luôn gửi tới 8 lượt — `maxInputChars` < 1200 hoặc `maxHistoryMessages` 0–2 làm hội thoại 400 mãi (có từ trước).
- (§ 23) Phép sửa entity cụt lúc đọc vẫn cắt chuỗi PHA (có entity đầy đủ và kết thúc bằng `&chữ` thật: `C&ocirc;ng ty AT&T` → `Công ty AT…`) — dev 0 hàng; lời giải gốc: backfill một lần 17 sapo cũ (giải mã + sửa đuôi cụt) rồi cho đường đọc chỉ giải mã. Giải mã ở cả ghi lẫn đọc nên chữ entity viết nguyên văn đi hết vòng thành ký tự.
- (§ 23) Admin còn đọc sapo thô ở xuất Word/HTML/Google (`articles/[id]/export.get.ts`, `export-batch.get.ts`, `article-export-google.ts`) và worker dịch AI (`article-translation-worker.ts` gửi sapo thô cho model; khi lùi về sapo gốc, đuôi `nh&ac` được giải mã lúc ghi rồi không sửa được nữa). Chưa có test hành vi cho `related`/`search`/chatbot và cho POST/PUT bài với entity.
- (§ 23) 17 sapo cũ vẫn lưu dạng entity trong CSDL (chỉ hiển thị đã đúng): tìm kiếm `LIKE` theo sapo không khớp chữ có dấu Latin-1 ở các bài này cho tới khi lưu lại bài hoặc chạy một lượt làm sạch dữ liệu.
- (§ 22) Giả danh "Ban quản trị": tên hiển thị reader không chặn tên dành riêng/ký tự giống nhau; tiêu đề email thông báo trả lời trùng email thật và email gửi trước kiểm duyệt nền (chỉ khi bật bình luận).
- (§ 22) Tầng dữ liệu: `purgeExpiredRateLimits` xoá một lô 5000/đêm, không lặp — `rate_limit_counters` phình (lượt xem bài mỗi (bài, khách, ngày) một khoá, `view.post` không giới hạn theo IP); khối "Đọc nhiều" (`articles.get.ts` `sort=views`) cộng `article_view_daily` cho mọi bài mỗi lượt, không cache; ghi analytics giữ khoá dòng `total` suốt ~10 lệnh; `articles` thiếu chỉ mục ghép `(status, type, published_at)`; FFmpeg thumbnail công khai không gộp yêu cầu, không thời hạn; `aggregateDay` nạp cả ngày vào RAM.
- (§ 22) Gia cố công khai: chỉ dựa SameSite=Lax chống CSRF trong khi site chạy chung `*.delify.vn` (nên kiểm `Origin` ở POST/PUT/DELETE, cookie `__Host-`); cờ `Secure` suy từ `x-forwarded-proto` thô; đăng xuất reader không tăng `tokenVersion`; SMTP 587 không `requireTLS`; SSE livestream không trần kết nối mỗi IP; form liên hệ không trần số/độ dài câu trả lời.
- (§ 22) Trợ năng công khai: hộp chat (focus trên điện thoại, bẫy Tab lọt phần tử ẩn, `aria-live` đọc từng nhịp gõ); carousel `RoleModelsBlock` tự trượt không dừng/không theo reduced-motion; vòng focus `#7CB342` (2,5:1) ở 9 tệp ngoài `focus-ring-contrast.test.ts`; nhiều `<h1>` mỗi trang; `LiveTickerBar` hỏi livestream 8 s trên mọi trang kể cả tab ẩn; `sm:py-4.5` không sinh CSS.
- (§ 21) Guard audit: `auditsOnPool` chỉ khớp `db.insert(activityLogs)` — `getDb().insert(activityLogs)` sau transaction không bị bắt; service có `async function audit(` bỏ qua kiểm pool. Hiện không có vi phạm.
- (§ 21) `setMediaThumbnail` khôi phục R2 bằng bản đĩa cũ: mất bản đĩa mà R2 còn `thumb.jpg` thì lượt CSDL hỏng xoá luôn bản R2; hai lượt lưu đồng thời có thể khôi phục đè nhau.
- (§ 21) Biến `{{content}}`/`{{author}}` bọc bằng thẻ ngẫu nhiên khác thẻ trong prompt chính, system_prompt tuỳ chỉnh không có lời dặn "trong thẻ là dữ liệu".
- (§ 21) Coverage thật (đo 2026-10-22, lcov của `npm test` so với `git ls-files`; `--test-coverage-include` của Node không liệt kê tệp chưa nạp nên không dùng được): `server/**/*.ts` 570 tệp, test nạp 275, **chưa nạp 295** (219 ở `server/api/admin`, 23 ở `server/api/public`); 81,9 % dòng trong các tệp đã nạp, ≈ 65 % nếu tính tệp chưa nạp là 0 % (ước ~12.200 dòng mã). `app/**/*.ts` 92 tệp, chưa nạp 37, ≈ 76 %. 174 tệp `.vue` không đo được bằng runner Node (chỉ e2e + guard mã nguồn). E2E có gọi nhiều handler qua HTTP nhưng không được đo.
