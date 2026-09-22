/**
 * Phát manifest HLS của một mục đã xuất bản — **truyền byte, không chuyển hướng**.
 *
 * Đây là điểm khác biệt quan trọng nhất so với cách làm quen thuộc: một
 * `sendRedirect` tới kho (R2/S3) sẽ đặt địa chỉ kho đã ký vào trình duyệt của
 * người đọc, vào lịch sử của họ, và vào log của **mọi** trung gian trên đường đi.
 * Địa chỉ ký sẵn là thứ chỉ nên đi lại giữa máy chủ và nhà cung cấp kho; nó không
 * có việc gì trong một cổng thông tin của Bộ Công an. Nên endpoint tự mở tệp và
 * `sendStream` nó ra, đúng khuôn `server/routes/uploads/[...path].ts`.
 *
 * Đường dẫn kho do **máy chủ** giải (`resolveStreamTarget`), không nhận từ request:
 * tham số duy nhất đến từ URL là slug và đường dẫn tương đối trong cây đã công bố,
 * cả hai đều bị lọc trước khi chạm hệ thống tệp.
 *
 * `X-Content-Type-Options: nosniff` đi kèm mọi phản hồi: không có nó, một tệp
 * trong cây media bị thay bằng nội dung khác vẫn có thể được trình duyệt diễn giải
 * thành HTML chạy trên chính origin này.
 */
import { createReadStream } from 'node:fs'

import { createError, defineEventHandler, getHeader, getRouterParam, sendStream, setResponseHeaders } from 'h3'

import { logWarn } from '../../../../utils/logger'
import { MEDIA_STREAM_MANIFEST_PATH, resolveStreamTarget } from '../../../../services/media-portal'
import { resolveMediaConfigWithDb } from '../../../../services/media-config-service'
import { getDb } from '../../../../utils/db'
import { streamR2Object, streamR2ObjectRange } from '../../../../services/video-r2-sync'

export default defineEventHandler(async (event) => {
  // `nosniff` đi cùng **mọi** phản hồi, kể cả 404, nên nó được đặt trước mọi
  // nhánh chứ không nằm trong nhánh thành công.
  //
  // Đường lỗi của h3 (`sendError`) tự ghi thêm `content-type` rồi kết thúc phản
  // hồi; nó **không** xoá header đã đặt, nhưng nó cũng không tự thêm header nào.
  // Đặt header trong nhánh thành công thôi thì một lượt 404 ra ngoài **thiếu**
  // đúng header mà đặc tả yêu cầu — và thiếu theo cách không có gì đỏ ở đâu cả,
  // vì một 404 vẫn là một 404.
  setResponseHeaders(event, { 'X-Content-Type-Options': 'nosniff' })

  const shortId = getRouterParam(event, 'shortId')
  if (!shortId) throw createError({ statusCode: 404 })

  const { config } = await resolveMediaConfigWithDb(getDb())
  let target = await resolveStreamTarget(shortId, MEDIA_STREAM_MANIFEST_PATH, { config })

  // Link cũ dùng slug: `shortId` tra không ra → thử slug. Asset phục vụ thẳng,
  // không redirect (redirect manifest/segment gây double-request + hỏng cache).
  if (!target) {
    target = await resolveStreamTarget(shortId, MEDIA_STREAM_MANIFEST_PATH, { config, lookupSlug: true })
  }

  // Một nhánh 404 duy nhất cho mọi lý do: slug lạ, mục chưa xuất bản, mục nguồn
  // ngoài (không có gì để phát từ đĩa), và tệp chưa được chuyển mã xong. Tách
  // chúng ra là nói cho người ngoài biết slug nào có thật.
  if (!target) {
    logWarn({ event: 'public.media_stream_miss', reason: 'unresolved' })
    throw createError({ statusCode: 404 })
  }

  // `X-Content-Type-Options` đã đặt ở đầu handler, dùng chung cho cả nhánh 404.
  //
  // Tệp gốc passthrough (`MEDIA_AUTO_TRANSCODE=false`): xử lý byte-range trong
  // hàm riêng — trình phát `<video>` cần Range để tua. Nhánh này tự đặt Content-Type
  // / Content-Length / Cache-Control, nên header chung bên dưới chỉ áp dụng cho
  // nhánh HLS và R2.
  if (target.kind === 'local' && target.passthrough) {
    return serveOriginalByteRange(event, target.filePath, target.size, target.contentType, target.cacheSeconds)
  }

  // R2 passthrough (`MEDIA_AUTO_TRANSCODE=false`, không rendition): phục vụ
  // `original.<ext>` từ R2 qua byte-range — trình phát `<video>` cần Range để ua.
  // R2/S3 GetObject hỗ trợ `Range` param trực tiếp, nên chỉ chuyển tiếp header
  // Range của client sang R2 và dựng lại 206 + Content-Range từ phản hồi R2.
  if (target.kind === 'r2' && target.passthrough) {
    const r2Config = config.videoStorage.r2
    if (!r2Config) throw createError({ statusCode: 503, statusMessage: 'R2 chưa cấu hình.' })
    const rangeHeader = getHeader(event, 'range')
    const range = rangeHeader && typeof rangeHeader === 'string' && rangeHeader.startsWith('bytes=')
      ? rangeHeader
      : null
    setResponseHeaders(event, {
      'Content-Type': target.contentType,
      'Cache-Control': `public, max-age=${target.cacheSeconds}`,
      'Accept-Ranges': 'bytes',
    })
    try {
      const obj = await streamR2ObjectRange(target.r2Key, r2Config, range)
      setResponseHeaders(event, { 'Content-Length': String(obj.contentLength) })
      if (obj.contentRange) {
        setResponseHeaders(event, { 'Content-Range': obj.contentRange })
        event.node.res.statusCode = 206
      }
      return sendStream(event, obj.stream)
    } catch {
      logWarn({ event: 'public.media_stream_r2_miss', key: target.r2Key })
      throw createError({ statusCode: 404 })
    }
  }

  setResponseHeaders(event, {
    'Content-Type': target.contentType,
    'Content-Length': String(target.size),
    'Cache-Control': `public, max-age=${target.cacheSeconds}`,
  })

  if (target.kind === 'r2') {
    // R2 stream — pipe byte qua proxy, không redirect (design.md dòng 196).
    // `size=0` ở target vì chưa biết ContentLength; đọc từ GetObject response.
    const r2Config = config.videoStorage.r2
    if (!r2Config) throw createError({ statusCode: 503, statusMessage: 'R2 chưa cấu hình.' })
    try {
      const obj = await streamR2Object(target.r2Key, r2Config)
      // Cập nhật Content-Length thật (GetObject trả contentLength chính xác).
      setResponseHeaders(event, { 'Content-Length': String(obj.contentLength) })
      return sendStream(event, obj.stream)
    } catch {
      logWarn({ event: 'public.media_stream_r2_miss', key: target.r2Key })
      throw createError({ statusCode: 404 })
    }
  }

  return sendStream(event, createReadStream(target.filePath))
})

/**
 * Phát tệp gốc (mp4/webm/...) qua byte-range khi không có HLS — trình phát
 * `<video>` cần Range để tua, và `sendStream` trần không tự xử lý nó.
 *
 * HTTP Range (`bytes=START-END`): trả `206 Partial Content` với `Content-Range`
 * và `Accept-Ranges: bytes`. Không có Range → trả toàn bộ tệp (`200`).
 */
async function serveOriginalByteRange(
  event: Parameters<ReturnType<typeof defineEventHandler>>[0],
  filePath: string,
  size: number,
  contentType: string,
  cacheSeconds: number,
) {
  // `Accept-Ranges` báo cho trình phát biết tua được dù yêu cầu đầu tiên không kèm Range.
  const rangeHeader = getHeader(event, 'range')
  setResponseHeaders(event, {
    'Content-Type': contentType,
    'Cache-Control': `public, max-age=${cacheSeconds}`,
    'Accept-Ranges': 'bytes',
  })

  // Không có Range → phát cả tệp. `Content-Length` đúng kích cỡ tệp.
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
    setResponseHeaders(event, { 'Content-Length': String(size) })
    return sendStream(event, createReadStream(filePath))
  }

  // `bytes=START-END` (END có thể thiếu → tới cuối tệp).
  const spec = rangeHeader.slice(6).trim()
  const [startRaw, endRaw] = spec.split('-')
  const start = Number.parseInt(startRaw || '0', 10)
  const endRawNumber = Number.parseInt(endRaw || '', 10)
  const end = Number.isNaN(endRawNumber) ? size - 1 : endRawNumber
  // Range vượt ranh → 416 (trả 200 một phần sẽ che lỗi cấu hình của trình phát).
  if (Number.isNaN(start) || start < 0 || start >= size || end >= size || start > end) {
    setResponseHeaders(event, {
      'Content-Range': `bytes */${size}`,
    })
    throw createError({ statusCode: 416, statusMessage: 'Range Not Satisfiable' })
  }

  const chunkSize = end - start + 1
  setResponseHeaders(event, {
    'Content-Length': String(chunkSize),
    'Content-Range': `bytes ${start}-${end}/${size}`,
    // 206, không 200 — trình phát distinguish được "đoạn này" với "toàn tệp".
    // h3 không có helper 206 tường minh; set status trực tiếp qua Node response.
  })
  // h3 `sendStream` thừa kế status code hiện có của response; đặt trước khi stream.
  event.node.res.statusCode = 206
  return sendStream(event, createReadStream(filePath, { start, end }))
}
