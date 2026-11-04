/**
 * Lệnh gọi công cụ do model viết ra dưới dạng CHỮ, không phải `delta.tool_calls`.
 *
 * `delify-5.5` thỉnh thoảng trả `delta.content` chứa nguyên
 * `<|tool_call>call:search_c11_articles{query:<|"|>…<|"|>}<tool_call|>` thay vì một
 * tool call có cấu trúc. Đường đọc SSE đẩy mọi `delta.content` qua bộ làm sạch rồi
 * cho hiện ngay — mà bộ làm sạch chỉ biết ` thinking` và `<|channel>`, nên người đọc
 * nhận trọn chuỗi lệnh gọi trên màn hình (báo cáo của chủ dự án, 2026-11-04, câu
 * "Thủ tục đăng ký vay vốn Ngân hàng Chính sách xã hội như thế nào?").
 *
 * Hai vế phải cùng đúng:
 *  1. Chữ hiển thị sạch — không còn `<|tool_call>`, kể cả khi thẻ cắt ngang mẩu
 *     stream, thẻ mở không bao giờ đóng, hoặc có câu trả lời thật đứng sau.
 *  2. Lệnh gọi VẪN chạy — `readChatSse` trả `streamText` là chữ THÔ (không qua bộ
 *     làm sạch), và `extractToolCallsFromMessage` bắt Pattern A từ đó. Làm sạch
 *     `streamText` sẽ biến một lệnh gọi thành không có lệnh gọi nào.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { cleanAiContent } from '../server/services/ai-text-cleaner.ts'
import { readChatSse } from '../server/services/ai-sse.ts'
import { extractToolCallsFromMessage, parseToolArguments } from '../server/services/ai-response-parse.ts'

const MARKUP_RE = /<\|\/?tool_call\|?>/

/** Một lệnh gọi đúng như model viết ra (query bọc bằng `<|"|>`). */
const call = (tool: string, query: string) => `<|tool_call>call:${tool}{query:<|"|>${query}<|"|>}<tool_call|>`

/** SSE body phát `text` thành các mẩu `size` ký tự, đúng cách provider cắt. */
function sseBody(text: string, size: number): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (let i = 0; i < text.length; i += size) {
        const delta = text.slice(i, i + size)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`))
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
}

/** Đọc một luồng và trả cả chữ đã phát cho người đọc lẫn chữ thô. */
async function read(text: string, size = 7) {
  const emitted: string[] = []
  const result = await readChatSse(sseBody(text, size), { emit: piece => { emitted.push(piece) }, toolCalls: {} })
  return { shown: emitted.join(''), raw: result.streamText, final: result.finalText() }
}

test('a text-format tool call never reaches the reader', async () => {
  const payload = call('search_c11_articles', 'vay vốn Ngân hàng Chính sách xã hội')
  const { shown, final } = await read(payload)
  assert.equal(MARKUP_RE.test(shown), false, `người đọc nhận lệnh gọi: ${JSON.stringify(shown)}`)
  assert.equal(MARKUP_RE.test(final), false, `câu trả lời lưu lại chứa lệnh gọi: ${JSON.stringify(final)}`)
})

test('two tool calls in one turn, split mid-tag across chunks, still leave the reader clean', async () => {
  const payload = call('search_c11_articles', 'vay vốn') + call('search_c11_knowledge', 'thủ tục vay vốn')
  // size 1 = mỗi ký tự một mẩu: mọi thẻ đều bị cắt ngang ranh giới mẩu.
  for (const size of [1, 3, 11, 64]) {
    const { shown } = await read(payload, size)
    assert.equal(MARKUP_RE.test(shown), false, `size=${size}: ${JSON.stringify(shown)}`)
  }
})

test('the answer written after a tool call survives intact', async () => {
  const payload = call('search_c11_articles', 'vay vốn') + 'Chào anh/chị, theo Quyết định 22/2023/QĐ-TTg…'
  for (const size of [1, 5, 40]) {
    const { shown, final } = await read(payload, size)
    assert.equal(MARKUP_RE.test(shown), false, `size=${size}`)
    assert.equal(shown.trim(), 'Chào anh/chị, theo Quyết định 22/2023/QĐ-TTg…', `size=${size}: ${JSON.stringify(shown)}`)
    assert.equal(final, 'Chào anh/chị, theo Quyết định 22/2023/QĐ-TTg…')
  }
})

test('an opening tag that never closes takes its remainder with it', () => {
  // Provider cắt luồng giữa lệnh gọi, hoặc model quên `<tool_call|>`.
  assert.equal(cleanAiContent('Chào anh/chị. ' + call('search_c11_articles', 'vay').slice(0, 60)), 'Chào anh/chị.')
  assert.equal(cleanAiContent(call('search_c11_articles', 'vay').slice(0, 50)), '')
})

test('a stray closer alone does not leave debris on screen', () => {
  for (const debris of ['<tool_call|>', '<|/tool_call|>', '<|tool_call|>']) {
    assert.equal(cleanAiContent(`Chào anh/chị.${debris}`), 'Chào anh/chị.')
  }
})

test('the tool call still EXECUTES — the raw stream text is never cleaned', async () => {
  // Đây là vế dễ hỏng nhất: làm sạch `streamText` sẽ "chữa" triệu chứng nhưng biến
  // mọi lệnh gọi dạng chữ thành không có lệnh gọi nào, và model trả lời không có
  // dẫn chứng.
  const payload = call('search_c11_articles', 'vay vốn Ngân hàng Chính sách xã hội')
  const { raw } = await read(payload)
  assert.equal(MARKUP_RE.test(raw), true, 'chữ thô phải còn thẻ để trích lệnh gọi')

  const calls = extractToolCallsFromMessage({ role: 'assistant', content: raw }, [])
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.function.name, 'search_c11_articles')
  assert.deepEqual(parseToolArguments(calls[0]!.function.arguments), { query: 'vay vốn Ngân hàng Chính sách xã hội' })
})

test('a plain Vietnamese answer with no markup is untouched (no regression to the fast path)', () => {
  const plain = 'Dạ, anh/chị có thể liên hệ Công an xã/phường nơi cư trú để được hướng dẫn.'
  assert.equal(cleanAiContent(plain), plain)
})
