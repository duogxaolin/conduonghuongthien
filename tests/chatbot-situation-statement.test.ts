/**
 * Câu KỂ về hoàn cảnh ("tôi vừa đi tù về") ở các đường không có câu trả lời của AI.
 *
 * Triệu chứng thật (đã tái hiện trên container): ở chế độ chỉ-kho, kho tri thức khớp từ "tù" và trả nguyên
 * văn định nghĩa "Công tác tái hòa nhập cộng đồng là…" — đúng nội dung nhưng lạc đề với người đang cần biết
 * việc đầu tiên phải làm. Cùng lỗi khi AI chưa cấu hình / hết hạn mức / AI lỗi (đều lùi về câu của kho).
 *
 * Quy tắc "kho luôn thắng" (tests/chatbot-small-talk-policy.test.ts) giữ nguyên cho MỌI câu hỏi. Ngoại lệ
 * duy nhất, hẹp và có tên: câu NGẮN, không dấu hỏi, không từ nghiệp vụ, không từ để hỏi, khớp một hàng
 * hỗ trợ cảm xúc (`support`) — và chỉ ở đường không có AI.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatbotSettings } from '../server/db/schema'
import { answerGroundedChat, type ChatDependencies, type ChatEvent } from '../server/utils/chatbot/chat-policy'
import type { RetrievalEntry } from '../server/utils/chatbot/retrieval'
import type { SmallTalkEntry } from '../server/utils/chatbot/small-talk'
import { CHATBOT_SMALL_TALK_SEED } from '../server/data/chatbot-small-talk-seed'

const now = new Date('2026-01-01T00:00:00Z')
const DEFINITION = 'Công tác tái hòa nhập cộng đồng có thể hiểu là quá trình tác động của cơ quan nhà nước…'

function settingsOf(overrides: Partial<ChatbotSettings> = {}): ChatbotSettings {
  return {
    enabled: true, baseUrl: 'https://api.provider.example/v1', model: 'safe-model',
    systemPrompt: 'Chỉ trả lời theo tài liệu đã duyệt.', allowedHosts: ['api.provider.example'],
    requestTimeoutMs: 1_000, maxResponseBytes: 16_384, maxInputChars: 2_000, maxHistoryMessages: 8,
    retrievalTopK: 3, referenceCharBudget: 6_000, rateLimitRequests: 100, rateLimitWindowSeconds: 60,
    leadCaptureEnabled: true, smallTalkEnabled: true, ...overrides,
  } as ChatbotSettings
}

const definitionEntry = (): RetrievalEntry => ({
  id: 2, canonicalQuestion: 'Về công tác tái hòa nhập cộng đồng đối với người chấp hành xong án phạt tù?',
  normalizedQuestion: 'về công tác tái hòa nhập cộng đồng đối với người chấp hành xong án phạt tù',
  approvedAnswer: DEFINITION, topic: 'general', sourceLabel: 'Tài liệu Hỏi – Đáp',
  sourceUrl: null, sourceReference: null, internalNotes: null, status: 'published', priority: 0,
  isQuickQuestion: false, authorId: 1, reviewerId: 2, reviewedAt: now, publishedAt: now, archivedAt: null,
  createdAt: now, updatedAt: now,
  terms: [
    { kind: 'keyword', value: 'đi tù', normalizedValue: 'đi tù' },
    { kind: 'keyword', value: 'chấp hành xong án phạt tù', normalizedValue: 'chấp hành xong án phạt tù' },
    { kind: 'keyword', value: 'tái hòa nhập', normalizedValue: 'tái hòa nhập' },
  ],
} as RetrievalEntry)

const plain = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim()
const SMALL_TALK: SmallTalkEntry[] = CHATBOT_SMALL_TALK_SEED.map((e, i) => ({
  id: i + 1, category: e.category, answer: e.answer, patterns: e.patterns,
  normalizedQuestion: plain(e.question), isEnabled: true, displayOrder: i,
}))

let peer = 0
const event = (): ChatEvent => {
  peer += 1
  return { node: { req: { headers: {}, socket: { remoteAddress: `198.51.100.${peer % 250}` } } }, context: {} } as ChatEvent
}

function deps(providerStatus = 200) {
  const state = { calls: 0 }
  const dependencies: ChatDependencies = {
    loadPublishedEntries: async () => [definitionEntry()],
    loadSmallTalkEntries: async () => SMALL_TALK,
    configuredSecret: () => 'secret-key',
    providerRequest: async () => {
      state.calls += 1
      return { status: providerStatus, body: Buffer.from(JSON.stringify({ choices: [{ message: { content: 'Câu trả lời từ AI.' } }] })) } as any
    },
    semanticSmallTalkProvider: null,
    semanticSmallTalkConfig: { enabled: false },
  }
  return { dependencies, state }
}
const ask = (text: string) => [{ role: 'user', content: text }]
const GUIDANCE = /đăng ký cư trú/u

test('chế độ chỉ-kho: câu kể "vừa đi tù về" nhận lời khuyên, không phải định nghĩa', async () => {
  for (const text of ['tôi vừa đi tù về', 't mới đi tù về', 'tôi vừa ra tù', 'mình mới đi tù về']) {
    const { dependencies } = deps()
    const r = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge' }), ask(text), dependencies)
    assert.equal(r.kind, 'small_talk', text)
    assert.match(r.answer, GUIDANCE, text)
    assert.ok(!r.answer.includes(DEFINITION), `không được là định nghĩa: ${text}`)
  }
})

test('câu hỏi thật VẪN nhận câu của kho (kho luôn thắng): dấu hỏi, từ để hỏi, từ nghiệp vụ', async () => {
  for (const text of [
    'tôi vừa đi tù về thì phải làm gì',
    'tôi vừa đi tù về, tái hòa nhập là gì?',
    'tôi vừa đi tù về cần vay vốn',
    'tôi vừa đi tù về làm thủ tục như thế nào',
    'tôi vừa đi tù về có được hỗ trợ không',
    'tái hòa nhập cộng đồng là gì',
  ]) {
    const { dependencies } = deps()
    const r = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge' }), ask(text), dependencies)
    assert.equal(r.kind, 'curated', text)
    assert.equal(r.answer, DEFINITION, text)
  }
})

test('chế độ AI: câu kể vẫn do AI trả lời (có tham chiếu + nguồn), không bị câu hỗ trợ chặn', async () => {
  const { dependencies, state } = deps()
  const r = await answerGroundedChat(event(), settingsOf({ mode: 'ai' }), ask('tôi vừa đi tù về'), dependencies)
  assert.equal(r.kind, 'provider')
  assert.equal(r.answer, 'Câu trả lời từ AI.')
  assert.equal(state.calls, 1)
})

test('AI lỗi / chưa cấu hình: câu kể lùi về lời khuyên, câu hỏi lùi về câu của kho', async () => {
  // AI lỗi (provider 500)
  let h = deps(500)
  let r = await answerGroundedChat(event(), settingsOf({ mode: 'ai' }), ask('tôi vừa đi tù về'), h.dependencies)
  assert.equal(r.kind, 'small_talk')
  assert.match(r.answer, GUIDANCE)
  h = deps(500)
  r = await answerGroundedChat(event(), settingsOf({ mode: 'ai' }), ask('tôi vừa đi tù về cần làm thủ tục gì'), h.dependencies)
  assert.equal(r.kind, 'curated')
  // AI chưa cấu hình (không có baseUrl)
  h = deps()
  r = await answerGroundedChat(event(), settingsOf({ mode: 'ai', baseUrl: null as never }), ask('tôi vừa đi tù về'), h.dependencies)
  assert.equal(r.kind, 'small_talk')
  assert.equal(h.state.calls, 0)
})

test('tắt small-talk (công tắc vận hành) thì không có ngoại lệ: câu kể nhận câu của kho', async () => {
  const { dependencies } = deps()
  const r = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge', smallTalkEnabled: false }), ask('tôi vừa đi tù về'), dependencies)
  assert.equal(r.kind, 'curated')
})

test('câu hỏi/nghiệp vụ không nạp kho small-talk lần nào (giữ hợp đồng "kho luôn thắng" của policy test)', async () => {
  let loads = 0
  const { dependencies } = deps()
  dependencies.loadSmallTalkEntries = async () => { loads += 1; return SMALL_TALK }
  for (const text of ['tái hòa nhập cộng đồng là gì', 'tôi vừa đi tù về cần vay vốn', 'tôi vừa đi tù về phải làm gì?']) {
    await answerGroundedChat(event(), settingsOf({ mode: 'knowledge' }), ask(text), dependencies)
  }
  assert.equal(loads, 0)
})
