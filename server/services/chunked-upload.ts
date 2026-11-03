/**
 * Tải lên theo từng phần, có thể tiếp tục sau khi đứt kết nối — BARREL.
 *
 * Đường dẫn công khai của dịch vụ: năm endpoint `server/api/admin/media-portal/
 * upload/**` và các bộ test import từ đây (`video-disk-guard.ts` lấy `formatBytes`
 * thẳng từ `chunked-upload-core.ts` để không sinh vòng import). Mã nằm ở bốn tệp,
 * tách theo đường may của vòng đời một lượt tải:
 *
 *   • `chunked-upload-core.ts`       — kiểu, hằng số, hàm thuần, `NOT_FOUND` duy
 *     nhất, và truy cập dữ liệu dùng chung (`findOwned` mang quyền sở hữu trong
 *     câu truy vấn). Bốn quyết định của dịch vụ được giải thích ở đầu tệp đó.
 *   • `chunked-upload-session.ts`    — vòng đời phiên: mở, trạng thái, dọn bỏ dở.
 *   • `chunked-upload-receipt.ts`    — nhận một phần và hợp vào `received_parts`.
 *   • `chunked-upload-completion.ts` — hoàn tất có rào giữ chỗ, ghép, tạo/thay mục.
 *
 * Chỉ xuất lại đúng API công khai bằng danh sách tên tường minh (không
 * `export *`, để helper nội bộ của nhóm không thành API). Tệp anh em không bao
 * giờ import từ barrel này.
 */
export {
  accumulatedBytes,
  COMPLETION_LEASE_MS,
  declaredChunks,
  formatBytes,
  isUploadComplete,
  isValidChunkIndex,
  isValidUploadId,
  mediaPool,
  missingIndexes,
  partLengthRange,
  resolvePartPath,
  resolveUploadDir,
  safeDisplayFilename,
  titleFromFilename,
  UPLOAD_STATUSES,
  withReceivedPart,
} from './chunked-upload-core'
export type { UploadDeps, UploadFailure, UploadSessionView, UploadStatus } from './chunked-upload-core'

export { housekeepUploads, initUpload, uploadStatus } from './chunked-upload-session'
export type { HousekeepResult, InitUploadInput, InitUploadResult, UploadStatusResult } from './chunked-upload-session'

export { chunkBodyLimit, receiveChunk } from './chunked-upload-receipt'
export type { ReceiveChunkInput, ReceiveChunkResult } from './chunked-upload-receipt'

export { completeUpload } from './chunked-upload-completion'
export type { CompleteUploadInput, CompleteUploadResult } from './chunked-upload-completion'
