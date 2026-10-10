# Decisions — diễn giải vì-sao & tiền sử bug

Bộ tệp này giữ phần **diễn giải chi tiết** đã được rút khỏi `CLAUDE.md` để tệp đó nằm dưới trần 40k ký tự (cảnh báo `over the 40.0k-char limit`).
`CLAUDE.md` giữ **quy tắc hành động** (MAI PHẢI/ KHÔNG ĐƯỢC, cờ chặn, vị trí test, thứ tự triển khai);
tệp ở đây giữ **lý do và lịch sử** — vì sao từng quy tắc tồn tại, bug nào đã trả giá để biết, và kiểm chứng âm tính đã chạy ra sao.

Dành cho người mới tiếp nhận muốn hiểu **tại sao**, không phải để tra cứu khi sửa mã. Khi sửa mã, đọc `CLAUDE.md`. Lịch sử tính năng đã chuyển sang `docs/CHANGELOG.md`.

| Tệp | Phạm vi |
|-----|---------|
| `data-layer.md` | TDZ trong transaction, `db.insert()` trả mảng, `affectedRows`, `finitePositive`, `slugify` một bản, đường ghi audit & nguyên tử, `openNewTab` rơi khi đổi allowlist, `validateIdTokenClaims` |
| `reader-features.md` | Đăng nhập Google & bình luận công khai, trang `/profile`, thông báo trả lời, xoá bình luận cascade, chặn IP, hai rào vé người đọc, `last_seen_at` |
| `chatbot.md` | Hai kho (nghiệp vụ + thường nhật), matcher thường nhật, typewriter (sàn/trần, proxy Vue), vé phiên HMAC, phát hiện liên hệ, `qa-documents`, phiên trò chuyện |
| `realm-safety.md` | Favicon (byte-sai, `.ico` vũ trụ, hai allowlist), upload magic-byte, allowlist MIME hai đầu, drift `ensureColumn` nháy kép, `as unknown as` khẳng-dekhông-kiểm, `globalThis.useRuntimeConfig` |
| `media-storage.md` | R2 cho Media Portal video (đã triển khai, không phải kế hoạch), ba tầng lùi an toàn local, envelope secret `cdkt-video-r2-secret:v1`, procedure backup/restore đóng AUD-16 |
| `refactor-large-files.md` | 6 file admin 873-1108dòng, ràng buộc test guard chặn (admin-bulk-selection ghim selection ở template gốc, analytics-live-dashboard Function()-trích), 4 file tách xanh + 2 file không tách được, điều kiện tiên quyết làm lại |

Quy ước: mỗi mục ghi **điều kiện tiên quyết** (những tiền đề phải còn đúng mới giữ nguyên quy tắc), **kiểm chứng âm tính** đã chạy, và **triệu chứng production** đọc ra thế nào — để người đọc thấy bug đó không phải tưởng tượng.
