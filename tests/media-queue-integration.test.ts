import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import mysql from 'mysql2/promise'
import { eq } from 'drizzle-orm'
import { initDb } from '../server/db/init.ts'
import { getDb, getPool, closeDb } from '../server/utils/db.ts'
import { mediaItems, users, activityLogs } from '../server/db/schema.ts'
import { resolveMediaConfig } from '../server/utils/media-config.ts'
import { processMediaItem, type ProcessRunner } from '../server/services/video-processing.ts'
import { reapStuckJobs, drainMediaQueue } from '../server/services/media-processing-reaper.ts'
import { enqueueMediaProcessing } from '../server/services/media-processing-queue.ts'
import { encodeShortId } from '../server/utils/short-media-id.ts'

test('MySQL queue admission, retries, heartbeat leases and generation fencing', {
  skip: process.env.MEDIA_QUEUE_INTEGRATION !== '1', timeout: 120_000,
}, async () => {
  const database = `cdkt_media_queue_${Date.now()}_${process.pid}`
  assert.match(database, /^cdkt_media_queue_\d+_\d+$/)
  const connection = {
    host: process.env.MEDIA_QUEUE_HOST || '127.0.0.1',
    port: Number(process.env.MEDIA_QUEUE_PORT || 3306), user: 'root',
    password: process.env.MEDIA_QUEUE_PASSWORD || '',
  }
  const old = { ...process.env }
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdkt-queue-integration-'))
  Object.assign(process.env, { DB_HOST: connection.host, DB_PORT: String(connection.port),
    DB_USER: connection.user, DB_PASSWORD: connection.password, DB_NAME: database })
  try {
    await initDb()
    const db = getDb()
    const pool = getPool()!
    const config = { ...resolveMediaConfig({ CDKT_MEDIA_WORKDIR: workdir, MEDIA_DISK_FLOOR_BYTES: 0 }), processingMaxAttempts: 2 }
    const options = { db, pool, config }
    const row = async (id: number) => (await db.select().from(mediaItems).where(eq(mediaItems.id, id)))[0]!
    async function seed(slug: string) {
      const shortId = encodeShortId()
      const [inserted] = await db.insert(mediaItems).values({ slug, shortId, title: slug, source: 'upload', storagePath: `media/${slug}` })
      const dir = path.join(workdir, 'media', slug)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, 'original.mp4'), Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(64)]))
      return inserted.insertId
    }
    const runner: ProcessRunner = async (command, args) => {
      if (command === 'ffprobe') return { code: 0, stdout: JSON.stringify({ streams: [{ codec_type: 'video', width: 640, height: 360 }], format: { duration: '2' } }), stderr: '' }
      const output = args.at(-1)!
      await fs.mkdir(path.dirname(output), { recursive: true })
      await fs.writeFile(output, output.endsWith('.jpg') ? 'thumbnail' : '#EXTM3U\nseg_000.ts\n')
      if (output.endsWith('.m3u8')) await fs.writeFile(path.join(path.dirname(output), 'seg_000.ts'), 'segment')
      return { code: 0, stdout: '', stderr: '' }
    }
    const first = await seed('first')
    const second = await seed('second')
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    const barrier = new Promise<void>(resolve => { release = resolve })
    const heldRunner: ProcessRunner = async (command, args, ctx) => {
      if (command === 'ffprobe') { enter(); await barrier }
      return runner(command, args, ctx)
    }
    const running = processMediaItem({ mediaItemId: first }, { ...options, run: heldRunner })
    await entered
    const [duplicate, other] = await Promise.all([
      processMediaItem({ mediaItemId: first }, { ...options, run: runner }),
      processMediaItem({ mediaItemId: second }, { ...options, run: runner }),
    ])
    assert.equal(duplicate.ok, false)
    assert.equal(other.ok, false)
    assert.equal((await row(second)).processingStatus, 'pending')
    assert.equal((await row(first)).processingAttempts, 1)
    release()
    assert.equal((await running).ok, true)
    assert.match((await row(first)).storagePath!, /\/generations\//)
    assert.equal((await processMediaItem({ mediaItemId: second }, { ...options, run: runner })).ok, true)

    const retry = await seed('retry')
    const failure: ProcessRunner = async command => ({ code: command === 'ffprobe' ? 0 : 1, stdout: '{}', stderr: 'transient failure' })
    assert.equal((await processMediaItem({ mediaItemId: retry }, { ...options, run: failure })).ok, false)
    assert.equal((await row(retry)).processingStatus, 'pending')
    assert.ok((await row(retry)).processingNextAttemptAt! > new Date())
    assert.equal((await processMediaItem({ mediaItemId: retry }, { ...options, run: runner })).ok, false)
    await db.update(mediaItems).set({ processingNextAttemptAt: null }).where(eq(mediaItems.id, retry))
    await processMediaItem({ mediaItemId: retry }, { ...options, run: failure })
    assert.equal((await row(retry)).processingStatus, 'failed')
    assert.equal((await row(retry)).processingAttempts, 2)
    const [admin] = await db.insert(users).values({ username: 'queue-admin', passwordHash: 'unused', fullName: 'Queue test' })
    await Promise.all([enqueueMediaProcessing(retry, admin.insertId, db), enqueueMediaProcessing(retry, admin.insertId, db)])
    assert.equal((await row(retry)).processingStatus, 'pending')
    assert.equal((await row(retry)).processingAttempts, 0)
    const audit = await db.select().from(activityLogs).where(eq(activityLogs.resourceId, retry))
    assert.equal(audit.length, 1, 'concurrent manual retries audit a single state transition')
    assert.equal((await processMediaItem({ mediaItemId: retry }, { ...options, run: runner })).ok, true)

    const fenced = await seed('fenced')
    let reached!: () => void
    let unfreeze!: () => void
    const reachedPromise = new Promise<void>(resolve => { reached = resolve })
    const freeze = new Promise<void>(resolve => { unfreeze = resolve })
    const oldWorker = processMediaItem({ mediaItemId: fenced }, { ...options, run: async (command, args, ctx) => {
      if (args.includes('-hls_segment_filename')) { reached(); await freeze }
      return runner(command, args, ctx)
    } })
    await reachedPromise
    const staleClaim = (await row(fenced)).claimedBy
    await db.update(mediaItems).set({ processingHeartbeatAt: new Date(Date.now() - 3600_000) }).where(eq(mediaItems.id, fenced))
    const reaped = await reapStuckJobs(options)
    assert.equal(reaped?.reclaimed, 1)
    await db.update(mediaItems).set({ processingNextAttemptAt: null }).where(eq(mediaItems.id, fenced))
    assert.equal((await processMediaItem({ mediaItemId: fenced }, { ...options, run: runner })).ok, true)
    const newPath = (await row(fenced)).storagePath!
    assert.ok(!newPath.includes(staleClaim!))
    const manifest = await fs.readFile(path.join(workdir, newPath, 'master.m3u8'), 'utf8')
    unfreeze()
    assert.equal((await oldWorker).ok, false)
    assert.equal((await row(fenced)).storagePath, newPath)
    assert.equal(await fs.readFile(path.join(workdir, newPath, 'master.m3u8'), 'utf8'), manifest)

    // A persisted pending row is visited without an upload request; missing original fails permanently.
    const [orphan] = await db.insert(mediaItems).values({ slug: 'pending-after-restart', shortId: encodeShortId(), title: 'pending', source: 'upload' })
    await drainMediaQueue(options)
    assert.equal((await row(orphan.insertId)).processingStatus, 'failed')
    assert.equal((await row(orphan.insertId)).processingAttempts, 1)
  } finally {
    await closeDb()
    for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
      if (old[key] === undefined) delete process.env[key]
      else process.env[key] = old[key]
    }
    const cleanup = await mysql.createConnection(connection)
    await cleanup.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await cleanup.end()
    await fs.rm(workdir, { recursive: true, force: true })
  }
})
