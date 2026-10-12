import type { AdminDoc, AdminDocCategory } from './types'
import { CONTENT_DOCS } from './admin-docs-content'
import { CHATBOT_DOCS } from './admin-docs-chatbot'
import { READERS_DOCS } from './admin-docs-readers'
import { AI_DOCS } from './admin-docs-ai'
import { SYSTEM_DOCS } from './admin-docs-system'
import { PUBLIC_DOCS } from './admin-docs-public'

export type { AdminDoc, AdminDocCategory, AdminDocLink, AdminDocStep } from './types'

/** All admin docs — concatenated from 6 category files. */
export const ADMIN_DOCS: AdminDoc[] = [
  ...CONTENT_DOCS,
  ...CHATBOT_DOCS,
  ...READERS_DOCS,
  ...AI_DOCS,
  ...SYSTEM_DOCS,
  ...PUBLIC_DOCS,
]

export type CategoryMeta = {
  key: AdminDocCategory
  label: string
  icon: string
}

/** 6 categories with display labels and icons. */
export const ADMIN_DOC_CATEGORIES: CategoryMeta[] = [
  { key: 'content', label: 'Nội dung', icon: 'fa-solid fa-newspaper' },
  { key: 'chatbot', label: 'Chatbot', icon: 'fa-solid fa-robot' },
  { key: 'readers', label: 'Người đọc', icon: 'fa-solid fa-users' },
  { key: 'ai', label: 'AI', icon: 'fa-solid fa-brain' },
  { key: 'system', label: 'Hệ thống & Cài đặt', icon: 'fa-solid fa-gear' },
  { key: 'public', label: 'Trang công khai', icon: 'fa-solid fa-globe' },
]

/** Helper: get docs by category. */
export function docsByCategory(category: AdminDocCategory): AdminDoc[] {
  return ADMIN_DOCS.filter(doc => doc.category === category)
}

/** Helper: find a doc by slug. */
export function findDocBySlug(slug: string): AdminDoc | undefined {
  return ADMIN_DOCS.find(doc => doc.slug === slug)
}
