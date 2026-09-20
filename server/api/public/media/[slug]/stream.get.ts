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

import { resolveMediaConfig } from '../../../../utils/media-config'
import { logWarn } from '../../../../utils/logger'
import { MEDIA_STREAM_MANIFEST_PATH, resolveStreamTarget } from '../../../../services/media-portal'

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

  const target = await resolveStreamTarget(slug, MEDIA_STREAM_MANIFEST_PATH, { config: resolveMediaConfig() })

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

  return sendStream(event, createReadStream(target.filePath))
})
