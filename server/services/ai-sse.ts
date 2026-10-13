import { createStreamingCleaner } from './ai-text-cleaner'

/**
 * Đọc một luồng SSE chat-completions của provider: chuyển phần chữ hiển thị được
 * (đã qua bộ làm sạch "suy nghĩ") cho `emit`, gom các mảnh `tool_calls`, và báo
 * `usage`.
 *
 * Đây là vòng lặp từng được chép ở bốn nơi trong `callAi` (bước 1 và bước 2 của
 * vòng gọi công cụ, nhánh "trả lời thẳng", và đường không công cụ). Bốn bản sao
 * khác nhau ở những chi tiết nhỏ, và chính chỗ khác nhau đó là chỗ sinh lỗi: một
 * lần sửa ở bản này mà quên bản kia. Một bản duy nhất thì sửa một chỗ, kiểm một
 * chỗ (`tests/ai-gateway-streaming-sse.test.ts`).
 */

export type ChatSseUsage = {
  promptTokens: number
  completionTokens: number
  /** Provider ước lượng chứ không đo — không cộng vào hoá đơn. */
  estimated: boolean
}

export type ToolCallAccumulator = Record<number, { id: string; type: string; function: { name: string; arguments: string } }>

export type ChatSseHooks = {
  /** Nhận từng mẩu chữ đã làm sạch, đúng thứ tự. */
  emit: (text: string) => void | Promise<void>
  onUsage?: (usage: ChatSseUsage) => void
  /** Có truyền vào thì các mảnh `tool_calls` được ráp vào đây theo `index`. */
  toolCalls?: ToolCallAccumulator
}

export type ChatSseResult = {
  /** Toàn bộ chữ thô provider gửi (chưa làm sạch). */
  streamText: string
  /** Toàn bộ chữ đã gửi qua `emit`, kể cả phần đuôi lúc đóng luồng. */
  relayed: string
  /** Câu trả lời cuối đã làm sạch và cắt khoảng trắng — dự phòng khi `relayed` rỗng. */
  finalText: () => string
}

type ToolCallDelta = { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }

export async function readChatSse(body: ReadableStream<Uint8Array>, hooks: ChatSseHooks): Promise<ChatSseResult> {
  const cleaner = createStreamingCleaner()
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let streamText = ''
  let relayed = ''

  const handleLine = async (line: string): Promise<void> => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:') || trimmed === 'data: [DONE]') return
    // Một dòng hỏng (JSON cụt, `emit` ném lỗi) không được làm hỏng cả câu trả lời.
    try {
      const parsed = JSON.parse(trimmed.slice(5).trim())
      const delta = parsed?.choices?.[0]?.delta

      if (typeof delta?.content === 'string' && delta.content) {
        streamText += delta.content
        const piece = cleaner.push(delta.content)
        if (piece) {
          relayed += piece
          await hooks.emit(piece)
        }
      }

      // OpenAI stream tool call theo từng mảnh: mảnh đầu mang `id` + tên hàm, các
      // mảnh sau nối thêm `arguments`; nhiều lệnh gọi phân biệt bằng `index`.
      if (hooks.toolCalls && Array.isArray(delta?.tool_calls)) {
        for (const call of delta.tool_calls as ToolCallDelta[]) {
          const index = call.index ?? 0
          const slot = hooks.toolCalls[index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } }
          if (call.id) slot.id = call.id
          if (call.type) slot.type = call.type
          if (call.function?.name) slot.function.name = call.function.name
          if (call.function?.arguments) slot.function.arguments += call.function.arguments
        }
      }

      if (parsed?.usage && hooks.onUsage) {
        hooks.onUsage({
          promptTokens: Number(parsed.usage.prompt_tokens) || 0,
          completionTokens: Number(parsed.usage.completion_tokens) || 0,
          estimated: Boolean(parsed.usage.estimated),
        })
      }
    } catch {
      // bỏ qua dòng không đọc được
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) await handleLine(line)
  }
  // Dòng cuối của vài provider không có `\n`. Trước đây nó bị bỏ, làm cụt phần
  // cuối câu trả lời mà không báo gì.
  buffer += decoder.decode()
  if (buffer.trim()) await handleLine(buffer)

  const tail = cleaner.flush()
  if (tail) {
    relayed += tail
    await hooks.emit(tail)
  }

  return { streamText, relayed, finalText: () => cleaner.finalText(streamText).trim() }
}
