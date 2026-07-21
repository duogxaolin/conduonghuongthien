import { promises as fs } from 'node:fs'
import path from 'node:path'
import { checkPermission } from '../../../utils/auth'

const DATA_FILE = path.resolve(process.cwd(), 'server/data/submissions.json')

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'submissions', 'read', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  let submissions = []
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8')
    submissions = JSON.parse(raw || '[]')
  } catch {
    submissions = []
  }

  // Sort by submittedAt descending
  submissions.sort((a: any, b: any) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())

  return { ok: true, submissions }
})
