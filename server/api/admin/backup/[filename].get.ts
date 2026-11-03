import path from 'node:path'
import { createReadStream, promises as fs, type Stats } from 'node:fs'
import { requireResourcePermission, requireSuperAdmin } from '../../../utils/permissions'
import { backupsDir } from '../../../services/backup'

/**
 * `Content-Disposition` cho tên tệp bất kỳ: `filename="…"` chỉ ASCII (trình duyệt
 * cũ), `filename*=UTF-8''…` theo RFC 5987 — mã hoá phần trăm mọi thứ ngoài
 * attr-char, kể cả `'()*` mà `encodeURIComponent` để nguyên.
 */
function attachmentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_')
  const encoded = encodeURIComponent(name).replace(/['()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')
  // Một bản dump chứa hash mật khẩu và đơn của công dân — chỉ SuperAdmin tải về.
  requireSuperAdmin(adminUser)

  const filename = getRouterParam(event, 'filename')
  if (!filename) throw createError({ statusCode: 400, statusMessage: 'Thiếu tên file.' })

  const dir = backupsDir()
  const safe = path.basename(filename)
  const filePath = path.resolve(dir, safe)
  if (!filePath.startsWith(dir + path.sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Đường dẫn không hợp lệ.' })
  }
  // `lstat`, không `stat`: chỉ phục vụ tệp thường NẰM TRONG thư mục backup — thư
  // mục (đọc ra lỗi EISDIR → 500) và symlink (trỏ ra ngoài thư mục) đều là 404.
  let stats: Stats
  try { stats = await fs.lstat(filePath) } catch {
    throw createError({ statusCode: 404, statusMessage: 'File backup không tồn tại.' })
  }
  if (!stats.isFile()) throw createError({ statusCode: 404, statusMessage: 'File backup không tồn tại.' })

  // Stream từ đĩa: đọc trọn tệp vào một Buffer nạp cả archive vào RAM và hỏng hẳn
  // với tệp > 2 GiB (tests/backup-access.test.ts chặn lối đọc trọn tệp ở thư mục này).
  setHeader(event, 'Content-Type', 'application/gzip')
  setHeader(event, 'Content-Length', stats.size)
  setHeader(event, 'Content-Disposition', attachmentDisposition(safe))
  const stream = createReadStream(filePath)
  // `sendStream` của h3 chỉ gọi `stream.abort` khi phản hồi đóng — ReadStream không
  // có hàm đó, nên client ngắt giữa chừng sẽ giữ file descriptor tới khi GC. Nghe
  // `close` của PHẢN HỒI (đóng khi gửi xong hoặc kết nối đứt), không phải của
  // request: từ Node 16 `req` phát `close` ngay khi đọc xong thân request.
  event.node.res.once('close', () => stream.destroy())
  return sendStream(event, stream)
})
