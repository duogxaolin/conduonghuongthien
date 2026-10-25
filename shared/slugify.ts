/**
 * `slugify` — the ONE copy of the slug rules, used on both sides:
 *  - server: `server/utils/slug.ts` re-exports it; the `unique*Slug()` helpers there
 *    (they need the DB) build every stored category / content-type / page / media slug
 *    from it, and `articles/index.post.ts` uses it for article slugs;
 *  - admin pages (`content/categories`, `content/content-types`, `media-portal/categories`)
 *    import it via `~~/shared/slugify`, so the slug the form shows is the slug saved.
 *
 * A second copy has gone wrong twice, both times by dropping the trim of hanging
 * hyphens: once in the create-article endpoint (`-tin-nong-` reached a public URL for
 * good, `articles/[id].put.ts` never re-slugifies), then as three `slugifyLocal`
 * arrow functions in the admin pages (rà soát trùng lặp 2026-10-25, T2).
 * `tests/slugify.test.ts` fails on any other definition.
 *
 * Imports nothing from `server/` or `app/` (it runs on both sides).
 */

/**
 * The slug of `text` while it is still being TYPED into a slug field: the same
 * character rules as `slugify`, except that one trailing `-` is kept so the next word
 * can follow (trimming it on every keystroke makes `tin-nong` impossible to type).
 * A leading `-` is dropped at once — it is never valid and never needed to go on typing.
 */
export function slugifyDraft(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/([^0-9a-z-\s])/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
}

/** Slugify Vietnamese/Unicode text into a clean ascii-safe slug: no hanging hyphen at either end. No timestamps. */
export function slugify(text: string): string {
  return slugifyDraft(text).replace(/-+$/, '')
}
