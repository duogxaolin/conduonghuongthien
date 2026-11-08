/**
 * "Dọn ngay" of the chunked uploads (`POST /api/admin/media-portal/upload/housekeep`) — the pool,
 * the media configuration and the named lock around `housekeepUploads`, moved out of the handler
 * verbatim and in the same order: no pool → nothing is read; otherwise the configuration, then the
 * lock, then the sweep on it. The handler keeps the permission check, the `confirm: true` gate,
 * the 503 (no pool) and the 409 (lock busy). Pinned in
 * tests/admin-media-portal-upload-handlers-behavior.test.ts.
 *
 * Khoá MySQL `cdkt:media:housekeep` (timeout 0 — không xếp hàng) để nút + bộ đếm lịch + cron
 * không xoá trùng cùng một lúc. Như trước khi dời: khoá này KHÔNG nằm trong `MEDIA_JOB_LOCK_NAMES`
 * (pre-job-backup.ts) và lượt dọn không hỏi lượt khôi phục — dời nguyên, không phải một khẳng định
 * an toàn (lượt dọn xoá hàng `media_upload_sessions` + ghi audit, lượt khôi phục dựng lại mọi bảng).
 *
 * Its own file because it imports `getPool`: a test that fakes the database layer with `getDb`
 * alone must still load the other admin media services.
 */
import { getPool } from '../utils/db'
import { withNamedLock } from '../utils/named-lock'
import { housekeepUploads } from './chunked-upload'
import { resolveAdminMediaConfig } from './admin-media-config'

const LOCK_NAME = 'cdkt:media:housekeep'
const LOCK_TIMEOUT_SECONDS = 0

/**
 * `null` when there is no pool (the database is not up) — nothing read, nothing swept. Otherwise
 * the lock outcome: `{ acquired: false }` when another sweep holds it, `{ acquired: true, value }`
 * with the sweep's counts.
 */
export async function housekeepUploadsUnderLock(adminUserId: number) {
  const pool = getPool()
  if (!pool) return null

  const { config } = await resolveAdminMediaConfig()

  // `withNamedLock` trả `{ acquired: false }` khi khoá đang bị giữ (timeout 0 =
  // không xếp hàng) thay vì throw.
  const outcome = await withNamedLock(pool, LOCK_NAME, LOCK_TIMEOUT_SECONDS, async () => {
    return await housekeepUploads({ config, adminUserId })
  })

  return outcome
}
