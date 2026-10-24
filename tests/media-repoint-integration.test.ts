/**
 * Đổi domain R2 (`repointR2Urls`) trên MySQL THẬT — wave2 D-REPOINT.
 *
 * Bản cũ chạy `REPLACE(col, oldDomain, newDomain)` trên đúng hai cột (`media.url`,
 * `articles.content`): 25 cột khác cũng mang URL ảnh (khối trang, phiên bản trang,
 * logo trong settings, câu trả lời chatbot, bản dịch…) vẫn trỏ domain cũ, còn chuỗi
 * con thì bị thay cả trong host khác (`xold.cdn`, `old.cdn.evil`). Sao lưu trước khi
 * đổi hỏng thì vẫn đổi tiếp.
 *
 * Suite này chạy hàm thật trên CSDL thật (REGEXP_REPLACE ICU, cột JSON, transaction,
 * trigger) và chỉ giả biên ngoài: bản sao lưu `runBackup` (mysqldump + tệp).
 *
 *   1. Mỗi cột trong `URL_REFERENCE_TARGETS` (27) mang URL `https://`/`http://` trên
 *      domain cũ — kể cả dạng `\/` của JSON lưu trong cột TEXT — cộng `media.url` của
 *      hàng R2. Một lượt đổi viết lại TẤT CẢ, đếm đúng số hàng mỗi cột.
 *   2. Host giống (`xold.cdn`, `old.cdn.evil`, `old.cdn:8443`, `//old.cdn`) không đổi,
 *      kể cả trong cùng hàng với URL được đổi, và hàng chỉ chứa chúng không được đếm.
 *   3. Chạy lại: không hàng nào đổi, mọi số đếm 0.
 *   4. Sao lưu hỏng: lỗi, không hàng nào đổi, không dòng audit nào.
 *   5. Dòng audit hỏng (trigger) → rollback cả lượt: một transaction.
 *
 * Chạy: `MEDIA_REPOINT_INTEGRATION=1 MEDIA_REPOINT_PORT=33069 MEDIA_REPOINT_PASSWORD=… \
 *   node --experimental-strip-types --experimental-test-module-mocks --import ./scripts/ts-resolver.mjs \
 *   --test tests/media-repoint-integration.test.ts`
 */
import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import mysql, { type RowDataPacket } from 'mysql2/promise'

const ENABLED = process.env.MEDIA_REPOINT_INTEGRATION === '1'

// Biên ngoài duy nhất được giả: bản sao lưu SQL trước khi đổi.
const backup = { fail: false, calls: 0 }
mock.module(new URL('../server/services/backup.ts', import.meta.url), {
  namedExports: {
    runBackup: async (type: string, trigger: string) => {
      backup.calls += 1
      assert.equal(type, 'sql')
      assert.equal(trigger, 'pre-repoint')
      if (backup.fail) throw new Error('mysqldump: Got errno 28 on write (disk full)')
      return { stamp: `stamp-${backup.calls}`, files: [], driveUploaded: false }
    },
  },
})

const OLD = 'old.cdn'
const NEW = 'new.cdn'

/** Văn bản thô (HTML/markdown): hai URL được đổi + bốn host giống không được đổi. */
const LOOKALIKES = 'https://xold.cdn/a.png https://old.cdn.evil/a.png https://old.cdn:8443/p.png //old.cdn/rel.png'
const text = (domain: string) =>
  `<p><img src="https://${domain}/a/x.webp" alt="a"> <a href="http://${domain}/b.pdf">b</a> ${LOOKALIKES} cuối https://${domain}</p>`
const json = (domain: string) => ({
  src: `https://${domain}/a/x.webp`,
  html: `<img src="http://${domain}/b.png">`,
  others: ['https://xold.cdn/a.png', 'https://old.cdn.evil/a.png'],
})
const shortText = (domain: string) => `https://${domain}/i/z.svg`

test('đổi domain R2: 27 cột + media.url, ranh giới URL, chạy lại không đổi gì, sao lưu hỏng thì dừng, một transaction', {
  skip: !ENABLED, timeout: 180_000,
}, async () => {
  const runId = `${Date.now()}_${process.pid}`
  const database = `cdkt_media_repoint_${runId}`
  assert.match(database, /^cdkt_media_repoint_\d+_\d+$/)
  const connection = {
    host: process.env.MEDIA_REPOINT_HOST || '127.0.0.1',
    port: Number(process.env.MEDIA_REPOINT_PORT || 3306),
    user: process.env.MEDIA_REPOINT_USER || 'root',
    password: process.env.MEDIA_REPOINT_PASSWORD || '',
  }
  const old = { ...process.env }
  Object.assign(process.env, {
    DB_HOST: connection.host, DB_PORT: String(connection.port),
    DB_USER: connection.user, DB_PASSWORD: connection.password, DB_NAME: database,
  })

  const { initDb } = await import('../server/db/init.ts')
  const { getDb, getPool, closeDb } = await import('../server/utils/db.ts')
  const schema = await import('../server/db/schema.ts')
  const { URL_REFERENCE_TARGETS } = await import('../server/services/media-sync-url-match.ts')
  const { repointR2Urls } = await import('../server/services/media-repoint.ts')
  try {
    await initDb()
    const db = getDb()
    const pool = getPool()!

    // ── Dữ liệu: mỗi cột tham chiếu một hàng mang domain cũ ──────────────────
    const [article] = await db.insert(schema.articles).values({
      type: 'news', title: 'Bài', slug: 'bai-repoint', status: 'published',
      content: text(OLD), excerpt: text(OLD), thumbnailUrl: text(OLD),
    })
    // Hàng chỉ có host giống: không đổi, không được đếm.
    const [decoyArticle] = await db.insert(schema.articles).values({
      type: 'news', title: 'Mồi', slug: 'bai-moi', status: 'published', content: `<p>${LOOKALIKES}</p>`,
    })
    await db.insert(schema.articleTranslations).values({
      articleId: article.insertId, langCode: 'en', title: text(OLD), excerpt: text(OLD), content: text(OLD), status: 'completed',
    })
    const [page] = await db.insert(schema.pages).values({
      slug: 'trang-repoint', title: 'Trang',
      publishedBlocks: [{ id: 'n1', blockType: 'image', data: json(OLD) }] as never,
      draftBlocks: [{ id: 'n1', blockType: 'image', data: json(OLD) }] as never,
    })
    await db.insert(schema.pageBlocks).values({ pageId: page.insertId, blockType: 'image', data: json(OLD) as never })
    await db.insert(schema.pageVersions).values({ pageId: page.insertId, kind: 'manual', blocks: [{ id: 'n1', blockType: 'image', data: json(OLD) }] as never })
    await db.insert(schema.homeSections).values({ type: 'hero', config: json(OLD) })
    await db.insert(schema.pageContents).values({ slug: 'gioi-thieu', sectionKey: 'main', content: json(OLD) })
    await db.insert(schema.settings).values([
      // JSON trong cột TEXT giữ nguyên `\/` — dạng thoát cũng phải được đổi.
      { key: 'layout_config', value: JSON.stringify(json(OLD)).replace(/\//g, '\\/'), group: 'general' },
      { key: 'main_logo_url', value: `https://${OLD}/brand/logo.png`, group: 'general' },
      { key: 'r2_public_url', value: `https://${OLD}`, group: 'media' },
      { key: 'favicon_url', value: 'https://xold.cdn/f.png', group: 'general' },
    ])
    await db.insert(schema.socialLinks).values({ platform: 'Zalo', label: 'Zalo', url: shortText(OLD), icon: shortText(OLD), iconType: 'svg' })
    await db.insert(schema.mediaItems).values({ slug: 'video-repoint', shortId: 'repoint0001', title: 'Video', thumbnailUrl: text(OLD), description: text(OLD) })
    await db.insert(schema.livestreamSessions).values({ title: 'Live', thumbnailUrl: text(OLD), description: text(OLD) })
    const now = new Date()
    await db.insert(schema.chatSessions).values({ id: '00000000-0000-4000-8000-000000000001', startedAt: now, lastMessageAt: now })
    await db.insert(schema.chatMessages).values({ sessionId: '00000000-0000-4000-8000-000000000001', role: 'assistant', content: text(OLD), createdAt: now })
    await db.insert(schema.chatbotKnowledge).values({ canonicalQuestion: 'Hỏi', normalizedQuestion: 'hoi repoint', approvedAnswer: text(OLD), topic: 'general', sourceUrl: text(OLD) })
    await db.insert(schema.chatbotSmallTalk).values({ category: 'greeting', question: 'Chào', normalizedQuestion: 'chao repoint', answer: text(OLD) })
    await db.insert(schema.chatbotSettings).values({ id: 1, knowledgeGreeting: text(OLD), fallbackMessage: text(OLD) })
    await db.insert(schema.categories).values({ name: 'Mục', slug: 'muc-repoint', type: 'news', description: text(OLD) })
    await db.insert(schema.langTranslations).values({ langCode: 'vi', group: 'general', key: 'repoint_test', value: text(OLD) })
    await db.insert(schema.media).values([
      { filename: 'x.webp', originalName: 'x.webp', mimeType: 'image/webp', sizeBytes: 1, provider: 'r2', url: `https://${OLD}/2026/10/x.webp`, storagePath: '2026/10/x.webp' },
      // Không phải R2 → không đổi; host giống → không đổi.
      { filename: 'y.webp', originalName: 'y.webp', mimeType: 'image/webp', sizeBytes: 1, provider: 'local', url: `https://${OLD}/2026/10/y.webp`, storagePath: '/app/public/uploads/2026/10/y.webp' },
      { filename: 'z.webp', originalName: 'z.webp', mimeType: 'image/webp', sizeBytes: 1, provider: 'r2', url: 'https://xold.cdn/2026/10/z.webp', storagePath: '2026/10/z.webp' },
    ])

    // Mọi cột có đúng một hàng mang domain cũ, trừ `settings.value` (3 hàng).
    const expectedFirst: Record<string, number> = { 'media.url': 1 }
    for (const target of URL_REFERENCE_TARGETS) expectedFirst[target.label] = target.label === 'settings.value' ? 3 : 1
    assert.equal(URL_REFERENCE_TARGETS.length, 27, 'danh sách cột tham chiếu đổi — cập nhật dữ liệu của suite này')

    /** Ảnh chụp mọi bảng có cột tham chiếu, cộng `media` và `activity_logs`. */
    const { getTableName } = await import('drizzle-orm')
    const tables = [...new Set([...URL_REFERENCE_TARGETS.map(t => getTableName(t.table)), 'media', 'activity_logs'])]
    const snapshotAll = async () => {
      const out: Record<string, unknown[]> = {}
      for (const table of tables.sort()) {
        const [rows] = await pool.query<RowDataPacket[]>(`SELECT * FROM \`${table}\` ORDER BY 1`)
        out[table] = rows.map(row => JSON.stringify(row))
      }
      return out
    }

    // ── 4. Sao lưu hỏng → lỗi, không đổi gì ───────────────────────────────────
    const pristine = await snapshotAll()
    backup.fail = true
    await assert.rejects(() => repointR2Urls(OLD, NEW, null), (err: unknown) => {
      assert.match(String((err as Error).message), /sao lưu/i)
      assert.equal((err as Error).name, 'RepointBackupError')
      return true
    })
    backup.fail = false
    assert.deepEqual(await snapshotAll(), pristine, 'sao lưu hỏng: không hàng nào được đổi')

    // ── 5. Audit hỏng giữa transaction → rollback cả lượt ─────────────────────
    await pool.query("CREATE TRIGGER reject_repoint_audit BEFORE INSERT ON activity_logs FOR EACH ROW BEGIN IF NEW.action = 'repoint_urls' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected audit failure'; END IF; END")
    await assert.rejects(() => repointR2Urls(OLD, NEW, null), (err: unknown) => {
      // drizzle bọc lỗi của driver: "Failed query: insert into `activity_logs`…" + cause.
      assert.match(String((err as Error).cause ?? err), /injected audit failure/)
      return true
    })
    await pool.query('DROP TRIGGER reject_repoint_audit')
    assert.deepEqual(await snapshotAll(), pristine, 'audit hỏng: mọi lượt đổi URL rollback cùng nó')

    // ── 1–2. Lượt đổi thật ──────────────────────────────────────────────────
    const first = await repointR2Urls(`https://${OLD}/`, NEW, null)
    assert.deepEqual(first.byTarget, expectedFirst, 'đếm theo từng cột: mỗi cột đúng số hàng mang domain cũ')
    assert.equal(first.mediaUpdated, 1)
    assert.equal(first.contentRowsUpdated, 29)
    assert.ok(first.backupStamp)

    const one = async <T>(query: Promise<T[]>) => (await query)[0]!
    const eq = (await import('drizzle-orm')).eq
    const a = await one(db.select().from(schema.articles).where(eq(schema.articles.id, article.insertId)))
    assert.deepEqual([a.content, a.excerpt, a.thumbnailUrl], [text(NEW), text(NEW), text(NEW)])
    assert.equal((await one(db.select().from(schema.articles).where(eq(schema.articles.id, decoyArticle.insertId)))).content, `<p>${LOOKALIKES}</p>`)
    const tr = await one(db.select().from(schema.articleTranslations))
    assert.deepEqual([tr.title, tr.excerpt, tr.content], [text(NEW), text(NEW), text(NEW)])
    const p = await one(db.select().from(schema.pages).where(eq(schema.pages.id, page.insertId)))
    assert.deepEqual(p.publishedBlocks, [{ id: 'n1', blockType: 'image', data: json(NEW) }])
    assert.deepEqual(p.draftBlocks, [{ id: 'n1', blockType: 'image', data: json(NEW) }])
    assert.deepEqual((await one(db.select().from(schema.pageBlocks))).data, json(NEW))
    assert.deepEqual((await one(db.select().from(schema.pageVersions))).blocks, [{ id: 'n1', blockType: 'image', data: json(NEW) }])
    assert.deepEqual((await one(db.select().from(schema.homeSections))).config, json(NEW))
    assert.deepEqual((await one(db.select().from(schema.pageContents))).content, json(NEW))
    const setting = async (key: string) => (await one(db.select().from(schema.settings).where(eq(schema.settings.key, key)))).value
    assert.equal(await setting('layout_config'), JSON.stringify(json(NEW)).replace(/\//g, '\\/'), 'dạng `\\/` trong cột TEXT')
    assert.equal(await setting('main_logo_url'), `https://${NEW}/brand/logo.png`)
    assert.equal(await setting('r2_public_url'), `https://${NEW}`)
    assert.equal(await setting('favicon_url'), 'https://xold.cdn/f.png')
    const sl = await one(db.select().from(schema.socialLinks))
    assert.deepEqual([sl.url, sl.icon], [shortText(NEW), shortText(NEW)])
    const mi = await one(db.select().from(schema.mediaItems))
    assert.deepEqual([mi.thumbnailUrl, mi.description], [text(NEW), text(NEW)])
    const ls = await one(db.select().from(schema.livestreamSessions))
    assert.deepEqual([ls.thumbnailUrl, ls.description], [text(NEW), text(NEW)])
    assert.equal((await one(db.select().from(schema.chatMessages))).content, text(NEW))
    const kn = await one(db.select().from(schema.chatbotKnowledge))
    assert.deepEqual([kn.approvedAnswer, kn.sourceUrl], [text(NEW), text(NEW)])
    assert.equal((await one(db.select().from(schema.chatbotSmallTalk))).answer, text(NEW))
    const cs = await one(db.select().from(schema.chatbotSettings))
    assert.deepEqual([cs.knowledgeGreeting, cs.fallbackMessage], [text(NEW), text(NEW)])
    assert.equal((await one(db.select().from(schema.categories).where(eq(schema.categories.slug, 'muc-repoint')))).description, text(NEW))
    assert.equal((await one(db.select().from(schema.langTranslations).where(eq(schema.langTranslations.key, 'repoint_test')))).value, text(NEW))
    const mediaRows = await db.select({ filename: schema.media.filename, url: schema.media.url }).from(schema.media)
    assert.deepEqual(Object.fromEntries(mediaRows.map(r => [r.filename, r.url])), {
      'x.webp': `https://${NEW}/2026/10/x.webp`,
      'y.webp': `https://${OLD}/2026/10/y.webp`,
      'z.webp': 'https://xold.cdn/2026/10/z.webp',
    })

    // Dòng audit: đúng một, cùng số đếm.
    const [audits] = await pool.query<RowDataPacket[]>("SELECT meta FROM activity_logs WHERE action = 'repoint_urls'")
    assert.equal(audits.length, 1)
    const meta = typeof audits[0]!.meta === 'string' ? JSON.parse(audits[0]!.meta) : audits[0]!.meta
    assert.deepEqual(meta.byTarget, expectedFirst)
    assert.equal(meta.oldDomain, OLD)
    assert.equal(meta.newDomain, NEW)

    // ── 3. Chạy lại: không đổi gì ───────────────────────────────────────────
    const afterFirst = await snapshotAll()
    const second = await repointR2Urls(OLD, NEW, null)
    assert.equal(second.mediaUpdated, 0)
    assert.equal(second.contentRowsUpdated, 0)
    assert.ok(Object.values(second.byTarget).every(n => n === 0), JSON.stringify(second.byTarget))
    const afterSecond = await snapshotAll()
    // Chỉ thêm đúng một dòng audit của lượt chạy lại; mọi bảng khác giống từng byte.
    assert.equal(afterSecond.activity_logs!.length, afterFirst.activity_logs!.length + 1)
    assert.deepEqual({ ...afterSecond, activity_logs: [] }, { ...afterFirst, activity_logs: [] }, 'lượt hai không đổi hàng nào')
  } finally {
    await closeDb?.().catch(() => {})
    for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
      if (old[key] === undefined) delete process.env[key]
      else process.env[key] = old[key]
    }
    const conn = await mysql.createConnection(connection).catch(() => null)
    if (conn) {
      await conn.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => {})
      await conn.end().catch(() => {})
    }
  }
})
