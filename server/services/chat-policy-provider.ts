/**
 * Gọi AI cho một câu trả lời có căn cứ: qua cổng AI (`callAi`, kèm năm công cụ tra cứu
 * mà model tự gọi), lùi về đường gọi trực tiếp cũ khi cổng chưa cấu hình. Chuỗi do
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
import { logWarn } from '../utils/logger'
import { desc } from 'drizzle-orm'
import { articles, mediaItems, media } from '../db/schema'
import { getDb } from '../utils/db'
import { createFollowUpStreamFilter, selectFollowUps, splitFollowUps } from '../utils/chatbot/follow-ups'
import { buildArticleSearch } from '../utils/chatbot/article-search'
import { photoSearchCondition, videoSearchCondition } from '../utils/chatbot/media-search'
import { chatTurnText } from '../utils/chatbot/chat-turns'
import { decodeHtmlEntities, plainTextField } from '../utils/decode-html-entities'
import { buildChatHistory, buildGroundedSystemPrompt } from './chat-policy-prompt'
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
  // seed (spec R11.2–R11.3). If the gateway fails (service inactive, no key,
  // or budget exceeded), fall back to the legacy direct path so existing
  // deployments that haven't migrated to /admin/ai settings still work.
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
      execute: async (args: Record<string, unknown>) => {
        try {
          const db = getDb()
          const rawQ = String(args.query || '').trim()
          const type = typeof args.type === 'string' ? args.type.trim() : null
          // Toàn bộ điều kiện và thứ tự sắp xếp do `buildArticleSearch` dựng — chuỗi
          // tìm kiếm chỉ đi vào tham số của câu lệnh (xem article-search.ts).
          const search = buildArticleSearch(rawQ, type)

          const rows = await db.select({
            id: articles.id,
            title: articles.title,
            type: articles.type,
            slug: articles.slug,
            excerpt: articles.excerpt,
            content: articles.content,
            thumbnailUrl: articles.thumbnailUrl,
          }).from(articles)
          .where(search.where)
          .orderBy(...search.orderBy)
          .limit(5)

          const categoryMap: Record<string, string> = {
            reintegration: '/news/reintegration-models',
            role_model: '/news/role-models',
            news: '/news',
            document: '/documents',
            faq: '/legal-qa',
          }

          return rows.map(r => {
            // Stored HTML (and imported excerpts) carry entities such as `Ng&agrave;y`: decode
            // after stripping tags, so the model reads — and echoes — real Vietnamese.
            const plainContent = decodeHtmlEntities((r.content || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
            const summary = plainTextField(r.excerpt)
            const snippet = plainContent ? plainContent.slice(0, 350) + (plainContent.length > 350 ? '...' : '') : (summary || '')
            return {
              title: plainTextField(r.title) ?? '',
              type: r.type,
              url: `/news/${r.slug}`,
              summary,
              snippet,
              coverImage: r.thumbnailUrl || null,
              categoryArchiveUrl: categoryMap[r.type] || '/news',
            }
          })
        } catch {
          return []
        }
      },
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

  try {
    const result = await callAi('chatbot', {
      prompt: queryText,
      systemPrompt: groundedPrompt,
      variables: { question: queryText, references: references.map(r => r.question).join('; '), fallback_message: settings.fallbackMessage ?? '' },
      userId: null,
      history: historyMessages,
      onChunk: followUpFilter ? chunk => followUpFilter.push(chunk) : undefined,
      onToolCall,
      tools: chatbotTools,
    })
    await followUpFilter?.finish()
    if (result.ok && result.text) {
      if (result.toolCallsExecuted && Array.isArray(result.toolCallsExecuted)) {
        for (const te of result.toolCallsExecuted) {
          if (Array.isArray(te.data)) {
            for (const item of te.data) {
              if (item && typeof item === 'object') {
                const it = item as Record<string, unknown>
                if (typeof it.title === 'string' && typeof it.url === 'string') {
                  const typeLabel = it.type === 'role_model' ? 'Tấm gương' : it.type === 'reintegration' ? 'Mô hình' : it.url.includes('/media/') ? 'Video' : 'Bài viết'
                  references.push({
                    id: Number(it.id) || 0,
                    kind: 'evidence',
                    question: it.title,
                    answer: String(it.snippet || it.summary || ''),
                    topic: String(it.type || ''),
                    source: {
                      label: `${typeLabel}: ${it.title}`,
                      reference: null,
                      url: String(it.url),
                    },
                  })
                }
              }
            }
          }
        }
      }
      const { answer, proposals } = splitFollowUps(result.text)
      return {
        text: answer.slice(0, CHAT_LIMITS.maxOutputChars),
        toolCalls: result.toolCallsExecuted?.map(t => ({ id: `call_${t.name}_${Date.now()}`, name: t.name, arguments: t.query, count: t.count })),
        proposals,
        knowledgeHits: knowledgeHitsOf(result.toolCallsExecuted),
      }
    }
    if (result.error === 'budget_exceeded') return null
    // service_inactive or no_api_key = fall through to legacy direct path
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
