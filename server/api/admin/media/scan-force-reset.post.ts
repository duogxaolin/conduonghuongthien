/**
 * POST /api/admin/media/scan-force-reset — buộc gỡ kẹt job quét đang treo.
 * Quyền `media.create` (cùng scan).
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { forceResetScanJob, getScanJobStatus } from '../../../services/media-scan'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'create')

  const status = getScanJobStatus()
  if (!status?.running) {
    throw createError({ statusCode: 409, statusMessage: 'Không có job quét nào đang chạy để gỡ kẹt.' })
  }

  const res = forceResetScanJob()
  if (!res.ok) throw createError({ statusCode: 409, statusMessage: res.message })
  return { ok: true, message: res.message }
})
