/**
 * Gọi AI cho một câu trả lời có căn cứ: qua cổng AI (`callAi`, kèm năm công cụ tra cứu
 * mà model tự gọi), lùi về đường gọi trực tiếp cũ khi cổng chưa cấu hình — không bao giờ khi
 * hết hạn mức hay nhà cung cấp đang tắt (`provider_inactive`, CHANGELOG § 98). Chuỗi do
 * model truyền vào công cụ là dữ liệu người dùng: truy vấn bài viết dựng qua
 * `article-search.ts`, ảnh/video qua `media-search.ts`. Tách nguyên văn từ
 * `server/utils/chatbot/chat-policy.ts` (wave3 D-SPLIT); `callProvider` giữ nguyên một
 * khối vì mảng công cụ đóng gói `dependencies` của lượt gọi.
 */
import type { ChatbotSettings } from '../db/schema'
import { retrieveKnowledge, type PublicKnowledgeReference } from '../utils/chatbot/retrieval'
import { DEFAULT_CHATBOT_SYSTEM_PROMPT } from '../utils/chatbot/prompt-defaults'
import { buildProviderChatCall, extractProviderAnswer } from '../utils/chatbot/providers'
import { callAi } from './ai-gateway'
import { AI_PROVIDER_INACTIVE } from '../utils/ai/not-configured'
import { logWarn } from '../utils/logger'
import { desc } from 'drizzle-orm'
import { mediaItems, media } from '../db/schema'
import { getDb } from '../utils/db'
import { createFollowUpStreamFilter, selectFollowUps, splitFollowUps } from '../utils/chatbot/follow-ups'
import { searchArticles } from './chat-policy-article-search'
import { photoSearchCondition, videoSearchCondition } from '../utils/chatbot/media-search'
import { chatTurnText } from '../utils/chatbot/chat-turns'
import { buildChatHistory, buildGroundedSystemPrompt, questionVariable } from './chat-policy-prompt'
import { CHAT_LIMITS, HOTLINE, type ChatDependencies, type ChatMessage, type ChatToolCall } from './chat-policy-contract'

function text(value: unknown): string { return typeof value === 'string' ? value.normalize('NFKC').trim() : '' }

type KnowledgeHit = { id: number, question: string }
type ProviderReply = { text: string, toolCalls?: ChatToolCall[], proposals: string[], knowledgeHits: KnowledgeHit[] }

/** Knowledge-bank rows the model pulled in through `search_c11_knowledge` this turn. */
function knowledgeHitsOf(executed: { name: string, data?: unknown }[] | undefined): KnowledgeHit[] {
  const hits: KnowledgeHit[] = []
  for (const call of executed ?? []) {
    if (call.name !== 'search_c11_knowledge' || !Array.isArray(call.data)) continue
    for (const item of call.data) {
      const row = item as { id?: unknown, question?: unknown }
      if (typeof row?.id === 'number' && typeof row.question === 'string') hits.push({ id: row.id, question: row.question })
    }
  }
  return hits
}

/**
 * Follow-up chips for an AI answer: the model's proposals that match the
 * approved bank, topped up from the bank rows used for this answer. The row the
 * answer was grounded on first is not offered as a top-up — that is the question
 * just answered.
 */
async function providerFollowUps(
  dependencies: ChatDependencies,
  query: string,
  reply: ProviderReply,
  references: PublicKnowledgeReference[],
): Promise<string[]> {
  const grounding = references.filter(ref => ref.kind === 'knowledge')
  const fallback = [...grounding.slice(1), ...reply.knowledgeHits]
    .filter(hit => hit.id !== grounding[0]?.id)
    .map(hit => ({ id: hit.id, question: hit.question }))
  if (!reply.proposals.length && !fallback.length) return []
  try {
    const entries = reply.proposals.length ? await dependencies.loadPublishedEntries() : []
    return selectFollowUps({ proposals: reply.proposals, entries, userQuery: query, fallback, retrieve: dependencies.retrieve })
  } catch (error) {
    logWarn({ event: 'chatbot.follow_ups_failed', error, consequence: 'answer sent without follow-up suggestions' })
    return []
  }
}

async function callProvider(
  settings: ChatbotSettings,
  dependencies: ChatDependencies,
  references: PublicKnowledgeReference[],
  history: ChatMessage[],
  onChunk?: (chunk: string) => void | Promise<void>,
  onToolCall?: (event: { name: string; query?: string; status: 'calling' | 'done'; count?: number }) => void | Promise<void>,
): Promise<ProviderReply | null> {
  // logged and budget guard runs. The gateway reads from `ai_service_configs`
  // + `ai_providers`, which are backfilled from `chatbot_settings` on first
  // seed (spec R11.2–R11.3). If the gateway is not configured (service missing
  // or inactive, no key) or throws, fall back to the legacy direct path so existing
  // deployments that haven't migrated to /admin/ai settings still work. Budget
  // exceeded and a provider switched off (`provider_inactive`) never fall back.
  const basePrompt = settings.systemPrompt?.trim() ? settings.systemPrompt : DEFAULT_CHATBOT_SYSTEM_PROMPT
  const groundedPrompt = buildGroundedSystemPrompt(basePrompt, references)
  const userTurn = history[history.length - 1]
  const queryText = chatTurnText(userTurn)
  const historyMessages = buildChatHistory(history)
  // The follow-up block at the end of the answer is data for the chips under it,
  // never text for the reader: it is held back from the stream here.
  const followUpFilter = onChunk ? createFollowUpStreamFilter(onChunk) : null
  const chatbotTools = [
    {
      name: 'search_c11_knowledge',
      description: 'Tìm kiếm cơ sở dữ liệu pháp luật và nghiệp vụ của Cục C11 Bộ Công an về xóa án tích, điều kiện tái hòa nhập cộng đồng, hỗ trợ việc làm, vay vốn và đăng ký cư trú.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Từ khóa hoặc câu hỏi cần tra cứu trong kho tri thức C11',
          },
        },
        required: ['query'],
      },
      execute: async (args: Record<string, unknown>) => {
        const q = String(args.query || '').trim()
        if (!q) return []
        try {
          const entries = await dependencies.loadPublishedEntries()
          const matches = (dependencies.retrieve ?? retrieveKnowledge)(entries, q, { topK: 5, charBudget: 4000 })
          return matches.map(m => ({
            id: m.id,
            question: m.question,
            answer: m.answer,
            source: m.source?.label || m.source?.reference || 'Cục C11 - Bộ Công an',
          }))
        } catch {
          return []
        }
      },
    },
    {
      name: 'search_c11_articles',
      description: 'Tìm kiếm các bài viết, tin tức, tấm gương hoàn lương tiêu biểu, mô hình tái hòa nhập cộng đồng, và văn bản quy phạm pháp luật trên Cổng thông tin Cục C11.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Từ khóa hoặc chủ đề bài viết cần tìm' },
          type: { type: 'string', enum: ['news', 'role_model', 'reintegration', 'document', 'faq'], description: 'Loại bài viết cần lọc (tùy chọn)' },
        },
        required: ['query'],
      },
      execute: async (args: Record<string, unknown>) => searchArticles(
        String(args.query || ''),
        typeof args.type === 'string' ? args.type.trim() : null,
        5,
      ),
    },
    {
      name: 'search_c11_videos',
      description: 'Tìm kiếm video, phóng sự truyền hình, video hướng dẫn nghiệp vụ và phim tài liệu hoàn lương trong Thư viện Video Cục C11.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Từ khóa hoặc chủ đề video cần tìm' },
        },
        required: ['query'],
      },
      execute: async (args: Record<string, unknown>) => {
        try {
          const db = getDb()
          const q = String(args.query || '').trim()
          const rows = await db.select({
            id: mediaItems.id,
            title: mediaItems.title,
            slug: mediaItems.slug,
            shortId: mediaItems.shortId,
            description: mediaItems.description,
            thumbnailUrl: mediaItems.thumbnailUrl,
          }).from(mediaItems)
          .where(videoSearchCondition(q))
          .orderBy(desc(mediaItems.createdAt))
          .limit(3)

          return rows.map(r => ({
            title: r.title,
            url: `/media/${r.shortId || r.slug}`,
            posterUrl: r.thumbnailUrl || null,
            description: r.description,
          }))
        } catch {
          return []
        }
      },
    },
    {
      name: 'search_c11_photos',
      description: 'Tìm kiếm hình ảnh thực tế trong Thư viện Media Cục C11 (ảnh hoạt động, trao vốn vay, cơ sở sản xuất, hình ảnh tái hòa nhập).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Từ khóa hình ảnh cần tìm' },
        },
        required: ['query'],
      },
      execute: async (args: Record<string, unknown>) => {
        try {
          const db = getDb()
          const q = String(args.query || '').trim()
          const rows = await db.select({
            id: media.id,
            originalName: media.originalName,
            url: media.url,
          }).from(media)
          .where(photoSearchCondition(q))
          .orderBy(desc(media.createdAt))
          .limit(4)

          return rows.map(r => ({
            caption: r.originalName.replace(/\.[^/.]+$/, ''),
            url: r.url,
          }))
        } catch {
          return []
        }
      },
    },
    {
      name: 'get_c11_hotline_and_support',
      description: 'Lấy thông tin liên hệ chính thức, số điện thoại hotline tư vấn 24/7 của Cục C11 Bộ Công an.',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: () => ({
        hotline: HOTLINE,
        agency: 'Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an',
        purpose: 'Tư vấn pháp lý, hướng dẫn thủ tục xóa án tích, hỗ trợ tái hòa nhập cộng đồng và vay vốn phát triển kinh tế 24/7.',
      }),
    },
  ]

  /**
   * Nạp sẵn bài viết liên quan Ở MÁY CHỦ rồi đưa vào prompt, thay cho việc để model
   * tự gọi `search_c11_articles` — và tắt luôn công cụ khi đã có tài liệu trong tay.
   *
   * Vì sao: `delify-5.5` có sàn ~3,5 s cho MỌI lượt gọi, kể cả "1+1=?". Vòng gọi
   * công cụ tốn HAI lượt (một lượt quyết định gọi tool, một lượt trả lời), nên mỗi
   * câu nghiệp vụ mất ~9 s tới chữ đầu thay vì ~4,5 s. Tra bài viết ở máy chủ chỉ
   * 31–127 ms (đo trên DB dev, 1 132 bài) — rẻ hơn hai bậc so với một lượt gọi model.
   *
   * Đánh đổi có chủ đích: model không còn tự chọn từ khoá tra bài viết. Với câu hỏi
   * đã khớp kho tri thức (`references.length > 0`), câu hỏi của người đọc chính là
   * từ khoá tốt nhất — đo được là nó trả về bài liên quan. Câu KHÔNG khớp kho tri
   * thức vẫn giữ đủ công cụ, vì lúc đó model phải tự tìm.
   */
  const prefetched = references.length > 0 ? await searchArticles(queryText, null, 4) : []
  const articleBlock = prefetched.length
    ? '\n\n<UNTRUSTED_ARTICLE_LINKS>\n'
      + prefetched.map(a => `- [${a.title}](${a.url})${a.summary ? `: ${a.summary.slice(0, 160)}` : ''}`).join('\n')
      + '\n</UNTRUSTED_ARTICLE_LINKS>'
    : ''
  /**
   * Công cụ tắt theo `references.length`, nên lời nhắc "không còn công cụ" phải theo
   * ĐÚNG điều kiện đó — không phải theo `articleBlock`. Lệch hai điều kiện từng để lại
   * một lỗ: kho tri thức khớp nhưng `searchArticles` trả rỗng (từ khoá là thuật ngữ
   * nghiệp vụ không có trong tiêu đề bài) → không có khối bài viết, nên model không
   * được báo là công cụ đã tắt, và nó vẫn viết `<|tool_call>…` như thói quen. Câu trả
   * lời khi đó là một lệnh gọi công cụ không ai chạy.
   */
  const toolsOff = references.length > 0
  const systemPrompt = [
    groundedPrompt,
    articleBlock,
    toolsOff
      ? '\n\nKHÔNG còn công cụ tra cứu trong lượt này. Trả lời bằng văn xuôi từ tài liệu tham khảo'
        + (articleBlock ? ' và các bài viết ở trên' : '')
        + '; khi giới thiệu một bài, chép nguyên link markdown của nó. KHÔNG viết lệnh gọi công cụ dưới bất kỳ dạng nào.'
      : '',
  ].join('')

  try {
    const result = await callAi('chatbot', {
      prompt: queryText,
      systemPrompt,
      // `{{question}}` đặt câu hỏi vào system prompt: đi trong khối thẻ, không thô (chat-policy-prompt.ts).
      variables: { question: questionVariable(queryText), references: references.map(r => r.question).join('; '), fallback_message: settings.fallbackMessage ?? '' },
      userId: null,
      history: historyMessages,
      onChunk: followUpFilter ? chunk => followUpFilter.push(chunk) : undefined,
      onToolCall,
      // Đã có kho tri thức trong prompt: thêm một lượt gọi model để nó quyết định có
      // cần tra nữa không chỉ làm câu trả lời chậm gấp đôi.
      tools: toolsOff ? [] : chatbotTools,
    })
    await followUpFilter?.finish()
    if (result.ok && result.text) {
      // Không còn dệt `kind: 'evidence'` vào `references`: sau khi nạp sẵn bài viết, đường
      // grounded LUÔN tắt công cụ (`toolsOff`) nên không có `toolCallsExecuted`; đường
      // freeform truyền `references` rỗng và không đọc lại mảng đó. Kết quả công cụ vẫn
      // tới người đọc qua `toolCalls` bên dưới, chỉ mảng evidence là đã thành mã chết.
      const { answer, proposals } = splitFollowUps(result.text)
      return {
        text: answer.slice(0, CHAT_LIMITS.maxOutputChars),
        toolCalls: result.toolCallsExecuted?.map(t => ({ id: `call_${t.name}_${Date.now()}`, name: t.name, arguments: t.query, count: t.count })),
        proposals,
        knowledgeHits: knowledgeHitsOf(result.toolCallsExecuted),
      }
    }
    // Hết hạn mức, hoặc nhà cung cấp đang tắt (CHANGELOG § 98): dừng hẳn — chỉ trả lời từ kho. Đường gọi
    // cũ bên dưới dùng khoá ở "Cài đặt Chatbot", nên lùi về đó là lách đúng công tắc cán bộ vừa tắt.
    if (result.error === 'budget_exceeded' || result.error === AI_PROVIDER_INACTIVE) return null
    // service_not_found / service_inactive / no_api_key = fall through to legacy direct path
  } catch {
    // Gateway threw unexpectedly — fall through to legacy path
  }

  // Legacy direct provider call (pre-AI-gateway path). Kept as fallback so
  // deployments that have configured chatbot directly still function while
  // the admin migrates to /admin/ai settings.
  const secret = dependencies.configuredSecret(settings)
  if (!secret) return null
  const call = buildProviderChatCall({
    policy: settings.providerPolicy,
    baseUrl: settings.baseUrl!,
    model: settings.model!,
    secret,
    systemPrompt: groundedPrompt,
    history: historyMessages,
  })
  const response = await dependencies.providerRequest({
    url: call.url,
    allowedHosts: settings.allowedHosts!,
    method: 'POST',
    headers: call.headers,
    body: call.body,
    timeoutMs: settings.requestTimeoutMs,
    maxResponseBytes: settings.maxResponseBytes,
  })
  if (response.status < 200 || response.status >= 300) return null
  const payload = JSON.parse(Buffer.from(response.body).toString('utf8')) as unknown
  const { answer, proposals } = splitFollowUps(text(extractProviderAnswer(settings.providerPolicy, payload)))
  const rawAnswer = answer.slice(0, CHAT_LIMITS.maxOutputChars)
  return rawAnswer ? { text: rawAnswer, proposals, knowledgeHits: [] } : null
}

/** Dùng bởi `chat-policy-answer.ts`; barrel không xuất lại tệp này. */
export { providerFollowUps, callProvider }
