import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * POST /api/admin/settings/test-email used to take host/port/user from the body
 * and, when the password field still held the mask, fill in the SAVED password —
 * so anyone with `settings.update` could point it at their own SMTP server and
 * read the stored password off the AUTH exchange (the settings GET always masks
 * it), or use it as a port scanner. These run the real handler with a fake DB and
 * a fake nodemailer transport and record which server it logged in to.
 */

const SAVED = {
  smtp_host: 'smtp.saved.example',
  smtp_port: '465',
  smtp_secure: 'true',
  smtp_user: 'mailer@saved.example',
  smtp_pass: 'the-stored-secret',
  smtp_from: 'noreply@saved.example',
}

let savedRows: Array<{ key: string, value: string | null }> = []
const transports: Array<{ host: string, port: number, secure: boolean, auth?: { user: string, pass: string } }> = []
const sent: Array<{ from: string, to: string }> = []
/** When set, the fake transport's sendMail rejects with this error (a nodemailer-shaped failure). */
let sendFailure: (Error & { code?: string }) | null = null
const warnings: Array<Record<string, unknown>> = []
let dbReads = 0
const permissionChecks: string[] = []

mock.module('nodemailer', {
  defaultExport: {
    createTransport: (options: typeof transports[number]) => {
      transports.push(options)
      return {
        sendMail: async (message: { from: string, to: string }) => {
          if (sendFailure) throw sendFailure
          sent.push(message)
        },
        close: () => {},
      }
    },
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

const handler = (await import('../server/api/admin/settings/test-email.post')).default as unknown as (event: Event) => Promise<{ ok: boolean, message: string }>

function reset(rows: Record<string, string> = SAVED) {
  savedRows = Object.entries(rows).map(([key, value]) => ({ key, value }))
  transports.length = 0
  sent.length = 0
  dbReads = 0
  permissionChecks.length = 0
  sendFailure = null
  warnings.length = 0
}

const call = (body: Record<string, unknown>) => handler({ body: { to: 'admin@example.com', ...body }, context: { adminUser: { id: 1 } } })

test('a masked password never travels to a host named in the body: the saved config is used whole', async () => {
  reset()
  const response = await call({
    smtp_host: 'attacker.example', smtp_port: '2525', smtp_secure: 'false',
    smtp_user: 'x', smtp_pass: '********', smtp_from: 'spoof@attacker.example',
  })
  assert.equal(transports.length, 1)
  assert.equal(transports[0]!.host, 'smtp.saved.example')
  assert.equal(transports[0]!.port, 465)
  assert.equal(transports[0]!.secure, true)
  assert.deepEqual(transports[0]!.auth, { user: 'mailer@saved.example', pass: 'the-stored-secret' })
  assert.equal(sent[0]!.from, 'noreply@saved.example', 'the saved sender, not the body one')
  assert.ok(!transports.some(t => t.host === 'attacker.example'), 'no connection to the body host at all')
  assert.match(response.message, /ĐÃ LƯU/, 'the admin is told the unsaved server was not the one tested')
  assert.deepEqual(permissionChecks, ['settings.update'])
})

test('a blank password behaves like the mask (no fallback that pairs the stored secret with a new host)', async () => {
  reset()
  await call({ smtp_host: '10.0.0.5', smtp_port: '25', smtp_user: 'probe', smtp_pass: '' })
  assert.equal(transports.length, 1)
  assert.equal(transports[0]!.host, 'smtp.saved.example')
})

test('a missing password field also means "saved config"', async () => {
  reset()
  await call({ smtp_host: 'attacker.example', smtp_user: 'probe' })
  assert.equal(transports[0]!.host, 'smtp.saved.example')
})

test('the unchanged form (UI sends every field + mask) tests the saved config without a warning', async () => {
  reset()
  const response = await call({ ...SAVED, smtp_pass: '********' })
  assert.equal(transports[0]!.host, 'smtp.saved.example')
  assert.doesNotMatch(response.message, /ĐÃ LƯU/)
})

test('a typed password tests the typed server with exactly that password — the stored one is never read', async () => {
  reset()
  await call({ smtp_host: 'smtp.new.example', smtp_port: '587', smtp_user: 'new@new.example', smtp_pass: 'typed-password' })
  assert.equal(dbReads, 0, 'the settings table (and its stored password) is not even read')
  assert.equal(transports.length, 1)
  assert.equal(transports[0]!.host, 'smtp.new.example')
  assert.equal(transports[0]!.port, 587)
  assert.deepEqual(transports[0]!.auth, { user: 'new@new.example', pass: 'typed-password' })
  assert.equal(sent[0]!.from, 'new@new.example')
})

test('a typed password without a user is rejected instead of borrowing the saved user', async () => {
  reset()
  await assert.rejects(call({ smtp_host: 'smtp.new.example', smtp_pass: 'typed-password' }), { statusCode: 400 })
  assert.equal(transports.length, 0)
})

test('with nothing saved, a masked request is a 400 and no connection is attempted', async () => {
  reset({})
  await assert.rejects(call({ smtp_host: 'attacker.example', smtp_user: 'x', smtp_pass: '********' }), { statusCode: 400 })
  assert.equal(transports.length, 0)
})

test('a missing recipient is still a 400', async () => {
  reset()
  await assert.rejects(handler({ body: { to: '  ' }, context: { adminUser: { id: 1 } } }), { statusCode: 400 })
  assert.equal(transports.length, 0)
})

// ─── Port allowlist + classified errors (the endpoint is not a port scanner) ──

test('a typed password + a port outside 25/465/587/2525 is refused before any connection', async () => {
  for (const port of ['6379', '3306', '22', '80', '0', 'abc']) {
    reset()
    await assert.rejects(
      call({ smtp_host: '10.0.0.5', smtp_port: port, smtp_user: 'probe', smtp_pass: 'typed' }),
      (error: { statusCode: number, message: string }) => error.statusCode === 400 && /Cổng SMTP không được phép/.test(error.message),
      port,
    )
    assert.equal(transports.length, 0, `no connection attempt for port ${port}`)
  }
})

test('every allowed port still works with a typed password (and an empty port means 587)', async () => {
  for (const [port, expected] of [['25', 25], ['465', 465], ['587', 587], ['2525', 2525], ['', 587]] as const) {
    reset()
    await call({ smtp_host: 'smtp.new.example', smtp_port: port, smtp_user: 'u@new.example', smtp_pass: 'typed' })
    assert.equal(transports[0]!.port, expected, `port "${port}"`)
  }
})

test('a SAVED config with a non-allowlisted port (stored before this rule) is not dialled either', async () => {
  reset({ ...SAVED, smtp_port: '6379' })
  await assert.rejects(call({ smtp_pass: '********' }), { statusCode: 400 })
  assert.equal(transports.length, 0)
})

test('connection failures come back as one classified sentence — no internal address, banner or raw SMTP reply', async () => {
  const CASES: Array<[string, string, RegExp]> = [
    ['ESOCKET', 'connect ECONNREFUSED 10.0.0.5:25', /Không kết nối được/],
    ['ECONNECTION', 'Connection closed unexpectedly by 10.0.0.5', /Không kết nối được/],
    ['EDNS', 'getaddrinfo ENOTFOUND internal-relay.corp.local', /Không kết nối được/],
    ['ETIMEDOUT', 'Greeting never received from 10.0.0.5:2525', /hết thời gian chờ/],
    ['EAUTH', 'Invalid login: 535 5.7.8 internal-relay.corp.local rejected', /từ chối đăng nhập/],
    ['ETLS', 'Error initiating TLS - wrong version number 10.0.0.5', /TLS/],
    ['EENVELOPE', 'No recipients defined 550 relay denied by internal-relay.corp.local', /từ chối thư/],
    ['', 'SSH-2.0-OpenSSH_9.6 internal banner', /Lỗi kết nối SMTP/],
  ]
  for (const [code, rawMessage, expected] of CASES) {
    reset()
    sendFailure = Object.assign(new Error(rawMessage), code ? { code } : {})
    await assert.rejects(
      call({ smtp_host: 'smtp.new.example', smtp_port: '587', smtp_user: 'u@new.example', smtp_pass: 'typed' }),
      (error: { statusCode: number, message: string }) => {
        assert.equal(error.statusCode, 400)
        assert.match(error.message, expected, code)
        for (const leak of ['10.0.0.5', 'corp.local', 'ECONNREFUSED', 'ENOTFOUND', 'OpenSSH', '535', '550', 'wrong version']) {
          assert.ok(!error.message.includes(leak), `"${leak}" leaked to the client for ${code || 'unknown'}: ${error.message}`)
        }
        return true
      },
    )
    assert.equal(warnings.length, 1, 'the full detail goes to the server log instead')
    assert.equal(warnings[0]!.error, rawMessage)
  }
})
