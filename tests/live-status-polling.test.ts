import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { drizzle } from 'drizzle-orm/mysql2'
import * as schema from '../server/db/schema'
import { createVisiblePoller, type VisiblePollerEnv } from '../app/utils/visible-poller'

/**
 * Live-status polling (spec live-status-polling, design D20).
 *
 * `LiveTickerBar` sits in the layout and asked `/api/public/livestream/active`
 * every 8 s on EVERY public page — including `/media`, where it never shows, and
 * from tabs nobody was looking at. `LiveHero` did the same on `/media`. Every
 * one of those requests was a database query.
 */

// ─── The poller, driven with a fake document and fake timers ─────────────────

function fakeEnv() {
  let hidden = false
  const listeners = new Set<() => void>()
  const timers = new Map<number, { fn: () => void, ms: number }>()
  let nextHandle = 1
  const env: VisiblePollerEnv = {
    isHidden: () => hidden,
    onVisibilityChange: (callback) => {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    setInterval: (fn, ms) => {
      const handle = nextHandle
      nextHandle += 1
      timers.set(handle, { fn, ms })
      return handle
    },
    clearInterval: (handle) => { timers.delete(handle as number) },
  }
  return {
    env,
    /** Fire every live interval `n` times — `n` × 8 s of wall time. */
    tick(n = 1) { for (let i = 0; i < n; i += 1) for (const timer of [...timers.values()]) timer.fn() },
    setHidden(value: boolean) {
      hidden = value
      for (const listener of [...listeners]) listener()
    },
    get timerCount() { return timers.size },
    get listenerCount() { return listeners.size },
  }
}

test('a hidden tab sends nothing, and one request on becoming visible again', () => {
  const fake = fakeEnv()
  let calls = 0
  const poller = createVisiblePoller(() => { calls += 1 }, 8_000, fake.env)
  poller.start(true)
  assert.equal(calls, 1, 'one request at mount')
  fake.tick(3)
  assert.equal(calls, 4)

  fake.setHidden(true)
  assert.equal(fake.timerCount, 0, 'the interval keeps running in a hidden tab')
  fake.tick(5 * 60 / 8) // five minutes in another tab
  assert.equal(calls, 4, 'a hidden tab polled')

  fake.setHidden(false)
  assert.equal(calls, 5, 'no immediate refresh when the tab comes back')
  assert.equal(fake.timerCount, 1)
  fake.tick()
  assert.equal(calls, 6)
})

test('where the ticker cannot show, nothing polls; leaving that page polls again at once', () => {
  const fake = fakeEnv()
  let calls = 0
  const poller = createVisiblePoller(() => { calls += 1 }, 8_000, fake.env)
  poller.start(false) // mounted on /media
  fake.tick(10)
  assert.equal(calls, 0, 'the ticker polled on /media, where it is hidden')
  assert.equal(fake.timerCount, 0)

  poller.setEnabled(true) // navigated away from /media
  assert.equal(calls, 1)
  fake.tick()
  assert.equal(calls, 2)

  poller.setEnabled(false)
  fake.tick(10)
  assert.equal(calls, 2)
})

test('a tab opened in the background does not poll until it is shown', () => {
  const fake = fakeEnv()
  fake.setHidden(true)
  let calls = 0
  const poller = createVisiblePoller(() => { calls += 1 }, 8_000, fake.env)
  poller.start(true)
  fake.tick(10)
  assert.equal(calls, 0)
  fake.setHidden(false)
  assert.equal(calls, 1)
})

test('stop removes the interval and the visibility listener', () => {
  const fake = fakeEnv()
  const poller = createVisiblePoller(() => {}, 8_000, fake.env)
  poller.start(true)
  poller.stop()
  assert.equal(fake.timerCount, 0)
  assert.equal(fake.listenerCount, 0, 'a listener left behind keeps polling after unmount')
})

// ─── The two components use it ───────────────────────────────────────────────

const component = (name: string) => readFileSync(new URL(`../app/components/${name}`, import.meta.url), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

test('LiveTickerBar and LiveHero pause on visibilitychange instead of a bare interval', () => {
  const util = readFileSync(new URL('../app/utils/visible-poller.ts', import.meta.url), 'utf8')
  assert.match(util, /'visibilitychange'/)
  for (const name of ['LiveTickerBar.vue', 'LiveHero.vue']) {
    const source = component(name)
    assert.match(source, /createVisiblePoller\(/, `${name} does not use the visibility-aware poller`)
    assert.match(source, /browserPollerEnv\(\)/, `${name} does not watch the document's visibility`)
    assert.doesNotMatch(source, /setInterval\(/, `${name} still runs its own interval`)
    assert.match(source, /\.stop\(\)/, `${name} never stops polling on unmount`)
  }
})

test('LiveTickerBar polls only where it can show', () => {
  const source = component('LiveTickerBar.vue')
  assert.match(source, /\.start\(!isOnMedia\.value\)/)
  assert.match(source, /setEnabled\(!/)
})

// ─── The server answers bursts from a 3-second cache ─────────────────────────

const VIDEO_ID = 'dQw4w9WgXcQ'

function liveDb() {
  let active = false
  let activeSelects = 0
  const normalize = (arg1: unknown) => {
    const obj = (arg1 && typeof arg1 === 'object') ? arg1 as { sql: string } : null
    return String(obj ? obj.sql : arg1).trim().replace(/\s+/g, ' ')
  }
  const dispatch = async (arg1: unknown) => {
    const sql = normalize(arg1)
    if (/^(begin|commit|rollback)$/i.test(sql)) return [{}, []]
    if (/GET_LOCK/.test(sql)) return [[{ acquired: 1 }]]
    if (/RELEASE_LOCK/.test(sql)) return [[{ released: 1 }]]
    if (/^select `id`, `title`, `description`, `source`, `youtube_video_id`, `storage_path`, `thumbnail_url`, `started_at` from `livestream_sessions`/i.test(sql)) {
      activeSelects += 1
      return active ? [[[7, 'Buổi phát', null, 'youtube', VIDEO_ID, null, null, null]], []] : [[], []]
    }
    if (/^select `id` from `livestream_sessions` where `livestream_sessions`\.`is_active` = \?/i.test(sql)) return active ? [[[7]], []] : [[], []]
    if (/^insert into `livestream_sessions`/i.test(sql)) { active = true; return [{ insertId: 7, affectedRows: 1 }, []] }
    if (/^update `livestream_sessions` set `is_active` = \?, `ended_at` = \?/i.test(sql)) { active = false; return [{ affectedRows: 1 }, []] }
    if (/^insert into `activity_logs`/i.test(sql)) return [{ insertId: 1, affectedRows: 1 }, []]
    throw new Error(`unexpected statement: ${sql}`)
  }
  const pool = {
    async getConnection() { return { query: dispatch, release() {} } },
    query: dispatch,
    execute: dispatch,
    end: async () => {},
  }
  return {
    db: drizzle(pool as never, { schema, mode: 'default' }),
    pool: pool as never,
    get activeSelects() { return activeSelects },
  }
}

test('100 requests inside one second cost one query; the cache lapses after 3 seconds', async () => {
  const live = await import('../server/services/livestream.ts')
  live.invalidateActiveLivestreamCache()
  const fake = liveDb()
  let clock = 10_000_000
  const read = () => live.getActiveLivestreamCached({ db: fake.db, now: () => clock })

  const answers = await Promise.all(Array.from({ length: 100 }, (_, i) => {
    clock = 10_000_000 + i * 9 // spread over ~0.9 s, all concurrent
    return read()
  }))
  assert.equal(fake.activeSelects, 1, 'every request in the burst went to the database')
  assert.ok(answers.every(answer => answer === null))

  clock = 10_000_000 + 3_001
  await read()
  assert.equal(fake.activeSelects, 2, 'the cache never expires')
})

test('starting and stopping in this process are visible on the next read, not 3 seconds later', async () => {
  const live = await import('../server/services/livestream.ts')
  live.invalidateActiveLivestreamCache()
  const fake = liveDb()
  const clock = 20_000_000
  const read = () => live.getActiveLivestreamCached({ db: fake.db, now: () => clock })

  assert.equal(await read(), null)
  const started = await live.startLivestream({ title: 'Buổi phát', createdBy: 1, youtubeVideoId: VIDEO_ID }, { db: fake.db, pool: fake.pool })
  assert.equal(started.ok, true)
  assert.equal((await read())?.id, 7, 'a started broadcast stayed invisible for the cache window')

  const stopped = await live.stopLivestream({ sessionId: 7, actorId: 1 }, { db: fake.db })
  assert.equal(stopped.ok, true)
  assert.equal(await read(), null, 'a stopped broadcast was still reported as live')
})

test('a failed read is not cached', async () => {
  const live = await import('../server/services/livestream.ts')
  live.invalidateActiveLivestreamCache()
  let attempts = 0
  const failing = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => { attempts += 1; throw new Error('ECONNREFUSED') } }) }) }),
  }
  const read = () => live.getActiveLivestreamCached({ db: failing as never, now: () => 30_000_000 })
  await assert.rejects(read(), /ECONNREFUSED/)
  await assert.rejects(read(), /ECONNREFUSED/)
  assert.equal(attempts, 2, 'one database blip was replayed to every caller for 3 seconds')
})

test('the public status endpoint reads through the cache', () => {
  const source = readFileSync(new URL('../server/api/public/livestream/active.get.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.match(source, /await getActiveLivestreamCached\(\)/)
  assert.doesNotMatch(source, /await getActiveLivestream\(\)/)
})
