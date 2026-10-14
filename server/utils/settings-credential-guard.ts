/**
 * Quy tắc "đổi ĐÍCH thì phải nhập lại MẬT KHẨU" cho các bí mật lưu trong bảng
 * `settings` (SMTP, R2 ảnh, R2 video) — phía máy chủ.
 *
 * Logic nằm ở `shared/settings-credential-rules.ts` để trang quản trị chạy ĐÚNG
 * hàm này trước khi gửi (báo lỗi cạnh ô nhập). Máy chủ vẫn là nơi quyết định:
 *  - `credentialRetargetViolation` — `settings/index.put.ts` (SMTP + R2 ảnh);
 *  - `videoR2RetargetViolation` — `settings/media-portal.put.ts` (R2 video);
 *  - `isCloudflareAccountId` / `isR2BucketName` — cũng dùng ở
 *    `settings/test-r2.post.ts` trước khi dựng client R2.
 *
 * Endpoint gọi MỘT lần trên toàn bộ thân, trước vòng ghi — thứ tự khoá trong JSON
 * không được phép đổi kết quả. Xem chú thích đầu tệp `shared/` cho lý do và lỗ
 * hổng mà quy tắc này đóng.
 */
export {
  credentialRetargetViolation,
  isCloudflareAccountId,
  isR2BucketName,
  videoR2RetargetViolation,
  type StoredVideoR2,
} from '../../shared/settings-credential-rules'
