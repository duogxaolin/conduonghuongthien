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
import { and, count, desc, eq, gt, sql } from 'drizzle-orm'
import { activityLogs, chatbotAnswerCache, chatbotSettings, type ChatbotSettings } from '../db/schema'
import { getDb } from '../utils/db'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { advanceConfigGeneration } from '../utils/config-generation'
// Namespace, không import theo tên: module này nằm dưới gần như mọi handler admin, và các bộ test giả `logger`
// với những tập tên khác nhau — import theo tên làm tệp test thiếu tên đó không nạp được (đã gặp 2026-11-06).
import * as logger from '../utils/logger'
import type { CitationReference } from '../utils/chatbot/retrieval'

/**
 * Số ngày một hàng còn dùng được. Phiên bản mới là cơ chế chính; đây là trần rác — và là
 * trần lưu giữ câu hỏi của người dân trong bảng này (≤ mức tối thiểu 30 ngày của phạm vi
 * `chat_sessions`), nên lượt dọn định kỳ (`chatbot-answer-cache-prune.ts`) phải thật sự chạy.
 */
export const ANSWER_CACHE_TTL_DAYS = 30
/** Trần số hàng. Vượt thì lượt dọn định kỳ cắt theo `last_used_at` cũ nhất. */
export const ANSWER_CACHE_MAX_ROWS = 20_000
/**
 * Độ dài tối đa của câu hỏi được cache = độ dài cột `question`. Câu dài hơn không được cache:
 * khoá băm từ CẢ câu, cột chỉ giữ 1000 ký tự đầu, nên từ hàng đã lưu không dựng lại được khoá
 * — mà lượt dọn và cổng sửa tay dựa đúng vào việc dựng lại đó (`answerCacheKeyIsLive`).
 */
export const ANSWER_CACHE_QUESTION_MAX_CHARS = 1000
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

/** Khoá và phép kiểm "hàng còn sống" là mã thuần, tách ra để E2E/script tính được mà không mở CSDL. */
export { answerCacheKey, answerCacheKeyIsLive } from '../utils/chatbot/answer-cache-key'

/**
 * Cấu hình + phiên bản đang chạy — đúng hai thứ mà lượt hỏi dùng để tính khoá — đọc trong MỘT câu lệnh
 * (cùng một hàng `chatbot_settings`, nên không lệch nhau). `null` khi chưa có hàng cấu hình: khi đó
 * chưa lượt hỏi nào tính được khoá. Không qua `getChatbotSettings` (nó TẠO hàng mặc định, và kéo theo
 * chuỗi import `permissions` vào mọi handler đang import module này).
 */
export async function answerCacheContext(): Promise<{ settings: ChatbotSettings, version: number } | null> {
  const [row] = await getDb().select().from(chatbotSettings).where(eq(chatbotSettings.id, 1)).limit(1)
  return row ? { settings: row, version: Number(row.answerCacheVersion ?? 0) } : null
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

/**
 * Tăng phiên bản ⇒ mọi khoá cũ thành vô hiệu ngay. Gọi ở mọi đường ghi dữ liệu nền, SAU commit.
 *
 * Cũng tăng thế hệ trong tiến trình (`utils/config-generation.ts`) để gateway AI bỏ bản cấu hình 60 s
 * đang giữ: nếu không, câu của model/nhà cung cấp CŨ được ghi dưới khoá MỚI. Không bao giờ ném: tăng hỏng
 * thì ghi log (`chatbot.answer_cache_bump_failed`) và trả `null` — lượt ghi dữ liệu nền đã commit rồi,
 * làm nó báo lỗi cũng không hoàn tác được gì.
 */
export async function bumpAnswerCacheVersion(): Promise<number | null> {
  advanceConfigGeneration()
  try {
    await getDb().execute(sql`UPDATE \`chatbot_settings\` SET \`answer_cache_version\` = \`answer_cache_version\` + 1 WHERE \`id\` = 1`)
    return await answerCacheVersion()
  } catch (error) {
    try {
      logger.logError({ event: 'chatbot.answer_cache_bump_failed', error, consequence: 'cached answers built on the old data stay replayable until the next bump, the TTL, or "clear all"' })
    } catch { /* ghi log hỏng không được làm hỏng lượt ghi đã commit */ }
    return null
  }
}

/**
 * Hàng cache ghi TRƯỚC 2026-11-05 mang `PublicKnowledgeReference` đầy đủ (có
 * `question`/`answer`). Cache sống hàng ngày, nên đọc lại phải CHIẾU về hình dạng hiện
 * tại — nếu không, mọi câu trả lời phát lại vẫn kèm toàn văn điều luật dù bản ghi mới
 * đã gọn (đo trên production sau deploy: bản miss 215 ký tự `sources`, bản hit 5 812).
 * Chiếu ở đây cũng là bước kiểm hình dạng: hàng rác/JSON lạ không lọt ra mạng.
 */
export function parseCachedSources(value: unknown): CitationReference[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): CitationReference[] => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    if (typeof raw.id !== 'number' || typeof raw.kind !== 'string') return []
    const source = raw.source && typeof raw.source === 'object' ? raw.source as Record<string, unknown> : null
    return [{
      id: raw.id,
      kind: raw.kind,
      source: source
        ? {
            label: typeof source.label === 'string' ? source.label : null,
            reference: typeof source.reference === 'string' ? source.reference : null,
            url: typeof source.url === 'string' ? source.url : null,
          }
        : null,
    }]
  })
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
    sources: parseCachedSources(row.sources),
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
  if (input.question.length > ANSWER_CACHE_QUESTION_MAX_CHARS) return false
  const now = new Date()
  const expiresAt = new Date(now.getTime() + ANSWER_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000)
  const db = getDb()
  try {
    await db.insert(chatbotAnswerCache).values({
      cacheKey: input.key,
      question: input.question,
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

/**
 * Bỏ MỘT hàng không còn được phép phát lại (lớp chặn chủ quyền bắt nó lúc đọc). Không audit:
 * đây là máy chủ tự vệ, không phải người quản trị xoá — log `chatbot.sovereignty_cached_answer_replaced`
 * ở nơi gọi là dấu vết. Trả `true` khi có hàng bị xoá.
 */
export async function discardCachedAnswer(key: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/u.test(key)) return false
  const deleted = await getDb().delete(chatbotAnswerCache).where(eq(chatbotAnswerCache.cacheKey, key))
  return affectedRowsOrZero(deleted) > 0
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

/** Số ký tự đầu của câu trả lời hiện ngay ở danh sách (xem đủ ở hộp chi tiết). */
export const ANSWER_PREVIEW_CHARS = 240

export type AnswerCacheRow = {
  cacheKey: string
  question: string
  /** Đoạn đầu của câu trả lời — chỉ để nhìn nhanh, không phải toàn văn. */
  answerPreview: string
  kind: string
  hits: number
  createdAt: Date
  lastUsedAt: Date
  expiresAt: Date
}

/**
 * Danh sách cho trang quản trị — chỉ hàng CÒN HẠN: hàng hết hạn không bao giờ được phát lại
 * (`readCachedAnswer` lọc `expires_at`), hiện nó ra là mời cán bộ sửa một câu không ai nhận được.
 * Hàng chết vì đã tăng phiên bản thì lượt dọn định kỳ xoá; cổng sửa tay từ chối nó (409).
 */
export async function listAnswerCache(page: number, pageSize: number, search: string): Promise<{ items: AnswerCacheRow[], total: number }> {
  const db = getDb()
  const live = gt(chatbotAnswerCache.expiresAt, new Date())
  const where = search
    ? and(live, sql`\`question\` LIKE ${`%${search.replace(/[\\%_]/gu, match => `\\${match}`)}%`}`)
    : live
  const items = await db
    .select({
      cacheKey: chatbotAnswerCache.cacheKey,
      question: chatbotAnswerCache.question,
      // `SUBSTR` (không `LEFT`): chạy được cả trên MySQL lẫn SQLite của bộ test.
      answerPreview: sql<string>`SUBSTR(\`answer\`, 1, ${ANSWER_PREVIEW_CHARS})`,
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

/** Trần độ dài một câu trả lời sửa tay (cột TEXT chứa tới 65 535 byte; chữ Việt tới 3 byte/ký tự). */
export const ANSWER_EDIT_MAX_CHARS = 10_000
export const FOLLOW_UP_MAX_COUNT = 5
export const FOLLOW_UP_MAX_CHARS = 200

export type AnswerCacheDetail = AnswerCacheRow & {
  /** Toàn văn câu trả lời (markdown — widget dựng nó qua bộ lọc, trang quản trị chỉ hiện chữ thô). */
  answer: string
  followUps: string[]
  sources: CitationReference[]
}

/** Một hàng đầy đủ để xem/sửa. Khác `readCachedAnswer`: không cần còn hạn, không đếm lượt dùng. */
export async function getAnswerCacheDetail(key: string): Promise<AnswerCacheDetail | null> {
  if (!/^[0-9a-f]{64}$/u.test(key)) return null
  const [row] = await getDb().select().from(chatbotAnswerCache).where(eq(chatbotAnswerCache.cacheKey, key)).limit(1)
  if (!row) return null
  return {
    cacheKey: row.cacheKey,
    question: row.question,
    answerPreview: row.answer.slice(0, ANSWER_PREVIEW_CHARS),
    answer: row.answer,
    kind: row.kind,
    hits: row.hits,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    followUps: parseFollowUps(row.followUps),
    sources: parseCachedSources(row.sources),
  }
}

/**
 * Sửa tay một câu trả lời đã lưu: nội dung + câu hỏi gợi ý. Hàng và dòng audit commit cùng nhau.
 *
 * - Giữ nguyên khoá, `kind`, `sources`, `hits`; chỉ gia hạn `expires_at` thêm một TTL (người sửa
 *   vừa xác nhận nội dung nên không để nó hết hạn sớm hơn bản mới sinh).
 * - KHÔNG tăng phiên bản: tăng là vô hiệu mọi khoá, kể cả bản vừa sửa. Hệ quả cần nói rõ cho
 *   người dùng: khi kho kiến thức/cấu hình AI đổi, bản sửa này cũng ngừng được phát (khoá cũ).
 * - Trả `null` khi hàng không còn (đã xoá/dọn giữa lúc mở hộp và lúc lưu).
 */
export async function updateCachedAnswer(input: {
  key: string
  answer: string
  followUps: string[]
  actorId: number | null
  ip: string | null
}): Promise<{ changedAnswer: boolean, changedFollowUps: boolean } | null> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ question: chatbotAnswerCache.question, answer: chatbotAnswerCache.answer, followUps: chatbotAnswerCache.followUps })
      .from(chatbotAnswerCache)
      .where(eq(chatbotAnswerCache.cacheKey, input.key))
      .limit(1)
    if (!row) return null
    const before = parseFollowUps(row.followUps)
    const changedAnswer = row.answer !== input.answer
    const changedFollowUps = JSON.stringify(before) !== JSON.stringify(input.followUps)
    // Lưu y nguyên: không ghi, không gia hạn, không để lại dòng audit "đã sửa" cho việc không sửa gì.
    if (!changedAnswer && !changedFollowUps) return { changedAnswer, changedFollowUps }
    const expiresAt = new Date(Date.now() + ANSWER_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000)
    const updated = await tx
      .update(chatbotAnswerCache)
      .set({ answer: input.answer, followUps: input.followUps, expiresAt })
      .where(eq(chatbotAnswerCache.cacheKey, input.key))
    // Hàng biến mất giữa SELECT và UPDATE (dọn rác/xoá) → coi như không còn.
    if (affectedRowsOrZero(updated) === 0) return null
    await tx.insert(activityLogs).values({
      userId: input.actorId,
      action: 'update',
      resource: 'chatbot_knowledge',
      resourceId: null,
      meta: {
        type: 'answer_cache_update',
        cacheKey: input.key,
        question: row.question,
        changedAnswer,
        changedFollowUps,
        answerLengthBefore: row.answer.length,
        answerLengthAfter: input.answer.length,
        ip: input.ip,
      },
    })
    return { changedAnswer, changedFollowUps }
  })
}
