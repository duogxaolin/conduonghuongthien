import { getTranslationsForPublic } from '../../../services/languages'
import { findLanguageByCode } from '../../../services/public-site-queries'

export default defineEventHandler(async (event) => {
  const code = getRouterParam(event, 'code')
  if (!code) {
    throw createError({ statusCode: 400, statusMessage: 'Mã ngôn ngữ bắt buộc.' })
  }

  const lang = await findLanguageByCode(code)

  if (!lang || !lang.isActive) {
    return { ok: true, translations: {} }
  }

  // No handle passed: the service's default is the same shared database handle the
  // language lookup above used.
  const translations = await getTranslationsForPublic(code)

  return { ok: true, translations }
})
