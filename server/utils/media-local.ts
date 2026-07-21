import { promises as fs } from 'node:fs'
import path from 'node:path'

export async function uploadLocalFile(fileBuffer: Buffer, filename: string): Promise<{ url: string; storagePath: string }> {
  const now = new Date()
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')

  const relativeDir = path.join('uploads', year, month)
  const fullDir = path.resolve(process.cwd(), 'public', relativeDir)

  await fs.mkdir(fullDir, { recursive: true })

  const fullPath = path.join(fullDir, filename)
  await fs.writeFile(fullPath, fileBuffer)

  const url = `/${relativeDir}/${filename}`.replace(/\\/g, '/')
  return { url, storagePath: fullPath }
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
