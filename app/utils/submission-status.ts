/**
 * Vòng đời một đơn đăng ký hỗ trợ.
 *
 * Đây là **nguồn chân lý duy nhất** cho cả phép kiểm phía máy chủ và nhãn hiển
 * thị trên trang quản trị, đúng lối `app/utils/blocks/registry.ts` đã đi (server
 * import được từ `app/utils` — xem `server/utils/page-versions.ts`). Khai hai bản
 * là để một trạng thái lưu được rồi không có nhãn nào, hoặc một nhãn hiện ra cho
 * một giá trị máy chủ sẽ từ chối — cả hai đều trông như dữ liệu bị hỏng.
 *
 * Module này cố ý **không import gì**, nên nó kiểm được không cần Vue, không cần
 * MySQL, không cần mount trang nào.
 */

export const SUBMISSION_STATUSES = ['new', 'in_progress', 'transferred', 'resolved', 'rejected'] as const

export type SubmissionStatus = typeof SUBMISSION_STATUSES[number]

export const DEFAULT_SUBMISSION_STATUS: SubmissionStatus = 'new'

export interface SubmissionStatusMeta {
  /** Nhãn cán bộ đọc. Tiếng Việt — đây là chữ hiện trên màn hình. */
  label: string
  /** Một câu nói rõ trạng thái này NGHĨA LÀ GÌ về mặt nghiệp vụ. */
  description: string
  /** Lớp Tailwind cho huy hiệu. Viết thẳng thành chữ, không nội suy. */
  badgeClass: string
  icon: string
  /** True khi hồ sơ coi như đã xong việc — dùng để đếm ô tổng. */
  closed: boolean
}

/**
 * `Record<SubmissionStatus, …>` chứ không phải `Record<string, …>`: thêm một
 * trạng thái vào mảng trên mà quên khai ở đây là **lỗi biên dịch**, không phải
 * một huy hiệu trắng trơn phát hiện ra sáu tuần sau.
 */
export const SUBMISSION_STATUS_META: Record<SubmissionStatus, SubmissionStatusMeta> = {
  new: {
    label: 'Mới tiếp nhận',
    description: 'Đơn vừa gửi đến, chưa có cán bộ nào xử lý.',
    badgeClass: 'bg-[#fdf3e2] text-[#8a5a12] border-[#f0d9a8]',
    icon: 'fa-solid fa-inbox',
    closed: false,
  },
  in_progress: {
    label: 'Đang xử lý',
    description: 'Cán bộ đã tiếp nhận và đang làm việc với hồ sơ này.',
    badgeClass: 'bg-[#e6f0fb] text-[#1c4f86] border-[#b9d5f0]',
    icon: 'fa-solid fa-spinner',
    closed: false,
  },
  transferred: {
    label: 'Đã chuyển cơ sở',
    description: 'Đã chuyển giao cho Công an xã/phường hoặc ban ngành tại địa bàn.',
    badgeClass: 'bg-[#efe8fb] text-[#5b3a9e] border-[#d6c7f0]',
    icon: 'fa-solid fa-share-from-square',
    closed: false,
  },
  resolved: {
    label: 'Đã xử lý xong',
    description: 'Yêu cầu của người dân đã được giải quyết.',
    badgeClass: 'bg-[#e6f5e8] text-[#22662b] border-[#b6dfbc]',
    icon: 'fa-solid fa-circle-check',
    closed: true,
  },
  rejected: {
    label: 'Không tiếp nhận',
    description: 'Đơn trùng lặp, sai đối tượng, hoặc không đủ thông tin để xử lý.',
    badgeClass: 'bg-[#f7e8e8] text-[#8c2f2b] border-[#e8c3c1]',
    icon: 'fa-solid fa-circle-xmark',
    closed: true,
  },
}

export function isSubmissionStatus(value: unknown): value is SubmissionStatus {
  return typeof value === 'string' && (SUBMISSION_STATUSES as readonly string[]).includes(value)
}

/**
 * Trạng thái cán bộ được phép chuyển sang, tính từ trạng thái hiện tại.
 *
 * `new` **không** nằm trong đích đến của bất kỳ trạng thái nào: một đơn đã được
 * nhìn tới thì không "chưa tiếp nhận" lại được, và cho phép quay về sẽ xoá đúng
 * dấu vết mà cột `first_viewed_by` tồn tại để giữ.
 *
 * Mọi trạng thái khác thì đến được lẫn nhau — kể cả từ `resolved` và `rejected`.
 * Một hồ sơ đóng sai phải mở lại được; khoá nó lại là buộc cán bộ tạo một đơn
 * thứ hai cho cùng một người dân, và lúc đó lịch sử của người đó nằm ở hai chỗ.
 */
export function allowedTransitions(from: SubmissionStatus): SubmissionStatus[] {
  return SUBMISSION_STATUSES.filter((to) => to !== from && to !== DEFAULT_SUBMISSION_STATUS)
}

export function canTransition(from: SubmissionStatus, to: SubmissionStatus): boolean {
  return allowedTransitions(from).includes(to)
}

// ─── Nhật ký xử lý ───────────────────────────────────────────────────────────

/**
 * `contact` tách khỏi `note` vì đó là hai câu hỏi khác nhau: "cán bộ ghi chú gì"
 * và "đã liên hệ người dân chưa, bằng cách nào". Gộp lại thì câu thứ hai chỉ trả
 * lời được bằng cách đọc hết lời văn của mọi ghi chú.
 */
export const SUBMISSION_EVENT_TYPES = ['view', 'status', 'note', 'contact'] as const
export type SubmissionEventType = typeof SUBMISSION_EVENT_TYPES[number]

export function isSubmissionEventType(value: unknown): value is SubmissionEventType {
  return typeof value === 'string' && (SUBMISSION_EVENT_TYPES as readonly string[]).includes(value)
}

export const CONTACT_CHANNELS = ['phone', 'email', 'in_person', 'other'] as const
export type ContactChannel = typeof CONTACT_CHANNELS[number]

export const CONTACT_CHANNEL_LABELS: Record<ContactChannel, string> = {
  phone: 'Gọi điện thoại',
  email: 'Gửi email',
  in_person: 'Gặp trực tiếp',
  other: 'Cách khác',
}

export function isContactChannel(value: unknown): value is ContactChannel {
  return typeof value === 'string' && (CONTACT_CHANNELS as readonly string[]).includes(value)
}

/** Giới hạn độ dài ghi chú. Máy chủ **từ chối** khi vượt, không cắt ngầm. */
export const SUBMISSION_NOTE_MAX = 2000
