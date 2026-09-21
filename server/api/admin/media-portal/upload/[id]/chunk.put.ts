/**
 * Nhận một phần của lượt tải lên.
 *
 * ## Phần thân là byte thô, không phải JSON
 *
 * Ownership and the stored session chunk size are checked before consuming the
 * request. The bounded reader rejects both oversized Content-Length and actual
 * chunked bytes before concatenating the body, so an unbounded allocation cannot
 * happen ahead of service validation.
 *
 * `?index=` đi qua query string chứ không qua thân: thân chỉ mang byte, mọi thứ
 * khác trộn vào là để JSON parser quan tâm. h3 trả query param là chuỗi, nên
 * index phải được ép sang `Number` và kiểm `Number.isSafeInteger` tại endpoint
 * trước khi truyền vào service — `isValidChunkIndex` yêu cầu `typeof number`,
 * một chuỗi `"0"` sẽ bị nó từ chối.
 *
 * ## Mã `duplicate`, không phải lỗi
 *
 * Một phần đã nhận được gửi lại trả về `duplicate: true` cùng `ok: true` — một
 * lượt thử lại sau khi mạng đứt cần phân biệt "đã ghi" với "chưa ghi" để tiếp tục,
 * không để bắt đầu lại. Handler chỉ đi tiếp nhánh lỗi khi `!result.ok`.
 */
import { defineEventHandler, getQuery } from 'h3'

import { requireResourcePermission } from '../../../../../utils/permissions'
import { receiveChunk, chunkBodyLimit } from '../../../../../services/chunked-upload'
import { readBoundedUploadBody } from '../../../../../utils/bounded-upload-body'
import { resolveMediaConfigWithDb } from '../../../../../services/media-config-service'
import { getDb } from '../../../../../utils/db'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'create')

  const uploadId = event.context.params?.id
  const query = getQuery(event)

  const index = Number(query.index)
  if (!Number.isSafeInteger(index) || index < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Chỉ số phần không hợp lệ.' })
  }

  const admission = await chunkBodyLimit({ adminUserId: adminUser.id, uploadId, index })
  if (!admission.ok) throw createError({ statusCode: admission.status, statusMessage: admission.message })
  const body = await readBoundedUploadBody(event, admission.bytes)
  if (!body || !Buffer.isBuffer(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Phần tải lên không hợp lệ.' })
  }

  const { config } = await resolveMediaConfigWithDb(getDb())

  const result = await receiveChunk({
    adminUserId: adminUser.id,
    uploadId,
    index,
    body,
  }, { config })

  if (!result.ok) {
    throw createError({ statusCode: result.status, statusMessage: result.message })
  }

  return {
    ok:           true,
    receivedParts: result.receivedParts,
    totalChunks:   result.totalChunks,
    duplicate:     result.duplicate,
  }
})
