import { reportPublicReadFailure } from '../../../utils/public-read-failure'
import { serializePublicKnowledge } from '../../../utils/chatbot/serializers'
import { listPublishedKnowledge } from '../../../services/public-chatbot-queries'

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
    // The page of published rows, their total, and the topic facet (published only).
    const { rows, total, topicRows } = await listPublishedKnowledge({ page, perPage, search, topic })

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
  } catch (error) {
    // The surface distinguishes `ok: false` from an empty bank: a failed query and
    // a bank with nothing in it must not look identical to a visitor. The failure
    // is also logged and answered with 503, so an operator sees it and no cache
    // keeps it as a valid page.
    reportPublicReadFailure(event, 'public.knowledge_list_failed', error)
    return { ok: false, items: [], topics: [], pagination: { page, perPage, total: 0, totalPages: 0 } }
  }
})
