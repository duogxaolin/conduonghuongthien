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
