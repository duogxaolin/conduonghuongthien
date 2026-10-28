# Chatbot — diễn giải vì-sao

Phần này bổ sung cho `CLAUDE.md` mục 3 (Trợ lý Chatbot).
Quy tắc hành động nằm trong `CLAUDE.md`; tệp này giữ **lý do và ràng buộc**.

---

## Hai kho tách biệt — ranh giới do trình biên dịch giữ

Chatbot có hai nguồn trả lời độc lập ở tầng lược đồ, ranh giới do trình biên dịch giữ chứ không do ai phải nhớ.

- **Kho nghiệp vụ** (`chatbot_knowledge`, không đổi): mỗi câu là phát ngôn pháp lý, có luồng duyệt nháp→published và bắt buộc có nguồn (`validatePublish`). Đây là kho **luôn được ưu tiên**.
- **Kho trả lời thường nhật** (`chatbot_small_talk`, bảng thứ 31): dữ liệu **quản lý được** tại `/admin/chatbot/small-talk` — cán bộ sửa lời văn, bật/tắt, thêm mục mà không cần deploy. KHÔNG có luồng duyệt, KHÔNG bắt nguồn. Năm nhóm: `social` (xã giao), `identity` (danh tính & năng lực bot), `navigation` (điều hướng cổng), `support` (hỗ trợ cảm xúc — mọi câu phải điều hướng về Công an xã/phường hoặc hotline, không tư vấn tâm lý, không hứa kết quả), `portal_facts` (thường thức về chính cổng). Dataset mặc định ~121 mục ở `server/data/chatbot-small-talk-seed.ts`, nạp **insert-only** qua `seed.ts` (khoá trên câu hỏi đã chuẩn hoá) nên lời văn cán bộ đã sửa sống qua mọi lần khởi động lại. Số hotline luôn nội suy từ hằng `CHATBOT_HOTLINE`, không viết cứng.

### Matcher thường nhật — ba tầng khớp

**Ngoại lệ có tên của "kho luôn thắng" — câu KỂ về hoàn cảnh** (`isSituationStatement` / `matchSituationStatement`, `knowledgeOrSituation` trong `chat-policy.ts`): người dùng hay mở đầu bằng một câu kể ("tôi vừa đi tù về"), không phải câu hỏi. Kho nghiệp vụ khớp từ "tù" và — ở chế độ chỉ-kho, hoặc khi AI chưa cấu hình / hết hạn mức / lỗi (mọi đường "lùi về câu của kho") — trả nguyên văn định nghĩa "Công tác tái hòa nhập cộng đồng là…": đúng nội dung nhưng lạc đề. Ở các đường KHÔNG có AI đó, nếu câu **ngắn (≤10 từ), không dấu hỏi, không từ nghiệp vụ (`BUSINESS_MARKERS`), không từ để hỏi (`QUESTION_MARKERS`)** và khớp một hàng `support`, trả hàng hỗ trợ (lời khuyên việc đầu tiên) thay cho câu của kho. Chế độ AI giữ nguyên: AI trả lời có dẫn chứng + câu hỏi gợi ý. Kiểm "có phải câu kể không" là hàm thuần chạy TRƯỚC khi nạp kho small-talk, nên câu hỏi/nghiệp vụ vẫn không nạp small-talk lần nào (hợp đồng của `tests/chatbot-small-talk-policy.test.ts`). Hàng seed `Tôi vừa đi tù về` (insert-only): production có sẵn dữ liệu small-talk cũ sẽ nhận hàng mới ở lần khởi động tới, nhưng KHÔNG đổi các hàng cán bộ đã sửa. → `tests/chatbot-situation-statement.test.ts`.

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

### Kiểm duyệt và độ dài tin (2026-10-14)

- **Trần độ dài ở cửa vào** (`server/utils/chatbot/input-length.ts`): trần `min(CHAT_LIMITS.maxMessageChars = 10 000, settings.maxInputChars ‖ 2000)` đã có trong `validateChatMessages`, nhưng chỉ chạy bên trong `answerChat` — **sau** `fastPreModerate`, nên kiểm duyệt (kể cả regex tuỳ biến) quét nguyên văn mọi câu hỏi tới trần thân request 64 KB. Nay cả hai endpoint (`/api/public/chatbot`, `/api/chat`) kiểm ngay sau honeypot + trừ hạn mức, trước kiểm duyệt → 400 tiếng Việt. Không ghim 2000 vì quản trị có thể nâng `max_input_chars` (1–10 000). Nơi tự nhiên của hàm là `chat-policy.ts` (chưa chuyển vì ràng buộc phạm vi của lượt sửa).
- **Widget hiện lý do bị từ chối** (G2, 2026-10-14): `useChatbot.ts` từng biến mọi phản hồi không ok thành `CHATBOT_UNAVAILABLE`, nên khách gõ quá trần chỉ thấy "không thể nhận phản hồi". Nay `describeChatSendFailure` (`app/utils/chatbot-storage.ts`, hàm thuần) phân loại: 400 `input_too_long` → câu tiếng Việt của máy chủ (chỉ nhận chuỗi có chữ có dấu, ≤ 300 ký tự — thông điệp lập trình viên ASCII bị bỏ) hoặc câu dựng từ `data.maxChars`; 400 khác/413 → "không hợp lệ"/"quá dài"; 429 → hạn mức; còn lại → không khả dụng. Tin bị từ chối được rút khỏi hội thoại (không vào lịch sử lượt sau) và giữ làm nháp. Trần phía widget mặc định 2000 và chỉ **hạ** theo `maxChars` máy chủ báo về — không endpoint công khai nào lộ `maxInputChars`, nên `max_input_chars` > 2000 vẫn bị widget chặn ở 2000 (còn mở). `useChatbot.ts` nay ~857 dòng.
- **Regex kiểm duyệt** (`server/services/moderation-regex.ts`): bộ kiểm lúc lưu nay là một parser nhỏ (mở nhóm lồng, phát hiện lượng từ kề nhau chồng lấn, allowlist phép hoặc giữa các literal an toàn) thay cho khớp hình dạng; fuzz 9 704 mẫu được nhận, 0 mẫu chậm. Lúc chạy, `testModerationRegex` quét theo cửa sổ 2000 ký tự chồng lấn: một cửa sổ > 200 ms → tắt luật đó 10 phút (`ai_moderation.rule_slow_disabled`), tổng một lượt > 1000 ms → cắt, không tắt. Luật đã lưu không qua bộ kiểm bị bỏ ở **cả hai** đường (chặn tức thì và worker). Kiểm trên CSDL dev: 28 luật hiện có đều là từ khoá, 0 luật đổi kết quả. Vẫn là **giảm, không loại trừ** ReDoS.
- **Quét lại tất cả** (`moderation-rescan-job.ts`): lưu con trỏ sau mỗi lô (khởi động lại không quét lại từ đầu), lô hỏng thử lại một lần, AI chưa cấu hình → chỉ chạy luật và báo `summary.aiUnavailable` (dòng `role="status"` + toast cảnh báo ở `moderation.vue`); chèn hàng duyệt idempotent (`INSERT … SELECT … WHERE NOT EXISTS`, đã kiểm trên MySQL).
- **Bình luận + chat livestream** (G1): giới hạn reader/IP tính trước `fastPreModerate`, trần hàng duyệt 20/giờ theo IP gộp /64 + reader id (`capQueuePerSource`), ngân sách hàng duyệt chung theo địa chỉ với chatbot; `recordInstantBlock` log `ai_moderation.queue_insert_failed` → `realm-safety.md` § "Đợt sửa cuối (G1–G3)".
- Còn mở: khoá giới hạn chung (chat, trần AI theo IP, `comment:ip:`, `livestream:chat:ip:`) vẫn là địa chỉ đầy đủ — xoay địa chỉ trong một /64 IPv6 né được (chỉ trần hàng duyệt đã gộp /64).

### Ghi CSDL được `await`, không bắn rồi bỏ

`session-db.ts`: Nitro có thể dỡ context của request khi handler trả về, cắt một promise rời tay giữa lúc truy vấn. Hàm **tự nuốt lỗi của mình** (`chat_session.persist_failed`) nên `await` không thể làm hỏng câu trả lời — một bộ ghi log không có tư cách làm sập trang của khách. `ON DUPLICATE KEY UPDATE` **không chạm `started_at`**: một phiên bắt đầu đúng một lần. Số điện thoại / họ tên phát hiện được ghi bằng `COALESCE` nên tên nêu ở lượt 2 và số nêu ở lượt 5 **cùng sống**, chứ không xoá nhau.

### Trang quản trị `/admin/chatbot/sessions`

Dùng chung quyền `chatbot_knowledge.read` — ai được đọc kho câu trả lời đã duyệt thì cũng được đọc câu hỏi khách đặt cho nó; tạo resource mới là buộc cấp lại quyền cho mọi vai trò đang có trước khi trang chạy được. **Mọi lượt xem tự ghi một dòng** `activity_logs` kèm bộ lọc: những hàng này chứa địa chỉ IP và có khi cả số điện thoại, và một nhật ký quét được trong im lặng là công cụ theo dõi. Trang chi tiết **đối chiếu số điện thoại với `submissions`** bằng 9 chữ số cuối (`REGEXP_REPLACE` + `RIGHT`) chứ không so chuỗi thô — biểu mẫu nhận cả `0903 480 985`, `+84903480985` và `0903480985` là cùng một số, nên so thẳng sẽ trượt gần hết ca thật. Đây là lý do việc phát hiện số điện thoại tồn tại: một người hỏi bot rồi sau đó gửi biểu mẫu là **một người với một vấn đề**, và cán bộ không thấy được cả hai nửa sẽ gọi lại hỏi đúng thứ họ đã gõ.

### Phát hiện liên hệ cố tình bảo thủ

`contact-detect.ts`: chỉ nhận đầu số di động (`03/05/07/08/09`, đúng 10 số) — số cố định **cố ý loại ra**, và số căn cước / số nghị định không được ghi thành số liên hệ. Tên chỉ nhận khi có động từ giới thiệu tường minh ("tôi tên", "em là"); đoán tên theo chữ hoa sẽ sai liên tục trong tiếng Việt, và một cái tên sai gắn vào phiên còn tệ hơn không có tên. Tiểu từ cuối câu bị cắt (`ạ`, `nhé`, `ơi`, …) nhưng **"a" không dấu thì không** — "Nguyễn Văn A" là cách viết tên phổ biến nhất, cắt chữ "A" đó sẽ phá nhiều tên hơn số tiểu từ dọn được.

### Đã đăng ký với `data-retention.ts`

`chat_sessions` là scope thứ ba, mặc định 90 ngày, cấu hình tại `/admin/settings/data-retention`. Hai bảng này chứa IP, user agent và có khi cả số điện thoại — đúng loại dữ liệu cần thời hạn lưu. Bảng già theo **`last_message_at`** chứ không phải `started_at` (bảng không có `created_at`), và cap sắp xếp theo cùng cột đó vì `id` là UUID. `chat_messages` **không** có cửa sổ riêng: FK `ON DELETE CASCADE` đã dọn nó theo phiên, còn một cửa sổ độc lập sẽ để lại tin nhắn mồ côi hoặc cắt ngang hội thoại. Chi tiết ở `CLAUDE.md` mục "Tự động dọn dữ liệu".

### Ngữ cảnh hội thoại đa lượt (Multi-turn Context Memory)

Trợ lý AI cần khả năng tiếp nhận câu hỏi nối tiếp của người dân (ví dụ: "cho tôi ví dụ", "ở đâu?", "thủ tục thế nào?"). Trước đây `useChatbot.ts` chỉ gửi tin nhắn user gần nhất, khiến câu hỏi nối tiếp bị tách rời khỏi ngữ cảnh và AI trả lời chung chung hoặc từ chối.

- **`boundedUserHistory` gói cả lượt hỏi của user lẫn phản hồi trước đó của bot:** Giới hạn theo cặp `maxHistoryMessages * 2` để đảm bảo chuỗi hội thoại có đầy đủ cặp câu hỏi - câu trả lời, không bao gồm tin nhắn hệ thống (`isWelcome`, `isStreaming`, small talk thuần).
- **Server policy (`chat-policy.ts`):** Cho phép role `assistant` song song với `user` trong `validateChatMessages` và `buildChatHistory` để AI giữ được ngữ cảnh đàm thoại, không cắt bỏ câu trả lời trước đó.
- **System prompt (`prompt-defaults.ts`):** Hướng dẫn model nhận biết đại từ thay thế ("nó", "đó", "ở đâu") trong câu hỏi tiếp nối và tự động gọi các công cụ tra cứu cơ sở dữ liệu C11 (`search_c11_knowledge`, `search_c11_articles`, `search_c11_photos`, `search_c11_videos`) với từ khóa đầy đủ từ ngữ cảnh.

### Chủ quyền biển, đảo — máy chủ trả lời, không qua model (2026-10-27)

**Sự cố.** Khách hỏi bằng tiếng Trung "哪个国家拥有西沙群岛和南沙群岛?". Câu không khớp kho, production đặt `mode=ai` + `ai_freeform`, nên câu đi thẳng tới model (`router.delify.vn`). Model trả lời "西沙群岛和南沙群岛自古以来就是中国领土" và tự giới thiệu là trợ lý của "公安部" (không có "越南"), giúp tìm hiểu "中国法律法规" — tức là đổi ngôn ngữ thì đổi luôn quốc gia. Câu hỏi tiếp theo bằng tiếng Việt thì model lại xin lỗi. Khách đọc được hai lập trường ngược nhau trên cổng của Bộ Công an.

**Vì sao không chỉ sửa prompt.** Có ba lý do:
- Model nằm sau router bên thứ ba: không biết model thật là gì và nó bị huấn luyện theo lập trường nào.
- Quy tắc đa ngôn ngữ ("如果用户用中文提问，请务必用中文回答") kéo câu hỏi tiếng Trung về câu trả lời tiếng Trung, và ngôn ngữ kéo theo khung tham chiếu.
- Câu trả lời stream tới khách trước khi máy chủ đọc được nó.

Prompt là lớp dự phòng, không phải lớp chặn. Prompt mặc định (`DEFAULT_CHATBOT_SYSTEM_PROMPT`) cũng không tới được model khi CSDL đã lưu prompt riêng (dev lưu 3535 ký tự). Vì vậy điều khoản `SOVEREIGNTY_PROMPT_RULES` nằm ở phần `buildGroundedSystemPrompt` luôn nối thêm.

**Lớp chặn là tất định và nằm trước mọi nhánh.** `mentionsSovereignty` chạy trong `answerGroundedChat`, sau `validateChatMessages` + `chargeChatRateLimit`, trước retrieval/chế độ/`enforceAiQuota`. Một chỗ đó phủ cả `/api/public/chatbot` lẫn `/api/chat`, cả `knowledge` lẫn `ai`, cả nhánh có tham chiếu lẫn `ai_freeform`.
- Trả **lập trường chính thức viết sẵn**, không từ chối: một trợ lý của Bộ Công an Việt Nam né câu hỏi chủ quyền cũng là câu trả lời sai.
- Có bản tiếng Trung (黄沙群岛/长沙群岛) và tiếng Anh theo câu hỏi, bản tiếng Việt luôn đi kèm vì đó là bản gốc.
- `kind: 'curated'` dùng lại loại có sẵn — loại mới phải sửa union `ChatResult` và `CHATBOT_RESPONSE_KINDS` của client. Dấu vết vận hành là log `chatbot.sovereignty_answered` (mức info, production mặc định ghi).

**Không làm bằng một hàng kho tri thức.** Ở chế độ AI, hàng khớp vẫn đi qua `callProvider`, nên model vẫn là bên viết câu trả lời. Retrieval cũng không tách token chữ Hán liền nhau.

**Chuẩn hoá trước khi khớp.** NFKC không bỏ ký tự định dạng vô hình (`\p{Cf}`, zero-width), không gộp phồn thể về giản thể (黃/黄, 羣/群, 國/国) và không gộp bộ thủ "⻄" (U+2EC4) về "西", nên bước gộp tự làm. "Ð" (U+00D0, hay lẫn vào chữ Việt) thành "Đ". Hoa/thường được **giữ** tới bước khớp tên riêng.

- **Chữ Hán** chỉ giữ chữ Hán, để "西 沙" vẫn là "西沙". Cái giá: chữ nối qua dấu câu và qua từ ("越南。沙坝" → "越南沙坝"), nên 南海/南沙 không tính khi chữ đứng trước ghép thành từ khác (越南海防, 越南海关, 越南沙坝, 河南沙县, 海南海口, 中南海), 西沙 không tính sau 东/广/江/山/陕 (东西沙发). "越南南沙群岛" vẫn khớp qua chữ 南 thứ hai. "长沙"/"黄沙" trần là thành phố / từ thường: chỉ khớp kèm 群岛/岛 hoặc đi cùng nhau ("黄沙和长沙"). Có thêm 南中国海 và các bãi đá (永兴岛, 赤瓜礁…).
- **Tên riêng viết hoa** ("Trường Sa", "Biển Đông", "Bien Dong", kể cả "Biển-Đông", "Biển  Đông") khớp bất kể từ đứng sau, trừ hướng "biển Đông Bắc/Đông Nam".
- **Chữ thường còn dấu**: "biển đông" (trùng "biến động"/"biển động" khi bỏ dấu) chỉ khớp khi có dấu, trừ "(bãi) biển đông người/khách"; "trường sa" trừ "sa thải/ngã/đọa/sút/lầy/mạc/sầm/lưới/vào/đà/cơ/chân/bàn" — xét trên chữ còn dấu nên "trường sa lấy lại" khớp mà "sa lầy" thì không.
- **Chữ Latin/Kirin bỏ dấu**, có khoảng trắng hai đầu để khớp trọn từ: Hoàng Sa, đảo Trường Sa, Paracel, Spratly/Spratley, Xisha/Nansha, South/S. China Sea, West Philippine Sea, mer de Chine, East Sea, đường lưỡi bò… "й" thành "и", nên mẫu tiếng Nga viết `китаиск`. "gạc ma" trừ "gác ma túy".

**Khớp nhầm có chủ đích:** "đường Hoàng Sa", "đường Trường Sa" (tên phố) cũng nhận câu trả lời này — vô hại, còn bỏ sót thì không. **Lách được có chủ đích** (để lớp đầu ra lo): chữ giãn cách ("H o a n g S a"), chữ Kirin giả Latin ("Hoаng"), "Nam Hải", một từ khoá tách qua hai lượt giả.

**Lịch sử: bỏ khỏi model, không từ chối — kể cả lượt trợ lý.** Đây là ngoại lệ có tên của quy tắc "không quét lượt trợ lý" ở `CLAUDE.md`. Quy tắc đó chống *từ chối oan*; ở đây lượt trợ lý chỉ bị **bỏ khỏi phần gửi model**, không ai bị từ chối. Có hai lý do phải bỏ:
- Câu trả lời sai trước bản vá vẫn nằm trong lịch sử trình duyệt của khách và được gửi lại mỗi lượt.
- Lượt trợ lý do trình duyệt gửi lên, ai cũng giả được.

Bỏ **theo lượt hỏi–đáp**, không theo từng lượt: câu hỏi bị bỏ thì các câu trả lời ngay sau nó (tới câu hỏi kế) cũng bị bỏ. Câu trả lời sai có thể không lặp lại tên quần đảo ("这两个群岛自古以来就是中国领土。我是公安部的助手…") — chính kiểu câu này mang phần "đổi quốc gia" của sự cố. Lượt cuối (câu đang được trả lời) luôn giữ — câu mới khớp thì đã nhận câu trả lời viết sẵn ở trên.

**Lớp chặn đầu ra — cho câu hỏi lách được bộ khớp** (vd. "越中海上争端", "Đảo Ba Bình do ai quản lý?"). Model trả lời câu đó gần như luôn gọi tên quần đảo/biển — kể cả tên Hán-Việt của tên gọi Trung Quốc ("Tây Sa", "Nam Sa", "Tam Sa", nay cũng khớp ở câu hỏi) — nên câu **trả lời** được đọc bằng cùng bộ khớp, cộng các **cụm yêu sách** cho phép chữ chen giữa: "lãnh thổ … của Trung Quốc", "Trung Quốc … chủ quyền / quản lý / kiểm soát", "vùng biển … Trung Quốc", 中国…领土, 中国…主权, 自古以来…中国, "part of China", "China … sovereignty", "indisputable/inherent sovereignty"… Cụm yêu sách **chỉ tính khi có nói tới đảo/biển** — trong cùng đoạn (đảo, vùng biển, lãnh hải, 岛, 礁, 海域, islands, reef…, kể cả tên từng đảo/bãi hay được hỏi lẻ: Ba Bình/Itu Aba/太平, Phú Lâm/Woody, Chữ Thập, Vành Khăn, Scarborough/黄岩…; "đảo" động từ như "đảo lộn", "đảo nợ", "khuynh đảo" không tính) hoặc trong câu hỏi đang được trả lời ("Hòn đảo đó thuộc nước nào?" → "Nó là lãnh thổ của Trung Quốc") — và không bao giờ xét ở câu hỏi: người hoàn lương từng chấp hành án "trên lãnh thổ Trung Quốc" là đúng đối tượng của cổng, model sẽ nhắc lại đúng câu đó cho họ. `createSovereigntyOutputGuard` bọc `onChunk` (bên trong bộ lọc gợi ý: provider → gợi ý → chủ quyền → endpoint):
- **Không dừng được provider.** `callAi` không nhận `AbortSignal`, và `readChatSse` nuốt lỗi ném từ `emit`. Sau khi chặn, bộ lọc chỉ im lặng tới khi model viết xong.
- **Thay ngay, không đợi hết.** Lúc chặn, `onReplace` (tham số mới của `answerGroundedChat`/`answerChat`) ghi một khung SSE `{ choices:[{delta:{content:"\n\n"+lập trường}}], chatbot:{ replace: lập trường } }`. Widget hiện tại thay chữ đang hiện (`parseSseLine`); tab đang chạy bản widget cũ chỉ biết nối `content` nên vẫn nhận lập trường sau phần đầu. Endpoint đánh dấu `streamed` để không phát lại `result.answer` (không nhân đôi).
- **Giữ đuôi 48 ký tự.** Cụm bị cắt giữa hai chunk (`中国|领土`, `Hoàng| Sa`) không hiện ra nửa chừng; chữ Latin chỉ xét tới ranh giới từ cuối ("Hoàng Sa|ng" là tên người). Mẫu loại trừ theo từ đứng sau ("trường sa |thải", "biển Đông |Bắc", "gác ma |túy") chỉ tính khi khớp với mọi từ thử trong `NEXT_WORD_PROBES`. Ngoại lệ đã biết: từ theo sau một cụm cần-biết-từ-sau dài bất thường (> ~40 chữ liền) làm lọt vài chữ đầu cụm — widget mới vẫn rút lại khi chặn.
- **Tìm ứng viên trên đoạn cuối, xác nhận trên cả luồng.** Mỗi chunk chỉ xét 24 chữ Hán cuối và 96 ký tự cuối + chunk mới (tuyến tính: 8000 ký tự tiếng Việt chunk 3 ký tự ≈ 65 ms, 8000 chữ Hán từng chữ một ≈ 230 ms). Đoạn cuối có thể mất chữ đứng trước ("bãi" trôi khỏi cửa sổ của "bãi biển đông vào cuối tuần", "越" của "越南海防"), nên ứng viên được xác nhận lại trên cả luồng trước khi chặn. Lúc chữ "đảo/岛…" đầu tiên xuất hiện, yêu sách đứng trước nó (xa hơn cửa sổ) được xét lại trên cả luồng. Cụm yêu sách xuất hiện khi chưa có chữ đảo/biển thì **giữ chữ lại** từ đó: chữ đảo/biển tới sau → chặn, không có → nhả hết ở `finish` (câu trả lời cho người từng thụ án ở Trung Quốc chỉ hiện chậm, không bị thay).
- **Hết luồng** (`finish`): xét cả câu trả lời cuối (bắt "…về Trường Sa" ở đúng cuối, và đường `/api/chat` không stream), sạch thì nhả phần đuôi đang giữ. Bị thay → `kind: 'curated'`, không nguồn, không gợi ý; câu trả về và câu lưu (`persistChatTurn`) là lập trường. Đề xuất gợi ý của model nhắc chủ đề bị bỏ. Câu truy vấn công cụ do model viết ("Truy vấn: «…»" dưới câu trả lời, còn lại sau khi thay) nhắc chủ đề thì không gửi xuống. Provider hỏng sau khi đã thay → vẫn trả lập trường.
- Lượt trợ lý cũ cũng được xét theo kiểu đầu ra (có cụm yêu sách) khi bỏ khỏi lịch sử.

**Còn hở.** Câu trả lời nêu lập trường sai mà không gọi tên quần đảo/biển nào trong danh sách, hoặc nêu yêu sách mà cả câu trả lời lẫn câu hỏi không có chữ đảo/biển ("Hai quần thể này từ xưa đã thuộc về Trung Quốc", "这两个地方自古以来就是中国领土"), hoặc diễn đạt vòng ngoài các cụm yêu sách — chỉ prompt chặn. **Chặn nhầm đã biết** (vô hại — khách thấy lập trường): câu trả lời có cả đảo lẫn "thuộc Trung Quốc"/"Trung Quốc kiểm soát" vì lý do khác ("làm thuê ở đảo Hải Nam thuộc Trung Quốc"). Gateway hỏng (`ok:false`) sau khi đã chặn thì `callProvider` vẫn gọi thêm đường trực tiếp cũ (kết quả bị bỏ, chỉ tốn một lượt). Bản dịch bài viết do AI viết (zh/en…) không qua lớp nào. Câu trả lời sai trước bản vá còn nằm trong `localStorage` của trình duyệt khách và hiện lại khi tải trang (máy chủ không xoá được; chỉ không gửi nó tới model nữa).

`tests/chatbot-sovereignty-guard.test.ts`:
- Cả hai đường tới model đều giả (`callAi` qua `mock.module`, `providerRequest`), trả đúng câu của sự cố; khẳng định provider **không được gọi** ở ba chế độ, và một câu hỏi thường thì có gọi (để số đếm có nghĩa trên mọi máy).
- Cặp hỏi–đáp bị đầu độc — kể cả câu trả lời không lặp tên quần đảo — không tới model. Đã kiểm: bỏ theo từng lượt thay vì theo cặp thì hai test đỏ.
- Bộ khớp nhận các biến thể (kể cả các câu đợt kiểm độc lập 2026-10-28 tìm ra) và không nhận câu đời thường cùng âm tiết/chữ (越南海防, 河南沙县, "gác ma túy", "sa đà").
- Điều khoản prompt đi kèm cả prompt quản trị tự viết.

`tests/chatbot-sovereignty-output.test.ts` (`callAi` giả phát từng chunk) + `tests/chatbot-sovereignty-stream-endpoint.test.ts` (handler thật, `parseSseLine` thật):
- Cụm/yêu sách cắt giữa hai chunk không lọt mẩu nào; câu thường cùng âm tiết, cắt đúng trước từ quyết định ("trường sa |thải", "biển Đông |Bắc", "gác ma |túy", "Trung |Quốc"), đi qua nguyên vẹn.
- Câu hỏi lách được bộ khớp: phần stream không lọt, `onReplace` gọi đúng một lần, câu trả về là lập trường; `/api/chat` cũng vậy; câu sạch giữ `kind: 'provider'`.
- Khung SSE: widget mới chỉ còn lập trường, widget cũ nhận nó đúng một lần, bản lưu là lập trường — cả khi thay trước chữ đầu tiên.
- Cụm yêu sách quen dùng (các câu đợt kiểm độc lập lần hai tìm ra) bị bắt; năm câu trả lời cho người hoàn lương từ Trung Quốc về (không có đảo/biển) thì không. Câu dài có "bãi" trôi khỏi cửa sổ không bị chặn oan; yêu sách đứng trước chữ "đảo" bị chặn đúng ở chunk mang chữ đó.
- Provider hỏng sau khi thay, đề xuất gợi ý nhắc chủ đề (kể cả khi kho trả lời được), câu truy vấn công cụ nhắc chủ đề.
- Lần kiểm thứ ba: yêu sách viết trước chữ đảo không hiện ra; cụm giống yêu sách mà không có đảo/biển hiện đủ khi xong; câu hỏi về một hòn đảo làm câu "Nó là lãnh thổ của Trung Quốc" bị chặn; "Tây Sa Đéc", "Việt Nam Sa Pa", "anh Nam Sa thải tôi" không bị bắt; tên đảo/bãi lẻ đủ làm ngữ cảnh. Thêm 5 đột biến (bỏ giữ chữ khi có yêu sách, bỏ loại trừ địa danh sau "Sa", tính "đảo" động từ, bỏ tên đảo/bãi, bỏ ngữ cảnh câu hỏi) — mỗi cái làm test đỏ.
- Đã kiểm 13 đột biến (bỏ lớp chặn ở policy, bỏ giữ đuôi, bớt từ thử, widget bỏ `replace`, endpoint quên `streamed`, bỏ cụm yêu sách, bỏ điều kiện đảo/biển, chặn ngay trên ứng viên, không xét lại khi gặp chữ "đảo", bỏ lọc gợi ý, bỏ lọc truy vấn công cụ, ném lại lỗi sau khi thay, bỏ "Tây/Nam/Tam Sa"): mỗi cái làm ít nhất một test đỏ.

---

## Trợ lý AI Biên tập & Soát lỗi bài viết (`editorial_assistant`)

Nằm tại `/admin/content/articles/[id]` và `POST /api/admin/ai/editorial`.

### Giới hạn token & vị trí mảng `changes`

- **Vấn đề đã trả giá:** `buildProviderChatCall` ban đầu gán cứng `max_tokens: 1200` (`MAX_ANSWER_TOKENS`), bỏ qua cấu hình `maxTokens: 4096` của `ai_service_configs`. Khi bài viết HTML dài (trên 3.000 ký tự), việc AI lặp lại toàn bộ mã HTML ở trường `polishedContent` rồi mới đến mảng `changes` khiến JSON bị cắt cụt giữa chừng ngay cuối mảng, ném `SyntaxError` lúc parse và rơi vào nhánh fallback in chuỗi JSON thô ra màn hình.
- **Giải pháp:**
  1. Cho phép `ChatCallInput` và `buildProviderChatCall` nhận `maxTokens` từ config dịch vụ (`ai_service_configs.maxTokens` = 4096).
  2. Đảo schema JSON: đưa `changes` và `summaryNotes` lên trước `polishedContent`. Dù bài viết có dài thì danh sách lỗi và đề xuất sửa đổi vẫn luôn được hoàn thành trước.
  3. Bổ sung bộ phân tích phục hồi (recovery parser) dùng regex bóc tách từng thẻ `{ original, suggested, reason }` trong trường hợp token phản hồi bị dở dang.

### Giao diện Diff trực quan & Cầu nối TinyMCE

- **Diff theo từng thẻ:** Thay vì đè toàn bài không kiểm soát, chia thành từng lỗi cụ thể: đoạn gốc (gạch ngang đỏ), đề xuất (xanh đậm), lý do pháp lý/chính tả, nút áp dụng lẻ `✓ Áp dụng sửa đổi này` và nút áp dụng toàn bộ `✓ Áp dụng tất cả sửa đổi vào bài viết`.
- **Hàm lấy nội dung TinyMCE phải hoisted:** `getEditorContent()` phải được khai báo dạng `function getEditorContent(): string` ở đầu script setup, tránh lỗi Temporal Dead Zone (TDZ) do khai báo `const` sau hàm `callAiEditorial` khiến nội dung gửi lên máy chủ bị rỗng (`undefined`).
