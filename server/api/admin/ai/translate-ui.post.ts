import { createError } from 'h3'
import { getDb } from '../../../utils/db'
import { requireResourcePermission } from '../../../utils/permissions'
import { checkBudget } from '../../../utils/ai-budget'
import { callAi } from '../../../services/ai-gateway'

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'Tiếng Anh (English)',
  zh: 'Tiếng Trung (Chinese - 中文)',
  fr: 'Tiếng Pháp (French - Français)',
  ru: 'Tiếng Nga (Russian - Русский)',
  ja: 'Tiếng Nhật (Japanese - 日本語)',
  ko: 'Tiếng Hàn (Korean - 한국어)',
  es: 'Tiếng Tây Ban Nha (Spanish - Español)',
  de: 'Tiếng Đức (German - Deutsch)',
  lo: 'Tiếng Lào (Lao)',
  km: 'Tiếng Campuchia (Khmer)',
}

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const targetLang = String(body.targetLanguage || 'en').trim().toLowerCase()
  const targetLangName = LANGUAGE_NAMES[targetLang] || targetLang

  const keys = body.keys && typeof body.keys === 'object' ? (body.keys as Record<string, string>) : {}
  const keyEntries = Object.entries(keys).filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && v.trim()).slice(0, 100)

  if (keyEntries.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng cung cấp danh sách từ khóa giao diện cần dịch.' })
  }

  const db = getDb()

  // 1. Check budget guard
  const budgetResult = await checkBudget(db, 'translation_ui')
  if (!budgetResult.allowed) {
    throw createError({
      statusCode: 429,
      statusMessage: budgetResult.errorMessage ?? 'Hệ thống hết ngân sách cho AI. Vui lòng nạp thêm ngân sách.',
    })
  }

  // 2. Build translation dictionary prompt
  const dictToTranslate = Object.fromEntries(keyEntries)
  const prompt = `Dịch toàn bộ các nhãn giao diện (UI labels / microcopy) sau từ Tiếng Việt sang ${targetLangName}.
Yêu cầu:
1. Ngắn gọn, tự nhiên, chính xác, phù hợp đặt trên nút bấm, thanh điều hướng, nhãn biểu mẫu của website.
2. Giữ nguyên toàn bộ các KEY gốc (không đổi tên key).
3. Trả về đúng định dạng JSON key-value duy nhất (không bọc trong markdown code block, chỉ trả về JSON thuần):
${JSON.stringify(dictToTranslate, null, 2)}`

  const aiResult = await callAi('translation_ui', {
    prompt,
    variables: {
      source_text: JSON.stringify(dictToTranslate).slice(0, 4000),
      target_language: targetLangName,
    },
    userId: adminUser?.id ?? null,
  })

  if (!aiResult.ok || !aiResult.text) {
    throw createError({ statusCode: 502, statusMessage: aiResult.errorMessage || 'Không thể dịch giao diện.' })
  }

  let translations: Record<string, string> = {}
  try {
    const raw = aiResult.text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim()
    translations = JSON.parse(raw) as Record<string, string>
  } catch {
    translations = {}
  }

  return {
    ok: true,
    targetLanguage: targetLang,
    targetLanguageName: targetLangName,
    count: Object.keys(translations).length,
    translations,
  }
})
