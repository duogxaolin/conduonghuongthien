import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test, { after, mock } from 'node:test'

/**
 * The day of a view is the Việt Nam calendar day (UTC+7), from 2026-10-31 — through the two
 * real handlers, `POST /api/public/articles/:slug/view` and `POST /api/public/media/:shortId/view`.
 *
 * Each handler computes `viewDay()` once and uses it twice: in the visitor token (the
 * 10-minute reload dedupe is keyed on it) and, for articles, as the `article_view_daily`
 * row. So the day shows in behaviour, not only in the stored row:
 *   - across 00:00 in Hà Nội (17:00 UTC) the token changes — a second view six minutes
 *     later is a new day's view, counted on the new day;
 *   - across 00:00 UTC (07:00 in Hà Nội) nothing changes — a reload six minutes later is
 *     the same day's reload, not counted.
 * Under the old UTC day both were the other way round. Rows written before the change keep
 * their UTC day (no backfill).
 *
 * Real handlers, real `getClientIp`, real token derivation, real rate-limit store (in-process
 * memory, as when the pool is unavailable). Only the database lookups and the counter writes
 * are fakes. Run for three process time zones: the answer must not depend on `TZ`.
 */

const recordedArticleViews: Array<{ articleId: number, day: string | undefined }> = []
const recordedMediaViews: number[] = []
let articleId = 1

mock.module('../server/utils/db', {
  namedExports: {
    getPool: () => null,
    getDb: () => ({
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: articleId }] }) }) }),
    }),
  },
})

const realViews = await import('../server/services/article-views')
mock.module('../server/services/article-views', {
  namedExports: {
    ...realViews,
    recordArticleView: async (input: { articleId: number, day?: string }) => { recordedArticleViews.push({ articleId: input.articleId, day: input.day }) },
  },
})

const { MEDIA_VIEW_DEDUPE_RULE } = await import('../server/services/media-portal-constants')
const { buildMediaViewDedupeKey } = await import('../server/services/media-views')
mock.module('../server/services/media-portal', {
  namedExports: {
    MEDIA_VIEW_DEDUPE_RULE,
    buildMediaViewDedupeKey,
    resolvePublishedMediaIdByShortId: async (shortId: string) => Number(shortId.replace(/\D/g, '')),
    recordMediaView: async (mediaItemId: number) => { recordedMediaViews.push(mediaItemId) },
  },
})

;(globalThis as Record<string, unknown>).useRuntimeConfig = () => ({ analytics: { hmacSecret: 'view-day-vn-secret-0123456789abcdef0123' } })

const { createApp, createRouter, toNodeListener } = await import('h3')
const router = createRouter()
router.post('/api/public/articles/:slug/view', (await import('../server/api/public/articles/[slug]/view.post.ts')).default)
router.post('/api/public/media/:shortId/view', (await import('../server/api/public/media/[shortId]/view.post.ts')).default)
const server = createServer(toNodeListener(createApp().use(router)))
await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()) })
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
after(() => { server.close() })

async function post(path: string, ip: string, at: string) {
  mock.timers.setTime(Date.parse(at))
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'user-agent': 'Mozilla/5.0 view-day' },
    body: JSON.stringify({ sourceCategory: 'direct' }),
  })
  assert.equal(response.status, 202)
  return (await response.json() as { accepted: boolean }).accepted
}

const ZONES = ['UTC', 'Asia/Ho_Chi_Minh', 'America/Los_Angeles']

ZONES.forEach((zone, index) => {
  test(`article views (TZ=${zone}): the row and the reload dedupe follow the Việt Nam day`, async () => {
    const before = process.env.TZ
    process.env.TZ = zone
    mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-08-01T16:00:00Z') })
    try {
      recordedArticleViews.length = 0
      const ip = `203.0.113.${10 + index}`

      // 23:55 → 00:01 in Hà Nội, six minutes apart: a new day, so a new view on the new day.
      articleId = 100 + index
      assert.equal(await post('/api/public/articles/bai-viet/view', ip, '2026-08-01T16:55:00Z'), true)
      assert.equal(await post('/api/public/articles/bai-viet/view', ip, '2026-08-01T17:01:00Z'), true, 'a view after midnight in Hà Nội was taken for a reload of the day before')

      // 06:55 → 07:01 in Hà Nội (midnight UTC), six minutes apart: the same day, so a reload.
      articleId = 200 + index
      assert.equal(await post('/api/public/articles/bai-viet/view', ip, '2026-08-01T23:55:00Z'), true)
      assert.equal(await post('/api/public/articles/bai-viet/view', ip, '2026-08-02T00:01:00Z'), false, 'a reload at midnight UTC was counted as a new day\'s view')

      assert.deepEqual(recordedArticleViews, [
        { articleId: 100 + index, day: '2026-08-01' },
        { articleId: 100 + index, day: '2026-08-02' },
        { articleId: 200 + index, day: '2026-08-02' },
      ])
    } finally {
      mock.timers.reset()
      if (before === undefined) delete process.env.TZ
      else process.env.TZ = before
    }
  })

  test(`media views (TZ=${zone}): the reload dedupe follows the Việt Nam day`, async () => {
    const before = process.env.TZ
    process.env.TZ = zone
    mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-08-01T16:00:00Z') })
    try {
      recordedMediaViews.length = 0
      const ip = `198.51.100.${10 + index}`

      assert.equal(await post(`/api/public/media/v${300 + index}/view`, ip, '2026-08-01T16:55:00Z'), true)
      assert.equal(await post(`/api/public/media/v${300 + index}/view`, ip, '2026-08-01T17:01:00Z'), true, 'a view after midnight in Hà Nội was taken for a reload of the day before')

      assert.equal(await post(`/api/public/media/v${400 + index}/view`, ip, '2026-08-01T23:55:00Z'), true)
      assert.equal(await post(`/api/public/media/v${400 + index}/view`, ip, '2026-08-02T00:01:00Z'), false, 'a reload at midnight UTC was counted as a new day\'s view')

      assert.deepEqual(recordedMediaViews, [300 + index, 300 + index, 400 + index])
    } finally {
      mock.timers.reset()
      if (before === undefined) delete process.env.TZ
      else process.env.TZ = before
    }
  })
})
