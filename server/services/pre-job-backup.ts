/**
 * Job media ghi dữ liệu hàng loạt và lượt khôi phục không bao giờ chạy cùng lúc — tự vá ảnh
 * (`media-self-heal.ts`), đổi domain R2 (`media-repoint.ts`), sửa URL (`media-repair.ts`),
 * đồng bộ local↔R2 (`media-sync.ts`), sửa thumbnail (`articles-thumbnail-scan.ts`), quét
 * thư mục ảnh (`media-scan.ts`).
 *
 * Kiểm từ CẢ HAI phía, mỗi phía giữ khoá của mình TRƯỚC rồi mới hỏi khoá của phía kia
 * (`IS_USED_LOCK`) — hai lượt bắt đầu cùng lúc thì ít nhất một lượt thấy lượt kia:
 *  - job: giữ khoá job (`MEDIA_JOB_LOCK`) → hỏi khoá khôi phục (bản sao lưu trước job, hoặc
 *    `refuseIfRestoreInProgress` với lượt quét không sao lưu) → đang khôi phục thì DỪNG
 *    trước lượt ghi đầu tiên (`abortJobIfRestoreInProgress`);
 *  - khôi phục (`backup-restore.ts`): giữ khoá khôi phục → hỏi mọi khoá trong
 *    `MEDIA_JOB_LOCK_NAMES` → có job đang chạy thì từ chối 409, nhả khoá, chưa làm gì.
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
 * Một lượt khôi phục BẮT ĐẦU sau phép kiểm của job (job đang ghi) bị chặn ở phía khôi phục:
 * job còn giữ khoá của nó suốt lượt chạy. Danh sách khoá ở đây là nguồn DUY NHẤT — job lấy
 * tên khoá từ nó, lượt khôi phục đọc nó (`tests/media-job-locks.test.ts` suy từ mã nguồn
 * mọi khoá các job thật sự giữ và đòi khớp đúng danh sách). Báo cáo trùng lặp
 * (`media-duplicates.ts`) chỉ đọc nên không nằm trong danh sách.
 */
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { BackupRestoreError } from './backup-restore-guards'
import { logWarn } from '../utils/logger'
import { BackupRestoreInProgressError, BackupRestoreStateUnknownError } from './backup'

export type PreBackupJob = 'self-heal' | 'repoint' | 'repair-urls' | 'sync' | 'fix-thumbnails' | 'scan'

/**
 * Job bị dừng vì đang khôi phục (CSDL hoặc archive uploads/media — cùng một khoá), chưa ghi
 * gì — endpoint trả 409 với câu này. `stateUnknown`: không hỏi được trạng thái khôi phục —
 * vẫn dừng, nhưng câu không khẳng định đang có lượt khôi phục.
 */
export class JobBlockedByRestoreError extends Error {
  readonly statusCode = 409
  readonly job: PreBackupJob
  constructor(job: PreBackupJob, action: string, stateUnknown = false) {
    super(stateUnknown
      ? `Không kiểm tra được trạng thái khôi phục — chưa ${action}, chưa ghi gì. Thử lại sau.`
      : `Đang khôi phục từ bản sao lưu — chưa ${action}, chưa ghi gì. Thử lại sau khi khôi phục xong.`)
    this.name = 'JobBlockedByRestoreError'
    this.job = job
  }
}

// ── Khoá của các job: MỘT danh sách cho job lẫn lượt khôi phục ──────────────────
/**
 * Khoá tên MySQL của từng job media ghi dữ liệu — nơi DUY NHẤT viết các tên này. Đổi domain
 * R2 không có khoá riêng: nó giữ `sync` rồi `scan` (`media-repoint.ts`); "Sửa URL" giữ thêm
 * `sync` ở bước vá lượt đồng bộ dở dang.
 */
export const MEDIA_JOB_LOCK = {
  sync: 'cdkt:media:sync-storage',
  scan: 'cdkt:media:scan',
  selfHeal: 'cdkt:media:self-heal',
  repairUrls: 'cdkt:media:repair-urls',
  fixThumbnails: 'cdkt:articles:scan-thumbnails',
} as const

/** Mọi khoá job media — lượt khôi phục từ chối khi bất kỳ khoá nào đang bị giữ. */
export const MEDIA_JOB_LOCK_NAMES: readonly string[] = Object.values(MEDIA_JOB_LOCK)

/** Tên việc đang giữ một khoá — cho câu từ chối của lượt khôi phục. */
export const MEDIA_JOB_LABELS: Readonly<Record<string, string>> = {
  [MEDIA_JOB_LOCK.sync]: 'đồng bộ ảnh local ↔ R2 / đổi domain R2',
  [MEDIA_JOB_LOCK.scan]: 'quét thư mục ảnh / đổi domain R2',
  [MEDIA_JOB_LOCK.selfHeal]: 'tự vá ảnh',
  [MEDIA_JOB_LOCK.repairUrls]: 'sửa URL ảnh',
  [MEDIA_JOB_LOCK.fixThumbnails]: 'quét / sửa ảnh đại diện bài viết',
} as const satisfies Record<string, string>

/**
 * Phía khôi phục (`backup-restore.ts`, gọi SAU khi đã giữ khoá khôi phục): lỗi từ chối nếu
 * một job media đang giữ khoá trong `MEDIA_JOB_LOCK_NAMES` (409 `media_job_running`, nêu tên
 * việc), hoặc `null`. Không hỏi được → 503 `media_job_state_unknown`: không chắc không có
 * job nào đang ghi thì không khôi phục. Mỗi khoá một bí danh cột riêng (`media_job_<i>`).
 */
export async function mediaJobsBlockingRestore(pool: Pick<Pool, 'query'>): Promise<BackupRestoreError | null> {
  let held: string[]
  try {
    const columns = MEDIA_JOB_LOCK_NAMES.map((_, index) => `IS_USED_LOCK(?) AS media_job_${index}`).join(', ')
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${columns}`, [...MEDIA_JOB_LOCK_NAMES])
    const row: Record<string, unknown> = rows[0] ?? {}
    held = MEDIA_JOB_LOCK_NAMES.filter((_, index) => row[`media_job_${index}`] !== null && row[`media_job_${index}`] !== undefined)
  } catch (err: unknown) {
    logWarn({ event: 'backup.restore_media_jobs_unknown', error: err instanceof Error ? err.message : String(err) })
    return new BackupRestoreError('Không kiểm tra được job xử lý ảnh nào đang chạy — chưa khôi phục gì. Thử lại sau.', 503, 'media_job_state_unknown')
  }
  if (held.length === 0) return null
  const jobs = held.map(name => MEDIA_JOB_LABELS[name] ?? name).join('; ')
  return new BackupRestoreError(`Đang có job xử lý ảnh chạy (${jobs}) — chưa khôi phục gì. Chờ job đó xong rồi khôi phục lại.`, 409, 'media_job_running')
}

// ── Dừng job khi đang khôi phục ────────────────────────────────────────────────
/**
 * Gọi ĐẦU TIÊN trong nhánh `catch` của bản sao lưu trước job (job không sao lưu trước —
 * lượt quét — gọi trong `catch` của `refuseIfRestoreInProgress`). Lỗi là "đang khôi phục" →
 * log `media.job_aborted_restore_in_progress` và ném `JobBlockedByRestoreError`; lỗi
 * khác → trả về, nơi gọi giữ cách xử lý cũ của nó. `action` là việc job định làm, dạng
 * "tự vá ảnh" — ghép vào câu "chưa <action>".
 */
export function abortJobIfRestoreInProgress(err: unknown, job: PreBackupJob, action: string): void {
  if (!(err instanceof BackupRestoreInProgressError)) return
  const stateUnknown = err instanceof BackupRestoreStateUnknownError
  logWarn({ event: 'media.job_aborted_restore_in_progress', job, stateUnknown })
  throw new JobBlockedByRestoreError(job, action, stateUnknown)
}
