import type { AdminDoc } from './types'

/**
 * Category: ai — 2 docs about AI panel and security moderation.
 */
export const AI_DOCS: AdminDoc[] = [
  {
    slug: 'ai-panel',
    title: 'AI Panel',
    category: 'ai',
    icon: 'fa-solid fa-brain',
    summary: 'Cấu hình AI provider (API key, model, temperature) cho editorial và chatbot.',
    description: 'AI Panel là trung tâm cấu hình AI cho hệ thống. Admin thêm AI provider (OpenAI, Google Gemini, Anthropic, v.v.) bằng API key. AI dùng cho 2 mục: (1) chatbot AI mode — trả lời người đọc với context từ kho, (2) editorial AI — hỗ trợ soạn bài viết (tóm tắt, đề xuất tags, dịch). API key mã hóa bằng CHATBOT_ENCRYPTION_SECRET (HKDF v1). Mỗi provider có model, temperature, max_tokens riêng.',
    workflow: [
      { title: 'Vào AI Panel', detail: 'Mở /admin/settings và tìm mục AI.', link: '/admin/settings/general' },
      { title: 'Thêm provider', detail: 'Chọn provider (OpenAI/Gemini/Anthropic), nhập API key, chọn model.' },
      { title: 'Cấu hình', detail: 'Đặt temperature, max_tokens theo nhu cầu.' },
      { title: 'Kiểm tra kết nối', detail: 'Bấm "Test" để gửi request thử và kiểm tra API key.' },
      { title: 'Sử dụng', detail: 'Bật AI cho chatbot (cài đặt chatbot) hoặc dùng editorial khi soạn bài.' },
    ],
    mermaid: `flowchart TD
    A[AI Panel] --> B[Thêm provider]
    B --> C[Nhập API key]
    C --> D[Chọn model]
    D --> E[Test kết nối]
    E --> F{OK?}
    F -->|Có| G[Lưu - key mã hóa]
    F -->|Không| H[Báo lỗi]
    G --> I[Dùng cho chatbot/editorial]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,D,E,G process
    class F decision
    class H,I output`,
    links: [
      { label: 'Cài đặt chatbot', href: '/admin/chatbot/settings' },
      { label: 'Soạn bài viết', href: '/admin/content/articles' },
    ],
    aliases: ['ai provider', 'ai config', 'api key ai', 'ai editorial', 'cấu hình ai', 'openai config'],
    keywords: ['ai', 'panel', 'provider', 'api key', 'model', 'temperature', 'editorial', 'openai', 'gemini', 'anthropic'],
    questions: ['Làm sao thêm API key AI?', 'Tại sao AI không hoạt động?', 'AI dùng để làm gì?', 'Làm sao đổi model AI?'],
    screenshot: '/assets/docs/ai-panel.png',
  },
  {
    slug: 'kiem-duyet-an-ninh',
    title: 'Kiểm duyệt an ninh AI',
    category: 'ai',
    icon: 'fa-solid fa-shield-halved',
    summary: 'Bật/tắt AI moderation — lọc nội dung nhạy cảm tự động trước khi xuất bản.',
    description: 'Kiểm duyệt an ninh AI (moderation) dùng AI để tự động quét nội dung bài viết và bình luận trước khi xuất bản. Nếu phát hiện nội dung nhạy cảm (bạo lực, thù ghét, sai lệch), hệ thống đánh dấu cần duyệt thủ công. Admin có thể bật/tắt moderation, cấu hình ngưỡng (threshold), xem log. Giảm tải kiểm duyệt thủ công cho admin.',
    workflow: [
      { title: 'Vào cài đặt moderation', detail: 'Mở /admin/settings và tìm mục moderation.', link: '/admin/settings/general' },
      { title: 'Bật moderation', detail: 'Bật toggle để kích hoạt AI moderation.' },
      { title: 'Cấu hình ngưỡng', detail: 'Đặt threshold — nội dung vượt ngưỡng bị đánh dấu.' },
      { title: 'Xem log', detail: 'Kiểm tra log moderation trong activity logs.' },
      { title: 'Duyệt thủ công', detail: 'Bài/bình luận bị flag cần admin duyệt thủ công.' },
    ],
    mermaid: `flowchart TD
    A[Nội dung mới] --> B{Moderation bật?}
    B -->|Không| C[Xuất bản ngay]
    B -->|Có| D[AI quét nội dung]
    D --> E{Vượt ngưỡng?}
    E -->|Không| F[Xuất bản]
    E -->|Có| G[Flag - cần duyệt]
    G --> H[Admin duyệt thủ công]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,E decision
    class D,G process
    class C,F,H output`,
    links: [
      { label: 'Cài đặt chung', href: '/admin/settings/general' },
      { label: 'Duyệt bình luận', href: '/admin/comments' },
    ],
    aliases: ['ai moderation', 'moderation', 'kiểm duyệt tự động', 'lọc nội dung ai', 'an ninh nội dung'],
    keywords: ['kiem duyet', 'an ninh', 'moderation', 'ai moderation', 'noi dung nhay cam', 'flag', 'threshold'],
    questions: ['Làm sao bật kiểm duyệt AI?', 'Tại sao bài viết bị flag?', 'Moderation là gì?', 'Làm sao tắt moderation?'],
    screenshot: '/assets/docs/kiem-duyet-an-ninh.png',
  },
]
