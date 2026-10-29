/**
 * Answers of the public CONTENT endpoints as the browser holds them (after JSON) —
 * `Payload<typeof handler>`, derived from the handler itself (app/types/handler-payload.ts),
 * never written by hand: a field the handler stops sending turns every reader of it red
 * at the next typecheck. What `publicFetch<T>()` (app/composables/publicFetch.ts) is told
 * at each public call site (wave3 D-FETCH, lot G).
 *
 * Only types with a real call site. The reader's own endpoints are in
 * public-reader-api.ts, the site-wide ones (settings, languages, livestream…) in
 * public-site-api.ts; the comment thread and the video library stay in public-api.ts.
 */
import type { Payload } from './handler-payload'

/**
 * `GET /api/public/categories?type=…&lang=…` — the categories of one content type, names
 * localised by `?lang=` first, then the `cdkt_lang` cookie (which a server-side `$fetch`
 * never carries), then Vietnamese.
 */
export type PublicCategoriesResponse = Payload<typeof import('~~/server/api/public/categories.get').default>

/**
 * `GET /api/public/articles/<slug>?lang=` — one published article (404 otherwise, thrown).
 * The hand-written shape it replaces declared a `featuredImage` the handler never sends,
 * an `article: … | null` the handler never answers (a missing article is a 404), and an
 * index signature that let any field name compile.
 */
export type PublicArticleDetailResponse = Payload<typeof import('~~/server/api/public/articles/[slug].get').default>

/** `GET /api/public/articles/<slug>/related?lang=` — up to four articles of the same type, and the topic chips. */
export type PublicArticleRelatedResponse = Payload<typeof import('~~/server/api/public/articles/[slug]/related.get').default>

/** `POST /api/public/articles/<slug>/view` — always 202; `accepted` says whether it counted. */
export type PublicArticleViewResponse = Payload<typeof import('~~/server/api/public/articles/[slug]/view.post').default>
