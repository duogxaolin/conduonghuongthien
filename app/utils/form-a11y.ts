/**
 * Phần thuần của việc gắn nhãn/lỗi biểu mẫu với điều khiển (id/for, aria-describedby,
 * autocomplete). Tách khỏi component để kiểm được không cần mount.
 *
 * `uid` là `useId()` của component (duy nhất theo thể hiện, ổn định giữa SSR và
 * hydrate) — KHÔNG dùng `field.id`: nó do cán bộ cấu hình (có thể chứa khoảng trắng,
 * có thể trùng khi cùng một block xuất hiện hai lần trên trang).
 */

/** id của điều khiển thứ `index` trong biểu mẫu thể hiện `uid`. */
export function controlId(uid: string, index: number | string): string {
  return `${uid}-f${index}`
}

/** id của phần tử báo lỗi cho điều khiển đó (đích của `aria-describedby`). */
export function errorId(uid: string, index: number | string): string {
  return `${controlId(uid, index)}-err`
}

/**
 * id cho ô nhập của biểu mẫu để-lại-liên-hệ trong khung chat. Biểu mẫu này lặp lại
 * theo từng tin nhắn (`messageKey` = `msg.id`, lùi về chỉ số), nên id phải gồm cả
 * khoá tin nhắn; ký tự lạ được thay để id luôn hợp lệ cho `for`/`aria-describedby`.
 */
export function leadFieldId(uid: string, messageKey: string | number, field: 'name' | 'phone' | 'email' | 'question' | 'error'): string {
  return `${uid}-lead-${String(messageKey).replace(/[^A-Za-z0-9_-]/g, '_')}-${field}`
}

/**
 * Lỗi "cần số điện thoại hoặc email" là lỗi của CẢ HAI ô liên hệ (chỉ cần một trong
 * hai). Lỗi từ máy chủ khi gửi (đã có phone/email) không phải lỗi của ô nào, nên
 * không đánh dấu `aria-invalid` — chỉ báo qua `role="alert"`.
 */
export function leadContactInvalid(lead: { error?: string; phone?: string; email?: string } | null | undefined): boolean {
  if (!lead || !lead.error) return false
  return !(lead.phone ?? '').trim() && !(lead.email ?? '').trim()
}

export interface FieldValidationMessages {
  required: string
  email: string
  phone: string
  number: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[0-9+()\-\s.]{7,20}$/
const NUMBER_RE = /^-?\d+(\.\d+)?$/

/**
 * Lỗi của MỘT trường biểu mẫu liên hệ (`''` = hợp lệ). Dùng chung cho lượt gửi và
 * cho lượt kiểm lại từng trường khi người dùng sửa (`@input`/`@blur`): trước đây lỗi
 * chỉ được tính lại lúc bấm gửi, nên `aria-invalid="true"` và dòng lỗi đỏ còn bám
 * trên một ô đã sửa đúng.
 */
export function validateFormField(
  field: { type: string; required: boolean },
  rawValue: unknown,
  messages: FieldValidationMessages,
): string {
  const value = String(rawValue ?? '').trim()
  if (!value) return field.required ? messages.required : ''
  if (field.type === 'email' && !EMAIL_RE.test(value)) return messages.email
  if (field.type === 'tel' && !PHONE_RE.test(value)) return messages.phone
  if (field.type === 'number' && !NUMBER_RE.test(value)) return messages.number
  return ''
}

/**
 * Giá trị `autocomplete` (WCAG 1.3.5) theo ánh xạ trường (`map`) mà cán bộ chọn,
 * lùi về kiểu ô nhập. `address` cố ý KHÔNG có giá trị: cùng một `map` được dùng cho
 * cả "Tỉnh / Thành phố" lẫn địa chỉ đầy đủ, đoán sai còn tệ hơn để trống.
 */
export function autocompleteFor(map: string | undefined, type: string | undefined): string | undefined {
  if (map === 'name') return 'name'
  if (map === 'phone') return 'tel'
  if (map === 'email') return 'email'
  if (type === 'tel') return 'tel'
  if (type === 'email') return 'email'
  return undefined
}
