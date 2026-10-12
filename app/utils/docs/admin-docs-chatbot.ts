import type { AdminDoc } from './types'

/**
 * Category: chatbot — 4 docs about chatbot knowledge, small talk, sessions, settings.
 */
export const CHATBOT_DOCS: AdminDoc[] = [
  {
    slug: 'kho-noi-dung-chatbot',
    title: 'Kho nội dung Chatbot',
    category: 'chatbot',
    icon: 'fa-solid fa-robot',
    summary: 'Quản lý ngân hàng kiến thức nghiệp vụ cho chatbot — thêm, sửa, xuất bản câu hỏi-trả lời.',
    description: 'Kho nội dung chatbot (chatbot_knowledge) là nguồn kiến thức nghiệp vụ cho chatbot. Mỗi entry có câu hỏi chuẩn (canonicalQuestion), câu trả lời đã duyệt (approvedAnswer), chủ đề (topic), và terms (alias/keyword). Chatbot hoạt động ở 2 chế độ: kho-only (chỉ trả từ kho) và AI (dùng LLM + context từ kho). Matching 3 tầng: exact title → alias → keyword (≥4 chars). Có import Excel để thêm hàng loạt.',
    workflow: [
      { title: 'Vào kho nội dung chatbot', detail: 'Mở /admin/chatbot/knowledge', link: '/admin/chatbot/knowledge' },
      { title: 'Tạo entry mới', detail: 'Bấm "Thêm câu hỏi", nhập câu hỏi chuẩn, câu trả lời, chủ đề.' },
      { title: 'Thêm alias & keyword', detail: 'Thêm từ đồng nghĩa (alias) và từ khóa (keyword) để tăng khả năng matching.' },
      { title: 'Xuất bản', detail: 'Đặt trạng thái published để chatbot dùng entry này.' },
      { title: 'Import Excel (tùy chọn)', detail: 'Dùng tính năng import Excel để thêm hàng loạt entry.' },
    ],
    mermaid: `flowchart TD
    A[Kho nội dung] --> B[Tạo entry]
    B --> C[Câu hỏi + Trả lời]
    C --> D[Thêm alias/keyword]
    D --> E[Chọn chủ đề]
    E --> F{Xuất bản?}
    F -->|Có| G[Published: chatbot dùng]
    F -->|Không| H[Draft: ẩn]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,D,E process
    class F decision
    class G,H output`,
    links: [
      { label: 'Kho kiến thức', href: '/admin/chatbot/knowledge' },
      { label: 'Phiên trò chuyện', href: '/admin/chatbot/sessions' },
      { label: 'Cài đặt chatbot', href: '/admin/chatbot/settings' },
    ],
    aliases: ['knowledge bank', 'kho kiến thức', 'chatbot knowledge', 'câu hỏi chatbot', 'training chatbot'],
    keywords: ['kho noi dung', 'knowledge', 'chatbot', 'cau hoi', 'tra loi', 'alias', 'keyword', 'ngan hang kien thuc'],
    questions: ['Làm sao thêm câu hỏi cho chatbot?', 'Làm sao huấn luyện chatbot?', 'Tại sao chatbot không trả lời?', 'Kho kiến thức ở đâu?'],
    screenshot: '/assets/docs/kho-noi-dung-chatbot.png',
  },
  {
    slug: 'phan-tiep-nhoi',
    title: 'Phản tiếp nhỏi (Small Talk)',
    category: 'chatbot',
    icon: 'fa-solid fa-comments',
    summary: 'Quản lý 121 câu giao tiếp thông thường (chào, cảm ơn, tạm biệt) cho chatbot.',
    description: 'Phản tiếp nhỏi (chatbot_small_talk) là kho giao tiếp thông thường — 121 câu chào hỏi, cảm ơn, tạm biệt, xin lỗi. Khi người dùng gửi tin nhắn không phải câu hỏi nghiệp vụ, chatbot khớp với small talk trước. Mỗi entry có câu hỏi và câu trả lời, matching thuần 3 tầng giống kho kiến thức. Import Excel để thêm hàng loạt.',
    workflow: [
      { title: 'Vào small talk', detail: 'Mở /admin/chatbot/small-talk', link: '/admin/chatbot/small-talk' },
      { title: 'Tạo entry', detail: 'Bấm "Thêm", nhập câu chào và câu trả lời.' },
      { title: 'Xuất bản', detail: 'Đặt trạng thái published.' },
      { title: 'Import Excel', detail: 'Dùng import Excel để thêm hàng loạt.' },
    ],
    mermaid: `flowchart LR
    A[Small Talk] --> B[Tạo entry]
    B --> C[Câu chào + Trả lời]
    C --> D[Xuất bản]
    D --> E[Chatbot khớp giao tiếp]
    E --> F[Trả lời tự nhiên]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,D,E process
    class F output`,
    links: [
      { label: 'Small Talk', href: '/admin/chatbot/small-talk' },
      { label: 'Kho kiến thức', href: '/admin/chatbot/knowledge' },
    ],
    aliases: ['small talk', 'giao tiếp chatbot', 'chào hỏi chatbot', 'thinh thoai'],
    keywords: ['small talk', 'phan tiep nhoi', 'giao tiep', 'chao hoi', 'thinh thoai'],
    questions: ['Làm sao thêm câu chào cho chatbot?', 'Small talk là gì?', 'Tại sao chatbot trả lời câu chào?'],
    screenshot: '/assets/docs/phan-tiep-nhoi.png',
  },
  {
    slug: 'phien-tro-chuyen',
    title: 'Phiên trò chuyện',
    category: 'chatbot',
    icon: 'fa-solid fa-message',
    summary: 'Xem lại lịch sử phiên trò chuyện giữa người dùng và chatbot.',
    description: 'Phiên trò chuyện (chatbot sessions) lưu lịch sử từng cuộc trò chuyện giữa người dùng và chatbot. Admin có thể xem lại từng phiên, theo dõi câu hỏi-trả lời, đánh giá chất lượng. Phiên lưu trong DB (chatbot_sessions + chatbot_messages). Hỗ trợ context đa lượt — chatbot nhớ ngữ cảnh trong cùng phiên.',
    workflow: [
      { title: 'Vào phiên trò chuyện', detail: 'Mở /admin/chatbot/sessions', link: '/admin/chatbot/sessions' },
      { title: 'Chọn phiên', detail: 'Bấm vào một phiên để xem chi tiết tin nhắn.' },
      { title: 'Đánh giá', detail: 'Xem câu hỏi và câu trả lời để đánh giá chất lượng chatbot.' },
    ],
    mermaid: `flowchart LR
    A[Danh sách phiên] --> B[Chọn phiên]
    B --> C[Xem tin nhắn]
    C --> D[Đánh giá chất lượng]
    D --> E[Cải thiện kho nội dung]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,D process
    class E output`,
    links: [
      { label: 'Phiên trò chuyện', href: '/admin/chatbot/sessions' },
      { label: 'Kho kiến thức', href: '/admin/chatbot/knowledge' },
    ],
    aliases: ['chatbot sessions', 'lịch sử chat', 'chatlog', 'phiên chat'],
    keywords: ['phien', 'session', 'tro chuyen', 'lich su', 'chat log', 'tin nhan'],
    questions: ['Tại sao chatbot không nhớ câu trước?', 'Lịch sử chat ở đâu?', 'Làm sao xem lại cuộc trò chuyện?'],
    screenshot: '/assets/docs/phien-tro-chuyen.png',
  },
  {
    slug: 'cai-dat-chatbot',
    title: 'Cài đặt Chatbot',
    category: 'chatbot',
    icon: 'fa-solid fa-sliders',
    summary: 'Cấu hình chế độ chatbot (kho-only / AI), API key AI, prompt hệ thống.',
    description: 'Cài đặt chatbot cho phép chọn chế độ hoạt động: kho-only (chỉ trả từ kho kiến thức, không gọi AI) hoặc AI (dùng LLM với context từ kho). Cấu hình API key cho AI provider, prompt hệ thống (system prompt), nhiệt độ (temperature), context đa lượt. API key được mã hóa bằng CHATBOT_ENCRYPTION_SECRET (HKDF v1). Có thể bật/tắt quick-question và typewriter.',
    workflow: [
      { title: 'Vào cài đặt chatbot', detail: 'Mở /admin/chatbot/settings', link: '/admin/chatbot/settings' },
      { title: 'Chọn chế độ', detail: 'Kho-only (an toàn, không tốn tiền API) hoặc AI (linh hoạt hơn).' },
      { title: 'Cấu hình AI (nếu bật)', detail: 'Nhập API key, chọn model, đặt system prompt, temperature.' },
      { title: 'Bật/tắt tính năng', detail: 'Quick-question, typewriter effect, rate limit.' },
      { title: 'Lưu', detail: 'Bấm "Lưu cài đặt". API key được mã hóa trước khi lưu DB.' },
    ],
    mermaid: `flowchart TD
    A[Cài đặt chatbot] --> B{Chế độ?}
    B -->|Kho-only| C[Trả từ kho kiến thức]
    B -->|AI| D[Gọi LLM + context]
    D --> E[API key mã hóa]
    D --> F[System prompt]
    D --> G[Temperature]
    C --> H[Lưu cài đặt]
    D --> H
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B decision
    class C,D,E,F,G process
    class H output`,
    links: [
      { label: 'Cài đặt chatbot', href: '/admin/chatbot/settings' },
      { label: 'Kho kiến thức', href: '/admin/chatbot/knowledge' },
    ],
    aliases: ['chatbot settings', 'cấu hình chatbot', 'bật AI chatbot', 'API key chatbot'],
    keywords: ['cai dat', 'chatbot settings', 'che do', 'ai', 'api key', 'prompt', 'kho only', 'typewriter'],
    questions: ['Làm sao bật AI cho chatbot?', 'Cài đặt chatbot ở đâu?', 'Tại sao chatbot không gọi AI?', 'Làm sao đổi API key chatbot?'],
    screenshot: '/assets/docs/cai-dat-chatbot.png',
  },
]
