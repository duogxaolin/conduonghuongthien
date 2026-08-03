import { and, asc, count, desc, eq, like, or, sql } from 'drizzle-orm'
import { chatbotKnowledge } from '../../../db/schema'
import { getDb } from '../../../utils/db'
import { serializePublicKnowledge } from '../../../utils/chatbot/serializers'

/**
 * The approved knowledge bank as a browsable list.
 *
 * `sources.get.ts` already served one row at a time, which is all a chat citation
 * needs — but it made the bank reachable only by first asking a question that
 * happened to match. A visitor who wants to read what has been approved had no
 * way in. This is that way in, and it is a different question from `/legal-qa`:
 * that page lists `articles` rows of type `faq` (editorial posts), while these are
 * the rows the assistant itself quotes.
 *
 * Published only, and the projection is built from `serializePublicKnowledge`
 * rather than `select()` on the table, so `internalNotes` cannot reach a visitor
 * by way of someone adding a column to the query later.
 */
/**
 * Query numbers arrive as text a visitor can type, so a non-numeric value has to
 * land on the fallback rather than on `NaN`. `Math.max(1, Number('abc'))` is
 * `NaN`, which reaches `offset()` as `NaN` and serializes into the response as
 * `page: null` — a paginator that reports no current page while still returning
 * rows. Clamping after the finite check keeps both ends honest.
 */
const readInt = (raw: unknown, fallback: number, min: number, max: number) => {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const page = readInt(query.page, 1, 1, 100_000)
  const perPage = readInt(query.perPage, 20, 1, 50)
  const search = String(query.search || '').trim().slice(0, 200)
  const topic = String(query.topic || '').trim().slice(0, 128)

  try {
    const db = getDb()
    const conditions = [eq(chatbotKnowledge.status, 'published')]
    if (search) {
      conditions.push(
        or(
          like(chatbotKnowledge.canonicalQuestion, `%${search}%`),
          like(chatbotKnowledge.approvedAnswer, `%${search}%`),
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

    return {
      ok: true,
      items: rows.map(row => serializePublicKnowledge(row)),
      topics: topicRows.map(row => ({ topic: row.topic, total: Number(row.total) })),
      pagination: {
        page,
        perPage,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / perPage),
      },
    }
  } catch {
    // The surface distinguishes `ok: false` from an empty bank: a failed query and
    // a bank with nothing in it must not look identical to a visitor.
    return { ok: false, items: [], topics: [], pagination: { page, perPage, total: 0, totalPages: 0 } }
  }
})
