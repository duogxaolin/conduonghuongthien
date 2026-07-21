import { createR2Client } from '../../../utils/media-r2'
import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { checkPermission } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'settings', 'read', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const body = await readBody(event).catch(() => ({}))
  const accountId = String(body?.accountId || '').trim()
  const accessKeyId = String(body?.accessKeyId || '').trim()
  const secretAccessKey = String(body?.secretAccessKey || '').trim()
  const bucket = String(body?.bucket || '').trim()

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng nhập đầy đủ Account ID, Access Key, Secret Key và Bucket name.' })
  }

  try {
    const client = createR2Client({
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      publicUrl: '',
    })

    await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      MaxKeys: 1,
    }))

    return { ok: true, message: 'Kết nối Cloudflare R2 thành công!' }
  } catch (err: any) {
    throw createError({
      statusCode: 400,
      statusMessage: `Kết nối R2 thất bại: ${err?.message || 'Lỗi xác thực hoặc không tìm thấy Bucket.'}`
    })
  }
})
