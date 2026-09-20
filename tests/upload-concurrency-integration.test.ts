import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import mysql from 'mysql2/promise'
import { eq } from 'drizzle-orm'
import { initDb } from '../server/db/init.ts'
import { getDb, getPool, closeDb } from '../server/utils/db.ts'
import { mediaItems, mediaUploadSessions, users, activityLogs } from '../server/db/schema.ts'
import { resolveMediaConfig } from '../server/utils/media-config.ts'
import { initUpload, receiveChunk, completeUpload, uploadStatus, chunkBodyLimit, housekeepUploads } from '../server/services/chunked-upload.ts'

test('MySQL upload receipt union, completion fencing, crash recovery and cleanup races', {
  skip: process.env.MEDIA_UPLOAD_INTEGRATION !== '1', timeout: 120_000,
}, async () => {
  const database = `cdkt_upload_audit_${Date.now()}_${process.pid}`
  assert.match(database, /^cdkt_upload_audit_\d+_\d+$/)
  const connection = { host: '127.0.0.1', port: Number(process.env.MEDIA_UPLOAD_PORT || 3306),
    user: 'root', password: process.env.MEDIA_UPLOAD_PASSWORD || '' }
  const old = { ...process.env }
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdkt-upload-integration-'))
  Object.assign(process.env, { DB_HOST: connection.host, DB_PORT: String(connection.port), DB_USER: connection.user,
    DB_PASSWORD: connection.password, DB_NAME: database })
  try {
    await initDb()
    const db = getDb()
    const pool = getPool()!
    const [admin] = await db.insert(users).values({ username: 'upload-admin', fullName: 'Upload test', passwordHash: 'unused' })
    const config = { ...resolveMediaConfig({ CDKT_MEDIA_WORKDIR: workdir, MEDIA_UPLOAD_ENABLED: 1, MEDIA_DISK_FLOOR_BYTES: 0 }), chunkSize: 1024 }
    const options = { db, pool, config, dispatchProcessing: async () => undefined }
    const part = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(1012)])
    const owner = admin.insertId
    const open = async (size = 2048) => {
      const result = await initUpload({ adminUserId: owner, filename: 'original.mp4', declaredSize: size }, options)
      assert.equal(result.ok, true)
      if (!result.ok) throw new Error(result.message)
      return result.uploadId
    }
    const send = (uploadId: string, index: number, body = part) => receiveChunk({ adminUserId: owner, uploadId, index, body }, options)
    const finish = (uploadId: string) => completeUpload({ adminUserId: owner, uploadId }, options)
    const session = async (uploadId: string) => (await db.select().from(mediaUploadSessions).where(eq(mediaUploadSessions.uploadId, uploadId)))[0]!
    const id = await open()
    const received = await Promise.all([send(id, 0), send(id, 1), send(id, 0)])
    assert.ok(received.every(result => result.ok))
    assert.deepEqual((await session(id)).receivedParts, [0, 1])
    const originalPart = await fs.readFile(path.join(workdir, 'uploads', id, '0.part'))
    const duplicate = await send(id, 0, Buffer.alloc(1024, 9))
    assert.ok(duplicate.ok && duplicate.duplicate)
    assert.deepEqual(await fs.readFile(path.join(workdir, 'uploads', id, '0.part')), originalPart)
    const stranger = await chunkBodyLimit({ adminUserId: owner + 1, uploadId: id, index: 0 }, options)
    assert.ok(!stranger.ok && stranger.status === 404)
    const cap = await chunkBodyLimit({ adminUserId: owner, uploadId: id, index: 0 }, { ...options, config: { ...config, chunkSize: 1 } })
    assert.ok(cap.ok && cap.bytes === 1024, 'stored geometry survives runtime chunk-size changes')

    const completed = await Promise.all([finish(id), finish(id)])
    assert.ok(completed.some(result => result.ok))
    assert.ok(completed.every(result => result.ok || result.status === 409))
    const again = await finish(id)
    assert.ok(again.ok)
    assert.equal((await db.select().from(mediaItems)).length, 1)
    assert.equal((await db.select().from(activityLogs)).length, 1)
    assert.equal((await session(id)).mediaItemId, again.mediaItemId)
    assert.equal((await fs.stat(path.join(workdir, 'media', id, 'original.mp4'))).size, 2048)

    // A DB failure after the source rename simulates the recoverable crash window.
    const crash = await open(1024)
    await send(crash, 0)
    await pool.query("CREATE TRIGGER reject_upload_audit BEFORE INSERT ON activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected audit failure'")
    const rejected = await finish(crash)
    assert.ok(!rejected.ok && rejected.status === 503)
    assert.equal((await db.select().from(mediaItems)).length, 1, 'media creation rolled back with failed audit')
    assert.equal((await session(crash)).status, 'pending')
    assert.equal((await fs.stat(path.join(workdir, 'media', crash, 'original.mp4'))).size, 1024)
    assert.equal((await fs.stat(path.join(workdir, 'uploads', crash, '0.part'))).size, 1024)
    await pool.query('DROP TRIGGER reject_upload_audit')
    const recovered = await finish(crash)
    assert.ok(recovered.ok)
    const recoveredAgain = await finish(crash)
    assert.ok(recoveredAgain.ok && recoveredAgain.mediaItemId === recovered.mediaItemId)
    assert.equal((await db.select().from(mediaItems)).length, 2)
    assert.equal((await db.select().from(activityLogs)).length, 2)

    const lease = await open(1024)
    await send(lease, 0)
    const ancient = new Date(Date.now() - 72 * 3600_000)
    await db.update(mediaUploadSessions).set({ status: 'assembling', completionClaim: '11111111-1111-4111-8111-111111111111',
      completionHeartbeatAt: new Date(), updatedAt: ancient }).where(eq(mediaUploadSessions.uploadId, lease))
    assert.equal((await housekeepUploads(options)).sessions, 0, 'valid assembly lease survives a stale activity timestamp')
    assert.ok(!(await finish(lease)).ok)
    await db.update(mediaUploadSessions).set({ completionHeartbeatAt: ancient }).where(eq(mediaUploadSessions.uploadId, lease))
    assert.ok((await finish(lease)).ok, 'expired completion claims are recoverable')

    const busy = await open(1024)
    await db.update(mediaUploadSessions).set({ updatedAt: ancient }).where(eq(mediaUploadSessions.uploadId, busy))
    let entered!: () => void
    let resume!: () => void
    const enteredPromise = new Promise<void>(resolve => { entered = resolve })
    const barrier = new Promise<void>(resolve => { resume = resolve })
    const writing = receiveChunk({ adminUserId: owner, uploadId: busy, index: 0, body: part }, { ...options,
      statfs: async directory => { entered(); await barrier; return fs.statfs(directory) } })
    await enteredPromise
    const cleaning = housekeepUploads(options)
    resume()
    assert.ok((await writing).ok)
    assert.equal((await cleaning).sessions, 0, 'cleanup rechecks activity after waiting for the chunk row lock')
    assert.ok((await uploadStatus({ adminUserId: owner, uploadId: busy }, options)).ok)

    const noDisk = { ...options, statfs: async () => ({ bavail: 0, bsize: 4096 }) }
    const refused = await initUpload({ adminUserId: owner, filename: 'large.mp4', declaredSize: 1024 }, noDisk)
    assert.ok(!refused.ok && refused.status === 503)
    const full = await finish(busy)
    assert.ok(full.ok)
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
