/**
 * Shared types for admin documentation entries.
 *
 * Each AdminDoc is a static TS object — no DB, no API. Category files
 * import these types, and admin-docs-index.ts concatenates them into ADMIN_DOCS.
 */

export type AdminDocCategory = 'content' | 'chatbot' | 'readers' | 'ai' | 'system' | 'public'

export type AdminDocLink = {
  label: string
  href: string
}

export type AdminDocStep = {
  title: string
  detail: string
  link?: string
}

export type AdminDoc = {
  /** URL-friendly unique identifier */
  slug: string
  /** Display title (Vietnamese) */
  title: string
  /** Category — must exist in ADMIN_DOC_CATEGORIES */
  category: AdminDocCategory
  /** FontAwesome icon class, e.g. 'fa-solid fa-newspaper' */
  icon: string
  /** Short one-line summary for cards */
  summary: string
  /** Full multi-paragraph description (Vietnamese) */
  description: string
  /** Numbered workflow steps with optional admin page links */
  workflow: AdminDocStep[]
  /** Mermaid flowchart source string (must be valid `flowchart` syntax) */
  mermaid: string
  /** Related admin page links */
  links?: AdminDocLink[]
  /** Search aliases — exact normalized match → score 9000 */
  aliases?: string[]
  /** Search keywords — substring/exact match → score 100 per match */
  keywords?: string[]
  /** Sample questions for search suggestions / empty state */
  questions?: string[]
  /** Path to screenshot image (e.g. '/assets/docs/<slug>.png') — optional */
  screenshot?: string
  /** Highlight regions overlaid on screenshot — percentages 0-100 of image dimensions */
  highlightRegions?: { x: number; y: number; w: number; h: number; label: string }[]
}
