/**
 * Display helpers shared by the parts of `/news` (app/components/news/), split out of
 * app/pages/news/index.vue in wave3 4.2. In a subdirectory of `utils/` so Nuxt does not
 * auto-import them: ContentTypeListSection.vue and ContentTypeSidebar.vue carry their own
 * `categoryIcon`, and an auto-imported one would sit beside theirs under the same name.
 */
import { formatDateVN } from '../formatDate'

/** Font Awesome classes for a category chip, by slug. */
export const categoryIcon = (slug: string) => {
  if (slug.includes('noi-bat') || slug.includes('tieu-diem')) return 'fa-solid fa-star text-xs'
  if (slug.includes('dia-phuong') || slug.includes('tinh')) return 'fa-solid fa-location-dot text-xs'
  return 'fa-solid fa-newspaper text-xs'
}

/** The date a list card shows: published, else created (UTC-safe `formatDateVN`). */
export const listItemDate = (item: { publishedAt?: string | null; createdAt?: string | null }) =>
  formatDateVN(item.publishedAt || item.createdAt)
