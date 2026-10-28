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

/** `inner` là `root` hay nằm dưới nó (so theo ranh giới thư mục, không theo tiền tố chuỗi). */
const isWithin = (inner: string, root: string) => inner === root || inner.startsWith(root + path.sep)

/**
 * Xoá tệp theo `storage_path` của một hàng `media` — giá trị không tin được, nên không gì
 * ngoài `public/uploads/` bị xoá. Hai lớp:
 *  1. Phép kiểm theo CHỮ (`..`, đường dẫn tuyệt đối khác, thư mục anh em `uploads-old`).
 *  2. Thư mục chứa tệp phải nằm THẬT dưới thư mục uploads THẬT (`realpath` cả hai): lớp 1 chỉ
 *     đọc cách viết, nên một symlink THƯ MỤC bên trong uploads (`2026` → một thư mục khác — bản
 *     lưu trữ khôi phục có thể mang theo) từng cho `unlink` đi theo nó ra ngoài và xoá tệp ở
 *     đó. Thành phần cuối KHÔNG bị giải: một tệp là symlink bị xoá như một liên kết, đích còn.
 *     `public/uploads` tự nó là symlink (volume gắn vào) vẫn dùng được — so trên đường thật.
 * Thư mục không giải được (không tồn tại, không đọc được) → `false`, như tệp không xoá được.
 */
export async function deleteLocalFile(storagePath: string): Promise<boolean> {
  const uploadsRoot = path.resolve(process.cwd(), 'public/uploads/')
  const resolvedPath = path.resolve(storagePath)
  if (!isWithin(resolvedPath, uploadsRoot)) {
    throw new Error(`Path traversal attempt blocked: ${storagePath}`)
  }
  let realRoot: string
  let realParent: string
  try {
    realRoot = await fs.realpath(uploadsRoot)
    realParent = await fs.realpath(path.dirname(resolvedPath))
  } catch {
    return false
  }
  if (!isWithin(realParent, realRoot)) {
    throw new Error(`Path traversal attempt blocked: ${storagePath}`)
  }
  try {
    await fs.unlink(path.join(realParent, path.basename(resolvedPath)))
    return true
  } catch {
    return false
  }
}
