/**
 * Câu trả lời đã dùng — lượt hỏi lặp lại không phải gọi model lần nữa.
 *
 * Vì sao có: mỗi lượt gọi `delify-5.5` tốn 4,3–6,3 s (đo 2026-11-04) và có tiền token.
 * Những câu người dân hỏi lặp lại ("làm sao để xóa án tích", "vay vốn ở đâu") chiếm
 * phần lớn lưu lượng, và câu trả lời cho chúng chỉ đổi khi dữ liệu nền đổi.
 *
 * Ba quyết định cấu trúc, mỗi cái tránh một lỗi cụ thể:
 *
 * 1. **Phiên bản dữ liệu nằm TRONG khoá**, không phải một cột để đi xoá. Sửa kho kiến
 *    thức / small-talk / bài viết chỉ cần `bumpAnswerCacheVersion()`; mọi khoá cũ tự
 *    thành vô hiệu vì chúng mang số cũ. Không có đường nào "quên xoá".
 * 2. **Khoá gồm cả cấu hình đang chạy** (mode, out-of-scope, model, baseUrl, prompt).
 *    Đổi nhà cung cấp hay sửa system prompt là câu trả lời cũ không còn đúng — nếu
 *    không đưa vào khoá, người dân vẫn nhận bản của model cũ sau khi đổi.
 * 3. **Không cache lượt có lịch sử nhiều hơn một câu**, và không cache câu chạm chủ
 *    quyền biển đảo. Câu trả lời phụ thuộc ngữ cảnh thì một khoá theo câu hỏi là sai;
 *    chủ đề chủ quyền có lập trường riêng và đã được trả lời sẵn không qua model.
 *
 * TTL là lớp dọn rác cuối (mặc định 30 ngày), không phải cơ chế đúng-sai chính: phiên
 * bản mới là thứ bảo đảm nội dung khớp dữ liệu.
 */
import { and, count, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { activityLogs, chatbotAnswerCache, chatbotSettings, type ChatbotSettings } from '../db/schema'
import { getDb } from '../utils/db'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { searchForm } from '../utils/chatbot/retrieval'
import type { CitationReference } from '../utils/chatbot/retrieval'

/** Số ngày một hàng còn dùng được. Phiên bản mới là cơ chế chính; đây là trần rác. */
export const ANSWER_CACHE_TTL_DAYS = 30
/** Trần số hàng. Vượt thì lượt ghi mới dọn theo `last_used_at` cũ nhất. */
export const ANSWER_CACHE_MAX_ROWS = 20_000
/**
 * Chỉ cache câu của MODEL.
 *
 * `curated` (khớp kho kiến thức) đã không gọi model — nó chỉ tốn một lượt truy xuất
 * ~100 ms trên kho đã nằm trong bộ nhớ 60 s, nên cache thêm không tiết kiệm gì đáng kể
 * mà lại thêm một bản sao nội dung phải giữ đúng. `rate_limited`/`unavailable`/
 * `moderation_blocked` là trạng thái, không phải câu trả lời — cache lại là phát tán lỗi.
 */
const CACHEABLE_KINDS = new Set(['provider'])

export type CachedAnswer = {
  answer: string
  /** Trích dẫn rút gọn (không toàn văn) — cùng hình dạng đi ra mạng. */
  sources: CitationReference[]
  followUps: string[]
  kind: string
}

/**
 * Khoá cache. Trả `null` nghĩa là "lượt này không được cache" — người gọi coi như miss
 * và đi tiếp bình thường.
 */
export function answerCacheKey(input: {
  question: string
  settings: Pick<ChatbotSettings, 'mode' | 'outOfScopeBehavior' | 'model' | 'baseUrl' | 'systemPrompt'>
  version: number
  historyLength: number
}): string | null {
  // Câu trả lời cho lượt có ngữ cảnh phụ thuộc các lượt trước; một khoá theo câu hỏi
  // hiện tại sẽ trả lời sai ngữ cảnh.
  if (input.historyLength > 1) return null
  // Dạng TÌM KIẾM (bỏ dấu) chứ không phải dạng hiển thị: người gõ "lam sao de xoa an
  // tich" và "Làm sao để xóa án tích?" là cùng một câu hỏi. Dùng `normalizeKnowledgeText`
  // ở đây sẽ tách chúng thành hai hàng cache và làm cache gần như vô dụng với người gõ
  // không dấu — nhóm người dùng rất đông trên cổng này.
  const normalized = searchForm(input.question).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim()
  if (!normalized) return null
  const material = JSON.stringify([
    normalized,
    input.version,
    input.settings.mode,
    input.settings.outOfScopeBehavior,
    input.settings.model ?? '',
    input.settings.baseUrl ?? '',
    // Prompt dài (tới 20 000 ký tự); băm riêng để khoá cuối vẫn cố định độ dài.
    createHash('sha256').update(input.settings.systemPrompt ?? '').digest('hex'),
  ])
  return createHash('sha256').update(material).digest('hex')
}

/**
 * Phiên bản dữ liệu hiện tại. Lưu ở `chatbot_settings` để không phải thêm bảng cấu hình;
 * `id = 1` là hàng duy nhất mà bảng đó có từ trước.
 */
export async function answerCacheVersion(): Promise<number> {
  const [row] = await getDb()
    .select({ version: chatbotSettings.answerCacheVersion })
    .from(chatbotSettings)
    .where(eq(chatbotSettings.id, 1))
    .limit(1)
  return Number(row?.version ?? 0)
}

/** Tăng phiên bản ⇒ mọi khoá cũ thành vô hiệu ngay. Gọi ở mọi đường ghi dữ liệu nền. */
export async function bumpAnswerCacheVersion(): Promise<number> {
  const db = getDb()
  await db.execute(sql`UPDATE \`chatbot_settings\` SET \`answer_cache_version\` = \`answer_cache_version\` + 1 WHERE \`id\` = 1`)
  return answerCacheVersion()
}

function parseSources(value: unknown): CitationReference[] {
  return Array.isArray(value) ? value as CitationReference[] : []
}

function parseFollowUps(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** Đọc một hàng còn hạn. Ghi `hits + 1` không chờ — số liệu dùng, không phải dữ liệu đúng. */
export async function readCachedAnswer(key: string): Promise<CachedAnswer | null> {
  if (!/^[0-9a-f]{64}$/u.test(key)) return null
  const db = getDb()
  const [row] = await db
    .select()
    .from(chatbotAnswerCache)
    .where(and(eq(chatbotAnswerCache.cacheKey, key), gt(chatbotAnswerCache.expiresAt, new Date())))
    .limit(1)
  if (!row) return null
  // Đếm lượt dùng là thống kê, không phải nội dung: hỏng thì bỏ qua, đừng làm hỏng câu trả lời.
  void db.execute(sql`UPDATE \`chatbot_answer_cache\` SET \`hits\` = \`hits\` + 1, \`last_used_at\` = UTC_TIMESTAMP() WHERE \`cache_key\` = ${key}`).catch(() => undefined)
  return {
    answer: row.answer,
    sources: parseSources(row.sources),
    followUps: parseFollowUps(row.followUps),
    kind: row.kind,
  }
}

/** Ghi một câu trả lời. Chỉ nhận loại được phép cache; trả `false` nếu bỏ qua. */
export async function writeCachedAnswer(input: {
  key: string
  question: string
  answer: string
  sources: CitationReference[]
  followUps: string[]
  kind: string
}): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/u.test(input.key)) return false
  if (!CACHEABLE_KINDS.has(input.kind)) return false
  if (!input.answer.trim()) return false
  const now = new Date()
  const expiresAt = new Date(now.getTime() + ANSWER_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000)
  const db = getDb()
  try {
    await db.insert(chatbotAnswerCache).values({
      cacheKey: input.key,
      question: input.question.slice(0, 1000),
      answer: input.answer,
      kind: input.kind,
      sources: input.sources,
      followUps: input.followUps,
      hits: 0,
      createdAt: now,
      lastUsedAt: now,
      expiresAt,
    }).onDuplicateKeyUpdate({
      // Hai lượt giống nhau tới cùng lúc: bản sau thắng, `hits` giữ nguyên tích luỹ.
      set: { answer: input.answer, kind: input.kind, sources: input.sources, followUps: input.followUps, lastUsedAt: now, expiresAt },
    })
    return true
  } catch {
    // Cache hỏng không bao giờ được làm hỏng câu trả lời.
    return false
  }
}

/** Xoá hàng hết hạn + cắt bớt khi vượt trần. Trả số hàng đã xoá. */
export async function pruneAnswerCache(): Promise<number> {
  const db = getDb()
  const expired = await db.delete(chatbotAnswerCache).where(lt(chatbotAnswerCache.expiresAt, new Date()))
  let removed = affectedRowsOrZero(expired)
  const [row] = await db.select({ total: count() }).from(chatbotAnswerCache)
  const total = Number(row?.total ?? 0)
  if (total > ANSWER_CACHE_MAX_ROWS) {
    const excess = total - ANSWER_CACHE_MAX_ROWS
    const oldest = await db
      .select({ key: chatbotAnswerCache.cacheKey })
      .from(chatbotAnswerCache)
      .orderBy(chatbotAnswerCache.lastUsedAt, chatbotAnswerCache.cacheKey)
      .limit(excess)
    if (oldest.length) {
      const dropped = await db.delete(chatbotAnswerCache)
        .where(inArray(chatbotAnswerCache.cacheKey, oldest.map(item => item.key)))
      removed += affectedRowsOrZero(dropped)
    }
  }
  return removed
}

/** Xoá toàn bộ cache (kèm audit trong cùng transaction). */
export async function clearAnswerCache(actorId: number | null, requestId: string | null): Promise<number> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ total: count() }).from(chatbotAnswerCache)
    const deleted = await tx.delete(chatbotAnswerCache)
    const removed = affectedRowsOrZero(deleted) || Number(row?.total ?? 0)
    await tx.insert(activityLogs).values({
      userId: actorId,
      action: 'delete',
      resource: 'chatbot_knowledge',
      resourceId: null,
      meta: { type: 'answer_cache_clear_all', count: removed, requestId },
    })
    return removed
  })
}

export type AnswerCacheRow = {
  cacheKey: string
  question: string
  kind: string
  hits: number
  createdAt: Date
  lastUsedAt: Date
  expiresAt: Date
}

export async function listAnswerCache(page: number, pageSize: number, search: string): Promise<{ items: AnswerCacheRow[], total: number }> {
  const db = getDb()
  const where = search ? sql`\`question\` LIKE ${`%${search.replace(/[\\%_]/gu, match => `\\${match}`)}%`}` : undefined
  const items = await db
    .select({
      cacheKey: chatbotAnswerCache.cacheKey,
      question: chatbotAnswerCache.question,
      kind: chatbotAnswerCache.kind,
      hits: chatbotAnswerCache.hits,
      createdAt: chatbotAnswerCache.createdAt,
      lastUsedAt: chatbotAnswerCache.lastUsedAt,
      expiresAt: chatbotAnswerCache.expiresAt,
    })
    .from(chatbotAnswerCache)
    .where(where)
    .orderBy(desc(chatbotAnswerCache.lastUsedAt), desc(chatbotAnswerCache.cacheKey))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
  const [row] = await db.select({ total: count() }).from(chatbotAnswerCache).where(where)
  return { items, total: Number(row?.total ?? 0) }
}
