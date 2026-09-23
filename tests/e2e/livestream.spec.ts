/**
 * E2E: livestream start → active → stop → 409 on double-stop.
 *
 * `livestream-toggle.test.ts` kiểm logic bằng fake pool; `livestream-toggle-integration.test.ts`
 * kiểm race + rollback trên MySQL thật; cả hai đều **không đi qua HTTP**. Spec
 * này đi qua stack Nitro thật: RBAC (`requireResourcePermission`), `readBody`,
 * `createError` mapStatusCode, và service `startLivestream`/`stopLivestream`
 * dùng `withNamedLock` + `GET_LOCK` — đúng phần mà chỉ một server chạy mới exercised.
 *
 * Chỉ玩了 endpoint contracts, không dựng trang `/admin/livestream` (UI đã có
 * spec `media-portal.spec.ts` cho pattern CRUD; livestream UI là start/stop đơn).
 *
 * Yêu cầu: `npm run build` + MySQL chạy./global-setup tạo DB throwaway.
 */
import { expect, test, type Page } from '@playwright/test'
import { E2E_ADMIN_USERNAME, E2E_PASSWORD_ENV } from './harness'

async function login(page: Page, username = E2E_ADMIN_USERNAME, password = process.env[E2E_PASSWORD_ENV]!) {
  if (!password) throw new Error('E2E admin password missing')
  await page.goto('/admin/login')
  await page.getByRole('textbox').first().fill(username)
  await page.locator('input[autocomplete="current-password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Xin chào', { timeout: 20_000 })
}

test('start creates a session, 409 on second start while active, stop ends it, double-stop is 409', async ({ page }) => {
  await login(page)

  // ── Start ──
  const start = await page.request.post('/api/admin/livestream/start', {
    data: {
      title:        `E2E livestream ${Date.now()}`,
      description:  'Kiểm chứng endpoint start/stop qua HTTP.',
      source:       'youtube',
      youtubeVideoId: 'dQw4w9WgXcQ',
    },
  })
  expect(start.status()).toBe(201)
  const started = await start.json()
  expect(started.ok).toBe(true)
  expect(typeof started.sessionId).toBe('number')
  const sessionId: number = started.sessionId

  // ── Second start while the first is active: 409 ──
  const second = await page.request.post('/api/admin/livestream/start', {
    data: {
      title:          `E2E livestream second ${Date.now()}`,
      source:         'youtube',
      youtubeVideoId: 'dQw4w9WgXcQ',
    },
  })
  expect(second.status()).toBe(409)

  // ── Active session visible on public endpoint ──
  const active = await page.request.get('/api/public/livestream/active')
  expect(active.status()).toBe(200)
  const activeBody = await active.json()
  expect(activeBody.ok).toBe(true)
  expect(activeBody.active).toBe(true)
  expect(activeBody.session?.id).toBe(sessionId)

  // ── Stop ──
  const stop = await page.request.post('/api/admin/livestream/stop', { data: { sessionId } })
  expect(stop.status()).toBe(200)
  const stopped = await stop.json()
  expect(stopped.ok).toBe(true)

  // ── Double-stop: 409 (already stopped), not 404 ──
  const doubleStop = await page.request.post('/api/admin/livestream/stop', { data: { sessionId } })
  expect(doubleStop.status()).toBe(409)

  // ── Stop a non-existent session: 404 ──
  const missingStop = await page.request.post('/api/admin/livestream/stop', { data: { sessionId: 9_999_999 } })
  expect(missingStop.status()).toBe(404)

  // ── Active is false after stop ──
  const activeAfter = await page.request.get('/api/public/livestream/active')
  expect(activeAfter.status()).toBe(200)
  const afterBody = await activeAfter.json()
  expect(afterBody.ok).toBe(true)
  expect(afterBody.active).toBe(false)
  expect(afterBody.session).toBeNull()
})

test('start rejects a missing title with 400 and never takes the lock', async ({ page }) => {
  await login(page)

  const bad = await page.request.post('/api/admin/livestream/start', {
    data: {
      // no title — service rejects before GET_LOCK
      source:         'youtube',
      youtubeVideoId: 'dQw4w9WgXcQ',
    },
  })
  expect(bad.status()).toBe(400)

  // A valid start immediately after must succeed — the bad request did not
  // leave the `cdkt:livestream:active` lock held.
  const good = await page.request.post('/api/admin/livestream/start', {
    data: {
      title:          `E2E after bad start ${Date.now()}`,
      source:         'youtube',
      youtubeVideoId: 'dQw4w9WgXcQ',
    },
  })
  expect(good.status()).toBe(201)
  const cleanup = await good.json()
  // Stop it so the next spec run does not inherit an active session.
  await page.request.post('/api/admin/livestream/stop', { data: { sessionId: cleanup.sessionId } })
})

test('start with empty object body is 400, not 500', async ({ page }) => {
  await login(page)

  const empty = await page.request.post('/api/admin/livestream/start', { data: {} })
  expect(empty.status()).toBe(400)
})
