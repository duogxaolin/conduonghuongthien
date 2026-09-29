/**
 * Tích hợp self-heal media — MySQL thật.
 *
 * Kiểm hai hành vi mà guard text-source không kiểm được:
 *
 *   1. Step 2 (repoint thumbnail): tạo article với thumbnail `/uploads/migrated/2026/08/foo.jpeg`,
 *      tạo media row R2 với filename `foo.jpeg` + url R2 hợp lệ → self-heal dryRun
 *      báo 1 sẽ sửa, run thực sự UPDATE thumbnail_url sang R2 URL.
 *   2. Idempotent: chạy lại sau khi đã repoint → 0 sửa.
 *
 * Bỏ qua Step 1 (HeadObject + upload lại) vì cần R2 thật + file local thật —
 * cheeky cho CI. Step 1 được bao che bởi guard text + manual test ở prod.
 *
 * Chạy: `MEDIA_SELF_HEAL_INTEGRATION=1 npm test -- --test tests/media-self-heal-integration.test.ts`
 * Cần MySQL tại MEDIA_SELF_HEAL_HOST (mặc định 127.0.0.1:3306).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import { eq } from 'drizzle-orm'
import { initDb } from '../server/db/init.ts'
import { getDb, getPool, closeDb } from '../server/utils/db.ts'
import { media, articles } from '../server/db/schema.ts'
import { selfHealMedia } from '../server/services/media-self-heal.ts'

test('self-heal repoint thumbnail_url /uploads/migrated/... → R2 URL khớp basename', {
  skip: process.env.MEDIA_SELF_HEAL_INTEGRATION !== '1', timeout: 60_000,
}, async () => {
  const database = `cdkt_self_heal_${Date.now()}_${process.pid}`
  assert.match(database, /^cdkt_self_heal_\d+_\d+$/)
  const connection = {
    host: process.env.MEDIA_SELF_HEAL_HOST || '127.0.0.1',
    port: Number(process.env.MEDIA_SELF_HEAL_PORT || 3306),
    user: process.env.MEDIA_SELF_HEAL_USER || 'root',
    password: process.env.MEDIA_SELF_HEAL_PASSWORD || '',
  }
  const old = { ...process.env }
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdkt-self-heal-'))
  Object.assign(process.env, {
    DB_HOST: connection.host, DB_PORT: String(connection.port),
    DB_USER: connection.user, DB_PASSWORD: connection.password, DB_NAME: database,
  })
  try {
    await initDb()
    const db = getDb()
    const pool = getPool()!

    // Stub R2 config trong settings — self-heal chỉ cần loadR2Config trả đủ trường.
    // Trong CI không có R2 thật, nhưng Step 2 (repoint) không dùng R2 network —
    // chỉ dùng media.url đã có sẵn. Nên stub tuple đủ điều kiện `hasR2`.
    await pool.query("INSERT INTO settings (`key`, value) VALUES (?, ?)", ['r2_account_id', 'stub-account'])
    await pool.query("INSERT INTO settings (`key`, value) VALUES (?, ?)", ['r2_access_key', 'stub-access'])
    await pool.query("INSERT INTO settings (`key`, value) VALUES (?, ?)", ['r2_secret_key', 'stub-secret'])
    await pool.query("INSERT INTO settings (`key`, value) VALUES (?, ?)", ['r2_bucket', 'stub-bucket'])

    // Tạo 1 media row R2 với filename khớp thumbnail.
    const filename = 'self-heal-thumb.jpeg'
    const r2Url = 'https://cdn1.delify.vn/2026/08/self-heal-thumb.jpeg'
    await db.insert(media).values({
      filename,
      originalName: filename,
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      provider: 'r2',
      url: r2Url,
      storagePath: '2026/08/self-heal-thumb.jpeg',
    })

    // Tạo 2 articles: 1 có thumbnail migrated (cần repoint), 1 đã đúng URL R2.
    const [a1] = await db.insert(articles).values({
      type: 'news',
      title: 'Bài cần repoint',
      slug: 'can-repoint',
      content: 'body',
      status: 'published',
      thumbnailUrl: '/uploads/migrated/2026/08/self-heal-thumb.jpeg',
    })
    const [a2] = await db.insert(articles).values({
      type: 'news',
      title: 'Bài đã đúng',
      slug: 'da-dung',
      content: 'body',
      status: 'published',
      thumbnailUrl: r2Url,
    })

    // Dry-run: báo 1 sẽ sửa, không UPDATE.
    const dry = await selfHealMedia(null, { dryRun: true })
    assert.equal(dry.thumbnailsRepointed, 1, 'dry-run báo 1 thumbnail sẽ sửa')
    const after1 = (await db.select().from(articles).where(eq(articles.id, a1.insertId)))[0]!
    assert.equal(after1.thumbnailUrl, '/uploads/migrated/2026/08/self-heal-thumb.jpeg',
      'dry-run KHÔNG UPDATE — thumbnail vẫn cũ')

    // Run thực sự: UPDATE thumbnail.
    const real = await selfHealMedia(null, { dryRun: false })
    assert.equal(real.thumbnailsRepointed, 1, 'run thực sự sửa 1 thumbnail')
    const after2 = (await db.select().from(articles).where(eq(articles.id, a1.insertId)))[0]!
    assert.equal(after2.thumbnailUrl, r2Url, 'thumbnail đã repoint sang R2 URL')

    // Article 2 không bị đụng.
    const afterA2 = (await db.select().from(articles).where(eq(articles.id, a2.insertId)))[0]!
    assert.equal(afterA2.thumbnailUrl, r2Url, 'article đã đúng URL không bị đụng')

    // Idempotent: chạy lại → 0 sửa.
    const again = await selfHealMedia(null, { dryRun: false })
    assert.equal(again.thumbnailsRepointed, 0, 'chạy lại không sửa gì — idempotent')

    // Audit log: mỗi run thực sự (không dry-run) insert 1 hàng action='self_heal'.
    // dry-run không audit. Em chạy 2 run thực sự (real + again) → 2 hàng.
    const [auditRows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'self_heal'",
    )
    assert.equal(Number(auditRows[0]?.n), 2, 'phải có 2 hàng audit self_heal (2 run thực sự, dry-run không audit)')

    // Snapshot backup phải có (run thực sự).
    assert.ok(real.backupStamp, 'run thực sự phải có backupStamp')
    assert.ok(!dry.backupStamp, 'dry-run không backup')
  } finally {
    Object.assign(process.env, old)
    await closeDb?.().catch(() => {})
    const conn = await mysql.createConnection(connection).catch(() => null)
    if (conn) {
      await conn.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => {})
      await conn.end().catch(() => {})
    }
    await fs.rm(workdir, { recursive: true, force: true }).catch(() => {})
  }
})
