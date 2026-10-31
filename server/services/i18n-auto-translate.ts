/**
 * I18n auto-translate khi tạo/sửa content-type & category.
 *
 * - Tạo: sinh key i18n (`ct_<slug>` / `cat_<slug>` cho name, `*_desc` cho
 *   description), ghi vi (gốc, không AI), rồi background AI dịch sang các ngôn ngữ
 *   đang hoạt động trong CSDL (trừ vi) qua `callAi('translation_ui', ...)`.
 * - Sửa: re-upsert vi + re-dịch non-vi (overwrite AI value).
 *
 * Non-blocking: caller `void` promise này, không await, không chặn response.
 * AI fail → key chỉ có vi, public fallback DB name → trang vẫn render.
 *
 * Reuse:
 * - `upsertTranslations` (server/services/languages.ts:225) — ghi/cập nhật 1 key.
 * - `callAi('translation_ui', ...)` (server/services/ai-gateway.ts:558) — AI dịch.
 * - `listActiveTranslationTargets` (server/services/languages.ts) — ngôn ngữ đích từ CSDL.
 */
import { callAi } from './ai-gateway'
import { listActiveTranslationTargets, upsertTranslations } from './languages'
import { MODEL_TRANSLATION_ANSWER_FORMAT, readModelTranslations } from '../utils/ai/model-translations'
import { logWarn } from '../utils/logger'
import type { ActorLike } from '../utils/permissions'

interface NameDesc { name: string; description?: string | null }

/**
 * Sinh 2 items (name + desc nếu có) cho 1 lang.
 */
function buildItems(slug: string, group: string, data: NameDesc): Array<{ group: string; key: string; value: string }> {
  const items: Array<{ group: string; key: string; value: string }> = [
    { group, key: `${group === 'content_types' ? 'ct' : 'cat'}_${slug}`, value: data.name },
  ]
  if (data.description && data.description.trim()) {
    items.push({ group, key: `${group === 'content_types' ? 'ct' : 'cat'}_${slug}_desc`, value: data.description.trim() })
  }
  return items
}

/**
 * AI dịch 1 batch name+desc sang 1 lang. Trả items đã dịch (key khớp, value dịch).
 * Fail → trả mảng rỗng (caller bỏ qua, giữ value vi).
 */
async function translateBatchForLang(
  langCode: string,
  langName: string,
  viItems: Array<{ group: string; key: string; value: string }>,
  userId: number | null,
): Promise<Array<{ group: string; key: string; value: string }>> {
  const promptLines = viItems.map((it, i) => `[${i + 1}] key=${it.key} value=${it.value}`)
  const prompt = `Dịch các chuỗi giao diện sau sang ${langName}.
Giữ nguyên placeholder như {name}, {0}, %s. Trả về JSON array, mỗi phần tử ${MODEL_TRANSLATION_ANSWER_FORMAT} — n là số trong ngoặc vuông [n] của dòng đó:
${promptLines.join('\n')}`

  const result = await callAi('translation_ui', { prompt, userId })
  if (!result.ok || !result.text) return []
  // Only text for the keys asked for — a model "null" is not a translation.
  return readModelTranslations(result.text, viItems)
}

/**
 * Auto-translate cho 1 entity (content-type hoặc category).
 * Ghi vi trước, rồi background AI dịch sang các ngôn ngữ đang hoạt động khác.
 */
async function autoTranslate(
  actor: ActorLike,
  slug: string,
  group: 'content_types' | 'categories',
  data: NameDesc,
): Promise<void> {
  const userId = actor?.id ?? null
  const viItems = buildItems(slug, group, data)

  try {
    // 1. Ghi vi (gốc, không AI)
    await upsertTranslations(actor, 'vi', viItems, false)

    // 2. Background AI dịch sang các ngôn ngữ ĐANG HOẠT ĐỘNG trong CSDL — không await,
    //    không chặn caller. Trước đây lặp `DEFAULT_LANGUAGES` cứng: một ngôn ngữ mặc định
    //    đã bị xoá vẫn tốn một lượt AI rồi ghi lỗi 404 vào log mỗi lần tạo/sửa danh mục.
    const nonViLangs = await listActiveTranslationTargets()
    void Promise.all(
      nonViLangs.map(async (lang) => {
        try {
          const translated = await translateBatchForLang(lang.code, lang.name, viItems, userId)
          if (translated.length) {
            await upsertTranslations(actor, lang.code, translated, true)
          }
        } catch (err) {
          logWarn({ event: 'i18n-auto-translate', lang: lang.code, slug, group, error: String(err) })
        }
      }),
    )
  } catch (err) {
    logWarn({ event: 'i18n-auto-translate-vi', slug, group, error: String(err) })
  }
}

/** Tạo content-type mới → sinh key + dịch. */
export function autoTranslateContentType(actor: ActorLike, slug: string, name: string, description?: string | null): Promise<void> {
  return autoTranslate(actor, slug, 'content_types', { name, description })
}

/** Sửa content-type → re-upsert vi + re-dịch non-vi (overwrite AI value). */
export function autoTranslateContentTypeUpdate(actor: ActorLike, slug: string, name: string, description?: string | null): Promise<void> {
  return autoTranslate(actor, slug, 'content_types', { name, description })
}

/** Tạo category mới → sinh key + dịch. */
export function autoTranslateCategory(actor: ActorLike, slug: string, name: string, description?: string | null): Promise<void> {
  return autoTranslate(actor, slug, 'categories', { name, description })
}

/** Sửa category → re-upsert + re-dịch. */
export function autoTranslateCategoryUpdate(actor: ActorLike, slug: string, name: string, description?: string | null): Promise<void> {
  return autoTranslate(actor, slug, 'categories', { name, description })
}
