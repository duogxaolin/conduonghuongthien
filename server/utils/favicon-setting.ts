/**
 * Đọc cấu hình favicon từ CSDL — **một** bộ đọc, **một** bộ đệm.
 *
 * Hai nơi cần cùng giá trị này và chúng đến từ hai phía khác nhau:
 *  - `server/plugins/favicon.ts` chèn thẻ `<link>` vào mỗi lượt dựng trang;
 *  - `server/routes/favicon.ico.ts` phục vụ đường dẫn `/favicon.ico` mà máy quét,
 *    đầu đọc RSS và trình duyệt cũ gọi **trực tiếp**, không đọc thẻ nào.
 *
 * Để mỗi nơi tự đọc là hai bộ đệm hết hạn lệch nhau, nên trong tối đa 30 giây thẻ
 * `<link>` và tuyến `/favicon.ico` có thể trỏ **hai icon khác nhau** — và favicon
 * bị trình duyệt đệm rất lâu, nên một lần đọc lệch đọng lại rất dai.
 *
 * Không bao giờ ném. Cả hai nơi gọi đều lùi về bộ mặc định đi kèm mã nguồn, nên
 * một CSDL đang có vấn đề làm cổng mất **cấu hình** favicon, không làm mất favicon.
 */
import { settings } from '../db/schema'
import { getDb } from './db'
import { DEFAULT_FAVICON_URL, safeFaviconUrl } from './favicon'

/** Cùng con số `plugins/tracking.ts` dùng — một hằng số thứ hai cho cùng một việc
 *  là chỗ để hai giá trị lệch nhau. */
const CACHE_TTL_MS = 30_000

/** Khoá cho tuyến `/favicon.ico`, tách khỏi `favicon_url` của thẻ `<link>`. */
export const FAVICON_ICO_SETTING_KEY = 'favicon_ico_url'

export interface FaviconSetting {
  /** URL cho thẻ `rel="icon"` — luôn dùng được (đã qua `safeFaviconUrl`). */
  iconUrl: string
  /**
   * URL của bản `.ico`, hoặc `null` để tuyến `/favicon.ico` dùng tệp mặc định.
   *
   * `null` chứ không phải một đường dẫn đoán ra từ `iconUrl`: suy kiểu "đổi
   * `-32.png` thành `.ico`" chạy đúng với bộ do endpoint sinh ra và **sai** với
   * mọi URL cán bộ tự gõ hoặc trỏ sang CDN — nó sẽ dựng ra một đường dẫn không có
   * tệp nào, rồi tuyến kia trả 404 ở chỗ đáng lẽ phải có icon.
   */
  icoUrl: string | null
}

let cache: { value: FaviconSetting; expires: number } | null = null

const FALLBACK: FaviconSetting = { iconUrl: DEFAULT_FAVICON_URL, icoUrl: null }

/**
 * Cấu hình favicon hiện hành.
 *
 * Mọi kết quả không dùng được — không có hàng, chuỗi rỗng, giá trị bị
 * `safeFaviconUrl` từ chối, hay CSDL không nối được — đều ra cùng một hình dạng,
 * nên nơi gọi không có nhánh nào dẫn tới "không có icon nào".
 */
export async function loadFaviconSetting(): Promise<FaviconSetting> {
  const now = Date.now()
  if (cache && cache.expires > now) return cache.value

  try {
    const db = getDb()
    const rows = await db.select({ key: settings.key, value: settings.value }).from(settings)
    const byKey = new Map(rows.map(row => [row.key, row.value]))

    const value: FaviconSetting = {
      iconUrl: safeFaviconUrl(byKey.get('favicon_url')) ?? DEFAULT_FAVICON_URL,
      icoUrl: safeFaviconUrl(byKey.get(FAVICON_ICO_SETTING_KEY)),
    }

    cache = { value, expires: now + CACHE_TTL_MS }
    return value
  } catch {
    // Đệm cả giá trị lùi: nếu không, một CSDL đang chết sẽ bị gọi lại ở **mỗi**
    // lượt dựng trang, biến một sự cố thành hai.
    cache = { value: FALLBACK, expires: now + CACHE_TTL_MS }
    return FALLBACK
  }
}

/**
 * Bỏ bộ đệm — gọi ngay sau khi lưu favicon mới.
 *
 * Không có nó thì cán bộ lưu xong, tải lại trang, và thấy icon cũ tới 30 giây.
 * Trang cài đặt đã phải cảnh báo rằng **trình duyệt** đệm favicon rất lâu; thêm
 * một lớp đệm phía máy chủ vào đúng lúc đó là làm lời cảnh báo kia thành vô ích —
 * cán bộ không phân biệt được hai nguyên nhân, và cả hai đều trông như "không lưu
 * được".
 */
export function clearFaviconSettingCache(): void {
  cache = null
}
