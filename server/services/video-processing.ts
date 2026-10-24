/**
 * Cửa vào của đường ống chuyển mã video — chỉ re-export, không có mã.
 *
 * Tệp gốc 1168 dòng được tách theo đường nối (wave2 5.4, design D-SPLIT); mọi
 * nơi gọi vẫn import từ đây, cùng tên, cùng kiểu:
 *
 *   • `video-transcode-pipeline.ts` — `processMediaItem`: bảy giai đoạn, tiến độ,
 *     công bố lũy tiến, đồng bộ R2. Phần đầu tệp đó giải thích các quyết định.
 *   • `video-process-runner.ts` — chạy tiến trình, dựng lệnh FFmpeg/ffprobe,
 *     từ vựng lỗi chung.
 *   • `video-thumbnail-frame.ts` — trích ảnh đại diện (giai đoạn 5 + lúc phục vụ).
 *   • `video-renditions.ts` — chọn bản, playlist, công bố vào cây thế hệ, phát được.
 *   • `video-disk-guard.ts` — phép kiểm dung lượng đĩa.
 *   • `video-processing-job.ts` — hợp đồng, danh tính + sổ lượt đang chạy, thử lại.
 *
 * Các tệp trên không bao giờ import trực tiếp tệp này. Vòng gián tiếp duy nhất
 * có từ trước khi tách và giữ nguyên: `video-disk-guard.ts` → `chunked-upload.ts`
 * → tệp này (xem ghi chú đầu `video-disk-guard.ts`).
 */
export { TRANSCODE_LOCK_NAME, processMediaItem } from './video-transcode-pipeline'
export { defaultProcessRunner, parseProbeJson } from './video-process-runner'
export { extractThumbnailOnDemand } from './video-thumbnail-frame'
export {
  MAX_CONCURRENT_RENDITIONS, PROCESSING_STATUSES, RENDITIONS,
  buildMasterPlaylist, isPlayable, scaledWidth, selectRenditions, writeManifestAtomically,
} from './video-renditions'
export { DISK_CHECK_INTERVAL_MS, checkDiskSpace, startDiskGuard } from './video-disk-guard'
export {
  PROCESSING_ERROR_LIMIT, abortProcessingClaim, isProcessAlive, mediaAssetRoot,
  processingClaim, retryAt, stopMediaProcessingJobs,
} from './video-processing-job'

export type { ProcessFailureCode, ProcessOutcome, ProcessProgressCb, ProcessRunner } from './video-process-runner'
export type { MasterVariant, ProcessingStatus, Rendition } from './video-renditions'
export type { DiskCheck, DiskGuardOptions, StatfsFn } from './video-disk-guard'
export type { ProcessInput, ProcessingDeps, ProcessResult } from './video-processing-job'
