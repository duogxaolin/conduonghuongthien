/**
 * Tích hợp self-heal media — MySQL thật.
 *
 * Kiểm hành vi mà guard text-source không kiểm được:
 *
 *   1. Step 2 (repoint thumbnail): tạo article với thumbnail `/uploads/migrated/2026/08/foo.jpeg`,
 *      tạo media row R2 với filename `foo.jpeg` + url R2 hợp lệ → self-heal dryRun
 *      báo 1 sẽ sửa, run thực sự UPDATE thumbnail_url sang R2 URL.
 *   2. Step 3 (default lost): HeadObject trả 404 (R2 giả, xem dưới) → r2Missing,
 *      file local không còn → r2Lost → Step 3 đổi thumbnail + media.url sang
 *      DEFAULT_COVER. Test xác nhận cả article a1 (vừa repoint) + a2 (tạo sẵn trỏ
 *      r2Url) đều bị đổi, media.url cũng đổi, idempotent (chạy lại 0 sửa), audit log đủ.
 *   3. Idempotent: chạy lại sau khi đã default → 0 sửa.
 *
 * Biên mạng duy nhất được giả: SDK `@aws-sdk/client-s3`. `openR2` (kiểm account id
 * 32 hex + bucket lúc dùng) và cách `headR2Object` phân loại 404 vẫn là mã thật.
 * Trước đây suite không giả gì: account id dị dạng nay bị `openR2` từ chối
 * (`R2ConfigInvalidError`), còn account id hợp lệ thì gọi thật tới
 * `<id>.r2.cloudflarestorage.com` và chỉ xanh nhờ lỗi TLS/mạng bị nuốt thành
 * `false` — test phụ thuộc mạng. Test khẳng định không có lời gọi R2 nào ngoài
 * HEAD giả, và không có dòng "headR2Object error" (tức là đi đúng nhánh 404).
 *
 * Bỏ qua nhánh upload lại của Step 1 vì cần file local thật — bao che bởi guard
 * text + manual test ở prod.
 *
 * Chạy: `MEDIA_SELF_HEAL_INTEGRATION=1 npm test -- --test tests/media-self-heal-integration.test.ts`
 * Cần MySQL tại MEDIA_SELF_HEAL_HOST (mặc định 127.0.0.1:3306).
 */
import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import { eq } from 'drizzle-orm'

// Cấu hình R2 hợp lệ theo `shared/settings-credential-rules.ts` (account id 32 hex,
// bucket là nhãn DNS) — `openR2` kiểm lúc dùng (`tests/r2-config-use-time.test.ts`).
const R2_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const R2_BUCKET = 'stub-bucket'
const R2_KEY = '2026/08/self-heal-thumb.jpeg'

class FakeS3Command {
  readonly input: Record<string, unknown>
  constructor(input: Record<string, unknown>) { this.input = input }
}
class HeadObjectCommand extends FakeS3Command {}
const s3Endpoints: string[] = []
const s3Calls: Array<{ command: string, input: Record<string, unknown> }> = []

// Đủ mọi tên mà `server/**` import từ SDK (media-r2 + video-r2-sync), không thì
// liên kết ESM hỏng. Mọi lệnh ngoài HEAD của khoá dự kiến → ném "unexpected".
mock.module('@aws-sdk/client-s3', {
  namedExports: {
    S3Client: class S3Client {
      constructor(config: { endpoint?: string }) { s3Endpoints.push(String(config.endpoint)) }
      async send(command: FakeS3Command) {
        s3Calls.push({ command: command.constructor.name, input: command.input })
        if (command instanceof HeadObjectCommand && command.input.Key === R2_KEY) {
          // Hình dạng lỗi SDK v3 khi HEAD gặp object không tồn tại.
          throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } })
        }
        throw new Error(`unexpected R2 call ${command.constructor.name} ${JSON.stringify(command.input)}`)
      }
      destroy() {}
    },
    HeadObjectCommand,
    PutObjectCommand: class PutObjectCommand extends FakeS3Command {},
    GetObjectCommand: class GetObjectCommand extends FakeS3Command {},
    DeleteObjectCommand: class DeleteObjectCommand extends FakeS3Command {},
    DeleteObjectsCommand: class DeleteObjectsCommand extends FakeS3Command {},
    ListObjectsV2Command: class ListObjectsV2Command extends FakeS3Command {},
  },
})

// Import động SAU `mock.module` (import tĩnh được hoist, sẽ nạp SDK thật).
const { initDb } = await import('../server/db/init.ts')
const { getDb, getPool, closeDb } = await import('../server/utils/db.ts')
const { media, articles } = await import('../server/db/schema.ts')
const { selfHealMedia } = await import('../server/services/media-self-heal.ts')

test('self-heal repoint thumbnail_url /uploads/migrated/... → R2 URL khớp basename', {
  skip: process.env.MEDIA_SELF_HEAL_INTEGRATION !== '1', timeout: 60_000,
}, async (t) => {
  // `headR2Object` cũng trả `false` cho lỗi mạng/TLS/auth (kèm dòng warn này) — spy
  // để phân biệt "404 thật" với "lỗi bị nuốt".
  const warn = t.mock.method(console, 'warn')
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

    // Cấu hình R2 trong settings — phải HỢP LỆ (account id 32 hex, bucket nhãn DNS),
    // không thì `openR2` ném `R2ConfigInvalidError` trước cả HEAD. Không có yêu cầu
    // mạng nào: SDK là bản giả ở đầu tệp. Step 2 (repoint) chỉ dùng media.url sẵn có.
    await pool.query("INSERT INTO settings (`key`, value) VALUES (?, ?)", ['r2_account_id', R2_ACCOUNT_ID])
    await pool.query("INSERT INTO settings (`key`, value) VALUES (?, ?)", ['r2_access_key', 'stub-access'])
    await pool.query("INSERT INTO settings (`key`, value) VALUES (?, ?)", ['r2_secret_key', 'stub-secret'])
    await pool.query("INSERT INTO settings (`key`, value) VALUES (?, ?)", ['r2_bucket', R2_BUCKET])

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
      storagePath: R2_KEY,
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
    assert.equal(dry.r2Missing, 1, 'HEAD 404 → hàng R2 được đếm là thiếu')
    const after1 = (await db.select().from(articles).where(eq(articles.id, a1.insertId)))[0]!
    assert.equal(after1.thumbnailUrl, '/uploads/migrated/2026/08/self-heal-thumb.jpeg',
      'dry-run KHÔNG UPDATE — thumbnail vẫn cũ')

    // Run thực sự: Step 1 HEAD (R2 giả) trả 404 → r2Missing, không reupload được
    // (file local cũng không còn) → r2Lost; Step 2 repoint a1 sang r2Url; Step 3
    // đổi thumbnail a1 + a2 (cùng trỏ r2Url) + media.url sang DEFAULT_COVER.
    const real = await selfHealMedia(null, { dryRun: false })
    assert.equal(real.thumbnailsRepointed, 1, 'run thực sự sửa 1 thumbnail (Step 2)')
    assert.ok(real.thumbnailsDefaulted >= 1, 'Step 3 defaults lost R2 thumbnails')
    assert.ok(real.mediaUrlsDefaulted >= 1, 'Step 3 defaults lost media.url')
    const after2 = (await db.select().from(articles).where(eq(articles.id, a1.insertId)))[0]!
    assert.equal(after2.thumbnailUrl, '/assets/default_cover_light.png',
      'thumbnail đã repoint sang R2 rồi Step 3 đổi sang default cover (R2 object không tồn tại ở CI)')

    // Article 2 cũng bị Step 3 đổi (cùng trỏ r2Url đã "lost").
    const afterA2 = (await db.select().from(articles).where(eq(articles.id, a2.insertId)))[0]!
    assert.equal(afterA2.thumbnailUrl, '/assets/default_cover_light.png',
      'article a2 cùng trỏ R2 URL lost → cũng bị đổi sang default cover')

    // Media row cũng bị đổi url sang default cover.
    const afterMedia = (await db.select().from(media).where(eq(media.id, 1)))[0]!
    assert.equal(afterMedia.url, '/assets/default_cover_light.png',
      'media.url của hàng lost đã đổi sang default cover')

    // Idempotent: chạy lại → 0 sửa (thumbnail + url đã là default cover, không
    // còn trỏ R2 URL lost).
    const again = await selfHealMedia(null, { dryRun: false })
    assert.equal(again.thumbnailsRepointed, 0, 'chạy lại không sửa gì — idempotent')
    assert.equal(again.thumbnailsDefaulted, 0, 'Step 3 idempotent — không còn URL lost')
    assert.equal(again.mediaUrlsDefaulted, 0, 'Step 3 idempotent — media.url đã default')

    // Audit log: mỗi run thực sự insert 1 hàng 'self_heal' (Step 2) + 1 hàng
    // 'self_heal_default_lost' (Step 3, chỉ khi có lost). real + again = 2 run
    // thực sự. 'self_heal_default_lost' chỉ insert lần đầu (after đó idempotent).
    const [auditRows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'self_heal'",
    )
    assert.equal(Number(auditRows[0]?.n), 2, 'phải có 2 hàng audit self_heal (2 run thực sự, dry-run không audit)')
    const [defaultLostRows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'self_heal_default_lost'",
    )
    assert.equal(Number(defaultLostRows[0]?.n), 1, '1 hàng audit self_heal_default_lost (chỉ lần đầu, idempotent sau)')

    // Snapshot backup phải có (run thực sự).
    assert.ok(real.backupStamp, 'run thực sự phải có backupStamp')
    assert.ok(!dry.backupStamp, 'dry-run không backup')

    // Biên R2: chỉ đúng 3 HEAD (dry, real, again) tới bucket/khoá dự kiến, qua
    // endpoint dựng từ account id đã kiểm; không PUT/GET/DELETE nào; không lời gọi
    // nào rơi vào nhánh "lỗi khác" (mạng/TLS/auth) của `headR2Object`.
    const head = { command: 'HeadObjectCommand', input: { Bucket: R2_BUCKET, Key: R2_KEY } }
    assert.deepEqual(s3Calls, [head, head, head], 'chỉ HEAD giả — không lời gọi R2 nào khác')
    assert.ok(s3Endpoints.length > 0)
    for (const endpoint of s3Endpoints) {
      assert.equal(endpoint, `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`)
    }
    const headErrors = warn.mock.calls.filter(call => String(call.arguments[0]).includes('headR2Object error'))
    assert.deepEqual(headErrors, [], 'HEAD đi nhánh 404, không phải lỗi bị nuốt')
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
