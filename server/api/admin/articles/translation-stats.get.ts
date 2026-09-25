import { getDb } from '../../../utils/db'
import { articles, languages, articleTranslations } from '../../../db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'news', 'read')

  const db = getDb()

  const [totalPublished] = await db
    .select({ total: sql<number>`count(*)` })
    .from(articles)
    .where(eq(articles.status, 'published'))

  const total = Number(totalPublished?.total) || 0

  const activeLangs = await db
    .select({ code: languages.code, name: languages.name, nativeName: languages.nativeName })
    .from(languages)
    .where(and(eq(languages.isActive, true), sql`${languages.code} != 'vi'`))

  const translationCounts = await db
    .select({
      langCode: articleTranslations.langCode,
      count: sql<number>`count(*)`,
    })
    .from(articleTranslations)
    .innerJoin(articles, eq(articleTranslations.articleId, articles.id))
    .where(and(
      eq(articles.status, 'published'),
      sql`${articleTranslations.status} != 'failed'`,
    ))
    .groupBy(articleTranslations.langCode)

  const countMap = new Map(translationCounts.map((c) => [c.langCode, Number(c.count) || 0]))

  const items = activeLangs.map((l) => {
    const translated = countMap.get(l.code) || 0
    return {
      code: l.code,
      name: l.name,
      nativeName: l.nativeName,
      translated,
      missing: Math.max(0, total - translated),
    }
  })

  return {
    ok: true,
    totalArticles: total,
    languages: items,
  }
})
