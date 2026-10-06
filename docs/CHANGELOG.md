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
