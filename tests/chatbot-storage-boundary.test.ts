/**
 * `localStorage` của chatbot là BIÊN TIN CẬY, không phải bộ nhớ đệm của mình.
 *
 * Mọi thứ tệp này kiểm đều đọc từ `localStorage` — tức là khách **sửa được bằng
 * devtools**, và một bản build cũ có thể đã ghi một hình dạng khác. Trước đây
 * khối này nằm trong `useChatbot.ts` cùng state cấp module và các lời gọi
 * `$fetch`, nên không kiểm được mà không nạp cả composable.
 *
 * Điều đáng ghim nhất là `safeHttpsUrl`: giá trị nó trả về đi thẳng vào `:href`
 * trên trang công khai. Nới phép kiểm đó là để `javascript:` chạy được từ một
 * giá trị khách tự ghi — nhỏ hơn XSS lưu trữ, nhưng đúng loại lỗ mà một lần
 * refactor "cho gọn" tạo ra, và nó **không có triệu chứng nào** cho tới lúc bị
 * dùng.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  CHATBOT_CLIENT_LIMITS,
  knowledgeEntryId,
  normalizeConversation,
  normalizeSource,
  normalizeStoredMessage,
  safeHttpsUrl,
} from '../app/utils/chatbot-storage.ts'

/** Thay `crypto.randomUUID` / `Date.now` để hàm chạy được ngoài trình duyệt. */
const newId = () => 'fixed-id'
const now = () => 1_767_225_600_000 // 2026-01-01T00:00:00Z

describe('safeHttpsUrl', () => {
  it('nhận https', () => {
    assert.equal(safeHttpsUrl('https://thuvienphapluat.vn/a'), 'https://thuvienphapluat.vn/a')
  })

  /**
   * Từng giao thức một, để khi test đỏ thì thông báo chỉ thẳng vào cái đã lọt.
   * `javascript:` là cái nguy hiểm; `http:` là cái làm rò rỉ nội dung qua mạng
   * không mã hoá trên một cổng của cơ quan nhà nước.
   */
  const MUST_BE_REJECTED = [
    ['javascript', 'javascript:alert(1)'],
    ['javascript có khoảng trắng đầu', '  javascript:alert(1)'],
    ['javascript viết hoa', 'JavaScript:alert(1)'],
    ['data', 'data:text/html,<script>alert(1)</script>'],
    ['http trần', 'http://example.com'],
    ['file', 'file:///etc/passwd'],
    ['vbscript', 'vbscript:msgbox(1)'],
    ['chuỗi không phải URL', 'không phải url'],
  ]

  for (const [label, value] of MUST_BE_REJECTED) {
    it(`từ chối ${label}`, () => {
      assert.equal(safeHttpsUrl(value), null, `${label} lọt vào :href trên trang công khai`)
    })
  }

  /**
   * `https:evil` KHÔNG bị từ chối, và đó là đúng: `new URL()` chuẩn hoá nó thành
   * `https://evil/` — một host hợp lệ. Ghi lại ở đây vì nó trông như một lỗ:
   * `new URL()` chấp nhận cú pháp mà người viết không định viết. Phép kiểm này
   * bảo đảm **giao thức**, không bảo đảm rằng host là nơi ai đó muốn tới; điều
   * sau là việc của nội dung đã duyệt trong kho kiến thức, nơi các url này sinh
   * ra. Giá trị trả về là dạng đã chuẩn hoá, nên `:href` không bao giờ nhận
   * chuỗi thô của khách.
   */
  it('chuẩn hoá cú pháp lỏng thành https tường minh', () => {
    assert.equal(safeHttpsUrl('https:evil'), 'https://evil/')
  })

  it('từ chối mọi thứ không phải chuỗi', () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      assert.equal(safeHttpsUrl(value), null)
    }
  })
})

describe('knowledgeEntryId', () => {
  /**
   * Đọc `entryId` trước `id`: lượt trả lời mới mang id hàng ở `id`, nhưng sau
   * một vòng qua `normalizeSource` thì `id` đã bị gộp thành khoá render tổ hợp
   * (`"12-Nhãn-Điều 5"`), và id thật nằm ở `entryId`. Đọc `id` trước là lấy một
   * chuỗi không phải số cho một liên kết tới `/qa-documents#qa-<id>`.
   */
  it('ưu tiên entryId khi id đã thành khoá render', () => {
    assert.equal(knowledgeEntryId({ id: '12-Nhãn-Điều 5', entryId: 12 }), 12)
  })

  it('đọc id khi payload còn mới', () => {
    assert.equal(knowledgeEntryId({ id: 7 }), 7)
  })

  it('từ chối số không dùng được', () => {
    for (const raw of [{ id: 0 }, { id: -3 }, { id: 1.5 }, { id: 'abc' }, {}, { id: null }]) {
      assert.equal(knowledgeEntryId(raw), null)
    }
  })
})

describe('normalizeSource', () => {
  it('cắt nhãn và trích dẫn theo đúng giới hạn đã khai', () => {
    const source = normalizeSource({
      label: 'x'.repeat(500),
      reference: 'y'.repeat(500),
    }, 0)
    assert.equal(source!.label.length, CHATBOT_CLIENT_LIMITS.maxSourceLabelChars)
    assert.equal(source!.reference.length, CHATBOT_CLIENT_LIMITS.maxSourceReferenceChars)
  })

  it('bỏ url không phải https, giữ phần còn lại của nguồn', () => {
    const source = normalizeSource({ label: 'Nghị định', url: 'javascript:alert(1)' }, 0)
    assert.equal(source!.url, null, 'url độc phải bị bỏ')
    assert.equal(source!.label, 'Nghị định', 'phần còn lại vẫn dùng được')
  })

  it('không nhãn và không trích dẫn thì bỏ cả nguồn', () => {
    assert.equal(normalizeSource({ url: 'https://a.vn' }, 0), null,
      'một nguồn chỉ có url là một liên kết không nói nó dẫn tới đâu')
  })

  it('nhãn rỗng nhưng có trích dẫn thì dùng nhãn mặc định', () => {
    assert.equal(normalizeSource({ reference: 'Điều 5' }, 0)!.label, 'Tài liệu công khai')
  })

  it('từ chối thứ không phải object', () => {
    for (const value of [null, 'text', 42, []]) {
      assert.equal(normalizeSource(value, 0), null)
    }
  })
})

describe('normalizeStoredMessage', () => {
  it('từ chối sender lạ', () => {
    assert.equal(normalizeStoredMessage({ sender: 'admin', text: 'a' }, 0), null,
      'một tin mang nhãn admin do khách tự ghi sẽ hiện như phát ngôn của cổng')
  })

  it('từ chối tin rỗng', () => {
    assert.equal(normalizeStoredMessage({ sender: 'bot', text: '   ' }, 0), null)
    assert.equal(normalizeStoredMessage({ sender: 'user' }, 0), null)
  })

  it('cắt tin người dùng và tin bot theo hai giới hạn khác nhau', () => {
    const user = normalizeStoredMessage({ sender: 'user', text: 'a'.repeat(9999) }, 0)
    const bot = normalizeStoredMessage({ sender: 'bot', text: 'a'.repeat(9999) }, 1)
    assert.equal(user!.text.length, CHATBOT_CLIENT_LIMITS.maxMessageChars)
    assert.equal(bot!.text.length, CHATBOT_CLIENT_LIMITS.maxOutputChars)
  })

  /** `kind` điều khiển nhãn loại trả lời hiện trên bong bóng. */
  it('bỏ kind không nằm trong danh sách đã biết', () => {
    assert.equal(normalizeStoredMessage({ sender: 'bot', text: 'a', kind: 'official' }, 0)!.kind, undefined,
      'một kind tự bịa sẽ vẽ ra một nhãn loại trả lời mà cổng không hề phát')
    assert.equal(normalizeStoredMessage({ sender: 'bot', text: 'a', kind: 'curated' }, 0)!.kind, 'curated')
  })

  it('giới hạn số nguồn mỗi tin', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ label: `Nguồn ${i}` }))
    const message = normalizeStoredMessage({ sender: 'bot', text: 'a', sources: many }, 0)
    assert.equal(message!.sources!.length, CHATBOT_CLIENT_LIMITS.maxSources)
  })

  it('tin người dùng không mang nguồn', () => {
    const message = normalizeStoredMessage({ sender: 'user', text: 'a', sources: [{ label: 'x' }] }, 0)
    assert.equal(message!.sources, undefined,
      'nguồn trên một tin do khách gõ là nguồn khách tự gán cho chính mình')
  })
})

describe('normalizeConversation', () => {
  it('luôn mở đầu bằng đúng một tin chào của cổng', () => {
    const conv = normalizeConversation({
      messages: [
        { id: 'welcome', sender: 'bot', text: 'Lời chào giả do khách tự ghi' },
        { sender: 'user', text: 'xin chào' },
      ],
    }, newId, now)
    const welcomes = conv!.messages.filter(m => m.id === 'welcome')
    assert.equal(welcomes.length, 1)
    assert.match(welcomes[0]!.text, /Trợ lý ảo Hướng Thiện/,
      'tin chào phải là bản của cổng, không phải bản khách ghi vào localStorage')
  })

  it('cắt lịch sử theo giới hạn số tin', () => {
    const messages = Array.from({ length: 200 }, (_, i) => ({ sender: 'user', text: `tin ${i}` }))
    const conv = normalizeConversation({ messages }, newId, now)
    // +1 cho tin chào của cổng.
    assert.equal(conv!.messages.length, CHATBOT_CLIENT_LIMITS.maxHistoryMessages * 2 + 1)
  })

  it('giữ tin cuối, không giữ tin đầu', () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({ sender: 'user', text: `tin ${i}` }))
    const conv = normalizeConversation({ messages }, newId, now)
    const texts = conv!.messages.map(m => m.text)
    assert.ok(texts.includes('tin 99'), 'phần mới nhất của cuộc trò chuyện phải còn')
    assert.ok(!texts.includes('tin 0'), 'phần cũ nhất là phần bị cắt')
  })

  it('cắt tiêu đề và dùng mặc định khi rỗng', () => {
    assert.equal(normalizeConversation({ title: '   ' }, newId, now)!.title, 'Cuộc trò chuyện mới')
    assert.equal(
      normalizeConversation({ title: 'x'.repeat(200) }, newId, now)!.title.length,
      CHATBOT_CLIENT_LIMITS.maxTitleChars,
    )
  })

  it('sinh id mới khi id lưu không dùng được', () => {
    assert.equal(normalizeConversation({ id: 42 }, newId, now)!.id, 'fixed-id')
    assert.equal(normalizeConversation({ id: 'abc' }, newId, now)!.id, 'abc')
  })

  /**
   * `token` là vé HMAC do máy chủ cấp. Một giá trị không phải chuỗi phải thành
   * `null` để lượt gửi kế tiếp đi xin vé mới, chứ không gửi rác lên rồi bị từ
   * chối mà không có đường phục hồi.
   */
  it('token không phải chuỗi thì thành null', () => {
    assert.equal(normalizeConversation({ token: 12345 }, newId, now)!.token, null)
    assert.equal(normalizeConversation({ token: '' }, newId, now)!.token, null)
    assert.equal(normalizeConversation({ token: 'uuid.hmac' }, newId, now)!.token, 'uuid.hmac')
  })

  it('createdAt không hợp lệ thì lấy mốc hiện tại', () => {
    assert.equal(normalizeConversation({ createdAt: 'hôm qua' }, newId, now)!.createdAt, now())
    assert.equal(normalizeConversation({ createdAt: Number.NaN }, newId, now)!.createdAt, now())
    assert.equal(normalizeConversation({ createdAt: 999 }, newId, now)!.createdAt, 999)
  })

  it('từ chối thứ không phải object', () => {
    for (const value of [null, 'text', 42, undefined]) {
      assert.equal(normalizeConversation(value, newId, now), null)
    }
  })

  it('messages không phải mảng thì ra cuộc trò chuyện chỉ có tin chào', () => {
    const conv = normalizeConversation({ messages: 'hỏng' }, newId, now)
    assert.equal(conv!.messages.length, 1)
    assert.equal(conv!.messages[0]!.id, 'welcome')
  })
})
