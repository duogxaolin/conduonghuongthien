/**
 * Phép kiểm dung lượng đĩa của đường ống chuyển mã: một lần trước khi bắt đầu,
 * và chạy nền suốt lượt chuyển mã.
 *
 * Tách từ `video-processing.ts` (wave2 5.4). Vòng import có từ trước và giữ
 * nguyên: tệp này import `formatBytes` từ `chunked-upload.ts`, và
 * `chunked-upload.ts` import `video-processing.ts`. Vô hại vì `formatBytes` chỉ
 * được gọi trong thân hàm, không bao giờ ở cấp module.
 */
import fs from 'node:fs/promises'
// Dùng lại bản của đường tải lên thay vì viết bản thứ hai: hai bản định dạng
// dung lượng chỉ được đối chiếu khi một trong hai đọc sai, và lúc đó cán bộ đã
// đọc hai con số khác nhau cho cùng một tệp.
import { formatBytes } from './chunked-upload'

/** Chu kỳ kiểm dung lượng đĩa. Một phút là đủ dày so với một lượt chuyển mã. */
export const DISK_CHECK_INTERVAL_MS = 60 * 1000

export type StatfsFn = (target: string) => Promise<{ bavail: number, bsize: number }>

export type DiskCheck =
  | { ok: true, freeBytes: number }
  | { ok: false, kind: 'low' | 'error', reason: string }

/**
 * Kiểm dung lượng trống. **Không bao giờ ném** — lỗi đọc được trả về như một
 * lý do dừng.
 *
 * `statfs` chứ không `statvfs`: `statvfs` không tồn tại trong `fs` của Node.
 *
 * Nhánh lỗi **dừng công việc** chứ không đi tiếp: một phép kiểm đĩa hỏng mà vẫn
 * cho chạy tiếp là đúng trạng thái mà phép kiểm này sinh ra để tránh, chỉ khác
 * là lần này không có gì canh. `floorBytes <= 0` là tắt hẳn phép kiểm (volume
 * trên hệ thống tệp lạ), và đó là lựa chọn của người vận hành, không phải lỗi.
 */
export async function checkDiskSpace(
  target: string,
  floorBytes: number,
  /**
   * Truyền vào để test thay thế. Mặc định `undefined` chứ không phải `fs.statfs`
   * trực tiếp: `--experimental-test-module-mocks` clone default params để mock
   * module, và `structuredClone(fs.statfs)` ném "could not be cloned" với function
   * native — làm 2 suite integration (media-queue, upload-concurrency) fail toàn
   * job thay vì chỉ fail bài test. Mọi caller thật đều truyền `options.statfs`,
   * nên nhánh fallback resolve lúc gọi, tránh giữ reference native trong signature.
   */
  statfs?: StatfsFn,
): Promise<DiskCheck> {
  if (!Number.isFinite(floorBytes) || floorBytes <= 0) return { ok: true, freeBytes: Number.POSITIVE_INFINITY }

  try {
    const stats = await (statfs ?? fs.statfs.bind(fs))(target)
    const freeBytes = Number(stats.bavail) * Number(stats.bsize)
    if (!Number.isFinite(freeBytes)) {
      return { ok: false, kind: 'error', reason: 'Không đọc được dung lượng trống của thư mục media.' }
    }
    if (freeBytes < floorBytes) {
      return {
        ok: false, kind: 'low',
        reason: `Hết chỗ trên thư mục media: còn ${formatBytes(freeBytes)}, cần tối thiểu ${formatBytes(floorBytes)}.`,
      }
    }
    return { ok: true, freeBytes }
  } catch (error) {
    return {
      ok: false, kind: 'error',
      reason: `Không kiểm được dung lượng đĩa: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export type DiskGuardOptions = {
  path: string
  floorBytes: number
  intervalMs: number
  statfs?: StatfsFn
  /** Gọi **một lần duy nhất**, ở lần kiểm đầu tiên thất bại. */
  onAbort: (failure: Extract<DiskCheck, { ok: false }>) => void
}

/**
 * Phép kiểm đĩa chạy nền trong lúc chuyển mã.
 *
 * Có `intervalMs` là tham số chứ không phải hằng số trong thân hàm: một chu kỳ
 * một phút là đúng cho production và không kiểm được trong một test. Cùng lối
 * với `now` / `limit` của `housekeepUploads`.
 */
export function startDiskGuard(options: DiskGuardOptions): { stop: () => void } {
  let stopped = false
  const timer = setInterval(() => {
    if (stopped) return
    void checkDiskSpace(options.path, options.floorBytes, options.statfs).then((check) => {
      if (stopped || check.ok) return
      // Dừng trước khi gọi `onAbort`: nhánh dừng có thể xoá thư mục nháp, và một
      // lượt kiểm đang bay không được phép gọi nó lần thứ hai.
      stopped = true
      options.onAbort(check)
    })
  }, Math.max(1, options.intervalMs))
  timer.unref?.()

  return {
    stop: () => {
      stopped = true
      clearInterval(timer)
    },
  }
}
