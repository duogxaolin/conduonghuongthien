/**
 * Kiểm dữ liệu vào cho cổng media — các hàm `require*`/`optional*` thuần, không
 * state, không DB. Tách khỏi `media-portal.ts` để hai đường đọc/ghi chia sẻ cùng
 * một lớp kiểm duyệt, và để một endpoint có thể import riêng phần này mà không
 * kéo theo logic stream/thumbnail.
 *
 * Lỗi dữ liệu vào tách khỏi lỗi hệ thống (`MediaValidationError`) để endpoint
 * trả 400 thay vì 500 — cùng ranh giới `password-policy.ts` dùng ở phía auth.
 */
import {
  MEDIA_ITEM_STATUSES,
  MEDIA_SOURCES,
  MEDIA_TITLE_MAX_LENGTH,
  type MediaItemStatus,
  type MediaSource,
} from './media-portal-constants'

/** Lỗi dữ liệu vào, tách khỏi lỗi hệ thống để endpoint trả 400 thay vì 500. */
export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaValidationError'
  }
}

export function requireMediaTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title) throw new MediaValidationError('Tiêu đề không được để trống.')
  if (title.length > MEDIA_TITLE_MAX_LENGTH) {
    throw new MediaValidationError(`Tiêu đề tối đa ${MEDIA_TITLE_MAX_LENGTH} ký tự.`)
  }
  return title
}

/** Văn bản tuỳ chọn. Quá dài thì **từ chối**, không cắt ngầm — người gõ không có
 *  cách nào biết mình vừa mất đoạn cuối. */
export function optionalMediaText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new MediaValidationError(`${label} không hợp lệ.`)
  const text = value.trim()
  if (!text) return null
  if (text.length > max) throw new MediaValidationError(`${label} tối đa ${max} ký tự.`)
  return text
}

export function requireMediaSource(value: unknown): MediaSource {
  const source = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!(MEDIA_SOURCES as readonly string[]).includes(source)) {
    throw new MediaValidationError(`Nguồn phải là một trong: ${MEDIA_SOURCES.join(', ')}.`)
  }
  return source as MediaSource
}

export function requireMediaStatus(value: unknown): MediaItemStatus {
  const status = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!(MEDIA_ITEM_STATUSES as readonly string[]).includes(status)) {
    throw new MediaValidationError(`Trạng thái phải là một trong: ${MEDIA_ITEM_STATUSES.join(', ')}.`)
  }
  return status as MediaItemStatus
}

/**
 * `Boolean('false')` là `true`.
 *
 * Giá trị này đến từ thân request, nên một chuỗi `"false"` sẽ **bật** đúng cờ mà
 * cán bộ vừa tắt — cùng lớp lỗi đã làm rơi `openNewTab` của cấu hình điều hướng.
 * Chỉ nhận boolean thật, hoặc `1`/`0`.
 */
export function requireMediaBoolean(value: unknown, label: string): boolean {
  if (value === true || value === 1 || value === '1') return true
  if (value === false || value === 0 || value === '0') return false
  throw new MediaValidationError(`${label} phải là true hoặc false.`)
}

export function optionalMediaId(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new MediaValidationError(`${label} không hợp lệ.`)
  return id
}

/**
 * Định danh video của nền tảng ngoài, bắt buộc bóc ra được từ giá trị đã lưu.
 *
 * Đặt ở file validation vì đây là một phép kiểm dữ liệu vào (dùng trong
 * `createMediaItem`/`updateMediaItem`), nhưng nó cần `extractYouTubeVideoId` từ
 * `youtube-parser` — nên nhận import đó trực tiếp, không lạm dụng hằng sốunque.
 */
import { extractYouTubeVideoId } from '../utils/youtube-parser'

export function requireMediaSourceId(value: unknown): string {
  const id = extractYouTubeVideoId(value)
  if (!id) throw new MediaValidationError('Địa chỉ video không hợp lệ hoặc không được hỗ trợ.')
  return id
}
