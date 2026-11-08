/**
 * Queries of the public chatbot endpoints — the knowledge list (`chatbot/knowledge.get.ts`), the
 * quick questions (`chatbot/quick-questions.get.ts`), one citation (`chatbot/sources.get.ts`) and
 * the lead capture (`chatbot/lead.post.ts`) — moved out of the handlers verbatim: the same
 * statements, in the same order.
 *
 * The handlers keep everything else: reading and clamping the query, the rate limit charged
 * before anything (lead), input validation and every `createError`, the projection of a row
 * (`serializePublicKnowledge` — never `select()` handed to a visitor as is), the mail step, the
 * response, and `reportPublicReadFailure()` (503 + `no-store`) around the reads that have it.
 */
import { and, asc, count, desc, eq, like, or, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { containsPattern } from '../utils/sql-like'
import { chatbotKnowledge, settings, submissions } from '../db/schema'

/** `GET /api/public/chatbot/knowledge`: one page of PUBLISHED rows, their total, and the topic facet. */
export async function listPublishedKnowledge(params: { page: number, perPage: number, search: string, topic: string }) {
  const { page, perPage, search, topic } = params
  const db = getDb()
  const conditions = [eq(chatbotKnowledge.status, 'published')]
  if (search) {
    conditions.push(
      or(
        like(chatbotKnowledge.canonicalQuestion, containsPattern(search)),
        like(chatbotKnowledge.approvedAnswer, containsPattern(search)),
      )!,
    )
  }
  // An unknown topic yields an empty page rather than an error: the filter comes
  // from a URL a visitor can edit or share, and a 400 on a stale link reads as
  // the portal being broken.
  if (topic) conditions.push(eq(chatbotKnowledge.topic, topic))
  const where = and(...conditions)

  const rows = await db
    .select()
    .from(chatbotKnowledge)
    .where(where)
    // Matches the ordering the assistant itself uses, so the list a visitor
    // reads and the answers they get back are in the same priority order.
    .orderBy(desc(chatbotKnowledge.priority), asc(chatbotKnowledge.id))
    .limit(perPage)
    .offset((page - 1) * perPage)

  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(chatbotKnowledge)
    .where(where)

  // Topics for the filter come from published rows only. Deriving them from the
  // whole table would advertise a topic that has nothing published under it, so
  // picking it would return an empty list with no explanation.
  const topicRows = await db
    .select({ topic: chatbotKnowledge.topic, total: count() })
    .from(chatbotKnowledge)
    .where(eq(chatbotKnowledge.status, 'published'))
    .groupBy(chatbotKnowledge.topic)
    .orderBy(desc(sql`count(*)`), asc(chatbotKnowledge.topic))
    .limit(50)

  return { rows, total, topicRows }
}

/** `GET /api/public/chatbot/quick-questions`: up to eight published quick questions, by priority. */
export async function listQuickQuestions() {
  const items = await getDb().select({ id: chatbotKnowledge.id, question: chatbotKnowledge.canonicalQuestion, topic: chatbotKnowledge.topic }).from(chatbotKnowledge).where(and(eq(chatbotKnowledge.status, 'published'), eq(chatbotKnowledge.isQuickQuestion, true))).orderBy(desc(chatbotKnowledge.priority), asc(chatbotKnowledge.id)).limit(8)
  return items
}

/** `GET /api/public/chatbot/sources?id=`: the knowledge row `id` if it is published, or undefined. */
export async function findPublishedKnowledgeSource(id: number) {
  const [item] = await getDb().select().from(chatbotKnowledge).where(and(eq(chatbotKnowledge.id, id), eq(chatbotKnowledge.status, 'published'))).limit(1)
  return item
}

/**
 * `POST /api/public/chatbot/lead`: store the request in `submissions` (visible under
 * /admin/submissions) and return the new row's id. One INSERT, no audit — a visitor's request.
 */
export async function insertChatbotLead(fields: { name: string, phone: string, email: string, question: string }) {
  const { name, phone, email, question } = fields
  const db = getDb()
  const [result] = await db.insert(submissions).values({
    fullName: name || 'Khách (Chatbot)',
    phone: phone || '',
    email: email || null,
    message: question || null,
    formTitle: 'Chatbot – Yêu cầu hỗ trợ',
  })
  return result.insertId
}

/** The site contact e-mail setting (the lead recipient when the chatbot has none of its own). */
export async function findContactEmailSetting() {
  const db = getDb()
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, 'email')).limit(1)
  return row
}
