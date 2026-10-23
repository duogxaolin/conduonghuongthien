import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * Imported excerpts carry HTML entities for every Latin-1 letter — `Ng&agrave;y 26/8,
 * tại Hội trường Ủy ban nh&acirc;n d&acirc;n x&atilde;…` — and the public article page
 * printed them literally (rà soát 2026-10-23, bài Lào Cai 26/8). These pin the
 * decoder on the entity names actually found in the stored data, then drive the
 * real public handlers with such a row.
 */

const { decodeHtmlEntities, decodePlainTextInput, dropTruncatedEntity, plainTextField } = await import('../server/utils/decode-html-entities')

// Every name found in `articles.excerpt` of the dev database (2026-10-23), both cases.
const FOUND_IN_DATA: Record<string, string> = {
  agrave: 'à', aacute: 'á', ocirc: 'ô', igrave: 'ì', atilde: 'ã', acirc: 'â', ograve: 'ò',
  ugrave: 'ù', uacute: 'ú', oacute: 'ó', iacute: 'í', ecirc: 'ê', yacute: 'ý', eacute: 'é',
  Agrave: 'À', Ocirc: 'Ô', Aacute: 'Á', ldquo: '“', rdquo: '”', nbsp: ' ',
}

test('every entity name present in the stored excerpts decodes', () => {
  for (const [name, char] of Object.entries(FOUND_IN_DATA)) {
    assert.equal(decodeHtmlEntities(`x&${name};y`), `x${char}y`, name)
  }
})

test('the sentence from the report reads as Vietnamese', () => {
  assert.equal(
    decodeHtmlEntities('Ng&agrave;y 26/8, tại Hội trường Ủy ban nh&acirc;n d&acirc;n x&atilde; Bảo Thắng, C&ocirc;ng an tỉnh L&agrave;o Cai'),
    'Ngày 26/8, tại Hội trường Ủy ban nhân dân xã Bảo Thắng, Công an tỉnh Lào Cai',
  )
  assert.equal(decodeHtmlEntities('T?P HU?N C&Ocirc;NG T&Aacute;C'), 'T?P HU?N CÔNG TÁC', 'uppercase names (the old decoder missed them)')
})

test('one pass only, numeric forms, and nothing that is not a character', () => {
  assert.equal(decodeHtmlEntities('&amp;agrave;'), '&agrave;', '&amp; yields a literal, never decoded twice')
  assert.equal(decodeHtmlEntities('&#7841; &#x1EA1; &#X1ea1;'), 'ạ ạ ạ')
  assert.equal(decodeHtmlEntities('&#1114112; &#xD800; &#0;'), '&#1114112; &#xD800; &#0;', 'outside Unicode / surrogates / NUL stay as text — no RangeError')
  assert.equal(decodeHtmlEntities('&bogus; R&D &'), '&bogus; R&D &')
})

test('an entity cut off at the end of an entity-encoded excerpt is repaired (real tails from the dev DB)', () => {
  assert.equal(plainTextField('Th?c hi?n ch? tr??ng c?a ??ng, ch? ??ng tham m?u ?y ban nh&acirc;n d&acirc;n, nh&ac'), 'Th?c hi?n ch? tr??ng c?a ??ng, ch? ??ng tham m?u ?y ban nhân dân, nh…')
  assert.equal(plainTextField('D? h?i ngh? c&oacute; l&atild'), 'D? h?i ngh? có l…')
  assert.equal(plainTextField('T?a ?&agrave;m. Tham d? c&oac'), 'T?a ?àm. Tham d? c…')
  assert.equal(plainTextField('m&ocirc; h&igrave;nh ph&og'), 'mô hình ph…')
  assert.equal(plainTextField('x&agrave; l&agrave'), 'xà là…', 'a complete name cut just before its `;` is decoded')
  assert.equal(dropTruncatedEntity('đầy đủ.'), 'đầy đủ.')
  assert.equal(plainTextField(null), null)
})

test('a real ampersand at the end of plain text is never taken for a cut entity', () => {
  // Every capital letter starts some entity name (`D` → Dagger, `A` → Aacute): the
  // first version of the repair turned these into `R…` / `Q…` — on WRITE, too.
  for (const text of ['Phòng R&D', 'Hỏi đáp Q&A', 'AT&T', 'Phó trưởng phòng THAHS&HTT', 'Q&A', 'M&A']) {
    assert.equal(plainTextField(text), text, text)
    assert.equal(decodePlainTextInput(text), text, text)
  }
  assert.equal(plainTextField('Legal Q&amp;A'), 'Legal Q&A', 'an encoded `&amp;` decodes, nothing is cut')
  assert.equal(plainTextField('Join our R&amp;amp;D'), 'Join our R&amp;D', 'one pass')
  assert.equal(plainTextField('C&ocirc;ng THAHS&amp;HTT'), 'Công THAHS&HTT')
})

test('submitted text (admin form, AI translation) is decoded, never "repaired"', () => {
  assert.equal(decodePlainTextInput('  Ng&agrave;y 26/8 — Phòng R&D  '), 'Ngày 26/8 — Phòng R&D')
  assert.equal(decodePlainTextInput('x&agrave; R&D'), 'xà R&D')
})

// ─── The public handlers ─────────────────────────────────────────────────────

const STORED = {
  id: 1129, type: 'news', category: null, categoryId: 3, categoryName: 'Tin hoạt động', categorySlug: 'tin-hoat-dong',
  title: 'LÀO CAI: Tập huấn', slug: 'lao-cai', thumbnailUrl: null, publishedAt: null, createdAt: null, authorName: 'admin', viewTotal: 3,
  excerpt: 'Ng&agrave;y 26/8, tại Hội trường Ủy ban nh&acirc;n d&acirc;n x&atilde; Bảo Thắng',
  content: '<p>Ng&agrave;y 26/8</p>',
}

/** Any select chain; awaiting it yields the stored row (or a count). */
function select(projection?: Record<string, unknown>) {
  const rows = projection && 'total' in projection ? [{ total: 1 }] : [{ ...STORED }]
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'groupBy', 'limit', 'offset']) chain[method] = () => chain
  chain.then = (resolve: (value: unknown) => unknown) => resolve(rows)
  return chain
}
mock.module('../server/utils/db', { namedExports: { getDb: () => ({ select }) } })

type Event = { params: Record<string, string>, query: Record<string, string> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.getRouterParam = (event: Event, key: string) => event.params[key]
globals.getQuery = (event: Event) => event.query
globals.getCookie = () => undefined
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)
globals.setResponseHeader = () => {}
globals.setHeader = () => {}

const detail = (await import('../server/api/public/articles/[slug].get')).default as unknown as (event: Event) => Promise<{ article: typeof STORED }>
const list = (await import('../server/api/public/articles.get')).default as unknown as (event: Event) => Promise<{ articles: Array<typeof STORED> }>

const READABLE = 'Ngày 26/8, tại Hội trường Ủy ban nhân dân xã Bảo Thắng'

test('GET /api/public/articles/:slug returns the excerpt decoded; the HTML body is left alone', async () => {
  const { article } = await detail({ params: { slug: 'lao-cai' }, query: {} })
  assert.equal(article.excerpt, READABLE)
  assert.equal(article.content, STORED.content, 'content is rendered as HTML: entities there are correct')
})

test('GET /api/public/articles returns every listed excerpt decoded', async () => {
  const { articles } = await list({ params: {}, query: {} })
  assert.ok(articles.length > 0)
  for (const row of articles) assert.equal(row.excerpt, READABLE)
})

test('GET /api/public/articles/:slug?lang=en decodes the translation\'s title and excerpt too', async () => {
  // The fake returns the stored row for the translation lookup as well.
  const { article } = await detail({ params: { slug: 'lao-cai' }, query: { lang: 'en' } })
  assert.equal(article.excerpt, READABLE)
  assert.equal((article as unknown as { translatedFrom?: string }).translatedFrom, 'vi', 'the translation branch ran')
})
