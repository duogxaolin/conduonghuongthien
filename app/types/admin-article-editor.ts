/**
 * Shapes shared by the article editor (`pages/admin/content/articles/[id].vue`), its display
 * parts (`components/admin/articles/editor/`) and its composables (`useArticleEditor*`) — the
 * wave3 split of the 773-line page. Not response types: those stay derived from the handlers
 * (app/types/admin-articles-api.ts, admin-taxonomy-api.ts, admin-api.ts).
 */

/**
 * The editor's form — exactly what `POST /api/admin/articles` and `PUT /api/admin/articles/:id`
 * receive. A type alias, not an interface: it is passed as a request `body`, which `adminFetch`
 * types as `Record<string, unknown>`, and only an alias is assignable to that.
 */
export type ArticleEditorForm = {
  title: string
  type: string
  category: string
  categoryId: number | null
  excerpt: string
  content: string
  thumbnailUrl: string
  status: string
}

/** A language as `ArticleTranslationPanel` exposes it (`availableLanguages`). */
export interface ArticleEditorLanguage {
  code: string
  label: string
  flag: string
}

/** What a re-translation publishes as: drafts for review, or live at once. */
export type ArticleRetranslateStatus = 'ai_draft' | 'published'
