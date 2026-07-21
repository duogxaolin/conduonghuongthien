import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

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

  const cleanPublicUrl = config.publicUrl.replace(/\/$/, '')
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
