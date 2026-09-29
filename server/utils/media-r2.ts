import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicUrl: string
}

export function createR2Client(config: R2Config): S3Client {
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

export async function uploadR2File(
  fileBuffer: Buffer,
  filename: string,
  contentType: string,
  config: R2Config
): Promise<{ url: string; storagePath: string }> {
  const client = createR2Client(config)
  const now = new Date()
  const key = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${filename}`

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  }))

  let cleanPublicUrl = config.publicUrl.trim().replace(/\/$/, '')
  // Cán bộ dán `cdn1.delify.vn` thiếu scheme → lưu thành `cdn1.delify.vn/2026/09/...`
  // rồi `new URL(url, origin).href` ở grid biến thành `http://localhost:3000/cdn1...`
  // (ca anh đang gặp ở /admin/media). Tự thêm https:// để không bao giờ lưu URL thiếu scheme.
  if (cleanPublicUrl && !/^https?:\/\//i.test(cleanPublicUrl)) cleanPublicUrl = `https://${cleanPublicUrl}`
  const url = `${cleanPublicUrl}/${key}`
  return { url, storagePath: key }
}

export async function deleteR2File(key: string, config: R2Config): Promise<boolean> {
  try {
    const client = createR2Client(config)
    await client.send(new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }))
    return true
  } catch {
    return false
  }
}

/**
 * Kiểm tra object R2 có tồn tại không — dùng `HeadObjectCommand`. Trả `true/false`
 * thay vì throw. Bắt 404 (NoSuchKey / NotFound) → false, các lỗi khác → false +
 * log (không throw để caller không phải wrap try/catch).
 *
 * Self-heal và sync `to-r2` gọi trước khi xoá file local: nếu R2 không có object
 * mà vẫn xoá local → mất ảnh vĩnh viễn. Hàm này là chốt chặn đó.
 */
export async function headR2Object(key: string, config: R2Config): Promise<boolean> {
  try {
    const client = createR2Client(config)
    await client.send(new HeadObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }))
    return true
  } catch (err: unknown) {
    // 404 / NoSuchKey → object không tồn tại → false (không log, flow bình thường).
    // Lỗi khác (network, auth, 5xx) → false + log để admin biết R2 có vấn đề.
    const msg = err instanceof Error ? err.message : String(err)
    const httpStatus = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
    if (httpStatus === 404 || msg.includes('NoSuchKey') || msg.includes('NotFound')) {
      return false
    }
    console.warn('[media-r2] headR2Object error:', msg)
    return false
  }
}

/**
 * Tải một object R2 về Buffer. Dùng cho sync R2 → local: đọc bytes file R2
 * (storagePath trong `media` khi provider='r2' chính là R2 key) rồi ghi vào
 * `public/uploads/YYYY/MM/filename` qua `uploadLocalFile`.
 */
export async function getR2Object(key: string, config: R2Config): Promise<Buffer> {
  const client = createR2Client(config)
  const response = await client.send(new GetObjectCommand({
    Bucket: config.bucket,
    Key: key,
  }))
  if (!response.Body) throw new Error(`R2 object "${key}" không có body.`)
  // @aws-sdk/client-s3 trả stream Node Readable — gom thành Buffer.
  const chunks: Buffer[] = []
  for await (const chunk of response.Body as AsyncIterable<Buffer>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * Tổng số object + tổng bytes trong bucket R2. Phân trang ListObjectsV2 (mỗi
 * trang 1000 key) để chống bucket lớn — R2 trả tối đa 1000/trang.
 */
export async function getR2BucketSize(config: R2Config): Promise<{ count: number; totalBytes: number }> {
  const client = createR2Client(config)
  let count = 0
  let totalBytes = 0
  let continuationToken: string | undefined
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }))
    for (const obj of res.Contents ?? []) {
      count++
      totalBytes += Number(obj.Size ?? 0)
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (continuationToken)
  return { count, totalBytes }
}
