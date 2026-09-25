import { requireResourcePermission } from '../../../utils/permissions'
import { cancelUniversalAutoTranslate } from '../../../services/universal-translation'

export default defineEventHandler((event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  return cancelUniversalAutoTranslate()
})
