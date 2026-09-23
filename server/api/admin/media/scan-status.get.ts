/**
 * GET /api/admin/media/scan-status — trạng thái job quét đang chạy.
 *
 * Quyền `media.read` — đọc status không phải create.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { getScanJobStatus } from '../../../services/media-scan'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'read')

  const status = getScanJobStatus()
  return { ok: true, status }
})
