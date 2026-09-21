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

import { createError, defineEventHandler, getRouterParam, sendStream, setResponseHeaders } from 'h3'

import { logWarn } from '../../../../utils/logger'
import { MEDIA_STREAM_MANIFEST_PATH, resolveStreamTarget } from '../../../../services/media-portal'
import { resolveMediaConfigWithDb } from '../../../../services/media-config-service'
import { getDb } from '../../../../utils/db'
import { streamR2Object } from '../../../../services/video-r2-sync'

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

  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 404 })

  const { config } = await resolveMediaConfigWithDb(getDb())
  const target = await resolveStreamTarget(slug, MEDIA_STREAM_MANIFEST_PATH, { config })

  // Một nhánh 404 duy nhất cho mọi lý do: slug lạ, mục chưa xuất bản, mục nguồn
  // ngoài (không có gì để phát từ đĩa), và tệp chưa được chuyển mã xong. Tách
  // chúng ra là nói cho người ngoài biết slug nào có thật.
  if (!target) {
    logWarn({ event: 'public.media_stream_miss', reason: 'unresolved' })
    throw createError({ statusCode: 404 })
  }

  // `X-Content-Type-Options` đã đặt ở đầu handler, dùng chung cho cả nhánh 404.
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
      logWarn({ event: 'public.media_stream_r2_miss', slug, key: target.r2Key })
      throw createError({ statusCode: 404 })
    }
  }

  return sendStream(event, createReadStream(target.filePath))
})
