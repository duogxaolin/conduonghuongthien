import { setResponseHeader, setResponseStatus, type H3Event } from 'h3'
import { logError } from './logger'

/**
 * Một lượt đọc công khai hỏng (CSDL mất kết nối, truy vấn lỗi) phải **là một
 * lỗi** — trong log và trên dây HTTP — chứ không phải một danh sách rỗng hợp lệ.
 *
 * Trước đây chín endpoint dưới `server/api/public/**` bắt lỗi rồi trả
 * `200 { ok: false, articles: [] }` và **không ghi gì**. Hai hậu quả:
 *  - người vận hành không có dấu vết nào: `docker logs` im lặng trong khi trang
 *    chủ trống trơn;
 *  - phần lớn nơi gọi (các khối trang chủ `NewsBlock`/`DocumentsBlock`/…) không
 *    đọc `ok`, nên một lượt hỏng hiện ra y hệt "chưa có bài nào", và trang SSR
 *    mang hình dạng đó được bộ đệm SWR 60 giây giữ lại như một trang hợp lệ.
 *
 * Hàm này làm đúng hai việc: ghi một dòng log `error` với tên sự kiện ổn định
 * (để viết được luật cảnh báo) và đặt mã **503** + `Cache-Control: no-store`.
 * Thân phản hồi **giữ nguyên hình dạng thất bại** mà từng endpoint đã có
 * (`{ ok: false, … }`): vài nơi gọi và vài bài test dựa vào hình dạng đó, và một
 * hình dạng cho mọi nhánh là hợp đồng có chủ đích (xem `pages/[slug].get.ts`).
 * Mã 503 là thứ khiến `$fetch`/`useAsyncData` phía client đi vào nhánh `error`,
 * và khiến bộ đệm Nitro (`validate` từ chối `code >= 400`) cùng CDN không lưu nó.
 *
 * Lỗi kiểm tra đầu vào **không** đi qua đây — chúng vẫn là 4xx tại chỗ.
 *
 * Không ghi dữ liệu của khách vào log. `DrizzleQueryError` mang `params` (chuỗi
 * tìm kiếm, slug…) cả trong thuộc tính lẫn trong `message`/`stack`
 * (`Failed query: …\nparams: %abc%`). `describeReadError` chỉ giữ lớp lỗi, mã lỗi
 * của driver, thông điệp của NGUYÊN NHÂN (lỗi driver — không chứa tham số) và câu
 * SQL đã tham số hoá (`?`), bỏ mọi đuôi `params:`.
 */
export const PUBLIC_READ_FAILURE_STATUS = 503

/** Bỏ đuôi `params: …` mà drizzle gắn vào thông điệp lỗi truy vấn. */
function stripParams(message: string): string {
  return message.replace(/\r?\nparams:[\s\S]*$/, '')
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/**
 * Mô tả một lỗi đọc để ghi log — không mang tham số truy vấn. Tách riêng để kiểm
 * bằng test với đúng lớp `DrizzleQueryError` của thư viện.
 */
export function describeReadError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { name: typeof error, message: stripParams(String(error)) }
  const record = error as Error & { code?: unknown; errno?: unknown; sqlState?: unknown; query?: unknown; params?: unknown }
  const cause = (error as { cause?: unknown }).cause
  const isQueryError = 'params' in record || error.name === 'DrizzleQueryError'
  const source = isQueryError && cause instanceof Error ? cause as Error & { code?: unknown; errno?: unknown; sqlState?: unknown } : record
  // `DrizzleQueryError` không đặt `name` (vẫn là "Error") — tên lớp mới phân biệt được.
  const className = error.constructor?.name
  const out: Record<string, unknown> = {
    name: error.name === 'Error' && className ? className : error.name,
    message: stripParams(source.message),
  }
  const code = readString(source.code) ?? readString(record.code)
  if (code) out.code = code
  if (typeof source.errno === 'number') out.errno = source.errno
  const sqlState = readString(source.sqlState)
  if (sqlState) out.sqlState = sqlState
  if (isQueryError) {
    if (cause instanceof Error) out.causeName = cause.name
    const query = readString(record.query)
    if (query) out.query = query
  }
  return out
}

export function reportPublicReadFailure(
  event: H3Event,
  logEvent: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  logError({ ...context, event: logEvent, error: describeReadError(error) })
  setResponseStatus(event, PUBLIC_READ_FAILURE_STATUS)
  setResponseHeader(event, 'cache-control', 'no-store')
}
