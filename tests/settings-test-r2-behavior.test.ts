import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * POST /api/admin/settings/test-r2 — the "Kiểm tra kết nối R2" button.
 *
 * It used to need only `settings.read`, build the R2 endpoint from the `accountId`
 * in the BODY (`evil.example#` → `https://evil.example#.r2.cloudflarestorage.com`,
 * host `evil.example`) and echo the SDK's raw `err.message`: anyone allowed to LOOK
 * at the settings could make the server connect to a host of their choosing and
 * read back what happened. These run the real handler with a fake settings table
 * and a fake S3 client that records which credentials it was built with.
 */

const SAVED_ACCOUNT = '0123456789abcdef0123456789abcdef'
const SAVED = {
  media_provider: 'r2',
  r2_account_id: SAVED_ACCOUNT,
  r2_access_key: 'SAVED-AKID',
  r2_secret_key: 'SAVED-R2-SECRET',
  r2_bucket: 'cdkt-media',
  r2_public_url: 'https://cdn.example.vn',
}

type BuiltClient = { accountId: string, accessKeyId: string, secretAccessKey: string, bucket: string }
let savedRows: Array<{ key: string, value: string | null }> = []
const clients: BuiltClient[] = []
const sentBuckets: string[] = []
let sendFailure: unknown = null
let destroyed = 0
const warnings: Array<Record<string, unknown>> = []
const permissionChecks: string[] = []
let dbReads = 0

mock.module('../server/utils/media-r2', {
  namedExports: {
    createR2Client: (config: BuiltClient) => {
      clients.push({ accountId: config.accountId, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, bucket: config.bucket })
      return {
        send: async (command: { input: { Bucket: string } }) => {
          sentBuckets.push(command.input.Bucket)
          if (sendFailure) throw sendFailure
          return { KeyCount: 0 }
        },
        destroy: () => { destroyed += 1 },
      }
    },
    deleteR2File: async () => {},
  },
})
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({ select: () => ({ from: async () => { dbReads += 1; return savedRows } }) }),
  },
})
mock.module('../server/utils/permissions', {
  namedExports: {
    requireResourcePermission: (_user: unknown, resource: string, action: string) => { permissionChecks.push(`${resource}.${action}`) },
  },
})
mock.module('../server/utils/logger', {
  namedExports: { logWarn: (fields: Record<string, unknown>) => { warnings.push(fields) }, logInfo: () => {}, logError: () => {} },
})

type Event = { body: unknown, context: Record<string, unknown> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

const handler = (await import('../server/api/admin/settings/test-r2.post')).default as unknown as (event: Event) => Promise<{ ok: boolean, message: string, usedSaved?: boolean }>

function reset(rows: Record<string, string> = SAVED) {
  savedRows = Object.entries(rows).map(([key, value]) => ({ key, value }))
  clients.length = 0
  sentBuckets.length = 0
  sendFailure = null
  destroyed = 0
  warnings.length = 0
  permissionChecks.length = 0
  dbReads = 0
}

const call = (body: Record<string, unknown>) => handler({ body, context: { adminUser: { id: 7 } } })
async function rejection(promise: Promise<unknown>): Promise<Error & { statusCode: number }> {
  try { await promise } catch (error) { return error as Error & { statusCode: number } }
  assert.fail('expected the request to be rejected')
}

test('needs settings.update (it makes the server connect out with credentials), not settings.read', async () => {
  reset()
  await call({ secretAccessKey: '********' })
  assert.deepEqual(permissionChecks, ['settings.update'])
})

test('a masked/blank/missing secret tests the SAVED config whole — body accountId/bucket/accessKey are ignored', async () => {
  for (const secret of [{ secretAccessKey: '********' }, { secretAccessKey: '' }, {}]) {
    reset()
    const response = await call({ accountId: 'evil.example#', accessKeyId: 'probe', bucket: 'other-bucket', ...secret })
    assert.deepEqual(clients, [{ accountId: SAVED_ACCOUNT, accessKeyId: 'SAVED-AKID', secretAccessKey: 'SAVED-R2-SECRET', bucket: 'cdkt-media' }])
    assert.deepEqual(sentBuckets, ['cdkt-media'])
    assert.equal(response.usedSaved, true)
    assert.match(response.message, /ĐÃ LƯU/, 'the admin is told the unsaved values were not the ones tested')
  }
})

test('the unchanged form (UI sends the saved values + the mask) tests the saved config without a warning', async () => {
  reset()
  const response = await call({ accountId: SAVED_ACCOUNT, accessKeyId: 'SAVED-AKID', secretAccessKey: '********', bucket: 'cdkt-media' })
  assert.equal(clients[0]!.secretAccessKey, 'SAVED-R2-SECRET')
  assert.doesNotMatch(response.message, /ĐÃ LƯU/)
})

test('a typed secret tests exactly the typed values — the settings table is not even read', async () => {
  reset()
  const other = 'fedcba9876543210fedcba9876543210'
  const response = await call({ accountId: other, accessKeyId: 'NEW-AKID', secretAccessKey: 'typed-secret', bucket: 'new-bucket' })
  assert.equal(dbReads, 0)
  assert.deepEqual(clients, [{ accountId: other, accessKeyId: 'NEW-AKID', secretAccessKey: 'typed-secret', bucket: 'new-bucket' }])
  assert.equal(response.usedSaved, false)
  assert.equal(destroyed, 1, 'the client is released')
})

test('a typed account id or bucket that could steer the host is refused before any client is built', async () => {
  const steering = ['evil.example#', 'evil.example/', 'a@evil.example#', `${SAVED_ACCOUNT}.evil.example#`, `${SAVED_ACCOUNT}x`, '10.0.0.5']
  for (const accountId of steering) {
    reset()
    const error = await rejection(call({ accountId, accessKeyId: 'a', secretAccessKey: 'typed', bucket: 'cdkt-media' }))
    assert.equal(error.statusCode, 400, accountId)
    assert.match(error.message, /32 ký tự hex/, accountId)
    assert.equal(clients.length, 0, `${accountId}: no client built`)
  }
  for (const bucket of ['evil.example', 'a/b', 'a#b', 'UPPER', 'x']) {
    reset()
    const error = await rejection(call({ accountId: SAVED_ACCOUNT, accessKeyId: 'a', secretAccessKey: 'typed', bucket }))
    assert.equal(error.statusCode, 400, bucket)
    assert.equal(clients.length, 0, `${bucket}: no client built`)
  }
})

test('a hostile account id saved before the guard existed is not dialled from the saved path either', async () => {
  reset({ ...SAVED, r2_account_id: 'evil.example#' })
  const error = await rejection(call({ secretAccessKey: '********' }))
  assert.equal(error.statusCode, 400)
  assert.match(error.message, /đã lưu không hợp lệ/)
  assert.equal(clients.length, 0)
})

test('an incomplete saved config is a 400 with guidance, not a connection attempt', async () => {
  reset({ ...SAVED, r2_secret_key: '' })
  const error = await rejection(call({ secretAccessKey: '' }))
  assert.equal(error.statusCode, 400)
  assert.match(error.message, /chưa được cấu hình đủ/)
  assert.equal(clients.length, 0)
})

const FAILURES: Array<[string, unknown, RegExp]> = [
  ['bad key id', Object.assign(new Error('The AWS Access Key Id you provided does not exist in our records. RequestId abc'), { name: 'InvalidAccessKeyId', $metadata: { httpStatusCode: 403 } }), /từ chối thông tin đăng nhập/],
  ['bad signature', Object.assign(new Error('SignatureDoesNotMatch at 104.18.0.1'), { name: 'SignatureDoesNotMatch', $metadata: { httpStatusCode: 403 } }), /từ chối thông tin đăng nhập/],
  ['401 without a name', Object.assign(new Error('Unauthorized'), { name: 'Unknown', $metadata: { httpStatusCode: 401 } }), /từ chối thông tin đăng nhập/],
  ['missing bucket', Object.assign(new Error('The specified bucket does not exist: cdkt-media'), { name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } }), /Không tìm thấy Bucket/],
  ['dns', Object.assign(new Error('getaddrinfo ENOTFOUND x.r2.cloudflarestorage.com'), { code: 'ENOTFOUND' }), /lỗi mạng/],
  ['refused', Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:443'), { code: 'ECONNREFUSED' }), /lỗi mạng/],
  ['timeout', Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }), /lỗi mạng/],
  ['wrapped socket error', Object.assign(new Error('socket hang up'), { cause: { code: 'ECONNRESET' } }), /lỗi mạng/],
  ['anything else', new Error('weird internal 10.1.2.3 banner'), /không xác định/],
]

for (const [label, failure, expected] of FAILURES) {
  test(`failure "${label}": a classified Vietnamese message, the raw SDK text only in the server log`, async () => {
    reset()
    sendFailure = failure
    const error = await rejection(call({ secretAccessKey: '********' }))
    assert.equal(error.statusCode, 400)
    assert.match(error.message, /^Kết nối R2 thất bại: /)
    assert.match(error.message, expected)
    const raw = (failure as Error).message
    assert.ok(!error.message.includes(raw), 'the raw SDK message is never echoed')
    assert.doesNotMatch(error.message, /\d+\.\d+\.\d+\.\d+|ENOTFOUND|ECONNREFUSED|RequestId|cloudflarestorage/)
    assert.equal(warnings.length, 1)
    assert.equal(warnings[0]!.event, 'r2.test_failed')
    assert.equal(warnings[0]!.error, raw, 'details stay server-side for the operator')
    assert.equal(destroyed, 1)
  })
}
