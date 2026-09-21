/**
 * Phân đoạn và playlist của từng độ phân giải — phần còn lại của cây HLS.
 *
 * `master.m3u8` có endpoint riêng (`stream.get.ts`); tệp này phục vụ mọi thứ nằm
 * **dưới** thư mục đã công bố của một mục: `<rendition>/index.m3u8`,
 * `<rendition>/seg_000.ts`, `thumb.jpg`, và bất cứ tài nguyên nào khác mà bộ
 * chuyển mã sinh ra sau này.
 *
 * Vì sao là một nhánh `**` chứ không phải một endpoint cho mỗi tệp: tên phân đoạn
 * do FFmpeg quyết định (`seg_%03d.ts`), và một danh sách cứng ở đây sẽ lệch khỏi
 * nó trong im lặng — video phát được ở độ phân giải thấp rồi đứng ở phân đoạn thứ
 * mấy chục. Cái được kiểm không phải tên tệp mà là **nó nằm trong thư mục của mục
 * đó và mục đó đã xuất bản**.
 *
 * Hai endpoint, không phải một: một mình `[...path]` **không** khớp đường dẫn
 * trần `/stream`, và `**:path?` cũng không. Đã kiểm bằng cách dựng thật cây tuyến
 * của Nitro rồi gọi nó, không phải bằng cách suy từ tài liệu.
 */
import { createReadStream } from 'node:fs'

import { createError, defineEventHandler, getRouterParam, sendStream, setResponseHeaders } from 'h3'

import { logWarn } from '../../../../utils/logger'
import { resolveStreamTarget } from '../../../../services/media-portal'
import { resolveMediaConfigWithDb } from '../../../../services/media-config-service'
import { getDb } from '../../../../utils/db'
import { streamR2Object } from '../../../../services/video-r2-sync'

export default defineEventHandler(async (event) => {
  // Đặt trước mọi nhánh, cùng lý do như `stream.get.ts`: đường lỗi của h3 không
  // tự thêm header nào, nên một header nằm trong nhánh thành công sẽ **vắng mặt**
  // trên chính những phản hồi 404 mà đặc tả yêu cầu nó.
  setResponseHeaders(event, { 'X-Content-Type-Options': 'nosniff' })

  const slug = getRouterParam(event, 'slug')
  const relativePath = getRouterParam(event, 'path')
  if (!slug || !relativePath) throw createError({ statusCode: 404 })

  const { config } = await resolveMediaConfigWithDb(getDb())
  const target = await resolveStreamTarget(slug, relativePath, { config })

  // Cùng một 404 cho mọi lý do — xem `stream.get.ts`. Ở đây còn thêm một lý do
  // nữa cần giấu: một đường dẫn thoát khỏi cây media phải đọc ra **y hệt** một
  // đường dẫn không tồn tại, không phải 403. Mã 403 xác nhận rằng tệp đó có thật.
  if (!target) {
    logWarn({ event: 'public.media_asset_miss', reason: 'unresolved' })
    throw createError({ statusCode: 404 })
  }

  setResponseHeaders(event, {
    'Content-Type': target.contentType,
    'Cache-Control': `public, max-age=${target.cacheSeconds}`,
    // Đuôi không nhận ra thì tải về, không hiển thị — cùng quy tắc với
    // `server/routes/uploads/[...path].ts`.
    ...(target.attachment ? { 'Content-Disposition': 'attachment' } : {}),
  })

  if (target.kind === 'r2') {
    // R2 segment — pipe qua proxy, không redirect. ContentLength từ GetObject.
    const r2Config = config.videoStorage.r2
    if (!r2Config) throw createError({ statusCode: 503, statusMessage: 'R2 chưa cấu hình.' })
    try {
      const obj = await streamR2Object(target.r2Key, r2Config)
      setResponseHeaders(event, { 'Content-Length': String(obj.contentLength) })
      return sendStream(event, obj.stream)
    } catch {
      logWarn({ event: 'public.media_asset_r2_miss', slug, key: target.r2Key })
      throw createError({ statusCode: 404 })
    }
  }

  setResponseHeaders(event, { 'Content-Length': String(target.size) })
  return sendStream(event, createReadStream(target.filePath))
})
