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
- Các lượt ghi khác lúc khởi động (`seed.ts` hồi sinh hàng mặc định đã xoá, ghi đè thứ tự `home_sections`) thuộc wave1/wave2 (`schema-upgrade-safety`). Ghi đè thứ tự `home_sections` đã đóng ở § 29; hồi sinh hàng mặc định đã xoá vẫn thuộc wave2.

### 27. Wave 1 · 1D — CI, deploy, vận hành (2026-10-23)

Đợt đầu của `openspec/changes/wave1-quick-fixes` (D26–D36), đi trước 1A/1B/1C để mọi lượt merge sau đã có dump trước deploy và bỏ qua deploy khi chỉ đổi tài liệu.

- **Dump CSDL trước mỗi lượt đổi image** (D26). `deploy-remote.sh` gọi `backup-db.sh --prefix cdkt-predeploy` ngay sau `docker pull`, **trước** `install_compose`/`migrate_trusted_proxy_ips`/`set_image`; dump hoặc phép kiểm hỏng → `exit 1`, compose/`.env`/container y nguyên. CI gửi `scripts/backup-db.sh` **của commit** vào `.deploy-incoming/` kèm SHA-256 (bản trong clone trên VPS chỉ mới khi có người `git pull` — bản cũ đọc `--prefix` thành thư mục đích). Dump vào `<APP_DIR>/.deploy-db-backups/` (không phải `./backups`: bind mount thuộc uid 1000 sau mỗi lần container khởi động, user deploy chưa chắc ghi được), giữ 5 bản theo số, không ping. `manage.sh` Update hỏi `Sao lưu DB trước khi cập nhật? (Y/n)`. `.gitignore` thêm `.deploy-db-backups/` và `.deploy-incoming/`.
- **Merge chỉ đổi tài liệu không deploy** (D27). Job `changes` có output `deploy` (push: `git diff --no-renames <bản đang chạy>..sha`, mọi tệp khớp `\.md$|^docs/|^openspec/` → `false`; PR → `false`; chạy tay → `true`). Mốc so là commit **đang chạy trên production**, không phải `github.event.before` (bản đầu của đợt này dùng `before`: lượt A đang deploy, push mã B chờ, push tài liệu C tới → GitHub huỷ B, C so B..C = chỉ tài liệu → mã B không bao giờ lên production dù CI xanh; cùng chuyện khi B đỏ một cổng trước `image`). Mốc: (a) `version` của `<VPS_SMOKE_URL>/api/public/health` (`curl -fsSL -m 10 --retry 2`, đúng 12 hex, `git rev-parse`) → (b) `head_sha` của lượt chạy mới nhất trên `main` (xếp theo `run_started_at`) có **job** `Deploy to VPS` `success` (`gh api`, `actions: read` chỉ ở job `changes`) → (c) không có mốc / không là tổ tiên / diff hỏng / diff rỗng mà khác commit → `true`. Mốc == commit đẩy lên → `false` (ép deploy lại: chạy tay). `image` cần `changes` và `deploy == 'true'`; `deploy` đổi `if: true` → `needs.image.result == 'success'`. Test vẫn chạy đủ. Hành vi PR của `changes` không đổi.
- **`GET /api/public/health` + smoke** (D28). `SELECT 1` qua pool chung đua với timer 2 s, `no-store`, 200 `{ ok, version }` / 503 (`public.health_failed`). `APP_VERSION` (12 ký tự SHA) là `ARG/ENV` lớp cuối Dockerfile, CI `build-args` — không qua compose. Bước *Smoke test through the public URL*: `vars.VPS_SMOKE_URL`, `curl -fsSL` (theo chuyển hướng), 12 lần, nghỉ 10 s giữa hai lần (không nghỉ sau lần cuối — ~2 phút khi trang trả lời ngay, tệ nhất ~3 phút 50 giây), `?t=` chống cache, so version; thiếu biến → `::warning::`; hỏng → job đỏ, **không** tự lùi.
- **Crash loop dừng chờ sớm** (D29): `wait_healthy` lấy mốc `RestartCount` mỗi lần chờ, tăng > 2 → in 60 dòng log → đường lùi.
- **Dừng êm** (D30): app `stop_grace_period: 45s`; hook `close` → `stopBackupScheduler`; CMD kết thúc `exec node …` (Node là PID 1; BusyBox `sh -c` vốn đã exec lệnh cuối — nay nói rõ thay vì dựa vào nó). Đo trên image thử: `docker stop` 4,5 s, PID 1 = `node` chạy bằng user `node`.
- **Giữ image** (D31): sau deploy/Update khoẻ giữ image đang chạy + 5 `sha-*` khác, gỡ theo thẻ (`docker image rm`, không `-f`), rồi `image prune -f`; cảnh báo đĩa Docker > 80 %. (Trước: chỉ `image prune --filter until=168h` — không bao giờ gỡ image còn thẻ.) GHCR: `.github/workflows/ghcr-retention.yml` (tuần + bấm tay, `actions/delete-package-versions@e5bc658…` = v5.0.0, giữ 20). Action so `ignore-versions`/đếm theo **version (digest)**, không theo thẻ, và provenance mặc định của buildx biến mỗi push thành index + 2 manifest con không thẻ — nên job `image` đặt `provenance: false` để 20 version = 20 image.
- **Thứ tự lớp Dockerfile** (D32): `apk`/`tzdata` trước mọi COPY ứng dụng; `COPY --chown=node:node`; `npm ci` chạy bằng `USER node`; bỏ `chown -R node:node /app` (chỉ chown các thư mục mount rỗng + `/app` không đệ quy). Entrypoint và `fix_uploads_ownership` (nay qua `docker exec`, không dựng container một-lần) chỉ `chown -R` khi `stat -c %U` gốc cây ≠ `node`; entrypoint xét riêng `/var/lib/cdkt/media` (điểm gắn volume). `docker history` (build cục bộ): trước — lớp `chown -R` 204 MB + `apk ffmpeg` 175 MB nằm SAU các COPY ứng dụng (tải lại mỗi deploy), image 1,04 GB; sau — không còn lớp chown (lớp mkdir/chown 0 B), `apk` nằm trên các COPY ứng dụng (giữ cache), image 760 MB. Quyền sở hữu như cũ: 0 tệp dưới `/app`, `/var/lib/cdkt` không thuộc `node`, ở cả hai image.
- **Dependabot** (D33): npm, github-actions, docker (Dockerfile gốc; bỏ major của `node`), hằng tuần, gộp minor+patch, ≤ 5 PR. Merge gộp một lượt (`CI-CD.md` § Dependabot).
- **Guard matrix integration** (D34): `tests/ci-integration-matrix.test.ts` — mọi `tests/*-integration.test.ts` có trong matrix đúng một lần, đúng switch, bước chạy suite có đủ mọi biến `<PREFIX>_*` suite đọc (thêm `*_HOST` còn thiếu). Bước "Fail if this suite skipped" đọc log `tee` (`--test-reporter=tap`, `# tests/pass/skipped`) thay vì chạy lại suite; bỏ khối env thứ hai.
- **Ping giám sát** (D35): `HEALTHCHECK_PING_URL` — `backup-db.sh`, `verify-restore.sh` gọi `<URL>` / `<URL>/fail` từ **một** `trap on_exit EXIT` (`curl -fsS -m 10 --retry 2 … || true`; `verify-restore.sh` vẫn dọn CSDL nháp trong cùng handler). `manage.sh` Deploy/Update hỏi (Update không in URL; từ chối `?`/`&`/`#`). Chỉ script host đọc — không vào compose. `backup-db.sh` bỏ `grep -q` trong ống dưới pipefail.
- **Tài liệu** (D36): repo **PUBLIC** (kiểm 2026-10-23) — hạn mức phút Actions không áp dụng (CLAUDE.md, CI-CD.md); `getDb()` 171 / import `services/**` 209 / `useI18n.ts` 265 dòng; header `check-resources.sh` (compose mặc định không giới hạn RAM); CI-CD.md § Giữ image thay câu "giữ 7 ngày".

**Vòng sửa 1 sau kiểm độc lập (2026-10-23):**
- Mốc của docs-only skip = bản đang chạy (ở trên). `tests/ci-docs-only-skip.test.ts` viết lại: chạy script với `curl`/`gh` giả (luôn giả — `gh` thật trên máy dev đã đăng nhập): push mã bị huỷ khi chờ rồi push tài liệu → `true` (bản cũ trả `false`), mã đỏ trước `image` rồi push tài liệu → `true`, (a) thắng (b), (a) không tới được/`dev`/commit lạ/không phải 12 hex → (b), (b) xét job chứ không xét lượt, xếp theo `run_started_at`, không mốc → `true`, không là tổ tiên → `true`, đã chạy → `false`, tên job `Deploy to VPS` ghim.
- `backup-db.sh`: `umask 077` (dump 600; thư mục tự tạo 700; thư mục `--prefix` đặt 700 cả khi có sẵn 755 — thư mục ghi được mà không sở hữu thì cảnh báo `backup.warning` và vẫn dump; `./backups` giữ quyền — bind mount của app). Ghi `<tên>.sql.gz.partial`, `mv` sau khi kiểm; `trap` HUP/INT/TERM → `exit 129/130/143` → `on_exit` xoá partial + tệp lỗi tạm (trước: TERM giết bash ngay, gzip đóng bản cụt thành `.sql.gz` hợp lệ, không ping `/fail`); partial cùng họ > 1 ngày bị dọn.
- `.dockerignore`: `.deploy-db-backups`, `.deploy-incoming`, `.deploy-compose-backups`, `.docker-compose.incoming.yml` (tên trần + `**/`) — `manage.sh` có thể lùi về `docker compose build app` ngay trong bản clone trên VPS, và stage builder `COPY . .`. Kiểm bằng build `FROM scratch` + `--output type=local`: gốc và lồng sâu đều bị loại.
- `ghcr-retention.yml`: tên package từ `github.repository` (payload `schedule` không có `github.event.repository`); test chạy thật bước đó và bước `meta` của job `image`, so tên package với đường dẫn image.
- `manage.sh` Update: câu hỏi sao lưu là bước **đầu tiên** — trước `git pull`, `git checkout -- docker-compose.yml`, các câu hỏi ghi `.env` và image (README từng nói vậy nhưng mã dump sau cả ba). Dump hỏng → không `git`, `.env`/compose y nguyên.
- SSH deploy `ServerAliveInterval=30`/`ServerAliveCountMax=10`. Smoke: `-L`, không nghỉ sau lần cuối, thông báo/tài liệu nêu thời gian thật.
- CLAUDE.md: 332 endpoint (`find server/api -name '*.ts'`; 331 trước khi thêm `health.get.ts`).
- Kiểm chứng vòng sửa: `npm test` 4004 / 3978 pass / 0 fail / 26 skip; typecheck 0 lỗi; eslint 0 error / 16 warning (như trước); `bash -n` + shellcheck `-S warning` (image `koalaman/shellcheck:stable`) 0 trên `scripts/*.sh` và `production/manage.sh`; actionlint 1.7.7 (image `rhysd/actionlint:1.7.7`) cho `ci.yml` + `ghcr-retention.yml` ra đúng tập ghi chú `info` như HEAD (chỉ lệch số dòng), không lỗi cấu trúc. Đột biến `.conclusion == "succes"` trong bước Plan làm đỏ 6 test của `tests/ci-docs-only-skip.test.ts` (đã trả lại).

Test mới/mở rộng (đều đỏ trên mã trước đợt này): `tests/ops-scripts.test.ts` (+12 guard), `tests/deploy-remote-behavior.test.ts` (+11 ca chạy thật, docker giả chuyển sang `tests/fixtures/deploy-remote/docker`), `tests/ops-scripts-sandbox.test.ts` (+5 ca Update/Deploy; helper trả lời câu hỏi sao lưu), `tests/backup-ping-predeploy.test.ts`, `tests/ci-docs-only-skip.test.ts`, `tests/ci-integration-matrix.test.ts`, `tests/health-endpoint.test.ts`, `tests/dockerfile-layers.test.ts`, `tests/dependabot-config.test.ts`.

#### Kiểm chứng (2026-10-23)
`npm test` 3989 / 3963 pass / 0 fail / 26 skip. Typecheck 0 lỗi. eslint 0 error / 16 warning (như trước). `bash -n` mọi script đổi; shellcheck `-S warning` sạch (`scripts/*.sh` đổi, `production/manage.sh`, `docker-entrypoint.sh`); actionlint 1.7.7 sạch về cấu trúc (shellcheck nhúng chỉ còn ghi chú `info` cùng loại đã có trên `main`). `docker compose config -q` (env giả) đạt. Build image cục bộ (thẻ tạm, đã xoá): container chỉ chạy server với CSDL không tới được → `/api/public/health` 503 sau ~2,2 s, `no-store`, `version` đúng giá trị build-arg; mount tmpfs thuộc root được entrypoint giao cho `node`. Guard matrix: đổi tên tạm một suite → đỏ nêu cả hai tên tệp (đã trả lại).

Việc của người vận hành trước khi merge: tạo variable `VPS_SMOKE_URL`; cấp quyền Admin cho repo ở *Manage Actions access* của package GHCR; tuỳ chọn tạo check ping và ghi `HEALTHCHECK_PING_URL` vào `.env` trên VPS; theo dõi lượt deploy đầu (dump, smoke, dọn image).

Còn mở (1D):
- ~~`stopBackupScheduler` (`server/services/backup-scheduler.ts`) chỉ xoá `setInterval`, không xoá `setTimeout` khởi động 120 s: tắt trong 2 phút đầu sau khi boot thì tick khởi động vẫn có thể chạy trong lúc Nitro đang drain. Tệp đó thuộc 1B (D10) — sửa cùng đợt đó.~~ Đã đóng ở § 29.
- Đợt chuyển tiếp GHCR: image đẩy khi còn provenance nhiều khả năng có manifest con không thẻ (mặc định buildx — **chưa kiểm** được: `gh` thiếu `read:packages`; trang package hiện version `unknown/unknown` nếu đúng); nếu vậy, vài tuần đầu image cũ nhất còn giữ có thể không kéo lại được (VPS không cần — giữ 6 image cục bộ).

### 28. Wave 1 · nhóm 1A — Bảo mật (2026-10-23)

OpenSpec `wave1-quick-fixes`, quyết định D1–D7. Mỗi mục có test đỏ trên mã cũ (chạy handler/hàm THẬT, CSDL giả hoặc SQLite qua `MySqlDialect`).

**1. Đọc cài đặt không bao giờ trả bí mật đã lưu** (`server/api/admin/settings/index.get.ts`, `backup.get.ts`).
- Lỗi: `GET /api/admin/settings` trả **mọi** hàng `settings`, che bằng danh sách cấm 2 khoá (`r2_secret_key` chỉ che với người không phải SuperAdmin). Khoá thêm sau rò mặc định — và đã rò: `backup_drive_service_account` (JSON service account có `private_key`) tới mọi người có `settings.read`. `backup.get.ts` che khoá đó trừ SuperAdmin.
- Sửa: allowlist `SETTINGS_READ_KEYS` (export cạnh handler) = hợp các khoá 5 trang `general/email/media-storage/media-portal/tracking` đọc, đúng bằng `ALLOWED_SETTING_KEYS` của PUT. `r2_secret_key`, `smtp_pass` (và `backup_drive_service_account` ở `backup.get`) trả `********` (`MASKED_SECRET`) cho **mọi** vai trò khi có giá trị; rỗng vẫn rỗng. PUT vốn giữ giá trị cũ khi nhận dấu che (`backup.put.ts`, `index.put.ts`) — test round-trip giữ nguyên JSON.
- Test `tests/admin-settings-get-masking-behavior.test.ts`: biên tập viên + SuperAdmin, hai endpoint — không chuỗi con `private_key`/bí mật nào, khoá lạ/`backup_*`/`retention_*`/`media_video_r2_*`/`nav_menu_*` vắng, mọi khoá mỗi trang đọc (rút từ mã nguồn trang) có mặt, allowlist = khoá PUT nhận.
- Secret Key R2 **video** (`settings/media-portal.get.ts`): trước trả `••••` + 4 ký tự cuối — một mẩu của chính bí mật; nay `secretMasked` = `********` khi đã có bí mật (trong bảng, kể cả không giải mã được, hoặc từ biến môi trường), `''` khi chưa; `secretStored` giữ nguyên. Dòng audit đổi bí mật (`media-portal.put.ts`) cũng chỉ ghi `********`, không còn 4 ký tự cuối.
- Lưu lại dấu che giữ bí mật: lỗi thật tìm thấy khi làm mục này — gửi `videoR2SecretKey: "********"` lên `PUT settings/media-portal` **mã hoá chuỗi dấu che làm bí mật mới** (đè bí mật thật) và còn được tính là "đã nhập lại" nên mở khoá đổi Account ID/Bucket. Nay `isRetypedVideoSecret` (`shared/settings-credential-rules.ts`) coi rỗng/khoảng trắng/dấu che đều là "giữ nguyên" — dùng chung cho quy tắc đổi đích và bước mã hoá.
- Hệ quả giao diện: SuperAdmin cũng thấy `********` ở ô service account và Secret Key R2; nút "Dùng R2 của Media Storage" (`media-portal.vue`) không còn chép Secret Key (nhánh đó chỉ còn chép được dấu che) — toast nay nói mọi vai trò nhập tay Secret Key, bỏ câu sai "(chỉ SuperAdmin thấy sẵn)".
- Test thêm: `tests/media-portal-settings-get.test.ts` (dấu che, không 4 ký tự cuối, bí mật từ env), `tests/media-portal-r2-retarget.test.ts` (dấu che giữ bí mật, dấu che không mở khoá đổi đích, audit không lộ mẩu bí mật), guard mã nguồn `media-portal.vue`.

**2. Người nhận đơn chỉ lấy từ biểu mẫu đang hiện trên site** (`server/api/submissions.post.ts`, `server/api/public/pages/[slug].get.ts`).
- Lỗi: allowlist người nhận đọc cả `draft_blocks`, node ẩn, và hàng phẳng `page_blocks` cũ của trang đã xuất bản dạng cây. Biểu mẫu công khai gửi kèm `recipientEmail` của block (JSON công khai lộ địa chỉ) → địa chỉ cài trong bản nháp chưa ai duyệt được chấp nhận.
- Sửa: cùng luật với lượt đọc công khai — trang có cây xuất bản (mảng không rỗng): chỉ node hiện (node ẩn kéo cả cây con); trang không có cây (`NULL` **hoặc `[]`**, như `pages/[slug]`): hàng phẳng `is_visible`. Truy vấn chỉ lấy `id` + `published_blocks`, hàng phẳng lọc theo trang + loại block + hiện. `pages/[slug]` bỏ `recipientEmail` (đệ quy, cả `data.translations[*]`) khỏi JSON công khai — không xoá khỏi CSDL.
- Hệ quả: biểu mẫu công khai không còn biết địa chỉ nên gửi rỗng → `resolveSubmissionRecipient` dùng địa chỉ duy nhất đã cấu hình, hoặc `settings.email`. **Từ 2 địa chỉ nhận khác nhau trở lên trên các biểu mẫu đang hiện, mọi đơn về `settings.email`** (trước đây mỗi biểu mẫu tự chọn địa chỉ của nó). Đo 2026-10 trên CSDL chạy thật chưa block nào cấu hình `recipientEmail`. Muốn định tuyến nhiều đơn vị: gửi định danh block thay vì địa chỉ (việc sau).
- Test `tests/submission-recipient-published-only.test.ts` (SQLite, WHERE thật): chỉ trong nháp, node ẩn + cây con ẩn, hàng phẳng cũ của trang cây, biểu mẫu xuất bản duy nhất vẫn nhận, trang `NULL`/`[]` dùng hàng phẳng hiện, truy vấn không chiếu `draft_blocks`, JSON công khai không có `recipientEmail`.

**3. Một chính sách liên kết cho block và điều hướng** (`shared/link-policy.ts` mới).
- Lỗi: trường liên kết block (`links[].url`, nút hero/CTA/văn bản) nhận `javascript:` → XSS lưu trữ khi khách/cán bộ bấm. `navigation.put.ts` nhận mọi chuỗi bắt đầu bằng `/`, kể cả `//host`.
- Chính sách: chỉ `/đường-dẫn` (không `//`, không `/\`), `#…`, `http:`, `https:`, `mailto:`, `tel:`; quyết định trên bản chuẩn hoá (giải mã entity kể cả `&#106` không `;`, số đệm 0 dài bao nhiêu cũng được — `/&#0000000047;evil.com` là `//evil.com` — `&colon;`, `&Tab;`, `&NewLine;`, lặp tới khi ổn định, quá 8 lượt vẫn đổi → từ chối; bỏ ký tự điều khiển + khoảng trắng; chữ thường), lưu/hiện nguyên giá trị đã nhập. `shared/` không import `server/` nên có bộ giải mã entity riêng; test ép nó khớp `decodeHtmlEntities` ở mọi dạng cả hai cùng biết.
- Ghi: `normalizeBlocks` (`page-versions.ts`, mọi đường nháp/xuất bản/lưu-khôi phục phiên bản) trả **400 nêu tên trường** (`links[1].url`, `translations.en.btnLink`) cho trường `type: 'url'` của registry, kể cả cột `url` của mảng; trường `type: 'image'` (gallery/image `url`) ngoài phạm vi. Ngoại lệ có tên: ảnh chụp cây **đang live** lúc xuất bản (`publish.post.ts`, `links: 'keep'`) — nếu không, một liên kết cũ trong cây cũ chặn mãi lượt xuất bản sửa nó. `navigation.put.ts` (khoá `nav_menu`) trả 400 nêu `menu[i].url`/`menu[i].children[j].url` thay vì lặng lẽ bỏ mục.
- Đọc: `pages/[slug]` thay liên kết không an toàn của hàng cũ bằng chuỗi rỗng (cây + hàng phẳng + bản dịch); `parseNavConfig`/`parseBottomNavConfig` bỏ mục có URL không an toàn.
- Hiển thị: `LinksBlock.vue`, `HeroBlock.vue` buộc `href`/`to` qua `safeLinkOrNull`.
- Test `tests/security-block-link-schemes.test.ts` + mở rộng `tests/nav-config-boundary.test.ts`.
- Điều hướng trang quản trị thật sự gọi: `settings/navigation/navbar.put.ts` (`nav_menu_navbar`) và `navigation/mobile.put.ts` (`nav_menu_mobile`) — trước kiểm tiền tố (nhận `//host`, lặng lẽ bỏ mục sai, bỏ cả `mailto:`/`tel:`). Nay cả hai trả 400 nêu `menu[i].url` / `menu[i].children[j].url`, không lưu gì; thanh tab dưới chỉ kiểm và lưu URL của tab `link` (`chatbot`/`drawer` luôn lưu `''`).
- Hai endpoint ghi block phẳng (`pages/[id]/blocks/index.post.ts`, `[blockId].put.ts` — không giao diện nào gọi nhưng mở cho `pages.create`/`pages.update`): cùng `assertSafeBlockLinks`, theo loại block gửi lên (tạo) hoặc loại đã lưu (sửa) → 400 nêu tên trường, không ghi.

**4. Đăng xuất reader thu hồi phiên** (`server/api/public/reader/logout.post.ts`): có reader hợp lệ → `token_version = token_version + 1` (cột lệnh cấm đã tăng) rồi xoá cookie; không có phiên → chỉ xoá cookie, không ghi gì. Lỗi ghi → log `reader_auth.logout_token_invalidation_failed`, cookie vẫn xoá. Test thêm vào `tests/reader-session-boundary.test.ts` (handler + `optionalReader` thật trên SQLite).

**5. Một luật cờ `Secure` cho 4 nơi đặt cookie** (`server/utils/request-secure.ts` mới, `isSecureRequest`): `mfa/session.ts` (`cdkt_admin`, `cdkt_mfa`), `reader-auth.ts` (`cdkt_reader`), `auth/google/start.get.ts`, `admin/backup/drive/start.get.ts`.
- Lỗi: mỗi nơi tự đọc `x-forwarded-proto === 'https'` từ **mọi** peer, hoặc `getRequestURL().protocol` — mà h3 cũng suy từ chính header đó. Production sau proxy không gửi header → cookie phiên thiếu `Secure`; client nối thẳng tự khai `https` được.
- Luật: socket TLS → Secure; `x-forwarded-proto` chỉ tính khi peer là proxy đã khai (`peerIsTrustedProxy`, thêm vào `client-ip.ts` — tệp duy nhất được đọc peer thô), lấy hop trái nhất; không có tín hiệu: production → Secure, dev → không. Chỉ proxy tin cậy nói `http` mới tắt Secure ở production.
- Test `tests/cookie-secure-flag-behavior.test.ts` chạy 5 bộ ghi cookie thật × 8 kịch bản.

**6. Email trả lời chỉ gửi sau kiểm duyệt; tiêu đề trung tính** (`server/services/comments.ts`, `notification-email.ts`).
- Lỗi: `createComment` gửi email trả lời **trước**, rồi mới `void checkAndModerateContent` — trả lời bị ẩn một giây sau vẫn đã nằm trong hộp thư; tiêu đề `"[…] <tên reader tự đặt> đã trả lời…"` cho phép đóng giả "Ban quản trị". `void` còn để lỗi kiểm duyệt thành unhandled rejection.
- Sửa: kiểm duyệt chạy đúng một lần mỗi bình luận, **sau commit và không chặn phản hồi** (D6: "chỉ email phải chờ") — `POST` trả lời trả về ngay khi bình luận + thông báo trong cổng đã lưu. Với trả lời có người nhận, `createComment` dựng ngay tại chỗ một chuỗi nền (hàm `async` tự gọi, đăng ký `event.waitUntil`, bọc `try/catch` toàn phần — mọi lỗi thành log `comment.reply_email_failed`, không bao giờ reject): `await` chính lời hứa kiểm duyệt rồi mới `sendReplyEmail`. Không có hẹn giờ riêng — giới hạn là timeout có sẵn của gateway AI (~35 s, `ai-gateway.ts`), hết giờ thì gateway trả lỗi → `aiFailed`; một hẹn giờ 10 s đặt chồng lên (bản đầu) chỉ làm rơi email của trả lời sạch mà model chấm trong 10–35 s, và email đã giữ không bao giờ được gửi lại. Giữ email (log `comment.reply_email_held` `{ reason }`) khi: phán quyết `auto_hide`/`block` (kể cả khi lệnh ẩn hỏng) → `moderation_hidden`; AI được hỏi mà không trả lời dùng được (kể cả quá giờ gateway) → `moderation_ai_failed` (+ `aiFailure`); kiểm duyệt ném lỗi → `moderation_error`. `flag_only` (AI chưa cấu hình, chờ người duyệt, vẫn hiện) vẫn gửi. Tiêu đề reader: cố định `[Con Đường Hướng Thiện] Có người trả lời bình luận của bạn`; tên vẫn ở thân thư (đã escape). Tiêu đề trả lời của cán bộ giữ nguyên.
- Tín hiệu lỗi kiểm duyệt (`moderation-worker.ts`): `ModerationCheckOutput` thêm `aiFailed: true` + `aiFailure` (mã lỗi gateway khác "chưa cấu hình", `empty_response`, `parse_error`, `unrecognised_verdict`, `exception`). Trước đây những trường hợp đó trả **y hệt** phán quyết "safe" (`allow`). Trường mới chỉ báo — không đổi `flagged`/`action`/hàng chờ/ẩn ở bất kỳ nơi gọi nào (lượt quét lại bỏ qua nó).
- Test `tests/comment-email-after-moderation.test.ts` (`createComment` + `createReplyNotification` + `sendReplyEmail` thật: handler trả về trước khi kiểm duyệt xong, email chỉ sau phán quyết sạch, phán quyết sạch sau 30 s vẫn gửi, giữ khi ẩn/lỗi/`aiFailed` kể cả lỗi gateway sau 35 s) + `tests/moderation-worker-behavior.test.ts` (sáu dạng lỗi AI → cùng phán quyết `allow`, có `aiFailed`; safe/violation/chưa cấu hình/chặn tức thì → không có).

**7. Tên hiển thị reader không giả danh cán bộ** (`server/utils/display-name.ts`, chỉ tên reader tự đặt — `validateDisplayName` ở `profile.put.ts`).
- Gấp: NFKC → NFD bỏ `\p{Mn}`/`\p{Cf}` → `đ/Đ`→`d` → chữ thường → mọi chuỗi không phải chữ/số thành một khoảng trắng. Từ chối khi bằng một tên dành riêng, bắt đầu/kết thúc bằng nó như một từ riêng, hoặc bằng nó khi bỏ hết khoảng trắng (`A.D.M.I.N`, `C-11`). Danh sách `RESERVED_DISPLAY_NAMES`: ban quan tri, quan tri vien, ban bien tap, admin, administrator, moderator, c11, bo cong an, con duong huong thien ("cong an" một mình KHÔNG — "Nguyễn Công An" là tên người). Mọi ký tự `\p{Cf}` (rộng 0, điều khiển hướng chữ, soft hyphen) trong chuỗi thô → từ chối. Tên Google không áp (khoá người thật ra ngoài) — wave2.
- Test mở rộng `tests/reader-profile.test.ts` (chính xác, hoa/thường/dấu/toàn khổ/dấu câu, đầu/cuối, rộng 0 + bidi, "Nguyễn Văn Adminh" vẫn nhận).

**Phụ: E2E dùng `http://localhost:3123`** (`tests/e2e/harness.ts`, trước là `127.0.0.1`). Bản build production nay đặt `Secure` cho cookie phiên; Chromium giữ cookie Secure qua HTTP trên cả hai tên loopback, nhưng `page.request` của Playwright chỉ gửi nó tới `localhost`/`*.localhost` (`isLocalHostname`) — lượt chạy với `127.0.0.1` có 9 spec 401 ở mọi lời gọi API sau khi đăng nhập bằng trình duyệt. Máy chủ E2E vẫn chỉ bind `127.0.0.1`.

Triển khai: nginx mẫu gửi `X-Forwarded-Proto $scheme` và `manage.sh` đặt `TRUSTED_PROXY_IPS=172.16.0.0/12`, nên production sau nginx giữ hành vi đúng cả HTTPS lẫn HTTP. Một bản production **không** khai `TRUSTED_PROXY_IPS` mà phục vụ qua HTTP thường (không TLS, không phải loopback) nay đặt cookie Secure → đăng nhập admin qua HTTP không giữ được phiên — đúng spec (`session-cookies`).

Còn mở (quyết định sản phẩm, không phải mã): định tuyến đơn theo định danh block khi có ≥ 2 địa chỉ nhận — xem mục 2.

#### Kiểm chứng (2026-10-23, worktree `wave1/1a-security`)
`npm test` 4010 / 3984 pass / 0 fail / 26 skip. Typecheck 0 lỗi. eslint 0 error / 16 warning (không tệp nào đổi có cảnh báo). E2E (build production, cổng 3123) 88/88 trong 3,9 phút; sau lượt chạy cổng 3123 trống, không còn DB `cdkt_e2e_*`. `notification-email-integration` trên MySQL dev (email trả lời chạy nền sau kiểm duyệt) 1/1, không còn DB `cdkt_notif_mail_*`.

### 29. Wave 1 · 1B — Toàn vẹn dữ liệu (2026-10-23)

Đợt thứ ba của `openspec/changes/wave1-quick-fixes` (D8, D10–D15). Số mục giả định 1A (§ 28) merge trước theo thứ tự 1D → 1A → 1B.

- **Dọn analytics thật sự chạy** (D8, `server/services/analytics-maintenance.ts`). Lệnh dọn sự kiện thô là `DELETE e FROM … INNER JOIN analytics_maintenance_runs … LIMIT ?`, và MySQL từ chối LIMIT trên DELETE nhiều bảng (lỗi 1064). Lỗi bị nuốt, và một `try` chung còn bỏ luôn việc dọn 5 bảng theo ngày. Kết quả: từ khi có tính năng này, không bảng analytics nào được dọn, còn test fake-pool (khớp chữ SQL) vẫn xanh. Nay lệnh là DELETE một bảng: `… WHERE occurred_at < ? AND event_day IN (SELECT day FROM analytics_maintenance_runs WHERE status = 'complete') LIMIT ?`. Mỗi bước dọn (thô, 5 bảng ngày, live, dedup, NOC) chạy riêng qua `purgeStep`; bước hỏng ghi một dòng `analytics.retention_step_failed` `{ step, code }` (mã lỗi driver, không ghi message). `analytics_maintenance_runs` được dọn sau cùng, vì lệnh dọn thô đọc nó.
- **Scheduler sao lưu theo đúng lịch** (D10, `server/services/backup-scheduler.ts`):
  - **Khe chạy:** khe là ngày đã chọn lúc `hour` giờ (giờ địa phương, 0–23; `0` hợp lệ, giá trị sai → 3). Khe được phục vụ khi một lượt theo lịch thành công bắt đầu từ khe trở đi. Hàm thuần `isBackupDue` có test dạng bảng (34 ca).
  - **Trạng thái bền, không suy từ hàng `backups`:** kết quả của khe nằm ở khoá settings `backup_scheduler_state` (JSON `{ slot, attempts, lastAttemptAt, outcome, lastDoneAt, schedule }`, nhóm `internal`, không có trong `ALLOWED_SETTING_KEYS`).
    - **Vì sao không suy từ hàng `backups`:** bản đầu của đợt này suy kết quả từ hàng `backups`, và lượt kiểm chứng độc lập tìm ra lỗi nghiêm trọng. Xoay vòng xoá hàng của mọi trigger, nên vài bản sao lưu tay trong tuần (hoặc 12 bản `pre-*` SQL, hoặc `backup_keep_count` 4–5 với một bản tay) đủ xoá hàng SQL của lượt Chủ nhật. Lịch hằng tuần khi đó chạy sao lưu toàn bộ vào thứ Tư, lặp ba lần rồi báo "bỏ khe" sai.
    - **Khi nào bản ghi được viết:** khi một lượt **bắt đầu**. Đó là lúc `RunBackupOptions.onStarted` được gọi, trong khoá chạy và trước mọi việc. Nhờ vậy, hỏng ở `mkdir`/đọc cấu hình vẫn là một lượt, còn bị từ chối vì khoá bận thì không. Bản ghi được viết lại khi lượt kết thúc (`done`/`failed`) và khi bỏ khe. Bản ghi còn `running` (lượt bị giết giữa chừng) tính là một lượt hỏng.
  - **Thử lại:** sau 60 phút, tối đa 3 lượt mỗi khe, rồi bỏ khe (`outcome: 'abandoned'`) và log `backup.slot_abandoned` một lần.
  - **Bù khe lỡ:** bù một lần, và chỉ khi khe đó thật sự bị lỡ **vì máy chủ tắt**. Phải đủ ba điều kiện:
    1. Khe rơi trước lúc tiến trình này khởi động scheduler (mốc giữ trong bộ nhớ).
    2. Lịch hiện tại trùng lịch mà lượt gần nhất đã phục vụ (`schedule` trong bản ghi, ghi lúc lượt bắt đầu).
    3. `lastAttemptAt` nằm trong 8 ngày trước khe.

    Lượt kiểm chứng lại chỉ ra bản trước (chỉ có điều kiện 3) bù cả "khe" mà một lần **sửa lịch** tạo ra:
    - Đổi giờ 03 → 10 thì 09:00 hôm sau chạy bù, rồi 10:05 chạy tiếp.
    - Thêm thứ Tư vào lịch Chủ nhật thì thứ Năm chạy bù.
    - Bật lại công tắc trong 8 ngày thì chạy bù ngay.

    Nay cả ba trường hợp đều đợi khe kế tiếp. Bật công tắc lần đầu cũng đợi khe kế tiếp. Bản cũ chạy hễ lượt trước cũ hơn 36 giờ (cả ngày không có trong lịch), đọc giờ `0` thành 3, và coi lượt hỏng là đã xong.
  - **Chống chồng lượt:** tick đang chạy thì tick sau không mở lượt thứ hai. Sau khi lượt đã ghi `running`, chính bản ghi cũng chặn.
  - **Dừng:** `stopBackupScheduler` xoá cả tick khởi động 120 s (mục "Còn mở" của § 27) và lượt dọn rác lúc khởi động.
  - **Khôi phục CSDL giữ trạng thái scheduler của hệ thống đang chạy** (`keepSchedulerStateAcrossRestore`, `backup-restore.ts`, cùng khuôn `reattachBackupRows`). Bản dump của lượt theo lịch chứa chính lượt đó ở trạng thái `running`. Khôi phục nó vào thứ Tư thì khe Chủ nhật đã xong trông như bị cắt ngang, và scheduler chạy lại ngay, ngoài lịch. Nay giá trị đọc trước khi khôi phục được ghi lại trong transaction audit. Trước đó không có giá trị nào thì bản ghi của bản dump bị xoá.
  - **Khởi động ở production:** plugin dùng `backupSchedulerEnabledByServer` (`server/utils/backup-scheduler-switch.ts`, không import gì, để route admin nạp mà không kéo theo `services/backup.ts`) và khởi động scheduler ở production trừ khi `BACKUP_SCHEDULER` là `0`/`false`/`off`/`no`. Dev giữ mặc định tắt. Công tắc admin `backup_auto_enabled` (mặc định tắt) vẫn quyết định có bản sao lưu hay không.
  - **Trang cài đặt:** `GET /api/admin/settings/backup` trả thêm `schedulerDisabledByServer` (ngoài `settings`, nên biểu mẫu không bao giờ PUT nó). `BackupSettingsPanel.vue` hiện một dòng báo khi cờ này bật. Chú thích compose đã sửa.
- **Không còn archive mồ côi** (D11, `server/services/backup.ts`). Trước đây cả hai archive được nén xong rồi mới ghi hàng, và nhánh lỗi ghi cứng `cdkt-media-…`. Khi media hỏng, archive uploads đã nén nằm lại không có hàng nào (danh sách admin và xoay vòng đều không thấy). Khi uploads hỏng, hàng `failed` lại nêu tên media.
  - Nay mỗi dump/archive ghi dưới `<tên>.partial` rồi được kiểm (tệp thường, khác 0 byte). Nó chỉ nhận tên thật **trong** transaction ghi hàng `done` + audit. Đổi tên hỏng thì không có hàng; commit hỏng sau khi đổi tên thì tệp bị trả về `.partial`.
  - Hỏng ở bất kỳ bước nào thì xoá mọi `.partial` của lượt. Hàng `failed` nêu đúng tệp của bước đã ném. Lỗi ghi hàng `failed` được log `backup.failed_row_unwritten` và không che lỗi gốc.
  - **Lượt bị giết giữa chừng** (SIGKILL, hết `stop_grace_period`) chỉ để lại `cdkt-*.partial`. Tệp này bị dọn khi giữ được khoá chạy, tức không lượt nào đang ghi: ở đầu mỗi lượt sao lưu, và một lần sau khởi động 60 s (`sweepStaleBackupFiles`, plugin; khoá bận thì bỏ qua). Lượt dọn lúc khởi động **chỉ chạy khi máy chủ bật scheduler**. Trước khi merge, lượt kiểm tích hợp chỉ ra rằng E2E và dev chạy với cwd = bản checkout và một CSDL mới (bảng `backups` rỗng). Khi đó lượt dọn lúc khởi động sẽ coi mọi bản sao lưu cục bộ trong `./backups` là mồ côi và xoá: một checkout có 36 tệp như vậy.
    - **Sửa:** thêm `CDKT_BACKUPS_DIR`, chỉ dùng cho test và dev. `backupsDir()` đọc biến này và là nơi duy nhất dựng đường dẫn; có guard grep. Production không đặt biến này, không có trong compose; mặc định là `<cwd>/backups` = `/app/backups`.
    - **E2E** (`tests/e2e/global-setup.ts`): mỗi lượt có một thư mục tạm riêng, xoá trên mọi lối ra, và đặt `BACKUP_SCHEDULER=0`.
    - **Test:** `tests/backup-dir-isolation.test.ts`.
    - **Bị giết đúng giữa lúc đổi tên và commit:** tệp đã mang tên thật nhưng không có hàng. Cùng lượt dọn xoá tệp mang **đúng tên cuối cùng của app** mà không có hàng nào trong `backups` và cũ hơn 10 phút. Mốc 10 phút có vì khôi phục từ tệp tải lên đổi tên tệp rồi mới ghi hàng, và nó giữ khoá khôi phục, không phải khoá chạy. Không đọc được bảng `backups` thì không xoá tệp tên thật nào. Log `backup.orphan_swept` `{ filename }`. Lượt dọn không đụng tệp đã đăng ký, `.upload-*.partial` (khôi phục từ tệp tải lên, giữ khoá khôi phục), hay tệp của `scripts/backup*.sh`. Log `backup.partial_swept` `{ count }`.
    - **Mẫu chỉ khớp đúng tên app tự sinh** (`cdkt-<stamp>-<trigger>.sql.gz.partial`, `cdkt-(uploads|media)-<stamp>-<trigger>.tar.gz.partial`, `trigger` ∈ `BACKUP_TRIGGERS`). Sau khi rebase lên 1D, `scripts/backup-db.sh` (cron hằng đêm) cũng ghi `cdkt-<db>-<stamp>-<pid>.sql.gz.partial` vào **cùng** `./backups`. Khoá chạy của app không nói gì về script đó, nên mẫu cũ `cdkt-*.partial` sẽ xoá bản dump đang chạy của cron. Mẫu mới không khớp tên đó (test: tệp `.partial` của `backup-db.sh` và một tên `cdkt-media-<stamp>-<pid>` còn nguyên; mọi trigger đều bị dọn).
  - **Tên trùng** (hai lượt cùng trigger trong cùng một giây có cùng `stamp`): lượt sau **từ chối trước khi ghi** (`BackupNameCollisionError`, log `backup.name_collision`), không ghi tệp và không ghi hàng nào. Ở `POST /api/admin/backup/run`, lỗi này trả **409** (như khoá bận; cả hai giờ phân biệt bằng kiểu lỗi, không so chuỗi), không phải 500 (`tests/backup-run-endpoint.test.ts`). Bản trước của đợt này ghi đè nội dung bản đã đăng ký. Còn một hàng `failed` cùng tên thì bấm "xoá" hàng đó sẽ xoá luôn tệp tốt.
    - **Kiểm cả hàng, không chỉ đĩa:** một lượt hỏng xoá tệp của nó nhưng để lại hàng `failed` mang đúng tên đó. Lượt sau cùng giây khi đó thấy đĩa trống, ghi thêm hàng `done` cùng tên, và xoá theo tên sẽ xoá cả hai hàng lẫn tệp tốt (lượt kiểm chứng lại tái hiện trên MySQL thật). Nay `begin` từ chối khi có hàng bất kỳ trạng thái mang tên đó.
    - **Xoá theo id:** `deleteBackup` xoá **một** hàng theo id (trang admin gửi `?id=`). Tệp chỉ bị xoá khi không còn hàng nào khác trỏ tới. Không có id (giao diện cũ trong bộ nhớ đệm): đúng một hàng thì xoá, nhiều hàng thì 409. Id không thuộc tên đó thì 404; id sai dạng thì 400.
  - **Xoay vòng hỏng không làm hỏng lượt:** mọi tệp đã có hàng `done` rồi mới xoay vòng. Lỗi lúc đó (CSDL chập chờn) giờ chỉ log `backup.rotate_failed`. Trước đây nó ném ra, biến một bản đã đăng ký thành lượt hỏng, và scheduler chạy lại cả lượt đầy đủ.
  - Nguồn nén là `defaultArchiveSources()`. `RunBackupOptions.archiveSources` chỉ để kiểm thử thay bằng thư mục tạm; đường dẫn cứng `/var/lib/cdkt` không đổi.
- **Tải backup bằng stream** (D12, `server/api/admin/backup/[filename].get.ts`). Bản cũ dùng `readFile`, hỏng với tệp > 2 GiB và tốn RAM bằng kích thước tệp. Nay: `lstat` → chỉ tệp thường (thư mục, symlink, tệp không có → 404). Header `Content-Length` + `Content-Disposition` RFC 5987 (`filename*=UTF-8''…`, mã hoá cả `'()*`). Trả `sendStream(createReadStream)`, và huỷ stream khi **phản hồi** đóng (h3 chỉ gọi `stream.abort`; `req` `close` phát sớm từ Node 16). Thư mục lấy từ `backupsDir()` mỗi request. Có guard tĩnh: không `readFile` dưới `server/api/admin/backup/`.
- **Chat livestream không xoá cứng tin AI ẩn** (D13). Đã bỏ `db.delete(livestreamMessages)` chạy song song với `applyAutoHide` (vốn đã đánh dấu `is_deleted = 1`). Hàng còn lại làm bằng chứng cho hàng chờ duyệt; người xem vẫn nhận sự kiện gỡ.
- **Seed không ghi đè thứ tự `home_sections`** (D14). Upsert đổi sang `keepExisting('id')` (no-op). Guard mới `tests/seed-upsert-no-overwrite.test.ts` chặn **mọi** upsert trong `seed.ts` ghi giá trị lên hàng đã có (mục "Còn mở" của § 26 về `home_sections`).
- **`npm run db:decode-excerpts`** (D15, `server/services/stored-plaintext-decode.ts`, `scripts/decode-stored-excerpts.ts`).
  - **Khuôn và ngữ nghĩa:** cùng khuôn `db:sanitize-html`. Giải mã `title`/`excerpt` của `articles` + `article_translations` theo đúng `plainTextField` (kể cả sửa entity cụt khi chuỗi ở dạng mã hoá). Mặc định xem trước; `--apply` mới ghi. Đọc theo lô 200 theo `id`.
  - **Cách ghi:** UPDATE gán `updated_at = updated_at` và kèm điều kiện "giá trị vẫn như lúc đọc", nên bản vừa được biên tập viên sửa bị bỏ qua (`skipped`). Không bao giờ đọc hay ghi `content`.
  - **Phạm vi:** chỉ hàng có `&` mà phép giải mã thật sự đổi. Khác biệt chỉ do khoảng trắng hai đầu không tính, và `R&D`/`Q&A` để nguyên.
  - **Báo cáo:** `fragments` liệt kê mọi trường mà kết quả bỏ một đoạn cuối (id, trường, phần cuối trước/sau; ca `AT&T` cũng nằm đây). `unstable` liệt kê, **không ghi**, chữ entity viết nguyên văn (`&amp;agrave;`), loại sẽ bị giải mã thêm lúc đọc.
- **Test** (viết trước, chạy trên mã cũ). Đỏ vì đúng lỗi được sửa: `analytics-maintenance-retention` (5/13), `analytics-maintenance-integration` (`warning` thay vì `success`), `backup-orphan-archives` (5/6; ca uploads hỏng trước nêu tên media và để lại tệp dở), `backup-access` (4 ca stream + guard `readFile`), `livestream-chat` (có `delete from`), `seed-upsert-no-overwrite`, `backup-scheduler-notice-ui`. Lưu ý:
    - `backup-scheduler-due` chỉ đỏ vì thiếu module: `isBackupDue` cũ khác chữ ký, nên không khẳng định nào chạy được trên ngữ nghĩa cũ.
    - `stored-plaintext-decode` đỏ vì module chưa có.
    - Ca thư mục/symlink của `backup-access` qua "trống" trên mã cũ, vì handler cũ cố định thư mục lúc import.
  - **Sau lượt kiểm chứng độc lập** (bản ghi trạng thái, `.partial`, tên trùng), chạy trên commit `e0dbaca`:
    - `backup-scheduler-due` đỏ 37/45. Gồm cả 4 kịch bản xoay vòng của người kiểm chứng: xoay vòng thật bằng `selectRotationVictims` rồi tick, kết quả "a backup ran outside the policy", 3 lượt thay vì 2.
    - `backup-orphan-archives` đỏ 5/12: ghi `.partial`, dọn lúc bắt đầu lượt, `sweepPartialBackups` (nay là `sweepStaleBackupFiles`), `onStarted` trước khi đọc cấu hình, tên trùng không bị ghi đè.
    - Ca "commit hỏng sau khi đổi tên" và "khoá bận không gọi `onStarted`" xanh trên mã cũ, vì mã cũ không đổi tên và không có `onStarted`. Chúng canh đường mới.
    - Ca chống chồng tick xanh trên mã cũ (guard đã có từ trước). Bỏ tạm guard thì nó đỏ ("the second tick started a second backup"), trả lại thì xanh.
  - **Sau lượt kiểm chứng lại** (`278c5b6`), chạy trên chính commit đó:
    - `backup-scheduler-due` đỏ 11/57: sửa giờ (có/không deploy xen giữa), thêm ngày, đổi ngày, bật lại công tắc, "khe rơi sau lúc khởi động", `schedule` trong bản ghi, và hai ca tick.
    - Ca S5 ("dừng thì huỷ lượt dọn lúc khởi động") xanh trên mã cũ, vì phần huỷ đã có. Bỏ tạm `clearTimeout` thì nó đỏ.
    - `backup-orphan-archives` đỏ 8/19. Trong đó có lượt cùng giây sau một lượt hỏng (lượt thứ hai không bị từ chối), xoá theo id (3 ca), tệp tên-app không có hàng (2 ca), và lỗi xoay vòng làm hỏng lượt.
    - `backup-access` đỏ 3: id từ query, ánh xạ 404/409, trang admin gửi `?id=`.
    - `backup-restore-hardening` đỏ 2: bản ghi `running` của bản dump đè bản ghi đang chạy, hoặc còn lại khi trước đó không có.
  - `analytics-maintenance-retention`: fake pool từ chối DELETE nhiều bảng + LIMIT ở mọi câu; thêm 5 ca: lệnh một bảng, bước hỏng vẫn chạy bước khác, log `step`/`code`.
  - Mới:
    - `analytics-maintenance-integration`: MySQL thật, `initDb()`. Thô cũ đã tổng hợp → xoá; thô cũ chưa tổng hợp/run `failed` → giữ; thô gần → giữ; bảng ngày quá hạn → xoá; lượt 2 không xoá gì. Có trong matrix CI, nay 19 job.
    - `backup-scheduler-due` (45; tick chạy trên settings giả có upsert).
    - `backup-scheduler-notice-ui` (handler thật + render SFC).
    - `backup-orphan-archives` (`runBackup` thật, tar/mysqldump giả, tệp thật).
    - `seed-upsert-no-overwrite`.
    - `stored-plaintext-decode`: driver `drizzle-orm/mysql2` thật trên pool giả chạy SQL bằng `node:sqlite`, giả lập `ON UPDATE CURRENT_TIMESTAMP`, có ca tự kiểm.
  - Mở rộng: `backup-access` (+5), `livestream-chat` (+1).

#### Kiểm chứng (2026-10-23)
`npm test` 4125 / 4098 pass / 0 fail / 27 skip (sau bản sửa của lượt kiểm chứng, rebase lên 1D `8be4766`, mẫu dọn `.partial` chỉ khớp tên của app, 409 cho tên trùng, các bản sửa của lượt kiểm chứng lại và thư mục backup tách cho test/dev; trên `d3c3073`: 4075 / 4048, trước bản sửa 4055 / 4028). Typecheck 0 lỗi. eslint 0 error / 16 warning (như trước). `db:drift` 62 bảng / 635 cột. Suite mới trên MySQL dev (cổng 33069): mã cũ đỏ (`warning`), bản vá xanh; không còn CSDL `cdkt_analytics_maint_*`. Guard matrix: bỏ mục matrix → đỏ nêu tên tệp. E2E 88/88 (3,6 phút, build production của nhánh): tiến trình server E2E có `BACKUP_SCHEDULER=0` và `CDKT_BACKUPS_DIR=/tmp/cdkt-e2e-backups-…` (đọc từ `/proc/<pid>/environ`); thư mục tạm bị xoá khi xong, không có `./backups` nào được tạo trong bản checkout, cổng 3123 đã trả, không còn CSDL `cdkt_e2e_*`. `npm run db:decode-excerpts` (chỉ xem trước) trên CSDL dev: 1132 bài, 17 sẽ đổi, 5 `fragments` (đúng 5 sapo bị cắt giữa entity ở § 23: `nh&ac`, `ph&og`, `l&atild`, `c&oac`, `l&`), 0 `unstable`; 24 bản dịch, 0 đổi.

Việc của người vận hành:
- **Trước khi deploy:** mở `/admin/settings/backup`. Nếu "Backup tự động theo lịch" đã bật từ trước, sao lưu bắt đầu ở khe kế tiếp sau deploy; kiểm dung lượng đĩa hoặc tắt công tắc trước.
- **Trước khi deploy:** lượt dọn lúc khởi động sẽ xoá các archive mồ côi mà lỗi cũ (D11) để lại trong `./backups`, tức tệp tên-app không có hàng trong danh sách. Muốn giữ thì chép chúng ra ngoài `./backups` trước.
- **Sau khi deploy:** `db:decode-excerpts` theo thứ tự xem trước → đọc `fragments` → sao lưu → `-- --apply` (`production/README.md`).
- Vài đêm đầu lượt bảo trì analytics báo `warning` khi dọn phần tồn đọng theo lô có trần. Đó là dự kiến.

Còn mở / lệch có chủ đích (1B):
- **Bỏ khe sau 3 lượt hỏng** (lượt đầu + 2 lần thử lại), theo design D10. Spec viết "thử lại tối đa 3 lần".
- **Thời gian chờ thử lại tính từ lúc lượt hỏng BẮT ĐẦU** (`lastAttemptAt`), không từ lúc nó hỏng (design D10 viết "60 phút kể từ lần hỏng"). Các lượt cách nhau ≥ 60 phút tính theo giờ bắt đầu, đúng spec. Nhưng một archive chạy 40 phút rồi hỏng sẽ được thử lại khoảng 20 phút sau khi hỏng.
- **Bù khe lỡ — phần còn lại sau khi siết** (đã thu hẹp từ "bật lại trong 8 ngày là bù ngay"):
  - Server tắt liền hơn 8 ngày thì không bù, đợi khe kế tiếp.
  - Khe trôi qua lúc máy chủ chạy nhưng CSDL hỏng (scheduler đọc như "tắt") thì không bù.
  - Còn một ca hẹp vẫn bù ngay: công tắc tắt đúng lúc khe, máy chủ khởi động lại **sau** khe đó, rồi công tắc bật lại với lịch không đổi, trong 8 ngày.
- **Ghi bản ghi trạng thái hỏng sau một lượt thành công** (CSDL chập chờn đúng lúc đó): bản ghi còn `running`, nên khe được thử lại sau 60 phút, thêm một bản sao lưu thừa. Log `backup.scheduler_state_unwritten`.
- **Bản ghi trạng thái không có hàng nào khi mới deploy**, nên coi như chưa có lịch sử: khe đầu tiên chạy đúng giờ, không bù.
- **Đường dẫn media của sao lưu:** `backup.ts`/`backup-restore.ts` vẫn ghi cứng `/var/lib/cdkt` cho cây media, không theo `CDKT_MEDIA_WORKDIR`.
- **Tệp tên-app không có hàng sẽ bị xoá** (sau 10 phút, dưới khoá chạy). Đừng chép tay một tệp `cdkt-<stamp>-<trigger>.sql.gz` / `cdkt-(uploads|media)-<stamp>-<trigger>.tar.gz` vào `./backups` mà không có hàng. Muốn khôi phục một bản ngoài thì dùng "Khôi phục từ tệp tải lên": tệp mang tên trùng được đặt lại thành `…-upload-<stamp>`, có hàng, không bị dọn.
- **`.upload-*.partial` của một lượt khôi phục từ tệp tải lên bị cắt ngang** không bị dọn (nằm ngoài đợt này).

### 30. Wave 1 · nhóm 1C — Hiệu năng và giao diện công khai (2026-10-24)

OpenSpec `wave1-quick-fixes`, quyết định D9, D16–D25. Mỗi mục có test đỏ trên mã cũ. Đã đọc `openspec/ui-dna.md` trước mọi thay đổi giao diện.

**1. Dọn `rate_limit_counters` theo lô, trên timer riêng** (`server/utils/rate-limit-store.ts`, `server/services/rate-limit-purge-scheduler.ts` mới, `server/plugins/retention-scheduler.ts`).
- Lỗi: `purgeExpiredRateLimits` là câu lệnh CUỐI của `runDataRetention`, một `LIMIT 5000` mỗi đêm. Scope nào ném lỗi trước đó → bỏ qua; tắt "tự động dọn" trong admin → không bao giờ chạy. Lượt xem bài một khoá/(bài, khách, ngày) nên bảng chỉ phình.
- Sửa: lặp `DELETE … WHERE window_expires_at <= ? LIMIT 5000` tới khi một lô < 5000 hoặc đủ 10 lô (≤ 50 000 hàng/lượt, trả `{ deleted, batches, bounded }`). Chạy mỗi 10 phút (hoãn 90 s lúc khởi động, `unref`) dưới khoá tên riêng `cdkt:ratelimit:purge` (timeout 0), **không đọc chính sách dọn** (`autoEnabled`), cùng cổng bật/tắt `RETENTION_SCHEDULER` với timer dọn dữ liệu; `npm run analytics:maintenance` (cron) cũng chạy nó (đầu ra `rateLimits`). Chạy trên pool chung (`getPool()`, `+07:00`) — cùng mã hoá thời gian với nơi ghi; bản cũ chạy trên pool analytics `+00:00` nên dọn trễ 7 giờ. `runDataRetention` bỏ lượt dọn và trường `purgedRateLimits` (dòng audit của `retention-run.post.ts` cũng bỏ trường luôn bằng 0 đó).
- Test: `tests/rate-limit-store.test.ts` (12 000 hàng hết trong một lượt 3 lô; 60 000 hàng dừng ở 10 lô, `bounded`; hàng còn hạn giữ nguyên), `tests/data-retention.test.ts` (lượt dọn dữ liệu không còn đụng bảng đếm; scope ném lỗi không chặn lượt dọn bảng đếm; dịch vụ không đọc `retention-policy`, plugin + cron đều khởi động nó).

**2. Trần lượt xem theo IP** (`server/api/public/articles/[slug]/view.post.ts`): `VIEW_IP_CEILING_RULE = { limit: 60, windowSeconds: 600 }`, khoá `avip:<ipBucket>` (IPv6 gộp /64), qua `rateLimitDeps()` + `getClientIp`, kiểm TRƯỚC lượt khử trùng theo bài; quá trần vẫn 202, không đếm (đếm `count > limit` — `blocked` bật ngay ở lượt thứ 60). Đổi User-Agent từ một IP từng tạo "khách mới" mỗi lượt. Test `tests/article-view-ip-ceiling.test.ts` (handler thật + `getClientIp` thật + bộ đếm thật trên máy chủ h3: 100 lượt đổi UA → 60 lượt được đếm, tất cả 202; /64 dùng chung trần, /64 khác không bị ảnh hưởng; khử trùng theo bài vẫn còn).

**3. Hai chỉ mục ghép trên `articles`** (`schema.ts`, `schema-tables/content.ts`, `migrations-additive.ts`): `articles_status_type_pub_idx (status, type, published_at, created_at)` và `articles_status_category_pub_idx (status, category_id, published_at, created_at)` cho danh sách công khai (`articles.get.ts`, `related.get.ts`). Chỉ mục danh mục là `ensureIndex` ngay sau khi thêm `category_id` trong `content.ts` (cột đó không có trong thân `CREATE TABLE`). `db:drift` không so chỉ mục → `tests/article-list-indexes.test.ts` so tên + thứ tự cột ở cả ba nơi. Kiểm trên MySQL 8 local với CSDL dùng một lần: `initDb()` trên CSDL trống tạo cả hai; xoá hai chỉ mục rồi chạy lại `initDb()` (CSDL "đã có dữ liệu") tạo lại cả hai (`SHOW INDEX`); CSDL tạm đã xoá. Không `EXPLAIN` trong CI (kế hoạch truy vấn phụ thuộc thống kê bảng).

**4. Trích ảnh đại diện video lúc phục vụ có giới hạn** (`server/services/thumbnail-on-demand.ts` mới, `thumb.get.ts`, `video-processing.ts`).
- Lỗi: `GET /api/public/media/<id>/thumb` (không cần đăng nhập) chạy FFmpeg ở MỌI yêu cầu khi video chưa có ảnh: mười thẻ một trang = mười tiến trình cho một video, không hạn giờ, tệp hỏng thử lại mãi.
- Sửa (`onDemandThumbnails`): gộp yêu cầu đồng thời (khoá = đường dẫn `thumb.jpg` đích, nên link short_id và link slug cũ của cùng video là MỘT lượt — chặt hơn khoá theo shortId của D19), tối đa 2 lượt FFmpeg toàn tiến trình, `AbortSignal.timeout(15 s)` vào runner (SIGKILL), lỗi/hết giờ nhớ 10 phút (trả placeholder, không spawn), xoá `thumb.jpg` dở trước khi báo kết quả. `extractThumbnailOnDemand` nhận `run` (điểm tiêm) và coi lượt bị huỷ là hỏng.
- Test `tests/thumbnail-on-demand-bounds.test.ts` (runner giả): 10 yêu cầu → 1 tiến trình; runner treo bị huỷ ở hạn (hạn 40 ms tiêm vào), tệp dở bị xoá, lỗi được nhớ; lỗi nhớ 10 phút rồi thử lại; 5 video → không quá 2 tiến trình cùng lúc; endpoint không gọi thẳng FFmpeg.

**5. Hỏi trạng thái livestream** (`app/utils/visible-poller.ts` mới, `LiveTickerBar.vue`, `LiveHero.vue`, `services/livestream.ts`, `livestream/active.get.ts`).
- `createVisiblePoller`: chỉ hỏi khi được bật VÀ tab đang hiện; tab ẩn → dừng interval; hiện lại → hỏi ngay một lần. `LiveTickerBar` (nằm trong layout, mọi trang) không hỏi ở `/media` (nơi nó không hiện), rời `/media` → hỏi ngay. `LiveHero` cùng cơ chế.
- `getActiveLivestreamCached()` (dùng cho `active.get.ts`): giữ chính promise 3 giây, nên một loạt yêu cầu đồng thời = một truy vấn; lượt đọc hỏng không được giữ; `startLivestream`/`stopLivestream` xoá cache ngay sau commit. **Lệch có chủ đích so với D20:** `getActiveLivestream()` (luồng HLS, SSE chat) vẫn đọc thẳng — đặc tả chỉ đòi cache cho lượt hỏi trạng thái, và test sẵn có `livestream-chat.test.ts` (luồng SSE trả 404 ngay khi buổi phát đã dừng ngoài tiến trình) giữ hành vi đó.
- Test `tests/live-status-polling.test.ts` (poller với document + timer giả: 5 phút tab ẩn không hỏi lượt nào; không hỏi khi tắt; cache: 100 yêu cầu ~1 s → 1 truy vấn, hết 3 s hỏi lại, start/stop thật hiện ra ngay ở lượt đọc kế, lượt hỏng không bị giữ; guard nguồn hai component).

**6. Nút của khối Hero theo cấu hình** (`app/utils/blocks/hero-content.ts` mới, `HeroBlock.vue`, `registry.ts`): nhãn/liên kết nút đọc từ dữ liệu khối theo thứ tự chọn của tiêu đề (vi: giá trị khối → mặc định; ngôn ngữ khác: bản dịch → từ điển → mặc định — giá trị khối là chữ Việt nên không hiện ở trang tiếng Anh); liên kết không theo ngôn ngữ (bản dịch → giá trị khối → đích mặc định), qua `safeLinkOrNull` (1A) — không an toàn → đích mặc định; nhãn rỗng → ẩn nút ở mọi ngôn ngữ; giá trị bằng mặc định CŨ của registry (`OLD_HERO_DEFAULTS`: "Về chúng tôi" `/about`, "Nhận hỗ trợ 24/7" `#tro-giup`) = chưa cấu hình, nên trang đã lưu trông y như trước. Mặc định registry đổi thành nhãn đang hiện ("Gửi yêu cầu trợ giúp"). Bỏ đọc chết `data.btnAbout`/`data.btnHelp`. Test `tests/hero-block-buttons.test.ts` (render template thật với đầu ra resolver, vi + en).

**7. Vòng focus** (13 tệp của D9, 24 chỗ): `#7CB342` (2,50:1 trên trắng) → `#4A6741`, kể cả quầng `/30` và `focus:border`; hai nút nổi nền xanh đậm (`ChatWidget` launcher, `SocialBubble`) dùng `ring-white ring-offset-2 ring-offset-[#1e4620]`. Nút "Thử lại" nền đậm trong hộp chat thêm `ring-offset-1`. Test `tests/focus-ring-no-secondary-green.test.ts` quét MỌI `.vue`/`.ts` dưới `app/`, mọi biến thể `focus*:`.

**8. Đúng một `<h1>` mỗi trang công khai** (`DefaultHeader.vue`, `index.vue`, `about.vue`, `contact.vue`, `[slug].vue`, `app/utils/blocks/page-heading.ts` mới): tên cổng ở header là `<p>` cùng lớp (trước là `<h1>` trên MỌI trang → bài viết/danh sách có hai, trang chủ ba). Trang dựng từ khối đặt `<h1 class="sr-only">` chỉ khi cây hiển thị không có khối hero (`blocksRenderOwnH1`, bỏ nút ẩn + cây con). `/about`, `/contact` và trang `[slug]` dạng khối (khối "heading" mở bằng `<h2>`) sẽ còn KHÔNG có `<h1>` nếu chỉ đổi header — đã sửa cùng mục. `/media`: `LiveHero`/`MediaDefaultHero` loại trừ nhau, E2E xác nhận. Test `tests/public-single-h1.test.ts` + `tests/e2e/public-single-h1.spec.ts` (đếm `<h1>` cả HTML SSR lẫn sau hydrate trên `/`, `/news`, một bài, `/about`, `/contact`, `/media`, `/legal-qa`, `/documents`, `/search?q=a`).

**9. Chuyển động do người xem kiểm soát** (`RoleModelsBlock.vue`, `app/utils/carousel-autoplay.ts` mới, `LiveTickerBar.vue`): carousel có nút tạm dừng/tiếp tục luôn hiện (`aria-label` theo việc nút sẽ làm, khoá i18n mới `carousel_pause`/`carousel_play` trong seed + từ điển dự phòng); `prefers-reduced-motion: reduce` → không tự chạy (nút hiện "tiếp tục"), cuộn bằng script `behavior: 'auto'`, `motion-reduce:scroll-auto`; chỉ nút tạm dừng/tiếp tục đổi ý muốn của người xem; trỏ chuột (chuột/bút, không tính con trỏ cảm ứng), focus bàn phím ở bất kỳ đâu trong carousel (kể cả chính nút), ngón tay trên slide (không tính chạm vào nút) và tab ẩn chỉ tạm dừng trong lúc chúng còn đó; bấm "tiếp tục" thắng trỏ chuột/focus/chạm cho tới lần kế tiếp (không thắng tab ẩn); focus ra ngoài chỉ chạy lại nếu người xem chưa bấm dừng; mũi tên + chấm có vòng focus — xem mục "Sửa sau kiểm chứng độc lập". Marquee của `LiveTickerBar` thêm `motion-reduce:animate-none`. Test `tests/carousel-motion-control.test.ts`.

**10. Hộp chat giữ focus** (`ChatWidget.vue`, `app/utils/focus-return.ts`): cùng helper với `ConfirmModal` — nhớ nút đã mở (nút "Hỏi trợ lý" ở thanh dưới trên điện thoại), `inertOutside` khi mở, gỡ TRƯỚC khi trả focus; focus phần tử Tab tới được đầu tiên ĐANG HIỆN (`visibleTabbables`, bộ chọn chung `TABBABLE_SELECTOR` có `select`, `summary`, `[tabindex]:not([tabindex="-1"])`) thay vì nút đóng desktop `hidden md:flex`; Escape + bẫy Tab ở mức `window` chỉ khi đang mở; `openFullPage` đóng qua cùng đường. Lỗi thật tìm thấy bằng E2E mới: hộp thoại chuyển `visibility` cả lúc MỞ nên lúc `focus()` nó vẫn `hidden` và trình duyệt bỏ qua — nay `visibility` chỉ nằm trong transition lúc ĐÓNG, nút ở header không `transition-all` (cùng quy tắc `DefaultMobileDrawer.vue`). Test `tests/chat-widget-dialog-a11y.test.ts` + `tests/e2e/chat-widget-focus.spec.ts` (375 px: mở → focus vào điều khiển đang hiện trong hộp, `#main-content` inert, Tab/Shift+Tab không rời hộp, Escape khi không có focus vẫn đóng, gỡ hết inert, focus về nút đã mở).

**11. "Đọc nhiều" theo ngôn ngữ** (`NewsCategoryList.vue`): dùng `usePublicMostRead('news', currentLang)` (truyền `lang`, khoá `useAsyncData` theo cả query) thay bản viết tay khoá cố định `'news-category-most-read'` không có `lang`. Test `tests/news-most-read-language.test.ts`.

#### Sửa sau kiểm chứng độc lập (2026-10-24)
- **(Nghiêm trọng) Chạm "Tạm dừng" trên điện thoại không dừng carousel.** `touchstart` của khung carousel chạy TRƯỚC `click` của nút: bản trước coi một lần chạm là "người xem tự điều khiển" (đặt ý muốn = dừng), rồi `click` đảo nó lại thành chạy — nhãn không đổi, slide vẫn trượt (Chromium 390 px cảm ứng). Sửa gốc: `createCarouselAutoplay` (`app/utils/carousel-autoplay.ts`) — CHỈ `pressToggle` đổi ý muốn; chạm/focus/trỏ chuột/tab ẩn là lý do tạm thời; chạm bắt đầu trên chính nút bị bỏ qua (`fromToggle`); `pointerenter`/`pointerleave` thay `mouseenter`/`mouseleave` (một lần chạm giả lập `mouseenter` mà không bao giờ `mouseleave`). Focus trên chính nút cũng tạm dừng (trước: chạy lại); bấm "tiếp tục" khi chuột còn trên carousel thì chạy ngay (trước: chờ chuột rời đi). Test `tests/carousel-motion-control.test.ts` phát lại đúng thứ tự sự kiện (touchstart → touchend → focus → click) + `tests/e2e/carousel-pause.spec.ts` (cảm ứng 390 px: chạm dừng → nhãn "Tiếp tục", 4,5 s không trượt; chạm tiếp tục → trượt; chuột 1280 px: dừng giữ khi chuột rời, "tiếp tục" lúc còn hover thì chạy) — **cả hai ca đỏ trên build `9cf1bb8`**.
- `scripts/analytics-maintenance.ts`: mọi lượt (analytics, dọn dữ liệu, dọn bảng đếm) được "settle" — lượt nào ném thì thành `{ error }` trong JSON thay vì làm script dừng trước khi in kết quả (lượt kiểm chứng thứ hai bắt được: `runRetentionPass` đọc chính sách qua `getDb()` ngoài mọi `catch`, ném sau khi analytics xong → không JSON, không dọn bảng đếm, không đóng pool). Lượt dọn bảng đếm qua `reportRateLimitPurge()` (không bao giờ ném; log `rate_limit.purge_failed`) LUÔN chạy, kể cả khi analytics hỏng/ném hay dọn dữ liệu ném (cron có thể là đường dọn duy nhất khi `RETENTION_SCHEDULER=0`); `closeDb()` nằm trong `finally`; exit 1 khi bất kỳ lượt nào hỏng/ném (kể cả chỉ lượt dọn bảng đếm), 2 khi cảnh báo/khoá bận. Test `tests/analytics-maintenance-script.test.ts` chạy chính script với dịch vụ giả: analytics ném, dọn dữ liệu ném, chỉ dọn bảng đếm hỏng (bỏ `|| rateLimitsFailed` → đỏ, đã thử), CSDL sập.
- `stopRateLimitPurgeScheduler` xoá cả timer khởi động 90 s; plugin gọi nó ở hook `close` của Nitro. Test `tests/rate-limit-purge-scheduler.test.ts` (timer giả; đỏ trên dịch vụ của `9cf1bb8`).
- Trần lượt xem ghi `article_view.ip_ceiling_hit` `{ bucket, limit, windowSeconds }` tối đa một lần mỗi bucket mỗi cửa sổ (chỉ lượt đưa bộ đếm lên 61), để thấy được trần đang chặn.
- Lượt kiểm chứng thứ hai: E2E `carousel-pause` đưa focus ra khỏi carousel (bấm/chạm tiêu đề khối) trước khi kiểm "đứng yên" — focus còn trên nút cũng tạm dừng nên phép kiểm cũ không chứng minh được nút; vẫn đỏ trên logic `9cf1bb8` (đã chạy lại). Chạm chỉ thôi tạm dừng khi ngón tay CUỐI nhấc lên (`touchEnd(touches.length)`); đổi `prefers-reduced-motion` lúc trang đang mở được theo dõi (sự kiện `change`) cho tới khi người xem tự bấm nút. `globalTimeout` của Playwright 300 → 480 s (bộ đủ ~240 s ở máy, CI chậm hơn). Hướng dẫn Cloudflare: lệnh sinh tệp có `set -euo pipefail` + kiểm tệp không rỗng/đúng dạng trước khi thay; ghi rõ vì sao không nên vá bằng `TRUSTED_PROXY_IPS`.
- **Kiểm tra trước khi merge (vận hành): IP thật sau Cloudflare.** Production đi qua Cloudflare, nhưng nginx mẫu chưa khôi phục IP khách (`$remote_addr` = IP edge; `TRUSTED_PROXY_IPS=172.16.0.0/12` chỉ phủ docker) → app thấy IP edge cho mọi khách, trần 60 lượt / 10 phút sẽ đếm thiếu lượt xem thật (và giới hạn tần suất khác vốn đã gộp). Trước khi merge 1C: đặt `set_real_ip_from` (dải https://www.cloudflare.com/ips/) + `real_ip_header CF-Connecting-IP;` ở nginx và kiểm IP trong `activity_logs` — hướng dẫn `CI-CD.md` Bước 8 "IP thật sau Cloudflare", `production/README.md`. Không đổi ngữ nghĩa `client-ip.ts`.
- Đổi tên một test của `tests/data-retention.test.ts` cho đúng điều nó chứng minh.

#### Kiểm chứng (2026-10-24, worktree `wave1/1c-perf-frontend`)
Đo lại sau lượt kiểm chứng thứ hai (trên 1A `6e02e11`, `node_modules` cài riêng trong worktree): `npm test` 4090 / 4064 pass / 0 fail / 26 skip. Typecheck 0 lỗi. eslint 0 error / 16 warning (không tệp nào đổi có cảnh báo). `db:drift` xanh (635 cột / 62 bảng). `npm run build` xanh. E2E (build production, cổng 3123) 93/93, Playwright báo 4,1 phút, 248 s tính cả khởi động, trên `globalTimeout` mới 480 s. Seed i18n 583 key / 631 hàng. Trước/sau mỗi lượt cổng 3123 trống, không còn DB `cdkt_e2e_*`. Chỉ mục: kiểm bằng `initDb()` trên CSDL dùng một lần (MySQL 8 local), đã xoá.

Bằng chứng test-đỏ-trước, nói đúng mức đã đo: test hành vi của mục 1, 2, 3 đỏ trên mã cũ vì khẳng định trượt (purge một lô, đếm 100/100 lượt xem, thiếu chỉ mục). Test của mục 4, 5, 6, 8, 9, 10 đỏ trước tiên vì module/export chưa có; các guard bên trong cũng trượt trên mã cũ (endpoint gọi thẳng `extractThumbnailOnDemand`, component tự `setInterval`, `HeroBlock` không có `resolveHeroContent`, header là `<h1>`, carousel không có `prefers-reduced-motion`/nút tạm dừng, `ChatWidget` focus nút đóng desktop và không `inertOutside`). Mục 7, 11: guard trượt trên mã cũ (24 chỗ `#7CB342`; khoá cố định). Spec E2E `public-single-h1` CHƯA chạy trên bản build trước khi sửa (dự kiến đỏ: `<h1>` header + `<h1>` trang). Spec chat đỏ trên bản build TRUNG GIAN (đã có focus/inert mới nhưng còn transition `visibility` lúc mở), xanh sau khi sửa. Hai khẳng định cố ý xanh trên mã cũ vì giữ hành vi sẵn có: khử trùng theo bài (mục 2) và khoá `listDataKey` theo `lang` của tiện ích dùng chung (mục 11).

### 31. Wave 2 · 2F — Suite nâng cấp lược đồ + đo lại độ phủ (2026-10-24)

Nhóm đầu của `openspec/changes/wave2-hardening` (D-UPGRADE, D-COVERAGE). Nó đi trước mọi thay đổi lược đồ của Wave 2, để những thay đổi đó được kiểm ngay từ PR đầu.

- **Fixture lược đồ của bản trước** (`tests/fixtures/schema-prev.sql`, `scripts/snapshot-schema.ts`). Lược đồ do `initDb()` **của chính** commit `7dfed8c` dựng: đó là `main` đã deploy trước Wave 0–1, và repo không có tag phát hành. Fixture có 62 bảng, chỉ DDL.
  - Script chạy như sau: `git archive <ref>` vào thư mục tạm, symlink `node_modules`, chạy `server/db/init.ts` của ref đó vào CSDL tạm `cdkt_snapshot_*`, ghi `SHOW CREATE TABLE`, rồi xoá CSDL lẫn thư mục tạm, kể cả khi lỗi.
  - Không dùng `mysqldump`, vì máy dev không có client (chỉ container có). `backup-sql.ts` cũng đã dump bằng `SHOW CREATE TABLE`.
  - Kết quả xác định: bảng xếp theo tên, bỏ `AUTO_INCREMENT=`, không ngày giờ, không `DROP`. Hai lần chạy giống nhau từng byte. Fixture nạp vào CSDL trống không lỗi.
  - Wave 0–1 không thêm cột nào. Chụp `694bb6e` (sau 1D/1B) ra lược đồ giống hệt `7dfed8c`; `wave1/integration` có thêm hai chỉ mục `articles` của 1C. Bước làm mới sau mỗi bản phát hành nằm ở `CI-CD.md` § *Làm mới fixture lược đồ của bản trước*.
- **`tests/schema-upgrade-integration.test.ts`** (matrix `schema-upgrade`, switch `SCHEMA_UPGRADE_INTEGRATION`, biến `SCHEMA_UPGRADE_{HOST,PORT,USER,PASSWORD}`; job `changes` cũng chạy Integration khi PR chỉ đổi fixture).
  - **Bảng được chèn hàng: suy từ mã, không liệt kê tay.** Có ba nguồn:
    - mọi mảng mà `migrations-additive.ts` export (`{table}`/`{referencedTable}`/tuple);
    - lời gọi `ensureColumn`/`ensureIndex`/`modifyColumn`/`ensureForeignKeyIfMissing`/`ensureRequiredColumn` trong `migrations-additive.ts` và `schema-tables/*.ts`;
    - đích của mọi `UPDATE`/`INSERT … INTO`/`DELETE FROM`/`ALTER TABLE` thô trong các tệp đó.
  - Kết quả là 35 bảng, cộng các bảng chúng trỏ FK tới: 37 bảng, 109 hàng.
    - Giá trị sinh theo kiểu cột, sát biên: INT gần trần, BIGINT vượt 2^53, chữ có dấu, nháy, `\`, xuống dòng và emoji 4 byte, JSON. Cột nullable để NULL ở hàng 2. FK trỏ hàng cha thật, và được kiểm sau khi chèn.
    - Hàng viết tay ở những chỗ cần thật hoặc cần kích một chuyển đổi: `chatbot_settings` id 1, `admin`, các khoá settings đã sửa, Facebook đã sửa, nhãn hotline cũ, URL `localhost:3000`/`migrated/media`.
    - Bảng mới nào không sinh được hàng thì suite đỏ, nêu tên bảng và chỉ tới `SEED_OVERRIDES`.
  - **Khởi động hai lần đúng như container:** `init.ts` rồi `seed.ts`, mỗi cái là một tiến trình riêng có trần thời gian. Sau mỗi lượt, so mọi bảng theo khoá chính, từng cột, với giá trị chính xác (`dateStrings`/`jsonStrings`/`bigNumberStrings`, `time_zone '+00:00'`).
    - Lượt 1: thay đổi nào không thuộc một `DECLARED_CONVERSIONS` thì đỏ, nêu `bảng.cột [khoá]: cũ → mới`.
    - Lượt 2: không được đổi gì, kể cả DDL.
    - Mỗi khai báo neo **theo nội dung mã**; mã đã xoá thì test riêng đỏ.
    - Bộ đếm thời gian `ON UPDATE CURRENT_TIMESTAMP` chỉ được đổi theo một thay đổi đã khai báo của cùng hàng.
  - **Các chuyển đổi đã khai báo, mỗi cái kèm lý do trong test:**
    - từ `migrations-additive.ts`: backfill `WHERE col IS NULL` (2 chỗ); `mode = 'ai'` (chỉ khi cột vừa được thêm); NULL hoá tham chiếu tới user đã xoá; cha "Legacy question N" cho term mồ côi; xoá danh mục video (chỉ khi FK còn trỏ `categories`); nhãn hotline; `repairLegacyMediaUrls` (kết quả phải đúng phép viết lại); `short_id`; cột/bảng mới;
    - default content types/categories do DDL chèn;
    - từ `seed.ts`: chèn default còn thiếu — khớp **đủ khoá tự nhiên** với dữ liệu của chính seed (xem *Vòng sửa* bên dưới); **chèn lại default vào bảng đã có hàng**, mà wave2 D7 sẽ sửa; backfill provider AI từ `chatbot_settings`.
  - **Bằng chứng test-first:** chạy khi chưa có khai báo nào thì đỏ, 1987 lượt ghi. Gồm `articles.content` ×2, `media.url` ×1, `lang_translations.value` ×2, 4 bộ đếm `updated_at` và 1978 hàng do seed/DDL chèn. Không có lượt ghi nào khác. Các giá trị chuyển đổi được ghi cứng trong test, độc lập với vị từ.
  - **Không tới được từ fixture này** (chẩn đoán in mỗi lượt): cột/bảng mới, hai backfill NULL, `mode = 'ai'`, tham chiếu mồ côi, cha của term mồ côi, danh mục video, `short_id`, backfill provider AI. Lý do: lược đồ `7dfed8c` đã có các cột đó và FK đã ép.
  - **Suite có cắn** (làm trên bản sao trong scratch, không commit):
    - thêm lại `UPDATE media_items SET category_id = NULL` vô điều kiện → lượt 1 đỏ: `media_items.category_id [id=1]: "1" → NULL`;
    - thêm `UPDATE settings SET group = 'general'` → `settings.group [key=hotline]: "contact" → "general"`;
    - bỏ phép kiểm tồn tại trước khi seed luật kiểm duyệt → lượt 1 xanh (chèn default vào bảng trống), lượt 2 đỏ: `ai_moderation_rules … row inserted ×28`.
  - Thời gian: ~32 s trên MySQL 8.0.46 local.
- **Đo lại độ phủ** (`npm run test:coverage`, `docs/test-coverage-baseline-2026-10.md` § 2026-10-24).
  - **Vì sao không dùng cờ của Node.** Glob `--test-coverage-include` không liệt kê tệp chưa nạp, trên phiên bản nào cũng vậy: nó chỉ lọc tệp đã nạp. `--test-coverage-include-all` thì chỉ có trên Node 26 (Node 24.21 và 22.23 báo `bad option`), mà khi đi cùng `mock.module` nó còn sinh bản ghi trùng (69 tệp, có bản toàn-0).
  - **`scripts/coverage-summary.ts` viết lại để đọc lcov**, chạy được trên Node 22/24/26. Nó làm ba việc:
    - gộp các bản ghi cùng `SF:`: dòng, hàm hay nhánh được tính là đã chạy nếu bất kỳ bản ghi nào chạy nó;
    - thêm mọi tệp `.ts` git theo dõi dưới `server/`, `shared/`, `app/utils/`, `app/composables/` mà không test nào nạp (trừ `schema-tables/`, `*.d.ts`, tệp test), ở 0 % của **số dòng có mã**. Bộ quét đếm dòng khớp trình phân tích TypeScript trong 0,013 % trên 660 tệp (đo trên `a7be585` + 2F; trên `694bb6e` là 652 tệp, cũng 0,013 %);
    - in tổng chung và theo thư mục cho "mọi tệp" lẫn "chỉ tệp đã nạp", rồi ghi vào `$GITHUB_STEP_SUMMARY` nếu có.
  - `npm run test:coverage` ghi lcov vào `node_modules/.cache/cdkt-coverage/` rồi chạy script. Bước CI vẫn Node 24 và vẫn `continue-on-error`; bước test unit thêm reporter lcov, bước *Coverage summary* đọc tệp đó. Từ nay trang tóm tắt CI báo cả số "mọi tệp".
  - **Lỗi đo đã tìm ra.** Quy tắc loại trừ mặc định của Node coi `test-*.ts` là tệp test, nên các handler thật `server/api/admin/settings/test-r2.post.ts` và `test-email.post.ts` mất khỏi coverage. Cả hai lệnh nay truyền `--test-coverage-exclude='tests/**'`, và quy tắc mặc định không còn áp dụng.
  - Mức nền mới (Node 24.21, trên `wave1/integration` `3ede49a` + 2F): **70,50 % dòng trên mọi tệp** (51 767 / 73 424); 299/663 tệp chưa từng được nạp; 87,10 % dòng trên tệp đã nạp; `server/api/` 45,23 %. Lệnh của bước CI cũng ra 70,50 %. Các mốc trước: `694bb6e` (trước 1A/1C) 68,25 %; `a7be585` (trước 2E) 70,55 %. Con số "65,7 %" không có nguồn.
  - Test: `tests/coverage-summary.test.ts` viết lại (9 test) với fixture lcov nhỏ, gồm:
    - gộp bản ghi trùng (khác chỉ số `anonymous_N` và mã khối nhánh, có bản ghi toàn-0);
    - phạm vi nguồn; số dòng có mã (chuỗi, template, regex, chú thích khối);
    - thêm tệp chưa nạp; tổng theo thư mục;
    - CLI với git, không git (`PATH=''`) và thiếu lcov.

#### Kiểm chứng (2026-10-24)
- Đo sau khi đặt lên `wave1/integration` (`a7be585`: Wave 0–1 gồm cả 1A và 1C).
- `npm test` 4292 / 4260 pass / 0 fail / 32 skip trên Node 24.21 (5 skip mới là suite nâng cấp khi không có MySQL).
- `npm run test:coverage` xanh trên Node 24.21 và 26.11 (cùng 70,55 %). Lệnh của hai bước CI (unit + *Coverage summary*) đã chạy thử trên Node 24.21 với `GITHUB_STEP_SUMMARY`: 4259 pass, 70,55 %.
- Node 22.23: các cờ và script chạy được (70,41 %), và `tests/coverage-summary.test.ts` 9/9. Có 19 test vốn đỏ trên Node 22 (`backup-run-endpoint`, `backup-scheduler-due`, `article-view-ip-ceiling`, `chatbot-outbound-stream`) và 4 test bị huỷ (`thumbnail-on-demand-bounds`); cả hai đều xảy ra y hệt ở `a7be585` chưa có thay đổi của 2F. Chúng làm `npm run test:coverage` dừng trước bước tóm tắt.
- 1A/1C không thêm lượt ghi nào lúc khởi động mà chưa khai báo. Hai chỉ mục `articles` mới (1C) chỉ đổi lược đồ, và lượt 2 giữ nguyên lược đồ. Hai khoá dịch mới rơi vào `seed.insert-missing-defaults`: seed chèn ×1961, so với ×1957 trên `694bb6e`.
- Typecheck 0 lỗi. eslint 0 error / 16 warning (như trước; không cái nào ở tệp mới).
- `tests/ci-integration-matrix.test.ts` cùng các guard workflow khác xanh.
- Suite nâng cấp 5/5 trên MySQL 8.0.46 local, cả Node 26.11 lẫn Node 24.21 (bản CI, chạy trong `node:24-slim`). Không để lại CSDL `cdkt_upgrade_*`/`cdkt_snapshot_*`.

**Vòng sửa sau kiểm độc lập (2026-10-24).** Người kiểm thử chèn lỗi vào bản sao, và ba lỗi lọt qua suite (5/5 xanh):
- bite F: seed cấp toàn quyền cho vai trò cán bộ tự tạo;
- bite H: seed tạo thêm tài khoản superadmin `editor`;
- bite G: upsert giá model xoá nhãn của cán bộ.

Ngoài ra suite treo ~11 phút khi một migration ném lỗi. Đã sửa (chỉ `tests/`, `scripts/snapshot-schema.ts` và tài liệu; mã seed không đổi):
- **Khai báo seed khớp đủ khoá tự nhiên, lấy từ dữ liệu của chính seed** (thay cho phép tìm chuỗi trong mã nguồn).
  - Nguồn dữ liệu: dữ liệu export được import (`DEFAULT_TRANSLATIONS_SEED`, `CHATBOT_SMALL_TALK_SEED`). Hằng số nội bộ của `seed.ts` (tệp này tự chạy khi import) và bộ default của tệp DDL được đọc bằng trình phân tích TypeScript, rồi tính như literal. Một hằng số bị đổi tên hay đổi cấu trúc thì suite đỏ, nêu tên hằng số đó.
  - Khoá tự nhiên theo bảng:
    - `users`: ghim đúng `admin` — tài khoản khác thêm vào seed là thay đổi bảo mật cần xem xét, không phải "default";
    - `roles`: tên vai trò default;
    - `permissions`: cặp (vai trò default, tài nguyên);
    - `lang_translations`: (ngôn ngữ, nhóm, khoá);
    - `page_blocks`: (trang hệ thống, loại khối, thứ tự), cộng các khối trang chủ chép từ `home_sections`;
    - còn lại: khoá tự nhiên của từng bảng.
  - Một default chỉ được chèn khi khoá chưa có trước lượt khởi động, và mỗi khoá một lần.
  - Thêm test `the seed declarations accept exactly the seed's own missing defaults` (không cần CSDL thật).
- **Mọi bảng seed ghi (20) đều có hàng đại diện mang khoá default với giá trị cán bộ đã sửa**, nên upsert ghi đè giá trị cán bộ hiện thành ô bị đổi. Trên mã hiện tại không bảng nào bị ghi đè.
- **`init.ts` chạy thành tiến trình riêng có trần thời gian, như `seed.ts`.** Migration ném lỗi thì suite báo lỗi ngay và thoát.
- **`scripts/snapshot-schema.ts` dọn ở mọi đường ra.** Thư mục tạm xoá trước, CSDL tạm sau, và lỗi báo ra là lỗi đầu tiên. Trước đây, sai mật khẩu thì còn lại một bản sao repo ~30 MB trong thư mục tạm, và lỗi bị che bằng lỗi của bước dọn.
- Test mới: `tests/snapshot-schema.test.ts` (chuẩn hoá DDL; snapshot xếp thứ tự, chỉ DDL, không ngày giờ; CSDL không tới được vẫn dọn thư mục tạm). `tests/ci-integration-matrix.test.ts` thêm một ca: PR chỉ làm mới `tests/fixtures/schema-prev.sql` vẫn chạy Integration — bỏ đường dẫn khỏi regex của job `changes` thì đỏ.
- **Kết quả chèn lỗi lại** (bản sao trong scratch, không commit):
  - F đỏ: `inserted permissions ×21`;
  - G đỏ: `ai_model_pricing.label [model=delify-5.5]: "Giá đã thương lượng" → NULL` cùng giá bị ghi đè;
  - H đỏ: `users … row inserted` cộng ca dữ liệu seed;
  - C1 (thu hẹp `reader_accounts.display_name` xuống `VARCHAR(5)`) đỏ sau 3,8 s với `ER_DATA_TOO_LONG`, cả tệp 31 s, tiến trình thoát. Trước đây treo 643 s.
- Kiểm chứng sau vòng sửa (Node 24.21, trên `a7be585`):
  - `npm test` 4297 / 4264 pass / 0 fail / 33 skip;
  - suite nâng cấp 6/6 trên MySQL local (~33 s);
  - typecheck 0 lỗi; eslint 0 error / 16 warning;
  - guard matrix + `snapshot-schema` + `coverage-summary` + workflow 99/99;
  - không để lại CSDL `cdkt_upgrade_*`/`cdkt_snapshot_*`.

  Độ phủ không đổi, vì không có tệp nguồn nào trong phạm vi đo bị sửa.

**Đo lại sau khi rebase lên `wave1/integration` `3ede49a`** (gồm 2E `shared/` § 32 và `COPY shared` của 1D), Node 24.21:
- `npm test` 4407 / 4374 pass / 0 fail / 33 skip.
- Suite nâng cấp 6/6 trên MySQL local. Các chuyển đổi quan sát được giống hệt trước, nên 2E/1D không thêm lượt ghi nào lúc khởi động.
- `npm run test:coverage`: 70,50 % (Node 26.11: 70,51 %), 299/663 tệp chưa nạp. Lệnh của bước CI ra 70,50 %, 300 tệp. Bộ quét dòng có mã khớp TypeScript trong 0,013 % trên 663 tệp.
- Typecheck 0 lỗi; eslint 0 error / 16 warning.
- `ci-integration-matrix`, `runtime-image-sources`, `server-no-app-imports`, `snapshot-schema`, `coverage-summary` 118/118.
- Không để lại CSDL tạm.

**Vòng sửa thứ ba (kiểm lại `264fdea`, 0 lỗi nghiêm trọng).** Có bốn lỗi chèn vẫn lọt qua:
- N7: seed đặt lại `is_visible` của link Facebook đã có — giá trị sinh ra trùng default, nên đổi không thấy;
- N2: bản dịch được chèn với chữ khác dữ liệu seed;
- N3: khối trang liên hệ được chèn với `data` khác;
- N1: ma trận quyền mặc định bị đổi ngay trong seed.

Đã sửa (chỉ `tests/` và tài liệu):
- **Hàng mang khoá default có giá trị "cán bộ đã sửa" ở MỌI cột seed ghi.** Cột nào trùng giá trị seed (hoặc DDL) đều bị dời đi:
  - boolean đảo, số dời, chữ đánh dấu, JSON thêm khoá;
  - khoá ngoại trỏ sang hàng khác, kể cả tham chiếu `@role:`/`@page:` của seed.

  Test gieo dữ liệu kiểm hợp đồng này cho từng cột trước khi chèn.
- **Một default seed thêm vào phải khớp NỘI DUNG, không chỉ khoá.** Mỗi `insert(T).values(…)` của seed được tính lại, với biến vòng `for … of` gắn vào chính hằng số dữ liệu của seed. Các khởi tạo là mã chứ không phải literal (bốn mảng `…Perms`, `smallTalkRows`) chạy trong `vm` rỗng, qua `tests/_seed-source.ts`. Kết quả là đúng các cột seed ghi cho từng default.
  - Hàng chèn khác dữ liệu đó thì không được khai báo, và thông báo nêu cột lệch.
  - Phép so sánh chỉ đúng khi lệnh chèn chép dữ liệu nguyên trạng, nên suite từ chối, nêu tên, mọi biến đổi dữ liệu default ngay lúc chèn (``value: `${value} …` ``, `{ ...b.data, … }`). Các lệnh chèn hiện có của seed đều là chép nguyên trạng.
  - Khối trang chủ (chép từ `home_sections`) được so với chính hàng nguồn.
- **`tests/default-permission-matrix.test.ts` ghim ma trận vai trò → tài nguyên → quyền**, đọc từ chính `seed.ts`. Đổi ma trận thì phải sửa test trong cùng thay đổi.
- Thông báo "row inserted" kèm khoá tự nhiên. Bộ quét bảng seed ghi nhận thêm `delete(X)`, `insert(schema.x)` và SQL thô trong `execute`/`query`.
- `CI-CD.md` ghi: bảng seed ghi cũng có hàng đại diện, có hàng mang khoá default đã sửa, và có test ma trận quyền.
- **Chèn lỗi lại:**
  - N1 làm đỏ test ma trận, nêu từng ô (`moderator · news: seed grants "read,update,delete,publish", pinned "read,update"`);
  - N2, N3 làm suite đỏ trước khi khởi động, nêu đúng biểu thức biến đổi;
  - N7 đỏ ở lượt 1: `social_links.is_visible [id=1]: "0" → "1"`;
  - mã không sửa thì 6/6.
- **Kiểm chứng (Node 24.21):**
  - `npm test` 4410 / 4377 pass / 0 fail / 33 skip;
  - suite nâng cấp 6/6 trên MySQL local; 1921 hàng seed chèn đều khớp nội dung dữ liệu seed;
  - typecheck 0 lỗi; eslint 0 error / 16 warning;
  - guard 165/165.

Còn mở (2F):
- ~~`repairLegacyMediaUrls` đổi `articles.updated_at` của bài nó vá, vì `UPDATE` không giữ cột đó. Sửa cùng D-SCAN, khi đụng hàm này.~~ Đã sửa ở § 37 (`updated_at = updated_at`).
- Tệp chưa nạp được tính bằng dòng có mã, còn tệp đã nạp được tính bằng mọi dòng vật lý (đó là cách Node đếm). Nếu tính dòng vật lý cho cả hai thì ra 64,43 % (trên `3ede49a` + 2F). Wave 3 chọn một quy ước trước khi đặt ngưỡng.

### 32. Đợt 2 — 2E shared modules (2026-10-24)

OpenSpec `wave2-hardening` task 5.1, design D-SHARED. Không đổi hành vi: `app/utils/blocks/registry.ts`, `app/utils/blocks/types.ts` và `app/utils/submission-status.ts` chuyển sang `shared/blocks/registry.ts`, `shared/blocks/types.ts` và `shared/submission-status.ts`. Git ghi nhận ba tệp mới ở `shared/` cộng bản re-export ở đường cũ, không phải một lượt đổi tên; `git log --follow shared/…` vẫn nối được lịch sử trước đó. 14 tệp `server/` (17 dòng import; design ghi 11 tệp ở 7dfed8c) nay import thẳng từ `shared/`, và server không còn tệp nào import `app/`. Guard mới `tests/server-no-app-imports.test.ts` dùng TypeScript AST để chặn mọi dạng import: tĩnh, `import type`, `export … from`, `import()`, `typeof import()`, `require`, `/// <reference>`, cùng các alias `~/` `@/` `~~/app` `#app`. Nó chặn `server/`→`app/` và `shared/`→`app/`/`server/`, đồng thời có bằng chứng bắt đủ 17 dòng cũ. Đường cũ ở `app/` giữ bản re-export **liệt kê tên**, trỏ `~~/shared/…`, có test canh khớp đủ export của module gốc. Lý do không dùng `export *` một dòng như design: `export *` qua alias làm unimport mất 16 auto-import của `submission-status`, còn re-export qua đường tương đối thì vỡ Nitro build (Nuxt để `shared/` là external ở bản SSR, rolldown in ra `../../../../../shared/….ts` không giải được). `tailwind.config.js` thêm `./shared/**`: 7 trong 15 lớp huy hiệu trạng thái đơn chỉ nằm ở `shared/` và sẽ bị purge nếu không quét. Ba guard quét lớp giao diện (họ icon FontAwesome, `#7A8A76`, vòng focus `#7CB342`) nay quét cả `shared/`. Đã kiểm: `npm test` 4352 / 4325 pass / 0 fail / 27 skip (trước 4284; +68 = 59 guard + 3 khớp re-export + 6 tệp `shared/` trong quét tương phản). Typecheck 0 lỗi, eslint 0 error / 16 warning, `db:drift` xanh. Build xanh: 15 màu huy hiệu có trong CSS, đầu ra SSR không còn đường tương đối tới `shared/`, `.nuxt/imports.d.ts` giống từng byte bản trước. E2E 93/93 (7,2 phút), không sót DB `cdkt_e2e_*`.

#### Sửa sau kiểm chứng độc lập (2026-10-24)
Mỗi mục có test đỏ trước khi sửa.
- **Guard biết alias thật của Nuxt 4, theo từng phía.** Bản trước không giải `#server/*`, `#shared/*`, không bắt `#build`/`#app-manifest`, `createRequire(…)(…)` và `declare module '…'`.
  - `shared/` không được dùng alias `#…` nào ngoài `#shared`. Trong `.nuxt/tsconfig.shared.json`, `#server/*` trỏ `../server/*`, `#imports` là barrel auto-import của **app**, `#build/*` là thư mục `.nuxt`, `#internal` là của Nitro — toàn alias chỉ có ở một phía.
  - `server/` được dùng `#imports` (barrel của Nitro), `#server`, `#shared`, nhưng không được dùng alias phía app: `#app`, `#components`, `#build`, `#app-manifest`.
  - Thêm 36 fixture; 15 trong số đó đỏ trên bộ dò cũ.
- **Ghim glob `./shared/**` của Tailwind** (`tests/tailwind-content-shared.test.ts`). Test lấy mọi lớp giá trị tuỳ ý viết trong chuỗi ở `shared/` (gồm đủ 15 lớp huy hiệu), đòi tệp chứa chúng khớp một glob `content`, rồi chạy chính Tailwind với `content` của repo và đòi CSS có từng lớp. Bỏ glob đi thì đỏ đúng 7 lớp: `bg-[#e6f0fb]`, `text-[#1c4f86]`, `border-[#b9d5f0]`, `bg-[#efe8fb]`, `text-[#5b3a9e]`, `border-[#d6c7f0]`, `border-[#b6dfbc]`.
- **CI:** PR đụng `shared/` chạy cả integration (`ci.yml` job `changes`, `CI-CD.md`). `tests/ops-scripts.test.ts` nay chạy chính biểu thức lọc trên vài đường dẫn.
- **Đường cũ trong chú thích:** `server/utils/submission-recipient.ts` và `docs/decisions/realm-safety.md` (2 chỗ) nay trỏ `shared/`.
- **Kiểm chứng lại:** `npm test` 4390 / 4363 pass / 0 fail / 27 skip (+38: 35 guard + 3 Tailwind). Typecheck 0 lỗi, eslint 0 error / 16 warning, `db:drift` xanh. Build sạch xanh, đủ 15 màu huy hiệu trong CSS.

#### `npm run build` đỏ ngẫu nhiên trên nhánh tích hợp (2026-10-24)
- **Lỗi:** khoảng 1/5 lượt build báo `Could not resolve "../../../../../shared/link-policy.ts"`. Nguyên nhân là `app/utils/nav-config.ts` (từ 1A) và `app/utils/blocks/hero-content.ts` import `shared/` bằng đường **tương đối**.
  - Nuxt để `shared/` là external ở bản build SSR.
  - Khi nguồn import là đường tương đối, rolldown có lúc in ra một đường tương đối tính từ thư mục build, và Nitro không giải được. Có lúc hay không là tuỳ cách chia chunk.
  - Đây cũng là cơ chế từng làm re-export tương đối ở § 32 đỏ mọi lượt.
- **Sửa:** cả hai tệp nay import `~~/shared/link-policy`. `scripts/ts-resolver.mjs` giải `~~/` từ gốc repo, vì test nạp thẳng hai tệp này. `tests/runtime-image-sources.test.ts` cũng giải `~~/` giống resolver, nên một import `~~/…` trong mã chạy ở container không lọt khỏi guard image.
- **Guard mới `tests/app-shared-imports.test.ts`:** `app/` (gồm khối `<script>` của 174 tệp `.vue`) chỉ được nạp `shared/` qua `~~/shared/…`. Cấm đường tương đối, `#shared` và `@@/shared`; cấm cả `import()` có đối số không phải chuỗi cố định.
  - Guard đỏ trên đúng hai dòng thật trước khi sửa.
  - Bộ đọc import bằng AST được tách sang `tests/_module-references.ts`, dùng chung với `server-no-app-imports`.
- **Kiểm chứng:** 5 lượt `npm run build` sạch liên tiếp (xoá `.output` và `node_modules/.cache/nuxt` giữa các lượt) đều xanh. Đầu ra SSR không còn chuỗi `"../…shared/"` nào, và `link-policy` được nạp bằng đường tuyệt đối. `npm test` 4414 / 4387 pass / 0 fail / 27 skip (+20). Typecheck 0 lỗi, eslint 0 error / 16 warning, `db:drift` xanh.

### 33. Đợt 2 — 2A bảo mật (2026-10-24)

OpenSpec `wave2-hardening`, nhóm 2 (task 2.1–2.6), quyết định D-CSRF, D1, D-SECRETS, D-NAMES theo mặc định của proposal. Đã đọc `openspec/ui-dna.md` trước mọi thay đổi giao diện. Lý do + runbook → `docs/decisions/realm-safety.md` § *Đợt 2 — 2A bảo mật*.

**1. Chặn yêu cầu ghi khác site** (`server/middleware/00.origin-gate.ts`, `server/utils/origin-gate.ts` mới, `SECURITY_EVENTS.crossSiteRefused`).
- Lỗi: thứ duy nhất chặn một `<form method=post>` trên tên miền con anh em (`*.delify.vn`, cùng tên miền đăng ký) là `SameSite=Lax` — mà "same-site" thì trình duyệt VẪN gửi cookie phiên của cán bộ.
- Sửa: mọi POST/PUT/PATCH/DELETE (không phân loại đường dẫn): `Sec-Fetch-Site` có mặt → chỉ `same-origin`/`none`; không có → `Origin` (`null`/không đọc được → 403; host ∉ {host `PUBLIC_BASE_URL`, `PUBLIC_HOST_ALLOWLIST`, host request — CHỈ khi peer là proxy đã khai (`peerIsTrustedProxy`, rồi `requestBase`: `X-Forwarded-Host`/`Host` do proxy chuyển); `Host` thô từ peer lạ không bao giờ được tin} → 403, so không phân biệt hoa/thường, bỏ cổng mặc định); không có cả hai → cho qua (D-CSRF). Log `security.cross_site_refused` `{ method, path (không query), originHost, reason }`. Tên `00.` → chạy trước `admin-auth` (Nitro `scanDir` sắp `localeCompare`; đã xem thứ tự mảng `handlers` trong `.output`: tài sản tĩnh → cổng này → `admin-auth` → `https-redirect`).
- Test `tests/csrf-origin-gate-behavior.test.ts` (middleware thật trong app h3 + router thật, header gửi thô): 4 kịch bản spec, `cross-site`/giá trị lạ, `none`, Origin lạ/hỏng/`null`, host `PUBLIC_BASE_URL` + allowlist, `X-Forwarded-Host` từ proxy tin cậy (biểu mẫu công khai từ host thật) vs từ peer lạ (bị bỏ qua), `Host` thô = `Origin` từ peer lạ → 403 (host đã cấu hình vẫn qua), bình luận/beacon page-view, multipart 4 KB tới handler nguyên vẹn, multipart khác site bị chặn trước khi đọc body, GET/HEAD/OPTIONS không bao giờ bị chặn, bốn cách viết đường dẫn, dòng log không chứa query/cookie/đường dẫn Origin, thứ tự tệp.

**2. Chính sách bắt buộc MFA** (`server/utils/mfa/policy.ts`, `server/services/mfa-policy.ts`, `server/api/admin/security/mfa-policy.{get,put}.ts` mới; `admin-auth.ts`, `auth/me.get.ts`, `mfa/session.ts` `completeLogin`; trang `app/pages/admin/settings/security.vue`, `AdminMfaEnrollmentBanner.vue`, `app/middleware/admin-auth.ts`, mục menu SuperAdmin).
- `off|privileged|all` (khoá `mfa_policy`, `mfa_enforce_after`, nhóm `security`), chỉ ghi qua endpoint SuperAdmin (`requireResourcePermission` + `requireSuperAdmin`), hai hàng + audit `{ mfaPolicy: { from, to }, enforceAfter }` trong CÙNG transaction; mỗi lượt đổi đặt mốc +14 ngày, `off` xoá mốc, gửi lại cùng giá trị không ghi. Không trong `ALLOWED_SETTING_KEYS` (PUT chung → 400) / `SETTINGS_READ_KEYS`. GET liệt kê tài khoản chưa có yếu tố ở từng mức.
- Cưỡng chế trong `admin-auth` (sau khi nạp quyền từ CSDL): `privileged` = SuperAdmin hoặc sửa/xoá `users`/`roles`/`settings` (sao lưu không có tài nguyên riêng — đi theo `settings`); quá mốc + không hàng yếu tố `active` → 403 `data.code = 'mfa_enrollment_required'`, trừ `MFA_ENROLLMENT_PATHS` (liệt kê đủ, mọi dạng đã giải mã phải khớp, `#`/`%23` không qua — dùng chung `pathForms` với `classifyAdminRequest`). `MFA_ENFORCEMENT=0|false|off|no` (đọc lúc request) tắt cưỡng chế. Đệm chính sách 30 s (bỏ khi ghi), "có yếu tố" 60 s theo `(user, tokenVersion)`.
- Giao diện: `me` và phản hồi đăng nhập trả `mfaEnrollmentRequired` + `mfaEnforceAfter`; middleware client chuyển về `/admin/profile#security` khi bị khoá; banner ở layout admin (thời hạn chuyển tiếp: ngày; khi khoá: lý do); trang profile ẩn khối lịch sử khi bị khoá (endpoint đó không mở), đọc lại `me` sau khi bật yếu tố.
- **Lỗi có từ trước, tìm ra nhờ E2E mới:** `profile.vue` dùng `<ProfileActivityHistory>` — tên trần không phân giải (auto-import đăng ký `AdminProfileActivityHistory`, tiền tố thư mục). Từ lần tách tệp (1076 → 875 dòng) khối "Lịch sử truy cập & hoạt động" **chưa từng hiện**, và `historyRef.reload()` trên phần tử lạ ném lỗi đồng bộ bên trong `Promise.all([...])` của lượt bật/tắt yếu tố — lỗi bị `catch` nuốt vào hộp thoại đã đóng; lượt đọc lại `me` sau khi bật MFA không bao giờ chạy nên banner không tắt. Sửa gốc: `<AdminProfileActivityHistory>`. E2E khẳng định khối lịch sử hiện sau khi bật.
- Test `tests/admin-mfa-enforcement-behavior.test.ts` (middleware + `me` + endpoint + PUT cài đặt chung chạy thật, CSDL giả có transaction thật-sự-hoãn-ghi): mặc định off, trong thời hạn, quá thời hạn (spec), danh sách mở (spec) + MỌI tệp dưới `profile/mfa/` phải mở được, dạng đường dẫn lách, có yếu tố, yếu tố `pending` không tính, bật xong có hiệu lực ngay lượt sau, công tắc (spec), diện `privileged`/`all`, non-SuperAdmin 403 (spec), audit trong transaction, tắt xoá mốc, giá trị lạ 400, GET, khoá không ghi được qua PUT chung.

**3. Mã dự phòng bắt buộc khi bật yếu tố đầu tiên** (`server/utils/mfa/recovery-codes.ts` mới — `issueRecoveryCodes`, một nơi sinh/băm/lưu, xoá + chèn trong một transaction; `confirm.post.ts`, `recovery-codes.post.ts` dùng chung): chính sách khác `off` bao tài khoản và tài khoản chưa có lô nào → phản hồi xác nhận kèm `recoveryCodes` (10, hiện một lần ở khung "mã dự phòng" sẵn có), audit chỉ ghi số lượng; không bao giờ thay một lô đang có. Thứ tự ghi/cookie/audit của `confirm.post.ts` giữ nguyên (ngoại lệ có tên ở `reader-audit-atomicity`). Test `tests/mfa-enrollment-recovery-codes-behavior.test.ts` (endpoint thật, bcrypt thật: mã băm, đổi được, cookie cấp lại sau khi tăng `tokenVersion`; trong thời hạn chuyển tiếp cũng phát; off/ngoài diện/đã có lô → không) + E2E `tests/e2e/admin-mfa.spec.ts` mới: SuperAdmin bật chính sách trên trang, banner báo ngày, bật TOTP bằng mã thật → 10 mã hiện ngay, `auth/me` bằng cookie cấp lại trả 200, banner tắt, trang khác vào được; `afterEach` trả chính sách về `off` QUA ENDPOINT (bỏ đệm 30 s của máy chủ — để lại sẽ hiện banner `role="status"` ở spec sau).

**4. Bí mật trong `settings` mã hoá lúc lưu** (`server/utils/settings-secrets.ts`, `server/db/settings-secret-conversion.ts` mới; `settings/index.{get,put}.ts`, `settings/backup.{get,put}.ts`, `test-email.post.ts`, `test-r2.post.ts`, `utils/mailer.ts`, `services/media.ts` `loadR2Config`, `media/upload.post.ts`, `media/storage-size.get.ts`, `services/backup.ts` `readBackupConfig`; `email.vue`, `media-storage.vue`, `BackupSettingsPanel.vue`/`useBackupSettings.ts` báo "cần nhập lại").
- Lỗi: `smtp_pass`, `r2_secret_key`, `backup_drive_service_account` (có `private_key`) nằm nguyên văn trong bảng → nguyên văn trong mọi bản dump.
- Sửa: envelope AES-256-GCM (`secret-envelope.ts`), nhãn `cdkt-smtp-pass:v1` / `cdkt-r2-secret:v1` / `cdkt-backup-drive-key:v1`, không `lastFour`. Ghi luôn mã hoá (thiếu khoá → 500, không lưu nguyên văn). Dùng: ba hàm đọc giải mã; không mở được → rỗng + cờ, "gửi thử"/"kiểm tra R2"/Drive báo đúng lý do, `sendMail` từ chối thay vì gửi không xác thực. `upload.post.ts`/`storage-size.get.ts` từng tự đọc `r2_secret_key` → nay qua `loadR2Config`. GET: dấu che + `needsReentry: string[]`. Lượt chuyển một lần lúc khởi động (`applyAdditiveMigrations` → `convertPlaintextSettingsSecrets`). Email trả lời mang tên người trả lời qua `effectiveDisplayName` (mục 5).
- Test `tests/settings-secret-storage.test.ts`: khứ hồi + nhãn riêng + hàng lưu không chứa mật khẩu lẫn 4 ký tự cuối; spec "lưu mật khẩu SMTP" (envelope, gửi thử thành công với đúng mật khẩu); R2 (kiểm tra R2 nhận khoá thật) và service account; dấu che giữ envelope từng byte; không phản hồi nào chứa envelope/nguyên văn; thiếu khoá → 500; spec "khoá đã xoay" (`needsReentry`, mọi đường dùng từ chối, hàng không đổi); spec "nâng cấp" (khởi động 2 lần: lần 2 không UPDATE), không ghi đè envelope hỏng, không khoá → không ghi, lượt lưu chen giữa không bị đè; nguyên văn cũ vẫn dùng được; guard: tệp nào nhắc ba khoá phải import `settings-secrets`. Đã chạy trên MySQL 8 local (CSDL dùng một lần, đã xoá): khởi động 1 mã hoá + gắn cờ tên, khởi động 2 `CHECKSUM TABLE settings`/`reader_accounts` không đổi.

**5. Tên Google là từ dành riêng** (`reader_accounts.display_name_reserved` — `schema.ts`, `schema-tables/readers-media.ts`, `ensureColumn` + `server/db/reader-name-backfill.ts`; `auth/google/callback.get.ts`, `utils/display-name.ts`, `utils/reader-auth.ts`, `services/{comments,readers,livestream-chat,notification-email}.ts`, `livestream/chat/send.post.ts`).
- Callback đặt cờ bằng `isReservedDisplayName` (nay export, cùng phép gấp với tên tự đặt) mỗi lần đăng nhập, tên Google lưu nguyên văn, đăng nhập không bị từ chối (D-NAMES). `effectiveDisplayName` hiện "Bạn đọc" (`RESERVED_PROVIDER_NAME_FALLBACK`) khi cờ bật và chưa có tên tự đặt; cờ là khoá **bắt buộc** của tham số — typecheck tìm ra 7 nơi gọi (bình luận công khai, danh sách kiểm duyệt, kiểm duyệt nhanh/AI, đổi tên, chat livestream, `reader/me`) và email trả lời (`notification-email.ts` từng in tên Google thô cạnh địa chỉ của cổng). Hàng có sẵn: điền cờ một lần đúng lúc cột vừa được thêm.
- Test `tests/reader-display-names-google-behavior.test.ts` (callback thật — state ký thật, id_token giải/kiểm thật): spec "Admin" → đăng nhập thành công, bình luận hiện "Bạn đọc"; các cách viết (dấu, full-width, gạch nối); tên thường giữ nguyên ("Nguyễn Công An", "Adminh Trần"); cờ theo tên Google hai chiều; tên tự đặt thắng; lượt điền một lần.

**Cập nhật kèm** (người dùng trực tiếp của hợp đồng đổi): `tests/mfa-codes-endpoints.test.ts` (guard mã nguồn theo `issueRecoveryCodes`), `tests/mfa-concurrency.test.ts` (mock `mfa/codes` thêm ba export để module liên kết được), `tests/settings-credential-retarget.test.ts` + `tests/backup-superadmin-gates.test.ts` (đặt khoá mã hoá dùng một lần; khẳng định "lưu đúng giá trị" nay mở envelope thay vì so nguyên văn), `tests/admin-error-retry-ui.test.ts` + `tests/skeleton-loading-ui.test.ts` (đăng ký trang `settings/security.vue`), `tests/ops-scripts.test.ts` (`MFA_ENFORCEMENT` đi qua compose). Vận hành: `MFA_ENFORCEMENT` trong `environment:` của compose, `.env.example`, `production/README.md` § *Bảo mật đợt 2 — 2A*; `manage.sh` không đổi (nó không ghi mặc định cho các biến công tắc).

**Lượt ghi lúc khởi động mới — phải khai báo trong bộ nâng cấp lược đồ** (`tests/schema-upgrade-integration.test.ts`, task 1.2 — chưa có trên nhánh này): (a) mã hoá ba bí mật `settings` khi giá trị chưa phải envelope; (b) điền `reader_accounts.display_name_reserved` khi cột vừa được thêm.

#### Sửa sau kiểm chứng độc lập (2026-10-24, trên `8149ee8`)
- **(CRITICAL) Chuông thông báo của người đọc còn hiện tên Google dành riêng.** `listNotifications` (`server/services/notifications.ts`) đọc thẳng `author.custom_display_name`/`display_name` và in `authorName || authorGoogleName` — một người tên Google "Ban Quản Trị" trả lời thì người nhận thấy "Ban quản trị đã trả lời", y hệt câu trả lời thật của cổng. Sửa gốc: chọn kèm `display_name_reserved` và giải qua `effectiveDisplayName`; hàm này nay nhận cờ dạng `1`/`0` (cột đọc qua `sql` thô ra số; `=== true` trên `1` là đúng loại lỗi này). Rà mọi chỗ đọc tên người đọc: bình luận công khai, danh sách kiểm duyệt, kiểm duyệt nhanh/AI, email trả lời, `reader/me`, chat livestream đều đã qua resolver; phiên chatbot không hiện tên người đọc; danh sách/chi tiết người đọc ở admin và prompt kiểm duyệt AI đọc tên thô CÓ CHỦ ĐÍCH (chỉ cán bộ). Guard mới `tests/reader-name-resolver-guard.test.ts` (S5): mọi `.select({…})` dưới `server/` (trừ `db/`) đọc tên Google phải đọc kèm cờ, ngoại lệ có tên + số khối (`readers.ts` 6, `ai-moderate.post.ts` 1); tệp đọc cờ phải gọi `effectiveDisplayName`; tệp đọc bản chụp tên livestream phải gọi `publicNameSnapshot`. Test hành vi: `listNotifications` thật với hàng đúng hình dạng MySQL (cờ = `1`) → "Bạn đọc"; suite `notification-page-integration` (MySQL thật) thêm một người đọc gắn cờ trả lời — đỏ trên `notifications.ts` cũ (`'Ban Quản Trị'`), xanh sau sửa.
- **(W3) Bản chụp tên chat livestream ghi trước 2A.** `livestream_messages.display_name` là bản chụp lúc gửi (cố ý: đổi tên không viết lại thứ người xem đã thấy). Chọn đọc-lúc-ra thay vì ghi lại hàng lúc khởi động: `listChatHistory` → `publicNameSnapshot` (bản chụp gấp ra từ dành riêng → "Bạn đọc"; tên tự đặt không thể dành riêng nên chỉ che tên nhà cung cấp), hàng gốc giữ nguyên làm bằng chứng kiểm duyệt; không thêm lượt ghi lúc khởi động. Lịch sử không join `reader_accounts` nên giải theo cờ của người gửi sẽ thêm một join chỉ để đạt cùng kết quả.
- **(W1) Bật yếu tố + phát mã dự phòng không nguyên tử.** Bản trước bật yếu tố rồi mới phát mã: phát hỏng → yếu tố đang bật không mã, thử lại báo "không có yêu cầu chờ"; hai lượt xác nhận đồng thời cùng thấy "chưa có lô", lượt sau xoá lô lượt trước vừa hiện. Nay: băm mã TRƯỚC (`prepareRecoveryCodes`), rồi MỘT transaction: `lockAccountForMfaChange` (`SELECT … FOR UPDATE` hàng `users`) → CAS bật → nếu chưa có lô thì chèn (không bao giờ xoá). `issueRecoveryCodes` (tạo lại) giữ cùng khoá. Test (CSDL giả có hoàn tác + khoá hàng thật sự chờ): chèn hỏng → xác nhận hỏng, yếu tố vẫn `pending`, không cookie/audit, thử lại được; hai yếu tố xác nhận đồng thời → đúng một lô, mọi mã đã hiện đều đổi được; tạo lại chen giữa → một lô, tờ của lượt tạo lại đổi được — cả ba đỏ trên mã cũ. `tests/mfa-concurrency.test.ts`: CSDL giả thêm `transaction`/`for()` (lượt thua vẫn 409 từ bên trong transaction).
- **(W4) Khôi phục CSDL mang bí mật nguyên văn về.** `restoreHeldTarget` (cả khôi phục theo tên lẫn từ tệp tải lên) gọi `convertPlaintextSettingsSecrets(pool)` ngay sau khi khôi phục SQL + audit thành công; hỏng chỉ log `backup.restore_secret_conversion_failed` (CSDL đã khôi phục xong — báo thất bại là sai; lần khởi động sau vẫn chuyển). Hàm chuyển không còn tự log (mỗi nơi gọi log theo ngữ cảnh — `migrations-additive.ts` giữ các sự kiện `db.migration.settings_secret_*`). Test trong `tests/backup-restore-hardening.test.ts` (pool giả có `execute`): dump mang `smtp_pass`/`r2_secret_key` nguyên văn → envelope ngay sau khôi phục; lượt chuyển ném → khôi phục vẫn thành công + log.
- **(S2) Envelope hỏng fail closed.** JSON có khoá `sealed` của riêng nó là envelope; nhãn lạ, phiên bản lạ, thiếu trường → `unreadable` (bản trước coi là nguyên văn: nơi dùng sẽ đăng nhập bằng chính chuỗi JSON, lượt khởi động mã hoá nó lần nữa). Lượt chuyển để nguyên + báo `needsReentry`.
- **(S4) Bị khoá giữa phiên.** `app/plugins/mfa-enrollment-redirect.client.ts` + `app/utils/mfa-enrollment-redirect.ts`: hook `onResponseError` trên `$fetch` toàn cục — 403 `data.code = 'mfa_enrollment_required'` → đánh dấu `mfaEnrollmentRequired` (banner) + chuyển `/admin/profile#security` (không chuyển khi đã ở đó); lỗi khác đi tiếp như cũ. `tests/mfa-enrollment-redirect-client.test.ts` chạy plugin thật với global Nuxt giả.
- **(W2)** Runbook xoay `CHATBOT_ENCRYPTION_SECRET` (realm-safety) nay là bảng đủ tám nhãn — thêm `cdkt-ai-provider-key:v1` (AI Panel) tách khỏi `cdkt-chatbot-provider-key:v1` (trợ lý) — kèm nơi nhập lại và bước kiểm cho từng loại; `production/README.md`, `.env.example`, CLAUDE.md theo.
- Không đổi (quyết định của người dùng, W6): dưới chính sách, tài khoản thuộc diện vẫn tự tắt được mã dự phòng.
- **Lượt ghi lúc khởi động của 2A (để bộ nâng cấp lược đồ khai báo, nhánh 2F):** không đổi sau đợt sửa — (a) `settings`: mã hoá `smtp_pass`/`r2_secret_key`/`backup_drive_service_account` khi giá trị khác rỗng và chưa phải envelope (lý do: bí mật nguyên văn trong mọi bản dump; tự xoá điều kiện); (b) `reader_accounts.display_name_reserved = 1` cho hàng có `display_name` gấp ra từ dành riêng, CHỈ khi cột vừa được thêm (lý do: người đọc đang đăng nhập với tên "Admin" không đợi tới lần đăng nhập sau). Lượt chuyển sau khôi phục (W4) chạy lúc chạy, không lúc khởi động.
- Kiểm chứng sau đợt sửa: `npm test` 4380 / 4353 pass / 0 fail / 27 skip; typecheck 0 lỗi; eslint 0 error / 16 warning; `db:drift` xanh (636 cột); `npm run build` xanh (plugin client có trong bundle); `notification-page-integration` xanh trên MySQL 8 local (CSDL dùng một lần, đã xoá); E2E chọn lọc 14/14 (`admin-mfa`, `admin-login-challenge`, `admin-retry`, `admin-write-paths`, `media-portal` — các luồng chạm hook `$fetch` toàn cục và MFA), không dòng `security.cross_site_refused`, cổng 3123 trống và không còn DB `cdkt_e2e_*` sau lượt chạy. Không spec E2E nào đăng nhập người đọc (cần Google OAuth thật) — chuông thông báo được phủ bằng suite MySQL thật.

#### Sửa sau kiểm chứng lại (2026-10-24, trên `196f907` — 0 CRITICAL)
- **(W1) Guard tên người đọc bỏ lọt 5/8 biến thể.** Bản trước chỉ soi khối `.select({ … })` viết nguyên văn và kiểm "có gọi resolver" theo TỆP: lọt projection giữ trong một hằng (`.select(columns)` — đúng cách bình luận công khai được viết), SQL thô không backtick (`ra.display_name`), chuỗi `pool.query('SELECT display_name …')`, chọn nguyên hàng `reader_accounts`, và chọn cờ rồi không dùng. Nay `tests/_reader-name-guard.ts` phân tích AST theo TỪNG HÀM cấp cao nhất (bình luận không tính): đọc tên = cột `readerAccounts.displayName`/`customDisplayName` ở bất kỳ đâu (kể cả trong hằng cấp module mà hàm nhắc tới, trong `sql\`${…}\``), chuỗi/template SQL có `display_name`/`custom_display_name` (có/không backtick), hoặc `.select().from(readerAccounts)`; hàm đó phải đọc cờ VÀ gọi `effectiveDisplayName` có cờ (object literal phải có `displayNameReserved`), trực tiếp hoặc một bước qua hàm cùng tệp. Ngoại lệ theo `tệp#hàm` kèm lý do (6 hàm admin của `readers.ts`, `ai-moderate.post.ts#default`, `reader-auth.ts#resolveReader`), mục lỗi thời cũng đỏ. Tám biến thể là fixture nhúng nguyên văn: cả 8 hàm rò bị bắt, `okH` qua; chạy trên `notifications.ts` của `8149ee8` → `listNotifications` bị bắt.
- **(W2) Envelope cụt bị coi là nguyên văn.** Chuỗi bắt đầu `{` có `"sealed"` mà `JSON.parse` hỏng → `broken-envelope` (unreadable), không còn là mật khẩu, không bị bọc thêm lần khởi động sau. Test: envelope thật cắt 12 ký tự cuối.
- **(W3) Lượt mã hoá sau khôi phục chạy quá muộn.** Bản trước chạy SAU transaction audit: `restoreSql` xong mà audit/gắn lại hàng ném, hay `restoreSql` hỏng giữa chừng sau khi bảng `settings` đã bị thay → nguyên văn nằm tới lần khởi động sau. Nay chạy trong `finally` của `restoreSql` (idempotent, không ném). Test: dump hỏng giữa chừng sau khi `settings` đã thay, và audit khôi phục ném — cả hai: khôi phục báo thất bại, bí mật đã là envelope.
- **(S1)** `notification-page-integration`: `closeDb()` vào `finally` (assert đỏ không còn treo tiến trình).
- **(S2)** Hook client: một loạt 403 cùng lúc chỉ chuyển trang một lần (cờ đang-chuyển gỡ khi xong); `/admin/profile/`, `?…`, `#…` tính là trang hồ sơ (`isMfaEnrollmentPage`, dùng chung cho middleware route và banner).
- **(S3/S4)** Runbook: lệnh kiểm kê ra 6 tệp — riêng `settings-secrets.ts` giữ 3 nhãn; sau `scripts/restore-db.sh` (ngoài app) phải khởi động lại app để lượt khởi động mã hoá bí mật nguyên văn (realm-safety + `production/README.md`).
- **Rebase lên nhánh tích hợp `3ede49a`** (Wave 1 + 2E § 32 — `shared/`): một xung đột ở CHANGELOG (giữ cả § 32 lẫn § 33); không mã 2A nào dưới `server/` import `app/` (guard `server-no-app-imports`, `runtime-image-sources` xanh — đồ thị khởi động của 2A nằm trọn trong `server/`, `shared/` đã được Dockerfile chép). Kiểm chứng trên đỉnh mới: `npm test` 4495 / 4468 pass / 0 fail / 27 skip; typecheck 0 lỗi; eslint 0 error / 16 warning; `db:drift` xanh (636 cột / 62 bảng); `npm run build` xanh; `notification-page-integration` xanh trên MySQL 8 local; E2E `admin-mfa` + `admin-login-challenge` 3/3 (1,5 phút), không dòng `security.cross_site_refused`, cổng 3123 trống và không còn DB `cdkt_e2e_*`/`cdkt_notif_page_*` sau lượt chạy. Endpoint: 334 (172 `getDb()` thẳng, 214 có import `services/**`).

#### Kiểm chứng (2026-10-24, worktree `wave2/2a-security`, gốc `a7be585`)
`npm test` 4360 / 4333 pass / 0 fail / 27 skip. Typecheck 0 lỗi. eslint 0 error / 16 warning (không cảnh báo mới). `db:drift` xanh (636 cột / 62 bảng). `npm run build` xanh; thứ tự `handlers` trong `.output`: tài sản tĩnh → cổng khác site → `admin-auth`. Ảnh runtime chạy `init.ts` từ mã nguồn: đồ thị import lúc khởi động (init + seed, 30 tệp) nằm trọn trong `server/` (Dockerfile chỉ chép `server/`, `scripts/`, `public/`), gói đều trong `dependencies`. E2E (build production, cổng 3123, MySQL local): 94/94 — Playwright báo 7,4 phút trên máy đang chạy song song việc khác (lượt trước, máy nhẹ hơn: 5,1 phút), sát `globalTimeout` 480 s; không dòng `security.cross_site_refused` nào trong log của lượt chạy (cổng không chặn nhầm luồng nào của E2E); trước/sau lượt chạy cổng 3123 trống, không còn DB `cdkt_e2e_*`. Lượt E2E đầu (trước khi sửa tên `<AdminProfileActivityHistory>`) 93/94: đúng ca MFA mới đỏ ở bước "banner tắt sau khi bật".

Bằng chứng test-đỏ-trước: năm tệp test mới chạy trên bản xuất `a7be585` (`git archive`) đều đỏ — trước tiên vì module mới chưa có (cổng, endpoint chính sách, `mfa/policy`, `settings-secrets`, `reader-name-backfill`). Hành vi cũ được dò trực tiếp trên `a7be585`: `effectiveDisplayName` của tên Google "Admin" là "Admin"; khẳng định cũ `store.get('smtp_pass') === 'typed-new-password'` (lưu nguyên văn) xanh; `admin-auth`/`me`/`confirm` không có mã cưỡng chế. Riêng test mã dự phòng: chạy khi `policy.ts` đã có mà `confirm.post.ts` chưa sửa → 2 ca phát mã đỏ, 3 ca "không phát" xanh (chủ đích: giữ hành vi cũ).

### 34. Đợt 2 — 2D hộp thoại admin (2026-10-24)

OpenSpec `wave2-hardening`, nhóm 6 mục 6.1–6.3 (D-MODAL, D10; spec `admin-dialogs`, `admin-moderation-ui`). Mục 6.4 (`adminFetch`/`useAdminList`) chưa làm. Đã đọc `openspec/ui-dna.md` trước mọi thay đổi giao diện.

**1. Khung `AdminModal.vue` dùng chung** (`app/components/admin/AdminModal.vue`, `app/utils/admin-modal.ts` mới).
- Lỗi: 17 lớp phủ `fixed inset-0` ở 10 tệp admin tự viết khung — không `role="dialog"`, không `aria-modal`, không tên; Tab đi ra trang phía sau, Escape không đóng, đóng xong focus rơi về `<body>`.
- Sửa: một khung, props `open`/`title`/`busy`/`size` (`sm|md|lg|xl|2xl|drawer`) + `icon` trang trí, slot `default`/`footer`, phát `close`. Dựng trên `focus-return.ts` như `ConfirmModal`: nhớ nút mở → focus điều khiển đầu tiên đang hiện trong thân (rồi chân, rồi nút đóng) → `inertOutside` → bẫy Tab (`visibleTabbables` + `trapTabTarget`) → đóng thì gỡ `inert` TRƯỚC rồi trả focus. Teleport tới `body`, `z-[9000]` — dưới `ConfirmModal` (`z-[9999]`): hộp xác nhận mở đè lên thì hộp này bị `inert` và nhường bàn phím. Mở bằng `:open` hoặc bằng `v-if` của cha (`ContentTypePicker`) đều dọn dẹp đúng (gỡ component cũng trả focus).
- Phím nghe ở mức `document`, quyết định qua `adminModalKeyAction` (hàm thuần): nút "Lưu" bị `disabled` lúc lưu đẩy focus về `<body>` — nghe trên hộp thôi thì sau một lần lưu hỏng Escape không còn đóng được và Tab đi ra lớp toast. Phím ở lớp khác (hộp xác nhận, toast, thư viện ảnh) hoặc đã bị điều khiển bên trong `preventDefault` thì bỏ qua. `busy` chặn Escape, nút đóng và bấm nền (không chặn Tab).
- Bấm nền đóng hộp như cũ, nhưng chỉ khi cả `pointerdown` lẫn `click` ở nền (`adminModalBackdropCloses`): bôi đen chữ trong ô nhập rồi thả chuột ra ngoài khung từng đóng mất biểu mẫu đang gõ.
- Chuyển cảnh chỉ `opacity` bằng lớp Tailwind (`motion-reduce:transition-none`), không `visibility` (focus vào cây đang `hidden` bị bỏ qua — bài học `DefaultMobileDrawer`/`ChatWidget`), không `<style>`.

**2. Chuyển 17 lớp phủ** (10 tệp): `content/content-types.vue`, `content/categories/index.vue`, `content/pages/index.vue`, `content/pages/[id].vue` (hộp "Cấu hình trang" + ngăn kéo "Thêm khối" và "Phiên bản"), `users/index.vue` (tạo + sửa), `media-portal/categories.vue`, `SubmissionDetailModal.vue`, `ContentTypePicker.vue`, `ai/AiServicesTab.vue`, `ai/AiProvidersTab.vue` (5). Hai ngăn kéo của trình dựng trang có nền mờ chặn cả trang và bấm nền để đóng — tức là modal — nên dùng `size="drawer"` thay vì được miễn. Nhánh tải/lỗi/`role="alert"`/thử lại vẫn nằm trong chính tệp (guard `admin-error-retry-ui`/`skeleton-loading-ui` đọc theo tệp). Biểu mẫu người dùng giữ nút submit trong `<form>` (slot mặc định). `busy` theo cờ lưu của từng hộp; nút "Kiểm tra kết nối" (AI) không khoá hộp vì kết quả chỉ ghi vào ref. Ba khối `<style scoped>` `.modal-fade` bị gỡ. Nút xoá phiên bản (chỉ icon) có `aria-label`.
- Guard `tests/admin-modal-dialog.test.ts` quét CÂY TEMPLATE (không grep dòng) của `pages/admin`, `components/admin`, `layouts/admin.vue`: mỗi `fixed inset-0` (cả trong `:class`) phải là hộp thoại (`role="dialog"` + `aria-modal="true"`), nằm trong/bọc trực tiếp một hộp thoại, nằm trong `AdminModal`/`ConfirmModal`, hoặc có tên trong `EXEMPT_OVERLAYS` (khoá theo biểu thức `v-if`, kèm lý do; mục cũ không còn khớp → đỏ). Hai mục miễn: nền chế độ mở rộng của `builder/PropertyPanel.vue` (cùng panel phóng to tại chỗ) và nền sidebar `layouts/admin.vue` (ngăn kéo điều hướng). Ghim 17 `<AdminModal>` ở 10 tệp + import tường minh, và thứ tự z-index. Render SSR của CHÍNH `AdminModal.vue` (script + template biên dịch, props/slot/`useId` thật): vai trò, `aria-modal`, `aria-labelledby` trỏ tiêu đề, bận → `aria-busy` + nút đóng `disabled`, hai hộp hai id, kích thước.
- E2E `tests/e2e/admin-dialogs.spec.ts`: người dùng (tạo: focus vào ô đầu, Tab/Shift+Tab không rời hộp, trang `inert`, Escape đóng + focus về nút mở + tập `inert` trở về như trước, bấm nền đóng; đang lưu Escape không đóng, lưu hỏng + focus ở `<body>` thì Escape vẫn đóng; sửa: tên hộp có tên đăng nhập), danh mục, cấu hình trang, và xếp lớp: `ConfirmModal` mở đè lên ngăn kéo "Phiên bản" → ngăn kéo `inert`, Escape chỉ đóng hộp xác nhận, `inert` được gỡ, focus về nút xoá trong ngăn kéo, Tab vẫn bị bẫy, Escape lần hai đóng ngăn kéo.
- Thay đổi hình thức có chủ đích (chưa chụp ảnh so sánh — việc kiểm "không hồi quy hình ảnh, PR kèm ảnh" của nhóm 6 còn để ngỏ): mọi hộp đã chuyển có dải tiêu đề nền `#f8faf8` + nút ✕ và dải chân viền trên (hộp người dùng, tạo trang, cấu hình trang, AI trước đây không có); nút đóng của hộp chi tiết đơn đổi sang nút ✕ chung; đệm thân `px-6 py-5`; dòng phụ của ngăn kéo "Thêm khối" `text-gray-400` → `text-gray-500` (tương phản); hộp "Test Call" bỏ ô icon riêng (icon nằm trong tiêu đề). E2E chỉ chạy ở khổ desktop.

**3. Kiểm duyệt an ninh một nơi** (`ai/AiModerationTab.vue`, `app/utils/moderation-summary.ts` mới): tab AI Panel là bản chép thứ hai của `/admin/ai/moderation` (thêm/bật/tắt/xoá quy tắc, duyệt/xoá/cấm IP) và huy hiệu "chờ đối soát" đếm trên trang 20 dòng đầu. Nay tab chỉ hiện số hàng chờ (`total` của `queue?status=pending&perPage=1`) + số quy tắc đang bật / tổng + liên kết sang trang kiểm duyệt; không còn đường ghi nào. Phản hồi sai dạng → nhánh lỗi + "Thử lại", không phải "0". Tệp giữ lại làm thành phần tóm tắt (xoá cần anh duyệt). Test `tests/admin-moderation-summary.test.ts` (kịch bản spec qua render template; tổng từ máy chủ; chỉ đọc).

#### Sửa sau kiểm chứng độc lập (2026-10-24, trên `c04dd6f`)
- **(Nghiêm trọng) Mở ngăn kéo "Phiên bản" bằng Enter tự lưu một bản sao lưu.** Nút mở kích hoạt ở `keydown`, AdminModal đưa focus vào ô "Tên bản sao lưu…", phím được THẢ ở ô đó và `@keyup.enter` chạy `saveBackup()` — mất 1/4 chỗ sao lưu thủ công, xoá chữ đang gõ. Cùng lỗi ở 3 hộp MFA của `/admin/profile` (`focusFirstField` + `@keyup.enter` → báo "Vui lòng nhập mật khẩu hiện tại." khi chưa gõ gì; bước mật khẩu → bước mã cũng vậy). Đổi riêng `keyup` → `keydown` CHƯA đủ: giữ Enter quá nhịp lặp của hệ điều hành (~250–500 ms) thì các keydown LẶP rơi vào ô vừa nhận focus — mỗi lần một bản sao lưu; hộp xác nhận không nguy hiểm (focus ở nút đồng ý, vd. "Khôi phục phiên bản") bị tự đồng ý. Sửa gốc hai lớp: (1) `createHeldKeyGuard` (`app/utils/admin-modal.ts`) — AdminModal và ConfirmModal, khi mở, nuốt ở pha capture của `document` mọi keydown lặp và lần thả của phím đã giữ từ trước, tới lần nhấn mới (giữ phím của chính người dùng trong hộp không bị nuốt); (2) ô Enter trong hộp dùng `@keydown.enter` + `isDeliberateEnter` (không lặp, không `isComposing` — IME tiếng Việt chốt chữ bằng Enter) ở `pages/[id].vue`, `profile.vue` (6 ô, `submitOnEnter`), ô tìm của thư viện ảnh. KHÔNG đổi focus mở đầu của AdminModal. Guard mới: không `@keyup` nào bên trong `AdminModal`/`ConfirmModal`/`role="dialog"` của admin. `loadVersions` chỉ ghi kết quả của lượt tải MỚI NHẤT (lượt tải đầu về sau từng đè danh sách vừa có bản mới — test xếp lớp trước đó xanh nhờ thời điểm). `<main>` chỉ mang `tabindex="-1"` tạm khi nhận focus dự phòng, rời focus là gỡ.
- **6 hộp `role="dialog"` không tên chuyển sang AdminModal**: `languages/index.vue` (đổi vị trí; tiến trình dịch AI — đang dịch = `busy`), `content/articles/[id].vue` (nhắc dịch lại), `ArticleQuickViewModal`, `ArticleGlobalTranslateModal`, `MediaLibraryModal` (`size="2xl"`, ô tìm `data-autofocus` + `aria-label`, nút trang có tên). Guard đòi MỌI `role="dialog"` có `aria-label`/`aria-labelledby` (bind không được có thể ra `undefined`) — `ConfirmModal` không tiêu đề nay lấy tên từ câu hỏi. Nhánh lỗi/`role="alert"`/thử lại ở nguyên tệp; `v-html` của xem nhanh giữ nguyên biểu thức (kiểm kê không đổi).
- **Huy hiệu "chờ đối soát" của `/admin/ai/moderation`** đếm `queue.filter` trên trang 20 dòng → `pendingBadgeCount` (`app/utils/moderation-summary.ts`): đang lọc `pending` dùng `total` của truy vấn, lọc khác dùng `pendingQueueCount` của `worker-status`; xử lý một hàng xong làm mới cả worker-status. Trang và tab tóm tắt nay cùng một con số.
- **Trả focus khi nút mở đã bị gỡ** (hộp chi tiết đơn: đổi trạng thái → bảng tải lại → nút "Xem & xử lý" bị vẽ lại): AdminModal nhớ khoá `data-admin-modal-opener` (hoặc `id`) lúc mở, tìm lại nút cùng khoá, không thấy thì focus `<main>` (gắn `tabindex="-1"`) — không bao giờ để ở `<body>`.
- **Focus chỉ định**: phần tử `data-autofocus`/`autofocus` (đang hiện, Tab tới được) thắng ô đầu tiên của thân.
- **Xếp lớp theo thứ tự MỞ**: `z-index` = 9000 + thứ tự mở (luôn < 9999). Thư viện ảnh mount sớm nhất trong `<body>`, cùng z-index thì luôn nằm dưới một hộp mở sau.
- **Guard rộng hơn**: lớp phủ ghép cạnh (`fixed top-0 left-0 w-full h-full`, `inset-x-0 inset-y-0`…) cũng bị bắt; lớp phủ có nội dung lồng trong thân hộp thoại/AdminModal là hộp lồng không ngữ nghĩa (chỉ nền mờ TRỐNG, con trực tiếp của hộp, được chấp nhận).
- **Test thử lại thật**: `admin-moderation-summary` chạy chính `<script setup>` của tab (biên dịch thật, `$fetch` giả) và gọi `onClick` của nút "Thử lại" trong template đã biên dịch — gọi lại đúng hai endpoint, xoá lỗi, hiện số mới (thay cho `retried === 0` không chứng minh gì).

#### Sửa sau kiểm chứng lần 2 (2026-10-24, trên `e729115`)
- **Focus vẫn rơi về `<body>` khi đóng hộp.** `createFocusReturn().restore()` (`app/utils/focus-return.ts`) báo "đã trả" mỗi khi nút mở còn trong DOM, không kiểm focus có thật sự tới — nút mở `disabled` (đóng hộp tiến trình dịch bằng "Đóng cửa sổ" lúc đang dịch: nút "Dịch AI" bị khoá) hay `<main>` đã mất `tabindex` tạm thì `focus()` không làm gì, đường dự phòng của AdminModal bị bỏ qua. Sửa gốc: `restore()` trả `activeElement === nút mở` (dùng chung cho ConfirmModal, ngăn kéo mobile, hộp chat). Chuỗi trả focus của AdminModal: nút mở (nếu focus thật sự tới) → nút cùng khoá `data-admin-modal-opener` → đỗ ở `<main>` (`tabindex="-1"` tạm, có dấu `data-admin-modal-focus-park`, rời focus là gỡ) rồi THEO DÕI DOM tối đa 4 giây chờ nút cùng khoá xuất hiện/hết `disabled` (bảng tải lại qua skeleton) và chuyển về nó nếu focus vẫn đang đỗ. Nơi đỗ tạm KHÔNG bao giờ được nhớ làm nút mở (`rememberableOpener`) — mở hộp khác trong lúc focus đang đỗ (bấm chip `<span>` của xem nhanh) từng trả focus về `<main>` đã mất `tabindex` → `<body>`. Khoá đánh dấu thêm ở nút "Sửa"/"Thêm con" của người dùng, thể loại, danh mục, danh mục video, nút "Dịch AI" của ngôn ngữ.
- **Focus rơi khỏi hộp đang mở.** Điều khiển đang giữ focus bị gỡ (xoá một phiên bản qua hộp xác nhận: nút xoá của hàng biến mất khi danh sách tải lại; "Dừng lại" biến mất khi dịch xong) hoặc bị `disabled` → trình duyệt đẩy focus về `<body>`. AdminModal theo dõi DOM của chính hộp (`MutationObserver`: con, `disabled`/`inert`/`hidden`) và kéo focus về lại (như lúc mở) khi focus rơi ra `<body>` mà hộp không bị lớp khác phủ. ConfirmModal không trả được focus về nút mở thì ở lại hộp thoại đã chứa nút đó (nếu còn mở, không bị phủ), không thì đỗ ở `<main>`.
- **Enter trong hộp thoại**: `isDeliberateEnter` thêm `keyCode !== 229` (Safari chốt chữ của bộ gõ tiếng Việt bằng keydown `isComposing: false`, `keyCode: 229`). Ô nhập của hộp hỏi `ConfirmModal` (lý do chặn bạn đọc…) bỏ `@keydown.enter.prevent="accept"` trần, dùng `onPromptEnter` + `isDeliberateEnter`. Guard nay BẮT BUỘC: mọi `@keydown.enter` bên trong hộp thoại admin phải lọc bằng `isDeliberateEnter` (trong biểu thức hoặc thân hàm cùng tệp).
- **Huy hiệu "chờ đối soát"**: worker-status hỏng → ẩn (`null`), không hiện "0"; vừa bấm đổi bộ lọc mà hàng đợi chưa tải xong không hiện tổng của bộ lọc trước (`queueTotalFilter` chỉ đổi khi phản hồi của chính bộ lọc đó về).
- **Nhỏ**: Escape của ConfirmModal đánh dấu đã xử lý và `PropertyPanel` bỏ qua Escape đã bị xử lý — đóng thư viện ảnh/hộp xác nhận mở từ panel mở rộng không thu nhỏ luôn panel; biểu tượng hộp tiến trình dịch quay lại khi đang dịch (`animate-spin motion-reduce:animate-none`); guard bắt `aria-labelledby` trỏ tới id không có trong template.

#### Kiểm chứng
- **Lượt 1** (`c04dd6f`, 2026-10-24): `npm test` 4306 / 4279 pass / 0 fail / 27 skip. Typecheck 0 lỗi, eslint 0 error / 16 warning, build xanh (lần đầu đỏ vì cache `node_modules/.cache/nuxt` cũ — xoá cache, build lại xanh). Bộ E2E đủ 99/99 (4,3 phút). Nhưng ca xếp lớp chỉ xanh nhờ thời điểm: mở ngăn kéo bằng `keyboard.press('Enter')` đã tự lưu một bản sao lưu ngay trong chính ca đó (lỗi nghiêm trọng ở trên), và lượt tải danh sách đầu có thể đè danh sách mới.
- **Lượt 2** (sau các sửa ở trên, kể cả nuốt phím lặp): `npm test` 4317 / 4290 pass / 0 fail / 27 skip. Typecheck 0 lỗi. eslint 0 error / 16 warning (cảnh báo duy nhất ở tệp đã đổi là `vue/no-v-html` có sẵn của xem nhanh, cùng biểu thức đã kiểm kê). Build xanh. E2E chạy theo spec (không chạy cả bộ — máy tải nặng, nhiều agent dùng chung cổng 3123): `admin-dialogs` 11/11 + `admin-mfa`, `admin-write-paths`, `submission-workflow`, `admin-retry`, `media-portal`, `admin-login-challenge` = 26/26 (2,6 phút); cổng 3123 trống trước/sau, không còn DB `cdkt_e2e_*`. Một lượt chạy bị agent khác chiếm cổng giữa chừng (đăng nhập vào máy chủ/CSDL của họ, đỏ sai lý do) — chạy lại khi cổng và tiến trình Playwright đều trống. Chưa có ca trình duyệt riêng cho hộp ngôn ngữ ×2, nhắc dịch lại, xem nhanh, dịch toàn bộ — chúng được che bởi guard + test chung của AdminModal.
- **Lượt 3** (sau "Sửa sau kiểm chứng lần 2", trước khi rebase lên `wave1/integration`): `npm test` 4324 / 4297 pass / 0 fail / 27 skip. Typecheck 0 lỗi. eslint 0 error / 16 warning. Build xanh. E2E `admin-dialogs` 16/16 (1,4 phút) — thêm ca xoá phiên bản trong ngăn kéo, sửa người dùng rồi lưu (focus về nút "Sửa" vẽ lại), tiến trình dịch AI ×2 (dịch xong lúc đang mở; đóng lúc nút mở bị khoá → đỗ `<main>` rồi về nút khi dịch xong), xem nhanh mở từ chip + nhắc dịch lại.
- **Sau rebase lên `wave1/integration` (`3ede49a`, gồm 2E § 32)**: `npm test` 4434 / 4407 pass / 0 fail / 27 skip. Typecheck 0 lỗi, eslint 0 error / 16 warning, build xanh. E2E `admin-dialogs` 16/16 + `admin-write-paths` + `submission-workflow` = 20/20 (3,0 phút); sau đó thêm hai ca hộp "chuyển đến vị trí nào?" của ngôn ngữ và "Dịch toàn bộ bài viết" (từ kịch bản R5/R6 của lượt kiểm chứng lần 2), chạy `admin-dialogs` 18/18 cùng hai spec hộp thoại công khai dùng chung `restore()` — `chat-widget-focus` 2/2, `mobile-drawer-focus` 12/12 — 32/32 (4,2 phút); cổng 3123 trống trước/sau, không còn DB `cdkt_e2e_*`. Xung đột duy nhất: `docs/CHANGELOG.md` (giữ cả § 32 và § 34). Hộp còn CHƯA có ca trình duyệt riêng: 5 hộp AI (nhà cung cấp/model), hộp dịch vụ AI, thể loại, danh mục video, chọn thể loại (`ContentTypePicker`) — che bởi guard + test chung của AdminModal. Đường lùi của ConfirmModal (nút mở đã bị gỡ ngay lúc hộp xác nhận đóng → ở lại hộp chứa nó, không thì đỗ `<main>`) CHƯA có ca kiểm hành vi: ca xoá phiên bản đi qua bộ theo dõi của AdminModal (nút mở còn khi hộp xác nhận đóng). `content/pages/index.vue` không gắn khoá nút mở: tạo trang xong điều hướng sang trình dựng, không có thao tác hàng nào đóng hộp rồi tải lại.

Test-đỏ-trước:
- Đo trên `a7be585`: `admin-modal-dialog` 12/14 đỏ — guard liệt kê đúng 17 lớp phủ trần (15 hộp + 2 ngăn kéo), các test ghim/z-index/render/quyết định đỏ vì `AdminModal.vue`/`admin-modal.ts` chưa có; 2 test xanh là self-test của bộ phân loại và kiểm mục miễn. `admin-moderation-summary` 5/5 đỏ.
- Đo trên `c04dd6f`: guard tên đỏ với 7 hộp (6 hộp trên + `ConfirmModal` không tiêu đề); guard `@keyup` đỏ với 8 ô (`pages/[id].vue`, `MediaLibraryModal`, `profile.vue` ×6); test helper (focus chỉ định, trả focus dự phòng, xếp lớp) và huy hiệu kiểm duyệt đỏ. E2E trên bản build `c04dd6f`: "giữ Enter mở ngăn kéo Phiên bản" đỏ (có `POST /versions`), "giữ Enter mở hộp Bật" đỏ (hiện `role="alert"`). Ca "trả focus khi nút mở bị gỡ" đỏ trên bản cũ vì thuộc tính `data-admin-modal-opener` chưa có (thuộc tính là một phần của bản sửa — không phải bằng chứng hành vi). Test thử lại thật xanh trên cả mã cũ: nối dây vốn đúng, test cũ chỉ yếu.
- Đo trên bản build có `keydown` nhưng CHƯA nuốt phím lặp: E2E giữ Enter + 3 keydown lặp (`event.repeat` được ghi lại ở trang: `[false, true, true, true]`) đỏ cả ba — ngăn kéo vẫn `POST /versions`, hộp "Bật" vẫn hiện `role="alert"`, hộp xác nhận "Khôi phục phiên bản" tự đồng ý (hộp đóng, phiên bản bị nạp). Ca thư viện ảnh khi đó xanh SAI vì chỉ đếm request sau khi hộp đã mở — đã sửa để đếm từ trước khi mở (đúng 1 lượt tải).

- Đo trên bản build `e729115` (spec E2E mới, dựng từ kịch bản R2b/R4–R6 của lượt kiểm chứng lần 2): "xoá phiên bản qua hộp xác nhận trong ngăn kéo" đỏ (focus không còn trong ngăn kéo khi hàng bị gỡ); "xem nhanh mở lại lúc focus đang đỗ ở `<main>`" đỏ (focus rơi về `<body>`). Ba ca người dùng/ngôn ngữ đỏ trên bản cũ vì thuộc tính `data-admin-modal-opener` chưa có (không phải bằng chứng hành vi). Unit: `restore()` trả focus về nút "disabled" đỏ với thân hàm cũ (`return true`); `keyCode 229`, các hàm đỗ focus/kéo focus về, huy hiệu kiểm duyệt mới và guard `@keydown.enter` (bắt `ConfirmModal.vue` ô hỏi `accept`) đỏ trước khi sửa.

**Còn mở sau 2D** (không sửa ở đây): (a) nút "Hủy" trong thân/chân hộp vẫn đóng được lúc `busy` (chỉ Escape, ✕ và bấm nền bị chặn) — giữ hành vi cũ có chủ đích; (b) ô ảnh trong thư viện ảnh là `<div @click>` — chưa chọn được bằng bàn phím; (c) chưa chụp ảnh so sánh, E2E chỉ ở khổ desktop; (d) xoá một HÀNG qua ConfirmModal ở trang danh sách (người dùng, danh mục…): hộp xác nhận trả focus về nút xoá, rồi danh sách tải lại gỡ nút đó → focus về `<body>` khi KHÔNG còn hộp nào mở (ngoài phạm vi AdminModal) — việc của 6.4 `useAdminList` / Wave 3.

### 35. Đợt 2 — 2C hiệu năng (2026-10-24)

OpenSpec `wave2-hardening` nhóm 4 (task 4.1–4.4), design D6 + D8, spec `most-read-ranking`. Mỗi test mới đỏ trên `3ede49a` trước khi sửa.

**4.1 — Tổng lượt xem theo bài (D6).** `articles` thêm `view_total_real BIGINT NOT NULL DEFAULT 0`, `view_total_fabricated BIGINT NOT NULL DEFAULT 0`, `view_total BIGINT NOT NULL DEFAULT 0` (= thật + ảo, **cột thường** do đường ghi giữ trong cùng câu lệnh — d079453 từng khai nó là cột sinh STORED, xem *Sửa sau kiểm chứng độc lập* bên dưới) và index `articles_status_type_views_idx (status, type, view_total, published_at, created_at)` — **5 cột, lệch có chủ đích khỏi 3 cột của D6**: với `(status, type, view_total)` optimizer bỏ qua index cho `ORDER BY view_total, published_at, created_at` của spec (chọn `articles_status_type_pub_idx` + filesort, 0,88 ms ở 1 100 bài) nên mỗi lượt xem trả phí cập nhật một index không ai đọc; 5 cột → đọc ngược thẳng trên index, 0,28 ms. Cùng tên, cùng tiền tố (EXPLAIN ở `data-layer.md`). Khai ở cả ba nơi: `schema.ts`, thân CREATE TABLE `schema-tables/content.ts`, `ensureColumn`/`ensureIndex` trong `convergeArticleViewTotals` (`migrations-additive.ts`). `tests/article-list-indexes.test.ts` canh index ở cả ba nơi.
- **`db:drift` nay so cả cột sinh** (`stored`/`virtual`/thường). Trước đó `view_total BIGINT` ở schema.ts và `view_total BIGINT AS (…) STORED` ở DDL đọc như nhau — đã thử: bỏ `.generatedAlwaysAs` khỏi schema.ts thì bộ kiểm cũ vẫn xanh, bộ kiểm mới báo `LỆCH CỘT SINH`. Script tách thành các hàm export (`parseDdlColumn`, `tablesFromDdl`, `tablesFromSchema`, `compareSchemas`), `main()` chỉ chạy khi gọi trực tiếp; `tests/schema-drift-generated-columns.test.ts` (nay còn chặn: **không cột nào của ta là cột sinh**). 638 cột / 62 bảng.
- **Lượt ghi lúc khởi động — khai báo cho bộ kiểm nâng cấp** (`tests/schema-upgrade-integration.test.ts`, nhánh `wave2/2f`; cần thêm vào danh sách conversion đã khai khi tích hợp):

  | Vị trí | Ghi gì | Điều kiện kích hoạt (trạng thái lược đồ) | Lý do |
  |---|---|---|---|
  | `migrations-additive.ts` `reconcileArticleViewTotals` (gọi từ `convergeArticleViewTotals`, **mỗi** lần khởi động) | `UPDATE articles a LEFT JOIN (SELECT article_id, SUM(real_views) AS r, SUM(fabricated_views) AS f FROM article_view_daily GROUP BY article_id) s ON s.article_id = a.id SET a.view_total_real = COALESCE(s.r, 0), a.view_total_fabricated = COALESCE(s.f, 0), a.view_total = COALESCE(s.r, 0) + COALESCE(s.f, 0), a.updated_at = a.updated_at WHERE a.view_total_real <> COALESCE(s.r, 0) OR a.view_total_fabricated <> COALESCE(s.f, 0) OR a.view_total <> COALESCE(s.r, 0) + COALESCE(s.f, 0)` | không cờ, không trạng thái lược đồ: **chỉ những bài có tổng khác tổng hàng theo ngày** (CSDL đã khớp → 0 hàng bị ghi) | đưa ba cột tổng về đúng tổng `article_view_daily`: lúc nâng cấp (cột mới = 0), sau một lượt lùi về image không biết tới tổng rồi quay lại, sau một lượt khởi động bị cắt ngang; chỉ đổi ba cột tổng, không đổi `updated_at` |
  | `migrations-additive.ts` `convergeArticleViewTotals` | `ALTER TABLE articles MODIFY COLUMN view_total BIGINT NOT NULL DEFAULT 0` | `view_total` còn là cột sinh (`EXTRA = 'STORED GENERATED'` — chỉ CSDL đã chạy d079453) | đổi cột sinh thành cột thường, MySQL giữ nguyên giá trị; lượt đổi tự xoá điều kiện của nó |

  Kèm theo là DDL: ba `ALTER TABLE articles ADD COLUMN … BIGINT NOT NULL DEFAULT 0` (cột thường: MySQL 8 thêm tức thì, không dựng lại bảng) và một `ADD INDEX`. **Ghi chú cho bộ kiểm nâng cấp (nhánh `wave2/2f`):** fixture hiện **không** seed `article_view_daily`, nên ở đó lượt đối soát không ghi hàng nào (mọi bài có tổng 0 = tổng 0) — điều kiện "khởi động 2 không đổi gì" vẫn kiểm được, nhưng nhánh "ghi khi lệch" chỉ được phủ khi suite đó seed vài hàng `article_view_daily` (việc tiếp theo ở 2F; hành vi đã có test MySQL thật ở `view-boost-integration`).
- **`updated_at = updated_at`** trong lượt đối soát (cột `ON UPDATE CURRENT_TIMESTAMP`; câu SQL của design thiếu vế này → mọi bài có lượt xem sẽ đổi "lần sửa cuối").
- MySQL thật (`tests/view-boost-integration.test.ts`, test thứ hai): CSDL mới → `view_total` là cột thường NOT NULL, index 5 cột; lệch kiểu "lùi bản" (bài có hàng ngày nhưng tổng 0; bài có tổng mà không hàng ngày) → đối soát sửa **đúng 2 bài**, gọi lại → 0; image cũ đếm thêm → khởi động sửa đúng bài đó, khởi động lần hai **không đổi hàng nào** (so ảnh chụp từng hàng); nâng cấp từ bản trước 2C → cùng kết quả; CSDL của d079453 (cột sinh) → đổi sang cột thường, giữ giá trị, ghi được.
- Đo (giả lập bản trước, bài 20 KB, 30 hàng ngày/bài, MySQL dev trên đĩa): lượt nâng cấp 1 100 bài → 0,9 s, 5 000 bài (159 MB) → 2,4 s (cột thường không dựng lại bảng — bản cột sinh mất 3,6 s / 23 s); **mỗi lần khởi động sau** lượt đối soát (CSDL đã khớp, không ghi gì) tốn 41 ms ở 1 100 bài / 33 000 hàng ngày và 179 ms ở 5 000 bài / 150 000 hàng ngày; 0 bài lệch tổng, 0 bài đổi `updated_at`.
- **Bản sao lưu trong app bỏ cột sinh** (`server/services/backup-sql.ts` — tệp ngoài danh sách của task): quy tắc chung, vô hại, giữ lại — `dumpSql` liệt kê cột theo `information_schema.COLUMNS` với `EXTRA NOT IN ('STORED GENERATED','VIRTUAL GENERATED')` (**không** `LIKE '%GENERATED%'`: trên 8.0.46 `created_at`/`updated_at` mang `DEFAULT_GENERATED`). Nay kiểm bằng bảng fixture có cột sinh STORED + VIRTUAL (`tests/backup-dump-integration.test.ts` test 5); `articles.view_total*` là dữ liệu thường và được dump. `tests/backup-sql-mode.test.ts`: fake connection trả danh sách cột. `scripts/backup-db.sh` (mysqldump) vốn đã bỏ cột sinh.
- **Còn mở (không chặn):** khôi phục trong app không chạy di trú sau đó. Khôi phục một bản dump **trước 2C** → bảng `articles` thiếu ba cột tới lần khởi động lại; trong khoảng đó mọi lượt đọc `articles.view_total` (trang bài, "Đọc nhiều", danh sách admin) và mọi lượt đếm báo lỗi. Khởi động lại thì lượt đối soát dựng lại tổng từ hàng theo ngày vừa khôi phục. Đề xuất: chạy `applyAdditiveMigrations` sau khi khôi phục.

**4.2 — Đường ghi.** `recordArticleView` và `addFabricatedViews` (`server/services/article-views.ts`) cộng cột tổng tương ứng **trong cùng transaction** với upsert hàng theo ngày: có `executor` (boost tức thì, transaction audit của `boost.post.ts`) thì dùng nó; không có (lượt xem thật, scheduler tăng dần) thì tự mở transaction. Hai quyết định đã trả giá bằng số đo:
- **`articles` ghi TRƯỚC hàng theo ngày.** Chèn một hàng `article_view_daily` mới giữ khoá S trên hàng `articles` cha (kiểm FK); cộng tổng sau đó thì hai transaction cùng bài (hai nguồn lượt xem đầu ngày, hoặc lượt xem thật cạnh một lượt giao boost) mỗi bên giữ khoá S và chờ khoá X của bên kia → deadlock, và `view.post.ts` nuốt lỗi → mất lượt xem im lặng. Integration bắn 20 lượt xem đồng thời (4 nguồn) + 2 lượt boost vào một bài ở một ngày mới: không lượt nào hỏng, tổng = tổng hàng theo ngày.
- **`updated_at = updated_at`** ở câu UPDATE: không có thì mỗi lượt xem đổi "lần sửa cuối" của bài.
- `tests/view-totals-integrity.test.ts` (SQL thật của Drizzle, transaction giả commit/huỷ): thứ tự `articles` → hàng ngày, cả hai trên một executor, không câu nào chạy trên pool, hỏng câu thứ hai huỷ câu thứ nhất, lượt xem thật không chạm tổng ảo và ngược lại; guard "chỉ `article-views.ts` ghi hàng theo ngày hoặc đọc/ghi phần thật/ảo" ngoài `server/db/`. Bất biến trung thực giữ nguyên: thật và ảo vẫn hai cột riêng, API công khai chỉ trả tổng gộp `viewTotal` như trước.

**4.3 — Đường đọc.** `GET /api/public/articles?sort=views` sắp theo `articles.view_total DESC, published_at DESC, created_at DESC` — bỏ truy vấn con tương quan trên `article_view_daily` và bỏ `COUNT(*)` (khối "Đọc nhiều" là top-N; `pagination.total` = `offset + số bài trả về`, cận dưới khi trang đầy — ghi ở handler, ghim trong test). `articles/[slug].get.ts`, danh sách admin và `export-csv` đọc cột `view_total` (NOT NULL). `tests/most-read-ranking.test.ts` chạy handler thật: Drizzle biên dịch bằng phương ngữ MySQL, chạy trên SQLite trong bộ nhớ với ba cột tổng đúng như đường ghi để lại và **không có** bảng `article_view_daily` → A (10 + 5) đứng trước B (12 + 0), hoà thì bài mới hơn trước, đúng một câu truy vấn.
- **Thể loại lưu dưới hai tên** (`type=reintegration` → `reintegration` + `reintegration_model`): `type IN (…)` không đọc theo thứ tự index được — EXPLAIN: `Filter: type in (…)` trên `status_idx`/`articles_status_category_pub_idx` + **filesort** mọi bài của hai thể loại (1,46 ms ở 1 100 bài, 6,24 ms ở 5 000). `sort=views` nay đọc **từng tên một** (`type = ?`, mỗi lượt `LIMIT offset + limit`, đọc ngược trên `articles_status_type_views_idx`), trộn theo cùng thứ tự rồi cắt trang ở handler: 0,57 ms / 0,63 ms cho cả hai lượt. Danh sách thường của thể loại đó vẫn một câu `IN (…)` + `COUNT`. `tests/most-read-ranking.test.ts`: thứ tự trộn, phân trang qua ranh giới hai tên, và **hình dạng câu lệnh** (hai câu `type = ?`, không `in (`, không `offset`, không `count(`). `tests/correlated-subquery-qualification.test.ts`: mọi handler `server/api/**` không đọc `article_view_daily` (bỏ qua chú thích), `sort=views` sắp theo cột chứ không theo alias.
- Số đo (1 100 bài / 33 000 hàng ngày): "Đọc nhiều" cũ 14,0 ms + `COUNT` 0,4 ms → mới 0,28 ms (đọc ngược trên `articles_status_type_views_idx`); 5 000 bài: 63,7 ms → 0,27–0,31 ms. Top-6 giống bản cũ theo bộ (tổng, ngày đăng, ngày tạo); id chỉ khác giữa những bài hoà trọn cả ba khoá — thứ tự đó MySQL không xác định (dữ liệu đo lặp ngày mỗi 900 bài).

**4.4 — Ghi analytics (D8), theo số đo — lệch có chủ đích so với chữ "total cuối".** `storeAnalyticsPageView`: sự kiện thô → **mọi** hàng dedupe (theo khách, không ai chờ) → các bucket phút với **`total` đầu tiên**; NOC vẫn ghi sau commit. Đặt `total` cuối như chữ D8 làm ~37 % lượt xem chết vì `ER_LOCK_DEADLOCK` dưới 10 yêu cầu đồng thời (bản cài đầu tiên làm đúng chữ đó và đã đo được điều này qua endpoint thật — 820/2000 lượt 500): hai bảng live có PK tự tăng cạnh khoá tự nhiên, nên mỗi `INSERT … ON DUPLICATE KEY UPDATE` giữ khoá X next-key trên supremum của PK tới commit; `total` đầu tuần tự hoá pha bucket mỗi phút. Bản giao giữ `total` đầu nhưng dồn mọi dedupe lên trước, nên hàng nóng chỉ bị giữ qua các upsert bucket — đúng mục đích của D8. `tests/analytics-ingestion.test.ts` ghim thứ tự (đỏ trên `3ede49a`).
- **Số đo qua endpoint** (hai bản build chỉ khác tệp này, xen kẽ, 75 s/lượt, datadir tmpfs): 10 đồng thời 460–467 → 544–572 lượt nhận/s, p95 29,6–29,7 → 23,1–25,6 ms, deadlock 22–39 → 0 **trong mỗi lượt 75 s đo được** (không phải "không còn deadlock": xem câu dưới và mục thử lại), thời gian chờ khoá hàng 572 → 468 s; 40 đồng thời 484–492 → 548–573/s, p95 ~101 → 90–96 ms, deadlock ~40 → 0. Datadir trên đĩa (độ bền production): fsync lúc commit chi phối, hai bản như nhau trong nhiễu, không deadlock. **Không về 0 ở mọi tải:** bộ mô phỏng chạy 185 s liền (khách lặp lại trong phút) còn 3,9 % (10 đồng thời) / 2,3 % (40) transaction deadlock, so với 37,7 % / 39,1 % của thứ tự cũ; ở 40 đồng thời đuôi trễ của bản giao dài hơn (p95 258 ms so với 62 ms — thứ tự cũ "nhanh" một phần vì 39 % chết sớm). Bốn thứ tự so sánh, bản dump deadlock, bảng đầy đủ → `docs/decisions/data-layer.md` § "Đợt 2 — 2C".
- **Không làm batching.** p95 > 50 ms: tmpfs 10 đồng thời 23–26 ms (dưới ngưỡng); 40 đồng thời 90–96 ms (phần lớn là chờ pool 10 kết nối); trên đĩa btrfs máy dev 118–132 ms **ngay ở 1 đồng thời** (fsync binlog mỗi commit, ba commit mỗi lượt xem). Batching giảm đúng chi phí đó, nhưng số đĩa là của máy dev — đề xuất đo p95 trên VPS trước; quyết định thuộc về người điều phối.
- **Đề xuất tiếp (ngoài phạm vi):** đổi PK của `analytics_live_minute_buckets`/`analytics_live_deduplication` thành khoá tự nhiên (bỏ `id` tự tăng) — gỡ tranh chấp supremum tận gốc.

#### Sửa sau kiểm chứng độc lập (2026-10-24, sau commit d079453)
Mỗi mục có test đỏ trên d079453 trước khi sửa (MySQL 8.0.46 thật cho mục 1).
- **NGHIÊM TRỌNG — lùi bản qua 2C làm hỏng sao lưu và để tổng lệch mãi.** `deploy-remote.sh` tự lùi image khi healthcheck hỏng, **sau** khi image mới đã chạy `init.ts`. Image cũ (`3ede49a`) dump `SELECT *` — gồm cả `view_total` khi đó là cột sinh STORED — vào mọi bản sao lưu trong app, kể cả bản `pre-restore`; khôi phục bản đó chết với `ER_NON_DEFAULT_VALUE_FOR_GENERATED_COLUMN` (3105) và để `articles` dở dang. Image cũ cũng đếm lượt xem không cộng tổng; khi quay lại, index đã có nên lượt "điền một lần" không bao giờ chạy lại → tổng lệch vĩnh viễn. Sửa gốc (đường lùi của chính D6):
  - `view_total` thành **cột thường** `BIGINT NOT NULL DEFAULT 0`, do `article-views.ts` cộng **trong cùng câu UPDATE** với nửa thật/ảo. Không còn cột sinh nào → bản dump của image cũ khôi phục được, image cũ không tạo ra bản dump hỏng. CSDL đã chạy d079453 được đổi cột sinh → cột thường lúc khởi động (MySQL giữ giá trị). Index 5 cột giữ nguyên.
  - Lượt "điền một lần khoá theo index" thay bằng **đối soát mỗi lần khởi động** (`reconcileArticleViewTotals`, bảng khai báo ở trên): chỉ ghi bài có tổng ≠ tổng hàng theo ngày, ghim `updated_at`, CSDL khớp thì không ghi gì. Chữa cả lượt nâng cấp lẫn mọi độ lệch sau một lượt lùi/tiến.
  - `backup-sql.ts`: giữ quy tắc bỏ cột sinh (đúng cho mọi bảng, vô hại), nay kiểm bằng fixture có cột sinh thật.
  - Test MySQL thật: (1) bản dump kiểu image cũ (`SELECT *` mọi cột, có giá trị `view_total`) khôi phục được vào lược đồ hiện tại — đỏ với 3105 trên d079453; (2) giả lập lệch (hàng ngày thêm mà không cộng tổng) → khởi động kế tiếp sửa đúng những bài đó, khởi động lần hai không đổi hàng nào; (3) 20 lượt xem + 2 lượt boost đồng thời giữ tổng = tổng hàng ngày, và lượt đối soát ngay sau đó trả 0.
  - Ghi chú vận hành: `production/README.md` + `CI-CD.md` § Lùi phiên bản.
- **Analytics: deadlock còn sót được thử lại** (`storeAnalyticsPageView`). Thứ tự câu lệnh giảm deadlock ~10 lần nhưng không về 0 khi tải kéo dài, và mỗi nạn nhân là một lượt xem mất kèm 500. Nay: tối đa **3 lần** cho `ER_LOCK_DEADLOCK` (1213, tìm cả trong chuỗi `cause` Drizzle bọc ngoài), nghỉ ngẫu nhiên 5–25 ms giữa hai lần. Lặp nguyên transaction là an toàn: InnoDB huỷ trọn transaction của nạn nhân và lớp bọc transaction rollback khi có lỗi, nên không gì của lần hỏng còn lại — hàng dedupe cũng không — và lần thử lại đếm khách đúng như lần đầu. **Không** thử lại `ER_LOCK_WAIT_TIMEOUT` (1205): lượt đó đã chờ `innodb_lock_wait_timeout` (50 s), thử lại chỉ giữ yêu cầu lâu hơn trên một máy chủ đang quá tải. `tests/analytics-ingestion.test.ts`: deadlock bơm vào → thử lại, ghi một lần, dedupe không bị tính hai lần; 3 deadlock liên tiếp → lỗi, không gì được ghi; khoảng nghỉ có giới hạn; timeout và lỗi khác không thử lại. Câu "analytics không còn deadlock khi tải cao" trong tiêu đề commit d079453 là nói quá: số đúng là 0 trong mỗi lượt đo 75 s qua endpoint, 3,9 % / 2,3 % transaction trong bộ mô phỏng 185 s — nay các nạn nhân đó được thử lại tối đa 3 lần. **Chưa đo** tỉ lệ lượt xem còn mất sau khi thử lại: deadlock dưới tải dồn theo cụm chứ không độc lập, nên ba lần chưa chắc đủ trong một cơn bão; test chỉ chứng minh thử lại có chạy và không đếm trùng.
- **`type=reintegration` + `sort=views` dùng index** — mục 4.3 ở trên.
- **Trần trang của `sort=views`** (kiểm chứng lại 88e384f, S1). Lượt đọc theo từng tên lưu lấy `LIMIT offset + limit`; với trần chung `MAX_PAGE` (100 000), một yêu cầu ẩn danh `?type=reintegration&sort=views&limit=50&page=100000` đọc `LIMIT 5 000 000` mỗi tên — chở mọi bài đã xuất bản của thể loại về Node. Nay `sort=views` có trần riêng `MOST_READ_MAX_PAGE = 10` (khối "Đọc nhiều" chỉ dùng trang 1, 6 bài): tối đa 10 × 50 = 500 hàng mỗi lượt đọc. Vượt trần thì kẹp về trang 10 như `finitePositive` vẫn kẹp ở `MAX_PAGE`, cùng hình dạng phản hồi, `pagination.page` báo trang đã phục vụ; danh sách thường giữ trần cũ. `tests/most-read-ranking.test.ts` đọc tham số LIMIT thật (đỏ trên 88e384f: 5 000 000).

**Kiểm chứng d079453 (2026-10-24, worktree `wave2/2c-perf` trên `3ede49a`):** `npm test` 4418 / 4389 pass / 0 fail / 29 skip. Typecheck 0 lỗi. eslint 0 error / 16 warning. `db:drift` 62 bảng / 638 cột (cột sinh được so). `nuxt build` xanh. MySQL 8.0.46 thật (chạy lại sau khi đổi index sang 5 cột): `view-boost-integration` 2/2 (đảo thứ tự thành hàng-ngày-trước thì đợt bắn đồng thời đỏ vì deadlock — đã thử rồi trả lại), `backup-dump-integration` 6/6. E2E 39/39 (`public-list-pagination`, `public-detail-status`, `admin-write-paths`, `analytics-ingestion`).

**Kiểm chứng bản sửa sau kiểm chứng độc lập (2026-10-24, trên d079453):** test mới/đổi đỏ trên d079453 — 9 test đơn vị (đường ghi `view_total`, chặn cột sinh, hình dạng câu `reintegration`, thử lại deadlock), `view-boost-integration` 2/2 đỏ (`reconcileArticleViewTotals` chưa có), `backup-dump-integration` 2 test mới đỏ với `ER_NON_DEFAULT_VALUE_FOR_GENERATED_COLUMN` (3105). Sau sửa: `npm test` 4427 / 4397 pass / 0 fail / 30 skip. Typecheck 0 lỗi. eslint 0 error / 16 warning. `db:drift` 62 bảng / 638 cột. `nuxt build` xanh. MySQL 8.0.46 thật: `view-boost-integration` 2/2, `backup-dump-integration` 7/7. E2E 39/39 (cùng bốn spec).

### 36. Đợt 2 — vận hành (2026-10-24)

OpenSpec `wave2-hardening` nhóm 7 (2F ops), design D-OFFSITE, D-LOG, D-ALERT, D-DOCS; spec `backup-restore`, `ops-logging`. Mỗi mục có test đỏ trước khi sửa (log đỏ lưu ngoài repo).

- **Bản sao ngoài máy chủ có trạng thái theo từng tệp (D-OFFSITE).** Đã kiểm: bước Drive chạy cho mọi lượt `runBackup`, kể cả theo lịch. Trước đây Drive hỏng chỉ để lại một dòng log; danh sách hiện cùng một vòng tròn rỗng cho "Drive tắt" lẫn "Drive hỏng đêm qua". Nay có cột `backups.offsite_status VARCHAR(16) NULL` với giá trị `uploaded`/`failed`/`none`. Cột khai ở `schema.ts`, `schema-tables/readers-media.ts` và `ensureColumn` trong `migrations-additive.ts`; `db:drift` báo 636 cột.
  - **Không backfill**, không ghi hàng nào lúc khởi động. `drive_uploaded = 0` không phân biệt "tắt" với "hỏng", nên hàng cũ giữ NULL và trang lùi về `drive_uploaded`. Suite nâng cấp 2F không cần khai chuyển đổi hàng nào cho cột này, nhưng lần khởi động 1 trên CSDL cũ có thêm một cột vào `backups`. Nếu suite so bằng `CHECKSUM TABLE`, kết quả sẽ đổi dù không hàng nào được ghi, nên suite phải coi đó là bổ sung lược đồ.
  - Bước Drive tách khỏi `backup.ts` sang `services/backup-offsite.ts`, hành vi upload giữ nguyên (OAuth ưu tiên, service account dự phòng).
  - Cách ghi trạng thái:
    - Drive tắt → `none` ngay lúc đăng ký hàng `done`.
    - Drive bật nhưng chưa liên kết, không có service account → `none` + log `backup.offsite_not_configured`. Trước đây nhánh này im lặng.
    - Upload hỏng → `failed` cho tệp hỏng và mọi tệp sau nó; tệp đã lên rồi giữ `uploaded`.
    - Liên kết có token không giải mã được, hoặc OAuth client không dùng được → `failed`.
    - Lượt chết trước bước Drive (Drive đang bật) → các tệp đã đăng ký mang `failed`.
  - Tệp cục bộ không bao giờ bị xoá vì Drive, và lượt sao lưu vẫn thành công. `backup.drive_failed` nay kèm danh sách tệp. Ghi trạng thái hỏng chỉ log `backup.offsite_status_unwritten`.
  - Khôi phục CSDL gắn lại hàng `backups` kèm `offsite_status`.
  - Giao diện:
    - Cột "Bản ngoài máy chủ" (`BackupOffsiteBadge.vue`, bảng và thẻ điện thoại) hiện bằng chữ: *Đã lên Drive* / *Lỗi tải lên Drive* / *Chỉ trên máy chủ*. Biểu tượng `aria-hidden` không mang trạng thái nữa.
    - `BackupSettingsPanel` cảnh báo vàng "Các bản sao lưu hiện chỉ nằm trên máy chủ này" khi backup tự động bật mà chưa có nơi lưu ngoài. Cảnh báo tính từ biểu mẫu và trạng thái liên kết đã tải; còn đang tải thì không khẳng định.
  - Quy tắc "đã cấu hình" nằm một chỗ (`shared/backup-offsite-status.ts`) cho máy chủ và trang. App import qua `~~/shared/…`: bản đầu dùng đường tương đối từ `app/utils` và Nitro build đỏ, đúng bẫy § 32 đã ghi.
  - Test: `tests/backup-offsite-status.test.ts` (12, chạy `runBackup` thật), `tests/backup-offsite-ui.test.ts` (14, gồm render SFC). Thêm một khẳng định gắn lại hàng khi khôi phục ở `backup-restore-hardening`.
- **`manage.sh` Menu 5 "Cài cron sao lưu", Menu 6 "Xuất .env đã mã hoá" (D-OFFSITE).**
  - **Menu 5** (`backup-cron`) in đúng hai dòng tài liệu vẫn bảo gõ tay: `backup.sh` 02:00 (dump qua `backup-db.sh` + media/uploads — chọn `backup.sh` chứ không `backup-db.sh` trần để khỏi mất archive media mà DEPLOY.md hứa) và `verify-restore.sh --latest` 03:30 ngày 1.
    - Chỉ cài khi trả lời `y`; mặc định không.
    - Hai dòng nằm trong khối `# BEGIN/END cdkt-backup`: chạy lại là thay khối, dòng crontab khác giữ nguyên, dòng sao lưu gõ tay ngoài khối được chỉ ra.
    - `crontab -l` hỏng vì lý do khác "no crontab" → dừng. Coi nó là rỗng rồi cài là xoá crontab thật.
    - User không ghi được thư mục sao lưu (`BACKUP_DIR`, mặc định `./backups` — bind mount thuộc uid 1000 của container) → từ chối, bảo cài bằng root: cron của user đó sẽ hỏng `EACCES` mỗi đêm. User không ghi được `/var/log` thì log vào `<repo>/logs`. Đường dẫn chứa `%` hoặc dấu nháy đơn bị từ chối.
    - Ping chỉ báo *đang đặt*/*chưa đặt*.
  - **Menu 6** (`export-env`): `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt`.
    - Passphrase gõ hai lần, ≥ 12 ký tự, đi qua `-pass fd:3` — không bao giờ trên argv.
    - Tệp tạm 600 rồi `mv`; giải mã thử trước khi giữ.
    - openssl thiếu `-pbkdf2` → từ chối. Ghi đè `.env.enc` cũ phải trả lời `y`.
  - Hộp cát test có `crontab` giả (`tests/fixtures/ops-sandbox/crontab`), nên test không bao giờ chạm crontab thật. Test xuất mã hoá chạy openssl thật qua một shim ghi argv.
- **Log app vào journald (D-LOG).** Service app trong compose dùng `logging: driver: journald`, `tag: cdkt-app`; MySQL giữ json-file. Đọc bằng `journalctl CONTAINER_TAG=cdkt-app` — log còn sau khi container bị thay, đã thử thật.
  - Đo trước khi chọn cơ chế: driver journald **từ chối** `max-size` ("unknown log opt", lỗi lúc `up` chứ không lúc `config -q`). json-file không có `max-size` thì không xoay vòng. Vì vậy một khối `options` chung cho hai driver (biến `APP_LOG_DRIVER`) là không làm được.
  - Dự phòng: `ensure_log_driver` (giống từng chữ ở `scripts/deploy-remote.sh` và `production/manage.sh` Deploy/Update, test so) kiểm socket journal + `journalctl`.
    - Không có journald → ghi `docker-compose.override.yml` mang dấu `# cdkt-log-fallback` (json-file 3 × 10 MB).
    - Có journald → gỡ đúng tệp đó.
    - Override không dấu của người vận hành → không bao giờ sửa.
  - Lượt CI deploy chạy nó sau bản dump và trước `config -q`. Không có bước này, VPS thiếu journald sẽ hỏng mọi lượt deploy ở `up` rồi lùi lại.
  - `docker-compose.override.yml` vào `.gitignore` và `.dockerignore`. `docker compose config -q` xanh với env giả, có và không có override.
- **Thư cảnh báo vận hành (D-ALERT).** `server/utils/ops-alert.ts`, gọi từ `logger.ts` cho `ALERT_EVENTS`: `backup.restore_failed`, `backup.restore_refused`, `auth.mfa_challenge_locked`, `security.link_host_rejected`, `backup.slot_abandoned`, `db.migration.media_category_fk_blocked`. Thư gửi tới `OPS_ALERT_EMAIL` qua SMTP của admin.
  - Giới hạn: tối đa 1 thư mỗi sự kiện mỗi 15 phút. Dấu trong bộ nhớ đặt đồng bộ, cộng hàng `rate_limit_counters` dùng chung giữa các tiến trình và qua lần khởi động lại. Thư kế tiếp ghi số lần đã gộp. Cửa sổ chỉnh được theo từng sự kiện (`OPS_ALERT_WINDOW_SECONDS`).
  - Quyết định trước bộ lọc `LOG_LEVEL`. `OPS_ALERT_EMAIL` trống thì không import, không chạm DB.
  - Bắn rồi quên: `dispatch` không reject; lỗi chỉ log `ops.alert_failed`. Dòng log của đường cảnh báo mang symbol `SKIP_OPS_ALERT`, nên không đệ quy.
  - **Đường gửi tự mở và đóng một kết nối riêng** (`dbConnectionOptions()` tách từ `getDb`). Sự kiện di trú được log trong CLI `server/db/init.ts` (CMD container): tạo pool chung ở đó sẽ giữ tiến trình sống mãi và container không lên. Đã thử bằng một CLI giả: thoát ngay.
  - SMTP đọc qua `getSmtpConfig(reader)` của mailer, nên giải mã của 2A (nếu có) cũng áp cho thư cảnh báo.
  - Nội dung thư: tên sự kiện, thời điểm, máy chủ, các trường nguyên thuỷ đã che. Khoá bị che bị bỏ hẳn, không có stack trace, giá trị dài bị cắt.
  - `OPS_ALERT_EMAIL` có trong compose `environment:`, `.env.example`, Deploy/Update của `manage.sh` (đứng trước prompt ping) và `production/README.md`.
  - Test: `tests/ops-alert.test.ts` (20). Thử thật trên MariaDB dùng một lần: `init.ts` gặp hàng `media_items` treo → log `fk_blocked` → đường cảnh báo ghi hàng `rate_limit_counters`, SMTP không tới được → `ops.alert_failed`, rồi `init.ts` **thoát 0**. Lần khởi động thứ hai trong cửa sổ bị kho dùng chung chặn, không gửi lại.
- **Tài liệu (D-DOCS), các mục là việc của người vận hành:**
  - `production/README.md`: user deploy không phải root (group `docker` ≈ root, khoá `restrict`, đổi `VPS_USER`/`VPS_SSH_KEY`, `docker login` bằng user đó); bảng trần RAM theo cỡ máy, tính bằng đúng công thức `check-resources.sh`; journald (`Storage=persistent`, `SystemMaxUse=`); thư cảnh báo; Menu 5/6.
  - `CI-CD.md` ghi hai quyết định đã chốt. **D2:** không có cổng duyệt tay. **D-CI:** chấp nhận CI chạy hai lần khi repo public (kiểm 2026-10-24: PUBLIC); chuyển private thì dùng lại lượt PR xanh của cùng tree SHA — chưa viết.
  - `DEPLOY.md`: cron bằng Menu 5, bản `.env` mã hoá, yêu cầu journald.
- **Chạm vào tệp của nhánh khác (cần lưu ý khi gộp):** `server/utils/mailer.ts`, `server/utils/logger.ts`, `docker-compose.yml`, `production/README.md`, `server/services/backup.ts` (2A sửa `readBackupConfig` và nhánh Drive — nhánh "service account không giải mã được" của 2A phải chuyển sang `services/backup-offsite.ts`, và `serviceAccountConfigured` phải tính cả `driveServiceAccountUnreadable`). Khi 2A gộp `security.cross_site_refused`: thêm vào `ALERT_EVENTS` kèm cửa sổ dài hơn trong `OPS_ALERT_WINDOW_SECONDS`.
- **Đã kiểm:**
  - `npm test`: 4470 test, 4443 pass, 0 fail, 27 skip (trước 4394).
  - Typecheck 0 lỗi; eslint 0 error / 16 warning (không đổi); `db:drift` xanh (636 cột / 62 bảng).
  - `npm run build` xanh: mã cảnh báo nằm trong bundle Nitro, lớp huy hiệu mới có trong CSS.
  - `docker compose config -q` xanh với env giả, có và không có override.
  - `bash -n` xanh cho các script đã sửa. shellcheck `-S style` không có cảnh báo mới; còn một `SC2329` có từ trước ở `deploy-remote.sh`.
  - E2E không chạy: chưa spec nào phủ trang `/admin/settings/backup`.

#### Sửa sau kiểm chứng độc lập (2026-10-24)

Mỗi mục có test đỏ trước khi sửa, trên 96804b0.

- **CRITICAL — khôi phục một bản dump lấy trước khi có cột mới.** Dump của app mang `DROP TABLE` + `CREATE TABLE`, nên `backups` quay về không có `offsite_status`. Drizzle luôn nêu đủ cột, nên lượt gắn lại hàng `backups` trong transaction audit chết với `Unknown column`. Hậu quả:
  - endpoint báo "khôi phục thất bại" dù dữ liệu **đã** bị thay, và audit ghi thất bại;
  - `backups` rỗng, nên lượt dọn kế tiếp (lượt sao lưu sau, hoặc 1 phút sau khởi động) xoá bản `pre-restore` cùng các bản mới hơn như "mồ côi";
  - danh sách và lượt sao lưu kế cũng hỏng tới khi khởi động lại.

  Lỗi đúng cho **mọi** cột/bảng thêm sau thời điểm dump, ở mọi đợt.
  - **Sửa gốc:** ngay sau `restoreSql`, vẫn trong khoá khôi phục và **trước** gắn lại/audit, chạy lại đúng các bước cấu trúc lúc khởi động (`initDb()`: `CREATE TABLE IF NOT EXISTS` + `applyAdditiveMigrations`).
    - Không chép DDL nào. `initDb` đọc cùng `DB_*` với `restoreSql`; import động, nên chỉ nạp khi thật sự khôi phục CSDL.
    - Dump chết giữa chừng vẫn qua bước này (được tới đâu hay tới đó), và lỗi gốc mới là thứ được báo.
    - Bước này hỏng sau một dump đủ → `schema_convergence_failed`, nói dữ liệu đã nạp và cần khởi động lại.
    - Log `backup.restore_schema_converged` / `…_convergence_failed`.
  - **Lượt dọn đóng an toàn:** đọc `backups` đủ mọi cột (`db.select().from(backups)`, không chỉ `filename`). Bảng sai hình dạng → câu đọc ném → không xoá tệp tên-thật nào. Đối chứng: khi bảng đúng hình dạng, tệp mồ côi thật vẫn bị dọn.
  - **Test MySQL thật** (`tests/backup-dump-integration.test.ts` mục 5–6, không đổi matrix CI):
    - Dump một CSDL thiếu `backups.offsite_status` **và** `article_comments.flag_reason`, nâng CSDL lên bản hiện tại, tạo một bản sao lưu mới hơn, rồi khôi phục qua `runRestore`.
    - Kết quả: thành công, đủ cột, hàng `pre-restore` + bản mới hơn được gắn lại (giữ `offsite_status`), audit `backup_restore`.
    - Sau lượt dọn với tệp đã cũ hơn 10 phút, mọi tệp còn. `listBackups` và một lượt `runBackup` mới chạy được ngay.
    - Ca dọn đóng an toàn riêng.
    - Trên 96804b0: hai ca này đỏ (`Unknown column 'offsite_status'`; ca dọn xoá cả ba tệp).
  - `backup-restore-hardening` có thêm 4 ca thứ tự: dump → `initDb` → transaction; dump hỏng; bước cấu trúc hỏng; khôi phục tệp không đụng cấu trúc.
  - Trang `/admin/settings/backup` có nhãn cho phase mới ("Đang cập nhật cấu trúc CSDL") và giữ thanh tiến trình 100% trong bước đó. Trước đó nhật ký khôi phục hiện chữ thô `schema`, thanh tụt về 0%. Có test: mọi phase máy chủ báo phải có nhãn.
  - **Hạn chế:** bước này chỉ *thêm*. Một cột đã bỏ khỏi `schema.ts` mà dump cũ còn mang (NOT NULL, không mặc định) không được gỡ; giá trị seed chỉ quay lại ở lần khởi động sau.
  - **Lưu ý khi gộp 2A:** thứ tự phải là `restoreSql` → `convergeSchemaAfterRestore` → `encryptRestoredSecrets`.
- **W1 — máy không có journald + override của người vận hành.** Trước chỉ cảnh báo, nên `up` vẫn hỏng. Nay hỏi `docker compose config` driver log hiệu lực của app (`effective_app_log_driver`; awk đọc hết đầu vào, không `exit` sớm — SIGPIPE dưới pipefail).
  - Vẫn là journald → dừng trước khi chạm container. Ở CI: `::error::`, trả `docker-compose.yml` cũ về, `.env` không đổi.
  - Override đã đặt json-file → đi tiếp.
  - Ở `deploy-remote.sh`, `ensure_log_driver "$IMAGE"` nay chạy **sau** `install_compose` để tính trên compose của commit đang deploy.
  - Bộ đọc đã thử trên đầu ra thật của `docker compose config`: không override → journald; override không đặt logging → journald; override json-file → json-file.
- **W2 — "có journald" phải là daemon dùng được.** Ngoài socket + `journalctl`, nay kiểm thêm daemon có driver (`docker info --format '{{json .Plugins.Log}}'`), rồi chạy container thử `docker run --rm --network none --log-driver journald --entrypoint true <image>` khi image đã có trên máy. Hai fake docker trả lời `info`/`run`/`compose config`.
- **W3 — Update tự chạy tiếp bằng `manage.sh` vừa kéo về.** `git pull` đổi chính `manage.sh` → `exec` bản mới với `CDKT_UPDATE_RESUMED=1`, kèm bản sao lưu compose cho đường lùi; không hỏi lại sao lưu/pull, không lặp. Bản `manage.sh` cũ trên VPS chưa có bước này, nên README ghi: lần Update tay đầu tiên trên máy không journald có thể hỏng ở `up` (tự lùi) — chạy lại một lần. Thường CI deploy đã ghi override trước đó rồi.
- **W5 — passphrase giữ dấu cách đầu/cuối:** đọc bằng `IFS= read -rs`. Test giải mã bằng đúng chuỗi có dấu cách.
- **Gợi ý đã làm:**
  - Tệp tạm của override (`LOG_FALLBACK_TMP`) được dọn ở trap EXIT của cả hai script; `.docker-compose.override.*` vào `.gitignore`/`.dockerignore`.
  - README thêm `RateLimitBurst`/`RateLimitIntervalSec` của journald và mẫu logrotate cho `/var/log/cdkt-backup.log`, `cdkt-verify-restore.log`.
  - W6 (tách `manage.sh`) để lại cho Wave 3 task 4.4; W4/W7 xử lý lúc gộp 2A.
- **Đã kiểm:**
  - `npm test`: 4485 test, 4456 pass, 0 fail, 29 skip (+2 skip là hai ca MySQL mới khi không có DB).
  - `tests/backup-dump-integration.test.ts` trên MySQL 8.0.46 local: 7/7 xanh, không sót DB `cdkt_backup_dump_*`.
  - Typecheck 0 lỗi; eslint 0 error / 16 warning; `db:drift` xanh.
  - Container thử journald chạy thật (exit 0) trên `cdkt/app:local` và `ghcr.io/…:latest`.
  - Build xanh 4/5 lượt. Lượt đỏ là `Could not resolve "../../../../../shared/link-policy.ts"` từ import tương đối **có sẵn** trong `app/utils/nav-config.ts` (bẫy § 32, ngoài phạm vi) — cần sửa riêng sang `~~/shared/link-policy`.
  - `bash -n` + shellcheck không có cảnh báo mới; `docker compose config -q` xanh với env giả.

#### Sửa sau kiểm chứng lần 2 (2026-10-24)

Mỗi mục có test đỏ trước khi sửa, trên 58c891c.

- **CRITICAL — khôi phục THẤT BẠI vẫn để lượt dọn xoá bản `pre-restore` và mọi bản mới hơn.** 58c891c đã sửa lối thành công, nhưng hai lối thất bại — dump chết giữa chừng, và bước cấu trúc hỏng — đều ném trước chỗ gắn lại hàng duy nhất (trong transaction audit). Lối thất bại chỉ ghi audit. `backups` còn đúng như dump ghi, "đúng hình dạng" nhưng thiếu các hàng mới, nên lượt dọn kế tiếp (mỗi `runBackup`, và lượt dọn lúc khởi động) xoá bản an toàn cùng các bản mới hơn. Sửa cả hai phía:
  - **(a) Gắn lại trên mọi lối thất bại**, ngay sau khi dump đã chạy và trước khi nhả khoá khôi phục: `reattachAfterFailedRestore`.
    - Chạy sau bước cấu trúc khi bước đó chạy được.
    - Chịu được bảng còn hình dạng cũ: chỉ ghi các cột của `schema.ts` mà bảng thật đang có, đọc từ `information_schema`. Giá trị mã hoá bằng `column.mapToDriverValue` của Drizzle, vì `pool.query` trần với `Date` lệch 7 giờ.
    - `created_by` chỉ giữ id còn trong `users` vừa nạp.
    - Không bao giờ ném đè lỗi gốc. Log `backup.restore_failed_rows_reattached`.
  - **(b) Lượt dọn** (`deleteStaleFiles`):
    - **Không bao giờ** xoá bản `pre-restore`, cùng quy tắc với xoay vòng.
    - Giữ mọi tệp tên-app chưa đăng ký có mã thời điểm **không sau** bản `pre-restore` mới nhất trên đĩa. Bản đó đánh dấu lượt khôi phục gần nhất, và tệp có từ trước nó có thể mất hàng chỉ vì danh sách bị tua lại. Log `backup.orphan_kept_restore_window`.
    - Lý do chọn mốc này: đọc thẳng từ tên tệp, không cần bảng nào, không thể sai vì danh sách sai. Cái giá: tệp sót của một lượt bị giết *trước* lượt khôi phục đó nằm lại tới khi bản `pre-restore` ấy bị xoá tay — chỉ tốn đĩa.
    - Không xoá tệp tên-thật nào khi khoá `cdkt:backup:restore` đang bị giữ (hoặc không hỏi được), cùng cách xoay vòng hỏi `IS_USED_LOCK`. Lý do: giữa lúc dump thay bảng và lúc gắn lại, một lượt sao lưu theo lịch có thể dọn đúng lúc danh sách đang sai.
  - **Test:**
    - `tests/backup-dump-integration.test.ts` mục 7 (dump chết giữa chừng) và mục 8 (bước cấu trúc hỏng vì hàng `chat_sessions` mồ côi chặn `fk_chat_sessions_reader`). Mục 8 khẳng định thêm: thông báo nêu tên bản an toàn, và khôi phục bản đó thành công.
    - Trên bản sao 58c891c (`git archive`): mục 7 đỏ `pre-restore row put back: []`; mục 8 đỏ vì thông báo không nêu tên bản an toàn.
    - `backup-orphan-archives` có 3 ca luật dọn mới, đỏ trước khi sửa.
- **W1 — `initDb` rò kết nối khi một bước hỏng** (repro 2 treo tới hết giờ): chỉ thêm `try/finally` quanh hai kết nối của `init.ts`, không thêm logic. Test mới `tests/init-db-connection-release.test.ts`.
- **W2 — thông điệp `schema_convergence_failed`:** bỏ "khởi động lại ứng dụng để hoàn tất". Lỗi đến từ chính dữ liệu thì mỗi lần khởi động (`init.ts && …`) chạy đúng bước đó và container dừng lặp lại. Thông báo nay chỉ vào log và nêu **tên bản `pre-restore`** để khôi phục lại; bản đó đã được gắn lại vào danh sách, và mục 8 chứng minh khôi phục nó chạy được. README cập nhật theo.
- **Gợi ý đã làm:**
  - Chú thích "cùng `DB_*`" nay nói đúng: `createBackupConnection` lùi về `MYSQL_DATABASE`, còn `initDb` thì không. Nếu hai tên lệch, bước cấu trúc **dừng** thay vì chạy trên CSDL khác.
  - Container thử journald có `--pull=never` và trần thời gian (`timeout 20 docker info`, `timeout 60 docker run`).
  - README ghi chú: khôi phục một dump có từ trước 2026-09-22 cũng chạy các bước chuyển đổi đã thiết kế lúc khởi động (danh mục video trỏ bảng thể loại cũ bị gỡ, `short_id`, URL media cũ).
- **Chưa làm (ghi lại):** trạng thái scheduler sao lưu (`backup_scheduler_state`) vẫn chỉ được giữ trên lối thành công. Lượt khôi phục hỏng có thể tua lại hàng đó, hậu quả tối đa là lệch một khe lịch.
- **Đã kiểm:**
  - `tests/backup-dump-integration.test.ts` trên MySQL 8.0.46 local: 9/9 xanh trong một lượt, tiến trình tự thoát (không còn treo), không sót DB `cdkt_backup_dump_*`.
    - Một lượt trước đó đỏ vì nguyên nhân bên ngoài: CSDL thử của mục 7 bị xoá giữa chừng `initDb`; các lượt chạy song song của agent khác cũng gây 409 trên khoá toàn máy chủ.
  - `npm test`: 4492 test, 4461 pass, 0 fail, 31 skip.
  - Typecheck 0 lỗi; eslint 0 error / 16 warning; `db:drift` xanh; build xanh.
  - `bash -n` + shellcheck không có cảnh báo mới; `docker compose config -q` xanh với env giả.
  - Container thử journald với `--pull=never` chạy thật (exit 0).

#### Sửa sau kiểm chứng lần 3 (2026-10-24)

Không còn CRITICAL; sửa các cảnh báo. Mỗi mục có test đỏ trước khi sửa, trên 74cd56c (bản sao `git archive`).

- **W1 — lời khuyên "khôi phục bản an toàn" thành ngõ cụt khi `backups` còn hình dạng cũ.** Bước cấu trúc hỏng trước khi tới `backups.offsite_status` thì bảng giữ hình dạng của dump. Lượt khôi phục kế tiếp (chính là làm theo lời khuyên) tạo bản an toàn mới, nhưng đăng ký nó bằng câu Drizzle nêu đủ cột → `Unknown column 'offsite_status'` → khôi phục bị huỷ. Sửa ba chỗ:
  - **Một lối ghi sổ cho mọi nơi:** `insertBackupRow` (`server/services/backup-registry.ts`) — đăng ký lượt sao lưu (kể cả `pre-restore`), hàng `failed`, tệp tải lên, gắn lại sau khôi phục. Bảng thiếu cột (`ER_BAD_FIELD_ERROR`) → ghi chỉ các cột bảng thật có, giá trị qua `sql.param(value, column)` (cùng bộ chuyển của Drizzle, ngày giờ không lệch). Log `backup.registry_old_shape`.
  - **Đưa riêng `backups` về hình dạng hiện tại** (`convergeBackupsTable`, tách từ `applyAdditiveMigrations` — lúc khởi động gọi đúng hàm này) ở đầu mỗi lượt khôi phục CSDL, trước bản an toàn, và ở lối thất bại trước khi gắn lại hàng.
  - **Đường lui trên máy chủ có thật:** lời khuyên nay nêu thêm `scripts/restore-db.sh` với chính tệp `pre-restore`. Kiểm ra script đó từ chối **mọi** dump của app ("no completion marker — it is truncated"), vì dump của app không có dòng hoàn tất của mysqldump. `dumpSql` nay kết thúc bằng `-- Dump completed on <ISO>`. Đã thử thật trên container MySQL dev: `restore-db.sh` khôi phục một bản `pre-restore` của app (62 bảng, một `INSERT` 20 MB) vào CSDL thử. Dump của app tạo trước bản này vẫn bị script từ chối — README/DEPLOY.md ghi rõ, khôi phục chúng trong app.
  - Đã thử và bỏ: thêm `--max-allowed-packet` cho client `mysql` trong script. Client 8.0.46 gửi được câu `INSERT` 20 MB với mặc định 16 MB, nên cờ này không cần.
  - **Test:** `backup-dump-integration` mục 9 (lời khuyên chạy được khi `backups` cũ; hàng giữ nguyên giá trị), 11 (đăng ký trên bảng cũ, ngày giờ y nguyên), 13 (bản `pre-restore` của app qua được `restore-db.sh`, docker giả, đầu ra `dumpSql` thật). Trên 74cd56c: mục 9 đỏ `the failure path brings backups itself up to date`, mục 11 đỏ `Unknown column 'offsite_status'`; mục 13 đỏ trước khi thêm dòng hoàn tất.
- **W2 — lượt sao lưu chạy giữa lúc khôi phục bị mất hàng.** `runBackup` nay từ chối khi khoá `cdkt:backup:restore` đang bị giữ (hoặc không hỏi được): `BackupRestoreInProgressError` (con của `BackupLockBusyError`) → endpoint trả 409. Scheduler coi đó là "bận": không tính lần thử, log `backup.scheduler_busy` (trước đây mọi lỗi bận ghi `backup.scheduler_failed`). Ngoại lệ duy nhất: bản `pre-restore` của chính lượt khôi phục (`allowDuringRestore`). Test: `backup-orphan-archives` (từ chối, không ghi gì, không gọi `onStarted`), `backup-run-endpoint` (409), `backup-scheduler-due` (bận ≠ lần thử), `backup-dump-integration` mục 12 (khoá thật). Trên 74cd56c mục 12 đỏ `Missing expected rejection`.
- **W3 — trạng thái scheduler chỉ được giữ ở lối thành công.** Lối thất bại (`restoreLiveStateAfterFailedRestore`) nay ghi lại cả `backup_scheduler_state` của hệ thống đang chạy. Test: hai ca `backup-restore-hardening` (dump chết, bước cấu trúc hỏng) và `backup-dump-integration` mục 10. Trên 74cd56c mục 10 đỏ `the live scheduler record, not the dump's (none)`.
- **W4 — thêm mục integration:**
  - mục 10: transaction audit hỏng (trigger chặn `activity_logs` đi kèm dump) → hàng vẫn được gắn lại;
  - mục 9: gắn lại vào bảng hình dạng cũ;
  - mục 9 và 10: so giá trị và ngày giờ từng hàng. Bản `newer` so y nguyên với trước khôi phục. Bản `pre-restore` sinh **trong** lượt khôi phục nên so với tệp của nó: kích thước, mã thời điểm, người tạo, `created_at` theo UTC.
- **S1:** kiểm `DB_NAME`/`MYSQL_DATABASE` (`assertOneDatabase`) chuyển lên **trước** bản an toàn và `restoreSql`. Test đỏ trước khi sửa.
- **S3:** CLAUDE.md ghi số dòng hiện tại của `init.ts` (80, `wc -l` 2026-10-24) ở các chỗ nêu cỡ hiện tại. Dòng lịch sử "1302 → 73" giữ nguyên.
- **S4:** `init.ts` đóng kết nối bằng `end().catch(() => {})` trong `finally`. Lỗi đóng không che lỗi của bước hỏng. Test thêm ca `end` ném.
- **Tách tệp:** phần giữ trạng thái của lượt khôi phục chuyển sang `server/services/backup-restore-recovery.ts`, để `backup-restore.ts` ở dưới 400 dòng. Đó là các hàm: kiểm một CSDL, đưa `backups` về hình dạng hiện tại, bước cấu trúc, gắn lại hàng, lối thất bại. `backup.ts` vẫn lớn từ trước (726 dòng, trước đợt này 674) — chưa tách, ghi lại cho lượt sau.
- **Bẫy của guard TDZ** (`tests/transaction-tdz.test.ts`): guard lấy thân khối từ dấu `{` đầu tiên sau `transaction(`. Với callback arrow một biểu thức (`db.transaction(tx => f(tx))`), dấu đó nằm ở dòng **sau** lời gọi, nên một phép đọc biến kết quả ở dòng kế tiếp bị báo oan. Chỗ này nay viết thân khối có ngoặc. Guard để nguyên, ngoài phạm vi.
- **Đã kiểm** (sau khi rebase lên `wave1/integration` 2516422):
  - `tests/backup-dump-integration.test.ts` trên MySQL 8.0.46 local: 14/14 xanh trong một lượt, không sót DB `cdkt_backup_dump_*`.
  - `npm test`: 4526 test, 4490 pass, 0 fail, 36 skip.
  - Typecheck 0 lỗi; eslint 0 error / 16 warning; `db:drift` xanh (636 cột / 62 bảng).
  - Build sạch (xoá `.output` + cache) xanh 2/2 lượt.
  - `bash -n` + shellcheck xanh cho `restore-db.sh`, `verify-restore.sh`, `deploy-remote.sh`, `manage.sh`; `docker compose config -q` xanh với env giả.

### 37. Đợt 2 — 2B dữ liệu (2026-10-24)

OpenSpec `wave2-hardening` nhóm 3 (task 3.1, 3.2, 3.3, 3.4, 3.6), design D-REPOINT, D-SCAN, D7, D-RESCAN. Task 3.5 (D-PLAIN, bỏ phép đoán entity cụt lúc đọc) **chưa làm**: điều kiện tiên quyết là chủ repo xác nhận `db:decode-excerpts --apply` của Wave 1 đã chạy trên production — chưa có xác nhận.

- **Đổi domain R2 (3.1, D-REPOINT)** — `server/services/media-repoint.ts`.
  - **Phạm vi.** Bản cũ `REPLACE(col, domain, …)` trên đúng hai cột (`media.url`, `articles.content`). Nay đổi trên 27 cột `URL_REFERENCE_TARGETS` (cùng danh sách lượt đồng bộ local ↔ R2 dùng) cộng `media.url` hàng `r2`.
  - **Mẫu khớp.** `domainRepointForms` (nay ở `media-repoint-match.ts`, xem "Sửa sau kiểm chứng độc lập"), dựng từ cùng `RIGHT_BOUNDARY`. Bên trái phải đúng `scheme://`; bên phải là `/` hoặc ranh giới URL. Mỗi scheme một dạng, không dùng `$1`. Cột JSON thêm dạng thoát `\/`.
  - **Không đụng host giống:** `xold.cdn`, `old.cdn.evil`, `old.cdn:8443`, `//old.cdn`. Bản cũ thay chuỗi con, nên đổi cả mấy host này.
  - **Đếm.** Chọn id bằng một lượt đọc không khoá (LIKE + REGEXP), rồi UPDATE theo id kèm lại điều kiện REGEXP. Số đếm vì thế đúng bằng số hàng thật sự đổi, và hàng chỉ chứa host giống không được tính.
  - **Một transaction** cùng audit `repoint_urls` (`byTarget` đủ 28 nhãn). `afterSettingsRewritten` chạy sau commit.
  - **Sao lưu trước là bắt buộc.** Sao lưu hỏng → `RepointBackupError` (500, câu không lộ chi tiết máy chủ, nguyên nhân ở log `media.repoint_pre_backup_failed`), không đổi hàng nào. Bản cũ chỉ cảnh báo rồi đổi tiếp.
  - **Lỗi có kiểu, không còn đoán theo chuỗi.** `RepointInputError` → 400: domain mới chứa domain cũ (`assertRewritable`, giữ nguyên), domain trùng, ký tự phá HTML. `RepointBusyError` → 409.
  - `/admin/media/scan` hiện số "Nội dung sửa URL" (`contentRowsUpdated`) thay cho "Bài viết sửa URL".
  - **Hệ quả có chủ đích:** `r2_public_url` lưu kèm scheme cũng được đổi sang domain mới; `media_video_r2_public_url` cũng vậy khi bucket video dùng chung domain cũ (S6, ghi ở `production/README.md`).
- **Quét thư mục ảnh (3.2, D-SCAN)** — `media-scan.ts` cùng tệp mới `media-scan-import.ts` (nhập một tệp; `media-scan.ts` từ 396 xuống còn khoảng 300 dòng).
  - **Cột mới** `media.scanned_source_path VARCHAR(1024) NULL` cùng chỉ mục tiền tố `media_scanned_source_path_idx` (255). Khai ở `schema.ts`, ở `core.ts` và ở `ensureColumn`/`ensureIndex`; `tests/media-scan-index.test.ts` canh cả ba nơi.
  - **Không nhập lại.** Giá trị lưu là đường dẫn POSIX tương đối với `public/uploads`. Tập "đã biết" = cột này của mọi hàng + `storage_path` của hàng `local`. `storage_path` của hàng R2 là khoá R2: bản cũ chỉ biết `storage_path`, nên mỗi lượt quét lại nhập lại mọi tệp đã lên R2.
  - **Không tải đè.** Trước khi tải lên, gọi `otherRowOwns(db, 0, 'r2', key, null)` (nay export từ `media-sync-files.ts`), với cùng `now` cho khoá lẫn lượt tải. Khoá trùng → `conflict`: không tải, không ghi, không lùi về local. Trạng thái có `conflicts`/`conflictFiles`, trang hiện dòng "trùng tên", log `media.scan_conflict`.
  - **Không để object mồ côi.** Ghi hàng hỏng sau khi đã tải → xoá object vừa tải, log `media.scan_insert_failed` `{ key, objectDeleted }`.
  - **Báo cáo trùng lặp** `GET /api/admin/media/duplicates` (`media.read`, `media-duplicates.ts`, chỉ đọc). Nhóm hàng theo tên tệp + kích thước, và theo provider + chỗ lưu. Mỗi hàng có số hàng nội dung đang dùng URL của nó, đếm trong một lượt đọc phân trang 27 cột. Vòng đọc phân trang tách thành `forEachReferenceText` (`media-sync-rewrite.ts`), dùng chung với lượt vá đồng bộ dở dang.
- **`repairLegacyMediaUrls` (3.3)** — chuyển sang `server/db/legacy-media-urls.ts` (cùng các mảnh thuần), `applyAdditiveMigrations` gọi như cũ. `migrations-additive.ts` từ 986 còn 912 dòng; suite nâng cấp thêm tệp mới vào `MIGRATION_SOURCES` và neo lại khai báo `additive.repair-legacy-media-urls`.
  - **Domain** lấy từ `settings.r2_public_url` thay cho `cdn1.delify.vn` viết cứng. Chưa cấu hình → bỏ các bước cần domain; còn URL đang chờ vá thì log `db.migration.legacy_media_domain_unknown`.
  - **Tên tệp mơ hồ.** Tên mà hơn một hàng `media` (mọi provider) cùng mang thì không ánh xạ, tính trên khoá cuối của bảng ánh xạ, kể cả dạng `encodeURIComponent`. Liên kết được giữ, kèm log `db.migration.legacy_media_ambiguous`. Bản cũ lấy hàng đọc sau cùng.
  - Mọi `UPDATE articles` giữ `updated_at`, đóng mục "Còn mở (2F)" ở § 31.
  - Hai sự kiện mới nằm trong `BOOT_MIGRATION_EVENTS`.
- **Seed một lần mỗi CSDL (3.4, D7)** — `server/db/seed-groups.ts`.
  - **Phạm vi:** 5 nhóm `content_types`, `categories`, `media_categories`, `moderation_rules`, `social_links`. Mỗi bộ default có phiên bản, kèm dấu `seed.<nhóm>.v<N>.done` (nhóm `internal`, giá trị giờ ISO).
  - **Luật mỗi bộ:** có dấu → bỏ qua; v1 + bảng có hàng → chỉ ghi dấu; còn lại → chèn default thiếu + ghi dấu.
  - **Một transaction mỗi bộ, dấu ghi trước.** Bản sao chạy seed song song nhận ER_DUP_ENTRY rồi bỏ qua.
  - **So khoá theo collation của cột:** kiểm từng hàng, nên không chèn một slug mà chỉ mục UNIQUE coi là trùng.
  - **Hàng mặc định rời tệp DDL.** Thể loại / danh mục bài viết chuyển từ `schema-tables/core.ts`/`content.ts` sang `seed-groups.ts`. `seed.ts` từ 622 còn 500 dòng.
  - **Hệ quả cho CSDL mới:** `db:init` một mình không còn tạo thể loại / danh mục. Ba danh mục bài viết nay có mô tả: bản DDL chạy trước và thiếu mô tả nên trước đây luôn thắng.
  - **Dấu không qua API:** mọi lượt đọc cài đặt đã là allowlist, và `ALLOWED_SETTING_KEYS` không nhận `seed.*`. Test: `tests/seed-markers-settings-read.test.ts`.
  - **Hai ca test phải sửa theo.** `tests/media-category-migration-integration.test.ts` trước dựa vào `initDb()` chèn danh mục bài viết id 2, 6, nay tự chèn (`insertLegacyArticleCategories`). Hằng `action: "auto_hide"` giữ nháy kép như bản gốc, vì `tests/activity-log-labels.test.ts` quét `action: '…'` nháy đơn.
- **Quét lại kiểm duyệt (3.6, D-RESCAN)** — `moderation-rescan-job.ts`.
  - Trước mỗi lô (hook `beforeBatch` mới của `rescanExistingContent`), job hỏi `SELECT IS_USED_LOCK(?) = CONNECTION_ID()` trên chính kết nối giữ khoá.
  - Kết quả 0, NULL hoặc lỗi → dừng trước lô kế: `state: 'stopped'`, `stopReason: 'lock_lost'`, log `ai_moderation.rescan_lock_lost`. Con trỏ giữ tới lô cuối đã xong, `onFinished` không chạy.
  - `/admin/ai/moderation` hiện "đã tạm dừng…" cùng toast cảnh báo.

**Lượt ghi lúc khởi động mà bản này thêm hoặc đổi** (so với `264fdea`):
1. `ALTER TABLE media ADD COLUMN scanned_source_path` và `ADD INDEX media_scanned_source_path_idx`: chỉ đổi lược đồ, một lần, không ghi hàng nào.
2. Năm hàng `settings` `seed.<nhóm>.v1.done` ở lần khởi động đầu, một lần; lần sau thấy dấu thì bỏ qua.
3. `repairLegacyMediaUrls`: domain lấy từ cấu hình, bỏ tên mơ hồ, không còn đổi `articles.updated_at`.
4. Bị gỡ: `init.ts` không còn chèn `content_types`/`categories`; `seed.ts` không còn chèn lại default vào bảng nhóm D7 đã có hàng.

**Suite nâng cấp** (`tests/schema-upgrade-integration.test.ts`):
- **Gỡ ba khai báo:** `seed.resurrects-deleted-defaults` (từ nay hồi sinh default là đỏ), `ddl.default-content-types` và `ddl.default-categories` (mã đã gỡ).
- **Thêm** `seed.group-markers`: chỉ khoá dấu của chính các nhóm, chưa có trước lượt boot, nhóm `internal`, giá trị là giờ.
- **Khoá default của 5 nhóm** đọc thẳng từ `seed-groups.ts`.
- **`repairedMediaUrl`/`repairedArticleContent`** lấy domain từ `ctx.before` và bỏ tên mơ hồ. `SEED_OVERRIDES.settings` thêm `r2_public_url = https://cdn1.delify.vn/`.
- **Khẳng định mới ở lượt 1:** mọi bảng nhóm D7 có hàng trước boot, không bảng nào thêm hàng, đủ 5 dấu, `articles.updated_at` không đổi.
- **Ca mới:** xoá một default của mỗi nhóm → khởi động lại → không gì đổi.
- **Ca khai báo không cần CSDL thật:** dấu (đúng / đã có / ngoài bộ / sai nhóm / giá trị không phải giờ), hồi sinh vào bảng đã có hàng (không khai báo nào phủ), lấp bảng trống.

**Bằng chứng test-first** (trên `264fdea`, trước khi sửa mã):
- **`moderation-rescan-job`:** 3 ca mới đỏ.
- **`media-repoint-integration`:** đỏ: "Missing expected rejection" — sao lưu hỏng mà vẫn đổi.
- **`media-scan-import`:** 3/3 đỏ:
  - `scanned_source_path` trống;
  - nhập 3 tệp, trong đó tệp sau ghi đè khoá R2 của tệp trước;
  - object không bị xoá khi ghi hàng hỏng.
- **`media-duplicates-report`:** đỏ (chưa có module).
- **`seed-markers-integration`:** "the deleted default "lừa đảo" came back on restart".
- **Suite nâng cấp, chỉ gỡ `seed.resurrects-deleted-defaults`** (bản sao `264fdea` trong scratch): lượt 1 đỏ với 35 lượt ghi không khai báo — `ai_moderation_rules` ×27, `social_links` ×5, `media_categories` ×3.
- **`legacy-media-urls`:** đỏ do module/export chưa có. Thêm một lần chạy hàm gốc (chỉ export tạm trong bản sao scratch) trên cùng kết nối giả: hai hàng `a.jpg` → bài bị viết lại thành `https://cdn.test/2026/10/a.jpg`, tức URL của hàng đọc sau cùng.

**Kiểm chứng (2026-10-24, Node 26.11 + Node 24.21 trong `node:24-slim`, MySQL 8.0.46 local):**
- `npm test`:
  - Node 26.11: 4444 / 4405 pass / 0 fail / 39 skip.
  - Node 24.21 (`node:24-slim`, lượt trước test cuối cùng: 4443 test): 4384 pass, 17 fail + 2 cancelled. Cả 19 đều ở `ci-docs-only-skip`, `coverage-summary`, `snapshot-schema`, `ops-scripts`, `media-processing`, vì image không có `git`/FFmpeg. Bản sao `264fdea` trong cùng container cho đúng 17 + 2.
- typecheck 0 lỗi; eslint 0 error / 16 warning; `db:drift` 62 bảng / 636 cột; `npm run build` xanh.
- E2E chọn lọc: `media-portal`, `public-single-h1` (cần danh mục `tin-noi-bat` do seed tạo trên CSDL mới), `public-detail-status` — 11/11. Không sót `cdkt_e2e_*`, cổng 3123 trống.
- Trên Node 24.21: `media-repoint` 1/1, `seed-markers` 4/4, `schema-upgrade` 7/7.
- Integration trên MySQL thật:
  - `schema-upgrade` 7/7: lượt 1 quan sát `seed.insert-missing-defaults` ×1920, `repair-legacy-media-urls` ×3, `hotline-label` ×2, `add-column` ×1, `seed.group-markers` ×5, `mysql.on-update-timestamp` ×2 (trước ×4: `articles.updated_at` không còn đổi);
  - `seed-markers` 4/4;
  - `media-repoint` 1/1;
  - `media-sync-rewrite` 2/2;
  - `media-category-migration` 4/4;
  - `public-read` 5/5.
- Không để lại CSDL tạm.
- Matrix CI thêm `media-repoint` và `seed-markers`: 22 job (`tests/ci-integration-matrix.test.ts` xanh).

#### Sửa sau kiểm chứng độc lập (2026-10-24)

Kiểm chứng độc lập bản `63d1e8a`: 0 nghiêm trọng, 6 cảnh báo (W1–W6), 4 gợi ý (S1, S5–S7). Nhánh được rebase lên `6389c10` (2F: suite nâng cấp so default theo **nội dung**) trước, rồi sửa cả mười trong một commit.

- **W1 — hoa thường khi đổi domain.** Trước: `HTTPS://OLD.CDN/…`, `https://Old.Cdn/…` không bị đổi, và domain nhập `HTTPS://OLD.CDN/` thành `OLD.CDN` nên không khớp gì.
  - Scheme + host nay khớp không phân biệt hoa thường; đường dẫn vẫn phân biệt. Mẫu REGEXP dùng lớp ký tự `[oO]` sau `(?-i)` (REGEXP_REPLACE của MySQL không có `$1`, và collation không được quyết định). Lọc thô `LOWER(…) LIKE` vì cột JSON so nhị phân.
  - Domain nhập chuẩn hoá qua `new URL('https://' + …)`: host chữ thường, tên miền có dấu → punycode, giữ tiền tố đường dẫn, bỏ `/` cuối. Từ chối userinfo, `?`, `#`, scheme khác http(s).
- **W2 — domain mới phải phục vụ được ảnh.** Module mới `shared/media-hosts.ts`: `CSP_IMG_SRC_HOSTS` (nguồn `img-src` — `nuxt.config.ts` dựng header bằng `cspImgSrcDirective()`, không chép chuỗi) và `IMAGE_PROXY_DOMAINS` (`image.domains` của NuxtImg).
  - Đổi domain sang host ngoài một trong hai danh sách → 400 nêu đúng danh sách cho phép, trước khi sao lưu hay chạm hàng nào. Ngoài CSP thì trình duyệt chặn mọi ảnh vừa đổi; ngoài IPX (so đúng tên host) thì ảnh tối ưu thành ảnh dự phòng. Hiện chỉ `cdn1.delify.vn` qua cả hai.
  - Điều kiện trước ghi ở `production/README.md`: thêm host vào module, deploy, rồi mới đổi domain. `tests/media-hosts-policy.test.ts` canh `nuxt.config.ts` đọc từ module.
- **W3 — tệp do lượt quét cũ nhập lên R2.** Hàng đó chưa có `scanned_source_path`, nên lượt quét đầu sau bản vá vẫn nhập lại. Nay hàng R2 còn trống nguồn cùng **tên tệp + kích thước** với tệp đĩa được coi là đã nhập (`buildLegacyR2Index`/`claimLegacyR2Row` ở `media-scan-import.ts`).
  - Ghi nguồn bằng `UPDATE … WHERE id = ? AND scanned_source_path IS NULL`: mỗi hàng nhận đúng một tệp, và từ đó dính vĩnh viễn. Trạng thái có `legacyMatched`, trang quét hiện dòng thông báo, log `media.scan_legacy_matched`.
  - Không so khoá `YYYY/MM/<tên>`: lượt cũ đặt khoá theo tháng tải lên, không theo thư mục nguồn.
  - Ngoại lệ còn lại (sửa câu nói quá ở `production/README.md`): tệp đã bị sửa khác kích thước sau lượt quét cũ vẫn được nhập thêm.
- **W4 — object vừa tải và lượt ghi đồng thời.**
  - Ghi hàng báo lỗi sau khi đã tải lên → hỏi lại `otherRowOwns` trước khi xoá object. Kết nối rơi đúng lúc COMMIT mà hàng đã ghi thì object được **giữ** (`keptBecause: 'owned_by_row'`); không kiểm được thì cũng giữ (`ownership_unknown`). Thừa một object rẻ hơn một ảnh vỡ.
  - Đổi domain giữ khoá `cdkt:media:sync-storage` (đồng bộ, "Sửa URL") rồi `cdkt:media:scan` (quét), timeout 0, thứ tự cố định nên không deadlock, suốt sao lưu + transaction. Lý do: ba lượt đó dựng URL từ `r2_public_url` đọc lúc bắt đầu, chạy chồng sẽ ghi URL domain cũ sau khi đổi domain đã commit. Bận → 409 nêu tên các lượt. Khoá riêng `cdkt:media:repoint-urls` bỏ (khoá đồng bộ đã loại hai lượt đổi domain chồng nhau).
  - Còn mở, có ghi ở README: tải ảnh lên thường không giữ khoá; ảnh tải đúng lúc đổi domain có thể mang domain cũ, bấm đổi lại cùng cặp domain sẽ bắt nó.
- **W5 — báo cáo ảnh trùng có trần.** Đọc cột nội dung tối đa 20 giây / 200 000 hàng (`MAX_DUPLICATE_SCAN_MS`, `MAX_DUPLICATE_REFERENCE_ROWS`). Vượt trần → `usageTruncated: true`, số nơi dùng chỉ là cận dưới. Khoá tên `cdkt:media:duplicates-report` timeout 0: lượt thứ hai → 409. Không có pool → 503.
- **W6 — tách `media-sync-url-match.ts`** (408 → 356 dòng): phần đổi domain sang `media-repoint-match.ts` (89 dòng). Đường nối là phần dùng chung đã có (`RIGHT_BOUNDARY`, `escapeRegex`, `escapeRegexReplacement`, `likeContains`, `jsonInner` nay export), không đổi hành vi lượt đồng bộ.
- **S1 — mơ hồ đếm URL, không đếm hàng.** Hai hàng trùng chung **một** URL R2 (một object) không làm liên kết `…/migrated/media/<tên>` mơ hồ. Chỉ khi các hàng mang tên đó trỏ tới hơn một URL khác nhau mới giữ nguyên. Suite nâng cấp phản chiếu cùng luật.
- **S5 — lỗi 500 của đổi domain** không còn trả nguyên `err.message`: câu chung (đã rollback, không URL nào đổi), nguyên nhân ở log `media.repoint_failed`.
- **S6** — ghi ở README: `media_video_r2_public_url` cũng đổi khi dùng chung domain cũ.
- **S7** — `tests/seed-markers-integration.test.ts` ghim tên dấu bằng chuỗi viết tay (`seed.categories.v1.done`, …), không dựng lại qua `seedMarkerKey`: đổi định dạng khoá làm test đỏ thay vì trôi theo.

**Rebase lên `6389c10`** (2F, suite nâng cấp so nội dung từng hàng default):
- `seed-groups.ts`: mỗi nhóm có `toInsert(row, allRows)` (đúng giá trị seed sẽ ghi) và `SEED_GROUP_SPECS` export. Suite đọc nội dung default của 5 nhóm từ đó (`groupDefaultRows`) thay cho DDL. DDL không còn hàng default nào; suite đỏ nếu `core.ts`/`content.ts` lại có.
- Khai báo `seed.group-markers` giữ nguyên, kèm khẳng định mới: một default của nhóm bị sửa `url` thì không khai báo nào phủ.

**Bằng chứng test-first** (trên `b5c4826`, trước khi sửa mã):
- W1: phép thử trong scratch — `https://OLD.CDN/a.png HTTPS://old.cdn/b.png https://Old.Cdn/c.png` giữ nguyên sau khi đổi; `normalizeRepointDomain('HTTPS://OLD.CDN/')` trả `OLD.CDN`.
- `media-repoint`, `media-hosts-policy`: đỏ (module chưa có).
- `media-scan-import`: 2 ca đỏ — W4 (object bị xoá dù hàng đã commit), W3 (tệp lượt cũ nhập lại).
- `media-duplicates-report`: 5 ca đỏ (trần, khoá, endpoint).
- `legacy-media-urls`: ca S1 đỏ.
- `media-repoint` (S5): đỏ tới khi endpoint thôi trả nguyên văn lỗi.

**Kiểm chứng (2026-10-24, Node 26.11, MySQL 8.0.46 local):**
- `npm test`: 4460 / 4421 pass / 0 fail / 39 skip.
- typecheck 0 lỗi; eslint 0 error / 16 warning; `db:drift` 62 bảng / 636 cột; `npm run build` xanh.
- Integration: `schema-upgrade` 7/7 (lượt 1: `seed.insert-missing-defaults` ×1920, `repair-legacy-media-urls` ×3, `hotline-label` ×2, `add-column` ×1, `seed.group-markers` ×5, `mysql.on-update-timestamp` ×2), `seed-markers` 4/4, `media-repoint` 1/1 (thêm URL viết hoa, domain nhập `HTTPS://OLD.CDN/`, đích `cdn1.delify.vn`), `media-sync-rewrite` 2/2. `tests/ci-integration-matrix.test.ts` 5/5. Không để lại CSDL tạm.

### Chưa xử lý (cập nhật sau đợt G1–G3, 2026-10-14; thêm mục từ § 21–25, 2026-10-23; đánh dấu phần đã đóng ở § 28–30, 2026-10-24)

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
- Test: suite `analytics-ddl`/`chatbot-ddl` không xoá DB `_fresh`/`_partial` của chúng; `media-self-heal-integration` ghi một `cdkt-*-pre-self-heal.sql.gz` vào `backups/` **của repo** mỗi lượt chạy; chú thích trong `ci.yml` còn ghi "203 tệp non-integration" (thực tế 285, đếm 2026-10-24 trên nhánh tích hợp Wave 1); ~~Playwright đầy đủ (88 test) mất ~207 s trên máy dev so với `globalTimeout` 300 s (dư ~93 s)~~ (§ 30 nâng `globalTimeout` lên 480 s; nhánh tích hợp Wave 1, 2026-10-24: 93 test, 291 s cả khởi động trên máy dev, dư ~189 s) — runner CI chậm hơn vẫn có thể chạm trần, và khi chạm trần teardown bị bỏ (server mồ côi giữ cổng 3123).
- Việc của chủ repo trên GitHub: bật branch protection cho `main` (PR + status check bắt buộc, kèm job cổng CI luôn chạy — xem `CI-CD.md`), cân nhắc `environment: production` có người duyệt, xoá environment lạc tên `VPS_HOST`; giấy phép Font Awesome Pro trong repo **public**; hash bcrypt của admin trong `migrations/002_seed_data.sql`; lịch sử git ~699 MB có dump.
- (§ 21) Id bài viết vẫn dò được (tra theo id trần rồi 403 theo loại) ở: `articles/[id]/boost.delete.ts`, `articles/[id]/export.get.ts`, `setArticleCommentsEnabled` (`services/articles.ts`, qua `bulk-comments.post.ts`), `article-translation-bulk.ts` (id thiếu bị bỏ qua, id khác loại làm hỏng cả lô), `article-translations.ts` (4 chỗ). `tests/audit-access-control.test.ts:119` vẫn kỳ vọng 403 cho GET khác loại vì mock bỏ qua WHERE — hành vi thật (404) do `article-id-oracle-behavior` khẳng định.
- (§ 21) `articles.type` lưu chỉ `.trim()` trong khi bảng dùng `utf8mb4_unicode_ci`: `Role_Model` được JS coi là news nhưng MySQL so bằng `role_model` — phạm vi SQL và kiểm quyền JS lệch nhau; editor news có thể tạo bài `type: 'ROLE_MODEL'` mà bộ lọc công khai `type = 'role_model'` khớp. Gốc: chuẩn hoá/allowlist `type` lúc ghi. `[id].put.ts` dùng `resourceMap[type] || 'news'` riêng thay vì `articleResource()` (loại tên `constructor` → 403 sai, an toàn).
- (§ 21) `triggerTranslateAllLanguages` trả 200 `{queued: 0}` mà không kiểm loại bài khi không còn gì để dịch (403 khi có, 404 khi id thiếu) — lộ sự tồn tại và độ phủ bản dịch, không lộ nội dung. `translation-stats.get.ts` đếm gộp mọi loại dưới `news:read` (chỉ số tổng).
- (§ 22) Lịch sử chat do trình duyệt giữ: lượt "trợ lý" giả mạo tới được model (không quét để tránh từ chối oan) — muốn chặn cần dựng lịch sử từ `chat_messages` của phiên phía máy chủ. `errorMessage` vẫn hiện "Server Error" khi handler ném lỗi chưa xử lý (Nitro tự điền `statusMessage`).
- (§ 22) Chat: `chatHistoryShapeOk` dùng trần cố định 30 lượt, policy dùng `min(30, (maxHistoryMessages+1)*2)`. Client cắt câu bot 1200 ký tự và luôn gửi tới 8 lượt — `maxInputChars` < 1200 hoặc `maxHistoryMessages` 0–2 làm hội thoại 400 mãi (có từ trước).
- (§ 23) Phép sửa entity cụt lúc đọc vẫn cắt chuỗi PHA (có entity đầy đủ và kết thúc bằng `&chữ` thật: `C&ocirc;ng ty AT&T` → `Công ty AT…`) — dev 0 hàng; lời giải gốc: backfill một lần 17 sapo cũ (giải mã + sửa đuôi cụt) rồi cho đường đọc chỉ giải mã. Giải mã ở cả ghi lẫn đọc nên chữ entity viết nguyên văn đi hết vòng thành ký tự. Phần backfill nay có công cụ (`npm run db:decode-excerpts`, § 29 — người vận hành chạy sau deploy); đường đọc vẫn đoán.
- (§ 23) Admin còn đọc sapo thô ở xuất Word/HTML/Google (`articles/[id]/export.get.ts`, `export-batch.get.ts`, `article-export-google.ts`) và worker dịch AI (`article-translation-worker.ts` gửi sapo thô cho model; khi lùi về sapo gốc, đuôi `nh&ac` được giải mã lúc ghi rồi không sửa được nữa). Chưa có test hành vi cho `related`/`search`/chatbot và cho POST/PUT bài với entity.
- (§ 23) 17 sapo cũ vẫn lưu dạng entity trong CSDL (chỉ hiển thị đã đúng): tìm kiếm `LIKE` theo sapo không khớp chữ có dấu Latin-1 ở các bài này cho tới khi lưu lại bài hoặc chạy một lượt làm sạch dữ liệu (`npm run db:decode-excerpts -- --apply`, § 29 — chưa chạy trên production).
- (§ 22, phần lớn đóng ở § 28) Giả danh "Ban quản trị": tên reader tự đặt nay bị chặn tên dành riêng/ký tự ẩn, tiêu đề email trả lời trung tính, email chờ kiểm duyệt (lỗi AI cũng giữ email). ~~Còn mở: tên lấy từ Google không bị kiểm (wave2).~~ (đóng ở § 33: tên Google dành riêng hiện "Bạn đọc")
- (§ 22) Tầng dữ liệu: ~~`purgeExpiredRateLimits` xoá một lô 5000/đêm, không lặp — `rate_limit_counters` phình (lượt xem bài mỗi (bài, khách, ngày) một khoá, `view.post` không giới hạn theo IP)~~ (đóng ở § 30); khối "Đọc nhiều" (`articles.get.ts` `sort=views`) cộng `article_view_daily` cho mọi bài mỗi lượt, không cache; ghi analytics giữ khoá dòng `total` suốt ~10 lệnh; ~~`articles` thiếu chỉ mục ghép `(status, type, published_at)`; FFmpeg thumbnail công khai không gộp yêu cầu, không thời hạn~~ (đóng ở § 30); `aggregateDay` nạp cả ngày vào RAM.
- (§ 22) Gia cố công khai: ~~chỉ dựa SameSite=Lax chống CSRF trong khi site chạy chung `*.delify.vn` (nên kiểm `Origin` ở POST/PUT/DELETE~~ (đóng ở § 33: cổng Fetch-Metadata/Origin), cookie `__Host-` (còn mở); ~~cờ `Secure` suy từ `x-forwarded-proto` thô; đăng xuất reader không tăng `tokenVersion`~~ (đóng ở § 28); SMTP 587 không `requireTLS`; SSE livestream không trần kết nối mỗi IP; form liên hệ không trần số/độ dài câu trả lời.
- (§ 22, phần lớn đóng ở § 30) Trợ năng công khai: ~~hộp chat (focus trên điện thoại, bẫy Tab lọt phần tử ẩn)~~; ~~carousel `RoleModelsBlock` tự trượt không dừng/không theo reduced-motion~~; ~~vòng focus `#7CB342` (2,5:1)~~; ~~nhiều `<h1>` mỗi trang~~; ~~`LiveTickerBar` hỏi livestream 8 s trên mọi trang kể cả tab ẩn~~. Còn mở: hộp chat `aria-live` đọc từng nhịp gõ; `sm:py-4.5` không sinh CSS.
- (§ 21) Guard audit: `auditsOnPool` chỉ khớp `db.insert(activityLogs)` — `getDb().insert(activityLogs)` sau transaction không bị bắt; service có `async function audit(` bỏ qua kiểm pool. Hiện không có vi phạm.
- (§ 21) `setMediaThumbnail` khôi phục R2 bằng bản đĩa cũ: mất bản đĩa mà R2 còn `thumb.jpg` thì lượt CSDL hỏng xoá luôn bản R2; hai lượt lưu đồng thời có thể khôi phục đè nhau.
- (§ 21) Biến `{{content}}`/`{{author}}` bọc bằng thẻ ngẫu nhiên khác thẻ trong prompt chính, system_prompt tuỳ chỉnh không có lời dặn "trong thẻ là dữ liệu".
- (§ 21) Coverage thật (đo 2026-10-22, lcov của `npm test` so với `git ls-files`; `--test-coverage-include` của Node không liệt kê tệp chưa nạp nên không dùng được): `server/**/*.ts` 570 tệp, test nạp 275, **chưa nạp 295** (219 ở `server/api/admin`, 23 ở `server/api/public`); 81,9 % dòng trong các tệp đã nạp, ≈ 65 % nếu tính tệp chưa nạp là 0 % (ước ~12.200 dòng mã). `app/**/*.ts` 92 tệp, chưa nạp 37, ≈ 76 %. 174 tệp `.vue` không đo được bằng runner Node (chỉ e2e + guard mã nguồn). E2E có gọi nhiều handler qua HTTP nhưng không được đo.
- (§ 33) Dưới chính sách MFA, tài khoản thuộc diện vẫn tự tắt được mã dự phòng (`recovery-codes.delete.ts`) — "bắt buộc" chỉ áp lúc bật yếu tố đầu (đúng phạm vi spec); khoá lại sẽ cần quyết định riêng.
- (§ 33) Trình duyệt không gửi cả `Sec-Fetch-Site` lẫn `Origin` chỉ còn `SameSite=Lax` (D-CSRF, chấp nhận). Cookie `__Host-` chưa làm.
- ~~(§ 33) "Khôi phục CSDL" trong app không chạy lượt mã hoá bí mật~~ (đóng trong § 33, sửa sau kiểm chứng W4).
- (§ 33) Mã dự phòng: phản hồi xác nhận hỏng SAU commit (thu hồi phiên/cookie/audit) thì lô mã đã lưu mà cán bộ chưa thấy — tạo lại ở trang "Tài khoản của tôi" (cần một yếu tố đang bật, đã có). Thu hồi phiên chưa nằm trong transaction vì `revokeSessions` dùng pool riêng.
- (§ 33) Tiến trình chết đúng giữa `ensureColumn('display_name_reserved')` và lượt điền cờ → tên Google dành riêng của hàng có sẵn hiện nguyên văn tới lần đăng nhập kế tiếp của người đó (lượt điền không chạy lại vì cột đã có).
- (§ 33) Danh sách người đọc ở admin (`services/readers.ts`) và prompt kiểm duyệt AI (`ai-moderate.post.ts`) vẫn đọc tên Google thô — chủ đích (cán bộ cần thấy tên thật), không phải đường hiển thị công khai.
