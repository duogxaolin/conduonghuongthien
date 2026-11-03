import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import type { ChatbotSettings } from '../server/db/schema'
import type { ChatDependencies, ChatEvent } from '../server/utils/chatbot/chat-policy'
import { FOLLOW_UP_MARKER } from '../server/utils/chatbot/follow-ups'
import type { RetrievalEntry } from '../server/utils/chatbot/retrieval'

/**
 * Lớp đầu ra của bản vá chủ quyền (sự cố 2026-10-27, docs/decisions/chatbot.md § Chủ quyền biển, đảo): câu hỏi lách được
 * `mentionsSovereignty` vẫn tới model. Câu trả lời nhắc chủ đề hoặc nêu yêu sách bị chặn ngay trên
 * luồng — không mẩu nào của cụm đó tới khách, kể cả khi cụm bị cắt giữa hai chunk — và được thay
 * bằng lập trường chính thức, cả phần đang hiện (`onReplace`) lẫn câu trả lời trả về/lưu.
 */

// `callAi` giả phát từng chunk qua `onChunk`, như gateway thật khi stream; có thể báo một lượt gọi công cụ
// trước, hoặc đứt kết nối sau khi phát xong.
type ToolEvent = { name: string, query?: string, status: 'calling' | 'done', count?: number }
const script = { chunks: [] as string[], calls: 0, toolEvents: [] as ToolEvent[], throwAfter: false, systemPrompt: '' }
mock.module('../server/services/ai-gateway', {
  namedExports: {
    callAi: async (_service: string, input: { systemPrompt?: string, onChunk?: (chunk: string) => void | Promise<void>, onToolCall?: (event: ToolEvent) => void | Promise<void> }) => {
      script.calls += 1
      script.systemPrompt = input.systemPrompt ?? ''
      for (const event of script.toolEvents) await input.onToolCall?.(event)
      for (const chunk of script.chunks) await input.onChunk?.(chunk)
      if (script.throwAfter) throw new Error('provider dropped the connection')
      return { ok: true, text: script.chunks.join('') }
    },
  },
})

const { answerGroundedChat } = await import('../server/utils/chatbot/chat-policy')
const { createSovereigntyOutputGuard, mentionsSovereignty, sovereigntyAnswer, withoutSovereigntyTurns } = await import('../server/utils/chatbot/sovereignty-guard')
const { parseSseLine } = await import('../app/composables/useChatbot')

// Dài hơn phần đuôi bộ lọc giữ lại, để có chữ thật sự được nhả ra trước cụm bị chặn.
const LEAD = 'Anh/chị có thể liên hệ Công an xã nơi cư trú để được hướng dẫn chi tiết về thủ tục. '

async function streamThrough(chunks: string[], question?: string) {
  let shown = ''
  let replaced = 0
  // Chặn ở chunk thứ mấy (đếm từ 0), hay chỉ ở bước kiểm cuối.
  let at: number | 'finish' | null = null
  let current: number | 'finish' = 0
  const guard = createSovereigntyOutputGuard({ forward: (chunk) => { shown += chunk }, replace: () => { replaced += 1; at = current }, question })
  for (const [index, chunk] of chunks.entries()) {
    current = index
    await guard.push!(chunk)
  }
  current = 'finish'
  const tripped = await guard.finish(chunks.join(''))
  return { shown, replaced, tripped, at: at as number | 'finish' | null }
}

test('a claim or a topic word split across chunks never reaches the reader, and the reply is swapped once', async () => {
  for (const [chunks, fragment] of [
    [[LEAD, '这些岛屿是中国', '领土，越南方面', '的说法不成立。'], '中国'],
    [['西沙群', '岛和南沙群岛自古以来就是中国领土。'], '西'],
    [[LEAD, 'Quần đảo Hoàng', ' Sa thuộc chủ quyền', ' của nước khác.'], 'Hoàng'],
    [[LEAD, 'Đảo này là lãnh thổ của Trung', ' Quốc từ xưa.'], 'lãnh thổ'],
    [[LEAD, 'The islands belong', 's to China, as the', ' records show.'], 'belong'],
    [[LEAD, 'Biển Đông', ' là vùng biển có nhiều tranh chấp.'], 'Biển'],
  ] as const) {
    const { shown, replaced, tripped } = await streamThrough([...chunks])
    assert.equal(tripped, true, chunks.join(''))
    assert.equal(replaced, 1, chunks.join(''))
    assert.ok(!shown.includes(fragment), `"${fragment}" leaked: ${shown}`)
  }
})

test('words that only look like the topic stream through untouched', async () => {
  // Chunk dừng ngay sau cụm, trước từ quyết định nó ("trường sa |thải"): giữa luồng chưa biết từ đó.
  for (const chunks of [
    [LEAD, 'Anh Hoàng Sa', 'ng đã hoàn lương và mở xưởng mộc.'],
    // ("môi trường sa | ngã": vòng 5 bỏ ngoại lệ "sa ngã" — chặn oan có chủ đích, ghim ở chatbot-sovereignty-recall.test.ts.)
    [LEAD, 'Nhà trường sa ', 'thải giáo viên vì có tiền án là trái luật.'],
    [LEAD, 'Bãi biển đông ', 'người vào cuối tuần.'],
    [LEAD, 'Lãnh đạo nam sa ', 'thải nhân viên phải có lý do.'],
    [LEAD, 'Vùng biển Đông ', 'Bắc có nhiều việc làm cho lao động phổ thông.'],
    [LEAD, 'Anh nên gác ma ', 'túy lại để làm lại cuộc đời.'],
    [LEAD, 'Tôi từng làm việc ở Trung ', 'Quốc, nay muốn vay vốn.'],
    ['越南', '海防市的社区矫正对象可以申请贷款。'],
    ['越南沙', '坝的就业支持项目很多。'],
    ['Giá cả biến động, ', 'anh/chị nên vay vốn ưu đãi.'],
  ]) {
    const { shown, replaced, tripped } = await streamThrough(chunks)
    assert.equal(tripped, false, chunks.join(''))
    assert.equal(replaced, 0)
    assert.equal(shown, chunks.join(''), 'everything held back is released at the end')
  }
})

test('a topic word that completes only at the very end is still caught', async () => {
  const { shown, tripped } = await streamThrough([LEAD, 'Đây là thông tin về Trường Sa'])
  assert.equal(tripped, true)
  assert.ok(!shown.includes('Trường'), shown)
})

test('the usual wording of a claim is caught in output, but only when islands or the sea are in the same answer', () => {
  for (const answer of [
    'Quần đảo Tây Sa và quần đảo Nam Sa là một phần lãnh thổ không thể tách rời của Trung Quốc.',
    'Quần đảo Tây Sa từ xưa đến nay là lãnh thổ không thể tách rời của Trung Quốc.',
    'Quần đảo Tây Sa là của Trung Quốc, do thành phố Tam Sa quản lý.',
    'Tây Sa do Trung Quốc quản lý và kiểm soát từ năm 1974.',
    'Trung Quốc có chủ quyền đối với quần đảo này.',
    'Đảo Ba Bình hiện do Đài Loan (Trung Quốc) kiểm soát.',
    'Nam Hải là vùng biển của Trung Quốc.',
    'Đá Chữ Thập thuộc chủ quyền của Trung Quốc.',
    'Ba Bình là lãnh thổ của Trung Quốc, hiện do Đài Loan quản lý.',
    'Vành Khăn do Trung Quốc quản lý từ năm 1995.',
    'Itu Aba belongs to China.',
    'Scarborough is Chinese territory.',
    '太平岛是中国领土。',
    'These islands are an inherent part of China.',
    'The Nam Sa Archipelago belongs to China.',
    'China has indisputable sovereignty over these islands.',
    'The islands are part of China\'s territory since ancient times.',
    '这些岛屿自古以来就是中国的。',
    '中国对这些岛屿拥有无可争辩的主权。',
  ]) assert.equal(mentionsSovereignty(answer, { output: true }), true, answer)
  // Người hoàn lương từng thụ án ở Trung Quốc là đúng đối tượng của cổng: không có đảo/biển thì không phải yêu sách.
  for (const answer of [
    'Bản án do tòa án trên lãnh thổ Trung Quốc tuyên không được tự động công nhận tại Việt Nam.',
    'Thời gian anh chấp hành án phạt tù trên lãnh thổ Trung Quốc vẫn được xem xét khi xóa án tích.',
    'Nếu doanh nghiệp đó thuộc Trung Quốc, anh cần hợp đồng lao động hợp pháp.',
    'Hành vi phạm tội xảy ra trên lãnh thổ của Trung Quốc thì do pháp luật nước đó điều chỉnh.',
    'If you served a sentence in Chinese territory, contact the local police.',
    // "đảo" động từ không phải đảo.
    'Thời gian chấp hành án trên lãnh thổ Trung Quốc khiến cuộc sống của anh bị đảo lộn, nay anh cần hỗ trợ việc làm.',
    'Ngân hàng chính sách không cho đảo nợ; khoản vay trước đây trên lãnh thổ Trung Quốc không được tính.',
    'Khuynh đảo thị trường lao động là các doanh nghiệp FDI, phần lớn thuộc sở hữu Trung Quốc.',
  ]) assert.equal(mentionsSovereignty(answer, { output: true }), false, answer)
  for (const question of ['Quần đảo Tây Sa thuộc nước nào?', 'Tây Sa thuộc nước nào?']) assert.equal(mentionsSovereignty(question), true, question)
})

test('context that scrolls out of the window does not trip a long benign answer', async () => {
  // Khoảng 96 ký tự sau "biển", đoạn cuối còn "biển đông vào" mà đã mất "bãi" đứng trước: cả câu thì không khớp.
  const text = `${LEAD}Bãi biển đông vào cuối tuần nên anh có thể bán hàng rong để có thu nhập ổn định, đồng thời tham gia các lớp học nghề do địa phương tổ chức miễn phí cho người hoàn lương.`
  for (const chunks of [[...text], text.split(/(?<= )/)]) {
    const { tripped, shown } = await streamThrough(chunks)
    assert.equal(tripped, false)
    assert.equal(shown, text)
  }
})

test('a claim made well before the word "island" is caught as soon as that word arrives', async () => {
  const chunks = [LEAD, 'Chúng thuộc chủ quyền của Trung Quốc từ lâu, ', 'theo nhiều tài liệu lịch sử được lưu giữ cẩn thận qua nhiều đời, ', 'về những hòn đảo này.', ' Anh/chị cần thêm thông tin gì?']
  const { tripped, replaced, at, shown } = await streamThrough(chunks)
  assert.equal(tripped, true)
  assert.equal(replaced, 1)
  assert.equal(at, 3, 'stopped on the chunk carrying "đảo", not at the end')
  assert.ok(!shown.includes('chủ quyền'), `the claim waited for the verdict instead of streaming out: ${shown}`)
})

test('a claim-like phrase with no island in sight is held, then released whole when the answer ends', async () => {
  const chunks = [LEAD, 'Thời gian anh chấp hành án trên lãnh thổ Trung Quốc ', 'vẫn được tính khi xét điều kiện xóa án tích, ', 'anh/chị mang theo bản án và giấy tờ liên quan.']
  const { tripped, shown } = await streamThrough(chunks)
  assert.equal(tripped, false)
  assert.equal(shown, chunks.join(''))
})

test('words that only look like islands do not turn a returnee answer into a claim', async () => {
  const servedInChina = 'Tôi từng chấp hành án ở Trung Quốc, về nước có được vay vốn không?'
  const servedInChinaZh = '您好，我在中国服刑后回到越南，可以申请贷款吗？'
  for (const [question, answer] of [
    [servedInChina, 'Anh có thể liên hệ Hội Chữ thập đỏ địa phương; thời gian chấp hành án trên lãnh thổ Trung Quốc không ảnh hưởng tới quyền vay vốn.'],
    [servedInChina, 'Hồ sơ nộp tại UBND phường Phú Lâm nơi anh cư trú; bản án tuyên trên lãnh thổ Trung Quốc cần được hợp pháp hóa lãnh sự.'],
    [servedInChina, 'Anh từng ở trại giam Côn Đảo trước đó? Bản án trên lãnh thổ Trung Quốc được xem xét riêng.'],
    // Ngữ cảnh từ câu hỏi chỉ tính khi hỏi về một hòn đảo, không phải nơi ở hay nơi bị bắt.
    ['Tôi ở phường Phú Lâm, Tuy Hòa, từng chấp hành án ở Trung Quốc, có được vay vốn không?', 'Thời gian anh chấp hành án trên lãnh thổ Trung Quốc không ảnh hưởng tới quyền vay vốn ưu đãi.'],
    ['Tôi ở huyện đảo Lý Sơn, bị phía Trung Quốc bắt giam 2 năm, về có được hỗ trợ không?', 'Thời gian anh bị giam giữ trên lãnh thổ Trung Quốc được xem xét khi làm thủ tục; anh liên hệ Công an xã.'],
    ['Tôi là ngư dân bị bắt trên vùng biển, bị giam ở Trung Quốc 2 năm, có được hỗ trợ không?', 'Thời gian anh bị giam giữ trên lãnh thổ Trung Quốc được xem xét khi làm thủ tục hỗ trợ.'],
    // `hanKey` nối chữ qua từ: 过程中业务 chứa 中业, 太平洋 chứa 太平.
    [servedInChinaZh, '您在中国服刑的记录属于中国司法机关管辖，申请过程中业务部门会核实。'],
    [servedInChinaZh, '如果您曾在中国太平洋沿岸城市服刑，相关判决属于中国法院作出。'],
    ['I was jailed in China for criminal mischief, can I get a loan?', 'Your conviction for criminal mischief under Chinese jurisdiction does not block a loan.'],
  ]) {
    const { tripped, shown } = await streamThrough([LEAD, answer!], question)
    assert.equal(tripped, false, answer)
    assert.equal(shown, LEAD + answer)
  }
})

test('a question about an island makes a bare claim in the answer count', async () => {
  const chunks = [LEAD, 'Nó là lãnh thổ của Trung Quốc từ lâu.']
  assert.equal((await streamThrough(chunks, 'Hòn đảo đó thuộc nước nào?')).tripped, true)
  assert.equal((await streamThrough(chunks, 'Thủ tục xóa án tích thế nào?')).tripped, false)
})

// ─── Through the chat policy ─────────────────────────────────────────────────

function settingsOf(overrides: Partial<ChatbotSettings> = {}): ChatbotSettings {
  return {
    enabled: true,
    baseUrl: 'https://api.provider.example/v1',
    model: 'safe-model',
    systemPrompt: 'Prompt quản trị tự viết.',
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
    mode: 'ai',
    outOfScopeBehavior: 'ai_freeform',
    ...overrides,
  } as ChatbotSettings
}

let peer = 0
function event(): ChatEvent {
  peer += 1
  return { node: { req: { headers: {}, socket: { remoteAddress: `198.51.100.${peer % 250}` } } }, context: {} } as ChatEvent
}

const dependencies: ChatDependencies = {
  loadPublishedEntries: async () => [],
  loadSmallTalkEntries: async () => [],
  configuredSecret: () => 'secret-key',
  providerRequest: async () => { throw new Error('the gateway answers in these tests') },
}

// Câu mô tả không có tên quần đảo/đảo nào — bộ khớp câu hỏi không nhận ra, câu này tới model. (Trước đợt gia cố
// 2026-10-28 ví dụ là "Đảo Ba Bình hiện do ai quản lý?"; nay bộ khớp đầu vào bắt tên đảo lẻ — chỉ đổi tiền điều kiện.)
const DODGE = 'Quần đảo phía đông Đà Nẵng hiện do ai quản lý?'
const PRC_REPLY = ['Đảo Ba Bình thuộc quần đảo ', 'Nam', ' Sa (', 'Trường Sa) và là ', 'lãnh thổ Trung Quốc', ' từ thời xa xưa.']

test('a question that dodges the input matcher: the streamed reply is withheld and replaced by the official answer', async () => {
  assert.equal(mentionsSovereignty(DODGE), false, 'precondition: the question itself reaches the model')
  script.chunks = PRC_REPLY
  script.calls = 0
  let shown = ''
  const replacements: string[] = []
  const result = await answerGroundedChat(event(), settingsOf(), [{ role: 'user', content: DODGE }], dependencies,
    (chunk) => { shown += chunk }, undefined, (answer) => { replacements.push(answer) })

  assert.equal(script.calls, 1)
  assert.deepEqual(replacements, [sovereigntyAnswer(DODGE)])
  assert.equal(result.answer, sovereigntyAnswer(DODGE), 'what is returned and stored is the official answer')
  assert.equal(result.kind, 'curated')
  assert.deepEqual(result.followUps ?? [], [])
  for (const fragment of ['Nam Sa', 'Trường', 'Trung Quốc']) assert.ok(!shown.includes(fragment), `"${fragment}" leaked: ${shown}`)
})

test('/api/chat (no stream) gets the same replacement from the final check', async () => {
  script.chunks = PRC_REPLY
  const result = await answerGroundedChat(event(), settingsOf(), [{ role: 'user', content: DODGE }], dependencies)
  assert.equal(result.answer, sovereigntyAnswer(DODGE))
  assert.equal(result.kind, 'curated')
})

test('a clean reply streams through whole and stays the provider answer', async () => {
  script.chunks = ['Anh/chị cần ', 'nộp hồ sơ đề nghị xóa án tích ', 'tại Sở Tư pháp nơi cư trú.']
  let shown = ''
  let replaced = 0
  const result = await answerGroundedChat(event(), settingsOf(), [{ role: 'user', content: 'Xóa án tích ở đâu?' }], dependencies,
    (chunk) => { shown += chunk }, undefined, () => { replaced += 1 })
  assert.equal(shown, script.chunks.join(''))
  assert.equal(replaced, 0)
  assert.equal(result.kind, 'provider')
  assert.equal(result.answer, script.chunks.join(''))
})

test('the provider failing after the reply was replaced still returns the official answer', async () => {
  script.chunks = PRC_REPLY
  script.throwAfter = true
  try {
    const result = await answerGroundedChat(event(), settingsOf(), [{ role: 'user', content: DODGE }], dependencies, () => {}, undefined, () => {})
    assert.equal(result.answer, sovereigntyAnswer(DODGE))
    assert.equal(result.kind, 'curated')
  } finally {
    script.throwAfter = false
  }
})

const now = new Date('2026-01-01T00:00:00Z')
function entry(id: number, canonicalQuestion: string, keywords: string[]): RetrievalEntry {
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

test('a follow-up suggestion the model writes about the topic is dropped, even when the bank could answer it', async () => {
  script.chunks = ['Anh/chị nộp hồ sơ tại Sở Tư pháp nơi cư trú.', `\n${FOLLOW_UP_MARKER}\n- Hoàng Sa thuộc về ai?\n- Hồ sơ xóa án tích gồm những gì?`]
  const bank = [entry(1, 'Hoàng Sa thuộc về ai?', ['hoàng sa']), entry(2, 'Hồ sơ xóa án tích gồm những gì?', ['hồ sơ xóa án tích'])]
  const result = await answerGroundedChat(event(), settingsOf(), [{ role: 'user', content: 'Nộp ở đâu vậy?' }], { ...dependencies, loadPublishedEntries: async () => bank })
  assert.equal(result.kind, 'provider')
  assert.ok(result.followUps?.includes('Hồ sơ xóa án tích gồm những gì?'), JSON.stringify(result.followUps))
  assert.ok(!result.followUps?.some(question => question.includes('Hoàng Sa')), JSON.stringify(result.followUps))
})

test('a grounded answer (the bank matched the question) is withheld and replaced the same way', async () => {
  // Nhánh có tham chiếu kho: câu hỏi thường, khớp kho, model vẫn trả lời vào chủ đề.
  const question = 'Hồ sơ xóa án tích gồm những gì?'
  const bank = [entry(7, question, ['hồ sơ xóa án tích'])]
  script.chunks = PRC_REPLY
  script.calls = 0
  let shown = ''
  const replacements: string[] = []
  const result = await answerGroundedChat(event(), settingsOf(), [{ role: 'user', content: question }], { ...dependencies, loadPublishedEntries: async () => bank },
    (chunk) => { shown += chunk }, undefined, (answer) => { replacements.push(answer) })
  assert.equal(script.calls, 1)
  assert.match(script.systemPrompt, /\[REFERENCE 1\]\nQuestion: Hồ sơ xóa án tích gồm những gì\?/, 'precondition: the grounded branch, not freeform')
  assert.deepEqual(replacements, [sovereigntyAnswer(question)])
  assert.equal(result.answer, sovereigntyAnswer(question))
  assert.equal(result.kind, 'curated')
  assert.deepEqual(result.sources, [], 'the bank row is not listed as the source of the official answer')
  for (const fragment of ['Nam Sa', 'Trường', 'Trung Quốc']) assert.ok(!shown.includes(fragment), `"${fragment}" leaked: ${shown}`)
})

test('a tool query the model writes about the topic is not shown under the answer', async () => {
  script.chunks = ['Anh/chị nộp hồ sơ tại Sở Tư pháp nơi cư trú.']
  script.toolEvents = [{ name: 'search_c11_articles', query: 'quần đảo Hoàng Sa', status: 'calling' }, { name: 'search_c11_knowledge', query: 'xóa án tích', status: 'calling' }]
  const shownEvents: ToolEvent[] = []
  try {
    await answerGroundedChat(event(), settingsOf(), [{ role: 'user', content: 'Xóa án tích ở đâu?' }], dependencies, () => {}, (toolEvent) => { shownEvents.push(toolEvent) })
  } finally {
    script.toolEvents = []
  }
  assert.deepEqual(shownEvents.map(toolEvent => toolEvent.query), [undefined, 'xóa án tích'])
})

test('an earlier assistant turn stating a claim is dropped from history; a visitor mentioning China is not', () => {
  const history = [
    { role: 'user', content: 'Tôi từng làm việc ở Trung Quốc, có vay vốn được không?' },
    { role: 'assistant', content: '这些岛屿是中国领土。' },
    { role: 'user', content: 'Còn thủ tục cư trú?' },
  ]
  assert.deepEqual(withoutSovereigntyTurns(history).map(turn => turn.content), [history[0]!.content, history[2]!.content])
})

// ─── The widget ──────────────────────────────────────────────────────────────

test('the widget replaces what it has shown instead of appending', () => {
  const official = sovereigntyAnswer(DODGE)
  const target = { text: 'Đảo Ba Bình thuộc', message: { id: 'bot-1', sender: 'bot', text: '' } as never }
  // Đúng khung máy chủ gửi: `content` cho bản widget cũ (chỉ biết nối), `replace` cho bản mới.
  parseSseLine(`data: ${JSON.stringify({ choices: [{ delta: { content: `\n\n${official}` } }], chatbot: { replace: official } })}`, target)
  assert.equal(target.text, official)
})
