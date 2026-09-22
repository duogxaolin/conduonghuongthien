/**
 * Làm mới bộ đệm SWR của trang **danh sách** `/media` ngay khi xuất bản.
 *
 * ## Vì sao chỉ `/media`, không `/media/**`
 *
 * `/media/**` (trang chi tiết) **bắt buộc** `swr: 60` vì mang danh tính người đọc
 * (luồng bình luận, cờ `canDelete`) — không được dựng phía máy chủ. Trang
 * `/media` (danh sách) **không** có state người đọc nào, nội dung công khai thuần,
 * nên làm mới nó ngay khi xuất bản là an toàn và đúng: khách phải thấy video mới
 * ngay khi cán bộ vừa đăng, không đợi 60 giây.
 *
 * ## Ranh giới "kiểm được không cần mount"
 *
 * `selectMediaCacheKeys` là hàm **thuần** (mảng khoá → mảng khoá đã lọc), ghim được
 * bằng test mà không cần Nitro runtime. `purgeMediaListCache` gọi `useStorage`
 * (H3 utility) nên chỉ chạy được trong event handler — và đó là lý do nó nhận
 * `event` làm tham số, không tự đọc context toàn cục.
 *
 * ## Hình dạng khoá
 *
 * Nitro giữ các entry dưới namespace `cache:`, mỗi khoá có dạng
 * `nitro/routes:<tên>:<đường>.json` (tiền tố `nitro/routes` khi duyệt qua
 * `getKeys`). Trang danh sách `/media` sinh khoá như `nitro/routes:/media:GET.json`,
 * còn trang chi tiết sinh `nitro/routes:/media/<shortId>:GET.json`. Cách phân biệt
 * duy nhất tin cậy được là **dấu `/` ngay sau `media`**: danh sách kết thúc bằng
 * `media`, chi tiết có thêm `/`.
 */
import type { H3Event } from 'h3'

/**
 * Lọc mảng khoá cache, chỉ giữ lại khoá của trang **danh sách** `/media`
 * (loại bỏ `/media/<shortId>` — trang chi tiết).
 *
 * Khoá có dạng `nitro/routes:/media:GET.json` (danh sách) hoặc
 * `nitro/routes:/media/<id>:GET.json` (chi tiết). Phân biệt bằng dấu `/` sau
 * `media`: chỉ giữ khoá mà phần đường dẫn kết thúc đúng bằng `/media`.
 *
 * Hàm thuần — nhận mảng, trả mảng, không I/O, ghim được bằng test.
 */
export function selectMediaCacheKeys(keys: readonly string[]): string[] {
  const result: string[] = []
  for (const key of keys) {
    // B strip tiền tố `nitro/routes:` để lấy phần đường dẫn.
    const afterPrefix = key.startsWith('nitro/routes:')
      ? key.slice('nitro/routes:'.length)
      : key
    // Tách phần đường dẫn khỏi hậu tố `:GET.json` / `:HEAD.json` v.v.: tìm dấu
    // `:` cuối cùng trong phần còn lại (sau khi đã bỏ tiền tố).
    const colonIndex = afterPrefix.lastIndexOf(':')
    const routePath = colonIndex >= 0 ? afterPrefix.slice(0, colonIndex) : afterPrefix
    // Danh sách `/media` thì routePath chính là `/media`; trang chi tiết là
    // `/media/<shortId>`. So sánh chính xác để không bắt nhầm `/media-abc`.
    if (routePath === '/media') result.push(key)
  }
  return result
}

/**
 * Xoá bộ đệm SWR của trang danh sách `/media`, ngay lập tức.
 *
 * Gọi **sau khi** dịch vụ đã commit CSDL — purging cache là I/O ngoài DB và
 * không được giữ khoá transaction mở trong lúc	await. Bọc trong `try/catch`
 * rồi nuốt lỗi (chỉ ghi log): một lượt purge hỏng không được làm hỏng lượt
 * xuất bản đã thành công — cache sẽ tự hết hạn sau 60 giây bất cách.
 */
export async function purgeMediaListCache(event: H3Event): Promise<number> {
  const storage = useStorage('cache')
  const allKeys = await storage.getKeys('nitro/routes')
  const mediaKeys = selectMediaCacheKeys(allKeys)
  await Promise.all(mediaKeys.map((key) => storage.removeItem(key)))
  return mediaKeys.length
}
