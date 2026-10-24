import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import type { SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { settings as settingsTable } from '../server/db/schema'

/**
 * GET /api/admin/settings/media-portal must hand the page the video-R2 values that
 * are actually STORED.
 *
 * It used to read them from `config.videoStorage.r2`, which only exists when the
 * provider is 'r2' AND all four values are present AND the secret decrypts. In
 * every other case (provider switched to local, secret unreadable after a key
 * rotation, half-configured) the page got '' for Account ID / Access Key / Bucket /
 * Public URL and sent '' back on the next save of ANY media-portal setting —
 * silently wiping the stored values. With the retarget guard on the PUT, that same
 * save would now be refused ("đổi Account ID/Bucket phải nhập lại Secret Key"). The
 * page also needs `secretStored` to show that rule before sending.
 */

const ACCOUNT = '0123456789abcdef0123456789abcdef'
const STORED: Record<string, string> = {
  media_video_r2_account_id: ACCOUNT,
  media_video_r2_access_key: 'AKID',
  media_video_r2_bucket: 'cdkt-video',
  media_video_r2_public_url: 'https://video.example.vn',
  media_video_r2_secret_key: '{"v":1,"lastFour":"ABCD"}',
}
let rows: Record<string, string> = {}
const dialect = new MySqlDialect()

const fakeDb = {
  select: () => ({
    from: (table: unknown) => ({
      where: (where: SQL) => {
        if (table === settingsTable) {
          const { params } = dialect.sqlToQuery(where)
          return Promise.resolve(Object.entries(rows).filter(([key]) => params.includes(key)).map(([key, value]) => ({ key, value })))
        }
        return { groupBy: async () => [] }
      },
    }),
  }),
}

/** What the resolver returns when the provider is LOCAL: no `r2` object at all. */
const LOCAL_RESOLVED = {
  config: {
    uploadEnabled: true, maxUploadSize: 1, chunkSize: 1, diskFloorBytes: 1, sessionInactivityHours: 1,
    processingHeartbeatSeconds: 1, processingStaleMinutes: 1, processingMaxJobs: 1, processingMaxAttempts: 1,
    workdir: '/nonexistent-cdkt-test', videoStorage: { provider: 'local' },
  },
  sources: {},
  videoStorageSources: { provider: 'database', r2AccountId: 'database', r2AccessKey: 'database', r2SecretKey: 'database', r2Bucket: 'database', r2PublicUrl: 'database' },
  videoStorageSecretUnreadable: false,
  videoStorageSecretLastFour: null,
}

mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb } })
mock.module('../server/utils/auth', { namedExports: { checkPermission: () => true } })
mock.module('../server/services/media-config-service', { namedExports: { resolveMediaConfigWithDb: async () => LOCAL_RESOLVED } })
mock.module('h3', {
  namedExports: {
    defineEventHandler: (handler: unknown) => handler,
    createError: (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input),
  },
})

type Response = { config: { videoStorage: Record<string, string> }, videoStorage: { secretStored: boolean } }
const handler = (await import('../server/api/admin/settings/media-portal.get')).default as unknown as (event: unknown) => Promise<Response>
const get = () => handler({ context: { adminUser: { id: 1, isSuperAdmin: true, permissions: [] } } })

test('provider local: the stored Account ID / Access Key / Bucket / Public URL are returned, so the form round-trips them', async () => {
  rows = { ...STORED }
  const res = await get()
  assert.deepEqual(res.config.videoStorage, {
    provider: 'local', r2AccountId: ACCOUNT, r2AccessKey: 'AKID', r2Bucket: 'cdkt-video', r2PublicUrl: 'https://video.example.vn',
  })
  assert.equal(res.videoStorage.secretStored, true)
})

test('nothing stored: empty strings and secretStored=false', async () => {
  rows = {}
  const res = await get()
  assert.equal(res.config.videoStorage.r2AccountId, '')
  assert.equal(res.config.videoStorage.r2Bucket, '')
  assert.equal(res.videoStorage.secretStored, false)
})

test('the secret itself never leaves the server', async () => {
  rows = { ...STORED }
  const res = await get()
  assert.ok(!JSON.stringify(res).includes(STORED.media_video_r2_secret_key!))
})

/**
 * Spec admin-settings-secrets: a stored `media_video_r2_secret_key` is reported as
 * `********`, for every role — not `••••` + its last four characters, which is a
 * piece of the credential. `secretStored` stays the page's "is one saved" signal.
 */
test('a stored video secret is reported as ******** — no last-four characters', async () => {
  rows = { ...STORED }
  const resolved = LOCAL_RESOLVED as { videoStorageSecretLastFour: string | null }
  resolved.videoStorageSecretLastFour = 'WXYZ'
  try {
    for (const isSuperAdmin of [true, false]) {
      const res = await handler({ context: { adminUser: { id: 1, isSuperAdmin, permissions: [] } } }) as unknown as { videoStorage: { secretMasked: string, secretStored: boolean } }
      assert.equal(res.videoStorage.secretMasked, '********')
      assert.equal(res.videoStorage.secretStored, true)
      assert.doesNotMatch(JSON.stringify(res), /WXYZ|ABCD/, 'part of the secret left the server')
    }
  } finally {
    resolved.videoStorageSecretLastFour = null
  }
})

test('a secret that only the environment provides (nothing in the table) still reads as configured, masked', async () => {
  rows = {}
  const resolved = LOCAL_RESOLVED as { videoStorageSecretLastFour: string | null }
  resolved.videoStorageSecretLastFour = 'WXYZ'
  try {
    const res = await get() as unknown as { videoStorage: { secretMasked: string, secretStored: boolean } }
    assert.equal(res.videoStorage.secretMasked, '********')
    assert.equal(res.videoStorage.secretStored, false)
  } finally {
    resolved.videoStorageSecretLastFour = null
  }
  const none = await get() as unknown as { videoStorage: { secretMasked: string } }
  assert.equal(none.videoStorage.secretMasked, '', 'nothing configured anywhere → empty')
})
