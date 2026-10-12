import type { AdminDoc } from './types'

/**
 * Category: readers — 3 docs about reader comments, support requests, comment moderation.
 */
export const READERS_DOCS: AdminDoc[] = [
  {
    slug: 'nguoi-doc-binh-luan',
    title: 'Người đọc & Bình luận',
    category: 'readers',
    icon: 'fa-solid fa-users',
    summary: 'Quản lý người đọc (reader) và hệ thống bình luận văn bản thuần 1 cấp.',
    description: 'Người đọc (reader) đăng nhập qua Google OAuth để bình luận bài viết. Hệ thống bình luận là văn bản thuần (plain text), 1 cấp (không có threading). comments_enabled mặc định TẮT — admin phải bật cho từng bài viết. Người đọc có thể đổi tên hiển thị (custom_display_name), avatar tại chỗ, lịch sử đọc (localStorage). Thông báo email khi có bình luận mới.',
    workflow: [
      { title: 'Quản lý người đọc', detail: 'Mở /admin/readers để xem danh sách người đọc.', link: '/admin/readers' },
      { title: 'Duyệt bình luận', detail: 'Mở /admin/comments để duyệt/xóa bình luận.', link: '/admin/comments' },
      { title: 'Bật bình luận cho bài viết', detail: 'Khi soạn bài, bật comments_enabled để cho phép bình luận.' },
      { title: 'Xem thông báo', detail: 'Người đọc nhận thông báo khi có phản hồi bình luận.' },
    ],
    mermaid: `flowchart TD
    A[Người đọc] --> B[Đăng nhập Google]
    B --> C[Xem bài viết]
    C --> D{comments_enabled?}
    D -->|Có| E[Viết bình luận]
    D -->|Không| F[Không bình luận]
    E --> G[Admin duyệt]
    G --> H{Duyệt?}
    H -->|Có| I[Hiển thị công khai]
    H -->|Không| J[Xóa]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,E,G process
    class D,H decision
    class F,I,J output`,
    links: [
      { label: 'Quản lý người đọc', href: '/admin/readers' },
      { label: 'Duyệt bình luận', href: '/admin/comments' },
    ],
    aliases: ['reader comments', 'bình luận', 'người đọc portal', 'comment reader', 'độc giả'],
    keywords: ['nguoi doc', 'binh luan', 'comment', 'reader', 'doc gia', 'google oauth'],
    questions: ['Làm sao bật bình luận cho bài viết?', 'Tại sao người đọc không bình luận được?', 'Bình luận ở đâu để duyệt?'],
    screenshot: '/assets/docs/nguoi-doc-binh-luan.png',
  },
  {
    slug: 'don-dang-ky-ho-tro',
    title: 'Đơn đăng ký hỗ trợ',
    category: 'readers',
    icon: 'fa-solid fa-file-signature',
    summary: 'Quản lý đơn đăng ký hỗ trợ tái hòa nhập từ người đọc — 5 trạng thái, 4 lớp email.',
    description: 'Đơn đăng ký hỗ trợ (submissions) là biểu mẫu người đọc gửi để yêu cầu hỗ trợ tái hòa nhập. Mỗi đơn có 5 trạng thái (submission_status): mới, đang xử lý, cần bổ sung, đã hoàn thành, từ chối. Mỗi thay đổi trạng thái ghi sự kiện (submission_events) và gửi email thông báo (4 lớp email khác nhau theo trạng thái). Admin xem, lọc, thay đổi trạng thái đơn.',
    workflow: [
      { title: 'Vào danh sách đơn', detail: 'Mở /admin/submissions', link: '/admin/submissions' },
      { title: 'Xem chi tiết đơn', detail: 'Bấm vào đơn để xem thông tin người đăng ký và lý lịch.' },
      { title: 'Thay đổi trạng thái', detail: 'Chuyển trạng thái: mới → đang xử lý → đã hoàn thành / từ chối.' },
      { title: 'Bổ sung thông tin', detail: 'Nếu cần thêm, chuyển sang "cần bổ sung" — email tự gửi yêu cầu bổ sung.' },
      { title: 'Hoàn thành', detail: 'Chuyển "đã hoàn thành" — email thông báo kết quả.' },
    ],
    mermaid: `flowchart LR
    A[Người đọc gửi đơn] --> B[Trạng thái: Mới]
    B --> C[Đang xử lý]
    C --> D{Kết quả?}
    D -->|Cần thêm| E[Cần bổ sung + Email]
    E --> C
    D -->|Thành công| F[Đã hoàn thành + Email]
    D -->|Từ chối| G[Từ chối + Email]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,E process
    class D decision
    class F,G output`,
    links: [
      { label: 'Danh sách đơn', href: '/admin/submissions' },
    ],
    aliases: ['submissions', 'đơn hỗ trợ', 'đăng ký hỗ trợ', 'form tái hòa nhập', 'hồ sơ hỗ trợ'],
    keywords: ['don dang ky', 'submission', 'ho tro', 'tai hoa nhap', 'don', 'dang ky'],
    questions: ['Làm sao xử lý đơn đăng ký?', 'Tại sao người đọc không nhận email?', 'Đơn đăng ký ở đâu?'],
    screenshot: '/assets/docs/don-dang-ky-ho-tro.png',
  },
  {
    slug: 'kiem-duyet-binh-luan',
    title: 'Kiểm duyệt bình luận',
    category: 'readers',
    icon: 'fa-solid fa-clipboard-check',
    summary: 'Duyệt, ẩn, xóa bình luận người đọc — kiểm soát nội dung công khai.',
    description: 'Kiểm duyệt bình luận cho phép admin xem tất cả bình luận, duyệt để hiển thị, ẩn hoặc xóa. Bình luận vi phạm có thể bị ẩn mà không xóa (giữ audit trail). RBAC: admin cần quyền comments.read để xem, comments.write để duyệt/xóa. readers và comments mặc định không cấp cho vai trò mới — phải cấp thủ công.',
    workflow: [
      { title: 'Vào duyệt bình luận', detail: 'Mở /admin/comments', link: '/admin/comments' },
      { title: 'Lọc bình luận', detail: 'Lọc theo trạng thái (chờ duyệt / đã duyệt / đã ẩn), theo bài viết.' },
      { title: 'Duyệt bình luận', detail: 'Bấm "Duyệt" để hiển thị công khai.' },
      { title: 'Ẩn bình luận vi phạm', detail: 'Bấm "Ẩn" để ẩn không xóa — giữ audit trail.' },
      { title: 'Xóa bình luận', detail: 'Bấm "Xóa" để xóa vĩnh viễn. Cần xác nhận.' },
    ],
    mermaid: `flowchart LR
    A[Bình luận mới] --> B[Chờ duyệt]
    B --> C{Admin}
    C -->|Duyệt| D[Hiển thị công khai]
    C -->|Ẩn| E[Đã ẩn - audit trail]
    C -->|Xóa| F[Đã xóa vĩnh viễn]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B process
    class C decision
    class D,E,F output`,
    links: [
      { label: 'Duyệt bình luận', href: '/admin/comments' },
      { label: 'Quản lý người đọc', href: '/admin/readers' },
    ],
    aliases: ['comment moderation', 'duyệt bình luận', 'ẩn bình luận', 'kiểm duyệt comment', 'quản lý bình luận'],
    keywords: ['kiem duyet', 'moderation', 'duyet binh luan', 'an binh luan', 'xoa binh luan'],
    questions: ['Làm sao duyệt bình luận?', 'Tại sao bình luận không hiển thị?', 'Làm sao ẩn bình luận vi phạm?'],
    screenshot: '/assets/docs/kiem-duyet-binh-luan.png',
  },
]
