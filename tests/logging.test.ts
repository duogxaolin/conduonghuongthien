import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { REDACTED, SECURITY_EVENTS, buildLogRecord } from '../server/utils/logger'

/**
 * The server had three bare console.error calls and nothing else. Nothing
 * recorded a failed login, a lockout or a rejected session, so an operator had
 * no way to notice the admin panel being attacked.
 *
 * A log that leaks the credential it is reporting on is worse than no log, so
 * redaction is pinned here as hard as the events themselves.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const AT = new Date('2026-07-26T10:00:00.000Z')
const record = (fields: Record<string, unknown> & { event: string }) => buildLogRecord('warn', fields, AT)

// ─── Shape ───────────────────────────────────────────────────────────────────
test('every line carries level, time and event', () => {
  const line = record({ event: 'auth.login_failed' })
  assert.equal(line.level, 'warn')
  assert.equal(line.time, '2026-07-26T10:00:00.000Z')
  assert.equal(line.event, 'auth.login_failed')
})

test('a record is JSON-serialisable so one line stays one line', () => {
  const line = record({ event: 'x', nested: { a: [1, 2] }, when: AT })
  const round = JSON.parse(JSON.stringify(line))
  assert.equal(round.nested.a[1], 2)
  assert.equal(round.when, AT.toISOString())
})

test('an Error becomes readable fields instead of an empty object', () => {
  const error = new Error('connection refused')
  const line = record({ event: 'db.failed', error }) as { error: Record<string, unknown> }
  assert.equal(line.error.name, 'Error')
  assert.equal(line.error.message, 'connection refused')
  assert.ok(String(line.error.stack).length > 0)
})

// ─── Redaction ───────────────────────────────────────────────────────────────
test('credentials are stripped wherever they appear in the payload', () => {
  const line = record({
    event: 'auth.login_failed',
    password: 'hunter2',
    passwordHash: '$2b$12$abcdefg',
    apiKey: 'sk-live-123',
    accessToken: 'eyJ',
    headers: { authorization: 'Bearer abc', cookie: 'cdkt_admin=x', 'user-agent': 'curl/8' },
  }) as Record<string, Record<string, unknown>>

  const serialised = JSON.stringify(line)
  for (const secret of ['hunter2', '$2b$12$abcdefg', 'sk-live-123', 'eyJ', 'Bearer abc', 'cdkt_admin=x']) {
    assert.ok(!serialised.includes(secret), `secret reached the log: ${secret}`)
  }
  assert.equal(line.password, REDACTED)
  assert.equal(line.headers.authorization, REDACTED)
  // Non-secret context must survive, or the log is useless.
  assert.equal(line.headers['user-agent'], 'curl/8')
})

test('redaction is by key name and case-insensitive', () => {
  const line = record({ event: 'x', JWT_SECRET: 'a', 'X-Api-Key': 'b', dbCredential: 'c' }) as Record<string, unknown>
  assert.equal(line.JWT_SECRET, REDACTED)
  assert.equal(line['X-Api-Key'], REDACTED)
  assert.equal(line.dbCredential, REDACTED)
})

test('one hostile field cannot flood the log', () => {
  const line = record({ event: 'x', note: 'A'.repeat(5000) }) as { note: string }
  assert.ok(line.note.length < 600, `a ${line.note.length}-character field was written verbatim`)
})

test('a cyclic or deeply nested payload does not throw', () => {
  let deep: Record<string, unknown> = { end: true }
  for (let i = 0; i < 12; i += 1) deep = { deep }
  assert.doesNotThrow(() => JSON.stringify(record({ event: 'x', deep })))
})

// ─── The events an operator needs ────────────────────────────────────────────
test('login records every failure, the lockout, and the success', () => {
  const source = read('server/api/admin/auth/login.post.ts')
  assert.equal((source.match(/SECURITY_EVENTS\.loginFailed/g) ?? []).length, 3, 'not all three 401 branches are logged')
  assert.match(source, /SECURITY_EVENTS\.loginLocked/)
  assert.match(source, /SECURITY_EVENTS\.loginSucceeded/)
  // The operator needs to tell the branches apart even though the caller cannot.
  for (const reason of ['unknown_user', 'account_disabled', 'bad_password']) {
    assert.match(source, new RegExp(`reason: '${reason}'`), `no reason recorded for ${reason}`)
  }
})

test('the 401 responses stay identical even though the logs differ', () => {
  const source = read('server/api/admin/auth/login.post.ts')
  const messages = [...source.matchAll(/statusCode: 401, statusMessage: '([^']+)'/g)].map(m => m[1])
  assert.ok(messages.length >= 3)
  assert.equal(new Set(messages).size, 1, `logging the reason leaked it into the response: ${[...new Set(messages)]}`)
})

test('a revoked session and a throttled form are recorded too', () => {
  assert.match(read('server/middleware/admin-auth.ts'), /SECURITY_EVENTS\.sessionRevoked/)
  assert.match(read('server/api/submissions.post.ts'), /SECURITY_EVENTS\.submissionThrottled/)
})

test('no server route falls back to a bare console call', () => {
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) { walk(path); continue }
      if (!entry.name.endsWith('.ts')) continue
      if (/console\.(log|error|warn|info)\(/.test(read(path))) offenders.push(path)
    }
  }
  walk('server/api')
  walk('server/middleware')
  assert.deepEqual(offenders, [], `unstructured logging in: ${offenders.join(', ')}`)
})

test('the event names are one enumerated list, not scattered strings', () => {
  // So an operator can write one alert rule and know what to match on.
  assert.ok(Object.values(SECURITY_EVENTS).every(name => /^[a-z]+\.[a-z_]+$/.test(name)))
  assert.equal(new Set(Object.values(SECURITY_EVENTS)).size, Object.values(SECURITY_EVENTS).length)
})
