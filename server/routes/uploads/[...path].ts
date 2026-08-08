import { createReadStream, statSync } from 'node:fs'
import path from 'node:path'
import { lookup } from 'node:dns' // just import for tree-shaking

// Serve /uploads/** from <cwd>/public/uploads/ at runtime
// Needed because Nitro production only serves .output/public/ as static,
// not the source public/ folder — runtime uploads must be served via this route.
export default defineEventHandler(async (event) => {
  const params = event.context.params?.path
  if (!params) throw createError({ statusCode: 404 })

  // Security: block path traversal
  const safePath = params.replace(/\.\./g, '').replace(/\/+/g, '/')
  const filePath = path.resolve(process.cwd(), 'public', 'uploads', safePath)
  const uploadsRoot = path.resolve(process.cwd(), 'public', 'uploads')

  if (!filePath.startsWith(uploadsRoot + path.sep) && filePath !== uploadsRoot) {
    throw createError({ statusCode: 403 })
  }

  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(filePath)
  } catch {
    throw createError({ statusCode: 404 })
  }

  if (!stat.isFile()) throw createError({ statusCode: 404 })

  // MIME type by extension. NOTE: `.svg` is deliberately ABSENT — an SVG served
  // as image/svg+xml is an executable document (it may contain <script>) running
  // on our own origin. Legacy .svg files therefore fall through to
  // application/octet-stream + Content-Disposition: attachment (download, never render).
  //
  // `.ico` CÓ trong danh sách, và nó phải có: đường tải lên
  // (`server/api/admin/media/upload.post.ts`) nhận `.ico` bằng magic-byte để cán
  // bộ đặt favicon riêng. Thiếu mục này thì tệp rơi xuống
  // `application/octet-stream`, và hai header ngay dưới — `nosniff` cùng
  // `Content-Disposition: attachment` — tồn tại để trình duyệt **từ chối vẽ** nó.
  // Kết quả là một favicon tải lên thành công, phục vụ với mã `200`, mà tab vẫn
  // trống: cùng một kiểu hỏng như tệp `favicon.ico` HTML mà việc này ra đời để
  // dứt điểm. Nhận một định dạng ở cổng vào mà không nhận ở cổng ra là không nhận.
  //
  // ICO an toàn theo đúng cái tiêu chí loại `.svg` ra: nó là **thùng chứa ảnh
  // raster**, không phải một tài liệu chạy được. Không có `<script>` nào trong
  // một ICO, và `nosniff` vẫn giữ nguyên cho mọi thứ khác.
  const ext = path.extname(filePath).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif',  '.webp': 'image/webp',
    '.avif': 'image/avif', '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
  }
  const contentType = mimeMap[ext] || 'application/octet-stream'

  setResponseHeaders(event, {
    'Content-Type': contentType,
    'Content-Length': String(stat.size),
    'Cache-Control': 'public, max-age=31536000, immutable',
    // Prevent the browser from re-interpreting the bytes as HTML/SVG.
    'X-Content-Type-Options': 'nosniff',
    // Anything outside the known-safe list downloads instead of rendering.
    ...(contentType === 'application/octet-stream' ? { 'Content-Disposition': 'attachment' } : {}),
  })

  return sendStream(event, createReadStream(filePath))
})
