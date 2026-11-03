/**
 * Page Builder blocks in the universal translation job (`universal-translation.ts`):
 * what a block asks the model to translate, and how the answer becomes
 * `data.translations[lang]`.
 *
 * One reading of "what is translatable" (`blockTranslationParts`) serves the coverage
 * scan, the job's work count and the job. The scan used to test other fields than the
 * job translated: a block with only a button label was translated but never counted,
 * and one with numbers only (or a title that is not text) was counted as missing and
 * never translated, so the tab could not reach 100 % (FINDING-R6-2).
 *
 * What may reach an override:
 *   - only the fields that were asked for, and only as text (`modelTranslationText`) —
 *     a model that added a `badge` the Vietnamese block does not have put it on the
 *     English page, and an object answer became "[object Object]" (FINDING-R6-4);
 *   - the body HTML through `sanitizeHtml`, like every other write of HTML shown with
 *     `v-html` (CLAUDE.md; FINDING-R6-3);
 *   - and only once EVERY part asked for came back: an override with the body alone
 *     made both the scan and the next run take the block as translated, and its
 *     Vietnamese title stayed on the English page for good (FINDING-R6-5).
 */
import { eq } from 'drizzle-orm'
import type { Database } from '../utils/db'
import { pageBlocks } from '../db/schema'
import { callAi } from './ai-gateway'
import { modelTranslationText } from '../utils/ai/model-translations'
import { sanitizeHtml } from '../utils/sanitize-html'
import { logWarn } from '../utils/logger'
import type { BlockData } from '../../shared/blocks/types'

type Fields = Record<string, unknown>

const isRecord = (value: unknown): value is Fields => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

const BLOCK_STRING_KEYS = [
  'title', 'subtitle', 'heading', 'text', 'description',
  'asideTitle', 'asideSubtitle', 'asideNote', 'asideLabel',
  'badge', 'btnText', 'buttonText', 'quote', 'cite',
  'infoTitle', 'noteTitle', 'noteText', 'highlightLabel', 'highlightValue',
]

/** A contact value that is not prose: an e-mail address or a phone number. */
const untranslatableValue = (value: string) => value.includes('@') || /^[0-9.+ -]+$/.test(value)

export interface BlockTranslationParts {
  /** The text fields, keyed as the prompt sends them (`__stat_label_<n>`, `__inforow_<label|value>_<n>`). */
  fields: Record<string, string>
  bodyHtml: string | null
}

/** What the job would ask the model for this block, or null when nothing in it is text to translate. */
export function blockTranslationParts(data: unknown): BlockTranslationParts | null {
  const raw = isRecord(data) ? data : {}
  const fields: Record<string, string> = {}
  for (const key of BLOCK_STRING_KEYS) {
    const value = text(raw[key])
    if (value) fields[key] = value
  }
  if (Array.isArray(raw.stats)) {
    raw.stats.forEach((stat: unknown, idx) => {
      const label = isRecord(stat) ? text(stat.label) : null
      if (label) fields[`__stat_label_${idx}`] = label
    })
  }
  if (Array.isArray(raw.infoRows)) {
    raw.infoRows.forEach((row: unknown, idx) => {
      if (!isRecord(row)) return
      const label = text(row.label)
      const value = text(row.value)
      if (label) fields[`__inforow_label_${idx}`] = label
      if (value && !untranslatableValue(value)) fields[`__inforow_value_${idx}`] = value
    })
  }
  const bodyHtml = typeof raw.bodyHtml === 'string' && raw.bodyHtml.trim() ? raw.bodyHtml : null
  return Object.keys(fields).length > 0 || bodyHtml ? { fields, bodyHtml } : null
}

/** The block already has a (non-empty) override for this language. */
export function hasBlockTranslation(data: unknown, langCode: string): boolean {
  const override = isRecord(data) && isRecord(data.translations) ? data.translations[langCode] : null
  return isRecord(override) && Object.keys(override).length > 0
}

/** Work for the job: something to translate, and no override for the language yet. */
export function blockNeedsTranslation(data: unknown, langCode: string): boolean {
  return !hasBlockTranslation(data, langCode) && blockTranslationParts(data) !== null
}

function extractJsonFromAi(answer: string): Fields | null {
  const cleaned = answer.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim()
  const candidates = [cleaned]
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) candidates.push(match[0], match[0].replace(/,\s*([}\]])/g, '$1'))
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (isRecord(parsed)) return parsed
    } catch {}
  }
  return null
}

type Lang = { code: string, name: string }

/** Every asked field as text, or null — the model gets two tries. */
async function translateFields(fields: Record<string, string>, lang: Lang, userId: number | null): Promise<Record<string, string> | null> {
  const prompt = `You are a professional translator. Translate the following UI/CMS texts from Vietnamese into ${lang.name}.
Return ONLY a valid JSON object with the exact same keys and translated text values (no markdown formatting, no codeblock, no explanation):
${JSON.stringify(fields)}`
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await callAi('translation_article', { prompt, userId })
    const parsed = res.ok && res.text ? extractJsonFromAi(res.text) : null
    if (!parsed) continue
    const translated: Record<string, string> = {}
    for (const key of Object.keys(fields)) {
      const value = modelTranslationText(parsed[key])
      if (value !== null) translated[key] = value
    }
    if (Object.keys(translated).length === Object.keys(fields).length) return translated
  }
  return null
}

/** The body HTML, sanitised, or null — the model gets two tries. */
async function translateBodyHtml(bodyHtml: string, lang: Lang, userId: number | null): Promise<string | null> {
  const prompt = `You are a professional translator. Translate the following HTML content from Vietnamese into ${lang.name}.
CRITICAL RULES:
1. Preserve 100% of HTML tags (<h3>, <p>, <strong>, <em>, <a>, <img>, <ul>, <ol>, <li>...) exactly as they are.
2. Only translate the human-readable text inside the tags.
3. Return ONLY the translated HTML content without markdown formatting:

${bodyHtml}`
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await callAi('translation_article', { prompt, userId })
    const html = res.ok && res.text ? res.text.replace(/```html\s*/gi, '').replace(/```\s*$/g, '').trim() : ''
    if (html) return sanitizeHtml(html)
  }
  return null
}

/**
 * Translate one block into one language and store the override. Read fresh from the
 * database (the job's list may be stale); true when the block needs nothing more.
 */
export async function translatePageBlock(blockId: number, lang: Lang, userId: number | null, db: Database): Promise<boolean> {
  const [fresh] = await db.select().from(pageBlocks).where(eq(pageBlocks.id, blockId)).limit(1)
  if (!fresh || !blockNeedsTranslation(fresh.data, lang.code)) return true
  const raw = fresh.data as Fields
  const parts = blockTranslationParts(raw)!
  const override: Fields = {}

  if (Object.keys(parts.fields).length > 0) {
    const fields = await translateFields(parts.fields, lang, userId)
    if (!fields) {
      logWarn({ event: 'universal_translate.block_json_parse_failed', blockId, langCode: lang.code })
      return false
    }
    for (const key of BLOCK_STRING_KEYS) if (fields[key] !== undefined) override[key] = fields[key]
    if (Array.isArray(raw.stats)) {
      override.stats = raw.stats.map((stat: unknown, idx) => {
        const label = fields[`__stat_label_${idx}`]
        return isRecord(stat) && label !== undefined ? { ...stat, label } : stat
      })
    }
    if (Array.isArray(raw.infoRows)) {
      override.infoRows = raw.infoRows.map((row: unknown, idx) => {
        if (!isRecord(row)) return row
        const label = fields[`__inforow_label_${idx}`]
        const value = fields[`__inforow_value_${idx}`]
        return { ...row, ...(label !== undefined ? { label } : {}), ...(value !== undefined ? { value } : {}) }
      })
    }
  }

  if (parts.bodyHtml) {
    const bodyHtml = await translateBodyHtml(parts.bodyHtml, lang, userId)
    if (bodyHtml === null) {
      logWarn({ event: 'universal_translate.block_html_failed', blockId, langCode: lang.code })
      return false
    }
    override.bodyHtml = bodyHtml
  }

  // Re-read right before the write: another language's override may have landed meanwhile.
  const [latest] = await db.select().from(pageBlocks).where(eq(pageBlocks.id, blockId)).limit(1)
  const latestData: unknown = latest?.data
  const latestRaw = isRecord(latestData) ? latestData : raw
  const latestTranslations = isRecord(latestRaw.translations) ? latestRaw.translations : {}
  const current = latestTranslations[lang.code]
  const updated = { ...latestRaw, translations: { ...latestTranslations, [lang.code]: { ...(isRecord(current) ? current : {}), ...override } } }
  await db.update(pageBlocks).set({ data: updated as BlockData }).where(eq(pageBlocks.id, blockId))
  return true
}
