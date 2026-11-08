import { reportPublicReadFailure } from '../../utils/public-read-failure'
import { listVisibleHomeSections } from '../../services/public-site-queries'

export default defineEventHandler(async (event) => {
  try {
    const sections = await listVisibleHomeSections()

    return { ok: true, sections }
  } catch (error) {
    reportPublicReadFailure(event, 'public.home_sections_failed', error)
    return { ok: false, sections: [] }
  }
})
