import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test, { after, mock } from 'node:test'

/**
 * `POST /api/public/articles/:slug/view` — per-source ceiling (spec rate-limiting,
 * design D17).
 *
 * The only brake was the per-(article, visitor, day) dedupe, and the visitor is
 * an HMAC of IP + User-Agent: rotating the User-Agent from one address minted a
 * fresh visitor per request, so one script could add a real view to every
 * article as fast as it could post. Now at most 60 views per source (IPv6 by
 * /64) per 10 minutes are counted, across all articles; the rest still get 202
 * and count nothing.
 *
 * Real handler, real `getClientIp` (loopback is a trusted proxy by default, so
 * `X-Forwarded-For` names the client), real rate-limit store (in-process memory,
 * as when the pool is unavailable). Only the database and the counter write are
 * fakes.
 */

let articleId = 1
const recorded: Array<{ articleId: number }> = []

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
    recordArticleView: async (input: { articleId: number }) => { recorded.push({ articleId: input.articleId }) },
  },
})

;(globalThis as Record<string, unknown>).useRuntimeConfig = () => ({ analytics: { hmacSecret: 'e2e-view-ceiling-secret-0123456789abcdef' } })

const { createApp, createRouter, toNodeListener } = await import('h3')
const handler = (await import('../server/api/public/articles/[slug]/view.post.ts')).default
const router = createRouter()
router.post('/api/public/articles/:slug/view', handler)
const server = createServer(toNodeListener(createApp().use(router)))
await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()) })
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
after(() => { server.close() })

async function view(ip: string, userAgent: string, slug = 'bai-viet') {
  const response = await fetch(`${origin}/api/public/articles/${slug}/view`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'user-agent': userAgent },
    body: JSON.stringify({ sourceCategory: 'direct' }),
  })
  const body = await response.json() as { accepted: boolean }
  return { status: response.status, accepted: body.accepted }
}

test('one address rotating User-Agents over 100 articles gets at most 60 counted views, every answer 202', async () => {
  recorded.length = 0
  const statuses = new Set<number>()
  for (let i = 0; i < 100; i += 1) {
    articleId = 1000 + i
    const { status } = await view('203.0.113.50', `Mozilla/5.0 rotating-${i}`, `bai-${i}`)
    statuses.add(status)
  }
  assert.deepEqual([...statuses], [202], 'over the ceiling must look exactly like any other answer')
  assert.equal(recorded.length, 60, 'the 61st view from one address inside 10 minutes was counted')
})

test('IPv6 addresses in one /64 share the ceiling; another /64 does not', async () => {
  recorded.length = 0
  for (let i = 0; i < 60; i += 1) {
    articleId = 2000 + i
    await view(`2001:db8:aa:1::${(i + 1).toString(16)}`, `ua-${i}`)
  }
  assert.equal(recorded.length, 60)
  articleId = 3000
  const rotated = await view('2001:db8:aa:1:ffff:ffff:ffff:fffe', 'ua-new')
  assert.equal(rotated.status, 202)
  assert.equal(rotated.accepted, false, 'a fresh interface id in the same /64 escaped the ceiling')
  assert.equal(recorded.length, 60)

  const elsewhere = await view('2001:db8:bb:2::1', 'ua-other')
  assert.equal(elsewhere.accepted, true, 'another subscriber was throttled by someone else\'s traffic')
  assert.equal(recorded.length, 61)
})

test('under the ceiling the per-article dedupe still applies', async () => {
  recorded.length = 0
  articleId = 4000
  const first = await view('198.51.100.7', 'same-agent')
  const reload = await view('198.51.100.7', 'same-agent')
  assert.equal(first.accepted, true)
  assert.equal(reload.accepted, false, 'a reload inside the dedupe window counted twice')
  assert.equal(recorded.length, 1)
})
