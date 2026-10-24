/**
 * Tải lên theo từng phần — NHẬN MỘT PHẦN và hợp nó vào tập `received_parts`.
 *
 * Mỗi phần ghi xuống đĩa rồi mới hợp chỉ số vào hàng phiên, trong một transaction
 * khoá hàng (`SELECT … FOR UPDATE`): hai phần đến cùng lúc cho cùng một lượt tải
 * không được ghi đè tập của nhau (`[0]` + `[1]` phải ra `[0, 1]`, không phải `[1]`
 * — lỗi đã gặp, xem `docs/codebase-audit-2026-09-19.md`). `upload-concurrency-
 * integration` canh điều đó trên MySQL thật.
 *
 * `chunkBodyLimit` chạy TRƯỚC khi đọc thân request: nó trả trần byte theo hình
 * học đã lưu của phiên, để endpoint không đọc quá một phần vào bộ nhớ.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import { mediaUploadSessions } from '../db/schema'
import { logWarn } from '../utils/logger'
import {
  accumulatedBytes,
  admitDisk,
  deps,
  findOwned,
  formatBytes,
  isValidChunkIndex,
  isValidUploadId,
  NOT_FOUND,
  resolvePartPath,
  syncDirectory,
  toView,
  withReceivedPart,
  type UploadDeps,
  type UploadFailure,
  type UploadSessionView,
} from './chunked-upload-core'

// ─── 6.1 — Nhận một phần ─────────────────────────────────────────────────────

export type ReceiveChunkInput = {
  adminUserId: number
  uploadId: unknown
  index: unknown
  body: Buffer
}

export type ReceiveChunkResult =
  | { ok: true, receivedParts: number[], totalChunks: number, duplicate: boolean }
  | UploadFailure

/**
 * Nhận một phần và ghi nó xuống đĩa.
 *
 * Thứ tự các bước là một phần của hợp đồng, không phải cách sắp cho dễ đọc:
 * quyền sở hữu → hình dạng mã → trạng thái phiên → chỉ số → độ dài → trần dung
 * lượng → ghi. Mỗi bước đứng trước bước sau vì nó **rẻ hơn**, nên một request
 * sai bị từ chối mà không chạm đĩa và không sửa hàng.
 */
export async function receiveChunk(input: ReceiveChunkInput, options: UploadDeps = {}): Promise<ReceiveChunkResult> {
  const { db, config } = deps(options)

  if (!isValidUploadId(input.uploadId)) return NOT_FOUND

  const uploadId = input.uploadId
  return db.transaction(async tx => {
  const row = await findOwned(tx, uploadId, input.adminUserId, true)
  if (!row) return NOT_FOUND

  const view = toView(row)
  if (view.status !== 'pending') {
    return {
      ok: false, status: 400, code: 'state',
      message: view.status === 'completed'
        ? 'Lượt tải lên này đã hoàn tất.'
        : 'Lượt tải lên này đã hỏng. Hãy bắt đầu lại.',
    }
  }

  if (!isValidChunkIndex(input.index, view.totalChunks)) {
    return {
      ok: false, status: 400, code: 'bad_index',
      message: `Chỉ số phần không hợp lệ. Nhận số nguyên từ 0 đến ${view.totalChunks - 1}.`,
    }
  }
  const index = input.index

  const expected = Math.min(view.chunkSize, view.declaredSize - index * view.chunkSize)
  const range = { min: expected, max: expected }
  if (input.body.length < range.min || input.body.length > range.max) {
    return {
      ok: false, status: 400, code: 'bad_chunk_size',
      message: range.min === range.max
        ? `Phần ${index} phải dài đúng ${formatBytes(range.max)}.`
        : `Phần ${index} phải dài từ 1 đến ${formatBytes(range.max)}.`,
    }
  }

  // Gửi lại một phần đã nhận: thành công, không đổi gì. Đây là nhánh làm cho một
  // lượt thử lại sau khi mạng đứt trở nên an toàn — không có nó thì client không
  // có cách nào phân biệt "đã ghi" với "chưa ghi".
  if (view.receivedParts.includes(index)) {
    await tx.update(mediaUploadSessions).set({ updatedAt: new Date() })
      .where(and(eq(mediaUploadSessions.uploadId, view.uploadId), eq(mediaUploadSessions.adminUserId, input.adminUserId)))
    return { ok: true, receivedParts: view.receivedParts, totalChunks: view.totalChunks, duplicate: true }
  }

  const lastPartLength = await readLastPartLength(config.workdir, view)
  const already = accumulatedBytes(view.receivedParts, view.totalChunks, view.chunkSize, lastPartLength)
  if (already + input.body.length > config.maxUploadSize) {
    // Nhánh "dung lượng tích luỹ vượt trần": dung lượng khai báo hợp lệ nhưng
    // những gì thực sự đến thì không. Lượt tải bị đánh dấu hỏng thay vì chỉ từ
    // chối phần này — client khai một đằng gửi một nẻo thì gửi lại cũng vậy.
    const message = `Dung lượng nhận được vượt giới hạn ${formatBytes(config.maxUploadSize)} của máy chủ này.`
    await tx
      .update(mediaUploadSessions)
      .set({ status: 'failed', errorMessage: message.slice(0, 512) })
      .where(and(eq(mediaUploadSessions.uploadId, view.uploadId), eq(mediaUploadSessions.adminUserId, input.adminUserId)))
    logWarn({ event: 'media.upload_over_limit', uploadId: view.uploadId, received: already + input.body.length })
    return { ok: false, status: 413, code: 'size_limit', message }
  }

  const diskFailure = await admitDisk(config, input.body.length, options.statfs as typeof fs.statfs | undefined)
  if (diskFailure) return diskFailure
  const target = resolvePartPath(config.workdir, view.uploadId, index)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    const handle = await fs.open(temporary, 'wx')
    try { await handle.writeFile(input.body); await handle.sync() } finally { await handle.close() }
    await fs.rename(temporary, target)
    await syncDirectory(path.dirname(target))
  } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }

  const receivedParts = withReceivedPart(view.receivedParts, index)
  await tx
    .update(mediaUploadSessions)
    .set({ receivedParts, updatedAt: new Date() })
    .where(and(eq(mediaUploadSessions.uploadId, view.uploadId), eq(mediaUploadSessions.adminUserId, input.adminUserId)))

  return { ok: true, receivedParts, totalChunks: view.totalChunks, duplicate: false }
  })
}

/** Authorize ownership and bound the body using the stored session geometry before reading bytes. */
export async function chunkBodyLimit(input: Omit<ReceiveChunkInput, 'body'>, options: UploadDeps = {}) {
  const { db } = deps(options)
  if (!isValidUploadId(input.uploadId)) return NOT_FOUND
  const row = await findOwned(db, input.uploadId, input.adminUserId)
  if (!row) return NOT_FOUND
  if (row.status !== 'pending') return { ok: false as const, status: 409 as const, code: 'state' as const, message: 'Lượt tải lên không nhận thêm phần.' }
  if (!isValidChunkIndex(input.index, row.totalChunks)) return { ok: false as const, status: 400 as const, code: 'bad_index' as const, message: 'Chỉ số phần không hợp lệ.' }
  return { ok: true as const, bytes: Math.min(row.chunkSize, Number(row.declaredSize) - Number(input.index) * row.chunkSize) }
}

/**
 * Độ dài thật của phần cuối, nếu nó đã có trên đĩa.
 *
 * Một `stat`, và chỉ khi phần cuối đã được nhận. `stat` hỏng (tệp biến mất giữa
 * hai lượt) đọc thành `null` chứ không ném: con số này chỉ dùng để so trần dung
 * lượng, và để một lượt `stat` hỏng chặn cả lượt tải là đánh đổi sai.
 */
async function readLastPartLength(root: string, view: UploadSessionView): Promise<number | null> {
  const lastIndex = view.totalChunks - 1
  if (!view.receivedParts.includes(lastIndex)) return null
  try {
    const stat = await fs.stat(resolvePartPath(root, view.uploadId, lastIndex))
    return stat.size
  } catch {
    return null
  }
}
