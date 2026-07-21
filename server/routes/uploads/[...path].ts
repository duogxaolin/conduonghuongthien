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

  // MIME type by extension
  const ext = path.extname(filePath).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif',  '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.avif': 'image/avif', '.pdf': 'application/pdf',
  }
  const contentType = mimeMap[ext] || 'application/octet-stream'

  setResponseHeaders(event, {
    'Content-Type': contentType,
    'Content-Length': String(stat.size),
    'Cache-Control': 'public, max-age=31536000, immutable',
  })

  return sendStream(event, createReadStream(filePath))
})
