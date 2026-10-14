/**
 * Đọc ảnh bìa của một bài viết để chép vào thư mục xuất Google Drive — CHỈ khi
 * ảnh thuộc kho media của chính cổng này.
 *
 * `articles.thumbnail_url` là ô biên tập viên gõ tay được. Trước đây luồng xuất
 * `fetch()` thẳng URL đó từ máy chủ rồi tải bytes lên Drive và chia sẻ "bất kỳ ai
 * có link": một URL `http://169.254.169.254/…`, `http://cdkt_mysql:3306` hay một
 * trang quản trị nội bộ biến thành SSRF có kênh đọc ngược (bytes nằm trên Drive).
 *
 * Nay chỉ hai nguồn được chấp nhận:
 *   • `/uploads/…` — đọc thẳng từ đĩa dưới `<cwd>/public/uploads` (cùng gốc mà
 *     `uploadLocalFile` ghi và `server/routes/uploads/[...path].ts` phục vụ), chặn
 *     path traversal. Không đi qua mạng.
 *   • `https://<host của r2_public_url>/…` — host phải TRÙNG host R2 công khai đã
 *     cấu hình ở cài đặt media, và việc tải đi qua `safeProviderRequest` (IP công
 *     khai đã ghim, không chuyển hướng, hạn thời gian, trần byte) — xem `fetchR2`.
 * Mọi thứ khác → `null` (bỏ ảnh, việc xuất vẫn tiếp tục).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { safeProviderRequest, type ProviderRequest, type ResolveProviderHost } from '../utils/chatbot/outbound'

export interface OwnThumbnail {
  buffer: Buffer
  mimeType: string
  ext: string
}

/** Trần dung lượng một ảnh bìa được chép sang Drive. */
export const EXPORT_THUMBNAIL_MAX_BYTES = 10 * 1024 * 1024
const FETCH_TIMEOUT_MS = 10_000

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** Host của `r2_public_url` (cán bộ có thể dán thiếu `https://`), hoặc null. */
export function r2PublicHost(r2PublicUrl: string | null | undefined): string | null {
  const raw = (r2PublicUrl ?? '').trim()
  if (!raw) return null
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return parsed.host ? parsed.host.toLowerCase() : null
  } catch {
    return null
  }
}

export type ThumbnailSource =
  | { kind: 'local', filePath: string, ext: string }
  | { kind: 'r2', url: string }

/**
 * Phân loại một `thumbnail_url`: ảnh trên đĩa của cổng, ảnh trên R2 của cổng,
 * hoặc `null` (không phải media của mình — không được đụng tới).
 */
export function classifyThumbnailSource(
  thumbnailUrl: string | null | undefined,
  r2PublicUrl: string | null | undefined,
  cwd: string = process.cwd(),
): ThumbnailSource | null {
  const raw = (thumbnailUrl ?? '').trim()
  if (!raw) return null

  // Đường dẫn tương đối của chính site. `//host/...` là URL tuyệt đối (giao thức
  // tương đối), KHÔNG phải đường dẫn nội bộ.
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    const pathname = raw.split(/[?#]/, 1)[0]!
    if (!pathname.startsWith('/uploads/')) return null
    let decoded: string
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      return null
    }
    if (decoded.includes('\0')) return null
    const uploadsRoot = path.resolve(cwd, 'public', 'uploads')
    const filePath = path.resolve(cwd, 'public', `.${decoded}`)
    if (!filePath.startsWith(uploadsRoot + path.sep)) return null
    const ext = path.extname(filePath).slice(1).toLowerCase()
    if (!MIME_BY_EXT[ext]) return null
    return { kind: 'local', filePath, ext }
  }

  const host = r2PublicHost(r2PublicUrl)
  if (!host) return null
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.username || parsed.password) return null
  if (parsed.host.toLowerCase() !== host) return null
  return { kind: 'r2', url: parsed.href }
}

async function readLocal(source: { filePath: string, ext: string }): Promise<OwnThumbnail | null> {
  const stat = await fs.stat(source.filePath)
  if (!stat.isFile() || stat.size === 0 || stat.size > EXPORT_THUMBNAIL_MAX_BYTES) return null
  const buffer = await fs.readFile(source.filePath)
  const ext = source.ext === 'jpeg' ? 'jpg' : source.ext
  return { buffer, mimeType: MIME_BY_EXT[source.ext]!, ext }
}

/** Đường nối mạng thay được trong kiểm thử (cùng seam với `safeProviderRequest`). */
export interface ThumbnailFetchDeps {
  request?: ProviderRequest
  resolveHost?: ResolveProviderHost
}

/**
 * Tải ảnh từ host R2 công khai qua `safeProviderRequest` — cùng đường ra có kiểm
 * soát của lệnh gọi AI, thay cho `fetch` trần:
 *  - chỉ https, cổng 443, đúng MỘT host (host của `r2_public_url`), không IP trần
 *    hay tên nội bộ;
 *  - DNS phân giải TRƯỚC và mọi địa chỉ phải là IP công khai; IP đã kiểm được ghim
 *    vào chính kết nối (không có cửa sổ DNS-rebinding). Một bản ghi DNS của host
 *    "R2" trỏ về 10.x/169.254.x/::1 không còn biến luồng xuất thành SSRF;
 *  - không theo chuyển hướng, có hạn thời gian, và trần byte đếm TRONG LÚC đọc —
 *    thân không có `content-length` bị cắt ở trần chứ không đọc hết vào RAM.
 * Query string và fragment bị bỏ trước khi gửi (`safeProviderRequest` không nhận
 * query; bucket R2 công khai phục vụ object theo đường dẫn, không theo query).
 */
async function fetchR2(url: string, deps: ThumbnailFetchDeps): Promise<OwnThumbnail | null> {
  const target = new URL(url)
  target.search = ''
  target.hash = ''
  const res = await safeProviderRequest({
    url: target,
    allowedHosts: [target.hostname],
    method: 'GET',
    timeoutMs: FETCH_TIMEOUT_MS,
    maxResponseBytes: EXPORT_THUMBNAIL_MAX_BYTES,
    request: deps.request,
    resolveHost: deps.resolveHost,
  })
  if (res.status < 200 || res.status >= 300) return null
  const header = res.headers['content-type']
  const mimeType = (Array.isArray(header) ? header[0] ?? '' : header ?? '').split(';', 1)[0]!.trim().toLowerCase()
  const ext = EXT_BY_MIME[mimeType]
  if (!ext) return null
  if (res.body.length === 0 || res.body.length > EXPORT_THUMBNAIL_MAX_BYTES) return null
  return { buffer: Buffer.from(res.body), mimeType, ext }
}

/**
 * Bytes của ảnh bìa nếu nó là media của cổng; `null` nếu không phải, không đọc
 * được, quá lớn hoặc không phải ảnh. Không bao giờ ném lỗi — ảnh bìa là phần
 * phụ của bản xuất.
 */
export async function loadOwnThumbnail(
  thumbnailUrl: string | null | undefined,
  r2PublicUrl: string | null | undefined,
  deps: ThumbnailFetchDeps = {},
): Promise<OwnThumbnail | null> {
  const source = classifyThumbnailSource(thumbnailUrl, r2PublicUrl)
  if (!source) return null
  try {
    return source.kind === 'local' ? await readLocal(source) : await fetchR2(source.url, deps)
  } catch {
    return null
  }
}
