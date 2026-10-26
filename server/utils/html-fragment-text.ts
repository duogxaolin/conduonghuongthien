/**
 * Small pure helpers shared by the two article exporters, `html-to-markdown.ts`
 * (`?format=md`) and `html-to-docs.ts` (Google Docs).
 *
 * Both used to carry the same private `stripTags()`, and both copies destroyed every
 * named entity: the "decode" steps were no-ops (`.replace(/&/g, '&')`) and the last
 * step, `.replace(/&[a-z]+;/g, '')`, deleted `&amp;`, `&agrave;`, `&lt;`… — so
 * `Phòng R&amp;D` exported as `Phòng RD` and `Ng&agrave;y` as `Ngy` (rà soát trùng
 * lặp 2026-10-25, T3). Content imported from the old CMS stores Latin-1 letters as
 * named entities, so this hit real articles.
 */
import { decodeHtmlEntities } from './decode-html-entities'

/**
 * The text of an HTML fragment as a reader sees it: tags removed FIRST, then every
 * entity decoded in one pass (`decodeHtmlEntities`: full HTML 4 table + numeric;
 * `&nbsp;` becomes a plain space; unknown names stay verbatim). Order matters: decoding
 * first would turn `&lt;b&gt;` into a tag and then strip it as one.
 *
 * The result is PLAIN TEXT — `&lt;tháng&gt;` comes back as `<tháng>`. A caller that
 * writes it into a markup format (Markdown, HTML) must escape it for that format.
 * It is not `plainTextField()`: that one also "repairs" an entity cut off at the end
 * of an old-CMS excerpt, which would mangle a heading that ends in `AT&T`.
 */
export function htmlFragmentToText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, '')).trim()
}

/** Heading level of an `h1`–`h6` tag name; 0 for any other tag. */
export function headingLevel(tag: string): number {
  const m = tag.match(/^h([1-6])$/i)
  return m ? Number(m[1]) : 0
}
