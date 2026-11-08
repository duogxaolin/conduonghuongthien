import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'
import { createError } from 'h3'

/**
 * The slug → item lookups of the two public comment endpoints, run as the real handlers (real h3
 * app, Drizzle's own MySQL statements executed on SQLite — tests/_sqlite-mysql-db.ts):
 *
 *   - `GET /api/public/comments/:slug[?source=media]` — the item is looked up in the table the
 *     `source` names (an article by `slug`, a video by `short_id`), published only, with ITS OWN
 *     `comments_enabled`; unknown, unpublished and closed all answer the same empty thread;
 *   - `POST /api/public/comments` — `articleSlug` XOR `mediaSlug`, the item published, its id
 *     handed to `createComment` (the write path, faked here: its ordering of rate limits and
 *     moderation is pinned by the comment-service suites), `last_seen_at` stamped after success.
 *
 * Reader sessions are faked (`reader-auth`); the comment service is faked except its pure rules
 * (`validateBody`, `parseCommentSource`), imported real from `comments-rules.ts`.
 */

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { articles, mediaItems } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([articles, mediaItems])

mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

let reader: { id: number } | null = null
const touched: number[] = []
mock.module('../server/utils/reader-auth', {
  namedExports: {
    optionalReader: async () => reader,
    requireReader: async () => {
      if (!reader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
      return reader
    },
    touchReader: async (_event: unknown, readerId: number) => { touched.push(readerId) },
  },
})

const rules = await import('../server/services/comments-rules')
const { PUBLISHED_MEDIA_STATUS } = await import('../server/services/media-portal-constants')
const threads: Array<Record<string, unknown>> = []
const created: Array<Record<string, unknown>> = []
let createResult: Record<string, unknown> = { ok: true, id: 501 }
mock.module('../server/services/comments', {
  namedExports: {
    COMMENT_MAX_PER_PAGE: 50,
    validateBody: rules.validateBody,
    parseCommentSource: rules.parseCommentSource,
    loadCommentThread: async (params: Record<string, unknown>) => {
      threads.push(params)
      return { comments: [{ id: 1, body: 'Một bình luận' }], total: 1, page: params.page, perPage: params.perPage, totalPages: 1 }
    },
    createComment: async (input: Record<string, unknown>) => {
      const { event: _event, ...rest } = input
      created.push(rest)
      return createResult
    },
  },
})
mock.module('../server/services/media-portal', { namedExports: { PUBLISHED_MEDIA_STATUS } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const thread = (await import('../server/api/public/comments/[articleSlug].get')).default
const post = (await import('../server/api/public/comments/index.post')).default
const server = await startHandlerServer([
  { method: 'get', path: '/api/public/comments/:articleSlug', handler: thread },
  { method: 'post', path: '/api/public/comments', handler: post },
])
after(() => server.close())

type Seed = typeof articles.$inferInsert
const article = (id: number, slug: string, over: Partial<Seed> = {}): Seed => ({ id, slug, title: `Bài ${slug}`, type: 'news', status: 'published', commentsEnabled: true, ...over })
type MediaSeed = typeof mediaItems.$inferInsert
const media = (id: number, shortId: string, over: Partial<MediaSeed> = {}): MediaSeed => ({ id, shortId, slug: `video-${shortId}`, title: `Video ${shortId}`, status: 'published', commentsEnabled: true, ...over })

beforeEach(async () => {
  harness.reset()
  reader = null
  touched.length = 0
  threads.length = 0
  created.length = 0
  createResult = { ok: true, id: 501 }
  await harness.db.insert(articles).values([
    article(1, 'bai-mo'),
    article(2, 'bai-dong', { commentsEnabled: false }),
    article(3, 'bai-nhap', { status: 'draft' }),
    // Same string as a video's short_id: the table is chosen by `source`, never guessed.
    article(4, 'trung1234'),
  ])
  await harness.db.insert(mediaItems).values([
    media(10, 'trung1234'),
    media(11, 'dong5678', { commentsEnabled: false }),
    media(12, 'nhap9012', { status: 'draft' }),
  ])
  harness.statements.length = 0
})

const empty = (page = 1, perPage = 20) => ({ ok: true, enabled: false, signedIn: false, comments: [], total: 0, page, perPage, totalPages: 1 })

test('GET: an open article thread is read by the article id, with the viewer and the page', async () => {
  reader = { id: 77 }
  const response = await server.request('GET', '/api/public/comments/bai-mo?page=2&perPage=5')
  assert.equal(response.status, 200)
  assert.deepEqual(threads, [{ articleId: 1, page: 2, perPage: 5, viewerReaderId: 77 }])
  assert.deepEqual(response.body, { ok: true, enabled: true, signedIn: true, comments: [{ id: 1, body: 'Một bình luận' }], total: 1, page: 2, perPage: 5, totalPages: 1 })
})

test('GET: the same string is the article without `source` and the video with `source=media`', async () => {
  await server.request('GET', '/api/public/comments/trung1234')
  await server.request('GET', '/api/public/comments/trung1234?source=media')
  assert.deepEqual(threads, [
    { articleId: 4, page: 1, perPage: 20, viewerReaderId: null },
    { mediaItemId: 10, page: 1, perPage: 20, viewerReaderId: null },
  ])
  assert.match(harness.statements[0]!, /from `articles` where \(`articles`\.`slug` = \? and `articles`\.`status` = \?\)/)
  assert.match(harness.statements[1]!, /from `media_items` where \(`media_items`\.`short_id` = \? and `media_items`\.`status` = \?\)/)
})

test('GET: unknown, unpublished and closed — article or video — all answer the same empty thread', async () => {
  reader = { id: 77 }
  for (const path of [
    '/api/public/comments/khong-co',
    '/api/public/comments/bai-nhap',
    '/api/public/comments/bai-dong',
    '/api/public/comments/khong-co?source=media',
    '/api/public/comments/nhap9012?source=media',
    '/api/public/comments/dong5678?source=media',
    // A video short_id asked for as an article, and an article slug asked for as a video.
    '/api/public/comments/dong5678',
    '/api/public/comments/bai-mo?source=media',
  ]) {
    const response = await server.request('GET', path)
    assert.equal(response.status, 200, path)
    assert.deepEqual(response.body, empty(), path)
  }
  assert.deepEqual(threads, [], 'no thread is read for a closed or invisible item')
})

test('GET: an unknown `source` is refused before any lookup', async () => {
  const response = await server.request('GET', '/api/public/comments/bai-mo?source=1')
  assert.equal(response.status, 400)
  assert.deepEqual(harness.statements, [])
})

const send = (body: unknown) => server.request('POST', '/api/public/comments', { body })

test('POST: an article comment goes to createComment with the published article\'s id; last_seen_at is stamped', async () => {
  reader = { id: 77 }
  const response = await send({ articleSlug: '  bai-mo  ', body: 'Xin hỏi', parentId: 3.7 })
  assert.equal(response.status, 201)
  assert.deepEqual(response.body, { ok: true, id: 501 })
  assert.equal(created.length, 1)
  assert.deepEqual({ ...created[0], userAgent: undefined }, { readerId: 77, articleId: 1, parentId: 3, body: 'Xin hỏi', ip: '127.0.0.1', userAgent: undefined })
  assert.deepEqual(touched, [77])
  // The lookup is the only statement here: the write itself belongs to createComment.
  assert.equal(harness.statements.length, 1)
  assert.match(harness.statements[0]!, /^select `id` from `articles` where \(`articles`\.`slug` = \? and `articles`\.`status` = \?\) limit \?$/)
})

test('POST: a video comment is looked up by short_id, published only', async () => {
  reader = { id: 77 }
  const response = await send({ mediaSlug: 'trung1234', body: 'Về video này' })
  assert.equal(response.status, 201)
  assert.deepEqual(created.map(input => [input.mediaItemId, input.articleId, input.parentId]), [[10, undefined, null]])
  assert.match(harness.statements[0]!, /^select `id` from `media_items` where \(`media_items`\.`short_id` = \? and `media_items`\.`status` = \?\) limit \?$/)
})

test('POST: an unpublished or unknown item is a 404 and nothing is written', async () => {
  reader = { id: 77 }
  for (const [body, message] of [
    [{ articleSlug: 'bai-nhap', body: 'x' }, /Bài viết không tồn tại/],
    [{ articleSlug: 'khong-co', body: 'x' }, /Bài viết không tồn tại/],
    [{ mediaSlug: 'nhap9012', body: 'x' }, /Video không tồn tại/],
    [{ mediaSlug: 'bai-mo', body: 'x' }, /Video không tồn tại/],
  ] as const) {
    const response = await send(body)
    assert.equal(response.status, 404, JSON.stringify(body))
    assert.match(String(response.body.message ?? response.body.statusMessage), message)
  }
  assert.deepEqual(created, [])
  assert.deepEqual(touched, [])
})

test('POST: both slugs, neither, a bad body or a bad parent is a 400 before any lookup', async () => {
  reader = { id: 77 }
  for (const body of [
    { articleSlug: 'bai-mo', mediaSlug: 'trung1234', body: 'x' },
    { body: 'x' },
    { articleSlug: 'bai-mo', body: '' },
    { articleSlug: 'bai-mo', body: 'x', parentId: -1 },
    [1, 2],
  ]) {
    const response = await send(body)
    assert.equal(response.status, 400, JSON.stringify(body))
  }
  assert.deepEqual(harness.statements, [])
  assert.deepEqual(created, [])
})

test('POST: signed out is refused before anything; a refusal from createComment is passed on with Retry-After', async () => {
  const signedOut = await send({ articleSlug: 'bai-mo', body: 'x' })
  assert.equal(signedOut.status, 401)
  assert.deepEqual(harness.statements, [])

  reader = { id: 77 }
  createResult = { ok: false, statusCode: 429, message: 'Bạn bình luận quá nhanh.', retryAfterSeconds: 30 }
  const limited = await send({ articleSlug: 'bai-mo', body: 'x' })
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get('retry-after'), '30')
  assert.deepEqual(touched, [], 'a refused comment does not count as activity')
})
