/**
 * `useLiveChat` — composable duy nhất cho phòng chat trực tiếp.
 *
 * Ba đường giao diện với máy chủ, và mỗi đường đóng một câu hỏi riêng:
 *
 *   1. `EventSource` tới `/api/public/livestream/chat/stream` — đường "đang nghe".
 *      Nó trả sự kiện `ready` / `message` / `removal` / `ended` / `shutdown`.
 *   2. `POST /api/public/livestream/chat/send` với `{ content, sessionId }` — đường "gửi".
 *      Trả `{ ok, id }` (201) hoặc từ chối (400/401/409/429).
 *   3. `GET /api/public/livestream/chat/history?limit=50` — đường "đọc lại quá khứ".
 *      Gọi một lần lúc khoả phòng, để đắp tin đã có trước khi dòng tin bắt đầu chảy.
 *
 * ## Trạng thái sống qua `onUnmounted`
 *
 * `EventSource` mở socket, và một socket không đóng khi component rời DOM là một
 * lỗ rỉ tài nguyên trên trình duyệt: mỗi lượt mở trang thêm một kết nối treo.
 * `useLiveChat` tự đóng nguồn khi `disconnect()` được gọi (thường từ
 * `onUnmounted` ở component gọi).
 *
 * ## Tin nhắn là văn bản thuần, không bao giờ `v-html`
 *
 * `ChatMessage.content` đã qua `validateChatContent` ở máy chủ (kiểm ký tự điều
 * khiển, trần độ dài). Component hiển thị bằng `{{ message.content }}` + Tailwind
 * `whitespace-pre-line break-words`. Không có nhánh nào nội suy HTML.
 */

import { ref, type Ref } from 'vue'

export interface LiveChatMessage {
  id: number
  displayName: string
  content: string
  createdAt: string
}

export type ChatConnectionState = 'connecting' | 'open' | 'closed' | 'error'

// Đường stream công khai — không cần auth
const STREAM_URL = '/api/public/livestream/chat/stream'
const SEND_URL    = '/api/public/livestream/chat/send'
const HISTORY_URL = '/api/public/livestream/chat/history'

// Hằng số sao chép từ `server/services/livestream-chat.ts`. Cố ý không nhập từ
// server (không đáng tin — modules máy chủ không reachable từ bundle trình duyệt):
// đây là ranh giới, và thay đổi một bên mà quên bên kia phải thành một test đỏ, không
// phải một build xanh giả.
const MAX_MESSAGE_LENGTH = 200

export function useLiveChat() {
  const messages: Ref<LiveChatMessage[]> = ref([])
  const connection = ref<ChatConnectionState>('closed')
  const sessionId  = ref<number | null>(null)
  const sessionTitle = ref('')
  const liveError = ref<string>('')

  let eventSource: EventSource | null = null
  let connectionAttempt = 0

  // Kéo 50 tin gần nhất — đúng `CHAT_HISTORY_DEFAULT` của máy chủ, không tự đặt.
  const HISTORY_LIMIT = 50

  const connect = async () => {
    disconnect()
    const attempt = ++connectionAttempt
    messages.value = []
    const readySessionId = await openStream(attempt)
    if (!readySessionId || attempt !== connectionAttempt) return

    // Subscribe first, then read history.  Frames arriving while GET is in
    // flight stay buffered in `messages`; merge-by-id closes the old history →
    // stream race instead of creating a gap or duplicate message.
    try {
      const history = await $fetch<{ ok: boolean, sessionId: number | null, messages: LiveChatMessage[] }>(HISTORY_URL, {
        params: { limit: HISTORY_LIMIT },
      })
      if (attempt !== connectionAttempt) return
      if (!history.ok || history.sessionId !== readySessionId) {
        disconnect()
        liveError.value = 'Buổi phát đã thay đổi. Vui lòng tải lại trang.'
        return
      }
      mergeMessages(history.messages)
    } catch {
      // Lịch sử hỏng không phải là chặn: stream vẫn có thể chở tin mới, và một
      // lịch sử trống đọc ra là "chưa có người nói gì" — đúng thứ người xem muốn
      // thấy trong giây đầu, không phải một cảnh báo đỏ.
      // The stream remains useful even when a history request fails.
    }
  }

  const mergeMessages = (incoming: LiveChatMessage[]) => {
    const merged = new Map<number, LiveChatMessage>()
    for (const message of [...messages.value, ...incoming]) merged.set(message.id, message)
    messages.value = [...merged.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
      .slice(-500)
  }

  const openStream = (attempt: number): Promise<number | null> => new Promise((resolve) => {
    // Đóng nguồn cũ nếu còn — `connect()` gọi lại sẽ tạo mới
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
    connection.value = 'connecting'

    const source = new EventSource(STREAM_URL)
    eventSource = source

    source.addEventListener('ready', (ev: MessageEvent) => {
      if (attempt !== connectionAttempt) return
      try {
        const data = JSON.parse(ev.data) as { sessionId: number, title: string }
        sessionId.value = data.sessionId
        sessionTitle.value = data.title
        connection.value = 'open'
        liveError.value = ''
        resolve(data.sessionId)
      } catch {
        connection.value = 'error'
        liveError.value = 'Không hiểu được phản hồi từ máy chủ.'
        resolve(null)
      }
    })

    source.addEventListener('message', (ev: MessageEvent) => {
      if (attempt !== connectionAttempt) return
      try {
        const msg = JSON.parse(ev.data) as LiveChatMessage
        mergeMessages([msg])
      } catch { /* nuốt: một gói hỏng không có tư cách làm sập phòng chat */ }
    })

    source.addEventListener('removal', (ev: MessageEvent) => {
      if (attempt !== connectionAttempt) return
      try {
        const { id } = JSON.parse(ev.data) as { id: number }
        const idx = messages.value.findIndex(m => m.id === id)
        if (idx >= 0) messages.value.splice(idx, 1)
      } catch { /* nuốt */ }
    })

    source.addEventListener('ended', (ev: MessageEvent) => {
      if (attempt !== connectionAttempt) return
      // Buổi phát kết thúc: một sự kiện nghiệp vụ, không phải lỗi. Đóng stream
      // ở phía trình duyệt và để giao diện hiện lời giải thích.
      connection.value = 'closed'
      liveError.value = (typeof ev.data === 'string' && ev.data.trim()) ? ev.data : 'Buổi phát đã kết thúc.'
      if (eventSource) {
        eventSource.close()
        eventSource = null
      }
      resolve(null)
    })

    source.addEventListener('shutdown', (ev: MessageEvent) => {
      if (attempt !== connectionAttempt) return
      // Máy chủ đang tắt: giao diện phải nói rõ "không phải lỗi kết nối, máy
      // chủ đang bảo trì" để người xem không F5 liên tục.
      connection.value = 'closed'
      liveError.value = 'Máy chủ đang khởi động lại. Vui lòng tải lại trang sau giây lát.'
      if (eventSource) {
        eventSource.close()
        eventSource = null
      }
      resolve(null)
    })

    source.onerror = () => {
      if (attempt !== connectionAttempt) return
      // `onerror` không cho biết gì ngoài "đã hỏng": EventSource tự thử kết nối
      // lại, và lượt thử sau có thể thành công. Chỉ đánh dấu lỗi khi nguồn thực
      // sự đóng (`readyState === CLOSED`).
      if (source.readyState === EventSource.CLOSED) {
        connection.value = 'closed'
        liveError.value = 'Mất kết nối với máy chủ. Vui lòng tải lại trang.'
        if (eventSource) {
          eventSource.close()
          eventSource = null
        }
        resolve(null)
      } else {
        connection.value = 'connecting'
      }
    }
  })

  /**
   * Gửi một tin nhắn. Trả kết quả cho component xử lý (hiện cảnh báo nếu cần).
   *
   * Không tự đẩy tin vào mảng `messages`: máy chủ phát lại qua stream nếu tin
   * được lưu, và giao diện đi theo `messages` là giao diện đi theo sự kiện.
   * Đẩy trước ở đây là hiển thị tin trước khi máy chủ xác nhận — và nếu máy chủ
   * từ chối (429), người gửi sẽ thấy tin mình "đã gửi rồi" trong khi thực sự
   * không ai nhận được.
   */
  const sendMessage = async (content: string): Promise<{ ok: true } | { ok: false, reason: string }> => {
    const trimmed = content.trim()
    if (!trimmed) return { ok: false, reason: 'Tin nhắn không được để trống.' }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return { ok: false, reason: `Tin nhắn tối đa ${MAX_MESSAGE_LENGTH} ký tự.` }
    }
    if (connection.value !== 'open') {
      return { ok: false, reason: 'Chưa kết nối được với buổi phát. Vui lòng thử lại.' }
    }

    try {
      const res = await $fetch<{ ok: boolean, id: number }>(SEND_URL, {
        method: 'POST',
        body: { content: trimmed, sessionId: sessionId.value },
      })
      if (!res.ok) return { ok: false, reason: 'Không gửi được tin nhắn.' }
      return { ok: true }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'statusCode' in err) {
        const code = (err as { statusCode: number }).statusCode
        if (code === 401) return { ok: false, reason: 'Vui lòng đăng nhập để gửi tin nhắn.' }
        if (code === 409) return { ok: false, reason: 'Không có buổi phát nào đang chạy.' }
        if (code === 429) return { ok: false, reason: 'Bạn gửi quá nhanh. Vui lòng đợi một chút rồi gửi lại.' }
      }
      return { ok: false, reason: 'Không gửi được tin nhắn. Vui lòng thử lại sau.' }
    }
  }

  const disconnect = () => {
    connectionAttempt++
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
    connection.value = 'closed'
  }

  return {
    messages,
    connection,
    sessionId,
    sessionTitle,
    liveError,
    connect,
    disconnect,
    sendMessage,
  }
}
