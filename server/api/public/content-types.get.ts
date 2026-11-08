import { reportPublicReadFailure } from '../../utils/public-read-failure'
import { listPublicContentTypes } from '../../services/public-taxonomy-queries'

// Public, unauthenticated content-type listing.
// Flat list ordered by displayOrder then id.
// A failed query answers 503 `{ ok: false, items: [] }` and is logged — it must
// not read as "there are no content types".
export default defineEventHandler(async (event) => {
  try {
    const rows = await listPublicContentTypes()

    return { ok: true, items: rows }
  } catch (error) {
    reportPublicReadFailure(event, 'public.content_types_failed', error)
    return { ok: false, items: [] }
  }
})
