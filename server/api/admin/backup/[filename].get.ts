import path from 'node:path'
import { promises as fs } from 'node:fs'
import { requireResourcePermission } from '../../../utils/permissions'

const BACKUPS_DIR = path.resolve(process.cwd(), 'backups')

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  const filename = getRouterParam(event, 'filename')
  if (!filename) throw createError({ statusCode: 400, statusMessage: 'Thiếu tên file.' })

  const safe = path.basename(filename)
  const filePath = path.resolve(BACKUPS_DIR, safe)
  if (!filePath.startsWith(BACKUPS_DIR + path.sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Đường dẫn không hợp lệ.' })
  }
  try { await fs.stat(filePath) } catch {
    throw createError({ statusCode: 404, statusMessage: 'File backup không tồn tại.' })
  }

  // Phát file về browser — stream để không nạp vào RAM.
  const stream = await fs.readFile(filePath) // nhỏ thì buffer ok; file lớn cần sendStream
  setHeader(event, 'Content-Disposition', `attachment; filename="${safe}"`)
  setHeader(event, 'Content-Type', safe.endsWith('.sql.gz') ? 'application/gzip' : 'application/gzip')
  return stream
})
