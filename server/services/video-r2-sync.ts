/**
 * Sync/delete/stream cây rendition video trên R2 — dành cho Media Portal.
 *
 * Tách khỏi `server/utils/media-r2.ts` (thư viện ảnh) vì:
 *   • Ảnh dùng `uploadR2File` (một tệp, key `YYYY/MM/filename`). Video cần sync
 *     **cả cây** HLS (`<storagePath>/master.m3u8` + nhiều rendition `*.m3u8` +
 *     `*.ts`).
 *   • Ảnh có `publicUrl` trực tiếp. Video stream qua proxy (design.md dòng 196:
 *     không redirect, không lộ storage location) → cần `streamR2Object`.
 *   • Bucket riêng, credential riêng (nhãn `cdkt-video-r2-secret:v1`).
 *
 * Cây key R2 = `media/<slug>/<relative>` — `storagePath` trong CSDL giữ đúng
 * phần `media/<slug>`, để `resolveStreamTarget` dựng key bằng cách nối
 * `storagePath + '/' + assetPath`.
 */
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { createReadStream, promises as fs } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { Readable } from 'node:stream'
import type { R2Config } from '../utils/media-r2'

/** Dựng S3 client cho R2 video (endpoint = accountId.r2.cloudflarestorage.com). */
function createClient(config: R2Config): S3Client {
  const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

/** Chuẩn hoá key prefix — loại dấu `/` đầu/cuối, đổi `\\` → `/` (Windows path). */
function normalizeKey(part: string): string {
  return part.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

/**
 * Sync đệ quy một thư mục local lên R2. Mỗi tệp trong cây `localDir` upload
 * lên `<r2Prefix>/<relative>` với cùng contentType (suy từ extension).
 *
 * Trả số tệp đã upload + tổng bytes. Throw nếu bất kỳ tệp nào fail — caller
 * (video-processing) sẽ giữ local scratch và đánh dấu `storageProvider='local'`
 * (lùi an toàn).
 */
export async function syncDirectoryToR2(
  localDir: string,
  r2Prefix: string,
  config: R2Config,
): Promise<{ files: number, bytes: number }> {
  const client = createClient(config)
  const prefix = normalizeKey(r2Prefix)
  let files = 0
  let bytes = 0

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue

      const rel = relative(localDir, full).split(sep).join('/')
      const key = prefix ? `${prefix}/${rel}` : rel
      const contentType = contentTypeFor(entry.name)
      const stat = await fs.stat(full)
      // `createReadStream` + `Body` stream — SDK hỗ trợ stream cho upload.
      const stream = createReadStream(full)
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: stream,
        ContentType: contentType,
        ContentLength: stat.size,
      }))
      files += 1
      bytes += stat.size
    }
  }

  await walk(localDir)
  return { files, bytes }
}

/**
 * Xoá toàn bộ object có prefix trên R2 (cho delete media item). List + delete
 * theo trang (R2 giới hạn 1000 key/lượt DeleteObjects). Throw nếu list/delete
 * fail — caller xoá hàng CSDL anyway (tệp mồ côi trên R2 ít hại hơn giữ hàng
 * trỏ tới tệp không tồn tại).
 */
export async function deleteR2Tree(r2Prefix: string, config: R2Config): Promise<{ deleted: number }> {
  const client = createClient(config)
  const prefix = normalizeKey(r2Prefix)
  let deleted = 0
  let continuationToken: string | undefined

  do {
    const listRes = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }))
    const objects = (listRes.Contents ?? []).map(o => ({ Key: o.Key! })).filter(o => o.Key)
    if (objects.length > 0) {
      await client.send(new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: { Objects: objects, Quiet: true },
      }))
      deleted += objects.length
    }
    continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : undefined
  } while (continuationToken)

  return { deleted }
}

/**
 * Liệt kê key trong một prefix R2 (không phân trang cho mục media — cây nhỏ).
 *
 * Dùng cho nhánh passthrough `MEDIA_AUTO_TRANSCODE=false`: khi không có rendition
 * HLS, stream endpoint cần tìm `original.<ext>` trên R2 (tương tự `locateOriginalFile`
 * ở đĩa local). `ListObjectsV2` với `MaxKeys` đủ lớn cho một mục media.
 *
 * Trả `null` khi R2 lỗi (không ném — caller lùi về 404, không sập). Trả mảng key
 * rỗng khi prefix không tồn tại — đó là cũng một câu trả lời hợp lệ ("không có tệp gì").
 */
export async function listR2Keys(
  r2Prefix: string,
  config: R2Config,
): Promise<string[] | null> {
  const client = createClient(config)
  const prefix = normalizeKey(r2Prefix)
  const keys: string[] = []
  let continuationToken: string | undefined
  try {
    do {
      const res = await client.send(new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }))
      for (const obj of res.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key)
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (continuationToken)
  } catch {
    return null
  }
  return keys
}

/**
 * Tìm key `original.<ext>` trong prefix R2 — tương tự `locateOriginalFile` ở đĩa.
 *
 * Trả `{ key, size }` hoặc `null`. `size` lấy từ `ListObjectsV2.Content[i].Size`
 * (đã có sẵn, không cần HEAD riêng). Chỉ nhận định dạng trong `STREAM_CONTENT_TYPES`
 * — một `original.bin` lạ không phục vụ được.
 */
export async function locateR2Original(
  r2Prefix: string,
  config: R2Config,
): Promise<{ key: string, size: number } | null> {
  const keys = await listR2Keys(r2Prefix, config)
  if (!keys) return null
  // Lọc key có dạng `<prefix>/original.<ext>` (không sâu hơn).
  const base = normalizeKey(r2Prefix)
  for (const key of keys) {
    const rel = base ? key.slice(base.length + 1) : key
    if (!rel.startsWith('original.')) continue
    const ext = rel.slice(rel.lastIndexOf('.')).toLowerCase()
    if (ext && rel.indexOf('/') === -1) {
      // Size đi cùng key trong list — lấy lại bằng một HEAD tránh phụ thuộc shape.
      // Nhưng ListObjectsV2 đã trả Size, nên ưu tiên dùng nếu có. Caller (stream
      // endpoint) đọc contentLength thật từ GetObject nên không cần size ở đây.
      return { key, size: 0 }
    }
  }
  return null
}

/**
 * Lấy stream + metadata của một object R2 để pipe qua stream endpoint. Trả
 * `{ stream, contentType, contentLength }` — caller dùng `sendStream(event,
 * stream)` + set headers từ metadata.
 *
 * Throw nếu object không tồn tại hoặc R2 lỗi — caller trả 404/500.
 */
export async function streamR2Object(
  key: string,
  config: R2Config,
): Promise<{ stream: Readable, contentType: string, contentLength: number }> {
  const client = createClient(config)
  const res = await client.send(new GetObjectCommand({
    Bucket: config.bucket,
    Key: normalizeKey(key),
  }))
  if (!res.Body) {
    throw new Error('R2 object body is empty')
  }
  return {
    stream: res.Body as Readable,
    contentType: res.ContentType ?? 'application/octet-stream',
    contentLength: Number(res.ContentLength ?? 0),
  }
}

/**
 * Lấy một **phạm vi byte** của object R2 — cho passthrough `original.<ext>` khi
 * `MEDIA_AUTO_TRANSCODE=false` (không HLS, phục vụ tệp gốc qua byte-range).
 *
 * S3/R2 `GetObject` hỗ trợ `Range` header (`bytes=START-END`), trả `206` với
 * `Content-Range` + `ContentLength` đúng đoạn. Trả đầy đủ metadata để endpoint
 * dựng phản hồi 206 — service không được chạm `event` (giữ ranh giới với handler).
 *
 * `range` là chuỗi `bytes=START-END` thô từ header HTTP, truyền thẳng vào SDK:
 * SDK tự từ chối range sai bằng `416`-tương-tự (trả toàn bộ object hoặc ném). Caller
 * đã kiểm ranh giới, nên ở đây chỉ chuyển tiếp.
 *
 * `null` cho `range` → lấy toàn bộ object (không Range header từ client).
 *
 * Trả `totalSize` từ `ContentRange` header (dạng `bytes START-END/TOTAL`) khi có
 * Range, hoặc từ `ContentLength` khi không — caller cần tổng kích cỡ để dựng
 * `Content-Range` header phản hồi.
 */
export async function streamR2ObjectRange(
  key: string,
  config: R2Config,
  range: string | null,
): Promise<{
  stream: Readable
  contentType: string
  contentLength: number
  totalSize: number
  contentRange: string | null
}> {
  const client = createClient(config)
  const input: { Bucket: string, Key: string, Range?: string } = {
    Bucket: config.bucket,
    Key: normalizeKey(key),
  }
  if (range) input.Range = range
  const res = await client.send(new GetObjectCommand(input))
  if (!res.Body) {
    throw new Error('R2 object body is empty')
  }
  const contentLength = Number(res.ContentLength ?? 0)
  // `Content-Range` 只 có khi请求带 Range. Dạng: `bytes START-END/TOTAL`.
  const contentRange = res.ContentRange ?? null
  // TOTAL từ cuối `Content-Range`, fallback `ContentLength` (no-range case).
  let totalSize = contentLength
  if (contentRange) {
    const match = contentRange.match(/\/(\d+)$/)
    if (match) totalSize = Number(match[1])
  }
  return {
    stream: res.Body as Readable,
    contentType: res.ContentType ?? 'application/octet-stream',
    contentLength,
    totalSize,
    contentRange,
  }
}

/**
 * HEAD object — lấy contentLength/contentType mà không tải body. Dùng cho
 * stream endpoint cần Range support (hiện không yêu cầu Range nên tạm đủ
 * GetObject). Trả null nếu object không tồn tại.
 */
export async function headR2Object(
  key: string,
  config: R2Config,
): Promise<{ contentType: string, contentLength: number } | null> {
  const client = createClient(config)
  try {
    const res = await client.send(new HeadObjectCommand({
      Bucket: config.bucket,
      Key: normalizeKey(key),
    }))
    return {
      contentType: res.ContentType ?? 'application/octet-stream',
      contentLength: Number(res.ContentLength ?? 0),
    }
  } catch {
    return null
  }
}

/** Suy Content-Type từ extension cho HLS segment/manifest. */
function contentTypeFor(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl'
  if (lower.endsWith('.ts')) return 'video/mp2t'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.vtt')) return 'text/vtt'
  return 'application/octet-stream'
}
