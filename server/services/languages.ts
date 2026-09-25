/**
 * Language management — CRUD for portal languages + UI translation strings.
 *
 * All writes go through transactions with activity_logs, following the
 * project audit convention (design.md D6). Language settings use the existing
 * `settings` RBAC resource — no new resource needed.
 */
import { createError } from 'h3'
import { eq, and, sql } from 'drizzle-orm'
import { getDb, type Database } from '../utils/db'
import { languages, langTranslations, activityLogs } from '../db/schema'
import type { ActorLike } from '../utils/permissions'

// ─── Language CRUD ───────────────────────────────────────────────────────

export async function listLanguages(db: Database = getDb()) {
  const langRows = await db.select().from(languages).orderBy(languages.displayOrder, languages.id)

  const counts = await db
    .select({
      langCode: langTranslations.langCode,
      totalCount: sql<number>`count(*)`,
      translatedCount: sql<number>`sum(case when \`value\` is not null and trim(\`value\`) != '' then 1 else 0 end)`,
      aiCount: sql<number>`sum(case when \`is_ai_translated\` = true then 1 else 0 end)`,
    })
    .from(langTranslations)
    .groupBy(langTranslations.langCode)

  const countMap = new Map(counts.map(c => [c.langCode, {
    total: Number(c.totalCount) || 0,
    translated: Number(c.translatedCount) || 0,
    ai: Number(c.aiCount) || 0,
  }]))

  const viTotal = countMap.get('vi')?.total || 0

  return langRows.map(l => {
    const c = countMap.get(l.code) || { total: 0, translated: 0, ai: 0 }
    const totalRef = l.code === 'vi' ? c.total : Math.max(viTotal, c.total)
    const missing = Math.max(0, totalRef - c.translated)
    const percent = totalRef > 0 ? Math.round((c.translated / totalRef) * 100) : 0
    return {
      ...l,
      stats: {
        totalKeys: totalRef,
        translatedKeys: c.translated,
        missingKeys: missing,
        aiKeys: c.ai,
        percent,
      },
    }
  })
}

export async function createLanguage(
  actor: ActorLike,
  data: { code: string; name: string; nativeName: string; displayOrder?: number },
  db: Database = getDb(),
) {
  const code = data.code.trim().toLowerCase()
  if (!code || code.length > 10) {
    throw createError({ statusCode: 400, statusMessage: 'Mã ngôn ngữ không hợp lệ (1-10 ký tự).' })
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(languages).where(eq(languages.code, code)).limit(1)
    if (existing) {
      throw createError({ statusCode: 409, statusMessage: 'Mã ngôn ngữ đã tồn tại.' })
    }

    const [inserted] = await tx.insert(languages).values({
      code,
      name: data.name.trim(),
      nativeName: data.nativeName.trim(),
      displayOrder: data.displayOrder ?? 0,
    })
    await tx.insert(activityLogs).values({
      userId: actor.id ?? null,
      action: 'create',
      resource: 'settings',
      resourceId: inserted.insertId,
      meta: { operation: 'create_language', code },
    })
    return { id: inserted.insertId }
  })
}

export async function updateLanguage(
  actor: ActorLike,
  code: string,
  data: { name?: string; nativeName?: string; isActive?: boolean; isDefault?: boolean; displayOrder?: number },
  db: Database = getDb(),
) {
  return db.transaction(async (tx) => {
    const [lang] = await tx.select().from(languages).where(eq(languages.code, code)).limit(1)
    if (!lang) {
      throw createError({ statusCode: 404, statusMessage: 'Ngôn ngữ không tồn tại.' })
    }

    const updates: Record<string, unknown> = {}
    if (data.name !== undefined) updates.name = data.name.trim()
    if (data.nativeName !== undefined) updates.nativeName = data.nativeName.trim()
    if (data.isActive !== undefined) updates.isActive = data.isActive
    if (data.displayOrder !== undefined) updates.displayOrder = data.displayOrder

    if (data.isDefault === true) {
      // Unset any existing default first
      await tx.update(languages).set({ isDefault: false }).where(sql`${languages.isDefault} = true`)
      updates.isDefault = true
    }

    await tx.update(languages).set(updates).where(eq(languages.code, code))
    await tx.insert(activityLogs).values({
      userId: actor.id ?? null,
      action: 'update',
      resource: 'settings',
      resourceId: lang.id,
      meta: { operation: 'update_language', code, fields: Object.keys(updates) },
    })
  })
}

export async function deleteLanguage(actor: ActorLike, code: string, db: Database = getDb()) {
  return db.transaction(async (tx) => {
    const [lang] = await tx.select().from(languages).where(eq(languages.code, code)).limit(1)
    if (!lang) {
      throw createError({ statusCode: 404, statusMessage: 'Ngôn ngữ không tồn tại.' })
    }
    if (lang.isDefault) {
      throw createError({ statusCode: 400, statusMessage: 'Không thể xoá ngôn ngữ mặc định.' })
    }

    // Cascade: delete all translations for this language
    await tx.delete(langTranslations).where(eq(langTranslations.langCode, code))
    await tx.delete(languages).where(eq(languages.id, lang.id))
    await tx.insert(activityLogs).values({
      userId: actor.id ?? null,
      action: 'delete',
      resource: 'settings',
      resourceId: lang.id,
      meta: { operation: 'delete_language', code },
    })
  })
}

// ─── UI Translations ─────────────────────────────────────────────────────

export async function listTranslations(
  code: string,
  opts: { group?: string; search?: string; limit?: number; offset?: number },
  db: Database = getDb(),
) {
  const conditions = [eq(langTranslations.langCode, code)]
  if (opts.group && opts.group !== 'all') {
    conditions.push(eq(langTranslations.group, opts.group))
  }

  let query = db.select().from(langTranslations).where(and(...conditions))
  if (opts.limit) query = query.limit(opts.limit) as typeof query
  if (opts.offset) query = query.offset(opts.offset) as typeof query

  const rows = await query
  if (!opts.search) return rows

  const s = opts.search.toLowerCase()
  return rows.filter(
    (r) => r.key.toLowerCase().includes(s) || (r.value ?? '').toLowerCase().includes(s),
  )
}

export async function upsertTranslations(
  actor: ActorLike,
  code: string,
  items: Array<{ group: string; key: string; value: string }>,
  isAiTranslated: boolean = false,
  db: Database = getDb(),
) {
  return db.transaction(async (tx) => {
    for (const item of items) {
      const [existing] = await tx
        .select()
        .from(langTranslations)
        .where(
          and(
            eq(langTranslations.langCode, code),
            eq(langTranslations.group, item.group),
            eq(langTranslations.key, item.key),
          ),
        )
        .limit(1)

      if (existing) {
        await tx
          .update(langTranslations)
          .set({ value: item.value, isAiTranslated })
          .where(eq(langTranslations.id, existing.id))
      } else {
        await tx.insert(langTranslations).values({
          langCode: code,
          group: item.group,
          key: item.key,
          value: item.value,
          isAiTranslated,
        })
      }
    }

    await tx.insert(activityLogs).values({
      userId: actor.id ?? null,
      action: 'update',
      resource: 'settings',
      meta: { operation: 'update_translations', langCode: code, count: items.length, isAiTranslated },
    })
  })
}

export async function listTranslationGroups(code: string, db: Database = getDb()) {
  const rows = await db
    .select({ group: langTranslations.group })
    .from(langTranslations)
    .where(eq(langTranslations.langCode, code))
    .groupBy(langTranslations.group)
  return rows.map((r) => r.group)
}

/** Get all translations for a language as a flat key→value map, grouped. */
export async function getTranslationsForPublic(code: string, db: Database = getDb()) {
  const rows = await db
    .select()
    .from(langTranslations)
    .where(eq(langTranslations.langCode, code))

  const grouped: Record<string, Record<string, string>> = {}
  for (const row of rows) {
    if (!grouped[row.group]) grouped[row.group] = {}
    grouped[row.group][row.key] = row.value ?? ''
  }
  return grouped
}

export const DEFAULT_LANGUAGES = [
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', isDefault: true, displayOrder: 0 },
  { code: 'en', name: 'English', nativeName: 'English', isDefault: false, displayOrder: 1 },
  { code: 'zh', name: 'Chinese', nativeName: '中文', isDefault: false, displayOrder: 2 },
  { code: 'fr', name: 'French', nativeName: 'Français', isDefault: false, displayOrder: 3 },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', isDefault: false, displayOrder: 4 },
  { code: 'lo', name: 'Lao', nativeName: 'ພາສາລາວ', isDefault: false, displayOrder: 5 },
] as const

export async function seedDefaultLanguagesAndTranslations(db: Database = getDb()) {
  const { DEFAULT_TRANSLATIONS_SEED } = await import('../data/default-translations-seed')

  let languagesSeeded = 0
  let translationsSeeded = 0

  // 1. Seed languages
  for (const lang of DEFAULT_LANGUAGES) {
    const [existing] = await db.select().from(languages).where(eq(languages.code, lang.code)).limit(1)
    if (!existing) {
      await db.insert(languages).values({
        code: lang.code,
        name: lang.name,
        nativeName: lang.nativeName,
        isDefault: lang.isDefault,
        isActive: true,
        displayOrder: lang.displayOrder,
      })
      languagesSeeded++
    }
  }

  // 2. Seed translations
  for (const item of DEFAULT_TRANSLATIONS_SEED) {
    for (const [langCode, value] of Object.entries(item.values)) {
      if (!value) continue
      const [existing] = await db
        .select()
        .from(langTranslations)
        .where(
          and(
            eq(langTranslations.langCode, langCode),
            eq(langTranslations.group, item.group),
            eq(langTranslations.key, item.key),
          ),
        )
        .limit(1)

      if (!existing) {
        await db.insert(langTranslations).values({
          langCode,
          group: item.group,
          key: item.key,
          value,
          isAiTranslated: false,
        })
        translationsSeeded++
      }
    }
  }

  return { languagesSeeded, translationsSeeded }
}

export async function syncLanguageKeys(db: Database = getDb()) {
  const viKeys = await db
    .select({ group: langTranslations.group, key: langTranslations.key, value: langTranslations.value })
    .from(langTranslations)
    .where(eq(langTranslations.langCode, 'vi'))

  const allLangs = await db.select().from(languages)
  const nonViLangs = allLangs.filter(l => l.code !== 'vi')

  let synced = 0
  for (const lang of nonViLangs) {
    const existing = await db
      .select({ group: langTranslations.group, key: langTranslations.key })
      .from(langTranslations)
      .where(eq(langTranslations.langCode, lang.code))

    const existingSet = new Set(existing.map(e => `${e.group}::${e.key}`))

    for (const vi of viKeys) {
      if (!existingSet.has(`${vi.group}::${vi.key}`)) {
        await db.insert(langTranslations).values({
          langCode: lang.code,
          group: vi.group,
          key: vi.key,
          value: null,
          isAiTranslated: false,
        })
        synced++
      }
    }
  }

  return { synced, totalViKeys: viKeys.length }
}
