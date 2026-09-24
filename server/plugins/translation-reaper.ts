/**
 * Stale translation reaper — on startup, mark any `article_translations`
 * rows stuck in `translating` status for more than 30 minutes as `failed`.
 *
 * This handles the case where the Node process restarts mid-translation:
 * the worker dies but the DB row stays at `translating` forever.
 * (design.md D3 — same pattern as video processing reaper)
 */
import { eq, lt, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { articleTranslations } from '../db/schema'
import { logWarn } from '../utils/logger'

const STALE_THRESHOLD_MINUTES = 30

export default defineNitroPlugin(() => {
  // Run 60 seconds after startup to let DB init complete
  setTimeout(async () => {
    try {
      const db = getDb()
      const staleRows = await db
        .select({ id: articleTranslations.id, articleId: articleTranslations.articleId, langCode: articleTranslations.langCode })
        .from(articleTranslations)
        .where(
          sql`${articleTranslations.status} = 'translating' AND ${articleTranslations.updatedAt} < DATE_SUB(NOW(), INTERVAL ${STALE_THRESHOLD_MINUTES} MINUTE)`,
        )

      for (const row of staleRows) {
        await db
          .update(articleTranslations)
          .set({
            status: 'failed',
            errorMessage: 'Tiến trình bị gián đoạn (process restart).',
          })
          .where(eq(articleTranslations.id, row.id))

        logWarn({
          event: 'translation.reaper_marked_stale',
          articleId: row.articleId,
          langCode: row.langCode,
          translationId: row.id,
        })
      }
    } catch {
      // Swallow — reaper failure must not crash startup
    }
  }, 60_000)
})
