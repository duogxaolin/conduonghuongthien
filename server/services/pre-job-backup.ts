/**
 * Bản sao lưu trước một job sửa dữ liệu hàng loạt — tự vá ảnh (`media-self-heal.ts`),
 * đổi domain R2 (`media-repoint.ts`), sửa URL (`media-repair.ts`), đồng bộ local↔R2
 * (`media-sync.ts`), sửa thumbnail (`articles-thumbnail-scan.ts`): lượt khôi phục CSDL
 * đang chạy thì job DỪNG trước lượt ghi đầu tiên.
 *
 * Mỗi job tự `runBackup('…', 'pre-…')` trước khi ghi. Bản sao lưu hỏng vì lý do khác
 * thì job giữ cách cũ (đổi domain dừng — D-REPOINT; bốn job còn lại chạy tiếp, bản chụp
 * là phần thêm). Riêng `BackupRestoreInProgressError` (đúng lớp đó — không phải lớp cha
 * `BackupLockBusyError` "một lượt sao lưu khác đang chạy") nghĩa là một lượt khôi phục
 * đang THAY cả CSDL: ghi lúc đó vừa không có bản chụp, vừa chen vào giữa lượt khôi phục —
 * hàng ghi vào bảng sắp bị `DROP`/`CREATE` lại thì mất, ghi sau khi bảng đã thay thì để
 * lại dữ liệu nửa cũ nửa mới. `runBackup` ném đúng lỗi này cả khi khoá chạy đang bận mà
 * khoá khôi phục bị giữ (bản `pre-restore` của lượt khôi phục giữ khoá chạy suốt bản dump
 * an toàn), và khi không hỏi được MySQL về khoá khôi phục (không biết = coi như đang khôi
 * phục) — job cũng dừng, cùng hướng an toàn.
 *
 * Phép kiểm này đúng tại lúc sao lưu: một lượt khôi phục BẮT ĐẦU sau khi bản sao lưu của
 * job đã xong thì không bị chặn ở đây.
 */
import { logWarn } from '../utils/logger'
import { BackupRestoreInProgressError } from './backup'

export type PreBackupJob = 'self-heal' | 'repoint' | 'repair-urls' | 'sync' | 'fix-thumbnails'

/** Job bị dừng vì đang khôi phục CSDL, chưa ghi gì — endpoint trả 409 với câu này. */
export class JobBlockedByRestoreError extends Error {
  readonly statusCode = 409
  readonly job: PreBackupJob
  constructor(job: PreBackupJob, action: string) {
    super(`Đang khôi phục cơ sở dữ liệu — chưa ${action}, chưa ghi gì. Thử lại sau khi khôi phục xong.`)
    this.name = 'JobBlockedByRestoreError'
    this.job = job
  }
}

/**
 * Gọi ĐẦU TIÊN trong nhánh `catch` của bản sao lưu trước job. Lỗi là "đang khôi phục" →
 * log `media.job_aborted_restore_in_progress` và ném `JobBlockedByRestoreError`; lỗi
 * khác → trả về, nơi gọi giữ cách xử lý cũ của nó. `action` là việc job định làm, dạng
 * "tự vá ảnh" — ghép vào câu "chưa <action>".
 */
export function abortJobIfRestoreInProgress(err: unknown, job: PreBackupJob, action: string): void {
  if (!(err instanceof BackupRestoreInProgressError)) return
  logWarn({ event: 'media.job_aborted_restore_in_progress', job })
  throw new JobBlockedByRestoreError(job, action)
}
