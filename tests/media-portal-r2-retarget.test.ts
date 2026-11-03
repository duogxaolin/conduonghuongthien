import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { randomBytes } from 'node:crypto'
import type { SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

/**
 * PUT /api/admin/settings/media-portal — the R2 settings for VIDEO storage.
 *
 * Same hole the SMTP / image-R2 settings had: the secret field is left blank to
 * mean "keep the saved secret", so a `settings.update` holder could change the
 * account id (which IS the endpoint host: `https://${accountId}.r2.cloudflarestorage.com`)
 * or the bucket and leave the stored secret in place — the next video upload then
 * signs requests to a destination the saver never proved they own. Now: changing
 * account id or bucket requires typing the secret in the same request, and both are
 * format-checked (32-hex account id pins the host; R2 bucket naming keeps the bucket
 * one DNS label).
 *
 * Runs the real handler against an in-memory `settings` table. The fake honours the
 * WHERE the handler builds (compiled with Drizzle's MySQL dialect), so reading the
 * current values by `group` instead of by key is caught too.
 */

process.env.CHATBOT_ENCRYPTION_SECRET = randomBytes(32).toString('base64')

const ACCOUNT = '0123456789abcdef0123456789abcdef'
const OTHER_ACCOUNT = 'fedcba9876543210fedcba9876543210'
const SECRET_ENVELOPE = JSON.stringify({ v: 1, iv: 'x', tag: 'y', ciphertext: 'z', lastFour: 'ABCD' })

type Row = { key: string, value: string, group: string }
const store = new Map<string, Row>()
const audits: unknown[] = []
const dialect = new MySqlDialect()

function seed(rows: Array<[string, string, string?]>) {
  store.clear()
  audits.length = 0
  for (const [key, value, group] of rows) store.set(key, { key, value, group: group ?? 'media_portal' })
}

/** Evaluate the two WHERE shapes this handler can build: `group = ?` or `key in (…)`. */
function matches(where: SQL, row: Row): boolean {
  const { sql, params } = dialect.sqlToQuery(where)
  if (/`group` = \?/.test(sql)) return row.group === params[0]
  if (/`key` in \(/.test(sql)) return params.includes(row.key)
  throw new Error(`unexpected WHERE: ${sql}`)
}

const tx = {
  insert: (table: unknown) => ({
    values: (values: { key?: string, value?: string, group?: string }) => {
      if (values.key === undefined) { audits.push(values); return Promise.resolve() }
      return {
        onDuplicateKeyUpdate: async ({ set }: { set: { value: string } }) => {
          const existing = store.get(values.key!)
          if (existing) existing.value = set.value
          else store.set(values.key!, { key: values.key!, value: values.value!, group: values.group ?? '' })
          void table
        },
      }
    },
  }),
}
const fakeDb = {
  select: () => ({
    from: () => ({
      where: async (where: SQL) => [...store.values()].filter(row => matches(where, row)).map(({ key, value }) => ({ key, value })),
    }),
  }),
  transaction: async (callback: (t: typeof tx) => Promise<void>) => callback(tx),
}

mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb } })
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {} } })

type Event = { body: unknown, context: Record<string, unknown> }
// This handler imports its h3 helpers explicitly (not via Nitro auto-imports).
mock.module('h3', {
  namedExports: {
    defineEventHandler: (handler: unknown) => handler,
    readBody: async (event: Event) => event.body,
    createError: (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input),
  },
})

const handler = (await import('../server/api/admin/settings/media-portal.put')).default as unknown as (event: Event) => Promise<{ ok: boolean }>
const save = (fields: Record<string, string>) => handler({ body: { fields }, context: { adminUser: { id: 3 } } })
async function rejection(promise: Promise<unknown>): Promise<Error & { statusCode: number }> {
  try { await promise } catch (error) { return error as Error & { statusCode: number } }
  assert.fail('expected the save to be rejected')
}

const SAVED: Array<[string, string, string?]> = [
  ['media_video_storage_provider', 'r2'],
  ['media_video_r2_account_id', ACCOUNT],
  ['media_video_r2_access_key', 'AKID'],
  ['media_video_r2_secret_key', SECRET_ENVELOPE],
  ['media_video_r2_bucket', 'cdkt-video'],
  ['media_video_r2_public_url', 'https://video.example.vn'],
]
const value = (key: string) => store.get(key)?.value
/** What the page sends when the officer did not touch the secret box. */
const UNTOUCHED = { videoStorageProvider: 'r2', videoR2AccountId: ACCOUNT, videoR2AccessKey: 'AKID', videoR2SecretKey: '', videoR2Bucket: 'cdkt-video', videoR2PublicUrl: 'https://video.example.vn' }

test('changing the account id without the secret is refused and nothing is written', async () => {
  seed(SAVED)
  const error = await rejection(save({ ...UNTOUCHED, videoR2AccountId: OTHER_ACCOUNT, videoR2AccessKey: 'OTHER-AKID' }))
  assert.equal(error.statusCode, 400)
  assert.match(error.message, /nhập lại R2 Secret Key/)
  assert.equal(value('media_video_r2_account_id'), ACCOUNT)
  assert.equal(value('media_video_r2_access_key'), 'AKID', 'no partial write of the other fields')
  assert.equal(audits.length, 0)
})

test('changing the bucket without the secret is refused (whitespace-only secret is not a secret)', async () => {
  for (const secret of ['', '   ']) {
    seed(SAVED)
    const error = await rejection(save({ ...UNTOUCHED, videoR2Bucket: 'attacker-bucket', videoR2SecretKey: secret }))
    assert.equal(error.statusCode, 400)
    assert.equal(value('media_video_r2_bucket'), 'cdkt-video')
  }
})

test('the same change WITH the secret typed is saved, and the new secret replaces the old one', async () => {
  seed(SAVED)
  await save({ ...UNTOUCHED, videoR2AccountId: OTHER_ACCOUNT, videoR2Bucket: 'new-video', videoR2SecretKey: 'typed-secret' })
  assert.equal(value('media_video_r2_account_id'), OTHER_ACCOUNT)
  assert.equal(value('media_video_r2_bucket'), 'new-video')
  assert.notEqual(value('media_video_r2_secret_key'), SECRET_ENVELOPE)
  assert.equal(audits.length, 1)
})

test('an account id or bucket that could steer the request is refused even with a typed secret', async () => {
  for (const accountId of ['evil.example#', 'evil.example/', `${ACCOUNT}.evil.example#`, `${ACCOUNT}x`]) {
    seed(SAVED)
    const error = await rejection(save({ ...UNTOUCHED, videoR2AccountId: accountId, videoR2SecretKey: 'typed' }))
    assert.equal(error.statusCode, 400, accountId)
    assert.match(error.message, /32 ký tự hex/, accountId)
    assert.equal(value('media_video_r2_account_id'), ACCOUNT)
  }
  for (const bucket of ['evil.example', 'a/b', 'UPPER', 'x']) {
    seed(SAVED)
    const error = await rejection(save({ ...UNTOUCHED, videoR2Bucket: bucket, videoR2SecretKey: 'typed' }))
    assert.equal(error.statusCode, 400, bucket)
  }
})

test('resubmitting the unchanged form (blank secret) still saves the other fields', async () => {
  seed(SAVED)
  await save({ ...UNTOUCHED, videoR2PublicUrl: 'https://cdn2.example.vn', processingMaxJobs: '2' })
  assert.equal(value('media_video_r2_public_url'), 'https://cdn2.example.vn')
  assert.equal(value('media_video_r2_secret_key'), SECRET_ENVELOPE, 'blank secret keeps the stored one')
})

test('a legacy invalid account id saved earlier does not block saving other fields when resent unchanged', async () => {
  seed(SAVED.map(([k, v, g]) => (k === 'media_video_r2_account_id' ? [k, 'legacy-value', g] : [k, v, g])) as Array<[string, string, string?]>)
  await save({ ...UNTOUCHED, videoR2AccountId: 'legacy-value', processingMaxJobs: '3' })
  assert.equal(value('media_processing_max_jobs'), '3')
})

test('with no secret stored there is nothing to leak: account id and bucket may change freely', async () => {
  seed(SAVED.filter(([k]) => k !== 'media_video_r2_secret_key'))
  await save({ ...UNTOUCHED, videoR2AccountId: OTHER_ACCOUNT, videoR2Bucket: 'first-bucket' })
  assert.equal(value('media_video_r2_account_id'), OTHER_ACCOUNT)
})

test('a secret row stored under another settings group still counts as stored', async () => {
  seed(SAVED.map(([k, v]) => [k, v, k === 'media_video_r2_secret_key' ? 'media' : 'media_portal']) as Array<[string, string, string?]>)
  const error = await rejection(save({ ...UNTOUCHED, videoR2AccountId: OTHER_ACCOUNT }))
  assert.equal(error.statusCode, 400)
  assert.equal(value('media_video_r2_account_id'), ACCOUNT)
})

/**
 * The GET now reports a stored secret as `********` (spec admin-settings-secrets).
 * A client that sends that mask back must keep the stored secret — and the mask
 * is not "the secret typed again", so it unlocks no change of account or bucket.
 */
test('the mask sent back keeps the stored secret and changes nothing else about it', async () => {
  seed(SAVED)
  await save({ ...UNTOUCHED, videoR2SecretKey: '********', videoR2PublicUrl: 'https://cdn.example.vn' })
  assert.equal(value('media_video_r2_secret_key'), SECRET_ENVELOPE, 'the mask replaced the stored secret')
  assert.equal(value('media_video_r2_public_url'), 'https://cdn.example.vn', 'the rest of the form is saved')
})

test('the audit row records that the secret changed, never any part of it', async () => {
  seed(SAVED)
  await save({ ...UNTOUCHED, videoR2SecretKey: 'new-secret-value-9876' })
  assert.equal(audits.length, 1)
  const text = JSON.stringify(audits[0])
  assert.match(text, /media_video_r2_secret_key/)
  assert.doesNotMatch(text, /ABCD|9876|new-secret/, 'part of a secret reached activity_logs')
})

test('the mask is not a retyped secret: it cannot move the stored secret to another account or bucket', async () => {
  for (const change of [{ videoR2AccountId: OTHER_ACCOUNT }, { videoR2Bucket: 'attacker-bucket' }]) {
    seed(SAVED)
    const error = await rejection(save({ ...UNTOUCHED, ...change, videoR2SecretKey: '********' }))
    assert.equal(error.statusCode, 400)
    assert.equal(value('media_video_r2_account_id'), ACCOUNT)
    assert.equal(value('media_video_r2_bucket'), 'cdkt-video')
    assert.equal(value('media_video_r2_secret_key'), SECRET_ENVELOPE)
  }
})

test('first-time setup (nothing stored) needs no retype and validates formats', async () => {
  seed([])
  await save({ videoStorageProvider: 'r2', videoR2AccountId: ACCOUNT, videoR2AccessKey: 'AKID', videoR2SecretKey: 'first-secret', videoR2Bucket: 'cdkt-video', videoR2PublicUrl: '' })
  assert.equal(value('media_video_r2_account_id'), ACCOUNT)
  seed([])
  const error = await rejection(save({ videoR2AccountId: 'not-hex' }))
  assert.equal(error.statusCode, 400)
})
