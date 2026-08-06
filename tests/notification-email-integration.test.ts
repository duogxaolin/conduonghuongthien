/**
 * A reply email actually reaches SMTP, and a dead mail server never costs a comment.
 *
 * `sendReplyEmail` swallows every error by design: the in-portal notification is
 * the record, the email is a convenience, and a citizen's comment must land
 * whether or not the mail host answers. That design is correct — and it is also
 * exactly why nothing else can tell you the email works. A silent failure and a
 * successful send look identical from the caller.
 *
 * So this suite runs a real SMTP listener and reads what arrived:
 *
 *   - **A stub cannot.** It confirms the shape its author believed in. Only a
 *     transport that speaks the protocol shows that nodemailer accepts what we
 *     build, and that the message is addressed and encoded correctly.
 *   - **A source-text test cannot.** It can pin `sendMail(` characters; it cannot
 *     show the recipient, the link, or that the opt-out was honoured.
 *   - **The 3C policy needs proving, not asserting.** The last case here kills the
 *     mail server mid-run and requires the comment write to still succeed. That is
 *     the promise the whole design rests on.
 *
 * Bodies arrive quoted-printable, so every assertion decodes first — raw text
 * contains soft line breaks mid-URL and `=C3=A0` bytes for each Vietnamese
 * diacritic. Asserting on the raw form tests the encoding, not the message.
 *
 * Gated and self-cleaning, following the *-integration precedent:
 *
 *   NOTIFICATION_EMAIL_INTEGRATION=1 NOTIFICATION_EMAIL_PORT=33069 \
 *   NOTIFICATION_EMAIL_USER=root NOTIFICATION_EMAIL_PASSWORD=... npm test
 */
import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'
import mysql from 'mysql2/promise'

const enabled = process.env.NOTIFICATION_EMAIL_INTEGRATION === '1'
const host = process.env.NOTIFICATION_EMAIL_HOST || '127.0.0.1'
const port = Number(process.env.NOTIFICATION_EMAIL_PORT || 3306)
const user = process.env.NOTIFICATION_EMAIL_USER || 'root'
const password = process.env.NOTIFICATION_EMAIL_PASSWORD || 'rootpassword'
const database = `cdkt_notif_mail_${Date.now()}_${process.pid}`

function assertDisposableDatabase(name: string) {
  assert.match(name, /^cdkt_notif_mail_\d+_\d+$/)
  assert.notEqual(name, 'cdkt_admin')
  assert.notEqual(name, process.env.DB_NAME)
}

/** Decode quoted-printable, then read the result as UTF-8. */
function decodeMessage(raw: string): string {
  const unfolded = raw
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  return Buffer.from(unfolded, 'binary').toString('utf8')
}

/** Minimal SMTP sink: enough of the protocol for nodemailer to deliver. */
function startSmtpSink(captured: string[]) {
  const server = net.createServer((socket) => {
    let buffer = ''
    let inData = false
    let message = ''
    socket.write('220 localhost ESMTP\r\n')
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      let index: number
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        if (inData) {
          if (line === '.') { inData = false; captured.push(message); message = ''; socket.write('250 OK\r\n') }
          else message += `${line}\n`
          continue
        }
        const command = line.toUpperCase()
        if (command.startsWith('EHLO') || command.startsWith('HELO')) socket.write('250-localhost\r\n250 AUTH PLAIN LOGIN\r\n')
        else if (command.startsWith('AUTH')) socket.write('235 OK\r\n')
        else if (command === 'DATA') { inData = true; socket.write('354 Send data\r\n') }
        else if (command === 'QUIT') { socket.write('221 Bye\r\n'); socket.end() }
        else socket.write('250 OK\r\n')
      }
    })
    socket.on('error', () => { /* a torn-down socket is expected in the last case */ })
  })
  return server
}

const settle = () => new Promise(resolve => setTimeout(resolve, 600))

test('a reply email reaches SMTP, and a dead mail server costs nothing', {
  skip: !enabled,
  timeout: 180_000,
}, async () => {
  assertDisposableDatabase(database)

  const captured: string[] = []
  const smtp = startSmtpSink(captured)
  const smtpPort = await new Promise<number>((resolve) => {
    smtp.listen(0, '127.0.0.1', () => resolve((smtp.address() as net.AddressInfo).port))
  })

  const admin = await mysql.createConnection({ host, port, user, password })
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`)
  await admin.end()

  const previous = { ...process.env }
  Object.assign(process.env, {
    DB_HOST: host, DB_PORT: String(port), DB_USER: user,
    DB_PASSWORD: password, DB_NAME: database,
    PUBLIC_BASE_URL: 'https://cdht.example.vn',
  })

  try {
    const { initDb } = await import('../server/db/init')
    await initDb()

    const { getDb, closeDb } = await import('../server/utils/db')
    const { articles, readerAccounts, settings, roles, users } = await import('../server/db/schema')
    const { createComment, createAdminReply } = await import('../server/services/comments')
    const { eq } = await import('drizzle-orm')

    const db = getDb()

    for (const [key, value] of [
      ['smtp_host', '127.0.0.1'], ['smtp_port', String(smtpPort)], ['smtp_secure', 'false'],
      ['smtp_user', 'portal@example.vn'], ['smtp_pass', 'x'], ['smtp_from', 'portal@example.vn'],
    ]) await db.insert(settings).values({ key, value })

    const [article] = await db.insert(articles).values({
      title: 'Thủ tục xoá án tích', slug: 'thu-tuc-xoa-an-tich', type: 'news',
      status: 'published', commentsEnabled: true, content: 'x',
    })
    const articleId = Number(article.insertId)

    const makeReader = async (sub: string, name: string, email: string) => {
      const [row] = await db.insert(readerAccounts).values({
        googleSub: sub, email, displayName: name, lastSeenAt: new Date(), emailNotifications: true,
      })
      return Number(row.insertId)
    }
    const alice = await makeReader('ne-alice', 'Alice Nguyen', 'alice@example.com')
    const bob = await makeReader('ne-bob', 'Bob Tran', 'bob@example.com')

    const [role] = await db.insert(roles).values({ name: 'verify-role', description: 'x' })
    const [officer] = await db.insert(users).values({
      username: 'canbo', email: 'canbo@example.com', passwordHash: 'x', roleId: Number(role.insertId),
    })

    // ── A top-level comment notifies nobody ────────────────────────────────────
    const top = await createComment({
      readerId: alice, articleId, parentId: null,
      body: 'Tôi muốn hỏi về thủ tục xoá án tích.', ip: '1.2.3.4', userAgent: 'x',
    })
    assert.equal(top.ok, true)
    await settle()
    assert.equal(captured.length, 0, 'a top-level comment sent an email to nobody in particular')

    // ── A reader reply emails the parent author ────────────────────────────────
    await createComment({
      readerId: bob, articleId, parentId: (top as { id: number }).id,
      body: 'Bạn cần mang theo CCCD và đơn xin xác nhận.', ip: '5.6.7.8', userAgent: 'x',
    })
    await settle()
    assert.equal(captured.length, 1, `expected exactly one email, got ${captured.length}`)

    const mail = decodeMessage(captured[0]!)
    assert.match(mail, /To:.*alice@example\.com/i, 'the email did not go to the parent author')
    assert.match(mail, /Bob Tran/, 'the email does not name who replied')
    assert.match(mail, /https:\/\/cdht\.example\.vn\/news\/thu-tuc-xoa-an-tich/,
      'the link is not absolute — a relative path in an email is a dead string')
    assert.match(mail, /#comment-\d+/, 'the link does not anchor the comment')
    assert.match(mail, /trang cá nhân/, 'the email does not say how to turn these off')

    // ── Replying to yourself emails nobody ─────────────────────────────────────
    captured.length = 0
    await createComment({
      readerId: alice, articleId, parentId: (top as { id: number }).id,
      body: 'Cảm ơn.', ip: '1.2.3.4', userAgent: 'x',
    })
    await settle()
    assert.equal(captured.length, 0, 'a reader was emailed about their own reply')

    // ── The portal's own reply is the one that matters most ────────────────────
    captured.length = 0
    await createAdminReply({
      parentId: (top as { id: number }).id,
      body: 'Ban quản trị xin trả lời: hồ sơ nộp tại Công an xã nơi cư trú.',
      actorId: Number(officer.insertId), ip: '9.9.9.9', userAgent: 'x',
    })
    await settle()
    assert.equal(captured.length, 1, 'the official reply did not reach the citizen')
    assert.match(decodeMessage(captured[0]!), /Ban quản trị/,
      'the official reply is not labelled as the portal speaking')

    // ── Opting out is honoured, read at send time ──────────────────────────────
    captured.length = 0
    await db.update(readerAccounts).set({ emailNotifications: false }).where(eq(readerAccounts.id, alice))
    await createComment({
      readerId: bob, articleId, parentId: (top as { id: number }).id,
      body: 'Thêm một ý nữa.', ip: '5.6.7.8', userAgent: 'x',
    })
    await settle()
    assert.equal(captured.length, 0, 'a reader who opted out was emailed anyway')

    /**
     * ── The promise the whole design rests on ────────────────────────────────
     *
     * With the mail server gone, the comment must still commit. If this ever
     * fails, a mail outage has become a comment outage — the exact coupling
     * `sendReplyEmail`'s total try/catch and the after-commit call site exist to
     * prevent.
     */
    captured.length = 0
    await db.update(readerAccounts).set({ emailNotifications: true }).where(eq(readerAccounts.id, alice))
    await new Promise<void>(resolve => smtp.close(() => resolve()))

    const survived = await createComment({
      readerId: bob, articleId, parentId: (top as { id: number }).id,
      body: 'Gửi khi máy chủ mail đã tắt.', ip: '5.6.7.8', userAgent: 'x',
    })
    assert.equal(survived.ok, true, 'an unreachable SMTP host broke the comment write')

    await closeDb()
  } finally {
    if (smtp.listening) await new Promise<void>(resolve => smtp.close(() => resolve()))
    for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'PUBLIC_BASE_URL']) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    const cleanup = await mysql.createConnection({ host, port, user, password })
    await cleanup.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await cleanup.end()
  }
})
