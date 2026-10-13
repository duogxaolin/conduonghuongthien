import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'
import type { ChatbotSettings } from '../server/db/schema'
import { answerGroundedChat, buildGroundedSystemPrompt, type ChatDependencies, type ChatEvent } from '../server/utils/chatbot/chat-policy'
import {
  createFollowUpStreamFilter,
  FOLLOW_UP_LIMIT,
  FOLLOW_UP_MARKER,
  selectFollowUps,
  splitFollowUps,
} from '../server/utils/chatbot/follow-ups'
import type { RetrievalEntry } from '../server/utils/chatbot/retrieval'
import { normalizeFollowUps, normalizeStoredMessage } from '../app/utils/chatbot-storage'

/**
 * Câu hỏi gợi ý tiếp theo = AI đề xuất + kho tri thức xác nhận.
 *
 * Ba lời hứa được kiểm bằng cách chạy thật:
 *  - người đọc không bao giờ thấy dòng đánh dấu hay danh sách đề xuất thô, kể cả
 *    khi dấu bị cắt ngang giữa hai chunk stream;
 *  - một đề xuất chỉ thành nút khi kho tri thức trả lời được nó;
 *  - thiếu đề xuất thì lấp bằng câu hỏi gốc của các mục kho liên quan.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const now = new Date('2026-01-01T00:00:00Z')

function entry(id: number, canonicalQuestion: string, keywords: string[] = []): RetrievalEntry {
  return {
    id,
    canonicalQuestion,
    normalizedQuestion: canonicalQuestion.toLowerCase(),
    approvedAnswer: `Câu trả lời đã duyệt cho mục ${id}.`,
    topic: 'legal',
    sourceLabel: 'C11',
    sourceUrl: null,
    sourceReference: null,
    internalNotes: null,
    status: 'published',
    priority: 0,
    isQuickQuestion: false,
    authorId: 1,
    reviewerId: 2,
    reviewedAt: now,
    publishedAt: now,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    terms: keywords.map(value => ({ kind: 'keyword', value, normalizedValue: value })),
  } as RetrievalEntry
}

const BANK = [
  entry(1, 'Thủ tục xóa án tích như thế nào?', ['xóa án tích']),
  entry(2, 'Người chấp hành xong án phạt tù có được vay vốn không?', ['vay vốn']),
  entry(3, 'Đăng ký cư trú sau khi ra tù ở đâu?', ['cư trú']),
  entry(4, 'Hồ sơ đề nghị xóa án tích gồm những gì?', ['hồ sơ xóa án tích']),
]

// ─── Stream filter ───────────────────────────────────────────────────────────

async function streamThrough(chunks: string[]): Promise<string> {
  let seen = ''
  const filter = createFollowUpStreamFilter((chunk) => { seen += chunk })
  for (const chunk of chunks) await filter.push(chunk)
  await filter.finish()
  return seen
}

test('the marker and everything after it never reach the reader', async () => {
  const seen = await streamThrough(['Anh/chị đến Công an xã.\n\n', `${FOLLOW_UP_MARKER}\n- Hồ sơ gồm gì?\n- Ở đâu?`])
  assert.equal(seen, 'Anh/chị đến Công an xã.\n\n')
})

test('a marker split across chunks is still caught', async () => {
  // Every possible cut point inside the marker.
  for (let cut = 1; cut < FOLLOW_UP_MARKER.length; cut++) {
    const seen = await streamThrough([`Trả lời xong.\n${FOLLOW_UP_MARKER.slice(0, cut)}`, `${FOLLOW_UP_MARKER.slice(cut)}\n- Câu gợi ý?`])
    assert.equal(seen, 'Trả lời xong.\n', `cut at ${cut}`)
  }
})

test('text that only looks like the start of the marker is released', async () => {
  // A markdown link starts with `[`: held for one chunk, then let through intact.
  const text = 'Xem bài [CÀ MAU](/news/ca-mau) và [[ghi chú]] khác.'
  assert.equal(await streamThrough([...text]), text, 'char-by-char stream must come out byte-identical')
  assert.equal(await streamThrough(['Kết thúc bằng [']), 'Kết thúc bằng [', 'a held tail is flushed when the stream ends')
})

test('an answer without the marker streams unchanged', async () => {
  assert.equal(await streamThrough(['Chào anh/chị', ', tôi là trợ lý.']), 'Chào anh/chị, tôi là trợ lý.')
})

// ─── Parsing the proposals ───────────────────────────────────────────────────

test('proposals are read from bullets and numbered lines, the answer is cut at the marker', () => {
  const { answer, proposals } = splitFollowUps(`Nội dung trả lời.\n\n${FOLLOW_UP_MARKER}\n- Hồ sơ gồm những gì?\n2. **Nộp ở đâu?**\n* Mất bao lâu?\n\n`)
  assert.equal(answer, 'Nội dung trả lời.')
  assert.deepEqual(proposals, ['Hồ sơ gồm những gì?', 'Nộp ở đâu?', 'Mất bao lâu?'])
  assert.deepEqual(splitFollowUps('Không có dấu.'), { answer: 'Không có dấu.', proposals: [] })
})

// ─── Choosing what becomes a chip ────────────────────────────────────────────

test('a proposal becomes a chip only when the approved bank can answer it', () => {
  const chosen = selectFollowUps({
    proposals: ['Hồ sơ xóa án tích gồm những gì?', 'Công thức nấu phở ngon?', 'Vay vốn ở đâu?'],
    entries: BANK,
    userQuery: 'tôi vừa đi tù về',
  })
  assert.deepEqual(chosen, ['Hồ sơ xóa án tích gồm những gì?', 'Vay vốn ở đâu?'])
})

test('two proposals answered by the same entry give one chip', () => {
  const chosen = selectFollowUps({ proposals: ['Vay vốn ở đâu?', 'Vay vốn được bao nhiêu?'], entries: BANK, userQuery: 'x' })
  assert.deepEqual(chosen, ['Vay vốn ở đâu?'])
})

test('the question just asked is never suggested back', () => {
  const chosen = selectFollowUps({
    proposals: ['thủ tục xóa án tích như thế nào'],
    entries: BANK,
    userQuery: 'Thủ tục xóa án tích như thế nào?',
    fallback: [{ id: 1, question: 'Thủ tục xóa án tích như thế nào?' }],
  })
  assert.deepEqual(chosen, [])
})

test('missing chips are filled from the bank, skipping entries already offered, capped', () => {
  const chosen = selectFollowUps({
    proposals: ['Vay vốn ở đâu?'],
    entries: BANK,
    userQuery: 'tôi vừa đi tù về',
    fallback: [
      { id: 2, question: BANK[1]!.canonicalQuestion }, // same entry as the proposal
      { id: 3, question: BANK[2]!.canonicalQuestion },
      { id: 4, question: BANK[3]!.canonicalQuestion },
      { id: 1, question: BANK[0]!.canonicalQuestion },
    ],
  })
  assert.equal(chosen.length, FOLLOW_UP_LIMIT)
  assert.deepEqual(chosen, ['Vay vốn ở đâu?', BANK[2]!.canonicalQuestion, BANK[3]!.canonicalQuestion])
})

// ─── Through the real answer path ────────────────────────────────────────────

function settingsOf(overrides: Partial<ChatbotSettings> = {}): ChatbotSettings {
  return {
    enabled: true,
    baseUrl: 'https://api.provider.example/v1',
    model: 'safe-model',
    systemPrompt: 'Chỉ trả lời theo tài liệu đã duyệt.',
    allowedHosts: ['api.provider.example'],
    requestTimeoutMs: 1_000,
    maxResponseBytes: 16_384,
    maxInputChars: 2_000,
    maxHistoryMessages: 8,
    retrievalTopK: 3,
    referenceCharBudget: 6_000,
    rateLimitRequests: 100,
    rateLimitWindowSeconds: 60,
    leadCaptureEnabled: true,
    ...overrides,
  } as ChatbotSettings
}

let peer = 0
function event(): ChatEvent {
  peer += 1
  return { node: { req: { headers: {}, socket: { remoteAddress: `198.51.100.${peer % 250}` } } }, context: {} } as ChatEvent
}

function deps(providerAnswer: string): ChatDependencies {
  return {
    loadPublishedEntries: async () => BANK,
    loadSmallTalkEntries: async () => [],
    configuredSecret: () => 'secret-key',
    providerRequest: async () => ({ status: 200, body: Buffer.from(JSON.stringify({ choices: [{ message: { content: providerAnswer } }] })) }) as never,
  }
}

const ask = (text: string) => [{ role: 'user', content: text }]

test('an AI answer arrives without the marker and with bank-checked chips', async () => {
  const reply = `Anh/chị cần nộp hồ sơ tại Tòa án.\n\n${FOLLOW_UP_MARKER}\n- Hồ sơ xóa án tích gồm những gì?\n- Công thức nấu phở ngon?\n- Vay vốn ở đâu?`
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'ai' }), ask('xóa án tích'), deps(reply))
  assert.equal(result.kind, 'provider')
  assert.equal(result.answer, 'Anh/chị cần nộp hồ sơ tại Tòa án.')
  assert.ok(!result.answer.includes('GOI_Y'))
  assert.deepEqual(result.followUps, ['Hồ sơ xóa án tích gồm những gì?', 'Vay vốn ở đâu?'])
})

test('an AI answer without proposals still gets chips from the related bank rows', async () => {
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'ai' }), ask('xóa án tích'), deps('Câu trả lời từ AI.'))
  assert.equal(result.answer, 'Câu trả lời từ AI.')
  // The row the answer was grounded on is the question just answered; the other
  // matching row is the next one worth asking.
  assert.deepEqual(result.followUps, [BANK[3]!.canonicalQuestion])
})

test('a curated answer offers the other approved rows that matched', async () => {
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge' }), ask('xóa án tích'), deps('unused'))
  assert.equal(result.kind, 'curated')
  assert.deepEqual(result.followUps, [BANK[3]!.canonicalQuestion])
})

test('answers outside the bank offer no chips', async () => {
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge' }), ask('câu hỏi lạ hoàn toàn'), deps('unused'))
  assert.equal(result.kind, 'not_found')
  assert.ok(!result.followUps?.length)
})

test('the system prompt asks for proposals at the very end, and not for greetings', () => {
  const prompt = buildGroundedSystemPrompt('Base.', [])
  assert.ok(prompt.includes(FOLLOW_UP_MARKER))
  assert.match(prompt, /KHÔNG dùng khi chào hỏi/)
  assert.match(prompt, /CUỐI CÙNG/)
})

// ─── Client ──────────────────────────────────────────────────────────────────

test('client keeps only short, distinct string suggestions', () => {
  assert.deepEqual(normalizeFollowUps(['  A?  ', 'A?', 7, null, 'x'.repeat(201), 'B?', 'C?', 'D?']), ['A?', 'B?', 'C?'])
  assert.deepEqual(normalizeFollowUps('not an array'), [])
  const stored = normalizeStoredMessage({ sender: 'bot', text: 'Trả lời', followUps: ['Hỏi tiếp?', { evil: 1 }] }, 0)
  assert.deepEqual(stored?.followUps, ['Hỏi tiếp?'], 'a reload must restore the chips, filtered the same way')
})

test('the stream payload and the saved transcript both carry the suggestions', () => {
  const composable = read('../app/composables/useChatbot.ts')
  assert.match(composable, /target\.message\.followUps = normalizeFollowUps\(chatbot\.followUps\)/)
  assert.match(composable, /followUps: followUps \?\? \[\]/)
  const endpoint = read('../server/api/public/chatbot/index.post.ts')
  assert.match(endpoint, /followUps: result\.followUps \?\? \[\]/)
})

test('both surfaces show chips under the latest finished answer only', () => {
  for (const file of ['../app/components/ChatWidget.vue', '../app/pages/assistant.vue']) {
    const template = parse(read(file), { filename: file }).descriptor.template?.content ?? ''
    const chips = template.match(/<ChatFollowUps[\s\S]*?\/>/)?.[0] ?? ''
    assert.ok(chips, `${file} must render the chips`)
    assert.match(chips, /!msg\.isStreaming/, `${file}: not while the answer is still arriving`)
    assert.match(chips, /index === chatMessages\.length - 1/, `${file}: only under the newest message`)
    assert.match(chips, /:disabled="isSubmitting"/)
    assert.match(chips, /@ask="askBot"/)
  }
  const component = parse(read('../app/components/ChatFollowUps.vue'), { filename: 'ChatFollowUps.vue' }).descriptor.template?.content ?? ''
  assert.match(component, /type="button"/)
  assert.match(component, /focus-visible:ring-2/)
  assert.match(component, /motion-reduce:animate-none/)
  assert.doesNotMatch(component, /v-html/, 'suggestions are text, never markup')
})
