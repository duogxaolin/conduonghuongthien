import { reportPublicReadFailure } from '../../utils/public-read-failure'
import { listPublicCategories } from '../../services/public-taxonomy-queries'

const CATEGORY_TRANSLATIONS: Record<string, Record<string, string>> = {
  'tin-noi-bat': {
    en: 'Featured News',
    zh: '焦点新闻',
    fr: 'À la une',
    ru: 'Главные новости',
    lo: 'ຂ່າວເດັ່ນ',
  },
  'tin-hoat-dong': {
    en: 'Activities',
    zh: '工作动态',
    fr: 'Activités',
    ru: 'Деятельность',
    lo: 'ການເຄື່ອນໄຫວ',
  },
  'tin-dia-phuong': {
    en: 'Local News',
    zh: '地方动态',
    fr: 'Actualités locales',
    ru: 'Местные новости',
    lo: 'ຂ່າວທ້ອງຖິ່ນ',
  },
  'tam-guong-tieu-bieu': {
    en: 'Role Models',
    zh: '先进典型',
    fr: 'Modèles exemplaires',
    ru: 'Примеры для подражания',
    lo: 'ແບບຢ່າງດີເດັ່ນ',
  },
  'mo-hinh-tai-hoa-nhap': {
    en: 'Reintegration Models',
    zh: '重返社会模式',
    fr: 'Modèles de réinsertion',
    ru: 'Модели реинтеграции',
    lo: 'ຮູບແບບການເຊື່ອມໂຍງ',
  },
  'van-ban-phap-luat': {
    en: 'Legal Documents',
    zh: '政策法规',
    fr: 'Textes juridiques',
    ru: 'Нормативные акты',
    lo: 'ເອກະສານນິຕິກຳ',
  },
  'hoi-dap-phap-luat': {
    en: 'Legal FAQ',
    zh: '法律问答',
    fr: 'Questions juridiques',
    ru: 'Юридические вопросы',
    lo: 'ຖາມ-ຕອບທາງກົດໝາຍ',
  },
}
// Public, unauthenticated category listing filtered by `type`.
// Flat list with parentId; ordered by displayOrder then id.
// Returns { ok: true, items: [] } (not an error) when a type has no categories.
export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const type = String(query.type || '').trim()
    const cookieLang = getCookie(event, 'cdkt_lang')?.trim().toLowerCase() || ''
    const lang = (typeof query.lang === 'string' ? query.lang.trim().toLowerCase() : '') || cookieLang

    const rows = await listPublicCategories(type)

    const localizedRows = rows.map((r) => {
      const trans = lang && lang !== 'vi' ? CATEGORY_TRANSLATIONS[r.slug]?.[lang] : null
      return {
        ...r,
        name: trans || r.name,
      }
    })

    return { ok: true, items: localizedRows }
  } catch (error) {
    reportPublicReadFailure(event, 'public.categories_failed', error)
    return { ok: false, items: [] }
  }
})
