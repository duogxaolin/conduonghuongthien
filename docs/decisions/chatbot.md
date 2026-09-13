# Chatbot — diễn giải vì-sao

Phần này bổ sung cho `CLAUDE.md` mục 3 (Trợ lý Chatbot).
Quy tắc hành động nằm trong `CLAUDE.md`; tệp này giữ **lý do và ràng buộc**.

---

## Hai kho tách biệt — ranh giới do trình biên dịch giữ

Chatbot có hai nguồn trả lời độc lập ở tầng lược đồ, ranh giới do trình biên dịch giữ chứ không do ai phải nhớ.

- **Kho nghiệp vụ** (`chatbot_knowledge`, không đổi): mỗi câu là phát ngôn pháp lý, có luồng duyệt nháp→published và bắt buộc có nguồn (`validatePublish`). Đây là kho **luôn được ưu tiên**.
- **Kho trả lời thường nhật** (`chatbot_small_talk`, bảng thứ 31): dữ liệu **quản lý được** tại `/admin/chatbot/small-talk` — cán bộ sửa lời văn, bật/tắt, thêm mục mà không cần deploy. KHÔNG có luồng duyệt, KHÔNG bắt nguồn. Năm nhóm: `social` (xã giao), `identity` (danh tính & năng lực bot), `navigation` (điều hướng cổng), `support` (hỗ trợ cảm xúc — mọi câu phải điều hướng về Công an xã/phường hoặc hotline, không tư vấn tâm lý, không hứa kết quả), `portal_facts` (thường thức về chính cổng). Dataset mặc định ~121 mục ở `server/data/chatbot-small-talk-seed.ts`, nạp **insert-only** qua `seed.ts` (khoá trên câu hỏi đã chuẩn hoá) nên lời văn cán bộ đã sửa sống qua mọi lần khởi động lại. Số hotline luôn nội suy từ hằng `CHATBOT_HOTLINE`, không viết cứng.

### Matcher thường nhật — ba tầng khớp

`server/utils/chatbot/small-talk.ts` là **hàm thuần** `matchSmallTalk(entries, query)`: nhận mục đã nạp từ CSDL + câu hỏi, trả `{ id, category, answer } | null`. Ba tầng khớp theo độ đặc hiệu giảm dần: khớp chính xác câu đã chuẩn hoá → khớp chính xác một pattern → pattern xuất hiện trọn vẹn dưới dạng chuỗi token liên tiếp (pattern dài hơn thắng; hoà thì `displayOrder` rồi `id`). Từ ngắn dễ nhầm (≤4 ký tự không dấu như "duoc", "oi", "ok", "da") chỉ khớp khi **là toàn bộ tin nhắn**. Chốt độ dài nới rộng (≤120 ký tự / ≤20 token) chỉ là lưới an toàn cuối, không phải cơ chế khớp chính — nhờ đó câu đời thường dài như "cho tôi hỏi dùng dịch vụ này có mất phí không ạ" (11 từ) vẫn khớp được.

### Công tắc `small_talk_enabled` (**mặc định bật**, cột vắng đọc là bật)

Chỉ nạp kho thường nhật khi kho nghiệp vụ **không khớp gì** và công tắc bật (kiểm công tắc TRƯỚC khi query, nên tắt thì không tốn round-trip). Ở chế độ AI cũng chặn trước khi gọi provider. `knowledgeGreeting` được prepend cho mọi nhóm TRỪ `social` (tránh chào hai lần). Loại phản hồi `kind: 'small_talk'`. Tắt công tắc → trả về đúng hành vi cũ (xin thông tin liên hệ). RBAC dùng chung resource `chatbot_knowledge` (không tạo resource mới).

### Điều kiện tiên quyết đã sửa — ngưỡng khớp chuỗi con

Ngưỡng khớp chuỗi con cho từ khoá một từ trong `retrieval.ts` nâng từ `>= 3` lên `>= 4`. Với ngưỡng 3, từ khoá "thủ" (không dấu `thu`) khớp token "thức" (`thuc`), nên câu đời thường khớp sai vào kho nghiệp vụ → `references` không rỗng → matcher thường nhật không bao giờ chạy. Âm tiết tiếng Việt không dấu phần lớn dài 2-3 ký tự nên ngưỡng 4 cắt đúng nhóm đó mà giữ khớp tiền tố có nghĩa ("giấy tờ" ↔ "giấy tờ tùy thân", 7 ký tự).

---

## `/qa-documents` — tuyến đọc, không phải tác dụng phụ của trò chuyện

Trang `Tài liệu Hỏi – Đáp` — kho câu trả lời đã duyệt dưới dạng một trang đọc được, không phải một tác dụng phụ của việc trò chuyện. Trước đó `chatbot_knowledge` chỉ tới được bằng cách **đặt đúng câu hỏi khớp một hàng** rồi bấm mở tham chiếu; người chỉ muốn đọc xem cổng đã duyệt những gì thì không có lối vào nào.

- **Là tuyến MỚI, không phải `/legal-qa` trỏ lại.** Hai trang đọc **hai bảng khác nhau**: `/legal-qa` liệt kê `articles` với `type='faq'` (bài biên tập, sửa ở `/admin/content/articles`), còn trang này liệt kê `chatbot_knowledge` (có luồng duyệt nháp→published + bắt buộc nguồn, sửa ở `/admin/chatbot/knowledge`). Trỏ `/legal-qa` sang kho chatbot là **làm biến mất** toàn bộ bài biên tập đang đứng ở đó.
- **Widget giữ nguyên phần mở tại chỗ VÀ có thêm liên kết ra trang.** Mở tại chỗ trả lời "vừa rồi bot dẫn cái gì" mà không đá khách ra khỏi cuộc hội thoại; liên kết `#qa-<id>` trả lời câu tiếp theo — chủ đề xung quanh. Thay cái trước bằng cái sau là bắt khách trả bằng cuộc hội thoại của họ để đọc một tham chiếu.
- **Endpoint `GET /api/public/chatbot/knowledge`**: `status='published'` duy nhất; projection dựng từ `serializePublicKnowledge` **chứ không** `select()` trên bảng, nên ai đó thêm cột sau này cũng không đẩy được `internalNotes` ra ngoài. `perPage` chặn trần 50. Chủ đề trong facet chỉ đếm **hàng đã xuất bản** — lấy từ cả bảng là quảng cáo một chủ đề rỗng, bấm vào thì danh sách trống mà không có lời giải thích nào. Lỗi truy vấn trả `ok: false` (trang đổi thành nhánh lỗi có nút thử lại) thay vì mảng rỗng: **một lượt truy vấn hỏng không được phép đọc ra "cổng chưa duyệt gì cả"**.
- **Chủ đề lạ trả trang rỗng, không trả 400.** Bộ lọc nằm trong URL mà khách sửa được và chia sẻ được; một liên kết cũ mà báo lỗi thì đọc ra là cổng bị hỏng.
- **Số trong query phải qua `Number.isFinite` TRƯỚC khi kẹp biên, ở cả hai đầu.** (Cùng quy tắc `finitePositive` — xem `data-layer.md`.) Trang cũng tự phân tích `route.query.page` nên phải sửa cùng chỗ; có test chặn cả hai dạng viết sai.
- **Accordion cho phép mở nhiều mục cùng lúc** (`openIds` là `Set`, không phải một `activeIndex` như `/legal-qa`): ở đây khách đang đọc và đối chiếu, đóng câu trả lời trước để mở câu sau là đánh đổi sai. Neo `#qa-<id>` **tự mở** mục được trỏ tới — tới một danh sách đóng hết thì đọc ra là liên kết chết. Câu trả lời hiện bằng **văn bản** (`whitespace-pre-line`), tuyệt đối không `v-html`.
- `q` / `topic` / `page` đọc từ URL (chia sẻ được, F5 không mất bộ lọc), `lazy: true` để khung xương thật sự được vẽ khi đổi bộ lọc, `swr: 60` cùng lý do như `/legal-qa`. `tests/public-qa-documents-page.test.ts` chặn cả bộ: nó **bỏ comment trước khi khẳng định** những thứ "không được xuất hiện" — nếu không, chính dòng giải thích *vì sao* `internalNotes` phải ở lại máy chủ sẽ làm đỏ cái test nó đang giải thích, và bài học rút ra sẽ là xoá lời giải thích chứ không phải giữ guard.

---

## Phiên trò chuyện — một composable, hai bề mặt

Chữ ra từ từ, nhiều cuộc hội thoại, trang toàn màn hình, lưu SQL — bốn thứ này ăn khớp nhau qua **một** composable `app/composables/useChatbot.ts`. Widget (`app/components/ChatWidget.vue`) và trang `/assistant` là hai bề mặt của cùng một state ở **cấp module**, không phải state theo từng lời gọi: khách bấm nút mở rộng giữa cuộc hội thoại phải rơi vào đúng cuộc đó, không phải một cuộc mới.

### "Chữ ra từ từ" là hiệu ứng phía client, không phải streaming

`/api/public/chatbot` đợi xong cả câu trả lời rồi phát **một** sự kiện SSE — nó luôn làm vậy, và đổi thành streaming token thật sẽ phải viết lại từng provider. `playTypewriter` tách chữ bằng `fullText.match(/\S+\s*/g)` — **giữ nguyên dấu phân cách** nên chuỗi ghép lại giống hệt từng byte; `split(' ')` sẽ gộp mất dòng mới và **âm thầm định dạng lại văn bản pháp luật** trên đường ra màn hình. Tôn trọng `prefers-reduced-motion` (hiện ngay). Trong lúc chạy, `isStreaming` **che nhãn loại trả lời, danh sách nguồn và biểu mẫu để lại liên hệ** — ba thứ này xuất hiện giữa lúc chữ đang chạy sẽ trông như câu trả lời đã xong khi nó chưa xong. `persist()` **bỏ qua** tin nhắn còn `isStreaming`: tải lại trang mà phục hồi một câu mới gõ được nửa thì không còn gì để gõ tiếp.

### Nhịp typewriter — sàn và trần đã bị tinh chỉnh sai theo hai hướng ngược nhau

Nhịp tính theo thời gian đã trôi qua, không đếm số lần timer nổ, và tổng thời lượng có trần (`TYPEWRITER_WORD_DELAY_MS = 70`, `TYPEWRITER_MAX_MS = 6000`). `setInterval` một từ mỗi nhịp hứa ba điều trình duyệt không giữ: rằng nhịp đến đúng hẹn (tab nền bị hãm còn ~1 lần/giây, nên chuyển tab giữa câu trả lời kéo animation thành vài phút), rằng mỗi nhịp không tốn gì (mỗi nhịp ghi DOM rồi bề mặt đọc `scrollHeight` — **một lượt ép layout cho mỗi từ**), và rằng độ dài câu trả lời có giới hạn (không: câu ~330 từ chạy ~10 giây trong khi toàn bộ nội dung **đã nằm sẵn trong bộ nhớ**). Đọc đồng hồ mỗi khung hình khiến một khung đến muộn hoặc bị gộp tự bù bằng cách hiện nhiều từ hơn, nên câu trả lời luôn xong trong trần bất kể dài bao nhiêu hay tab có đang hiện. Chạy trên `requestAnimationFrame` (tab nền ngừng vẽ nên ngừng nổ — đúng, vì không ai đang xem), lùi về `setTimeout(16)` lúc SSR.

- **`target` KHÔNG được có sàn `Math.max(index + 1, …)`.** Bản đầu có, và cái sàn đó buộc **mỗi khung hình hiện thêm ít nhất một từ** — tức playback chạy ở **tốc độ vẽ của màn hình (~60 từ/giây)**, không phải ở nhịp đã khai. Hệ quả: `TYPEWRITER_WORD_DELAY_MS` **chỉ có tác dụng với câu dài đủ để chạm trần**, còn mọi câu ngắn hơn thì sửa hằng số **không đổi được gì khách nhìn thấy**. Đo lại kho trả lời thường nhật (121 mục, gồm cả answer nhiều dòng dùng template literal): **trung vị 27 từ, dài nhất 50, và KHÔNG mục nào chạm ngưỡng ~85 từ của trần** — nghĩa là *toàn bộ* câu trả lời đời thường nằm trong vùng mà hằng số bị vô hiệu, và ở 60 từ/giây thì một câu 27 từ loé qua trong nửa giây. Đây là lý do khiếu nại "nháy quá nhanh" xuất hiện *sau khi* đã có trần: trần không phải nguyên nhân, cái sàn mới là. Bỏ sàn đi thì đồng hồ là thứ duy nhất quyết định nhịp, và **khung hình nào chưa tới hạn một từ mới thì không ghi DOM, không gọi `onTick`** — gọi vô điều kiện là ép layout mỗi khung hình để vẽ lại đúng thứ văn bản không đổi.
- **Hai hằng số trả lời hai câu hỏi khác nhau, và đã bị tinh chỉnh sai theo hai hướng ngược nhau.** Nhịp mỗi từ = "chữ hiện nhanh cỡ nào" (70ms ≈ 14 từ/giây, tốc độ của các giao diện chat streaming khách đã quen); trần = "câu dài nhất được giữ khách bao lâu" (6 giây, bắt đầu có hiệu lực từ ~85 từ trở lên, nên mọi câu đời thường và phần lớn câu đã duyệt vẫn giữ nguyên nhịp đầy đủ). `tests/chatbot-typing-playback.test.ts` **đọc chính hai hằng số này** (chúng được `export`) rồi kiểm trong một dải hợp lý, thay vì viết cứng một mốc thời gian — mốc cứng đã lệch pha với hằng số hai lần. Kèm một test chạy thật một câu 20 từ và đòi thời lượng phải **tiến gần** `20 × nhịp`: đó là test duy nhất bắt được cái sàn mỗi khung hình, và nó đã được kiểm chứng là **đỏ khi sàn quay lại**.

### Cuộn theo nội dung mới chỉ khi khách đang ở đáy

`scrollChatBottom(force = false)` + `followChatBottom`, cả hai bề mặt. Playback nay chạy mỗi khung hình, nên một lệnh `scrollTop = scrollHeight` vô điều kiện sẽ **liên tục giật màn hình xuống** trong lúc khách cuộn lên đọc lại câu cũ — họ không thể ở lại đó được. Dung sai 48px cho chiều cao lẻ pixel. `force` dành cho lúc mở widget / đổi hội thoại / mount đầu: ở đó `scrollTop = 0` và đáy là chỗ **cố ý** đến, không phải chỗ khách tự chọn. Đừng truyền thẳng `scrollChatBottom` làm `onTick` — nó nhận tham số đầu thành `force`, tức là vô hiệu hoá đúng phần vừa thêm.

### `playTypewriter` phải nhận phần tử đọc ra từ mảng, không nhận object literal vừa push

`conversations` là `ref`, nên Vue phát cho **mỗi phần tử một proxy** và chỉ những lần ghi **đi qua proxy đó** mới lên lịch vẽ lại. Gõ chữ vào object thô thì dữ liệu đúng mà **không ai được thông báo**: bong bóng đứng im ở chữ đầu tiên rồi điền hết một lúc vào lần tiếp theo có thứ khác chạm vào mảng — tức là khi khách gửi tin sau. Lỗi này sống sót qua mọi test dùng object JavaScript thường, vì ở đó "thô" và "proxy" là **cùng một thứ**; `tests/chatbot-typing-playback.test.ts` dựng `ref` + `watchEffect` thật và **đếm số lần render** để bắt đúng nó.

### Vé phiên do máy chủ cấp, không phải client tự ký

`server/utils/chatbot/session-token.ts`, `POST /api/public/chatbot/session`: `<uuid>.<hmac>` với hmac là `HMAC-SHA256(ANALYTICS_HMAC_SECRET, uuid)` cắt còn 32 hex, so bằng `timingSafeEqual`. Trình duyệt **không thể** tự tính HMAC mà không giữ bí mật, và gửi bí mật xuống trình duyệt là làm chữ ký thành vô nghĩa — ai cũng ký được mọi thứ. Vé này là **khoá tương quan, không phải xác thực**: cổng chat không cần đăng nhập và sẽ không bao giờ cần. Chữ ký mua đúng một thứ — không ai chèn được tin nhắn vào một `sessionId` mà họ không được cấp, nên một bản ghi hội thoại không bị trộn tin của người khác và trang quản trị không bị gieo hội thoại giả. Bỏ header đi thì khách chỉ mất bản ghi **của chính họ**.

### Bẫy bot `_h`

Honeypot, nằm ngoài thứ tự tab: điền vào thì trả **200 kèm một câu trả lời hợp lý**, không bao giờ 400/403 — mã trạng thái khác sẽ chỉ cho con script biết đúng ô nào đã tố nó.

### Giới hạn tần suất — trừ ngay trước mỗi lời gọi provider

Đã chuyển sang bảng `rate_limit_counters` (`chat-policy.ts` — `Map` trong tiến trình đã bị **xoá**): sống qua restart, đúng khi chạy nhiều replica, mất CSDL thì lùi về bộ nhớ tiến trình chứ không mở toang. Hạn mức AI **tính theo phiên** (20 lượt / 60 phút) và **trừ ngay trước mỗi lời gọi provider**, không trừ ở đầu handler: trừ trước sẽ tiêu hạn mức cho những câu trả lời lấy từ kho mà không hề gọi provider, rồi cắt một người chưa dùng gì. Hết hạn mức mà **đã có tham chiếu trong tay** thì lùi về câu trả lời đã duyệt — câu đã duyệt vẫn là câu trả lời; chỉ nhánh hỏi tự do mới trả `rate_limited`.

### Ghi CSDL được `await`, không bắn rồi bỏ

`session-db.ts`: Nitro có thể dỡ context của request khi handler trả về, cắt một promise rời tay giữa lúc truy vấn. Hàm **tự nuốt lỗi của mình** (`chat_session.persist_failed`) nên `await` không thể làm hỏng câu trả lời — một bộ ghi log không có tư cách làm sập trang của khách. `ON DUPLICATE KEY UPDATE` **không chạm `started_at`**: một phiên bắt đầu đúng một lần. Số điện thoại / họ tên phát hiện được ghi bằng `COALESCE` nên tên nêu ở lượt 2 và số nêu ở lượt 5 **cùng sống**, chứ không xoá nhau.

### Trang quản trị `/admin/chatbot/sessions`

Dùng chung quyền `chatbot_knowledge.read` — ai được đọc kho câu trả lời đã duyệt thì cũng được đọc câu hỏi khách đặt cho nó; tạo resource mới là buộc cấp lại quyền cho mọi vai trò đang có trước khi trang chạy được. **Mọi lượt xem tự ghi một dòng** `activity_logs` kèm bộ lọc: những hàng này chứa địa chỉ IP và có khi cả số điện thoại, và một nhật ký quét được trong im lặng là công cụ theo dõi. Trang chi tiết **đối chiếu số điện thoại với `submissions`** bằng 9 chữ số cuối (`REGEXP_REPLACE` + `RIGHT`) chứ không so chuỗi thô — biểu mẫu nhận cả `0903 480 985`, `+84903480985` và `0903480985` là cùng một số, nên so thẳng sẽ trượt gần hết ca thật. Đây là lý do việc phát hiện số điện thoại tồn tại: một người hỏi bot rồi sau đó gửi biểu mẫu là **một người với một vấn đề**, và cán bộ không thấy được cả hai nửa sẽ gọi lại hỏi đúng thứ họ đã gõ.

### Phát hiện liên hệ cố tình bảo thủ

`contact-detect.ts`: chỉ nhận đầu số di động (`03/05/07/08/09`, đúng 10 số) — số cố định **cố ý loại ra**, và số căn cước / số nghị định không được ghi thành số liên hệ. Tên chỉ nhận khi có động từ giới thiệu tường minh ("tôi tên", "em là"); đoán tên theo chữ hoa sẽ sai liên tục trong tiếng Việt, và một cái tên sai gắn vào phiên còn tệ hơn không có tên. Tiểu từ cuối câu bị cắt (`ạ`, `nhé`, `ơi`, …) nhưng **"a" không dấu thì không** — "Nguyễn Văn A" là cách viết tên phổ biến nhất, cắt chữ "A" đó sẽ phá nhiều tên hơn số tiểu từ dọn được.

### Đã đăng ký với `data-retention.ts`

`chat_sessions` là scope thứ ba, mặc định 90 ngày, cấu hình tại `/admin/settings/data-retention`. Hai bảng này chứa IP, user agent và có khi cả số điện thoại — đúng loại dữ liệu cần thời hạn lưu. Bảng già theo **`last_message_at`** chứ không phải `started_at` (bảng không có `created_at`), và cap sắp xếp theo cùng cột đó vì `id` là UUID. `chat_messages` **không** có cửa sổ riêng: FK `ON DELETE CASCADE` đã dọn nó theo phiên, còn một cửa sổ độc lập sẽ để lại tin nhắn mồ côi hoặc cắt ngang hội thoại. Chi tiết ở `CLAUDE.md` mục "Tự động dọn dữ liệu".
