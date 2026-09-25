import { requireResourcePermission } from '../../../utils/permissions'
import { getUniversalTaskState } from '../../../services/universal-translation'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  return {
    ok: true,
    task: getUniversalTaskState(),
  }
})
