// Nguồn thật: shared/submission-status.ts (máy chủ import thẳng từ đó). Tệp này chỉ
// giữ đường cũ + auto-import của Nuxt cho phía app. Hai ràng buộc của bản build:
//  - Nuxt để shared/ là external trong bản build SSR (vite-builder `ssrEnvironment`);
//    re-export external đó bằng đường TƯƠNG ĐỐI thì rolldown in ra một đường tương
//    đối hỏng và Nitro build đỏ → dùng alias `~~/shared/…`.
//  - unimport không giải alias khi quét `export *` (mất hết auto-import) → liệt kê tên.
// tests/server-no-app-imports.test.ts canh danh sách này khớp đủ module gốc.
export {
  SUBMISSION_STATUSES,
  DEFAULT_SUBMISSION_STATUS,
  SUBMISSION_STATUS_META,
  isSubmissionStatus,
  allowedTransitions,
  canTransition,
  SUBMISSION_EVENT_TYPES,
  isSubmissionEventType,
  CONTACT_CHANNELS,
  CONTACT_CHANNEL_LABELS,
  isContactChannel,
  SUBMISSION_NOTE_MAX,
} from '~~/shared/submission-status'
export type {
  SubmissionStatus,
  SubmissionStatusMeta,
  SubmissionEventType,
  ContactChannel,
} from '~~/shared/submission-status'
