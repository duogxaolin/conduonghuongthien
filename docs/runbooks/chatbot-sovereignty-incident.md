# Sự cố: lớp chặn chủ quyền biển, đảo của chatbot vừa thay một câu trả lời

Dành cho người trực vận hành. Lý do thiết kế và lịch sử bản vá: `docs/decisions/chatbot.md` § Chủ quyền biển, đảo.

## 1. Thư cảnh báo nghĩa là gì

Thư tới `OPS_ALERT_EMAIL` (cấu hình ở `production/README.md` § Thư cảnh báo vận hành) với một trong hai tiêu đề:

| Sự kiện | Nghĩa là | Khách đã nhận gì |
|---|---|---|
| `chatbot.sovereignty_output_replaced` | **Mô hình AI vừa viết** một câu trả lời nêu hoặc ngụ ý yêu sách chủ quyền của nước khác (hoặc đi vào chủ đề biển, đảo mà bộ khớp đầu vào không bắt). Lớp chặn đầu ra giữ chữ lại và thay bằng lập trường chính thức. | Lập trường chính thức của Việt Nam (đã thay phần chữ đang hiện, nếu có). |
| `chatbot.sovereignty_cached_answer_replaced` | Một câu trả lời **đã lưu trong bộ nhớ đệm** (`/admin/chatbot/answer-cache`) bị lớp chặn bắt khi phát lại. Hàng đó đã bị xoá khỏi bộ nhớ đệm. | Lập trường chính thức. |

Cả hai nghĩa là: **lớp chặn đầu ra vừa thay một câu trả lời**. Có thể là một lần mô hình thật sự lệch (câu hỏi mà bộ khớp đầu vào bỏ sót, hoặc model viết điều không được nói) — nhưng lớp chặn cố ý chặn rộng (*recall là cổng cứng*) nên cũng thay cả câu trả lời **hợp lệ** có nhắc tới biển, đảo (đã ghi nhận ở `docs/decisions/chatbot.md`: câu hỏi về Cát Bà, Jeju, Bali). Vì vậy **đọc câu hỏi trước khi kết luận** (mục 2) và phân loại ở mục 3 — đừng mặc định đây là sự cố.

Thư **không** chứa câu hỏi, câu trả lời, mã phiên hay IP của khách (cố ý, vì riêng tư). Thư chỉ có tên sự kiện, giờ (UTC), máy chủ và dòng mô tả cố định; khi có lần bị gộp thì thư kế tiếp thêm dòng "còn N lần cùng sự kiện không gửi thư".

**Giới hạn gửi thư:** tối đa **1 thư mỗi sự kiện mỗi 10 phút** (cận trên 144 thư/ngày/sự kiện; hằng `SOVEREIGNTY_ALERT_WINDOW_SECONDS` ở `server/utils/ops-alert.ts`, tăng lên nếu quá ồn). Lưu ý: **khách bất kỳ** có thể gây ra thư này nếu tìm được một câu hỏi lọt bộ khớp đầu vào mà model trả lời vào chủ đề — đó là lý do thư không mang nội dung câu hỏi và có trần tần suất; hạn mức AI theo phiên/IP (`enforceAiQuota`) cũng giới hạn khả năng gây thư của một người. Thư đầu tiên là tín hiệu. Số lần lặp của cả đợt nằm ở thư kế tiếp; nếu sau đó không có lần thay nào nữa thì thư số lần **không** tới. Muốn số chính xác, đếm dòng log (mục 2). Chưa cấu hình `OPS_ALERT_EMAIL` hoặc SMTP (`/admin/settings/email`) thì **không có thư**, chỉ có log (SMTP thiếu: thêm dòng `ops.alert_failed`).

Dòng `chatbot.sovereignty_answered` (mức info) là việc bình thường: bộ khớp đầu vào tự trả lời câu hỏi chủ quyền. Dòng đó **không** gửi thư.

## 2. Xác nhận trong 5 phút

1. Đếm và lấy giờ trên VPS: `journalctl CONTAINER_TAG=cdkt-app | grep -E 'sovereignty_(output|cached_answer)_replaced'` (máy dùng log `json-file` thay journald: `docker compose logs app | grep -E 'sovereignty_(output|cached_answer)_replaced'`, xem `production/README.md` § Log của app). Mỗi dòng là một lần thay (mức warn); log cũng không có câu hỏi hay câu trả lời.
2. Tìm phiên: `/admin/chatbot/sessions`, lọc theo ngày (giờ trong thư là UTC, cộng 7 để ra giờ Việt Nam), mở các phiên quanh thời điểm đó. Trang chưa có ô tìm theo nội dung. Trong phiên, lượt bị thay là lượt trợ lý có nội dung **bắt đầu bằng lập trường chính thức** ("Quần đảo Hoàng Sa và quần đảo Trường Sa là một bộ phận…"). Đừng dựa vào nhãn loại `curated`: câu trả lời từ Kho kiến thức cũng mang nhãn đó, nên nhiều lượt trông giống nhau. **Chữ mà model đã viết không được lưu ở đâu cả** (log chỉ có dòng mô tả cố định, phiên chỉ có lập trường chính thức): chỉ khôi phục được câu hỏi của khách, không khôi phục được câu bị chặn. **Đây là dữ liệu của người dân: chỉ xem để xử lý sự cố, không chép ra ngoài.**
3. Với `…cached_answer_replaced`: mở `/admin/chatbot/answer-cache`, xem còn hàng nào cùng câu hỏi (hàng bị bắt đã xoá; hàng cùng nội dung ở khoá khác vẫn có thể còn).

## 3. Hành động ngay

Làm lần lượt theo mức độ. **Bước 0 — phân loại:** nếu câu hỏi là câu hợp lệ bình thường (vd. hỏi du lịch Cát Bà, tên một nước có chữ trùng) thì đây là chặn oan: **không** tắt AI, chỉ chuyển người phát triển ghi nhận (chặn oan là mục tiêu mềm; không sửa tay bộ khớp). Chỉ khi câu hỏi thật sự về chủ quyền/tranh chấp, hoặc sự kiện lặp lại nhiều lần từ nhiều phiên, mới làm tiếp các bước dưới:

1. **Đưa chatbot về "Chỉ kho kiến thức (không AI)"**: `/admin/chatbot/settings` → chế độ trả lời → *Chỉ kho kiến thức*. Không còn model nào viết câu trả lời cho khách, nên không còn nguồn của sự cố; câu chủ quyền vẫn do máy chủ trả lời. Đây là biện pháp mạnh nhất và đảo ngược được (đổi lại sang chế độ AI). Lưu cấu hình tự tăng phiên bản bộ nhớ đệm.
   - Chưa muốn tắt AI: đổi "Khi câu hỏi nằm ngoài Kho kiến thức" sang *Chỉ bám Kho kiến thức + mời để lại thông tin*. Cách này thu hẹp bề mặt, **không** loại trừ (câu có hàng khớp trong kho vẫn qua model).
2. **Xoá bộ nhớ đệm câu trả lời**: `/admin/chatbot/answer-cache` → *Xoá toàn bộ*. Bắt buộc khi sự kiện là `…cached_answer_replaced` hoặc khi nghi một câu sai đã được lưu. Cache chỉ phát lại câu cũ (vẫn qua lớp chặn); xoá để không còn câu cũ nào của model.
3. Nghi cấu hình AI bị đổi (prompt, nhà cung cấp, model): xem `/admin/ai`. Đổi đích gọi (`baseUrl`) chỉ SuperAdmin làm được.

## 4. Sửa gốc: không làm tay

- **Không sửa** bộ khớp (`server/utils/chatbot/sovereignty-*.ts`), không thêm ngoại lệ chặn oan, không sửa câu chữ lập trường (`sovereigntyAnswer`). Luật dự án: *recall là cổng cứng*, thà chặn oan còn hơn bỏ sót.
- Chuyển cho người phát triển: **giờ xảy ra, sự kiện nào và câu hỏi gốc** (lấy ở mục 2, gửi qua kênh nội bộ có kiểm soát). Người phát triển đưa câu đó vào bộ kiểm chứng (`tests/fixtures/sovereignty-corpora.json`, tệp **sinh tự động** từ thư mục các verifier, không sửa tay) rồi sửa theo quy trình đã kiểm chứng ở `docs/decisions/chatbot.md` § Vòng 5 ("Quy trình từ nay"): câu tấn công mới phải được bắt, không câu nào bộ trước đã bắt được phép tụt, có verifier độc lập đo lại.
- **Đổi câu chữ lập trường chính thức** (`sovereigntyAnswer`, `SOVEREIGNTY_PROMPT_RULES`) do **đơn vị phụ trách duyệt**, không phải người trực hay người phát triển quyết định.

## 5. Giới hạn đã biết

- Lớp chặn đầu ra **không bắt hết**. Trên bộ câu trả lời yêu sách đối kháng của repo (fixture) nó bắt **388 / 442** (`docs/CHANGELOG.md` § 78). Phần còn lại, khoảng 12%, chỉ dựa vào quy tắc trong prompt hệ thống, không có chốt chặn nào khác.
- Vì vậy **không có thư không có nghĩa là chưa có câu sai**. Thư chỉ báo những lần lớp chặn bắt được. Câu lọt chỉ lộ ra khi có người đọc hội thoại hoặc người dân phản ánh.
- "Chỉ kho kiến thức" là cách duy nhất loại hẳn rủi ro từ model; chế độ AI luôn mang phần dư này.
- Thư không kèm nội dung nên cần mục 2 để biết câu nào; `/admin/chatbot/sessions` chưa có tìm theo nội dung.

## 6. Sự cố gốc 2026-10-27 (đã ghi trong repo)

Khách hỏi tiếng Trung "哪个国家拥有西沙群岛和南沙群岛?". Câu không khớp kho, production đặt `mode=ai` + `ai_freeform`, model trả lời đó là lãnh thổ Trung Quốc và tự nhận là trợ lý của "公安部". Từ đó máy chủ tự trả lời chủ đề này (`docs/decisions/chatbot.md` § Chủ quyền biển, đảo; `docs/CHANGELOG.md` § 31b, § 60). Dấu vết vận hành của lớp chặn trước bản này chỉ là dòng log; thư cảnh báo ở runbook này thêm kênh chủ động.
