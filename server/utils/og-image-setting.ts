/**
 * Đọc cấu hình `og_image_url` từ CSDL — **một** bộ đọc, **một** bộ đệm.
 *
 * Mô-phỏng `loadFaviconSetting` (xem `favicon-setting.ts`): cùng một lý do —
 * plugin `render:html` chèn `<meta property="og:image">` mỗi lượt dựng trang, nên
 * nếu không đệm thì mỗi lượt render sẽ đều gây ra một truy vấn CSDL. Bộ đệm 30 giây
 * khớp với `favicon-setting` để hai bộ hết hạn cùng lúc, tránh một ô admin lưu xong
 * thì og:image cập nhật mà favicon vẫn cũ (hoặc ngược lại).
 *
 * Không bao giờ ném. CSDL đang chết thì og:image vắng — không phải lỗi hiển thị,
 * chỉ là trang không hiện ảnh preview khi chia sẻ link — nên lùi về rỗng (plugin
 * sẽ không chèn thẻ nào) thay vì bắn lỗi.
 */
import { eq } from 'drizzle-orm'

import { settings } from '../db/schema'
import { getDb } from './db'

/** Cùng con số `favicon-setting.ts` dùng — một hằng số thứ hai cho cùng một việc
 *  là chỗ để hai giá trị lệch nhau. */
const CACHE_TTL_MS = 30_000

export const OG_IMAGE_SETTING_KEY = 'og_image_url'

export interface OgImageSetting {
  /** URL ảnh chia sẻ mặc định, hoặc `''` nếu admin chưa đặt. */
  ogImageUrl: string
}

let cache: { value: OgImageSetting; expires: number } | null = null

const FALLBACK: OgImageSetting = { ogImageUrl: '' }

/**
 * Cấu hình OG image hiện hành.
 *
 * Không có hàng / chuỗi rỗng / CSDL không nối được — tất cả đều ra cùng `''`,
 * nên plugin gọi hàm này chỉ có một nhánh: có URL thì chèn, không thì thôi.
 */
export async function loadOgImageSetting(): Promise<OgImageSetting> {
  const now = Date.now()
  if (cache && cache.expires > now) return cache.value

  try {
    const db = getDb()
    const rows = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, OG_IMAGE_SETTING_KEY))
    const ogImageUrl = rows[0]?.value?.trim() ?? ''

    const value: OgImageSetting = { ogImageUrl }
    cache = { value, expires: now + CACHE_TTL_MS }
    return value
  } catch {
    // Đệm cả giá trị lùi: nếu không, một CSDL đang chết bị gọi lại ở **mỗi** lượt
    // dựng trang, biến một sự cố thành hai.
    cache = { value: FALLBACK, expires: now + CACHE_TTL_MS }
    return FALLBACK
  }
}

/**
 * Bỏ bộ đệm — gọi sau khi lưu `og_image_url` mới qua `index.put.ts`.
 *
 * Không có nó thì admin lưu xong, tải lại trang, và thấy og:image cũ tới 30 giây.
 * `og:image` không bị trình duyệt đệm như favicon, nhưng Facebook/Twitter scraper
 * đệm rất lâu — một giá trị cũ đọng lại ở phía mạng xã hội dai hơn cả ở máy chủ,
 * nên admin cần thấy tag mới ngay để biết mình đã lưu đúng.
 */
export function clearOgImageSettingCache(): void {
  cache = null
}
