/**
 * Đồng bộ ảnh local → R2 trên MySQL THẬT: thay URL ở mọi bảng tham chiếu, an toàn
 * khi bị cắt ngang, và vá trạng thái dở dang mà mã cũ để lại.
 *
 * Fake chỉ ở biên mạng (R2) — CSDL, `REPLACE`/`REGEXP_REPLACE`, cột JSON, khoá
 * MySQL, transaction và tệp trên đĩa đều thật. Những điều chỉ MySQL thật trả lời:
 *
 *   1. REPLACE trong cột JSON (`page_blocks.data`, `pages.*_blocks`) giữ JSON hợp lệ,
 *      kể cả URL nằm trong HTML có `\"` bên trong một chuỗi JSON.
 *   2. Dạng tuyệt đối `http://localhost:3000/uploads/…` thành URL R2, không thành
 *      `http://localhost:3000https://…`.
 *   3. Bẫy collation: `/uploads/…/A_B.png` (khác hoa thường) và `/uploads/…/axb.png`
 *      (ký tự đại diện `_` của LIKE) KHÔNG bị chạm.
 *   4. Lỗi giữa transaction của hàng (trigger chặn dòng audit) rollback CẢ lượt thay
 *      URL: hàng còn `local`, nội dung nguyên, file local còn trên đĩa. Chạy lại → xong.
 *   5. Lượt thay chỉ đổi chuỗi URL: không thẻ/thuộc tính nào đổi, nội dung đã lọc vẫn
 *      là điểm bất động của `sanitizeHtml`.
 *   6. Trạng thái dở dang của mã cũ (hàng đã sang R2 + audit, nội dung còn URL local)
 *      được `repairInterruptedSyncRewrites` vá; chạy lại không đổi gì.
 *
 * Chạy: `MEDIA_SYNC_INTEGRATION=1 MEDIA_SYNC_PORT=33069 MEDIA_SYNC_PASSWORD=… npm test -- --test tests/media-sync-rewrite-integration.test.ts`
 */
import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import { eq } from 'drizzle-orm'

const ENABLED = process.env.MEDIA_SYNC_INTEGRATION === '1'

// Biên mạng duy nhất được giả: Cloudflare R2.
const r2Deleted: string[] = []
/** Tên tệp mà lượt tải lên R2 sẽ hỏng (mô phỏng mạng/R2 lỗi cho đúng một hàng). */
const failUploadFor = new Set<string>()
mock.module(new URL('../server/utils/media-r2.ts', import.meta.url), {
  namedExports: {
    r2ObjectKeyFor: (filename: string) => `2026/10/${filename}`,
    uploadR2File: async (_b: Buffer, filename: string) => {
      if (failUploadFor.has(filename)) throw new Error('injected upload failure')
      return { url: `https://cdn.test/2026/10/${filename}`, storagePath: `2026/10/${filename}` }
    },
    headR2Object: async () => true,
    deleteR2File: async (key: string) => { r2Deleted.push(key); return true },
    getR2Object: async () => Buffer.from('x'),
    // Kiểm cấu hình lúc dùng là việc của tests/r2-config-use-time.test.ts; ở đây R2 là giả.
    assertUsableR2Config: () => ({ accountId: 'a', bucket: 'b' }),
  },
})

const { initDb } = await import('../server/db/init.ts')
const { getDb, getPool, closeDb } = await import('../server/utils/db.ts')
const { media, articles, articleTranslations, pages, pageBlocks, pageVersions, activityLogs, settings, chatSessions, chatMessages } = await import('../server/db/schema.ts')
const { syncMediaStorage } = await import('../server/services/media-sync.ts')
const { repairInterruptedSyncRewrites } = await import('../server/services/media-sync-rewrite.ts')
const { sanitizeHtml } = await import('../server/utils/sanitize-html.ts')

test('sync local→R2 thay URL ở mọi bảng tham chiếu, an toàn khi bị cắt ngang, vá trạng thái dở dang', {
  skip: !ENABLED, timeout: 120_000,
}, async () => {
  const runId = `${Date.now()}_${process.pid}`
  const database = `cdkt_media_sync_${runId}`
  assert.match(database, /^cdkt_media_sync_\d+_\d+$/)
  const connection = {
    host: process.env.MEDIA_SYNC_HOST || '127.0.0.1',
    port: Number(process.env.MEDIA_SYNC_PORT || 3306),
    user: process.env.MEDIA_SYNC_USER || 'root',
    password: process.env.MEDIA_SYNC_PASSWORD || '',
  }
  const old = { ...process.env }
  // `deleteLocalFile` chỉ xoá trong `public/uploads/` — thư mục thử riêng cho lượt này.
  const uploadDirName = `__media_sync_it_${runId}`
  const uploadDir = path.resolve(process.cwd(), 'public', 'uploads', uploadDirName)
  Object.assign(process.env, {
    DB_HOST: connection.host, DB_PORT: String(connection.port),
    DB_USER: connection.user, DB_PASSWORD: connection.password, DB_NAME: database,
  })
  try {
    await initDb()
    const db = getDb()
    const pool = getPool()!
    for (const [key, value] of [['r2_account_id', 'acc'], ['r2_access_key', 'key'], ['r2_secret_key', 'secret'], ['r2_bucket', 'bucket'], ['r2_public_url', 'https://cdn.test']]) {
      await db.insert(settings).values({ key: key!, value: value!, group: 'media' })
    }

    // ── 6. Trạng thái dở dang của mã cũ ──────────────────────────────────────
    const legacyOld = '/uploads/2026/09/legacy_1.png'
    const legacyNew = 'https://cdn.test/2026/09/legacy_1.png'
    const [legacyMedia] = await db.insert(media).values({
      filename: 'legacy_1.png', originalName: 'legacy_1.png', mimeType: 'image/png', sizeBytes: 3,
      provider: 'r2', url: legacyNew, storagePath: '2026/09/legacy_1.png',
    })
    await db.insert(activityLogs).values({
      userId: null, action: 'update', resource: 'media', resourceId: legacyMedia.insertId,
      meta: { sync: 'to-r2', oldUrl: legacyOld, newUrl: legacyNew, oldStoragePath: '/x', newStoragePath: '2026/09/legacy_1.png' },
    })
    const legacyHtml = sanitizeHtml(`<p>Cũ</p><img src="${legacyOld}" alt="a"><img src="http://localhost:3000${legacyOld}" alt="b">`)
    const [legacyArticle] = await db.insert(articles).values({
      type: 'news', title: 'Bài dở dang', slug: 'bai-do-dang', content: legacyHtml, status: 'published', thumbnailUrl: legacyOld,
    })
    const repaired = await repairInterruptedSyncRewrites(db, null)
    assert.equal(repaired.urlsRepaired, 1)
    const [legacyAfter] = await db.select().from(articles).where(eq(articles.id, legacyArticle.insertId))
    assert.equal(legacyAfter!.content, `<p>Cũ</p><img src="${legacyNew}" alt="a"><img src="${legacyNew}" alt="b">`)
    assert.equal(legacyAfter!.thumbnailUrl, legacyNew)
    const [repairAudits] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM activity_logs WHERE resource = 'media' AND JSON_EXTRACT(meta, '$.syncRepair') = true",
    )
    assert.equal(Number(repairAudits[0]?.n), 1, 'lượt vá ghi audit cùng transaction')
    assert.deepEqual(await repairInterruptedSyncRewrites(db, null), { urlsRepaired: 0, rowsRewritten: 0 }, 'chạy lại: idempotent')

    // ── Dữ liệu cho lượt sync thật ────────────────────────────────────────────
    await fs.mkdir(uploadDir, { recursive: true })
    const filename = 'anh_bia.png'
    const storagePath = path.join(uploadDir, filename)
    await fs.writeFile(storagePath, 'png')
    const oldUrl = `/uploads/${uploadDirName}/${filename}`
    const newUrl = `https://cdn.test/2026/10/${filename}`
    const caseDecoy = `/uploads/${uploadDirName}/ANH_BIA.png`
    const likeDecoy = `/uploads/${uploadDirName}/anhxbia.png`
    const [mediaRow] = await db.insert(media).values({
      filename, originalName: filename, mimeType: 'image/png', sizeBytes: 3, provider: 'local', url: oldUrl, storagePath,
    })
    const mediaId = mediaRow.insertId

    const articleHtml = sanitizeHtml(
      `<p>Ảnh <strong>đẹp</strong></p><img src="${oldUrl}" alt="tương đối" width="300">`
      + `<figure><img src="http://localhost:3000${oldUrl}" alt="tuyệt đối"><figcaption>Chú thích</figcaption></figure>`
      + `<a href="${oldUrl}">tải</a><img src="${caseDecoy}" alt="hoa thường"><img src="${likeDecoy}" alt="like">`
      // Dạng tuyệt đối của tệp KHÁC chỉ khác hoa thường: REGEXP dưới collation _ci
      // sẽ thay nhầm nếu thiếu `(?-i)`.
      + `<img src="http://localhost:3000${caseDecoy}" alt="hoa thường tuyệt đối">`,
    )
    const [art] = await db.insert(articles).values({
      type: 'news', title: 'Bài có ảnh', slug: 'bai-co-anh', content: articleHtml, status: 'published', thumbnailUrl: `http://localhost:3000${oldUrl}`,
    })
    const translationHtml = sanitizeHtml(`<p>Photo</p><img src="${oldUrl}" alt="en">`)
    await db.insert(articleTranslations).values({
      articleId: art.insertId, langCode: 'en', title: 'Has image', content: translationHtml, status: 'completed',
    })
    const blockData = {
      imageUrl: oldUrl,
      html: `<p>Khối</p><img src="http://localhost:3000${oldUrl}" alt="k">`,
      items: [{ image: oldUrl, caption: 'một' }, { image: caseDecoy, caption: 'hai' }],
    }
    const [page] = await db.insert(pages).values({
      slug: 'trang-anh', title: 'Trang ảnh',
      publishedBlocks: [{ id: 'b1', blockType: 'image', data: { imageUrl: oldUrl }, isVisible: true }],
      draftBlocks: [{ id: 'b1', blockType: 'image', data: { imageUrl: `http://localhost:3000${oldUrl}` }, isVisible: true }],
    })
    await db.insert(pageBlocks).values({ pageId: page.insertId, blockType: 'richtext', data: blockData })

    const expectedArticleHtml = articleHtml
      .split(`http://localhost:3000${oldUrl}`).join(newUrl)
      .split(oldUrl).join(newUrl)

    // ── 4. Lỗi giữa transaction của hàng → rollback cả lượt thay URL ──────────
    await pool.query("CREATE TRIGGER reject_media_sync_audit BEFORE INSERT ON activity_logs FOR EACH ROW BEGIN IF JSON_EXTRACT(NEW.meta, '$.sync') = 'to-r2' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected audit failure'; END IF; END")
    const crashed = await syncMediaStorage('to-r2', null)
    assert.deepEqual({ synced: crashed.synced, skipped: crashed.skipped }, { synced: 0, skipped: 1 })
    const [rowAfterCrash] = await db.select().from(media).where(eq(media.id, mediaId))
    assert.equal(rowAfterCrash!.provider, 'local', 'hàng không đổi khi transaction rollback')
    assert.equal((await db.select().from(articles).where(eq(articles.id, art.insertId)))[0]!.content, articleHtml,
      'lượt thay URL rollback cùng hàng')
    assert.equal(await fs.readFile(storagePath, 'utf8'), 'png', 'file local KHÔNG bị xoá khi chưa commit')
    await pool.query('DROP TRIGGER reject_media_sync_audit')

    // ── Chạy lại: hoàn tất ───────────────────────────────────────────────────
    const done = await syncMediaStorage('to-r2', null)
    assert.equal(done.synced, 1)
    assert.ok(done.articlesRewritten >= 6, `số hàng nội dung đã thay: ${done.articlesRewritten}`)
    await assert.rejects(() => fs.access(storagePath), 'file local bị xoá SAU commit')

    const [row] = await db.select().from(media).where(eq(media.id, mediaId))
    assert.deepEqual({ provider: row!.provider, url: row!.url, storagePath: row!.storagePath },
      { provider: 'r2', url: newUrl, storagePath: `2026/10/${filename}` })

    const [artAfter] = await db.select().from(articles).where(eq(articles.id, art.insertId))
    assert.equal(artAfter!.content, expectedArticleHtml, 'đúng chuỗi mong đợi — 2. dạng tuyệt đối, 3. bẫy không bị chạm')
    assert.ok(artAfter!.content!.includes(caseDecoy) && artAfter!.content!.includes(likeDecoy))
    assert.ok(artAfter!.content!.includes(`http://localhost:3000${caseDecoy}`), 'tệp khác hoa thường không bị thay')
    assert.ok(!artAfter!.content!.includes('3000https'))
    assert.equal(artAfter!.thumbnailUrl, newUrl)
    // 5. Không thẻ/thuộc tính nào đổi: nội dung sau vẫn là điểm bất động của bộ lọc.
    assert.equal(sanitizeHtml(artAfter!.content), artAfter!.content)

    const [trAfter] = await db.select().from(articleTranslations).where(eq(articleTranslations.articleId, art.insertId))
    assert.equal(trAfter!.content, translationHtml.split(oldUrl).join(newUrl))

    // 1. JSON vẫn hợp lệ và chỉ chuỗi URL đổi.
    const [blockAfter] = await db.select().from(pageBlocks).where(eq(pageBlocks.pageId, page.insertId))
    assert.deepEqual(blockAfter!.data, {
      imageUrl: newUrl,
      html: `<p>Khối</p><img src="${newUrl}" alt="k">`,
      items: [{ image: newUrl, caption: 'một' }, { image: caseDecoy, caption: 'hai' }],
    })
    const [pageAfter] = await db.select().from(pages).where(eq(pages.id, page.insertId))
    assert.deepEqual(pageAfter!.publishedBlocks, [{ id: 'b1', blockType: 'image', data: { imageUrl: newUrl }, isVisible: true }])
    assert.deepEqual(pageAfter!.draftBlocks, [{ id: 'b1', blockType: 'image', data: { imageUrl: newUrl }, isVisible: true }])

    const [audit] = await pool.query<RowDataPacket[]>(
      "SELECT meta FROM activity_logs WHERE resource = 'media' AND resource_id = ? AND JSON_EXTRACT(meta, '$.sync') = 'to-r2'",
      [mediaId],
    )
    const meta = typeof audit[0]?.meta === 'string' ? JSON.parse(audit[0].meta) : audit[0]?.meta
    assert.equal(meta?.rewritesApplied, true)

    // Chạy lại: không còn hàng local, không còn gì trỏ URL cũ → không đổi gì.
    const snapshot = JSON.stringify(await db.select().from(articles))
    const rerun = await syncMediaStorage('to-r2', null)
    assert.deepEqual(rerun, { synced: 0, skipped: 0, errors: [], articlesRewritten: 0 })
    assert.equal(JSON.stringify(await db.select().from(articles)), snapshot, 'idempotent')
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
    await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {})
  }
})

/**
 * Kịch bản của người kiểm chứng (2026-10), trên MySQL THẬT:
 *   - `settings.main_logo_url` + một khoá JSON trỏ ảnh thư viện, tin nhắn chatbot, phiên
 *     bản trang cũ: sau lượt đồng bộ phải trỏ URL mới; tệp cũ chỉ bị xoá SAU đó.
 *   - cặp tiền tố `a.jpg` / `a.jpg.webp`: tải `a.jpg.webp` hỏng → hàng đó còn local
 *     và MỌI tham chiếu tới nó giữ nguyên (trước đây REPLACE chuỗi con đã kéo nó
 *     sang URL R2 của chính nó — ảnh vỡ, không vá được).
 *   - lưới an toàn: một hàng ghi chen vào SAU lượt thay (trigger trên dòng audit, tức
 *     là trong cùng transaction nhưng sau lượt chọn id) vẫn trỏ URL cũ → tệp cũ được
 *     GIỮ, không xoá.
 */
test('sync: settings/chat/phiên bản trang được thay; ranh giới tiền tố; lưới an toàn giữ bản cũ còn được tham chiếu', {
  skip: !ENABLED, timeout: 120_000,
}, async () => {
  const runId = `${Date.now()}_${process.pid}`
  const database = `cdkt_media_sync_${runId}_b`
  assert.match(database, /^cdkt_media_sync_\d+_\d+_b$/)
  const connection = {
    host: process.env.MEDIA_SYNC_HOST || '127.0.0.1',
    port: Number(process.env.MEDIA_SYNC_PORT || 3306),
    user: process.env.MEDIA_SYNC_USER || 'root',
    password: process.env.MEDIA_SYNC_PASSWORD || '',
  }
  const old = { ...process.env }
  const uploadDirName = `__media_sync_it_${runId}_b`
  const uploadDir = path.resolve(process.cwd(), 'public', 'uploads', uploadDirName)
  Object.assign(process.env, {
    DB_HOST: connection.host, DB_PORT: String(connection.port),
    DB_USER: connection.user, DB_PASSWORD: connection.password, DB_NAME: database,
  })
  try {
    await initDb()
    const db = getDb()
    const pool = getPool()!
    for (const [key, value] of [['r2_account_id', 'acc'], ['r2_access_key', 'key'], ['r2_secret_key', 'secret'], ['r2_bucket', 'bucket'], ['r2_public_url', 'https://cdn.test']]) {
      await db.insert(settings).values({ key: key!, value: value!, group: 'media' })
    }
    await fs.mkdir(uploadDir, { recursive: true })
    const u = (name: string) => `/uploads/${uploadDirName}/${name}`
    const cdn = (name: string) => `https://cdn.test/2026/10/${name}`
    const ids: Record<string, number> = {}
    for (const name of ['q.jpg', 'a.jpg', 'a.jpg.webp', 'late.jpg']) {
      const storagePath = path.join(uploadDir, name)
      await fs.writeFile(storagePath, name)
      const [row] = await db.insert(media).values({
        filename: name, originalName: name, mimeType: 'image/jpeg', sizeBytes: 1, provider: 'local', url: u(name), storagePath,
      })
      ids[name] = row.insertId
    }

    // ── Tham chiếu ngoài bài viết ────────────────────────────────────────────
    await db.insert(settings).values({ key: 'main_logo_url', value: u('q.jpg'), group: 'general' })
    await db.insert(settings).values({ key: 'nav_menu', value: JSON.stringify([{ label: 'A', image: u('q.jpg') }]), type: 'json', group: 'general' })
    await db.insert(chatSessions).values({ id: 'sess-1', startedAt: new Date(), lastMessageAt: new Date() })
    await db.insert(chatMessages).values({ sessionId: 'sess-1', role: 'assistant', content: `Xem ảnh: ![logo](${u('q.jpg')}).`, createdAt: new Date() })
    const [page] = await db.insert(pages).values({ slug: 'p', title: 'p' })
    await db.insert(pageVersions).values({ pageId: page.insertId, kind: 'manual', blocks: [{ id: 'b', blockType: 'image', data: { imageUrl: u('q.jpg') }, isVisible: true }] })

    // ── Cặp tiền tố: a.jpg và a.jpg.webp ────────────────────────────────────
    const html = `<img src="${u('a.jpg')}"><img src="${u('a.jpg.webp')}"><img src="http://localhost:3000${u('a.jpg.webp')}?v=2">`
    const [art] = await db.insert(articles).values({ type: 'news', title: 't', slug: 'tien-to', content: html, status: 'published', thumbnailUrl: u('a.jpg.webp') })
    await db.update(pages).set({ publishedBlocks: [{ id: 'b', blockType: 'image', data: { imageUrl: u('a.jpg.webp'), alt: 'a' }, isVisible: true }] })
    failUploadFor.add('a.jpg.webp')

    // ── Lưới an toàn: hàng ghi chen sau lượt chọn id, trỏ URL cũ của late.jpg ────
    await pool.query(`CREATE TRIGGER late_reference AFTER INSERT ON activity_logs FOR EACH ROW BEGIN
      IF JSON_UNQUOTE(JSON_EXTRACT(NEW.meta, '$.oldUrl')) = '${u('late.jpg')}' THEN
        INSERT INTO settings (\`key\`, value, \`group\`) VALUES ('late_banner', '${u('late.jpg')}', 'general');
      END IF; END`)

    const result = await syncMediaStorage('to-r2', null)
    failUploadFor.clear()
    await pool.query('DROP TRIGGER late_reference')
    assert.deepEqual({ synced: result.synced, skipped: result.skipped, errors: result.errors }, { synced: 3, skipped: 1, errors: ['a.jpg.webp'] })

    // Settings, chat, phiên bản trang trỏ URL mới; tệp cũ đã xoá SAU commit.
    const settingValue = async (key: string) => (await db.select().from(settings).where(eq(settings.key, key)))[0]?.value
    assert.equal(await settingValue('main_logo_url'), cdn('q.jpg'))
    assert.deepEqual(JSON.parse(String(await settingValue('nav_menu'))), [{ label: 'A', image: cdn('q.jpg') }])
    assert.equal((await db.select().from(chatMessages))[0]!.content, `Xem ảnh: ![logo](${cdn('q.jpg')}).`)
    assert.deepEqual((await db.select().from(pageVersions))[0]!.blocks, [{ id: 'b', blockType: 'image', data: { imageUrl: cdn('q.jpg') }, isVisible: true }])
    await assert.rejects(() => fs.access(path.join(uploadDir, 'q.jpg')), 'q.jpg cũ bị xoá sau commit')
    const [qRow] = await db.select().from(media).where(eq(media.id, ids['q.jpg']!))
    assert.equal(qRow!.url, cdn('q.jpg'))
    const [qAudit] = await pool.query<RowDataPacket[]>(
      "SELECT meta FROM activity_logs WHERE resource = 'media' AND resource_id = ? AND JSON_EXTRACT(meta, '$.sync') = 'to-r2'", [ids['q.jpg']],
    )
    const qMeta = typeof qAudit[0]?.meta === 'string' ? JSON.parse(qAudit[0].meta) : qAudit[0]?.meta
    assert.ok(qMeta?.byTarget?.['settings.value'] >= 2 && qMeta?.byTarget?.['chat_messages.content'] === 1 && qMeta?.byTarget?.['page_versions.blocks'] === 1,
      `byTarget: ${JSON.stringify(qMeta?.byTarget)}`)

    // Ranh giới: a.jpg sang R2, a.jpg.webp (tải hỏng) còn local và mọi tham chiếu tới nó y nguyên.
    const [artAfter] = await db.select().from(articles).where(eq(articles.id, art.insertId))
    assert.equal(artAfter!.content, `<img src="${cdn('a.jpg')}"><img src="${u('a.jpg.webp')}"><img src="http://localhost:3000${u('a.jpg.webp')}?v=2">`)
    assert.equal(artAfter!.thumbnailUrl, u('a.jpg.webp'))
    const [pageAfter] = await db.select().from(pages).where(eq(pages.id, page.insertId))
    assert.deepEqual(pageAfter!.publishedBlocks, [{ id: 'b', blockType: 'image', data: { imageUrl: u('a.jpg.webp'), alt: 'a' }, isVisible: true }])
    const [webpRow] = await db.select().from(media).where(eq(media.id, ids['a.jpg.webp']!))
    assert.equal(webpRow!.provider, 'local')
    assert.equal(await fs.readFile(path.join(uploadDir, 'a.jpg.webp'), 'utf8'), 'a.jpg.webp')

    // Lưới an toàn: late.jpg đã chuyển (hàng + nội dung đã có), nhưng hàng ghi chen
    // vẫn trỏ URL cũ → tệp cũ GIỮ; lượt đồng bộ kế tiếp vá nốt tham chiếu đó.
    const [lateRow] = await db.select().from(media).where(eq(media.id, ids['late.jpg']!))
    assert.equal(lateRow!.provider, 'r2')
    assert.equal(await settingValue('late_banner'), u('late.jpg'))
    assert.equal(await fs.readFile(path.join(uploadDir, 'late.jpg'), 'utf8'), 'late.jpg', 'tệp cũ còn được tham chiếu → không xoá')
    const repaired = await repairInterruptedSyncRewrites(db, null)
    assert.equal(repaired.urlsRepaired, 1)
    assert.equal(await settingValue('late_banner'), cdn('late.jpg'))
  } finally {
    failUploadFor.clear()
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
    await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {})
  }
})
