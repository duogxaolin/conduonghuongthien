/**
 * Which articles this browser has read.
 *
 * DELIBERATELY NOT ON THE SERVER — this is the decision in this feature most
 * likely to be "fixed" later by someone who sees a localStorage list and assumes a
 * table was the intent. It was not.
 *
 * `article_view_daily` counts (day, article, source) and nothing else; the
 * view-counter ping derives a rotating visitor token precisely so that no IP and
 * no user agent is stored. Making "articles you have read" an account feature means
 * creating a table that records WHICH CITIZEN READ WHICH ARTICLE, WHEN, on a
 * Ministry of Public Security portal — on a site whose readers are people with
 * criminal records looking up their own legal position. That table would outlive
 * whatever interest anybody had in a "recently read" list, and it would be subject
 * to every request that can reach the database.
 *
 * The cost of keeping it local is real and the page says so out loud: the list is
 * per DEVICE, not per account. Change browsers and it is gone. That is the trade
 * being made, and it is the cheaper side.
 *
 * Everything here swallows its own errors. Private browsing refuses writes, quota
 * can be exhausted, and another tab can leave malformed JSON behind — none of which
 * is a reason to break the article page a reader is on.
 */
import { ref } from 'vue'

const STORAGE_KEY = 'cdkt_reader_history_v1'

/**
 * Cap on stored entries.
 *
 * A cap, not a retention window: a bounded list cannot grow into a long-term
 * record of someone's reading, which is the same objection that keeps this off the
 * server in the first place.
 */
export const READING_HISTORY_MAX = 50

export type ReadingHistoryEntry = {
  slug:    string
  title:   string
  /** Epoch milliseconds of the most recent visit. */
  readAt:  number
}

const entries = ref<ReadingHistoryEntry[]>([])
const loaded = ref(false)

/** Anything read back from localStorage is untrusted: the reader can edit it, and
 *  an older build may have written a different shape. */
function normalize(raw: unknown): ReadingHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const slug = typeof value.slug === 'string' ? value.slug.trim() : ''
  if (!slug) return null
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  const readAt = Number(value.readAt)
  return {
    slug,
    // Kept even when empty — the page falls back to the slug rather than dropping
    // an article the reader definitely visited.
    title,
    readAt: Number.isFinite(readAt) ? readAt : 0,
  }
}

export function useReadingHistory() {
  function load(): void {
    if (typeof window === 'undefined' || loaded.value) return
    loaded.value = true
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return
      entries.value = parsed
        .map(normalize)
        .filter((item): item is ReadingHistoryEntry => item !== null)
        .sort((a, b) => b.readAt - a.readAt)
        .slice(0, READING_HISTORY_MAX)
    } catch {
      // Malformed payload: start over rather than leaving the page unable to read
      // its own storage on every subsequent visit.
      try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignored */ }
      entries.value = []
    }
  }

  /**
   * Record a visit, newest first, one entry per article.
   *
   * Re-reading an article MOVES it rather than adding a second row: a list with the
   * same title five times is not a list of what someone has read.
   */
  function record(slug: string, title: string, now = Date.now()): void {
    if (typeof window === 'undefined') return
    const clean = (slug || '').trim()
    if (!clean) return

    load()
    const next = [
      { slug: clean, title: (title || '').trim(), readAt: now },
      ...entries.value.filter(item => item.slug !== clean),
    ].slice(0, READING_HISTORY_MAX)

    entries.value = next
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Quota or private browsing. The in-memory list stays correct for this page.
    }
  }

  function clear(): void {
    entries.value = []
    if (typeof window === 'undefined') return
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignored — the list is already empty in memory, which is what the reader
      // asked for and what they will see.
    }
  }

  return { entries, loaded, load, record, clear }
}
