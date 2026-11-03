import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * `answerChat` (server/utils/chatbot/chat.ts) là cầu nối giữa endpoint `/api/public/chatbot` và
 * `answerGroundedChat`. Lớp chặn chủ quyền rút lại câu trả lời đang stream qua `onReplace`
 * (sovereignty-guard.ts); cầu nối quên chuyển nó thì policy vẫn thay câu trả về/lưu, nhưng khách
 * vẫn nhìn thấy phần đã stream — và ba bộ test chủ quyền khác không thấy: test endpoint giả
 * `answerChat`, hai bộ còn lại gọi thẳng `answerGroundedChat`. Ở đây `answerChat` chạy thật trên
 * một `answerGroundedChat` giả.
 */

const received: unknown[][] = []
mock.module('../server/utils/chatbot/chat-policy', {
  namedExports: {
    answerGroundedChat: async (...args: unknown[]) => {
      received.push(args)
      return { answer: 'ok', sources: [], kind: 'curated' }
    },
  },
})

const { answerChat } = await import('../server/utils/chatbot/chat')

test('answerChat hands the stream, tool and replace callbacks to the policy, in order', async () => {
  const onChunk = () => {}
  const onToolEvent = () => {}
  const onReplace = () => {}
  const event = { context: {} }
  const settings = { mode: 'ai' }
  const messages = [{ role: 'user', content: 'Xin chào' }]
  await answerChat(event as never, settings as never, messages, onChunk, onToolEvent, onReplace)
  assert.equal(received.length, 1)
  const [gotEvent, gotSettings, gotMessages, dependencies, gotChunk, gotTool, gotReplace] = received[0]!
  assert.equal(gotEvent, event)
  assert.equal(gotSettings, settings)
  assert.equal(gotMessages, messages)
  assert.equal(typeof (dependencies as { loadPublishedEntries?: unknown }).loadPublishedEntries, 'function')
  assert.equal(gotChunk, onChunk)
  assert.equal(gotTool, onToolEvent)
  assert.equal(gotReplace, onReplace, 'the sovereignty guard can withdraw what the visitor already sees')
})
