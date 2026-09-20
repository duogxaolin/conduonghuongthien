/**
 * Đếm một lượt xem media. Gọi từ trình duyệt sau khi trang đã dựng, **không bao
 * giờ từ SSR**.
 *
 * Lý do nằm ở `nuxt.config.ts`: các tuyến công khai phục vụ qua `swr: 60`, nên
 * người đọc thứ hai trở đi trong mỗi cửa sổ 60 giây **không chạm vào mã máy chủ
 * nào**. Đếm phía máy chủ sẽ thiếu đúng bằng phần mà bộ nhớ đệm đang phát huy tác
 * dụng — và con số thiếu đó trông vẫn hoàn toàn hợp lý.
 *
 * **Mọi nhánh trả cùng một mã 202.** Một bộ đếm lượt xem không có tư cách đặt một
 * dòng đỏ trong bảng điều khiển của khách, và một mã thay đổi theo nhánh sẽ **lộ
 * ra slug nào có thật**: 404 cho slug lạ, 200 cho slug có thật là một danh sách
 * các video chưa xuất bản, đọc được bằng một vòng lặp.
 *
 * Bốn điều lấy nguyên từ tiền lệ `article-views.ts`, không tự nghĩ lại:
 *   1. 202 ở **mọi** nhánh, kể cả nhánh không ngờ tới.
 *   2. Khử trùng lặp bằng `rate_limit_counters` với `limit: 1` — `count === 1`
 *      **chính là** quyết định "lần đầu", nên hai lượt đồng thời không thể cùng
 *      đọc ra 1.
 *   3. Token sinh từ `deriveDailyVisitorToken`, **không lưu IP hay user agent**.
 *   4. Thiếu `ANALYTICS_HMAC_SECRET` thì **dừng đếm** và ghi log, không đếm bằng
 *      một token không dùng được.
 *
 * Cố ý **không** gắn vào `ANALYTICS_COLLECTION_ENABLED`. Công tắc đó là một quyết
 * định riêng tư về việc đo hành vi khách; đây là thống kê biên tập của cổng về
 * chính nội dung của mình. Tắt thu thập rồi thấy mọi video báo 0 vĩnh viễn mà
 * không có gì giải thích là một ngõ cụt im lặng.
 */
import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'

import { getClientIp } from '../../../../utils/client-ip'
import { deriveDailyVisitorToken } from '../../../../utils/analytics-collection'
import { analyticsConfig } from '../../../../utils/runtime-config'
import { rateLimitDeps } from '../../../../utils/rate-limit-deps'
import { recordRateLimitHit } from '../../../../utils/rate-limit-store'
import { logError, logWarn } from '../../../../utils/logger'
import { viewDay } from '../../../../services/article-views'
import {
  MEDIA_VIEW_DEDUPE_RULE,
  buildMediaViewDedupeKey,
  recordMediaView,
  resolvePublishedMediaId,
} from '../../../../services/media-portal'

/** Một dòng log cho mỗi nguyên nhân, không phải mỗi request — nếu không, một máy
 *  chủ thiếu bí mật sẽ ghi một dòng cho mỗi lượt mở trang. */
let secretWarned = false

export default defineEventHandler(async (event) => {
  setResponseStatus(event, 202)

  try {
    const slug = getRouterParam(event, 'slug')
    if (!slug) return { accepted: false }

    // Thân request không mang trường nào được dùng. Nó vẫn được đọc và bỏ qua một
    // cách tường minh: một `readBody` không gọi thì h3 để lại luồng request chưa
    // tiêu thụ, còn một `readBody` ném ra thì biến một thân hỏng thành 500. Cả hai
    // đều là lý do để đọc rồi quên.
    await readBody(event).catch(() => null)

    const mediaItemId = await resolvePublishedMediaId(slug)
    // Cùng mã, cùng hình dạng: slug lạ và slug chưa xuất bản không phân biệt được.
    if (mediaItemId === null) return { accepted: false }

    const config = analyticsConfig(event)
    const day = viewDay()

    let visitorToken: string
    try {
      visitorToken = deriveDailyVisitorToken(config?.hmacSecret, {
        ip: getClientIp(event),
        userAgent: String(event.node.req.headers['user-agent'] || ''),
        day,
      })
    } catch (error) {
      // Không có bí mật thì không có token, và không có token thì không khử trùng
      // lặp được — đếm tiếp nghĩa là đếm mọi lượt F5. Từ chối là đúng; từ chối
      // trong im lặng thì không, vì đây là dấu vết duy nhất người vận hành có.
      if (!secretWarned) {
        secretWarned = true
        logWarn({
          event: 'media_view.secret_unavailable',
          message: error instanceof Error ? error.message : String(error),
          cause: 'ANALYTICS_HMAC_SECRET is missing or shorter than 32 characters',
        })
      }
      return { accepted: false }
    }

    const state = await recordRateLimitHit(
      buildMediaViewDedupeKey(mediaItemId, visitorToken),
      MEDIA_VIEW_DEDUPE_RULE,
      rateLimitDeps(),
    )
    if (state.count !== 1) return { accepted: false }

    await recordMediaView(mediaItemId)
    return { accepted: true }
  } catch (error) {
    // Hợp đồng là 202 trong **mọi** trường hợp, kể cả trường hợp handler không
    // lường trước. Lượt hỏng vẫn phải tìm được, nên nó đi vào log chứ không đi ra
    // cho khách.
    logError({
      event: 'media_view.record_failed',
      message: error instanceof Error ? error.message : String(error),
    })
    return { accepted: false }
  }
})
