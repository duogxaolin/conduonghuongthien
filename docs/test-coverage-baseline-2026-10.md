# Độ phủ test — mức nền 2026-10-13

Đo bằng `npm run test:coverage` (`node --experimental-test-coverage`, bộ unit, **không** gồm các suite `*-integration` cần MySQL). CI ghi bản tóm tắt này vào trang kết quả của job `unit-tests` ở mỗi lần chạy, **chỉ báo cáo, không chặn** — chưa đặt ngưỡng vì một con số chọn trước khi ai đó thấy mức nền chỉ là cách mới để CI đỏ.

| | Dòng | Nhánh | Hàm |
|---|---|---|---|
| Toàn bộ (bộ unit) | **74,80%** | 80,03% | 71,40% |

## 15 file ít được phủ nhất (bộ unit)

Đây là *danh sách việc*, không phải lời chê: nhiều file chủ yếu được kiểm bởi suite integration (cần MySQL) hoặc test đọc mã nguồn, nên con số unit thấp không có nghĩa là không được kiểm. File `server/db/schema-tables/*` (DDL) bị loại khỏi danh sách vì chỉ chạy trong bộ integration.

| file | dòng % | nhánh % | hàm % |
|---|---|---|---|
| `server/services/article-translations.ts` | 18.40 | 82.35 | 5.88 |
| `server/services/livestream-hls.ts` | 20.33 | 100.00 | 0.00 |
| `app/composables/useChatbot.ts` | 21.49 | 100.00 | 0.00 |
| `server/utils/html-chunker.ts` | 21.74 | 100.00 | 0.00 |
| `server/services/moderation-worker.ts` | 27.20 | 40.00 | 25.00 |
| `server/utils/media-r2.ts` | 28.57 | 100.00 | 0.00 |
| `server/services/notification-email.ts` | 30.58 | 100.00 | 0.00 |
| `server/services/video-r2-sync.ts` | 34.68 | 100.00 | 0.00 |
| `server/services/ai-gateway.ts` | 34.81 | 61.43 | 39.13 |
| `server/services/readers.ts` | 36.18 | 100.00 | 0.00 |
| `server/services/ip-bans.ts` | 36.44 | 100.00 | 0.00 |
| `server/db/migrations-additive.ts` | 37.79 | 100.00 | 0.00 |
| `server/utils/slug.ts` | 40.63 | 100.00 | 20.00 |
| `server/utils/mailer.ts` | 42.34 | 100.00 | 0.00 |
| `server/services/comments.ts` | 45.90 | 97.96 | 33.33 |

## Cách dùng
- Cục bộ: `npm run test:coverage` (bảng ở cuối log).
- CI: mở một lần chạy → *Summary* → mục **Test coverage**.
- Khi viết test hành vi mới cho một file trong danh sách trên, chạy lại và cập nhật bảng này nếu muốn ghi mốc mới.
- Đặt ngưỡng (nếu sau này cần): theo thư mục (`server/utils`, `server/services`) và chỉ sau vài tuần nhìn thấy mức dao động thật.
