import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * Đường dẫn mà `uploadLocalFile` sẽ ghi cho `filename` tại thời điểm `now`
 * (`public/uploads/YYYY/MM/<filename>`). Tách ra để lượt đồng bộ R2→local kiểm được
 * "đường dẫn này đã thuộc hàng `media` KHÁC chưa" TRƯỚC khi ghi đè — hai hàng cùng
 * tên tệp trong cùng tháng dùng chung một tệp. Nơi gọi truyền CÙNG `now` cho cả hai
 * lời gọi để ranh giới tháng không tách đôi phép kiểm và lượt ghi.
 */
export function localUploadTargetFor(filename: string, now: Date = new Date()): { url: string; storagePath: string } {
  const { relativeDir, fullDir } = uploadDirFor(now)
  const storagePath = path.join(fullDir, filename)
  const url = `/${relativeDir}/${filename}`.replace(/\\/g, '/')
  return { url, storagePath }
}

function uploadDirFor(now: Date): { relativeDir: string; fullDir: string } {
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const relativeDir = path.join('uploads', year, month)
  return { relativeDir, fullDir: path.resolve(process.cwd(), 'public', relativeDir) }
}

export async function uploadLocalFile(fileBuffer: Buffer, filename: string, now: Date = new Date()): Promise<{ url: string; storagePath: string }> {
  await fs.mkdir(uploadDirFor(now).fullDir, { recursive: true })
  const target = localUploadTargetFor(filename, now)
  await fs.writeFile(target.storagePath, fileBuffer)
  return target
}

export async function deleteLocalFile(storagePath: string): Promise<boolean> {
  const uploadsRoot = path.resolve(process.cwd(), 'public/uploads/')
  const resolvedPath = path.resolve(storagePath)
  if (!resolvedPath.startsWith(uploadsRoot + path.sep) && resolvedPath !== uploadsRoot) {
    throw new Error(`Path traversal attempt blocked: ${storagePath}`)
  }
  try {
    await fs.unlink(resolvedPath)
    return true
  } catch {
    return false
  }
}
